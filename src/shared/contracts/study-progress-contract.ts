import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const studyItemStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'])
export const studyStageSchema = z.enum(['explanation', 'example', 'verification', 'feedback', 'exercise'])
export const studyCheckpointStateSchema = z.object({ selectedAnswer: z.number().int().min(0).max(100).nullable(), attempt: z.number().int().min(0).max(1000), correct: z.boolean().default(false), feedback: z.string().max(4000).nullable(), reinforcementBlocks: z.array(z.string().max(4000)).max(20) }).strict()
export const studyLessonPositionSchema = z.object({
  lessonId: z.string().min(1).max(360),
  currentBlockId: z.string().min(1).max(420),
  currentStage: studyStageSchema,
  currentCheckpointId: z.string().min(1).max(420).nullable(),
  currentExerciseId: z.string().min(1).max(420).nullable(),
  completedBlockIds: z.array(z.string().min(1).max(420)).max(100),
  selectedAnswer: z.number().int().min(0).max(100).nullable(),
  attempt: z.number().int().min(0).max(1000),
  feedback: z.string().max(4000).nullable(),
  reinforcementBlocks: z.array(z.string().max(4000)).max(20),
}).strict()
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
  selectedAnswer: z.number().int().min(0).max(100).optional(),
  attempt: z.number().int().min(1).max(1000).optional(),
  hintUsed: z.boolean().optional(),
  reinforcementUsed: z.boolean().optional(),
  exerciseCompleted: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.type !== 'CHECKPOINT_ANSWERED') return
  if (value.checkpointId === null) context.addIssue({ code: 'custom', path: ['checkpointId'], message: 'Checkpoint evidence requires a checkpoint id' })
  if (value.selectedAnswer === undefined) context.addIssue({ code: 'custom', path: ['selectedAnswer'], message: 'Checkpoint evidence requires the selected answer' })
  if (value.attempt === undefined) context.addIssue({ code: 'custom', path: ['attempt'], message: 'Checkpoint evidence requires an attempt' })
})
export const updateStudyPositionSchema = z.object({ workspaceId: workspaceIdSchema, position: studyLessonPositionSchema, checkpointStates: z.record(z.string().min(1).max(420), studyCheckpointStateSchema).optional() }).strict()

export type StudyItemStatus = z.infer<typeof studyItemStatusSchema>
export type StudySelection = z.infer<typeof studySelectionSchema>
export type StudyEventType = z.infer<typeof studyEventTypeSchema>
export type StudyLessonPosition = z.infer<typeof studyLessonPositionSchema>
export type StudyCheckpointState = z.infer<typeof studyCheckpointStateSchema>
export interface StudyProgressState extends StudySelection { readonly topicStatuses: Record<string, StudyItemStatus>; readonly lessonPositions: Record<string, StudyLessonPosition>; readonly checkpointStates?: Record<string, StudyCheckpointState>; readonly currentPosition: StudyLessonPosition | null; readonly updatedAt: number }
export interface StudyProgressEvent { readonly id: string; readonly type: StudyEventType; readonly topicId: string; readonly checkpointId: string | null; readonly correct: boolean | null; readonly shouldReplan?: boolean; readonly createdAt: number }
export interface StudyProgressApi {
  get(workspaceId: string): Promise<StudyProgressState | null>
  select(input: StudySelection): Promise<StudyProgressState>
  updatePosition(input: z.infer<typeof updateStudyPositionSchema>): Promise<StudyProgressState>
  record(input: z.infer<typeof recordStudyEventSchema>): Promise<StudyProgressEvent>
}
