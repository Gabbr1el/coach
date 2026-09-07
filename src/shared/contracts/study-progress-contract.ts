import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const studyItemStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'])
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
}).strict()

export type StudyItemStatus = z.infer<typeof studyItemStatusSchema>
export type StudySelection = z.infer<typeof studySelectionSchema>
export type StudyEventType = z.infer<typeof studyEventTypeSchema>
export interface StudyProgressState extends StudySelection { readonly topicStatuses: Record<string, StudyItemStatus>; readonly updatedAt: number }
export interface StudyProgressEvent { readonly id: string; readonly type: StudyEventType; readonly topicId: string; readonly checkpointId: string | null; readonly correct: boolean | null; readonly createdAt: number }
export interface StudyProgressApi {
  get(workspaceId: string): Promise<StudyProgressState | null>
  select(input: StudySelection): Promise<StudyProgressState>
  record(input: z.infer<typeof recordStudyEventSchema>): Promise<StudyProgressEvent>
}
