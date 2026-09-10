import type { DailyStudyReport, StudyPlanItem, StudyWorkspaceState } from '../../shared/contracts/study-workspace-contract'

export interface StudyWorkspaceRepository {
  findState(workspaceId: string, now: number): Promise<StudyWorkspaceState | null>
  createState(input: StudyWorkspaceState): Promise<StudyWorkspaceState>
  saveDocument(workspaceId: string, fileName: string, language: string, content: string, revision: number, now: number): Promise<void>
  saveNotes(workspaceId: string, notes: string, revision: number, now: number): Promise<void>
  updateContextSharing(workspaceId: string, enabled: boolean, now: number): Promise<void>
  replacePlanStatuses(workspaceId: string, sessionId: string, statuses: ReadonlyArray<{ id: string; status: StudyPlanItem['status'] }>, now: number): Promise<void>
  completePlanItem(workspaceId: string, sessionId: string, itemId: string, statuses: ReadonlyArray<{ id: string; status: StudyPlanItem['status'] }>, timer: Pick<StudyWorkspaceState, 'timerDurationSeconds' | 'timerStatus' | 'timerRemainingSeconds' | 'timerStartedAt' | 'timerStartedMonotonicMs' | 'timerBootId' | 'accumulatedFocusSeconds'>, now: number): Promise<boolean>
  replacePlan(workspaceId: string, sessionId: string, plan: StudyPlanItem[], now: number, dayKey?: string): Promise<void>
  updateTimer(workspaceId: string, sessionId: string, timer: Pick<StudyWorkspaceState, 'timerStatus' | 'timerRemainingSeconds' | 'timerStartedAt' | 'timerStartedMonotonicMs' | 'timerBootId' | 'accumulatedFocusSeconds'>, now: number): Promise<void>
  setTimerDuration(workspaceId: string, sessionId: string, durationSeconds: number, now: number): Promise<void>
  flushDrafts(input: { workspaceId: string; fileName: string; language: string; content: string; notes: string; documentRevision: number; notesRevision: number; now: number }): void
  completeAndCreateSession(workspaceId: string, currentSessionId: string, nextSessionId: string, plan: StudyPlanItem[], focusSeconds: number, timerDurationSeconds: number, now: number): void
  listSessionHistory(workspaceId: string, limit: number): DailyStudyReport[]
}
