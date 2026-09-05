import { describe, expect, it } from 'vitest'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import type { AIProvider } from '../../src/application/ai/ai-provider'

function provider(id: string): AIProvider {
  return {
    id,
    name: id,
    testConnection: async () => {},
    sendMessage: async () => ({ content: '', providerId: id, modelId: 'test' }),
    streamMessage: async function* () { yield { type: 'text-delta' as const, content: '' } },
    getCapabilities: () => ({ streaming: true, usageInformation: false, supportedInput: ['text'] }),
  }
}

describe('AIProviderManager', () => {
  it('switches active providers without owning conversation state', () => {
    const manager = new AIProviderManager()
    manager.register(provider('a'))
    manager.register(provider('b'))

    manager.select('a')
    expect(manager.getActive()?.id).toBe('a')
    manager.select('b')
    expect(manager.getActive()?.id).toBe('b')
  })

  it('rejects duplicate and unknown providers', () => {
    const manager = new AIProviderManager()
    manager.register(provider('a'))

    expect(() => manager.register(provider('a'))).toThrow(/already registered/)
    expect(() => manager.select('missing')).toThrow(/not registered/)
  })
})
