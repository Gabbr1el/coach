import { z } from 'zod'

export const sendHomeMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
}).strict()

export const streamHomeMessageInputSchema = sendHomeMessageInputSchema.extend({
  requestId: z.uuid(),
}).strict()

export const cancelHomeStreamInputSchema = z.object({ requestId: z.uuid() }).strict()

export type SendHomeMessageInput = z.infer<typeof sendHomeMessageInputSchema>
export type StreamHomeMessageInput = z.infer<typeof streamHomeMessageInputSchema>

export type ConversationRole = 'user' | 'assistant' | 'system'

export interface ConversationMessage {
  readonly id: string
  readonly role: ConversationRole
  readonly content: string
  readonly createdAt: number
  readonly sequence: number
  readonly providerId: string | null
  readonly modelId: string | null
}

export interface ConversationApi {
  listHomeMessages(): Promise<ConversationMessage[]>
  sendHomeMessage(input: SendHomeMessageInput): Promise<ConversationMessage[]>
  streamHomeMessage(input: StreamHomeMessageInput, onEvent: (event: HomeStreamEvent) => void): {
    cancel(): void
    dispose(): void
  }
}

export type HomeStreamEvent =
  | { readonly requestId: string; readonly type: 'started' }
  | { readonly requestId: string; readonly type: 'text-delta'; readonly content: string }
  | { readonly requestId: string; readonly type: 'completed'; readonly messages: ConversationMessage[] }
  | { readonly requestId: string; readonly type: 'cancelled' }
  | { readonly requestId: string; readonly type: 'error'; readonly code: 'PROVIDER_UNAVAILABLE' | 'REQUEST_FAILED' | 'THREAD_BUSY' }
