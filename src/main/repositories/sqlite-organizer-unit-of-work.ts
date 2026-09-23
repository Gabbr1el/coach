import type { OrganizerCommit, OrganizerCommitResult, OrganizerUnitOfWork } from '../../application/conversations/organizer-unit-of-work'
import { organizerConversationStateSchema } from '../../shared/contracts/organizer-conversation-state-contract'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import type { ConversationMessage } from '../../shared/contracts/conversation-contract'
import type { HomeOrganizerResult } from '../../shared/contracts/planning-contract'
import type { CoachDatabase } from '../database/connection'
import { conversationMessages, conversationThreads } from '../database/schema/conversations'

export type OrganizerCommitBoundary = 'ensureHomeThread' | 'state' | 'action' | 'turn'

export class SqliteOrganizerUnitOfWork implements OrganizerUnitOfWork {
  constructor(private readonly database: CoachDatabase, private readonly failAt?: (boundary: OrganizerCommitBoundary) => void) {}

  async find(requestId: string, threadId: string, content: string): Promise<OrganizerCommitResult | null> {
    return this.readCommitted(requestId, threadId, content)
  }

  async commit(input: OrganizerCommit, signal?: AbortSignal): Promise<OrganizerCommitResult> {
    signal?.throwIfAborted()
    return this.database.sqlite.transaction(() => {
      const replay = this.readCommitted(input.requestId, input.turn.threadId, input.turn.user.content)
      if (replay) return replay
      this.database.orm.insert(conversationThreads).values({ id: input.turn.threadId, scope: 'home', workspaceId: null, title: 'Planejamento acadêmico', createdAt: input.turn.now, updatedAt: input.turn.now }).onConflictDoNothing().run()
      this.failAt?.('ensureHomeThread')

      if (input.state) {
        const state = organizerConversationStateSchema.parse(input.state)
        this.database.sqlite.prepare('INSERT INTO organizer_conversation_states (thread_id,state_json,updated_at) VALUES (?,?,?) ON CONFLICT(thread_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').run(input.turn.threadId, JSON.stringify(state), state.updatedAt)
      }
      this.failAt?.('state')

      const actions: PlannerAction[] = []
      for (const { action, idempotencyKey } of input.actions) {
        const existing = this.database.sqlite.prepare('SELECT id FROM planner_actions WHERE idempotency_key=?').get(idempotencyKey) as { id: string } | undefined
        if (existing) throw new Error('Organizer turn was already committed')
        this.database.sqlite.prepare('INSERT INTO planner_actions (id,origin_message_id,label,context_version,idempotency_key,type,status,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(action.id, action.originMessageId, action.label, action.contextVersion, idempotencyKey, action.type, action.status, JSON.stringify(action.payload), action.createdAt)
        actions.push(action)
      }
      this.failAt?.('action')

      const row = this.database.sqlite.prepare('SELECT MAX(sequence) AS value FROM conversation_messages WHERE thread_id=?').get(input.turn.threadId) as { value: number | null }
      const sequence = (row?.value ?? 0) + 1
      const user = { ...input.turn.user, sequence }
      const assistant = { ...input.turn.assistant, sequence: sequence + 1 }
      this.database.orm.insert(conversationMessages).values([user, assistant]).run()
      this.failAt?.('turn')
      const result = input.actions.length ? { ...input.result, actions } : input.result
      this.database.sqlite.prepare('INSERT INTO organizer_requests (request_id,thread_id,content,user_message_id,assistant_message_id,result_json,created_at) VALUES (?,?,?,?,?,?,?)').run(input.requestId, input.turn.threadId, input.turn.user.content, user.id, assistant.id, JSON.stringify(result), input.turn.now)
      return { messages: [this.publicMessage(user), this.publicMessage(assistant)], actions, result }
    })()
  }

  private readCommitted(requestId: string, threadId: string, content: string): OrganizerCommitResult | null {
    const row = this.database.sqlite.prepare(`SELECT r.thread_id AS threadId,r.content,r.result_json AS resultJson,
      u.id AS userId,u.role AS userRole,u.content AS userContent,u.created_at AS userCreatedAt,u.sequence AS userSequence,u.provider_id AS userProviderId,u.model_id AS userModelId,
      a.id AS assistantId,a.role AS assistantRole,a.content AS assistantContent,a.created_at AS assistantCreatedAt,a.sequence AS assistantSequence,a.provider_id AS assistantProviderId,a.model_id AS assistantModelId
      FROM organizer_requests r JOIN conversation_messages u ON u.id=r.user_message_id JOIN conversation_messages a ON a.id=r.assistant_message_id WHERE r.request_id=?`).get(requestId) as Record<string, unknown> | undefined
    if (!row) return null
    if (row.threadId !== threadId || row.content !== content) throw new Error('Organizer requestId was reused with different input')
    const messages: ConversationMessage[] = [
      { id: row.userId as string, role: row.userRole as ConversationMessage['role'], content: row.userContent as string, createdAt: row.userCreatedAt as number, sequence: row.userSequence as number, providerId: row.userProviderId as string | null, modelId: row.userModelId as string | null },
      { id: row.assistantId as string, role: row.assistantRole as ConversationMessage['role'], content: row.assistantContent as string, createdAt: row.assistantCreatedAt as number, sequence: row.assistantSequence as number, providerId: row.assistantProviderId as string | null, modelId: row.assistantModelId as string | null },
    ]
    const result = JSON.parse(row.resultJson as string) as HomeOrganizerResult
    return { messages, actions: result.actions, result }
  }

  private publicMessage(message: OrganizerCommit['turn']['user'] & { sequence: number } | OrganizerCommit['turn']['assistant'] & { sequence: number }): ConversationMessage {
    const { id, role, content, createdAt, sequence, providerId, modelId } = message
    return { id, role, content, createdAt, sequence, providerId, modelId }
  }

}
