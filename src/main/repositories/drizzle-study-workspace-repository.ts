import { and, asc, eq } from 'drizzle-orm'
import type { StudyWorkspaceRepository } from '../../application/study-workspaces/study-workspace-repository'
import type { DailyStudyReport, StudyPlanItem, StudySessionSummary, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'
import type { CoachDatabase } from '../database/connection'
import { studyPlanItems, studySessions, workspaceStudyStates } from '../database/schema/study-workspaces'

export class DrizzleStudyWorkspaceRepository implements StudyWorkspaceRepository {
  constructor(private readonly database: CoachDatabase) {}

  async findState(workspaceId: string, now: number): Promise<StudyWorkspaceState | null> {
    const state = this.database.orm.select().from(workspaceStudyStates).where(eq(workspaceStudyStates.workspaceId, workspaceId)).get()
    if (!state) return null
    const session = this.database.orm.select().from(studySessions).where(eq(studySessions.id, state.activeSessionId)).get()
    if (!session) throw new Error('Active study session is missing')
    const plan = this.database.orm.select({ id: studyPlanItems.id, title: studyPlanItems.title, durationMinutes: studyPlanItems.durationMinutes, position: studyPlanItems.position, status: studyPlanItems.status }).from(studyPlanItems).where(eq(studyPlanItems.sessionId, state.activeSessionId)).orderBy(asc(studyPlanItems.position)).all()
    return { workspaceId, sessionId: state.activeSessionId, sessionStartedAt: session.startedAt, fileName: state.fileName, language: state.language, editorContent: state.editorContent, notes: state.notes, shareContextWithAi: state.shareContextWithAi, timerDurationSeconds: state.timerDurationSeconds, timerRemainingSeconds: state.timerRemainingSeconds, timerStatus: state.timerStatus, timerStartedAt: state.timerStartedAt, plan, updatedAt: state.updatedAt, documentRevision: state.documentRevision, notesRevision: state.notesRevision, accumulatedFocusSeconds: state.accumulatedFocusSeconds }
  }

  async createState(input: StudyWorkspaceState): Promise<StudyWorkspaceState> {
    this.database.sqlite.transaction(() => {
      this.database.orm.insert(studySessions).values({ id: input.sessionId, workspaceId: input.workspaceId, status: 'active', startedAt: input.sessionStartedAt, focusSeconds: 0 }).run()
      this.database.orm.insert(workspaceStudyStates).values({ workspaceId: input.workspaceId, activeSessionId: input.sessionId, fileName: input.fileName, language: input.language, editorContent: input.editorContent, notes: input.notes, shareContextWithAi: input.shareContextWithAi, timerDurationSeconds: input.timerDurationSeconds, timerRemainingSeconds: input.timerRemainingSeconds, timerStatus: input.timerStatus, timerStartedAt: input.timerStartedAt, updatedAt: input.updatedAt, documentRevision: input.documentRevision, notesRevision: input.notesRevision, accumulatedFocusSeconds: input.accumulatedFocusSeconds }).run()
      this.database.orm.insert(studyPlanItems).values(input.plan.map((item) => ({ ...item, workspaceId: input.workspaceId, sessionId: input.sessionId, createdAt: input.updatedAt, updatedAt: input.updatedAt }))).run()
    })()
    return input
  }

  async saveDocument(workspaceId: string, fileName: string, language: string, content: string, revision: number, now: number): Promise<void> {
    this.database.sqlite.prepare('UPDATE workspace_study_states SET file_name = ?, language = ?, editor_content = ?, document_revision = ?, updated_at = ? WHERE workspace_id = ? AND document_revision < ?').run(fileName, language, content, revision, now, workspaceId, revision)
  }

  async saveNotes(workspaceId: string, notes: string, revision: number, now: number): Promise<void> {
    this.database.sqlite.prepare('UPDATE workspace_study_states SET notes = ?, notes_revision = ?, updated_at = ? WHERE workspace_id = ? AND notes_revision < ?').run(notes, revision, now, workspaceId, revision)
  }
  async updateContextSharing(workspaceId: string, enabled: boolean, now: number): Promise<void> {
    this.database.orm.update(workspaceStudyStates).set({ shareContextWithAi: enabled, updatedAt: now }).where(eq(workspaceStudyStates.workspaceId, workspaceId)).run()
  }

  async replacePlanStatuses(workspaceId: string, sessionId: string, statuses: ReadonlyArray<{ id: string; status: StudyPlanItem['status'] }>, now: number): Promise<void> {
    this.database.sqlite.transaction(() => {
      const active = this.database.sqlite.prepare('SELECT 1 FROM workspace_study_states WHERE workspace_id = ? AND active_session_id = ?').get(workspaceId, sessionId)
      if (!active) throw new Error('Study session changed while updating plan')
      this.database.orm.update(studyPlanItems).set({ status: 'pending', updatedAt: now }).where(and(eq(studyPlanItems.workspaceId, workspaceId), eq(studyPlanItems.sessionId, sessionId))).run()
      for (const item of statuses) this.database.orm.update(studyPlanItems).set({ status: item.status, updatedAt: now }).where(and(eq(studyPlanItems.workspaceId, workspaceId), eq(studyPlanItems.sessionId, sessionId), eq(studyPlanItems.id, item.id))).run()
    })()
  }

  async updateTimer(workspaceId: string, sessionId: string, timer: Pick<StudyWorkspaceState, 'timerStatus' | 'timerRemainingSeconds' | 'timerStartedAt' | 'accumulatedFocusSeconds'>, now: number): Promise<void> {
    const result = this.database.orm.update(workspaceStudyStates).set({ ...timer, updatedAt: now }).where(and(eq(workspaceStudyStates.workspaceId, workspaceId), eq(workspaceStudyStates.activeSessionId, sessionId))).run()
    if (result.changes !== 1) throw new Error('Study session changed while updating timer')
  }

  async setTimerDuration(workspaceId: string, sessionId: string, durationSeconds: number, now: number): Promise<void> {
    const result = this.database.sqlite.prepare("UPDATE workspace_study_states SET timer_duration_seconds = ?, timer_remaining_seconds = ?, timer_status = 'idle', timer_started_at = NULL, updated_at = ? WHERE workspace_id = ? AND active_session_id = ?").run(durationSeconds, durationSeconds, now, workspaceId, sessionId)
    if (result.changes !== 1) throw new Error('Study session changed while updating timer duration')
  }

  flushDrafts(input: { workspaceId: string; fileName: string; language: string; content: string; notes: string; documentRevision: number; notesRevision: number; now: number }): void {
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('UPDATE workspace_study_states SET file_name = ?, language = ?, editor_content = ?, document_revision = ?, updated_at = ? WHERE workspace_id = ? AND document_revision < ?').run(input.fileName, input.language, input.content, input.documentRevision, input.now, input.workspaceId, input.documentRevision)
      this.database.sqlite.prepare('UPDATE workspace_study_states SET notes = ?, notes_revision = ?, updated_at = ? WHERE workspace_id = ? AND notes_revision < ?').run(input.notes, input.notesRevision, input.now, input.workspaceId, input.notesRevision)
    })()
  }

  completeAndCreateSession(workspaceId: string, currentSessionId: string, nextSessionId: string, plan: StudyPlanItem[], focusSeconds: number, timerDurationSeconds: number, now: number): void {
    this.database.sqlite.transaction(() => {
      const completed = this.database.sqlite.prepare("UPDATE study_sessions SET status = 'completed', ended_at = ?, focus_seconds = ? WHERE id = ? AND workspace_id = ? AND status = 'active'").run(now, focusSeconds, currentSessionId, workspaceId)
      if (completed.changes !== 1) throw new Error('Study session was already completed')
      this.database.orm.insert(studySessions).values({ id: nextSessionId, workspaceId, status: 'active', startedAt: now, focusSeconds: 0 }).run()
      this.database.orm.insert(studyPlanItems).values(plan.map((item) => ({ ...item, workspaceId, sessionId: nextSessionId, createdAt: now, updatedAt: now }))).run()
      const changed = this.database.orm.update(workspaceStudyStates).set({ activeSessionId: nextSessionId, timerStatus: 'idle', timerStartedAt: null, timerRemainingSeconds: timerDurationSeconds, accumulatedFocusSeconds: 0, updatedAt: now }).where(and(eq(workspaceStudyStates.workspaceId, workspaceId), eq(workspaceStudyStates.activeSessionId, currentSessionId))).run()
      if (changed.changes !== 1) throw new Error('Study session changed while completing')
      const metrics = this.database.sqlite.prepare("SELECT SUM(type = 'execution_error') AS errors, SUM(type = 'code_executed') AS successes, SUM(type = 'possible_learning_loop') AS loops, SUM(type = 'window_blurred') AS exits FROM learning_events WHERE session_id = ?").get(currentSessionId) as { errors: number | null; successes: number | null; loops: number | null; exits: number | null }
      const summary = `Sessão de ${Math.floor(focusSeconds / 60)} minutos focados; ${metrics.successes ?? 0} execuções bem-sucedidas; ${metrics.errors ?? 0} erros; ${metrics.loops ?? 0} loops; ${metrics.exits ?? 0} saídas de foco.`
      this.database.sqlite.prepare('INSERT INTO session_memories (id, session_id, summary, created_at) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), currentSessionId, summary, now)
      const recent = this.database.sqlite.prepare('SELECT summary FROM session_memories sm JOIN study_sessions s ON s.id = sm.session_id WHERE s.workspace_id = ? ORDER BY s.ended_at DESC, s.started_at DESC, sm.rowid DESC LIMIT 8').all(workspaceId) as Array<{ summary: string }>
      this.database.sqlite.prepare('INSERT INTO workspace_memories (id, workspace_id, summary, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at').run(crypto.randomUUID(), workspaceId, recent.map((item) => item.summary).join('\n'), now)
    })()
  }

  listSessionHistory(workspaceId: string, limit: number): DailyStudyReport[] {
    const sessions = this.database.sqlite.prepare(`SELECT s.id, s.started_at AS startedAt, s.ended_at AS endedAt, s.focus_seconds AS focusSeconds,
      SUM(CASE WHEN e.type IN ('code_executed','execution_error') THEN 1 ELSE 0 END) AS executions,
      SUM(CASE WHEN e.type = 'execution_error' THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN e.type = 'possible_learning_loop' THEN 1 ELSE 0 END) AS interventions,
      SUM(CASE WHEN e.type = 'window_blurred' THEN 1 ELSE 0 END) AS focusExits,
      (SELECT COUNT(*) FROM study_plan_items p WHERE p.session_id = s.id AND p.status = 'completed') AS completedPlanItems
      FROM study_sessions s LEFT JOIN learning_events e ON e.session_id = s.id
      WHERE s.workspace_id = ? AND s.status = 'completed' GROUP BY s.id ORDER BY s.started_at DESC LIMIT ?`).all(workspaceId, limit) as StudySessionSummary[]
    const enriched = sessions.map((session) => {
      const successRate = session.executions ? Math.round(Math.max(0, session.executions - session.errors) / session.executions * 100) : 100
      const elapsed = Math.max(1, Math.floor((session.endedAt - session.startedAt) / 1000))
      const focusRetentionPercent = Math.min(100, Math.round(session.focusSeconds / elapsed * 100))
      const recommendation = successRate < 50 ? 'Revise o conceito ativo antes de avançar e use uma pista curta.' : session.focusExits >= 3 ? 'Faça o próximo sprint em 15 minutos e elimine uma distração.' : 'Avance para prática independente e explique sua solução.'
      return { ...session, successRate, focusRetentionPercent, recommendation }
    })
    const reports = new Map<string, typeof enriched>()
    for (const session of enriched) { const date = new Date(session.startedAt).toLocaleDateString('en-CA'); reports.set(date, [...(reports.get(date) ?? []), session]) }
    return [...reports.entries()].map(([date, day]) => { const focusSeconds = day.reduce((sum, item) => sum + item.focusSeconds, 0); const executions = day.reduce((sum, item) => sum + item.executions, 0); const errors = day.reduce((sum, item) => sum + item.errors, 0); const elapsed = day.reduce((sum, item) => sum + Math.max(1, Math.floor((item.endedAt - item.startedAt) / 1000)), 0); const successRate = executions ? Math.round(Math.max(0, executions - errors) / executions * 100) : 100; const focusExits = day.reduce((sum, item) => sum + item.focusExits, 0); return { date, startedAt: Math.min(...day.map((item) => item.startedAt)), endedAt: Math.max(...day.map((item) => item.endedAt)), focusSeconds, executions, errors, interventions: day.reduce((sum, item) => sum + item.interventions, 0), focusExits, completedPlanItems: day.reduce((sum, item) => sum + item.completedPlanItems, 0), successRate, focusRetentionPercent: Math.min(100, Math.round(focusSeconds / elapsed * 100)), sessionCount: day.length, recommendation: successRate < 50 ? 'Revise o conceito ativo antes de avançar e use uma pista curta.' : focusExits >= 3 ? 'Faça o próximo sprint em 15 minutos e elimine uma distração.' : 'Avance para prática independente e explique sua solução.' } })
  }
}
