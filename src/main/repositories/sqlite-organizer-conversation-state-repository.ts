import { emptyOrganizerConversationState, organizerConversationStateSchema, type OrganizerConversationState } from '../../shared/contracts/organizer-conversation-state-contract'
import type { OrganizerConversationStateRepository } from '../../application/conversations/organizer-conversation-state-repository'
import type { CoachDatabase } from '../database/connection'

export class SqliteOrganizerConversationStateRepository implements OrganizerConversationStateRepository {
  constructor(private readonly database: CoachDatabase) {}

  load(threadId: string): OrganizerConversationState {
    const row = this.database.sqlite.prepare('SELECT state_json AS stateJson FROM organizer_conversation_states WHERE thread_id=?').get(threadId) as { stateJson: string } | undefined
    if (!row) return emptyOrganizerConversationState()
    try {
      const parsed = organizerConversationStateSchema.safeParse(JSON.parse(row.stateJson))
      if (parsed.success) return parsed.data
    } catch {}
    this.clear(threadId)
    return emptyOrganizerConversationState()
  }

  save(threadId: string, state: OrganizerConversationState): OrganizerConversationState {
    const parsed = organizerConversationStateSchema.parse(state)
    this.database.sqlite.prepare('INSERT INTO organizer_conversation_states (thread_id,state_json,updated_at) VALUES (?,?,?) ON CONFLICT(thread_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').run(threadId, JSON.stringify(parsed), parsed.updatedAt)
    return parsed
  }

  clear(threadId: string): void {
    this.database.sqlite.prepare('DELETE FROM organizer_conversation_states WHERE thread_id=?').run(threadId)
  }
}
