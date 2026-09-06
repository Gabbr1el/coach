import type { AIProvider } from './ai-provider'

export class AIProviderManager {
  private readonly providers = new Map<string, AIProvider>()
  private activeProviderId: string | null = null

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) throw new Error(`AI provider '${provider.id}' is already registered`)
    this.providers.set(provider.id, provider)
  }

  replace(provider: AIProvider, registrationId = provider.id): void {
    this.providers.set(registrationId, provider)
  }

  select(providerId: string): void {
    if (!this.providers.has(providerId)) throw new Error(`AI provider '${providerId}' is not registered`)
    this.activeProviderId = providerId
  }

  getActive(): AIProvider | null {
    return this.activeProviderId ? this.providers.get(this.activeProviderId) ?? null : null
  }

  getActiveRegistrationId(): string | null {
    return this.activeProviderId
  }

  clearSelection(): void {
    this.activeProviderId = null
  }

  clear(): void {
    this.activeProviderId = null
    this.providers.clear()
  }

  remove(providerId: string): void {
    if (this.activeProviderId === providerId) this.activeProviderId = null
    this.providers.delete(providerId)
  }

  list(): readonly AIProvider[] {
    return [...this.providers.values()]
  }
}
