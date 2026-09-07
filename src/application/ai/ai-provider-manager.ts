import type { AIProvider } from './ai-provider'

export class AIProviderManager {
  private readonly providers = new Map<string, AIProvider>()
  private activeProviderId: string | null = null
  private readonly purposeRoutes = new Map<'planner' | 'tutor' | 'roadmap' | 'report' | 'lesson', string>()
  private readonly availabilityListeners = new Set<() => void>()

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
    for (const listener of this.availabilityListeners) listener()
  }

  getActive(): AIProvider | null {
    return this.activeProviderId ? this.providers.get(this.activeProviderId) ?? null : null
  }

  route(purpose: 'planner' | 'tutor' | 'roadmap' | 'report' | 'lesson'): AIProvider | null {
    const providerId = this.purposeRoutes.get(purpose)
    return providerId ? this.providers.get(providerId) ?? this.getActive() : this.getActive()
  }

  setRoute(purpose: 'planner' | 'tutor' | 'roadmap' | 'report' | 'lesson', providerId: string): void {
    if (!this.providers.has(providerId)) throw new Error(`AI provider '${providerId}' is not registered`)
    this.purposeRoutes.set(purpose, providerId)
  }

  getActiveRegistrationId(): string | null {
    return this.activeProviderId
  }
  onAvailable(listener: () => void): () => void { this.availabilityListeners.add(listener); return () => this.availabilityListeners.delete(listener) }

  clearSelection(): void {
    this.activeProviderId = null
  }

  clear(): void {
    this.activeProviderId = null
    this.providers.clear()
    this.purposeRoutes.clear()
  }

  remove(providerId: string): void {
    if (this.activeProviderId === providerId) this.activeProviderId = null
    this.providers.delete(providerId)
    for (const [purpose, route] of this.purposeRoutes) if (route === providerId) this.purposeRoutes.delete(purpose)
  }

  list(): readonly AIProvider[] {
    return [...this.providers.values()]
  }
}
