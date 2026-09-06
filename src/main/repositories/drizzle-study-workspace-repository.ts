import { and, asc, eq } from 'drizzle-orm'
import type { StudyWorkspaceRepository } from '../../application/study-workspaces/study-workspace-repository'
import type { StudyPlanItem, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'
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
    return { workspaceId, sessionId: state.activeSessionId, sessionStartedAt: session.startedAt, fileName: state.fileName, language: state.language, editorContent: state.editorContent, notes: state.notes, shareContextWithAi: state.shareContextWithAi, timerDurationSeconds: state.timerDurationSeconds, timerRemainingSeconds: state.timerRemainingSeconds, timerStatus: state.timerStatus, timerStartedAt: state.timerStartedAt, plan, updatedAt: state.updatedAt, documentRevision: state.documentRevision, notesRevision: state.notesRevision }
  }

  async createState(input: StudyWorkspaceState): Promise<StudyWorkspaceState> {
    this.database.sqlite.transaction(() => {
      this.database.orm.insert(studySessions).values({ id: input.sessionId, workspaceId: input.workspaceId, status: 'active', startedAt: input.sessionStartedAt, focusSeconds: 0 }).run()
      this.database.orm.insert(workspaceStudyStates).values({ workspaceId: input.workspaceId, activeSessionId: input.sessionId, fileName: input.fileName, language: input.language, editorContent: input.editorContent, notes: input.notes, shareContextWithAi: input.shareContextWithAi, timerDurationSeconds: input.timerDurationSeconds, timerRemainingSeconds: input.timerRemainingSeconds, timerStatus: input.timerStatus, timerStartedAt: input.timerStartedAt, updatedAt: input.updatedAt, documentRevision: input.documentRevision, notesRevision: input.notesRevision }).run()
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
      this.database.orm.update(studyPlanItems).set({ status: 'pending', updatedAt: now }).where(and(eq(studyPlanItems.workspaceId, workspaceId), eq(studyPlanItems.sessionId, sessionId))).run()
      for (const item of statuses) this.database.orm.update(studyPlanItems).set({ status: item.status, updatedAt: now }).where(and(eq(studyPlanItems.workspaceId, workspaceId), eq(studyPlanItems.sessionId, sessionId), eq(studyPlanItems.id, item.id))).run()
    })()
  }

  async updateTimer(workspaceId: string, timer: Pick<StudyWorkspaceState, 'timerStatus' | 'timerRemainingSeconds' | 'timerStartedAt'>, now: number): Promise<void> {
    this.database.orm.update(workspaceStudyStates).set({ ...timer, updatedAt: now }).where(eq(workspaceStudyStates.workspaceId, workspaceId)).run()
  }

  flushDrafts(input: { workspaceId: string; fileName: string; language: string; content: string; notes: string; documentRevision: number; notesRevision: number; now: number }): void {
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('UPDATE workspace_study_states SET file_name = ?, language = ?, editor_content = ?, document_revision = ?, updated_at = ? WHERE workspace_id = ? AND document_revision < ?').run(input.fileName, input.language, input.content, input.documentRevision, input.now, input.workspaceId, input.documentRevision)
      this.database.sqlite.prepare('UPDATE workspace_study_states SET notes = ?, notes_revision = ?, updated_at = ? WHERE workspace_id = ? AND notes_revision < ?').run(input.notes, input.notesRevision, input.now, input.workspaceId, input.notesRevision)
    })()
  }
}
