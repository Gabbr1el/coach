import { and, eq } from 'drizzle-orm'
import type { ObserverRepository } from '../../application/observer/observer-service'
import type { CoachDatabase } from '../database/connection'
import { learningEvents } from '../database/schema/learning-events'
import { studySessions } from '../database/schema/study-workspaces'

export class DrizzleObserverRepository implements ObserverRepository {
  constructor(private readonly database: CoachDatabase) {}
  getActiveSession(workspaceId: string): { id: string } | null { return this.database.orm.select({ id: studySessions.id }).from(studySessions).where(and(eq(studySessions.workspaceId, workspaceId), eq(studySessions.status, 'active'))).get() ?? null }
  addEvent(input: { id: string; workspaceId: string; sessionId: string; type: string; payloadJson: string; createdAt: number }): void { this.database.sqlite.prepare('INSERT INTO learning_events (id, workspace_id, session_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(input.id, input.workspaceId, input.sessionId, input.type, input.payloadJson, input.createdAt) }
  listSession(workspaceId: string, sessionId: string): Array<{ type: string; payloadJson: string; createdAt: number }> { return this.database.sqlite.prepare('SELECT type, payload_json AS payloadJson, created_at AS createdAt FROM learning_events WHERE workspace_id = ? AND session_id = ? ORDER BY created_at ASC, rowid ASC').all(workspaceId, sessionId) as Array<{ type: string; payloadJson: string; createdAt: number }> }
}
