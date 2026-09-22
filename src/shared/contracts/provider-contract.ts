import { z } from 'zod'

import type {
  ProviderConnectorId,
  ReasoningEffort,
} from './provider-account-contract'

export const configureOpenAIInputSchema = z
  .object({
    label:
      z.string()
        .trim()
        .min(1)
        .max(60),

    apiKey:
      z.string()
        .trim()
        .min(20)
        .max(512),

    model:
      z.string()
        .trim()
        .min(1)
        .max(100)
        .default('gpt-5-mini'),

    persistence:
      z.enum([
        'secure-vault',
        'session',
      ])
        .default('secure-vault'),
  })
  .strict()

export const configureCompatibleInputSchema = z
  .object({
    connectorId:
      z.enum([
        'omniroute',
        'openai-compatible',
      ]),
    label:
      z.string()
        .trim()
        .min(1)
        .max(60),

    baseUrl:
      z.url()
        .max(500)
        .refine(
          (value) => {
            const url =
              new URL(value)

            return (
              !url.username
              && !url.password
              && !url.search
              && !url.hash
              && (
                url.protocol === 'https:'
                || (
                  url.protocol === 'http:'
                  && (
                    url.hostname === '127.0.0.1'
                    || url.hostname === '[::1]'
                  )
                )
              )
            )
          },
          'Invalid compatible provider URL',
        ),

    apiKey:
      z.string()
        .trim()
        .max(512),

    model:
      z.string()
        .trim()
        .max(150),

    persistence:
      z.enum([
        'secure-vault',
        'session',
      ])
        .default('session'),
  })
  .strict()
  .superRefine(
    (input, context) => {
      if (
        input.connectorId === 'omniroute'
        && !input.apiKey
      ) {
        context.addIssue({
          code: 'custom',
          path: ['apiKey'],
          message:
            'OmniRoute token is required',
        })
      }
    },
  )

export const providerAccountIdSchema =
  z.uuid()


export const githubCopilotOAuthFlowIdSchema =
  z.uuid()

export const beginGitHubCopilotOAuthInputSchema =
  z.object({
    accountId:
      providerAccountIdSchema.optional(),
  })
    .strict()
export const setProviderAccountEnabledInputSchema =
  z.object({
    accountId:
      providerAccountIdSchema,

    enabled:
      z.boolean(),
  })
    .strict()

export const updateProviderAccountInputSchema =
  z.object({
    accountId:
      providerAccountIdSchema,

    label:
      z.string()
        .trim()
        .min(1)
        .max(60),

    identityLabel:
      z.string()
        .trim()
        .min(1)
        .max(120)
        .nullable()
        .optional(),

    model:
      z.string()
        .trim()
        .min(1)
        .max(150),

    reasoningEffort:
      z.enum([
        'auto',
        'low',
        'medium',
        'high',
      ]),
  })
    .strict()

export type ConfigureOpenAIInput =
  z.infer<
    typeof configureOpenAIInputSchema
  >

export type ConfigureCompatibleInput =
  z.infer<
    typeof configureCompatibleInputSchema
  >

export type SetProviderAccountEnabledInput =
  z.infer<
    typeof setProviderAccountEnabledInputSchema
  >

export type UpdateProviderAccountInput =
  z.infer<
    typeof updateProviderAccountInputSchema
  >

export type ProviderConnectionState =
  | 'not-configured'
  | 'unchecked'
  | 'connected'
  | 'unreachable'

export type ProviderQuotaState =
  | 'unknown'
  | 'available'
  | 'exhausted'

export type ProviderRuntimeIssue =
  | 'available'
  | 'usage-limit'
  | 'temporarily-unavailable'
  | 'model-unavailable'
  | 'access-restricted'
  | 'reauth-required'


export interface ProviderAccountHealthSnapshot {
  readonly accountId:
    string

  readonly checkedAt:
    number

  readonly connectionState:
    ProviderConnectionState

  /**
   * null significa:
   *
   * - a conectividade foi verificada;
   * - o modelo ainda aparece no catálogo;
   * - mas não houve uma geração real suficiente
   *   para afirmar quota/disponibilidade de resposta.
   */
  readonly runtimeIssue:
    ProviderRuntimeIssue | null
}


export interface ProviderStatus {
  readonly configured: boolean
  readonly connected: boolean

  readonly connectionState:
    ProviderConnectionState

  readonly quota:
    ProviderQuotaState

  readonly providerId:
    ProviderConnectorId | null

  readonly providerName:
    string | null

  readonly model:
    string | null

  readonly secureStorageAvailable:
    boolean

  readonly activeAccountId:
    string | null

  readonly sessionOnly:
    boolean
}

export interface ProviderAccountSummary {
  readonly id: string

  readonly providerId:
    ProviderConnectorId

  readonly providerName:
    string

  readonly label:
    string

  readonly identityLabel?:
    string | null

  readonly model:
    string
  readonly reasoningEffort:
    ReasoningEffort

  readonly isEnabled:
    boolean

  readonly isActive:
    boolean

  readonly sessionOnly:
    boolean

  readonly baseUrl:
    string | null
}

export interface GitHubCopilotOAuthAuthorization {
  readonly flowId: string
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresAt: number
}

export type BeginGitHubCopilotOAuthResult =
  | {
      readonly ok: true
      readonly authorization: GitHubCopilotOAuthAuthorization
    }
  | {
      readonly ok: false
      readonly code: ProviderConnectionErrorCode
    }

export interface ProviderApi {
  getStatus():
    Promise<ProviderStatus>

  listAccounts():
    Promise<
      ProviderAccountSummary[]
    >

  listAvailableModels(
    accountId: string,
  ):
    Promise<readonly string[]>

  refreshHealth():
    Promise<
      ProviderAccountHealthSnapshot[]
    >

  /**
   * Executa um heartbeat funcional da IA ativa.
   *
   * Diferente de refreshHealth(), esta verificação
   * realmente pede uma resposta estruturada ao modelo.
   *
   * Não persiste conversa nem executa ações do Coach.
   */
  checkActiveFunctionalHealth():
    Promise<
      ProviderAccountHealthSnapshot | null
    >

  configureOpenAI(
    input:
      ConfigureOpenAIInput,
  ):
    Promise<ConfigureProviderResult>

  configureCompatible(
    input:
      ConfigureCompatibleInput,
  ):
    Promise<ConfigureProviderResult>

  beginGitHubCopilotOAuth(
    accountId?: string,
  ):
    Promise<BeginGitHubCopilotOAuthResult>

  completeGitHubCopilotOAuth(
    flowId: string,
  ):
    Promise<ConfigureProviderResult>


  selectAccount(
    accountId: string,
  ):
    Promise<ProviderStatus>

  setAccountEnabled(
    input:
      SetProviderAccountEnabledInput,
  ):
    Promise<ProviderStatus>

  updateAccount(
    input:
      UpdateProviderAccountInput,
  ):
    Promise<ProviderStatus>

  removeAccount(
    accountId: string,
  ):
    Promise<ProviderStatus>
}

export type ProviderConnectionErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'INSUFFICIENT_QUOTA'
  | 'MODEL_UNAVAILABLE'
  | 'ACCESS_RESTRICTED'
  | 'RATE_LIMITED'
  | 'NETWORK_UNAVAILABLE'
  | 'SECURE_STORAGE_UNAVAILABLE'
  | 'INVALID_CONFIGURATION'
  | 'ACCOUNT_DISABLED'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_LIMIT_REACHED'
  | 'OAUTH_CONFIGURATION_MISSING'
  | 'AUTH_CANCELLED'
  | 'UNKNOWN'

export type ConfigureProviderResult =
  | {
      readonly ok: true
      readonly status:
        ProviderStatus
    }
  | {
      readonly ok: false
      readonly code:
        ProviderConnectionErrorCode
    }
