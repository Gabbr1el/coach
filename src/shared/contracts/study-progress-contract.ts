import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const studyItemStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'])
export const studyStageSchema = z.enum(['explanation', 'example', 'verification', 'feedback', 'exercise'])
export const checkpointReasoningStatusSchema = z.enum(['coherent', 'partial', 'misconception', 'insufficient', 'off_topic', 'not_evaluated'])
export const checkpointReasoningAssessmentSchema = z.discriminatedUnion('status', [
  z.object({ status: checkpointReasoningStatusSchema, summary: z.string().min(1).max(600), misconception: z.string().min(1).max(600).nullable(), feedback: z.string().min(1).max(1000), evaluatedAt: z.number().int().nonnegative(), retryCount: z.number().int().min(0).max(100), nextRetryAt: z.null() }).strict(),
  z.object({ status: z.literal('reasoning_evaluation_pending'), summary: z.null(), misconception: z.null(), feedback: z.null(), evaluatedAt: z.null(), retryCount: z.number().int().min(1).max(100), nextRetryAt: z.number().int().nonnegative() }).strict(),
])
export const studyCheckpointHistoryEntrySchema = z.object({ answerId: z.string().min(1).max(120).optional(), signature: z.string().min(1).max(128).optional(), selectedOptionId: z.string().min(1).max(120), studentJustification: z.string().max(1000), attempt: z.number().int().min(1).max(1000), correct: z.boolean(), feedback: z.string().max(4000), rationale: z.string().max(1000), reasoningAssessment: checkpointReasoningAssessmentSchema.optional(), answeredAt: z.number().int().nonnegative() }).strict()
export const studyCheckpointStateSchema = z.preprocess((raw) => { if (!raw || typeof raw !== 'object') return raw; const value = raw as Record<string, unknown>; return { selectedOptionId: typeof value.selectedOptionId === 'string' ? value.selectedOptionId : typeof value.selectedAnswer === 'number' ? `legacy-index-${value.selectedAnswer}` : null, studentJustification: typeof value.studentJustification === 'string' ? value.studentJustification : null, attempt: value.attempt ?? 0, correct: value.correct ?? false, currentFeedback: value.currentFeedback ?? value.feedback ?? null, currentReinforcement: value.currentReinforcement ?? (Array.isArray(value.reinforcementBlocks) ? value.reinforcementBlocks.at(-1) : null) ?? null, rationale: value.rationale ?? null, reasoningAssessment: value.reasoningAssessment ?? null, history: value.history ?? [] } }, z.object({ selectedOptionId: z.string().min(1).max(120).nullable(), studentJustification: z.string().max(1000).nullable(), attempt: z.number().int().min(0).max(1000), correct: z.boolean().default(false), currentFeedback: z.string().max(4000).nullable(), currentReinforcement: z.string().max(4000).nullable(), rationale: z.string().max(1000).nullable(), reasoningAssessment: checkpointReasoningAssessmentSchema.nullable().default(null), history: z.array(studyCheckpointHistoryEntrySchema).max(100) }).strict())
export const studyLessonPositionSchema = z.object({
  lessonId: z.string().min(1).max(360),
  currentBlockId: z.string().min(1).max(420),
  currentStage: studyStageSchema,
  currentCheckpointId: z.string().min(1).max(420).nullable(),
  currentExerciseId: z.string().min(1).max(420).nullable(),
  completedBlockIds: z.array(z.string().min(1).max(420)).max(100),
  selectedAnswer: z.number().int().min(0).max(100).nullable().optional(),
  attempt: z.number().int().min(0).max(1000).optional(),
  feedback: z.string().max(4000).nullable().optional(),
  reinforcementBlocks: z.array(z.string().max(4000)).max(20).optional(),
}).strip()
export const studySelectionSchema = z.object({
  workspaceId: workspaceIdSchema,
  roadmapId: z.uuid(),
  moduleId: z.uuid(),
  topicId: z.string().min(1).max(300),
  lessonId: z.string().min(1).max(360),
  checkpointId: z.string().min(1).max(420).nullable(),
}).strict()
export const studyEventTypeSchema = z.enum(['TOPIC_STARTED', 'TOPIC_COMPLETED', 'CHECKPOINT_ANSWERED', 'HELP_USED'])
export const recordStudyEventSchema = z.object({
  workspaceId: workspaceIdSchema,
  type: studyEventTypeSchema,
  moduleId: z.uuid(),
  topicId: z.string().min(1).max(300),
  lessonId: z.string().min(1).max(360),
  checkpointId: z.string().min(1).max(420).nullable(),
  correct: z.boolean().optional(),
  selectedOptionId: z.string().min(1).max(120).optional(),
  attempt: z.number().int().min(1).max(1000).optional(),
  hintUsed: z.boolean().optional(),
  reinforcementUsed: z.boolean().optional(),
  exerciseCompleted: z.boolean().optional(),
  requestId: z.string().min(8).max(200).optional(),
  helpType: z.enum(['hint_requested', 'coach_help_requested', 'worked_example_shown', 'solution_revealed']).optional(),
}).strict().superRefine((value, context) => {
  if (value.type !== 'CHECKPOINT_ANSWERED') return
  if (value.checkpointId === null) context.addIssue({ code: 'custom', path: ['checkpointId'], message: 'Checkpoint evidence requires a checkpoint id' })
  if (value.selectedOptionId === undefined) context.addIssue({ code: 'custom', path: ['selectedOptionId'], message: 'Checkpoint evidence requires the selected option' })
  if (value.attempt === undefined) context.addIssue({ code: 'custom', path: ['attempt'], message: 'Checkpoint evidence requires an attempt' })
})
export const updateStudyPositionSchema = z.object({ workspaceId: workspaceIdSchema, position: studyLessonPositionSchema, checkpointStates: z.unknown().optional() }).strict()
export const answerStudyCheckpointSchema = z.object({ workspaceId: workspaceIdSchema, lessonId: z.string().min(1).max(360), checkpointId: z.string().min(1).max(420), selectedOptionId: z.string().min(1).max(120), studentJustification: z.string().trim().max(1000).default('') }).strict()
export const retryCheckpointReasoningSchema = z.object({ workspaceId: workspaceIdSchema, lessonId: z.string().min(1).max(360), checkpointId: z.string().min(1).max(420) }).strict()
export const completeStudyTopicSchema = z.object({ workspaceId: workspaceIdSchema, topicId: z.string().min(1).max(300) }).strict()
export const studyNextTargetSchema = z.object({ moduleId: z.uuid(), topicId: z.string().min(1).max(300), lessonId: z.string().min(1).max(360) }).strict()

export type StudyItemStatus = z.infer<typeof studyItemStatusSchema>
export type StudySelection = z.infer<typeof studySelectionSchema>
export type StudyEventType = z.infer<typeof studyEventTypeSchema>
export type StudyLessonPosition = z.infer<typeof studyLessonPositionSchema>
export type StudyCheckpointState = z.infer<typeof studyCheckpointStateSchema>
export type CheckpointReasoningStatus = z.infer<typeof checkpointReasoningStatusSchema>
export type CheckpointReasoningAssessment = z.infer<typeof checkpointReasoningAssessmentSchema>
export interface StudyProgressState extends StudySelection { readonly topicStatuses: Record<string, StudyItemStatus>; readonly lessonPositions: Record<string, StudyLessonPosition>; readonly checkpointStates?: Record<string, StudyCheckpointState>; readonly currentPosition: StudyLessonPosition | null; readonly updatedAt: number }
export interface StudyProgressEvent { readonly id: string; readonly type: StudyEventType; readonly topicId: string; readonly checkpointId: string | null; readonly correct: boolean | null; readonly shouldReplan?: boolean; readonly createdAt: number }
export interface StudyProgressApi {
  get(workspaceId: string): Promise<StudyProgressState | null>
  select(input: StudySelection): Promise<StudyProgressState>
  updatePosition(input: z.infer<typeof updateStudyPositionSchema>): Promise<StudyProgressState>
  answerCheckpoint(input: z.infer<typeof answerStudyCheckpointSchema>): Promise<{ readonly state: StudyProgressState; readonly evaluation: import('./study-lesson-contract').StudyCheckpointEvaluation; readonly shouldReplan: boolean }>
  retryCheckpointReasoning(input: z.infer<typeof retryCheckpointReasoningSchema>): Promise<{ readonly state: StudyProgressState; readonly evaluation: import('./study-lesson-contract').StudyCheckpointEvaluation; readonly shouldReplan: boolean }>
  completeTopic(input: z.infer<typeof completeStudyTopicSchema>): Promise<{ readonly state: StudyProgressState; readonly nextTarget: z.infer<typeof studyNextTargetSchema> | null; readonly shouldReplan: boolean }>
  record(input: z.infer<typeof recordStudyEventSchema>): Promise<StudyProgressEvent>
}
