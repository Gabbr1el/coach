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

  async setEnabled(id: string, enabled: boolean, updatedAt: number) {
    const found = await this.findById(id)

    if (!found) {
      return null
    }

    this.configurations = this.configurations.map((item) =>
      item.id === id
        ? {
            ...item,
            isEnabled: enabled,
            isActive: enabled ? item.isActive : false,
            updatedAt,
          }
        : item,
    )

    return this.findById(id)
  }

  async update(
    id: string,
    input: {
      readonly label?: string
      readonly model?: string
      readonly reasoningEffort?: 'auto' | 'low' | 'medium' | 'high'
      readonly identityLabel?: string | null
      readonly baseUrl?: string | null
      readonly updatedAt: number
    },
  ) {
    const found = await this.findById(id)

    if (!found) {
      return null
    }

    this.configurations = this.configurations.map((item) =>
      item.id === id
        ? {
            ...item,
            ...input,
          }
        : item,
    )

    return this.findById(id)
  }

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

    expect(await service.getStatus()).toMatchObject({ configured: true, connected: false, connectionState: 'connected', quota: 'exhausted', activeAccountId: repository.configuration!.id })
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

describe('ProviderConfigurationService multi-account behavior', () => {
  it('keeps multiple session accounts registered when a new account is connected', async () => {
    const repository =
      new MemoryConfigurationRepository()

    const manager =
      new AIProviderManager()

    const service =
      new ProviderConfigurationService(
        repository,
        new MemoryVault(false),
        manager,
        openAIProvider,
        compatibleProvider,
      )

    await service.configureOpenAI(
      'Conta 1',
      'secret-key-value-that-is-long-enough-1',
      'gpt-test',
      'session',
    )

    const firstAccountId =
      manager.getActiveRegistrationId()

    await service.configureOpenAI(
      'Conta 2',
      'secret-key-value-that-is-long-enough-2',
      'gpt-test',
      'session',
    )

    const secondAccountId =
      manager.getActiveRegistrationId()

    expect(firstAccountId)
      .not
      .toBeNull()

    expect(secondAccountId)
      .not
      .toBeNull()

    expect(secondAccountId)
      .not
      .toBe(firstAccountId)

    expect(manager.list())
      .toHaveLength(2)

    const accounts =
      await service.listAccounts()

    expect(accounts)
      .toHaveLength(2)

    expect(
      accounts.every(
        (account) =>
          account.sessionOnly,
      ),
    ).toBe(true)
  })

  it('switches between session accounts without unregistering the others', async () => {
    const repository =
      new MemoryConfigurationRepository()

    const manager =
      new AIProviderManager()

    const service =
      new ProviderConfigurationService(
        repository,
        new MemoryVault(false),
        manager,
        openAIProvider,
        compatibleProvider,
      )

    await service.configureOpenAI(
      'Conta A',
      'secret-key-value-that-is-long-enough-a',
      'gpt-test',
      'session',
    )

    await service.configureOpenAI(
      'Conta B',
      'secret-key-value-that-is-long-enough-b',
      'gpt-test',
      'session',
    )

    const accounts =
      await service.listAccounts()

    expect(accounts)
      .toHaveLength(2)

    const accountA =
      accounts.find(
        (account) =>
          account.label === 'Conta A',
      )

    const accountB =
      accounts.find(
        (account) =>
          account.label === 'Conta B',
      )

    expect(accountA)
      .toBeDefined()

    expect(accountB)
      .toBeDefined()

    expect(
      manager.getActiveRegistrationId(),
    ).toBe(accountB!.id)

    await service.selectAccount(
      accountA!.id,
    )

    expect(
      manager.getActiveRegistrationId(),
    ).toBe(accountA!.id)

    expect(manager.list())
      .toHaveLength(2)

    const afterSwitch =
      await service.listAccounts()

    expect(
      afterSwitch.find(
        (account) =>
          account.id === accountA!.id,
      )?.isActive,
    ).toBe(true)

    expect(
      afterSwitch.find(
        (account) =>
          account.id === accountB!.id,
      )?.isActive,
    ).toBe(false)
  })

  it('rejects the eleventh user-created account', async () => {
    const repository =
      new MemoryConfigurationRepository()

    const manager =
      new AIProviderManager()

    const service =
      new ProviderConfigurationService(
        repository,
        new MemoryVault(false),
        manager,
        openAIProvider,
        compatibleProvider,
      )

    for (
      let index = 1;
      index <= 10;
      index += 1
    ) {
      await service.configureOpenAI(
        `Conta ${index}`,
        `secret-key-value-that-is-long-enough-${index}`,
        'gpt-test',
        'session',
      )
    }

    expect(
      await service.listAccounts(),
    ).toHaveLength(10)

    expect(manager.list())
      .toHaveLength(10)

    await expect(
      service.configureOpenAI(
        'Conta 11',
        'secret-key-value-that-is-long-enough-11',
        'gpt-test',
        'session',
      ),
    ).rejects.toThrow(
      'Provider account limit reached (10)',
    )

    expect(
      await service.listAccounts(),
    ).toHaveLength(10)

    expect(manager.list())
      .toHaveLength(10)
  })
})


describe('ProviderConfigurationService account lifecycle', () => {
  it('disables the active session account, selects another enabled account, and can re-enable it without losing the session provider', async () => {
    const repository =
      new MemoryConfigurationRepository()

    const manager =
      new AIProviderManager()

    const service =
      new ProviderConfigurationService(
        repository,
        new MemoryVault(false),
        manager,
        openAIProvider,
        compatibleProvider,
      )

    await service.configureOpenAI(
      'Conta A',
      'secret-key-value-that-is-long-enough-a',
      'gpt-test',
      'session',
    )

    const accountAId =
      manager.getActiveRegistrationId()

    await service.configureOpenAI(
      'Conta B',
      'secret-key-value-that-is-long-enough-b',
      'gpt-test',
      'session',
    )

    const accountBId =
      manager.getActiveRegistrationId()

    expect(accountAId)
      .not
      .toBeNull()

    expect(accountBId)
      .not
      .toBeNull()

    expect(accountBId)
      .not
      .toBe(accountAId)

    await service.setAccountEnabled(
      accountBId!,
      false,
    )

    expect(
      manager.getActiveRegistrationId(),
    ).toBe(accountAId)

    let accounts =
      await service.listAccounts()

    expect(
      accounts.find(
        (account) =>
          account.id === accountBId,
      ),
    ).toMatchObject({
      isEnabled: false,
      isActive: false,
    })

    await expect(
      service.selectAccount(
        accountBId!,
      ),
    ).rejects.toThrow(
      'Provider account is disabled',
    )

    await service.setAccountEnabled(
      accountBId!,
      true,
    )

    expect(
      manager.getActiveRegistrationId(),
    ).toBe(accountAId)

    accounts =
      await service.listAccounts()

    expect(
      accounts.find(
        (account) =>
          account.id === accountBId,
      ),
    ).toMatchObject({
      isEnabled: true,
      isActive: false,
    })

    await service.selectAccount(
      accountBId!,
    )

    expect(
      manager.getActiveRegistrationId(),
    ).toBe(accountBId)

    expect(manager.list())
      .toHaveLength(2)
  })

  it('edits a session account label without changing the connector identity', async () => {
    const repository =
      new MemoryConfigurationRepository()

    const manager =
      new AIProviderManager()

    const service =
      new ProviderConfigurationService(
        repository,
        new MemoryVault(false),
        manager,
        openAIProvider,
        compatibleProvider,
      )

    await service.configureOpenAI(
      'Principal',
      'secret-key-value-that-is-long-enough',
      'gpt-test',
      'session',
    )

    const accountId =
      manager.getActiveRegistrationId()

    expect(accountId)
      .not
      .toBeNull()

    await service.updateAccount(
      accountId!,
      'Minha OpenAI',
      'Conta pessoal',
      'gpt-test',
      'auto',
    )

    const accounts =
      await service.listAccounts()

    expect(
      accounts.find(
        (account) =>
          account.id === accountId,
      ),
    ).toMatchObject({
      providerId: 'openai',
      providerName: 'OpenAI',
      label: 'Minha OpenAI',
      identityLabel: 'Conta pessoal',
      isEnabled: true,
      isActive: true,
      sessionOnly: true,
    })
  })

  it('disables and re-enables a persisted account without deleting its credential', async () => {
    const repository =
      new MemoryConfigurationRepository()

    const vault =
      new MemoryVault(true)

    const manager =
      new AIProviderManager()

    const service =
      new ProviderConfigurationService(
        repository,
        vault,
        manager,
        openAIProvider,
        compatibleProvider,
        () => 100,
      )

    await service.configureOpenAI(
      'Principal',
      'secret-key-value-that-is-long-enough',
      'gpt-test',
      'secure-vault',
    )

    const accountId =
      repository.configuration!.id

    const originalSecret =
      vault.value

    const originalReference =
      repository.configuration!
        .secretReference

    await service.setAccountEnabled(
      accountId,
      false,
    )

    expect(
      repository.configuration,
    ).toMatchObject({
      id: accountId,
      isEnabled: false,
      isActive: false,
    })

    expect(vault.value)
      .toBe(originalSecret)

    expect(
      repository.configuration!
        .secretReference,
    ).toBe(originalReference)

    await service.setAccountEnabled(
      accountId,
      true,
    )

    expect(
      repository.configuration,
    ).toMatchObject({
      id: accountId,
      isEnabled: true,
      isActive: false,
    })

    expect(vault.value)
      .toBe(originalSecret)

    expect(
      repository.configuration!
        .secretReference,
    ).toBe(originalReference)

    await service.selectAccount(
      accountId,
    )

    expect(
      manager.getActiveRegistrationId(),
    ).toBe(accountId)

    expect(
      repository.configuration,
    ).toMatchObject({
      isEnabled: true,
      isActive: true,
    })
  })

  it('edits persisted account metadata without touching the stored credential', async () => {
    const repository =
      new MemoryConfigurationRepository()

    const vault =
      new MemoryVault(true)

    const manager =
      new AIProviderManager()

    const service =
      new ProviderConfigurationService(
        repository,
        vault,
        manager,
        openAIProvider,
        compatibleProvider,
        () => 200,
      )

    await service.configureOpenAI(
      'Principal',
      'secret-key-value-that-is-long-enough',
      'gpt-test',
      'secure-vault',
    )

    const accountId =
      repository.configuration!.id

    const originalSecret =
      vault.value

    const originalReference =
      repository.configuration!
        .secretReference

    await service.updateAccount(
      accountId,
      'OpenAI pessoal',
      'Conta principal',
      'gpt-test',
      'auto',
    )

    expect(
      repository.configuration,
    ).toMatchObject({
      id: accountId,
      providerId: 'openai',
      displayName: 'OpenAI',
      label: 'OpenAI pessoal',
      identityLabel: 'Conta principal',
    })

    expect(
      repository.configuration!
        .secretReference,
    ).toBe(originalReference)

    expect(vault.value)
      .toBe(originalSecret)

    const accounts =
      await service.listAccounts()

    expect(
      accounts.find(
        (account) =>
          account.id === accountId,
      ),
    ).toMatchObject({
      providerName: 'OpenAI',
      label: 'OpenAI pessoal',
      identityLabel: 'Conta principal',
    })

    expect(
      await service.getStatus(),
    ).toMatchObject({
      providerName: 'OpenAI',
      activeAccountId: accountId,
    })
  })
  it('recreates only the edited session provider when model and reasoning change', async () => {
    const repository =
      new MemoryConfigurationRepository()

    const manager =
      new AIProviderManager()

    const creations: Array<{
      apiKey: string
      model: string
      reasoningEffort:
        'auto'
        | 'low'
        | 'medium'
        | 'high'
      instance: AIProvider
    }> = []

    const trackedOpenAIProvider = (
      apiKey: string,
      model: string,
      reasoningEffort:
        'auto'
        | 'low'
        | 'medium'
        | 'high',
    ): AIProvider => {
      const instance =
        provider()

      creations.push({
        apiKey,
        model,
        reasoningEffort,
        instance,
      })

      return instance
    }

    const service =
      new ProviderConfigurationService(
        repository,
        new MemoryVault(false),
        manager,
        trackedOpenAIProvider,
        compatibleProvider,
      )

    await service.configureOpenAI(
      'Conta A',
      'secret-key-value-that-is-long-enough-a',
      'gpt-a',
      'session',
    )

    const accountAId =
      manager.getActiveRegistrationId()!

    const providerABefore =
      manager.getActive()

    await service.configureOpenAI(
      'Conta B',
      'secret-key-value-that-is-long-enough-b',
      'gpt-b',
      'session',
    )

    const accountBId =
      manager.getActiveRegistrationId()!

    const providerBBefore =
      manager.getActive()

    expect(creations)
      .toHaveLength(2)

    await service.updateAccount(
      accountAId,
      'Conta A editada',
      undefined,
      'gpt-a-new',
      'high',
    )

    expect(creations)
      .toHaveLength(3)

    expect(
      creations.at(-1),
    ).toMatchObject({
      apiKey:
        'secret-key-value-that-is-long-enough-a',

      model:
        'gpt-a-new',

      reasoningEffort:
        'high',
    })

    /*
     * Editar A enquanto B está ativa não pode
     * trocar ou recriar a conta B.
     */
    expect(
      manager.getActiveRegistrationId(),
    ).toBe(accountBId)

    expect(
      manager.getActive(),
    ).toBe(providerBBefore)

    await service.selectAccount(
      accountAId,
    )

    expect(
      manager.getActive(),
    ).not.toBe(providerABefore)

    await service.selectAccount(
      accountBId,
    )

    expect(
      manager.getActive(),
    ).toBe(providerBBefore)

    const accounts =
      await service.listAccounts()

    expect(
      accounts.find(
        (account) =>
          account.id === accountAId,
      ),
    ).toMatchObject({
      label:
        'Conta A editada',

      model:
        'gpt-a-new',

      reasoningEffort:
        'high',
    })

    expect(
      accounts.find(
        (account) =>
          account.id === accountBId,
      ),
    ).toMatchObject({
      label:
        'Conta B',

      model:
        'gpt-b',

      reasoningEffort:
        'auto',
    })
  })

  it('recreates a persisted provider with its updated model and reasoning effort', async () => {
    const repository =
      new MemoryConfigurationRepository()

    const vault =
      new MemoryVault(true)

    const manager =
      new AIProviderManager()

    const creations: Array<{
      apiKey: string
      model: string
      reasoningEffort:
        'auto'
        | 'low'
        | 'medium'
        | 'high'
      instance: AIProvider
    }> = []

    const trackedOpenAIProvider = (
      apiKey: string,
      model: string,
      reasoningEffort:
        'auto'
        | 'low'
        | 'medium'
        | 'high',
    ): AIProvider => {
      const instance =
        provider()

      creations.push({
        apiKey,
        model,
        reasoningEffort,
        instance,
      })

      return instance
    }

    const service =
      new ProviderConfigurationService(
        repository,
        vault,
        manager,
        trackedOpenAIProvider,
        compatibleProvider,
      )

    await service.configureOpenAI(
      'Principal',
      'secret-key-value-that-is-long-enough',
      'gpt-old',
      'secure-vault',
    )

    const accountId =
      repository.configuration!.id

    const providerBefore =
      manager.getActive()

    expect(creations)
      .toHaveLength(1)

    expect(
      creations[0],
    ).toMatchObject({
      model:
        'gpt-old',

      reasoningEffort:
        'auto',
    })

    await service.updateAccount(
      accountId,
      'Principal',
      undefined,
      'gpt-new',
      'medium',
    )

    expect(creations)
      .toHaveLength(2)

    expect(
      creations[1],
    ).toMatchObject({
      apiKey:
        'secret-key-value-that-is-long-enough',

      model:
        'gpt-new',

      reasoningEffort:
        'medium',
    })

    expect(
      manager.getActiveRegistrationId(),
    ).toBe(accountId)

    expect(
      manager.getActive(),
    ).not.toBe(providerBefore)

    expect(
      repository.configuration,
    ).toMatchObject({
      id:
        accountId,

      model:
        'gpt-new',

      reasoningEffort:
        'medium',

      isActive:
        true,

      isEnabled:
        true,
    })

    expect(vault.value)
      .toBe(
        'secret-key-value-that-is-long-enough',
      )
  })
})
