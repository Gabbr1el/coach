import type { PlannerActionRepository } from '../../application/planning/planner-action-service'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import type { CoachDatabase } from '../database/connection'

type Row = Omit<PlannerAction, 'payload' | 'result'> & { payloadJson: string; resultJson: string | null }
const columns = 'id, origin_message_id AS originMessageId, label, context_version AS contextVersion, type, status, payload_json AS payloadJson, result_json AS resultJson, created_at AS createdAt, resolved_at AS resolvedAt'

export class DrizzlePlannerActionRepository implements PlannerActionRepository {
  constructor(private readonly database: CoachDatabase) {}
  private map(row: Row): PlannerAction { return { ...row, payload: JSON.parse(row.payloadJson), result: row.resultJson ? JSON.parse(row.resultJson) : null } }
  listPending(): PlannerAction[] { return (this.database.sqlite.prepare(`SELECT ${columns} FROM planner_actions WHERE status = 'proposed' ORDER BY created_at DESC`).all() as Row[]).map((row) => this.map(row)) }
  find(id: string): PlannerAction | null { const row = this.database.sqlite.prepare(`SELECT ${columns} FROM planner_actions WHERE id = ?`).get(id) as Row | undefined; return row ? this.map(row) : null }
  create(action: PlannerAction, key: string): PlannerAction { const existing = this.database.sqlite.prepare('SELECT id FROM planner_actions WHERE idempotency_key = ?').get(key) as { id: string } | undefined; if (existing) return this.find(existing.id)!; this.database.sqlite.prepare('INSERT INTO planner_actions (id, origin_message_id, label, context_version, idempotency_key, type, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(action.id, action.originMessageId, action.label, action.contextVersion, key, action.type, action.status, JSON.stringify(action.payload), action.createdAt); return this.find(action.id)! }
  claim(id: string, now: number): PlannerAction { const changed = this.database.sqlite.prepare("UPDATE planner_actions SET status = 'applying', resolved_at = ? WHERE id = ? AND status = 'proposed'").run(now, id); if (changed.changes !== 1) throw new Error('Planner action is no longer pending'); return this.find(id)! }
  complete(id: string, status: 'applied' | 'rejected', result: unknown, now: number): PlannerAction { const changed = this.database.sqlite.prepare("UPDATE planner_actions SET status = ?, result_json = ?, resolved_at = ? WHERE id = ? AND status = 'applying'").run(status, result === null ? null : JSON.stringify(result), now, id); if (changed.changes !== 1) throw new Error('Planner action could not be completed'); return this.find(id)! }
  release(id: string): void { this.database.sqlite.prepare("UPDATE planner_actions SET status = 'proposed', resolved_at = NULL WHERE id = ? AND status = 'applying'").run(id) }
  invalidateSiblings(originMessageId: string, exceptId: string, now: number): void { this.database.sqlite.prepare("UPDATE planner_actions SET status = 'obsolete', resolved_at = ? WHERE origin_message_id = ? AND id <> ? AND status = 'proposed'").run(now, originMessageId, exceptId) }
  invalidatePending(contextVersion: number, now: number): void { this.database.sqlite.prepare("UPDATE planner_actions SET status = 'obsolete', resolved_at = ? WHERE status = 'proposed' AND context_version < ?").run(now, contextVersion) }
}
