import { z } from 'zod'

/**
 * Quantidade máxima de contas de IA criadas pelo usuário.
 *
 * Providers/fallbacks internos que não representam uma conta persistida
 * pelo usuário não entram neste limite.
 */
export const MAX_PROVIDER_ACCOUNTS = 10

/**
 * Conectores conhecidos pelo Coach.
 *
 * Conector != modelo.
 *
 * Exemplos:
 * connectorId = 'gemini'
 * model = 'gemini-...'
 *
 * connectorId = 'omniroute'
 * model = 'codex/gpt-5.6-sol'
 */
export const providerConnectorIds = [
  'openai',  'gemini',
  'github-copilot',
  'anthropic',
  'omniroute',
  'openai-compatible',
  'ollama',
] as const

export const providerConnectorIdSchema =
  z.enum(providerConnectorIds)

export type ProviderConnectorId =
  z.infer<typeof providerConnectorIdSchema>

/**
 * Maneira pela qual o Coach obtém autorização para utilizar o conector.
 */
export const providerAuthKinds = [
  'api-key',
  'oauth',
  'endpoint-token',
  'local',
] as const

export const providerAuthKindSchema =
  z.enum(providerAuthKinds)

export type ProviderAuthKind =
  z.infer<typeof providerAuthKindSchema>

/**
 * Configuração genérica de esforço de raciocínio.
 *
 * Cada adapter é responsável por traduzir estes valores para aquilo que
 * seu provider/modelo realmente suporta.
 *
 * "auto" significa que o Coach/provider decide.
 */
  | 'oauth'

export const reasoningEfforts = [
  'auto',
  'low',
  'medium',
  'high',
] as const

export const reasoningEffortSchema =
  z.enum(reasoningEfforts)

export type ReasoningEffort =
  z.infer<typeof reasoningEffortSchema>

/**
 * Organização visual da central de conexões.
 */
export const providerConnectorCategories = [
  'recommended',
  'advanced',
  'local',
] as const

export const providerConnectorCategorySchema =
  z.enum(providerConnectorCategories)

export type ProviderConnectorCategory =
  z.infer<typeof providerConnectorCategorySchema>

/**
 * Estado administrativo da conta.
 *
 * enabled:
 *   pode ser usada pelo Coach.
 *
 * disabled:
 *   continua salva e conectada, mas o Coach não pode utilizá-la.
 */
export const providerAccountAvailabilities = [
  'enabled',
  'disabled',
] as const

export const providerAccountAvailabilitySchema =
  z.enum(providerAccountAvailabilities)

export type ProviderAccountAvailability =
  z.infer<typeof providerAccountAvailabilitySchema>

/**
 * Representação segura de uma conta para application/renderer.
 *
 * Este objeto NUNCA deve carregar:
 * - API key
 * - access token
 * - refresh token
 * - client secret
 */
export interface ProviderAccountDescriptor {
  readonly id: string

  readonly connectorId: ProviderConnectorId
  readonly providerName: string

  /**
   * Nome escolhido pelo usuário.
   *
   * Exemplos:
   * "Gemini pessoal"
   * "OmniRoute principal"
   * "Claude faculdade"
   */
  readonly label: string

  readonly authKind: ProviderAuthKind

  /**
   * Identidade pública/exibível associada à conexão.
   *
   * OAuth:
   * "usuario@gmail.com"
   *
   * Local:
   * "Este computador"
   *
   * Pode ser null quando não existe uma identidade útil.
   */
  readonly identityLabel: string | null

  readonly model: string

  readonly reasoningEffort: ReasoningEffort

  readonly availability: ProviderAccountAvailability

  /**
   * Conta principal usada quando não existe uma rota específica
   * configurada para Tutor, Planner, Roadmap etc.
   */
  readonly isActive: boolean

  /**
   * true quando a conta/credencial só existe em memória e será perdida
   * ao fechar o Coach.
   */
  readonly sessionOnly: boolean

  /**
   * Endpoint somente quando o conector realmente precisa dele.
   *
   * Não deve aparecer para providers oficiais que possuem endpoint
   * conhecido internamente pelo adapter.
   */
  readonly baseUrl: string | null
}

/**
 * Metadados necessários para a tela "Conectar IA".
 *
 * Não contém credenciais.
 */
export interface ProviderConnectorDescriptor {
  readonly id: ProviderConnectorId
  readonly name: string
  readonly category: ProviderConnectorCategory

  readonly authKinds: readonly ProviderAuthKind[]

  readonly supportsMultipleAccounts: boolean
  readonly supportsModelSelection: boolean
  readonly supportsReasoningEffort: boolean

  readonly available: boolean
  readonly unavailableReason: string | null
}