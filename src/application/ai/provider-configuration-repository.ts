import type {
  ProviderAuthKind,
  ProviderConnectorId,
  ReasoningEffort,
} from '../../shared/contracts/provider-account-contract'

export interface ProviderConfiguration {
  readonly id: string

  readonly providerId: ProviderConnectorId

  readonly displayName: string
  readonly label: string

  readonly authKind?: ProviderAuthKind
  readonly identityLabel?: string | null

  readonly baseUrl: string | null
  readonly model: string

  readonly reasoningEffort?: ReasoningEffort

  readonly secretReference: string

  readonly isEnabled?: boolean
  readonly isActive: boolean

  readonly createdAt: number
  readonly updatedAt: number
}

export interface UpdateProviderConfigurationInput {
  readonly label?: string
  readonly model?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly identityLabel?: string | null
  readonly baseUrl?: string | null
  readonly updatedAt: number
}

export interface ProviderConfigurationRepository {
  getActive(): Promise<ProviderConfiguration | null>

  findById(
    id: string,
  ): Promise<ProviderConfiguration | null>

  list(): Promise<ProviderConfiguration[]>

  createAndActivate(
    configuration: ProviderConfiguration,
  ): Promise<void>

  activate(
    id: string,
    updatedAt: number,
  ): Promise<void>

  setEnabled(
    id: string,
    enabled: boolean,
    updatedAt: number,
  ): Promise<ProviderConfiguration | null>

  update(
    id: string,
    input: UpdateProviderConfigurationInput,
  ): Promise<ProviderConfiguration | null>

  remove(
    id: string,
  ): Promise<ProviderConfiguration | null>
}