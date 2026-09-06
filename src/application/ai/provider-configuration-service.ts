import type { AIProviderManager } from './ai-provider-manager'
import type { CredentialVault } from './credential-vault'
import type { ProviderConfigurationRepository } from './provider-configuration-repository'
import type { ProviderStatus } from '../../shared/contracts/provider-contract'
import type { AIProvider } from './ai-provider'

const OPENAI_SECRET_REFERENCE = 'provider-openai-api-key'

export class ProviderConfigurationService {
  constructor(
    private readonly repository: ProviderConfigurationRepository,
    private readonly vault: CredentialVault,
    private readonly manager: AIProviderManager,
    private readonly createOpenAIProvider: (apiKey: string, model: string) => AIProvider,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    const configuration = await this.repository.getActive()
    if (!configuration || !this.vault.isAvailable()) return
    const apiKey = await this.vault.get(configuration.secretReference)
    if (!apiKey) return
    this.registerAndSelect(this.createOpenAIProvider(apiKey, configuration.model))
  }

  async getStatus(): Promise<ProviderStatus> {
    const configuration = await this.repository.getActive()
    return {
      configured: Boolean(configuration && this.manager.getActive()),
      providerId: configuration?.providerId ?? null,
      providerName: configuration?.displayName ?? null,
      model: configuration?.model ?? null,
      secureStorageAvailable: this.vault.isAvailable(),
    }
  }

  async configureOpenAI(apiKey: string, model: string): Promise<ProviderStatus> {
    if (!this.vault.isAvailable()) {
      throw new Error('Secure operating-system credential storage is unavailable')
    }

    const provider = this.createOpenAIProvider(apiKey, model)
    await provider.testConnection()
    const previousConfiguration = await this.repository.getActive()
    const secretReference = `${OPENAI_SECRET_REFERENCE}-${crypto.randomUUID()}`
    await this.vault.set(secretReference, apiKey)
    const now = this.now()
    try {
      await this.repository.upsert({
        providerId: 'openai',
        displayName: 'OpenAI',
        model,
        secretReference,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
    } catch (error) {
      await this.vault.delete(secretReference)
      throw error
    }
    this.registerAndSelect(provider)
    if (previousConfiguration?.secretReference && previousConfiguration.secretReference !== secretReference) {
      await this.vault.delete(previousConfiguration.secretReference).catch(() => {})
    }
    return this.getStatus()
  }

  async disconnect(): Promise<ProviderStatus> {
    const configuration = await this.repository.getActive()
    this.manager.remove('openai')
    await this.repository.disconnect('openai', this.now())
    if (configuration) await this.vault.delete(configuration.secretReference)
    return this.getStatus()
  }

  private registerAndSelect(provider: AIProvider): void {
    this.manager.replace(provider)
    this.manager.select(provider.id)
  }
}
