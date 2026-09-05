import { z } from 'zod'

export const sendHomeMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
}).strict()

export type SendHomeMessageInput = z.infer<typeof sendHomeMessageInputSchema>

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
}
