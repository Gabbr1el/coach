export interface ProviderConfiguration {
  readonly providerId: 'openai'
  readonly displayName: string
  readonly model: string
  readonly secretReference: string
  readonly isActive: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ProviderConfigurationRepository {
  getActive(): Promise<ProviderConfiguration | null>
  upsert(configuration: ProviderConfiguration): Promise<void>
  disconnect(providerId: 'openai', updatedAt: number): Promise<void>
}
