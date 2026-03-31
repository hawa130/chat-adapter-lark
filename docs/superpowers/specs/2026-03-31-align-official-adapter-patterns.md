# Align with Official Adapter Patterns

**Date:** 2026-03-31
**Status:** Draft
**Goal:** Make chat-adapter-lark follow the same infrastructure patterns as Vercel-maintained adapters (reference: Slack, Google Chat, Discord, Teams, Telegram).

## Background

The Lark adapter works correctly but diverges from official adapter patterns in several areas: logger injection, event deduplication ownership, user/channel caching, and DM state persistence. These divergences cause problems in serverless deployments and make the adapter behave differently from what Chat SDK users expect.

## Changes

### 1. Logger Injection

**Current:** Logger is obtained from `chat.getLogger('lark')` in `initialize()`. No logging before init. Users cannot inject a custom logger.

**Target:** Accept `logger?: Logger` in `LarkAdapterConfig`. Default to `new ConsoleLogger("info").child("lark")`. Use this logger for the entire adapter lifecycle, including construction. Do not override in `initialize()`. This matches all five official adapters.

**Files:** `types.ts`, `factory.ts`, `adapter.ts`

**Details:**
- Add `logger?: Logger` to `LarkAdapterConfig`
- Import `ConsoleLogger` and `Logger` from `chat`
- Constructor: `this.logger = config.logger ?? new ConsoleLogger("info").child("lark")`
- `initialize()`: remove `this.logger = chat.getLogger(ADAPTER_NAME)` — keep the config-provided logger
- `LarkApiClient` constructor already accepts an `ApiLogger` — no change needed there
- `factory.ts`: pass `config.logger` through to `LarkAdapter`

### 2. Remove DedupCache

**Current:** Adapter maintains an in-memory `DedupCache` (LRU, capacity 500) that deduplicates webhook events by `event_id` before calling `chat.processMessage`. The `disconnect()` method clears this cache.

**Target:** Remove entirely. Chat SDK core handles deduplication via the state adapter. All five official adapters (Slack, Discord, Teams, Telegram, GChat) delegate dedup to the SDK — none do adapter-level dedup.

**Files:** `adapter.ts`, `dedup-cache.ts` (delete), `tests/dedup-cache.test.ts` (delete), `tests/adapter.test.ts`

**Details:**
- Delete `src/dedup-cache.ts` and `tests/dedup-cache.test.ts`
- Remove from `adapter.ts`:
  - `import { DedupCache }` and the `dedup` field
  - `DEDUP_CAPACITY` constant
  - `extractEventId` helper function
  - The dedup check in `handleEvent()` (`if (eventId && this.dedup.has(eventId))` block)
- `disconnect()`: clear the local caches (`userNameCache`, `channelTypeMap`) and return. Keep the method for hygiene.
- Update adapter tests that verify dedup behavior — remove or convert to verify events are forwarded

### 3. User Info Cache (lookupUser)

**Current:** `parseMessage` builds `Author` with `open_id` as both `userId` and `userName`/`fullName`. No user info resolution.

**Target:** Two-layer cache (in-memory + state adapter) for user display names, following the Google Chat adapter's `UserInfoCache` pattern. Resolve on message receipt, history fetch, and reaction events.

**Files:** `adapter.ts`, `api-client.ts`, `types.ts`

**Permissions:** The `getUser` API requires **two** scopes:
- `contact:contact.base:readonly` — required to call the API at all (without it: error 40001)
- `contact:user.base:readonly` — required to get the `name` field in the response (without it: name field omitted)

Both must be documented in the README permissions table.

**Contact scope limitation:** The user lookup API only works for users within the app's contact permission scope ("通讯录权限范围"). By default this scope is narrow. Users outside the scope (common in cross-tenant groups) will fail to resolve. This must be documented in the README troubleshooting section.

**In-memory layer:**
```typescript
private readonly userNameCache = new Map<string, string>() // openId → name
```

**State adapter layer:**
- Key: `lark:user:{openId}`
- Type: `{ name: string }` — always a resolved string (real name or openId fallback), never undefined
- TTL: 8 days (`USER_CACHE_TTL_MS`)
- Failed lookup TTL: 1 day (`FAILED_LOOKUP_TTL_MS`) — prevents repeated API calls for users outside contact scope

**New API method** in `LarkApiClient`:
```typescript
async getUser(openId: string) {
  return this.call(() =>
    this.client.contact.user.get({
      path: { user_id: openId },
      params: { user_id_type: 'open_id' },
    }),
  )
}
```
Returns the full SDK response (like all other `LarkApiClient` methods). The caller accesses `.data?.user?.name`.

**New private method** in `LarkAdapter`:
```typescript
private async lookupUser(openId: string): Promise<string> {
  // Layer 1: in-memory (zero-cost for frequently seen users)
  const memCached = this.userNameCache.get(openId)
  if (memCached) return memCached

  // Layer 2: state adapter
  const state = this.chat.getState()
  const cacheKey = `lark:user:${openId}`
  const cached = await state.get<{ name: string }>(cacheKey)
  if (cached) {
    this.userNameCache.set(openId, cached.name)
    return cached.name
  }

  // Layer 3: API call
  try {
    const res = await this.api.getUser(openId)
    const name = res.data?.user?.name ?? openId
    this.userNameCache.set(openId, name)
    await state.set(cacheKey, { name }, USER_CACHE_TTL_MS)
    return name
  } catch {
    this.logger.warn('Failed to lookup user', { openId })
    this.userNameCache.set(openId, openId)
    await state.set(cacheKey, { name: openId }, FAILED_LOOKUP_TTL_MS)
    return openId
  }
}
```

**Mentions as free cache source:** The `im.message.receive_v1` event includes a `mentions` array with `{ name, id: { open_id } }` for every @-mentioned user. The message factory should seed both cache layers from mentions before calling `lookupUser`:
```typescript
for (const mention of data.message.mentions ?? []) {
  if (mention.name && mention.id?.open_id) {
    this.userNameCache.set(mention.id.open_id, mention.name)
    void state.set(`lark:user:${mention.id.open_id}`, { name: mention.name }, USER_CACHE_TTL_MS)
  }
}
```

**Message handling change:**
- `handleMessageEvent` extracts `threadId` synchronously from `data.message.chat_id` / `data.message.root_id` (just `encodeThreadId`), then passes an `async () => Promise<Message>` factory to `chat.processMessage`. Note: `processMessage` accepts `Message | (() => Promise<Message>)` as the third argument — the factory form is already used by the Slack and Google Chat adapters.
- The factory first seeds the cache from mentions, then calls `lookupUser(sender.open_id)` to resolve the author name, then calls `parseMessage` and overrides `Author.fullName` / `Author.userName` with the resolved name.
- `buildAuthor()` helper remains unchanged — the factory overrides its output after calling `parseMessage`.
- `handleReactionEvent`: call `lookupUser` within the existing async chain (inside the `.then()` after `resolveReactionThreadId`), use the result to populate `user.fullName` and `user.userName` instead of the current empty strings.

**History fetch paths:** `fetchMessages()` and `fetchMessage()` both call `itemToMessage()`, which builds authors from raw Lark data without name resolution. Make `itemToMessage` async and call `lookupUser` to resolve the sender name:
```typescript
private async itemToMessage(item: LarkMessageItem, threadId: string): Promise<Message<LarkRaw>> {
  const sender = item.sender
  const senderId = sender?.id ?? ''
  const resolvedName = senderId ? await this.lookupUser(senderId) : 'unknown'
  // ... build author with resolvedName as fullName/userName
}
```
Callers (`fetchMessages`, `fetchMessage`, `fetchChannelMessages`) update to `await Promise.all(items.map(...))` for the array case. Most lookups will hit the in-memory cache, so the overhead is minimal.

**Scope boundary:** Only cache `name`. Do not build reverse indexes or thread participant tracking — Lark's mention system uses `open_id`, not display names, so outgoing mention resolution is not needed.

### 4. Channel Info Cache + DM Persistence

**Current:** `isDM()` and `getChannelVisibility()` rely on an in-memory `Set<string>` (`dmCache`) populated when P2P messages arrive. Lost on cold start in serverless.

**Target:** Two-layer cache (in-memory + state adapter) for channel metadata. Same write-through pattern as user cache.

**Files:** `adapter.ts`

**In-memory layer:**
```typescript
private readonly channelTypeMap = new Map<string, string>() // chatId → chatType ("p2p" | "group")
```

**chat_type vs chat_mode clarification:** Lark uses two different fields:
- Webhook event `im.message.receive_v1`: `chat_type` field — `"p2p"` for DMs, `"group"` for group chats
- REST API `GET /im/v1/chats/:chat_id`: `chat_type` (e.g., `"group"`) AND `chat_mode` (e.g., `"p2p"`, `"group"`, `"topic"`)

Both use `"p2p"` for DMs. To unify: when populating from REST API responses, use `chat_mode` (more specific). When populating from webhook events, use `chat_type`. Store as `chatType` in the cache. The check `chatType === "p2p"` works in both cases.

**State adapter layer:**
- Key: `lark:channel:{chatId}`
- Type: `{ name?: string; chatType?: string }`
- TTL: 8 days

**Write-through sources (no standalone lookupChannel method needed):**
1. **Message events** — `handleMessageEvent` factory extracts `chat_type` from event payload, writes to both layers
2. **fetchThread()** — after calling `api.getChatInfo()`, writes `chat_mode` to both layers as side effect
3. **fetchChannelInfo()** — same as fetchThread

```typescript
// Write-through helper used by all three sources:
private cacheChannelType(chatId: string, chatType: string, name?: string): void {
  this.channelTypeMap.set(chatId, chatType)
  const state = this.chat.getState()
  void state.set(`lark:channel:${chatId}`, { name, chatType }, CHANNEL_CACHE_TTL_MS)
}
```

**Sync readers:**
- `isDM(threadId)`: check `channelTypeMap`, return `chatType === 'p2p'`. If miss, return `false`.
- `getChannelVisibility(threadId)`: check `channelTypeMap`, map to visibility. If miss, return `'unknown'`.

**Cold start limitation (accepted):** `isDM()` may return `false` on cold start before the first message arrives from that chat. This is identical to current behavior and acceptable because Chat SDK uses `fetchThread()` / `fetchChannelInfo()` for authoritative DM detection — `isDM()` is a fast hint, not the source of truth. All official adapters treat `isDM()` the same way (simple sync check).

**Remove:** `dmCache: Set<string>`.

### 5. Permissions

The `getUser` API requires two new scopes to be documented:

| Permission | Description |
|---|---|
| `contact:contact.base:readonly` | Call the contacts API (required for any user lookup) |
| `contact:user.base:readonly` | Access the `name` field in user responses |

A note about contact scope limitations should be added to the README troubleshooting section.

## Constants

```typescript
const USER_CACHE_TTL_MS = 8 * 24 * 60 * 60 * 1000      // 8 days
const CHANNEL_CACHE_TTL_MS = 8 * 24 * 60 * 60 * 1000    // 8 days
const FAILED_LOOKUP_TTL_MS = 1 * 24 * 60 * 60 * 1000    // 1 day
```

## Files Changed

| File | Action | Summary |
|------|--------|---------|
| `src/types.ts` | Edit | Add `logger` to config |
| `src/factory.ts` | Edit | Pass logger through |
| `src/adapter.ts` | Edit | Major: remove dedup/dmCache, add logger init, add lookupUser with two-layer cache, cacheChannelType write-through, message factory pattern, async itemToMessage |
| `src/api-client.ts` | Edit | Add `getUser()` method |
| `src/dedup-cache.ts` | Delete | No longer needed |
| `tests/dedup-cache.test.ts` | Delete | No longer needed |
| `tests/adapter.test.ts` | Edit | Remove dedup tests, add cache tests |
| `README.md` | Edit | Add logger to config table, add contact permissions, add contact scope troubleshooting |

## Testing Strategy

- **lookupUser:** Mock state adapter `get/set`, mock `api.getUser()`. Verify in-memory hit skips state. Verify state hit skips API. Verify cache miss calls API and writes both layers. Verify failure caches with short TTL. Verify mentions seed both layers.
- **cacheChannelType:** Verify write-through from message events, fetchThread, fetchChannelInfo.
- **isDM / getChannelVisibility:** Verify they read from local channelTypeMap. Verify map is populated from message events and fetch methods.
- **itemToMessage:** Verify it calls lookupUser and resolves author names.
- **Logger:** Verify config logger is used. Verify default ConsoleLogger when not provided.
- **Dedup removal:** Verify duplicate events are forwarded (no adapter-level filtering).

## Not In Scope

- Reverse user name index (Lark uses `open_id` for mentions, not display names)
- Thread participant tracking
- Multi-workspace / ISV token storage (future work)
- User avatar enrichment beyond name
