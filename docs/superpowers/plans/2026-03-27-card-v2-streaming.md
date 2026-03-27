# Card V2 + Native Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade card output to v2 JSON structure and replace placeholder+edit streaming with CardKit native streaming API.

**Architecture:** Bottom-up refactor in 4 layers: types, card-mapper, api-client, adapter. Each layer is independently testable. Tests are updated alongside each layer.

**Tech Stack:** TypeScript, `@larksuiteoapi/node-sdk` v1.60.0 (CardKit API), vitest, msw

**Spec:** `docs/superpowers/specs/2026-03-27-card-v2-streaming-design.md`

---

### Task 1: Update types.ts — add CardKit types

**Files:**

- Modify: `src/types.ts`

- [ ] **Step 1: Add CardKitCard interface**

Add after the `LarkRawMessage` interface:

```ts
/** Tracks a CardKit card entity for streaming and updates. */
export interface CardKitCard {
  cardId: string
  elementId: string
}
```

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add CardKitCard type for streaming support"
```

---

### Task 2: Rewrite card-mapper.ts to v2 structure

**Files:**

- Modify: `src/card-mapper.ts`
- Modify: `tests/card-mapper.test.ts`

- [ ] **Step 1: Rewrite card-mapper.ts**

Replace the entire file with:

```ts
/** Minimal shapes for card elements (JSX components, not importable as types). */
interface CardChild {
  alt?: string
  children?: CardChild[]
  content?: string
  disabled?: boolean
  id?: string
  label?: string
  style?: string
  subtitle?: string
  title?: string
  type: string
  url?: string
  value?: unknown
}

type LarkElement = Record<string, unknown>

let elementCounter = 0

const resetElementCounter = (): void => {
  elementCounter = 0
}

const nextElementId = (): string => `el_${String(elementCounter++)}`

const buttonType = (style: string | undefined): string => {
  if (style === 'danger') {
    return 'danger'
  }
  if (style === 'secondary') {
    return 'default'
  }
  return 'primary'
}

const mapButton = (btn: CardChild): LarkElement => {
  const el: LarkElement = {
    element_id: nextElementId(),
    tag: 'button',
    text: { content: btn.label, tag: 'plain_text' },
    type: buttonType(btn.style),
  }
  if (btn.value != null) {
    el['behaviors'] = [{ type: 'callback', value: { action: String(btn.value) } }]
  }
  return el
}

const mapSection = (el: CardChild): LarkElement | null => {
  const texts = (el.children ?? [])
    .map((child) => {
      if ('content' in child) {
        return child.content
      }
      return null
    })
    .filter(Boolean)
    .join('\n')
  if (!texts) {
    return null
  }
  return { content: texts, element_id: nextElementId(), tag: 'markdown' }
}

const mapChild = (child: CardChild): LarkElement | LarkElement[] | null => {
  switch (child.type) {
    case 'text':
      return { content: child.content, element_id: nextElementId(), tag: 'markdown' }
    case 'divider':
      return { element_id: nextElementId(), tag: 'hr' }
    case 'image':
      return {
        alt: { content: child.alt ?? '', tag: 'plain_text' },
        element_id: nextElementId(),
        img_key: child.url,
        tag: 'img',
      }
    case 'actions':
      return (child.children ?? []).map((btn) => mapButton(btn))
    case 'section':
      return mapSection(child)
    default: {
      if ('content' in child && child.content) {
        return { content: child.content as string, element_id: nextElementId(), tag: 'markdown' }
      }
      return null
    }
  }
}

const cardToLarkInteractive = (card: CardChild): Record<string, unknown> => {
  resetElementCounter()
  const elements = (card.children ?? []).flatMap((child) => {
    const result = mapChild(child)
    if (Array.isArray(result)) {
      return result
    }
    return result ? [result] : []
  })
  const result: Record<string, unknown> = {
    body: { elements },
    config: { update_multi: true },
    schema: '2.0',
  }
  if (card.title) {
    result['header'] = { template: 'blue', title: { content: card.title, tag: 'plain_text' } }
  }
  return result
}

const cardToFallbackText = (card: CardChild): string => {
  const parts: string[] = []
  if (card.title) {
    parts.push(`**${card.title}**`)
  }
  if (card.subtitle) {
    parts.push(card.subtitle)
  }
  for (const child of card.children ?? []) {
    if (child.type === 'text') {
      parts.push(child.content ?? '')
    }
  }
  return parts.join('\n')
}

const cardMapper = { cardToFallbackText, cardToLarkInteractive }

export default cardMapper
```

Key changes from v1:

- `schema: "2.0"` and `config: { update_multi: true }` at top level.
- `element_id` auto-generated on every element.
- `actions` case now returns flattened button array (no `action` wrapper).
- `mapActions()` removed entirely.
- Button `value` uses `behaviors` array instead of raw `value` object.
- Uses `flatMap` instead of `map` + `filter` to handle flattened button arrays.

- [ ] **Step 2: Update card-mapper.test.ts**

Replace the entire test file with:

```ts
import { describe, expect, it } from 'vitest'
import cardMapper from '../src/card-mapper.ts'

const { cardToFallbackText, cardToLarkInteractive } = cardMapper

const FIRST = 0

type LarkEl = { tag: string } & Record<string, unknown>
type LarkCard = { body: { elements: LarkEl[] }; config: Record<string, unknown>; schema: string }

const byTag = (tag: string) => (el: { tag: string }) => el.tag === tag

describe('cardToLarkInteractive', () => {
  it('outputs schema 2.0 and config', () => {
    const card = { children: [], type: 'card' as const }
    const result = cardToLarkInteractive(card) as LarkCard
    expect(result.schema).toBe('2.0')
    expect(result.config).toMatchObject({ update_multi: true })
  })

  it('card with text has element_id on markdown element', () => {
    const card = {
      children: [{ content: 'Hello **world**', style: undefined, type: 'text' as const }],
      type: 'card' as const,
    }
    const result = cardToLarkInteractive(card) as LarkCard
    const mdEl = result.body.elements.find(byTag('markdown')) as LarkEl
    expect(mdEl).toBeDefined()
    expect(mdEl.content).toBe('Hello **world**')
    expect(mdEl.element_id).toMatch(/^el_/)
  })

  it('card with divider has element_id on hr element', () => {
    const card = {
      children: [{ type: 'divider' as const }],
      type: 'card' as const,
    }
    const result = cardToLarkInteractive(card) as LarkCard
    const hrEl = result.body.elements.find(byTag('hr'))
    expect(hrEl).toBeDefined()
    expect(hrEl).toHaveProperty('element_id')
  })

  it('card with buttons flattens to standalone button elements (no action wrapper)', () => {
    const card = {
      children: [
        {
          children: [
            {
              disabled: false,
              id: 'btn1',
              label: 'Click me',
              style: 'primary' as const,
              type: 'button' as const,
              value: undefined,
            },
          ],
          type: 'actions' as const,
        },
      ],
      type: 'card' as const,
    }
    const result = cardToLarkInteractive(card) as LarkCard
    const { elements } = result.body
    // No action wrapper
    expect(elements.find(byTag('action'))).toBeUndefined()
    // Button is directly in elements
    const btnEl = elements.find(byTag('button')) as LarkEl
    expect(btnEl).toBeDefined()
    expect((btnEl.text as LarkEl).content).toBe('Click me')
    expect(btnEl.element_id).toMatch(/^el_/)
  })

  it('button with value uses behaviors array', () => {
    const card = {
      children: [
        {
          children: [
            {
              label: 'Do it',
              style: 'primary' as const,
              type: 'button' as const,
              value: 'my_action',
            },
          ],
          type: 'actions' as const,
        },
      ],
      type: 'card' as const,
    }
    const result = cardToLarkInteractive(card) as LarkCard
    const btnEl = result.body.elements.find(byTag('button')) as LarkEl
    expect(btnEl.behaviors).toEqual([{ type: 'callback', value: { action: 'my_action' } }])
  })

  it('card with image has element_id on img element', () => {
    const card = {
      children: [{ alt: 'A photo', type: 'image' as const, url: 'img_key_123' }],
      type: 'card' as const,
    }
    const result = cardToLarkInteractive(card) as LarkCard
    const imgEl = result.body.elements.find(byTag('img')) as LarkEl
    expect(imgEl).toBeDefined()
    expect(imgEl.img_key).toBe('img_key_123')
    expect(imgEl.element_id).toMatch(/^el_/)
  })

  it('unknown component degrades to markdown if content exists', () => {
    const card = {
      children: [
        {
          children: [{ content: 'section text', style: undefined, type: 'text' as const }],
          type: 'section' as const,
        },
      ],
      type: 'card' as const,
    }
    const result = cardToLarkInteractive(card) as LarkCard
    const mdEl = result.body.elements.find(byTag('markdown'))
    expect(mdEl).toBeDefined()
    expect(mdEl).toHaveProperty('element_id')
  })

  it('header includes title with template', () => {
    const card = {
      children: [],
      title: 'Test Card',
      type: 'card' as const,
    }
    const result = cardToLarkInteractive(card) as Record<string, unknown>
    expect(result.header).toMatchObject({
      template: 'blue',
      title: { content: 'Test Card', tag: 'plain_text' },
    })
  })
})

describe('cardToFallbackText', () => {
  it('extracts title and all text content', () => {
    const card = {
      children: [
        { content: 'Body text here', style: undefined, type: 'text' as const },
        { type: 'divider' as const },
      ],
      subtitle: 'A subtitle',
      title: 'My Card',
      type: 'card' as const,
    }
    const result = cardToFallbackText(card)
    expect(result).toContain('My Card')
    expect(result).toContain('Body text here')
  })
})
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/card-mapper.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Run lint and format**

Run: `bun run fmt && bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/card-mapper.ts tests/card-mapper.test.ts
git commit -m "feat: rewrite card-mapper to output v2 JSON structure"
```

---

### Task 3: Add CardKit methods to api-client.ts

**Files:**

- Modify: `src/api-client.ts`
- Modify: `tests/api-client.test.ts`

- [ ] **Step 1: Add CardKit methods to api-client.ts**

Add these three methods to the `LarkApiClient` class, before the `private async call` method:

```ts
  async createCard(cardJson: string) {
    return this.call(() =>
      this.client.cardkit.card.create({
        data: { data: cardJson, type: 'card_json' },
      }),
    )
  }

  async streamUpdateText(cardId: string, elementId: string, content: string, sequence: number) {
    return this.call(() =>
      this.client.cardkit.card.element.content({
        data: { content, sequence },
        path: { card_id: cardId, element_id: elementId },
      }),
    )
  }

  async updateCardSettings(cardId: string, settings: string, sequence: number) {
    return this.call(() =>
      this.client.cardkit.card.settings({
        data: { sequence, settings },
        path: { card_id: cardId },
      }),
    )
  }
```

- [ ] **Step 2: Add CardKit tests to api-client.test.ts**

Add the following test cases inside the existing `describe('LarkApiClient', ...)` block, before the closing `})`:

```ts
it('createCard — creates card entity', async () => {
  let captured: unknown = undefined
  server.use(
    tokenHandler,
    http.post(`${BASE}/open-apis/cardkit/v1/cards`, async ({ request }) => {
      captured = await request.json()
      return HttpResponse.json({ code: 0, data: { card_id: 'card_001' } })
    }),
  )

  const client = makeClient()
  const result = await client.createCard('{"schema":"2.0"}')

  expect(captured).toMatchObject({ data: '{"schema":"2.0"}', type: 'card_json' })
  expect(result).toMatchObject({ data: { card_id: 'card_001' } })
})

it('streamUpdateText — streams text to element', async () => {
  let captured: unknown = undefined
  server.use(
    tokenHandler,
    http.put(
      `${BASE}/open-apis/cardkit/v1/cards/:cardId/elements/:elementId/content`,
      async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json({ code: 0, data: {} })
      },
    ),
  )

  const client = makeClient()
  await client.streamUpdateText('card_001', 'stream_md', 'Hello world', 1)

  expect(captured).toMatchObject({ content: 'Hello world', sequence: 1 })
})

it('updateCardSettings — updates card config', async () => {
  let captured: unknown = undefined
  server.use(
    tokenHandler,
    http.patch(`${BASE}/open-apis/cardkit/v1/cards/:cardId/settings`, async ({ request }) => {
      captured = await request.json()
      return HttpResponse.json({ code: 0, data: {} })
    }),
  )

  const client = makeClient()
  await client.updateCardSettings('card_001', '{"config":{"streaming_mode":false}}', 2)

  expect(captured).toMatchObject({
    sequence: 2,
    settings: '{"config":{"streaming_mode":false}}',
  })
})
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/api-client.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Run lint and format**

Run: `bun run fmt && bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api-client.ts tests/api-client.test.ts
git commit -m "feat: add CardKit API methods (createCard, streamUpdateText, updateCardSettings)"
```

---

### Task 4: Rewrite adapter.ts — card sending and streaming

**Files:**

- Modify: `src/adapter.ts`

- [ ] **Step 1: Update imports and remove old streaming constants**

In `src/adapter.ts`, remove these two constants:

```ts
const STREAM_THROTTLE_MS = 400
const STREAM_PLACEHOLDER = '...'
```

Add a new constant:

```ts
const STREAM_ELEMENT_ID = 'stream_md'
const INITIAL_SEQUENCE = 1
```

- [ ] **Step 2: Rewrite renderCardMessage to return raw v2 JSON object**

Replace `renderCardMessage`:

```ts
const renderCardMessage = (message: AdapterPostableMessage): Record<string, unknown> | null => {
  const card = extractCard(message)
  if (!card) {
    return null
  }
  return cardMapper.cardToLarkInteractive(card)
}
```

Note: return type changed from `{ content, msgType }` to raw object. This is needed because card sending now goes through `createCard` → `card_id` path.

- [ ] **Step 3: Update postMessage to use card_id path for cards**

Replace the `postMessage` method:

```ts
  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<LarkRawMessage>> {
    const decoded = this.decodeThreadId(threadId)
    const files = extractFiles(message)
    const fileResults = await Promise.all(
      files.map((file) => this.uploadAndSendFile(decoded, file)),
    )
    const lastFileResult = fileResults.at(LAST_INDEX) ?? null

    const cardJson = renderCardMessage(message)
    const textResult = cardJson
      ? await this.sendCardMessage(decoded, cardJson)
      : await this.sendTextMessage(decoded, message)

    const finalResult = lastFileResult ?? textResult
    const data = finalResult as { data?: { message_id?: string } }
    return { id: data.data?.message_id ?? '', raw: finalResult as LarkRawMessage, threadId }
  }
```

Add two new private helpers:

```ts
  private async sendCardMessage(
    decoded: LarkThreadId,
    cardJson: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await this.api.createCard(JSON.stringify(cardJson))
    const cardData = res as { data?: { card_id?: string } }
    const cardId = cardData.data?.card_id ?? ''
    const content = JSON.stringify({ data: { card_id: cardId }, type: 'card' })
    return this.sendOrReply(decoded, 'interactive', content)
  }

  private async sendTextMessage(
    decoded: LarkThreadId,
    message: AdapterPostableMessage,
  ): Promise<unknown> {
    const { content, msgType } = renderMessage(message, this.converter)
    return this.sendOrReply(decoded, msgType, content)
  }
```

Update `renderMessage` to skip card rendering (since cards are handled separately now):

```ts
const renderMessage = (
  message: AdapterPostableMessage,
  converter: LarkFormatConverter,
): { content: string; msgType: string } => {
  if (typeof message === 'string') {
    return converter.renderForSend({ text: message })
  }
  return renderObjectMessage(message, converter)
}
```

- [ ] **Step 4: Rewrite stream() method**

Replace the `stream()` method and remove `throttledEdit()`:

```ts
  // -- Streaming (7G) --

  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
  ): Promise<RawMessage<LarkRawMessage>> {
    const decoded = this.decodeThreadId(threadId)
    const { cardId, messageId } = await this.createStreamingCard(decoded)
    let sequence = INITIAL_SEQUENCE
    let accumulated = ''

    try {
      for await (const chunk of textStream) {
        accumulated += chunkToText(chunk)
        await this.api.streamUpdateText(cardId, STREAM_ELEMENT_ID, accumulated, sequence++)
      }
    } finally {
      const settings = JSON.stringify({ config: { streaming_mode: false } })
      await this.api.updateCardSettings(cardId, settings, sequence)
    }

    return { id: messageId, raw: {} as LarkRawMessage, threadId }
  }

  private async createStreamingCard(
    decoded: LarkThreadId,
  ): Promise<{ cardId: string; messageId: string }> {
    const cardJson: Record<string, unknown> = {
      body: {
        elements: [{ content: '', element_id: STREAM_ELEMENT_ID, tag: 'markdown' }],
      },
      config: { streaming_mode: true, update_multi: true },
      schema: '2.0',
    }
    const res = await this.api.createCard(JSON.stringify(cardJson))
    const cardData = res as { data?: { card_id?: string } }
    const cardId = cardData.data?.card_id ?? ''
    const content = JSON.stringify({ data: { card_id: cardId }, type: 'card' })
    const sendRes = await this.sendOrReply(decoded, 'interactive', content)
    const msgData = sendRes as { data?: { message_id?: string } }
    return { cardId, messageId: msgData.data?.message_id ?? '' }
  }
```

- [ ] **Step 5: Remove throttledEdit method**

Delete the `throttledEdit` private method entirely (lines ~603-613 in original).

- [ ] **Step 6: Run lint and format**

Run: `bun run fmt && bun run lint`
Expected: PASS (some tests may fail, that's ok — we fix tests in the next task)

- [ ] **Step 7: Commit**

```bash
git add src/adapter.ts
git commit -m "feat: rewrite card sending via card_id and streaming via CardKit API"
```

---

### Task 5: Update adapter tests

**Files:**

- Modify: `tests/adapter.test.ts`
- Modify: `tests/integration.test.ts`

- [ ] **Step 1: Add CardKit MSW handlers to adapter.test.ts**

At the top of `tests/adapter.test.ts`, add the cardkit handlers after the existing `botInfoHandler`:

```ts
const createCardHandler = http.post(`${BASE}/open-apis/cardkit/v1/cards`, () =>
  HttpResponse.json({ code: 0, data: { card_id: 'card_test_001' } }),
)

const streamUpdateHandler = http.put(
  `${BASE}/open-apis/cardkit/v1/cards/:cardId/elements/:elementId/content`,
  () => HttpResponse.json({ code: 0, data: {} }),
)

const updateSettingsHandler = http.patch(
  `${BASE}/open-apis/cardkit/v1/cards/:cardId/settings`,
  () => HttpResponse.json({ code: 0, data: {} }),
)
```

Update `initAdapter` to include the card handler:

```ts
const initAdapter = async (adapter: LarkAdapter) => {
  const mockChat = makeMockChat()
  server.use(tokenHandler, botInfoHandler, createCardHandler)
  await adapter.initialize(mockChat as never)
  return mockChat
}
```

- [ ] **Step 2: Update postMessage card test**

Find the test `'postMessage with card sends msg_type interactive'` and replace it:

```ts
it('postMessage with card sends via card_id', async () => {
  let captured = undefined as unknown
  server.use(
    tokenHandler,
    createCardHandler,
    http.post(`${BASE}/open-apis/im/v1/messages`, async ({ request }) => {
      captured = await request.json()
      return HttpResponse.json({ code: 0, data: { message_id: 'om_card1' } })
    }),
  )
  const card = {
    children: [],
    title: 'Test Card',
    type: 'card' as const,
  }
  const threadId = adapter.encodeThreadId({ chatId: 'oc_chat001' })
  const result = await adapter.postMessage(threadId, card)
  expect(captured).toMatchObject({ msg_type: 'interactive' })
  const content = JSON.parse((captured as { content: string }).content)
  expect(content).toMatchObject({ type: 'card', data: { card_id: 'card_test_001' } })
  expect(result.id).toBe('om_card1')
})
```

- [ ] **Step 3: Rewrite streaming tests**

Replace the entire `describe('stream', ...)` block:

```ts
describe('stream', () => {
  let adapter = undefined as unknown as LarkAdapter

  beforeEach(async () => {
    adapter = makeAdapter()
    await initAdapter(adapter)
  })

  it('creates streaming card, sends updates, then closes streaming', async () => {
    const streamUpdates: Array<{ content: string; sequence: number }> = []
    let settingsCaptured = undefined as unknown

    server.use(
      tokenHandler,
      createCardHandler,
      http.post(`${BASE}/open-apis/im/v1/messages`, () =>
        HttpResponse.json({ code: 0, data: { message_id: 'om_stream1' } }),
      ),
      http.put(
        `${BASE}/open-apis/cardkit/v1/cards/:cardId/elements/:elementId/content`,
        async ({ request }) => {
          const body = (await request.json()) as { content: string; sequence: number }
          streamUpdates.push(body)
          return HttpResponse.json({ code: 0, data: {} })
        },
      ),
      http.patch(`${BASE}/open-apis/cardkit/v1/cards/:cardId/settings`, async ({ request }) => {
        settingsCaptured = await request.json()
        return HttpResponse.json({ code: 0, data: {} })
      }),
    )

    const chunks = ['Hello', ' World', '!']
    const gen = async function* streamChunks() {
      for (const ch of chunks) {
        yield ch
      }
    }

    const threadId = adapter.encodeThreadId({ chatId: 'oc_chat001' })
    const result = await adapter.stream(threadId, gen())

    expect(result.id).toBe('om_stream1')
    // Each chunk produces a stream update with accumulated text
    expect(streamUpdates).toHaveLength(chunks.length)
    expect(streamUpdates[streamUpdates.length - 1].content).toBe('Hello World!')
    // Sequences are strictly incrementing
    expect(streamUpdates.map((u) => u.sequence)).toEqual([1, 2, 3])
    // Streaming mode closed after
    expect(settingsCaptured).toMatchObject({
      settings: expect.stringContaining('streaming_mode'),
    })
  })

  it('closes streaming mode even on stream error', async () => {
    let settingsClosed = false

    server.use(
      tokenHandler,
      createCardHandler,
      http.post(`${BASE}/open-apis/im/v1/messages`, () =>
        HttpResponse.json({ code: 0, data: { message_id: 'om_stream2' } }),
      ),
      http.put(`${BASE}/open-apis/cardkit/v1/cards/:cardId/elements/:elementId/content`, () =>
        HttpResponse.json({ code: 0, data: {} }),
      ),
      http.patch(`${BASE}/open-apis/cardkit/v1/cards/:cardId/settings`, () => {
        settingsClosed = true
        return HttpResponse.json({ code: 0, data: {} })
      }),
    )

    const gen = async function* streamChunks() {
      yield 'partial'
      throw new Error('stream broke')
    }

    const threadId = adapter.encodeThreadId({ chatId: 'oc_chat001' })
    await expect(adapter.stream(threadId, gen())).rejects.toThrow('stream broke')
    expect(settingsClosed).toBe(true)
  })
})
```

- [ ] **Step 4: Update integration.test.ts streaming test**

In `tests/integration.test.ts`, add CardKit handlers and update the streaming test. Add at the top with other handlers:

```ts
const createCardHandler = http.post(`${BASE}/open-apis/cardkit/v1/cards`, () =>
  HttpResponse.json({ code: 0, data: { card_id: 'card_int_001' } }),
)
```

Update `initAdapter` to include `createCardHandler`.

Replace the streaming integration test:

```ts
it('streaming: creates card entity, streams text, closes streaming mode', async () => {
  const adapter = makeAdapter()
  await initAdapter(adapter)
  const streamUpdates: string[] = []

  server.use(
    tokenHandler,
    createCardHandler,
    http.post(`${BASE}/open-apis/im/v1/messages`, () =>
      HttpResponse.json({ code: 0, data: { message_id: 'om_stream1' } }),
    ),
    http.put(
      `${BASE}/open-apis/cardkit/v1/cards/:cardId/elements/:elementId/content`,
      async ({ request }) => {
        const body = (await request.json()) as { content: string }
        streamUpdates.push(body.content)
        return HttpResponse.json({ code: 0, data: {} })
      },
    ),
    http.patch(`${BASE}/open-apis/cardkit/v1/cards/:cardId/settings`, () =>
      HttpResponse.json({ code: 0, data: {} }),
    ),
  )

  const threadId = adapter.encodeThreadId({ chatId: 'oc_chat001' })
  const result = await adapter.stream(threadId, makeStreamChunks())
  expect(result.id).toBe('om_stream1')
  expect(streamUpdates[streamUpdates.length - LAST_INDEX_OFFSET]).toContain('Hello world!')
})
```

Remove `setupStreamHandlers`, `assertStreamResult`, and `placeholderRef` helpers that are no longer needed.

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 6: Run lint and format**

Run: `bun run fmt && bun run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/adapter.test.ts tests/integration.test.ts
git commit -m "test: update all tests for card v2 and CardKit streaming"
```

---

### Task 6: Final cleanup and verification

**Files:**

- Verify: all `src/` and `tests/` files

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 3: Verify no references to removed code**

Search for removed patterns to ensure clean removal:

```bash
grep -r "STREAM_THROTTLE" src/ tests/
grep -r "STREAM_PLACEHOLDER" src/ tests/
grep -r "throttledEdit" src/ tests/
grep -r "mapActions" src/ tests/
grep -r "tag.*action" src/card-mapper.ts
```

Expected: No matches for any of these.

- [ ] **Step 4: Commit any remaining fixes**

If any issues found in steps 1-3, fix and commit.
