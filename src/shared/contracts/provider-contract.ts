import { z } from 'zod'

export const configureOpenAIInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(20).max(512),
  model: z.string().trim().min(1).max(100).default('gpt-5-mini'),
  persistence: z.enum(['secure-vault', 'session']).default('secure-vault'),
}).strict()

export const configureCompatibleInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  baseUrl: z.url().max(500).refine((value) => {
    const url = new URL(value)
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]')))
  }, 'Invalid compatible provider URL'),
  apiKey: z.string().trim().min(1).max(512),
  model: z.string().trim().min(1).max(150),
  persistence: z.enum(['secure-vault', 'session']).default('session'),
}).strict()

export const providerAccountIdSchema = z.uuid()

export type ConfigureOpenAIInput = z.infer<typeof configureOpenAIInputSchema>
export type ConfigureCompatibleInput = z.infer<typeof configureCompatibleInputSchema>

export interface ProviderStatus {
  readonly configured: boolean
  readonly providerId: 'openai' | 'openai-compatible' | null
  readonly providerName: string | null
  readonly model: string | null
  readonly secureStorageAvailable: boolean
  readonly activeAccountId: string | null
  readonly sessionOnly: boolean
}

export interface ProviderAccountSummary {
  readonly id: string
  readonly providerId: 'openai' | 'openai-compatible'
  readonly providerName: string
  readonly label: string
  readonly model: string
  readonly isActive: boolean
  readonly sessionOnly: boolean
  readonly baseUrl: string | null
}

export interface ProviderApi {
  getStatus(): Promise<ProviderStatus>
  listAccounts(): Promise<ProviderAccountSummary[]>
  configureOpenAI(input: ConfigureOpenAIInput): Promise<ConfigureProviderResult>
  configureCompatible(input: ConfigureCompatibleInput): Promise<ConfigureProviderResult>
  selectAccount(accountId: string): Promise<ProviderStatus>
  removeAccount(accountId: string): Promise<ProviderStatus>
}

export type ProviderConnectionErrorCode = 'INVALID_CREDENTIAL' | 'INSUFFICIENT_QUOTA' | 'MODEL_UNAVAILABLE' | 'ACCESS_RESTRICTED' | 'RATE_LIMITED' | 'NETWORK_UNAVAILABLE' | 'SECURE_STORAGE_UNAVAILABLE' | 'INVALID_CONFIGURATION' | 'UNKNOWN'

export type ConfigureProviderResult =
  | { readonly ok: true; readonly status: ProviderStatus }
  | { readonly ok: false; readonly code: ProviderConnectionErrorCode }
