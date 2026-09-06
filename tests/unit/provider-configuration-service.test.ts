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
  async removeOrphans() {}
}

class MemoryConfigurationRepository implements ProviderConfigurationRepository {
  configurations: ProviderConfiguration[] = []
  get configuration() { return this.configurations[0] ?? null }
  set configuration(value: ProviderConfiguration | null) { this.configurations = value ? [value] : [] }
  async getActive() { return this.configurations.find((item) => item.isActive) ?? null }
  async findById(id: string) { return this.configurations.find((item) => item.id === id) ?? null }
  async list() { return this.configurations }
  async createAndActivate(configuration: ProviderConfiguration) { this.configurations = [...this.configurations.map((item) => ({ ...item, isActive: false })), configuration] }
  async activate(id: string, updatedAt: number) { this.configurations = this.configurations.map((item) => ({ ...item, isActive: item.id === id, updatedAt })) }
  async remove(id: string) { const found = await this.findById(id); this.configurations = this.configurations.filter((item) => item.id !== id); return found }
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

    const status = await service.configureOpenAI('Principal', 'secret-key-value-that-is-long-enough', 'gpt-test')

    expect(status.configured).toBe(true)
    expect(vault.value).toBe('secret-key-value-that-is-long-enough')
    expect(JSON.stringify(repository.configuration)).not.toContain('secret-key-value-that-is-long-enough')
    expect(manager.getActive()?.id).toBe('openai')
  })

  it('fails closed when secure storage is unavailable', async () => {
    const service = new ProviderConfigurationService(new MemoryConfigurationRepository(), new MemoryVault(false), new AIProviderManager(), provider)
    await expect(service.configureOpenAI('Principal', 'secret-key-value-that-is-long-enough', 'gpt-test')).rejects.toThrow(/unavailable/)
  })

  it('removes the active provider before a credential deletion failure', async () => {
    class FailingDeleteVault extends MemoryVault { override async delete() { throw new Error('vault failure') } }
    const repository = new MemoryConfigurationRepository()
    const accountId = '00000000-0000-4000-8000-000000000010'
    repository.configuration = { id: accountId, providerId: 'openai', displayName: 'OpenAI', label: 'Principal', model: 'gpt-test', secretReference: 'old-secret', isActive: true, createdAt: 1, updatedAt: 1 }
    const manager = new AIProviderManager()
    manager.replace(provider(), accountId)
    manager.select(accountId)
    const service = new ProviderConfigurationService(repository, new FailingDeleteVault(), manager, provider)

    await expect(service.removeAccount(accountId)).rejects.toThrow('vault failure')
    expect(manager.getActive()).toBeNull()
    expect(manager.list()).toEqual([])
  })
})
