# Align with Official Adapter Patterns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align chat-adapter-lark with official Chat SDK adapter patterns: logger injection, remove adapter-level dedup, user/channel caching via state adapter.

**Architecture:** Four independent changes applied sequentially: (1) logger injection via config, (2) remove DedupCache, (3) user info two-layer cache with API resolution, (4) channel info two-layer cache replacing in-memory dmCache. Each task is independently testable and committable.

**Tech Stack:** TypeScript, vitest, msw (mock service worker), Chat SDK (`chat` package), Lark SDK (`@larksuiteoapi/node-sdk`)

**Spec:** `docs/superpowers/specs/2026-03-31-align-official-adapter-patterns.md`

**Commands:**
- Format: `bun run fmt`
- Lint: `bun run lint`
- Test: `bun run test`

---

### Task 1: Logger Injection

**Files:**
- Modify: `src/types.ts:1` (import Logger type, add to config)
- Modify: `src/factory.ts:33` (pass logger through)
- Modify: `src/adapter.ts:221-265` (constructor + initialize)
- Modify: `tests/adapter.test.ts:49-82` (update makeAdapter + makeMockChat)
- Modify: `README.md:118-131` (config table)

- [ ] **Step 1: Add `logger` to `LarkAdapterConfig`**

In `src/types.ts`, add import and field:

```typescript
import type { AppType, Cache, Domain, HttpInstance } from '@larksuiteoapi/node-sdk'
import type { Logger } from 'chat'
```

Add to `LarkAdapterConfig`:
```typescript
  /** Custom logger instance (defaults to ConsoleLogger) */
  logger?: Logger
```

- [ ] **Step 2: Pass logger through factory**

In `src/factory.ts`, add to the return object in `resolveConfig`:
```typescript
    ...(config?.logger !== undefined && { logger: config.logger }),
```

- [ ] **Step 3: Update adapter constructor and initialize**

In `src/adapter.ts`:

Add import:
```typescript
import { ConsoleLogger } from 'chat'
```

Change field declaration from `private logger!: Logger` to `private readonly logger: Logger`.

Update constructor to initialize logger:
```typescript
  constructor(config: LarkAdapterConfig) {
    this.config = config
    this.logger = config.logger ?? new ConsoleLogger('info').child('lark')
    this.resolvedUserName = config.userName ?? 'LarkBot'
    // ... rest unchanged
  }
```

In `initialize()`, remove `this.logger = chat.getLogger(ADAPTER_NAME)`. The config logger is used for the entire lifecycle.

Also remove `?.` optional chaining on all `this.logger` calls (e.g., `this.logger?.warn?.()` → `this.logger.warn()`), since logger is now always initialized in the constructor.

- [ ] **Step 4: Update test helper**

In `tests/adapter.test.ts`, `makeMockChat` no longer needs `getLogger`. Remove it (adapter no longer calls `chat.getLogger()`).

The `makeAdapter()` helper doesn't need changes — the adapter will use the default ConsoleLogger.

- [ ] **Step 5: Update README config table**

Add to the config table:
```
| `logger`          | `Logger`       | `ConsoleLogger`           | Custom logger instance (from `chat` package)     |
```

- [ ] **Step 6: Format, lint, test, commit**

```bash
bun run fmt && bun run lint && bun run test
git add src/types.ts src/factory.ts src/adapter.ts tests/adapter.test.ts README.md
git commit -m "feat: accept logger via config, default to ConsoleLogger"
```

---

### Task 2: Remove DedupCache

**Files:**
- Delete: `src/dedup-cache.ts`
- Delete: `tests/dedup-cache.test.ts`
- Modify: `src/adapter.ts:58,232,272,693-699` (remove dedup usage)
- Modify: `tests/adapter.test.ts` (remove dedup tests)

- [ ] **Step 1: Remove dedup from adapter**

In `src/adapter.ts`:

Remove import:
```typescript
import { DedupCache } from './dedup-cache.ts'
```

Remove constant:
```typescript
const DEDUP_CAPACITY = 500
```

Remove field:
```typescript
private readonly dedup = new DedupCache(DEDUP_CAPACITY)
```

Remove helper:
```typescript
const extractEventId = (body: LarkWebhookBody): string | undefined => body.header?.event_id
```

Simplify `handleEvent()` — remove the dedup check block entirely:
```typescript
  private handleEvent(body: LarkWebhookBody, options?: WebhookOptions): Response {
    if (body.header?.event_type === 'card.action.trigger') {
      this.handleCardAction(body as LarkCardActionBody, options)
    } else {
      this.dispatchEvent(body, options)
    }
    return new Response('ok', { status: 200 })
  }
```

Update `disconnect()` — remove `this.dedup.clear()`. It will be updated in Task 4 to clear `channelTypeMap`.

- [ ] **Step 2: Delete dedup files**

```bash
rm src/dedup-cache.ts tests/dedup-cache.test.ts
```

- [ ] **Step 3: Remove dedup tests from adapter.test.ts**

Remove the two dedup test cases:
- `'deduplicates events by event_id'`
- `'deduplicates card action events'`

- [ ] **Step 4: Format, lint, test, commit**

```bash
bun run fmt && bun run lint && bun run test
git add -A
git commit -m "refactor: remove DedupCache, delegate dedup to Chat SDK"
```

---

### Task 3: User Info Cache (lookupUser)

**Files:**
- Modify: `src/api-client.ts` (add `getUser` method)
- Modify: `src/adapter.ts` (add cache fields, `lookupUser`, refactor message/reaction handlers, async `itemToMessage`)
- Modify: `tests/adapter.test.ts` (add state mock, update message/reaction/fetch tests)
- Modify: `README.md` (permissions + troubleshooting)

- [ ] **Step 1: Add `getUser` to LarkApiClient**

In `src/api-client.ts`, add after `getBotInfo()`:

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

- [ ] **Step 2: Add cache constants and fields to adapter**

In `src/adapter.ts`, add constants:
```typescript
const USER_CACHE_TTL_MS = 8 * 24 * 60 * 60 * 1000
const FAILED_LOOKUP_TTL_MS = 1 * 24 * 60 * 60 * 1000
```

Add field to `LarkAdapter`:
```typescript
private readonly userNameCache = new Map<string, string>()
```

- [ ] **Step 3: Implement `lookupUser`**

Add private method to `LarkAdapter`:

```typescript
  private async lookupUser(openId: string): Promise<string> {
    const memCached = this.userNameCache.get(openId)
    if (memCached) return memCached

    const state = this.chat.getState()
    const cacheKey = `lark:user:${openId}`
    const cached = await state.get<{ name: string }>(cacheKey)
    if (cached) {
      this.userNameCache.set(openId, cached.name)
      return cached.name
    }

    try {
      const res = await this.api.getUser(openId)
      const name = (res as { data?: { user?: { name?: string } } }).data?.user?.name ?? openId
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

- [ ] **Step 4: Refactor `handleMessageEvent` to use factory**

Replace the current `handleMessageEvent`:

```typescript
  private handleMessageEvent(data: EventData<'im.message.receive_v1'>): void {
    if (!data?.message) {
      return
    }
    const msg = data.message
    const options = this.pendingWebhookOptions
    const threadId = this.encodeThreadId({
      chatId: msg.chat_id,
      rootMessageId: msg.root_id || undefined,
    })

    const factory = async (): Promise<Message<LarkRaw>> => {
      // Seed user cache from mentions (free data)
      const state = this.chat.getState()
      for (const mention of msg.mentions ?? []) {
        if (mention.name && mention.id?.open_id) {
          this.userNameCache.set(mention.id.open_id, mention.name)
          void state.set(`lark:user:${mention.id.open_id}`, { name: mention.name }, USER_CACHE_TTL_MS)
        }
      }

      const openId = data.sender.sender_id?.open_id ?? ''
      const resolvedName = openId ? await this.lookupUser(openId) : ''
      const message = this.parseMessage(data)
      if (resolvedName) {
        message.author.fullName = resolvedName
        message.author.userName = resolvedName
      }
      return message
    }

    this.chat.processMessage(this, threadId, factory, options)
  }
```

- [ ] **Step 5: Enrich reaction events with user name**

Update `handleReactionEvent` to call `lookupUser` inside the async chain:

```typescript
  private handleReactionEvent(
    data: EventData<'im.message.reaction.created_v1'>,
    added: boolean,
  ): void {
    if (!data?.message_id) {
      return
    }
    const options = this.pendingWebhookOptions
    const emojiType = data.reaction_type?.emoji_type ?? ''
    const messageId = data.message_id
    const userId = data.user_id?.open_id ?? ''

    void Promise.all([
      this.resolveReactionThreadId(messageId),
      userId ? this.lookupUser(userId) : Promise.resolve(''),
    ]).then(([threadId, resolvedName]) =>
      this.chat.processReaction(
        {
          adapter: this,
          added,
          emoji: { name: emojiType, toJSON: () => '', toString: () => '' },
          messageId,
          raw: data,
          rawEmoji: emojiType,
          threadId,
          user: {
            fullName: resolvedName || '',
            isBot: 'unknown' as const,
            isMe: false,
            userId,
            userName: resolvedName || '',
          },
        },
        options,
      ),
    )
  }
```

- [ ] **Step 6: Make `itemToMessage` async with user resolution**

Change `itemToMessage` to async:

```typescript
  private async itemToMessage(item: LarkMessageItem, threadId: string): Promise<Message<LarkRaw>> {
    const content = item.body?.content ?? ''
    const sender = item.sender
    const senderId = sender?.id ?? ''
    const resolvedName = senderId ? await this.lookupUser(senderId) : 'unknown'
    const author = sender
      ? {
          fullName: resolvedName,
          isBot: sender.sender_type === 'app',
          isMe: sender.id === this.botOpenId,
          userId: sender.id,
          userName: resolvedName,
        }
      : unknownAuthor()
    return new Message<LarkRaw>({
      attachments: [],
      author,
      formatted: this.converter.toAst(content),
      id: item.message_id ?? '',
      metadata: {
        dateSent: new Date(Number(item.create_time ?? '0')),
        edited: item.updated === true,
      },
      raw: item,
      text: extractText(content),
      threadId,
    })
  }
```

Update all callers to await:
- `fetchMessages`: `const messages = await Promise.all(items.map((item) => this.itemToMessage(item, threadId)))`
- `fetchMessage`: `return this.itemToMessage(item, threadId)` (already in async function)
- `fetchChannelMessages`: same as `fetchMessages`

- [ ] **Step 7: Update `disconnect` to clear user cache**

```typescript
  async disconnect(): Promise<void> {
    this.userNameCache.clear()
  }
```

- [ ] **Step 8: Set up state adapter mock in tests**

In `tests/adapter.test.ts`, update `makeMockChat` to return a state adapter:

```typescript
const makeMockState = () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
})

const makeMockChat = () => {
  const mockState = makeMockState()
  return {
    getState: () => mockState,
    getUserName: () => 'TestBot',
    // ... rest of existing mocks
    _state: mockState, // exposed for test assertions
  }
}
```

Add MSW handler for user API:
```typescript
const userInfoHandler = http.get(`${BASE}/open-apis/contact/v3/users/:userId`, () =>
  HttpResponse.json({ code: 0, data: { user: { name: 'Alice' } } }),
)
```

Add `userInfoHandler` to `initAdapter`'s `server.use(...)`.

- [ ] **Step 9: Update message routing test**

The `'routes message event to processMessage'` test must account for the factory pattern. `processMessage` now receives a factory function as the 3rd argument, not a `Message`:

```typescript
    it('routes message event to processMessage', async () => {
      const adapter = makeAdapter()
      const mockChat = await initAdapter(adapter)

      await adapter.handleWebhook(makeRequest(makeMessageEvent()))
      expect(mockChat.processMessage).toHaveBeenCalledTimes(ONCE)

      const call = mockChat.processMessage.mock.calls[0]!
      expect(call[0]).toBe(adapter) // adapter
      expect(call[1]).toMatch(/^lark:/) // threadId
      expect(typeof call[2]).toBe('function') // factory

      // Execute the factory to get the message
      const message = await call[2]()
      expect(message.text).toBe('hello bot')
      expect(message.author.fullName).toBe('Alice') // resolved via lookupUser
    })
```

- [ ] **Step 10: Add lookupUser cache tests**

```typescript
    describe('lookupUser', () => {
      it('resolves user name from API and caches', async () => {
        const adapter = makeAdapter()
        const mockChat = await initAdapter(adapter)

        await adapter.handleWebhook(makeRequest(makeMessageEvent()))
        const factory = mockChat.processMessage.mock.calls[0]![2]
        await factory()

        // Verify state.set was called with user cache
        const setCalls = mockChat._state.set.mock.calls
        const userSetCall = setCalls.find((c: unknown[]) => (c[0] as string).startsWith('lark:user:'))
        expect(userSetCall).toBeDefined()
        expect(userSetCall![1]).toEqual({ name: 'Alice' })
      })

      it('uses cached name on second call', async () => {
        const adapter = makeAdapter()
        const mockChat = await initAdapter(adapter)
        mockChat._state.get.mockResolvedValueOnce({ name: 'CachedAlice' })

        await adapter.handleWebhook(makeRequest(makeMessageEvent()))
        const factory = mockChat.processMessage.mock.calls[0]![2]
        const message = await factory()

        expect(message.author.fullName).toBe('CachedAlice')
      })
    })
```

- [ ] **Step 11: Update README permissions and troubleshooting**

Add to permissions table:
```markdown
| `contact:contact.base:readonly`    | Call the contacts API (for user name resolution) |
| `contact:user.base:readonly`       | Access user display names                        |
```

Add troubleshooting section:
```markdown
### User names showing as IDs

The adapter resolves user display names via the contacts API. If names show as `ou_xxxxx` IDs:

1. Add `contact:contact.base:readonly` and `contact:user.base:readonly` permissions
2. Expand the app's contact scope (通讯录权限范围) in the Lark admin console to include the users you need
```

- [ ] **Step 12: Format, lint, test, commit**

```bash
bun run fmt && bun run lint && bun run test
git add -A
git commit -m "feat: add user info cache with state adapter persistence"
```

---

### Task 4: Channel Info Cache + DM Persistence

**Files:**
- Modify: `src/adapter.ts` (add channelTypeMap, cacheChannelType, update isDM/getChannelVisibility/fetchThread/fetchChannelInfo/disconnect)
- Modify: `tests/adapter.test.ts` (update DM/visibility tests)

- [ ] **Step 1: Add channel cache constant and field**

In `src/adapter.ts`, add constant:
```typescript
const CHANNEL_CACHE_TTL_MS = 8 * 24 * 60 * 60 * 1000
```

Replace field:
```typescript
// Remove: private readonly dmCache = new Set<string>()
// Add:
private readonly channelTypeMap = new Map<string, string>()
```

- [ ] **Step 2: Add `cacheChannelType` helper**

```typescript
  private cacheChannelType(chatId: string, chatType: string, name?: string): void {
    this.channelTypeMap.set(chatId, chatType)
    const state = this.chat.getState()
    void state.set(`lark:channel:${chatId}`, { name, chatType }, CHANNEL_CACHE_TTL_MS)
  }
```

- [ ] **Step 3: Update `handleMessageEvent` factory to write channel cache**

Inside the factory function in `handleMessageEvent`, after the mentions loop, add:
```typescript
      // Cache channel type from event
      const chatType = msg.chat_type
      if (chatType) {
        this.cacheChannelType(msg.chat_id, chatType)
      }
```

Remove the old `dmCache` write from `parseMessage`:
```typescript
// Remove: if (msg.chat_type === 'p2p') { this.dmCache.add(msg.chat_id) }
```

- [ ] **Step 4: Update `isDM` and `getChannelVisibility`**

```typescript
  isDM(threadId: string): boolean {
    const { chatId } = this.decodeThreadId(threadId)
    return this.channelTypeMap.get(chatId) === 'p2p'
  }

  getChannelVisibility(threadId: string): ChannelVisibility {
    const { chatId } = this.decodeThreadId(threadId)
    const chatType = this.channelTypeMap.get(chatId)
    if (chatType === 'p2p') return 'private'
    if (chatType === 'group') return 'unknown'
    return 'unknown'
  }
```

Remove the old `dmCache`-based implementations.

- [ ] **Step 5: Update `fetchThread` with write-through**

```typescript
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatId } = this.decodeThreadId(threadId)
    const res = await this.api.getChatInfo(chatId)
    const chatType = res.data?.chat_mode ?? res.data?.chat_type
    if (chatType) {
      this.cacheChannelType(chatId, chatType, res.data?.name)
    }
    return {
      channelId: chatId,
      channelName: res.data?.name,
      channelVisibility: mapChatTypeToVisibility(res.data?.chat_type),
      id: threadId,
      isDM: chatType === 'p2p',
      metadata: { raw: res },
    }
  }
```

- [ ] **Step 6: Update `fetchChannelInfo` with write-through**

```typescript
  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const res = await this.api.getChatInfo(channelId)
    const chatType = res.data?.chat_mode ?? res.data?.chat_type
    if (chatType) {
      this.cacheChannelType(channelId, chatType, res.data?.name)
    }
    return {
      channelVisibility: mapChatTypeToVisibility(res.data?.chat_type),
      id: channelId,
      isDM: chatType === 'p2p',
      memberCount: parseMemberCount(res.data),
      metadata: { raw: res },
      name: res.data?.name,
    }
  }
```

- [ ] **Step 7: Update `disconnect`**

```typescript
  async disconnect(): Promise<void> {
    this.userNameCache.clear()
    this.channelTypeMap.clear()
  }
```

- [ ] **Step 8: Update tests**

Add channel info handler in MSW setup:
```typescript
const chatInfoHandler = http.get(`${BASE}/open-apis/im/v1/chats/:chatId`, () =>
  HttpResponse.json({
    code: 0,
    data: { chat_mode: 'group', chat_type: 'group', name: 'Test Group' },
  }),
)
```

Update `isDM` tests to verify behavior after message receipt:
```typescript
    it('isDM returns true after receiving a p2p message', async () => {
      const adapter = makeAdapter()
      const mockChat = await initAdapter(adapter)

      const event = makeMessageEvent({ chat_type: 'p2p' })
      await adapter.handleWebhook(makeRequest(event))

      // Execute factory to trigger cache write
      const factory = mockChat.processMessage.mock.calls[0]![2]
      await factory()

      const threadId = adapter.encodeThreadId({ chatId: 'oc_chat001' })
      expect(adapter.isDM(threadId)).toBe(true)
    })
```

Verify `fetchThread` populates channelTypeMap:
```typescript
    it('fetchThread populates channel cache', async () => {
      const adapter = makeAdapter()
      await initAdapter(adapter)
      server.use(chatInfoHandler)

      const threadId = adapter.encodeThreadId({ chatId: 'oc_chat001' })
      await adapter.fetchThread(threadId)

      expect(adapter.getChannelVisibility(threadId)).not.toBe('unknown')
    })
```

- [ ] **Step 9: Format, lint, test, commit**

```bash
bun run fmt && bun run lint && bun run test
git add -A
git commit -m "feat: add channel info cache with state adapter persistence"
```

---

### Task 5: Final Cleanup

**Files:**
- Modify: `src/adapter.ts` (remove unused imports/constants)
- Modify: `src/index.ts` (verify exports)

- [ ] **Step 1: Clean up unused imports and constants**

In `src/adapter.ts`, remove if no longer used after all tasks:
- `CARD_ACTION_EVENT_TYPE` constant (inline as `'card.action.trigger'`)
- Any remaining references to deleted code

Verify `src/index.ts` no longer exports `DedupCache` (it shouldn't — it was never exported).

- [ ] **Step 2: Full test run and final commit**

```bash
bun run fmt && bun run lint && bun run test
git add -A
git commit -m "chore: clean up unused code after adapter alignment"
```
