import type { AIProviderManager } from './ai-provider-manager'
import type { CredentialVault } from './credential-vault'
import type { ProviderConfigurationRepository } from './provider-configuration-repository'
import type { ProviderAccountSummary, ProviderStatus } from '../../shared/contracts/provider-contract'
import type { AIProvider } from './ai-provider'

const OPENAI_SECRET_REFERENCE = 'provider-openai-api-key'

export class ProviderConfigurationService {
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly repository: ProviderConfigurationRepository,
    private readonly vault: CredentialVault,
    private readonly manager: AIProviderManager,
    private readonly createOpenAIProvider: (apiKey: string, model: string) => AIProvider,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    await this.exclusive(async () => {
      if (!this.vault.isAvailable()) return
      const configurations = await this.repository.list()
      await this.vault.removeOrphans(new Set(configurations.map((item) => item.secretReference)))
      const ordered = [configurations.find((item) => item.isActive), ...configurations.filter((item) => !item.isActive)].filter((item): item is NonNullable<typeof item> => Boolean(item))
      await this.activateFirstUsable(ordered, false)
    })
  }

  async getStatus(): Promise<ProviderStatus> {
    const configuration = await this.repository.getActive()
    return {
      configured: Boolean(configuration && this.manager.getActive() && configuration.id === this.manager.getActiveRegistrationId()),
      providerId: configuration?.providerId ?? null,
      providerName: configuration?.displayName ?? null,
      model: configuration?.model ?? null,
      secureStorageAvailable: this.vault.isAvailable(),
      activeAccountId: configuration?.id ?? null,
    }
  }

  async listAccounts(): Promise<ProviderAccountSummary[]> {
    const operationalAccountId = this.manager.getActiveRegistrationId()
    return (await this.repository.list()).map((configuration) => ({
      id: configuration.id,
      providerId: configuration.providerId,
      providerName: configuration.displayName,
      label: configuration.label,
      model: configuration.model,
      isActive: configuration.isActive && configuration.id === operationalAccountId,
    }))
  }

  async configureOpenAI(label: string, apiKey: string, model: string): Promise<ProviderStatus> {
    return this.exclusive(() => this.configureOpenAIExclusive(label, apiKey, model))
  }

  private async configureOpenAIExclusive(label: string, apiKey: string, model: string): Promise<ProviderStatus> {
    if (!this.vault.isAvailable()) {
      throw new Error('Secure operating-system credential storage is unavailable')
    }

    const provider = this.createOpenAIProvider(apiKey, model)
    await provider.testConnection()
    const accountId = crypto.randomUUID()
    const secretReference = `${OPENAI_SECRET_REFERENCE}-${accountId}`
    await this.vault.set(secretReference, apiKey)
    const now = this.now()
    try {
      await this.repository.createAndActivate({
        id: accountId,
        providerId: 'openai',
        displayName: 'OpenAI',
        label,
        model,
        secretReference,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
    } catch (error) {
      try {
        await this.vault.delete(secretReference)
      } catch {
        throw new Error('Provider setup failed; encrypted orphan cleanup will retry at next startup', { cause: error })
      }
      throw error
    }
    this.registerAndSelect(accountId, provider)
    return this.getStatus()
  }

  async selectAccount(accountId: string): Promise<ProviderStatus> {
    return this.exclusive(() => this.selectAccountExclusive(accountId, true))
  }

  private async selectAccountExclusive(accountId: string, testConnection: boolean): Promise<ProviderStatus> {
    if (!this.vault.isAvailable()) throw new Error('Secure operating-system credential storage is unavailable')
    const configuration = await this.repository.findById(accountId)
    if (!configuration) throw new Error('Provider account not found')
    const apiKey = await this.vault.get(configuration.secretReference)
    if (!apiKey) throw new Error('Provider credential not found')
    const provider = this.createOpenAIProvider(apiKey, configuration.model)
    if (testConnection) await provider.testConnection()
    await this.repository.activate(accountId, this.now())
    this.registerAndSelect(accountId, provider)
    return this.getStatus()
  }

  async removeAccount(accountId: string): Promise<ProviderStatus> {
    return this.exclusive(() => this.removeAccountExclusive(accountId))
  }

  private async removeAccountExclusive(accountId: string): Promise<ProviderStatus> {
    const configuration = await this.repository.findById(accountId)
    if (!configuration) return this.getStatus()
    if (configuration.isActive) this.manager.remove(accountId)
    await this.vault.delete(configuration.secretReference)
    const removed = await this.repository.remove(accountId)
    if (!configuration.isActive) this.manager.remove(accountId)
    if (removed?.isActive) {
      await this.activateFirstUsable(await this.repository.list(), true)
    }
    return this.getStatus()
  }

  private async activateFirstUsable(configurations: readonly import('./provider-configuration-repository').ProviderConfiguration[], testConnection: boolean): Promise<void> {
    this.manager.clear()
    for (const configuration of configurations) {
      try {
        const apiKey = await this.vault.get(configuration.secretReference)
        if (!apiKey) continue
        const provider = this.createOpenAIProvider(apiKey, configuration.model)
        if (testConnection) await provider.testConnection()
        await this.repository.activate(configuration.id, this.now())
        this.registerAndSelect(configuration.id, provider)
        return
      } catch {
        continue
      }
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue
    let release!: () => void
    this.operationQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private registerAndSelect(accountId: string, provider: AIProvider): void {
    this.manager.clear()
    this.manager.replace(provider, accountId)
    this.manager.select(accountId)
  }
}
