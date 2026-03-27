# chat-adapter-lark

A [Chat SDK](https://github.com/chat-sdk/chat) adapter for Lark (飞书).

[![npm](https://img.shields.io/npm/v/chat-adapter-lark)](https://www.npmjs.com/package/chat-adapter-lark)
[![license](https://img.shields.io/npm/l/chat-adapter-lark)](./LICENSE)

## Installation

```bash
npm install chat-adapter-lark
# or
bun add chat-adapter-lark
```

## Quick Start

```typescript
import { Chat } from 'chat'
import { createLarkAdapter } from 'chat-adapter-lark'

const lark = createLarkAdapter({
  appId: process.env.LARK_APP_ID,
  appSecret: process.env.LARK_APP_SECRET,
})

const bot = new Chat({
  adapters: { lark },
  onMention: async ({ thread, message }) => {
    await thread.post(`You said: ${message.text}`)
  },
})
```

## Configuration

| Parameter           | Env Variable              | Required | Default           | Description                        |
| ------------------- | ------------------------- | -------- | ----------------- | ---------------------------------- |
| `appId`             | `LARK_APP_ID`             | ✅       | —                 | Lark App ID                        |
| `appSecret`         | `LARK_APP_SECRET`         | ✅       | —                 | Lark App Secret                    |
| `encryptKey`        | `LARK_ENCRYPT_KEY`        | —        | —                 | Encrypt key for event decryption   |
| `verificationToken` | `LARK_VERIFICATION_TOKEN` | —        | —                 | Verification token (v1 events)     |
| `domain`            | `LARK_DOMAIN`             | —        | `feishu`          | `feishu` or `lark` (international) |
| `userName`          | —                         | —        | Bot name from API | Bot display name                   |
| `disableTokenCache` | —                         | —        | `false`           | Disable token caching              |

All required fields can be supplied via config object or environment variables. If both are provided, the config object takes precedence.

## Webhook Setup

Point your Lark event subscription URL to your deployed endpoint, then wire it up with your framework of choice:

**Next.js App Router:**

```typescript
// app/api/webhook/lark/route.ts
export async function POST(request: Request) {
  return bot.webhooks.lark(request)
}
```

**Hono:**

```typescript
app.post('/webhook/lark', (c) => bot.webhooks.lark(c.req.raw))
```

**Express:**

```typescript
app.post('/webhook/lark', async (req, res) => {
  const response = await bot.webhooks.lark(req)
  res.status(response.status).send(await response.text())
})
```

## Lark Open Platform Setup

1. Create a Custom App at [open.feishu.cn](https://open.feishu.cn) (or [open.larksuite.com](https://open.larksuite.com) for international)
2. Add the **Bot** capability under Features
3. Configure the event subscription URL to point to your webhook endpoint
4. Add the required permissions listed below
5. URL verification is handled automatically — no extra setup needed
6. Publish the app to make it available in your workspace

## Required Permissions

| Permission                 | Description             |
| -------------------------- | ----------------------- |
| `im:message`               | Read messages           |
| `im:message:send_as_bot`   | Send messages as bot    |
| `im:chat:readonly`         | Read chat info          |
| `im:resource`              | Access files and images |
| `contact:user.id:readonly` | Read user IDs           |

## Feature Support

| Feature                     | Status                    |
| --------------------------- | ------------------------- |
| Text messages               | ✅                        |
| Rich text (post)            | ✅                        |
| Interactive cards           | ✅                        |
| File/Image upload           | ✅                        |
| Reactions                   | ✅                        |
| Streaming (via editMessage) | ✅                        |
| Ephemeral messages          | ⚠️ Interactive cards only |
| Thread replies              | ✅                        |
| DM                          | ✅                        |
| Typing indicator            | ❌ No Lark API            |
| Modals                      | ❌ Not supported          |

## Feishu vs Lark

The `domain` option controls which Lark API endpoint is used. Use `feishu` for mainland China and `lark` for international.

```typescript
import { Domain } from '@larksuiteoapi/node-sdk'

// International (Lark)
createLarkAdapter({ domain: Domain.Lark })
// or via env
// LARK_DOMAIN=lark

// China (Feishu, default)
createLarkAdapter({ domain: Domain.Feishu })
// or via env
// LARK_DOMAIN=feishu
```

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a pull request. Make sure `bun run lint` and `bun run fmt:check` pass before opening a PR.

## License

MIT
