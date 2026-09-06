export interface ProviderConfiguration {
  readonly id: string
  readonly providerId: 'openai'
  readonly displayName: string
  readonly label: string
  readonly model: string
  readonly secretReference: string
  readonly isActive: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ProviderConfigurationRepository {
  getActive(): Promise<ProviderConfiguration | null>
  findById(id: string): Promise<ProviderConfiguration | null>
  list(): Promise<ProviderConfiguration[]>
  createAndActivate(configuration: ProviderConfiguration): Promise<void>
  activate(id: string, updatedAt: number): Promise<void>
  remove(id: string): Promise<ProviderConfiguration | null>
}
