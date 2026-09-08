import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const studyWorkspaceIdInputSchema = z.object({ workspaceId: workspaceIdSchema }).strict()

export const saveWorkspaceDocumentInputSchema = studyWorkspaceIdInputSchema.extend({
  fileName: z.string().trim().min(1).max(120),
  language: z.string().trim().min(1).max(40),
  content: z.string().max(200_000),
  revision: z.number().int().nonnegative(),
}).strict()

export const saveWorkspaceNotesInputSchema = studyWorkspaceIdInputSchema.extend({
  notes: z.string().max(100_000),
  revision: z.number().int().nonnegative(),
}).strict()
export const updateContextSharingInputSchema = studyWorkspaceIdInputSchema.extend({ enabled: z.boolean() }).strict()
export const flushWorkspaceDraftsInputSchema = studyWorkspaceIdInputSchema.extend({
  fileName: z.string().trim().min(1).max(120),
  language: z.string().trim().min(1).max(40),
  content: z.string().max(200_000),
  notes: z.string().max(100_000),
  documentRevision: z.number().int().nonnegative(),
  notesRevision: z.number().int().nonnegative(),
}).strict()

export const toggleStudyPlanItemInputSchema = studyWorkspaceIdInputSchema.extend({ itemId: z.uuid() }).strict()
export const recalculateStudyPlanInputSchema = studyWorkspaceIdInputSchema
export const refreshLiveStudyPlanInputSchema = studyWorkspaceIdInputSchema
export const activateStudyPlanItemInputSchema = studyWorkspaceIdInputSchema.extend({ itemId: z.uuid() }).strict()

export const updateStudyTimerInputSchema = studyWorkspaceIdInputSchema.extend({
  action: z.enum(['start', 'pause', 'reset']),
}).strict()
export const setStudyTimerDurationInputSchema = studyWorkspaceIdInputSchema.extend({ durationSeconds: z.number().int().min(300).max(10800) }).strict()
export const completeStudySessionInputSchema = studyWorkspaceIdInputSchema

export interface StudySessionSummary {
  readonly id: string
  readonly startedAt: number
  readonly endedAt: number
  readonly focusSeconds: number
  readonly executions: number
  readonly errors: number
  readonly interventions: number
  readonly focusExits: number
  readonly completedPlanItems: number
  readonly successRate?: number | null
  readonly focusRetentionPercent?: number | null
  readonly recommendation?: string | null
}
export interface DailyStudyReport { readonly date: string; readonly startedAt: number; readonly endedAt: number; readonly focusSeconds: number; readonly executions: number; readonly errors: number; readonly interventions: number; readonly focusExits: number; readonly completedPlanItems: number; readonly successRate: number | null; readonly focusRetentionPercent: number | null; readonly sessionCount: number; readonly recommendation: string | null }

export interface StudyPlanItem {
  readonly id: string
  readonly title: string
  readonly durationMinutes: number
  readonly position: number
  readonly status: 'pending' | 'active' | 'completed'
  readonly moduleId?: string
  readonly topicId?: string
  readonly activityType?: 'introduction' | 'review' | 'exercise' | 'practice' | 'video'
  readonly scheduledStartMinutes?: number
}

export interface StudyWorkspaceState {
  readonly workspaceId: string
  readonly sessionId: string
  readonly sessionStartedAt: number
  readonly fileName: string
  readonly language: string
  readonly editorContent: string
  readonly notes: string
  readonly shareContextWithAi: boolean
  readonly timerDurationSeconds: number
  readonly timerRemainingSeconds: number
  readonly timerStatus: 'idle' | 'running' | 'paused'
  readonly timerStartedAt: number | null
  readonly plan: StudyPlanItem[]
  readonly updatedAt: number
  readonly documentRevision: number
  readonly notesRevision: number
  readonly accumulatedFocusSeconds: number
}

export interface StudyWorkspaceApi {
  getState(workspaceId: string): Promise<StudyWorkspaceState>
  saveDocument(input: z.infer<typeof saveWorkspaceDocumentInputSchema>): Promise<StudyWorkspaceState>
  saveNotes(input: z.infer<typeof saveWorkspaceNotesInputSchema>): Promise<StudyWorkspaceState>
  updateContextSharing(input: z.infer<typeof updateContextSharingInputSchema>): Promise<StudyWorkspaceState>
  togglePlanItem(input: z.infer<typeof toggleStudyPlanItemInputSchema>): Promise<StudyWorkspaceState>
  recalculatePlan(input: z.infer<typeof recalculateStudyPlanInputSchema>): Promise<StudyWorkspaceState>
  refreshLivePlan(input: z.infer<typeof refreshLiveStudyPlanInputSchema>): Promise<StudyWorkspaceState>
  activatePlanItem(input: z.infer<typeof activateStudyPlanItemInputSchema>): Promise<StudyWorkspaceState>
  updateTimer(input: z.infer<typeof updateStudyTimerInputSchema>): Promise<StudyWorkspaceState>
  setTimerDuration(input: z.infer<typeof setStudyTimerDurationInputSchema>): Promise<StudyWorkspaceState>
  flushDrafts(input: z.infer<typeof flushWorkspaceDraftsInputSchema>): boolean
  completeSession(workspaceId: string): Promise<StudyWorkspaceState>
  listSessionHistory(workspaceId: string): Promise<DailyStudyReport[]>
}
