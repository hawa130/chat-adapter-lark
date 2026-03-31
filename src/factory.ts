import { Domain } from '@larksuiteoapi/node-sdk'
import { LarkAdapter } from './adapter.ts'
import type { LarkAdapterConfig } from './types.ts'
import { ValidationError } from '@chat-adapter/shared'

const ADAPTER_NAME = 'lark'

const resolveDomain = (value: string | undefined): Domain | undefined => {
  if (value === 'lark') {
    return Domain.Lark
  }
  if (value === 'feishu' || value === undefined) {
    return Domain.Feishu
  }
  return undefined
}

const resolveConfig = (config?: Partial<LarkAdapterConfig>): LarkAdapterConfig => {
  const appId = config?.appId ?? process.env['LARK_APP_ID']
  const appSecret = config?.appSecret ?? process.env['LARK_APP_SECRET']

  if (!appId) {
    throw new ValidationError(ADAPTER_NAME, 'Missing required config: LARK_APP_ID')
  }
  if (!appSecret) {
    throw new ValidationError(ADAPTER_NAME, 'Missing required config: LARK_APP_SECRET')
  }

  return {
    appId,
    appSecret,
    domain: config?.domain ?? resolveDomain(process.env['LARK_DOMAIN']),
    encryptKey: config?.encryptKey ?? process.env['LARK_ENCRYPT_KEY'],
    verificationToken: config?.verificationToken ?? process.env['LARK_VERIFICATION_TOKEN'],
    ...(config?.userName !== undefined && { userName: config.userName }),
    ...(config?.disableTokenCache !== undefined && {
      disableTokenCache: config.disableTokenCache,
    }),
    ...(config?.appType !== undefined && { appType: config.appType }),
    ...(config?.cache !== undefined && { cache: config.cache }),
    ...(config?.httpInstance !== undefined && { httpInstance: config.httpInstance }),
    ...(config?.logger !== undefined && { logger: config.logger }),
  }
}

const createLarkAdapter = (config?: Partial<LarkAdapterConfig>): LarkAdapter =>
  new LarkAdapter(resolveConfig(config))

export { createLarkAdapter }
