import type { StudyPlanItem, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'

export interface StudyWorkspaceRepository {
  findState(workspaceId: string, now: number): Promise<StudyWorkspaceState | null>
  createState(input: StudyWorkspaceState): Promise<StudyWorkspaceState>
  saveDocument(workspaceId: string, fileName: string, language: string, content: string, revision: number, now: number): Promise<void>
  saveNotes(workspaceId: string, notes: string, revision: number, now: number): Promise<void>
  updateContextSharing(workspaceId: string, enabled: boolean, now: number): Promise<void>
  replacePlanStatuses(workspaceId: string, sessionId: string, statuses: ReadonlyArray<{ id: string; status: StudyPlanItem['status'] }>, now: number): Promise<void>
  updateTimer(workspaceId: string, timer: Pick<StudyWorkspaceState, 'timerStatus' | 'timerRemainingSeconds' | 'timerStartedAt'>, now: number): Promise<void>
  flushDrafts(input: { workspaceId: string; fileName: string; language: string; content: string; notes: string; documentRevision: number; notesRevision: number; now: number }): void
}
