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

  /**
   * Transitional optional fields:
   *
   * Eles são obrigatórios no banco novo, mas permanecem opcionais aqui
   * durante a migração da camada de aplicação.
   *
   * Isso permite preservar integralmente os fluxos antigos de OpenAI e
   * OpenAI-compatible enquanto atualizamos o serviço no próximo passo.
   *
   * O banco fornece defaults seguros:
   *
   * authKind         -> api-key
   * reasoningEffort  -> auto
   * isEnabled        -> true
   */
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

export interface ProviderConfigurationRepository {
  getActive(): Promise<ProviderConfiguration | null>

  findById(id: string): Promise<ProviderConfiguration | null>

  list(): Promise<ProviderConfiguration[]>

  createAndActivate(
    configuration: ProviderConfiguration,
  ): Promise<void>

  activate(
    id: string,
    updatedAt: number,
  ): Promise<void>

  remove(
    id: string,
  ): Promise<ProviderConfiguration | null>
}