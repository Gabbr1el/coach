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

function provider(testConnection: () => Promise<void> = async () => {}): AIProvider {
  return { id: 'openai', name: 'OpenAI', testConnection, sendMessage: async () => ({ content: 'ok', providerId: 'openai', modelId: 'test' }), getCapabilities: () => ({ streaming: false, usageInformation: true, supportedInput: ['text'] }) }
}

const openAIProvider = () => provider()
const compatibleProvider = () => provider()

describe('ProviderConfigurationService', () => {
  it('activates local OmniRoute on startup without secure storage', async () => {
    const manager = new AIProviderManager()
    const service = new ProviderConfigurationService(new MemoryConfigurationRepository(), new MemoryVault(false), manager, () => provider(), () => provider())
    await service.initialize()
    expect(await service.getStatus()).toMatchObject({ configured: true, connected: false, connectionState: 'unchecked', quota: 'unknown', providerName: 'OmniRoute local', model: 'codex/gpt-5.6-sol', sessionOnly: true })
  })
  it('tests, stores and selects a provider without putting the key in metadata', async () => {
    const repository = new MemoryConfigurationRepository()
    const vault = new MemoryVault()
    const manager = new AIProviderManager()
    const service = new ProviderConfigurationService(repository, vault, manager, openAIProvider, compatibleProvider, () => 50)

    const status = await service.configureOpenAI('Principal', 'secret-key-value-that-is-long-enough', 'gpt-test', 'secure-vault')

    expect(status).toMatchObject({ configured: true, connected: true, connectionState: 'connected', quota: 'available' })
    expect(vault.value).toBe('secret-key-value-that-is-long-enough')
    expect(JSON.stringify(repository.configuration)).not.toContain('secret-key-value-that-is-long-enough')
    expect(manager.getActive()?.id).toBe('openai')
  })

  it('keeps configuration distinct from failed connectivity and quota state', async () => {
    const repository = new MemoryConfigurationRepository()
    repository.configuration = { id: '00000000-0000-4000-8000-000000000010', providerId: 'openai', displayName: 'OpenAI', label: 'Principal', baseUrl: null, model: 'gpt-test', secretReference: 'secret', isActive: true, createdAt: 1, updatedAt: 1 }
    const vault = new MemoryVault()
    vault.value = 'secret-key-value-that-is-long-enough'
    const manager = new AIProviderManager()
    const quotaError = Object.assign(new Error('quota'), { code: 'INSUFFICIENT_QUOTA' })
    const service = new ProviderConfigurationService(repository, vault, manager, () => provider(async () => { throw quotaError }), compatibleProvider)

    await expect(service.selectAccount(repository.configuration!.id)).rejects.toBe(quotaError)

    expect(await service.getStatus()).toMatchObject({ configured: true, connected: false, connectionState: 'unreachable', quota: 'exhausted', activeAccountId: repository.configuration!.id })
  })

  it('fails closed when secure storage is unavailable', async () => {
    const service = new ProviderConfigurationService(new MemoryConfigurationRepository(), new MemoryVault(false), new AIProviderManager(), openAIProvider, compatibleProvider)
    await expect(service.configureOpenAI('Principal', 'secret-key-value-that-is-long-enough', 'gpt-test', 'secure-vault')).rejects.toThrow(/unavailable/)
  })

  it('allows a session-only provider when persistent secure storage is unavailable', async () => {
    const repository = new MemoryConfigurationRepository()
    const manager = new AIProviderManager()
    const vault = new MemoryVault(false)
    const service = new ProviderConfigurationService(repository, vault, manager, openAIProvider, compatibleProvider)

    const status = await service.configureOpenAI('Sessão', 'secret-key-value-that-is-long-enough', 'gpt-test', 'session')

    expect(status).toMatchObject({ configured: true, sessionOnly: true, secureStorageAvailable: false })
    expect(repository.configurations).toEqual([])
    expect(vault.value).toBeNull()
  })

  it('connects an OpenAI-compatible provider only for the current session', async () => {
    const repository = new MemoryConfigurationRepository()
    const manager = new AIProviderManager()
    const service = new ProviderConfigurationService(repository, new MemoryVault(false), manager, openAIProvider, compatibleProvider)

    const status = await service.configureCompatible('OmniRoute', 'http://localhost:20128/v1', 'omniroute', 'codex/gpt-5.6-sol', 'session')

    expect(status).toMatchObject({ configured: true, providerId: 'openai-compatible', providerName: 'OmniRoute', sessionOnly: true })
    expect(repository.configurations).toEqual([])
  })

  it('removes the active provider before a credential deletion failure', async () => {
    class FailingDeleteVault extends MemoryVault { override async delete() { throw new Error('vault failure') } }
    const repository = new MemoryConfigurationRepository()
    const accountId = '00000000-0000-4000-8000-000000000010'
    repository.configuration = { id: accountId, providerId: 'openai', displayName: 'OpenAI', label: 'Principal', baseUrl: null, model: 'gpt-test', secretReference: 'old-secret', isActive: true, createdAt: 1, updatedAt: 1 }
    const manager = new AIProviderManager()
    manager.replace(provider(), accountId)
    manager.select(accountId)
    const service = new ProviderConfigurationService(repository, new FailingDeleteVault(), manager, openAIProvider, compatibleProvider)

    await expect(service.removeAccount(accountId)).rejects.toThrow('vault failure')
    expect(manager.getActive()).toBeNull()
    expect(manager.list()).toEqual([])
  })
})
