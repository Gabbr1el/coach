import { z } from 'zod'

export const configureOpenAIInputSchema = z.object({
  apiKey: z.string().trim().min(20).max(512),
  model: z.string().trim().min(1).max(100).default('gpt-5-mini'),
}).strict()

export const providerIdSchema = z.enum(['openai'])

export type ConfigureOpenAIInput = z.infer<typeof configureOpenAIInputSchema>

export interface ProviderStatus {
  readonly configured: boolean
  readonly providerId: 'openai' | null
  readonly providerName: string | null
  readonly model: string | null
  readonly secureStorageAvailable: boolean
}

export interface ProviderApi {
  getStatus(): Promise<ProviderStatus>
  configureOpenAI(input: ConfigureOpenAIInput): Promise<ProviderStatus>
  disconnect(providerId: 'openai'): Promise<ProviderStatus>
}
