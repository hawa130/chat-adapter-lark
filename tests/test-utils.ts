import type { ActionEvent, Message, ReactionEvent, Thread } from 'chat'
import { Chat } from 'chat'
import { createMemoryState } from '@chat-adapter/state-memory'
import { HttpResponse, http } from 'msw'
import createLarkAdapter from '../src/factory.ts'
import fixtures from './fixtures.ts'
import server from './setup.ts'

const { makeRequest } = fixtures

const BASE = 'https://open.feishu.cn'
const TOKEN_URL = `${BASE}/open-apis/auth/v3/tenant_access_token/internal`

const tokenHandler = http.post(TOKEN_URL, () =>
  HttpResponse.json({ code: 0, expire: 7200, tenant_access_token: 'test-token' }),
)

const botInfoHandler = http.get(`${BASE}/open-apis/bot/v3/info`, () =>
  HttpResponse.json({ bot: { app_name: 'TestBot', open_id: 'ou_bot001' }, code: 0 }),
)

const createCardHandler = http.post(`${BASE}/open-apis/cardkit/v1/cards`, () =>
  HttpResponse.json({ code: 0, data: { card_id: 'card_int_001' } }),
)

interface CapturedMessages {
  mentionMessage: Message | null
  mentionThread: Thread | null
  subscribedMessage: Message | null
  subscribedThread: Thread | null
  dmMessage: Message | null
  dmThread: Thread | null
}

interface WaitUntilTracker {
  waitUntil: (task: Promise<unknown>) => void
  waitForAll: () => Promise<void>
}

const createWaitUntilTracker = (): WaitUntilTracker => {
  const tasks: Array<Promise<unknown>> = []

  return {
    waitForAll: async () => {
      await Promise.all(tasks)
      tasks.length = 0
    },
    waitUntil: (task) => {
      tasks.push(task)
    },
  }
}

interface TestContextHandlers {
  onMention?: (thread: Thread, message: Message) => void | Promise<void>
  onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>
  onDM?: (thread: Thread, message: Message) => void | Promise<void>
  onAction?: (event: ActionEvent) => void | Promise<void>
  onReaction?: (event: ReactionEvent) => void | Promise<void>
}

// eslint-disable-next-line max-statements -- Test factory requires multiple setup steps
const createLarkTestContext = (handlers: TestContextHandlers = {}) => {
  const adapter = createLarkAdapter({
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
  })

  const state = createMemoryState()
  const chat = new Chat({
    adapters: { lark: adapter },
    logger: 'silent',
    state,
    userName: 'TestBot',
  })

  const captured: CapturedMessages = {
    dmMessage: null,
    dmThread: null,
    mentionMessage: null,
    mentionThread: null,
    subscribedMessage: null,
    subscribedThread: null,
  }

  if (handlers.onMention) {
    const handler = handlers.onMention
    chat.onNewMention(async (thread, message) => {
      captured.mentionMessage = message
      captured.mentionThread = thread
      await handler(thread, message)
    })
  }

  if (handlers.onDM) {
    const handler = handlers.onDM
    chat.onDirectMessage(async (thread, message) => {
      captured.dmMessage = message
      captured.dmThread = thread
      await handler(thread, message)
    })
  }

  if (handlers.onSubscribed) {
    const handler = handlers.onSubscribed
    chat.onSubscribedMessage(async (thread, message) => {
      captured.subscribedMessage = message
      captured.subscribedThread = thread
      await handler(thread, message)
    })
  }

  if (handlers.onAction) {
    chat.onAction(handlers.onAction)
  }

  if (handlers.onReaction) {
    chat.onReaction(handlers.onReaction)
  }

  const tracker = createWaitUntilTracker()

  server.use(tokenHandler, botInfoHandler, createCardHandler)

  return {
    adapter,
    captured,
    chat,
    sendWebhook: async (fixture: unknown) => {
      const request = makeRequest(fixture)
      await chat.webhooks.lark(request, { waitUntil: tracker.waitUntil })
      await tracker.waitForAll()
    },
    state,
    tracker,
  }
}

export default createLarkTestContext
