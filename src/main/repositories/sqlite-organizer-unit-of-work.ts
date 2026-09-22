import type { OrganizerCommit, OrganizerCommitResult, OrganizerUnitOfWork } from '../../application/conversations/organizer-unit-of-work'
import { organizerConversationStateSchema } from '../../shared/contracts/organizer-conversation-state-contract'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import type { CoachDatabase } from '../database/connection'
import { conversationMessages, conversationThreads } from '../database/schema/conversations'

export type OrganizerCommitBoundary = 'ensureHomeThread' | 'state' | 'action' | 'turn'

export class SqliteOrganizerUnitOfWork implements OrganizerUnitOfWork {
  constructor(private readonly database: CoachDatabase, private readonly failAt?: (boundary: OrganizerCommitBoundary) => void) {}

  async commit(input: OrganizerCommit, signal?: AbortSignal): Promise<OrganizerCommitResult> {
    signal?.throwIfAborted()
    return this.database.sqlite.transaction(() => {
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
      return { messages: [user, assistant], actions }
    })()
  }

}
