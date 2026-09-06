import { desc, eq, max } from 'drizzle-orm'
import type { ConversationRepository, CreateConversationMessageRecord } from '../../application/conversations/conversation-repository'
import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type { CoachDatabase } from '../database/connection'
import { conversationMessages, conversationThreads } from '../database/schema/conversations'

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly database: CoachDatabase) {}

  async ensureHomeThread(threadId: string, now: number): Promise<void> {
    this.database.orm.insert(conversationThreads).values({
      id: threadId,
      scope: 'home',
      workspaceId: null,
      title: 'Planejamento acadêmico',
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run()
  }

  async ensureWorkspaceThread(threadId: string, workspaceId: string, title: string, now: number): Promise<void> {
    this.database.orm.insert(conversationThreads).values({
      id: threadId,
      scope: 'workspace',
      workspaceId,
      title,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run()
  }

  async listMessages(threadId: string, limit: number): Promise<ConversationMessage[]> {
    const rows = this.database.orm
      .select({
        id: conversationMessages.id,
        role: conversationMessages.role,
        content: conversationMessages.content,
        createdAt: conversationMessages.createdAt,
        sequence: conversationMessages.sequence,
        providerId: conversationMessages.providerId,
        modelId: conversationMessages.modelId,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(desc(conversationMessages.sequence))
      .limit(limit)
      .all()
    return rows.reverse()
  }

  async addTurn({ threadId, user, assistant }: {
    readonly threadId: string
    readonly user: Omit<CreateConversationMessageRecord, 'sequence'>
    readonly assistant: Omit<CreateConversationMessageRecord, 'sequence'>
  }): Promise<ConversationMessage[]> {
    return this.database.sqlite.transaction(() => {
      const row = this.database.orm.select({ value: max(conversationMessages.sequence) }).from(conversationMessages).where(eq(conversationMessages.threadId, threadId)).get()
      const sequence = (row?.value ?? 0) + 1
      const sequencedUser = { ...user, sequence }
      const sequencedAssistant = { ...assistant, sequence: sequence + 1 }
      this.database.orm.insert(conversationMessages).values([sequencedUser, sequencedAssistant]).run()
      return [sequencedUser, sequencedAssistant]
    })()
  }
}
