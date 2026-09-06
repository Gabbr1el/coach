import type { PlanningRepository } from '../../application/planning/planning-service'
import type { CoachDatabase } from '../database/connection'

export class DrizzlePlanningRepository implements PlanningRepository {
  constructor(private readonly database: CoachDatabase) {}
  createDeadline(input: { id: string; workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number; createdAt: number }): void { this.database.sqlite.prepare('INSERT INTO study_deadlines (id, workspace_id, title, due_at, estimated_minutes, mastery_percent, completed, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').run(input.id, input.workspaceId, input.title, input.dueAt, input.estimatedMinutes, input.masteryPercent, input.createdAt) }
  addRoutineNote(input: { id: string; content: string; createdAt: number }): void { this.database.sqlite.prepare('INSERT INTO routine_notes (id, content, created_at) VALUES (?, ?, ?)').run(input.id, input.content, input.createdAt) }
  listRoutineNotes(): string[] { return (this.database.sqlite.prepare('SELECT content FROM routine_notes ORDER BY created_at DESC LIMIT 20').all() as Array<{ content: string }>).map((item) => item.content) }
  getWorkspaceName(workspaceId: string): string { return (this.database.sqlite.prepare('SELECT name FROM workspaces WHERE id = ?').get(workspaceId) as { name: string } | undefined)?.name ?? 'Workspace' }
  listPriorityInputs(): Array<{ workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number; recentFocusSeconds: number }> { return this.database.sqlite.prepare(`SELECT d.workspace_id AS workspaceId, d.title, d.due_at AS dueAt, d.estimated_minutes AS estimatedMinutes, d.mastery_percent AS masteryPercent, COALESCE(SUM(CASE WHEN s.ended_at >= ? THEN s.focus_seconds ELSE 0 END),0) AS recentFocusSeconds FROM study_deadlines d JOIN workspaces w ON w.id = d.workspace_id LEFT JOIN study_sessions s ON s.workspace_id = d.workspace_id WHERE d.completed = 0 AND w.status = 'active' GROUP BY d.id`).all(this.nowMinusWeek()) as Array<{ workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number; recentFocusSeconds: number }> }
  private nowMinusWeek(): number { return Date.now() - 7 * 86_400_000 }
}
