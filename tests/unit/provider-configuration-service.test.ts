import { describe, expect, it } from 'vitest'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import type { AIProvider } from '../../src/application/ai/ai-provider'
import type { CredentialVault } from '../../src/application/ai/credential-vault'
import type { ProviderConfiguration, ProviderConfigurationRepository } from '../../src/application/ai/provider-configuration-repository'
import { ProviderConfigurationService } from '../../src/application/ai/provider-configuration-service'

class MemoryVault implements CredentialVault {
  value: string | null = null
  constructor(private readonly available = true) {}
  isAvailable() { return this.available }
  async set(_reference: string, secret: string) { this.value = secret }
  async get() { return this.value }
  async delete() { this.value = null }
}

class MemoryConfigurationRepository implements ProviderConfigurationRepository {
  configuration: ProviderConfiguration | null = null
  async getActive() { return this.configuration?.isActive ? this.configuration : null }
  async upsert(configuration: ProviderConfiguration) { this.configuration = configuration }
  async disconnect(_providerId: 'openai', updatedAt: number) { if (this.configuration) this.configuration = { ...this.configuration, isActive: false, updatedAt } }
}

function provider(): AIProvider {
  return { id: 'openai', name: 'OpenAI', testConnection: async () => {}, sendMessage: async () => ({ content: 'ok', providerId: 'openai', modelId: 'test' }), getCapabilities: () => ({ streaming: false, usageInformation: true, supportedInput: ['text'] }) }
}

describe('ProviderConfigurationService', () => {
  it('tests, stores and selects a provider without putting the key in metadata', async () => {
    const repository = new MemoryConfigurationRepository()
    const vault = new MemoryVault()
    const manager = new AIProviderManager()
    const service = new ProviderConfigurationService(repository, vault, manager, provider, () => 50)

    const status = await service.configureOpenAI('secret-key-value-that-is-long-enough', 'gpt-test')

    expect(status.configured).toBe(true)
    expect(vault.value).toBe('secret-key-value-that-is-long-enough')
    expect(JSON.stringify(repository.configuration)).not.toContain('secret-key-value-that-is-long-enough')
    expect(manager.getActive()?.id).toBe('openai')
  })

  it('fails closed when secure storage is unavailable', async () => {
    const service = new ProviderConfigurationService(new MemoryConfigurationRepository(), new MemoryVault(false), new AIProviderManager(), provider)
    await expect(service.configureOpenAI('secret-key-value-that-is-long-enough', 'gpt-test')).rejects.toThrow(/unavailable/)
  })

  it('removes the active provider before a credential deletion failure', async () => {
    class FailingDeleteVault extends MemoryVault { override async delete() { throw new Error('vault failure') } }
    const repository = new MemoryConfigurationRepository()
    repository.configuration = { providerId: 'openai', displayName: 'OpenAI', model: 'gpt-test', secretReference: 'old-secret', isActive: true, createdAt: 1, updatedAt: 1 }
    const manager = new AIProviderManager()
    manager.register(provider())
    manager.select('openai')
    const service = new ProviderConfigurationService(repository, new FailingDeleteVault(), manager, provider)

    await expect(service.disconnect()).rejects.toThrow('vault failure')
    expect(manager.getActive()).toBeNull()
    expect(manager.list()).toEqual([])
  })
})
