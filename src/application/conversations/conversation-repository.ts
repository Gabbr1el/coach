import type { ConversationMessage, ConversationRole } from '../../shared/contracts/conversation-contract'

export interface CreateConversationMessageRecord {
  readonly id: string
  readonly threadId: string
  readonly role: ConversationRole
  readonly content: string
  readonly createdAt: number
  readonly sequence: number
  readonly providerId: string | null
  readonly modelId: string | null
}

export interface ConversationRepository {
  ensureHomeThread(threadId: string, now: number): Promise<void>
  listMessages(threadId: string, limit: number): Promise<ConversationMessage[]>
  addTurn(records: {
    readonly threadId: string
    readonly user: Omit<CreateConversationMessageRecord, 'sequence'>
    readonly assistant: Omit<CreateConversationMessageRecord, 'sequence'>
  }): Promise<ConversationMessage[]>
}
