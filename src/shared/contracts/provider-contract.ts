import { z } from 'zod'

export const configureOpenAIInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(20).max(512),
  model: z.string().trim().min(1).max(100).default('gpt-5-mini'),
}).strict()

export const providerAccountIdSchema = z.uuid()

export type ConfigureOpenAIInput = z.infer<typeof configureOpenAIInputSchema>

export interface ProviderStatus {
  readonly configured: boolean
  readonly providerId: 'openai' | null
  readonly providerName: string | null
  readonly model: string | null
  readonly secureStorageAvailable: boolean
  readonly activeAccountId: string | null
}

export interface ProviderAccountSummary {
  readonly id: string
  readonly providerId: 'openai'
  readonly providerName: string
  readonly label: string
  readonly model: string
  readonly isActive: boolean
}

export interface ProviderApi {
  getStatus(): Promise<ProviderStatus>
  listAccounts(): Promise<ProviderAccountSummary[]>
  configureOpenAI(input: ConfigureOpenAIInput): Promise<ProviderStatus>
  selectAccount(accountId: string): Promise<ProviderStatus>
  removeAccount(accountId: string): Promise<ProviderStatus>
}
