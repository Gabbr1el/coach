export interface AIProviderCapabilities {
  readonly streaming: boolean
  readonly usageInformation: boolean
  readonly supportedInput: readonly ('text' | 'image' | 'document')[]
}

export interface CanonicalAIMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

export interface AIRequest {
  readonly messages: readonly CanonicalAIMessage[]
  readonly model?: string
  readonly maxOutputTokens: number
  readonly signal?: AbortSignal
}

export interface AIResponse {
  readonly content: string
  readonly providerId: string
  readonly modelId: string
  readonly usage?: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

export type AIStreamEvent =
  | { readonly type: 'text-delta'; readonly content: string }
  | { readonly type: 'completed'; readonly response: AIResponse }

export interface AIProvider {
  readonly id: string
  readonly name: string
  testConnection(): Promise<void>
  sendMessage(request: AIRequest): Promise<AIResponse>
  streamMessage?(request: AIRequest): AsyncIterable<AIStreamEvent>
  getCapabilities(): AIProviderCapabilities
}
