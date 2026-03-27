import type { Domain } from '@larksuiteoapi/node-sdk'

/** Thread identifier for Lark — encodes a chat and optional root message (for thread replies). */
export interface LarkThreadId {
  chatId: string
  rootMessageId?: string
}

export interface LarkAdapterConfig {
  /** Lark app ID (or env LARK_APP_ID) */
  appId: string
  /** Lark app secret (or env LARK_APP_SECRET) */
  appSecret: string
  /** Encrypt key for event decryption (or env LARK_ENCRYPT_KEY) */
  encryptKey?: string
  /** Verification token for v1 events (or env LARK_VERIFICATION_TOKEN) */
  verificationToken?: string
  /** API domain — lark.Domain.Feishu (default) or lark.Domain.Lark */
  domain?: Domain | string
  /** Bot display name (defaults to name from bot info API) */
  userName?: string
  /** Disable SDK's internal token cache */
  disableTokenCache?: boolean
}

/** Raw event data from im.message.receive_v1, as delivered by the SDK's EventDispatcher. */
export interface LarkRawMessage {
  event_id?: string
  sender: {
    sender_id?: {
      union_id?: string
      user_id?: string
      open_id?: string
    }
    sender_type: string
    tenant_key?: string
  }
  message: {
    message_id: string
    root_id?: string
    parent_id?: string
    create_time: string
    update_time?: string
    chat_id: string
    thread_id?: string
    chat_type: string
    message_type: string
    content: string
    mentions?: Array<{
      key: string
      id: { union_id?: string; user_id?: string; open_id?: string }
      name: string
      tenant_key?: string
    }>
  }
}
