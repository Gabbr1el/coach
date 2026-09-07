import type { AIProviderManager } from './ai-provider-manager'
import type { CredentialVault } from './credential-vault'
import type { ProviderConfigurationRepository } from './provider-configuration-repository'
import type { ProviderAccountSummary, ProviderStatus } from '../../shared/contracts/provider-contract'
import type { AIProvider } from './ai-provider'

const OPENAI_SECRET_REFERENCE = 'provider-openai-api-key'
function isLocalOmniRoute(baseUrl: string | null): boolean { try { const url = new URL(baseUrl ?? ''); return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === '20128' } catch { return false } }

export class ProviderConfigurationService {
  private operationQueue: Promise<void> = Promise.resolve()
  private sessionAccount: ProviderAccountSummary | null = null

  constructor(
    private readonly repository: ProviderConfigurationRepository,
    private readonly vault: CredentialVault,
    private readonly manager: AIProviderManager,
    private readonly createOpenAIProvider: (apiKey: string, model: string) => AIProvider,
    private readonly createCompatibleProvider: (label: string, baseUrl: string, apiKey: string, model: string) => AIProvider,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    await this.exclusive(async () => {
      if (!this.vault.isAvailable()) {
        const configurations = await this.repository.list()
        const local = [configurations.find((item) => item.isActive), ...configurations].find((item) => item?.providerId === 'openai-compatible' && isLocalOmniRoute(item.baseUrl))
        this.activateLocalOmniRoute(local?.id ?? 'omniroute-local-default', local?.displayName ?? 'OmniRoute local', local?.baseUrl ?? 'http://127.0.0.1:20128/v1', local?.model ?? 'codex/gpt-5.6-sol')
        return
      }
      const configurations = await this.repository.list()
      await this.vault.removeOrphans(new Set(configurations.map((item) => item.secretReference)))
      const ordered = [configurations.find((item) => item.isActive), ...configurations.filter((item) => !item.isActive)].filter((item): item is NonNullable<typeof item> => Boolean(item))
      if (!await this.activateFirstUsable(ordered, false)) this.activateLocalOmniRoute('omniroute-local-default', 'OmniRoute local', 'http://127.0.0.1:20128/v1', 'codex/gpt-5.6-sol')
    })
  }

  async getStatus(): Promise<ProviderStatus> {
    const configuration = await this.repository.getActive()
    const sessionActive = Boolean(this.sessionAccount && this.manager.getActiveRegistrationId() === this.sessionAccount.id)
    return {
      configured: sessionActive || Boolean(configuration && this.manager.getActive() && configuration.id === this.manager.getActiveRegistrationId()),
      providerId: sessionActive ? this.sessionAccount!.providerId : configuration?.providerId ?? null,
      providerName: sessionActive ? this.sessionAccount!.providerName : configuration?.displayName ?? null,
      model: sessionActive ? this.sessionAccount!.model : configuration?.model ?? null,
      secureStorageAvailable: this.vault.isAvailable(),
      activeAccountId: sessionActive ? this.sessionAccount!.id : configuration?.id ?? null,
      sessionOnly: sessionActive,
    }
  }

  async listAccounts(): Promise<ProviderAccountSummary[]> {
    const operationalAccountId = this.manager.getActiveRegistrationId()
    const persisted = (await this.repository.list()).map((configuration) => ({
      id: configuration.id,
      providerId: configuration.providerId,
      providerName: configuration.displayName,
      label: configuration.label,
      model: configuration.model,
      isActive: configuration.isActive && configuration.id === operationalAccountId,
      sessionOnly: false,
      baseUrl: configuration.baseUrl,
    }))
    return this.sessionAccount ? [this.sessionAccount, ...persisted] : persisted
  }

  async configureOpenAI(label: string, apiKey: string, model: string, persistence: 'secure-vault' | 'session'): Promise<ProviderStatus> {
    return this.exclusive(() => this.configureOpenAIExclusive(label, apiKey, model, persistence))
  }

  private async configureOpenAIExclusive(label: string, apiKey: string, model: string, persistence: 'secure-vault' | 'session'): Promise<ProviderStatus> {
    if (persistence === 'secure-vault' && !this.vault.isAvailable()) {
      throw new Error('Secure operating-system credential storage is unavailable')
    }

    const provider = this.createOpenAIProvider(apiKey, model)
    await provider.testConnection()
    if (persistence === 'session') {
      const accountId = crypto.randomUUID()
      this.sessionAccount = { id: accountId, providerId: 'openai', providerName: 'OpenAI', label, model, isActive: true, sessionOnly: true, baseUrl: null }
      this.registerAndSelect(accountId, provider)
      return this.getStatus()
    }
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
        baseUrl: null,
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
    this.sessionAccount = null
    return this.getStatus()
  }

  async configureCompatible(label: string, baseUrl: string, apiKey: string, model: string, persistence: 'secure-vault' | 'session'): Promise<ProviderStatus> {
    return this.exclusive(async () => {
      if (persistence === 'secure-vault' && !this.vault.isAvailable()) throw new Error('Secure operating-system credential storage is unavailable')
      const provider = this.createCompatibleProvider(label, baseUrl, apiKey, model)
      await provider.testConnection()
      const accountId = crypto.randomUUID()
      if (persistence === 'session') {
        this.sessionAccount = { id: accountId, providerId: 'openai-compatible', providerName: label, label, model, isActive: true, sessionOnly: true, baseUrl }
        this.registerAndSelect(accountId, provider)
        return this.getStatus()
      }
      const secretReference = `provider-compatible-api-key-${accountId}`
      await this.vault.set(secretReference, apiKey)
      try {
        const now = this.now()
        await this.repository.createAndActivate({ id: accountId, providerId: 'openai-compatible', displayName: label, label, baseUrl, model, secretReference, isActive: true, createdAt: now, updatedAt: now })
      } catch (error) {
        await this.vault.delete(secretReference).catch(() => {})
        throw error
      }
      this.sessionAccount = null
      this.registerAndSelect(accountId, provider)
      return this.getStatus()
    })
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
    const provider = configuration.providerId === 'openai'
      ? this.createOpenAIProvider(apiKey, configuration.model)
      : this.createCompatibleProvider(configuration.label, configuration.baseUrl ?? '', apiKey, configuration.model)
    if (testConnection) await provider.testConnection()
    await this.repository.activate(accountId, this.now())
    this.sessionAccount = null
    this.registerAndSelect(accountId, provider)
    return this.getStatus()
  }

  async removeAccount(accountId: string): Promise<ProviderStatus> {
    return this.exclusive(() => this.removeAccountExclusive(accountId))
  }

  private async removeAccountExclusive(accountId: string): Promise<ProviderStatus> {
    const configuration = await this.repository.findById(accountId)
    if (!configuration) {
      if (this.sessionAccount?.id === accountId) {
        this.manager.remove(accountId)
        this.sessionAccount = null
      }
      return this.getStatus()
    }
    if (configuration.isActive) this.manager.remove(accountId)
    await this.vault.delete(configuration.secretReference)
    const removed = await this.repository.remove(accountId)
    if (!configuration.isActive) this.manager.remove(accountId)
    if (removed?.isActive && !this.sessionAccount) {
      await this.activateFirstUsable(await this.repository.list(), true)
    }
    return this.getStatus()
  }

  private async activateFirstUsable(configurations: readonly import('./provider-configuration-repository').ProviderConfiguration[], testConnection: boolean): Promise<boolean> {
    this.manager.clear()
    for (const configuration of configurations) {
      try {
        const apiKey = await this.vault.get(configuration.secretReference)
        if (!apiKey) continue
        const provider = configuration.providerId === 'openai'
          ? this.createOpenAIProvider(apiKey, configuration.model)
          : this.createCompatibleProvider(configuration.label, configuration.baseUrl ?? '', apiKey, configuration.model)
        if (testConnection) await provider.testConnection()
        await this.repository.activate(configuration.id, this.now())
        this.registerAndSelect(configuration.id, provider)
        return true
      } catch {
        continue
      }
    }
    return false
  }

  private activateLocalOmniRoute(id: string, label: string, baseUrl: string, model: string): void { this.sessionAccount = { id, providerId: 'openai-compatible', providerName: label, label, model, isActive: true, sessionOnly: true, baseUrl }; this.registerAndSelect(id, this.createCompatibleProvider(label, baseUrl, 'omniroute', model)) }

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
