import { afterEach, describe, expect, it } from 'vitest'

describe('createLarkAdapter', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('creates adapter with explicit config', async () => {
    const { default: createLarkAdapter } = await import('../src/factory.ts')
    const adapter = createLarkAdapter({ appId: 'app-123', appSecret: 'secret-456' })
    expect(adapter.name).toBe('lark')
  })

  it('falls back to environment variables', async () => {
    process.env.LARK_APP_ID = 'env-app-id'
    process.env.LARK_APP_SECRET = 'env-secret'
    const { default: createLarkAdapter } = await import('../src/factory.ts')
    const adapter = createLarkAdapter()
    expect(adapter.name).toBe('lark')
  })

  it('throws when appId is missing', async () => {
    delete process.env.LARK_APP_ID
    delete process.env.LARK_APP_SECRET
    const { default: createLarkAdapter } = await import('../src/factory.ts')
    expect(() => createLarkAdapter()).toThrow(/LARK_APP_ID/)
  })

  it('throws when appSecret is missing', async () => {
    process.env.LARK_APP_ID = 'app-id'
    delete process.env.LARK_APP_SECRET
    const { default: createLarkAdapter } = await import('../src/factory.ts')
    expect(() => createLarkAdapter()).toThrow(/LARK_APP_SECRET/)
  })

  it('config overrides environment variables', async () => {
    process.env.LARK_APP_ID = 'env-id'
    process.env.LARK_APP_SECRET = 'env-secret'
    const { default: createLarkAdapter } = await import('../src/factory.ts')
    const adapter = createLarkAdapter({ appId: 'config-id', appSecret: 'config-secret' })
    expect(adapter.name).toBe('lark')
  })

  it('reads LARK_DOMAIN=lark', async () => {
    process.env.LARK_APP_ID = 'id'
    process.env.LARK_APP_SECRET = 'secret'
    process.env.LARK_DOMAIN = 'lark'
    const { default: createLarkAdapter } = await import('../src/factory.ts')
    expect(() => createLarkAdapter()).not.toThrow()
  })
})
