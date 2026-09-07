import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

const textBlock = z.object({ id: z.string().min(1), type: z.enum(['explanation', 'analogy', 'warning', 'commonError', 'comparison']), title: z.string().min(1).max(160), content: z.string().min(1).max(4000) }).strict()
const codeBlock = z.object({ id: z.string().min(1), type: z.literal('codeExample'), title: z.string().min(1).max(160), code: z.string().min(1).max(8000), language: z.string().min(1).max(40), expectedOutput: z.string().max(2000).nullable(), walkthrough: z.array(z.string().min(1).max(500)).max(12) }).strict()
const checkpointBlock = z.object({ id: z.string().min(1), type: z.literal('checkpoint'), title: z.string().min(1).max(160), question: z.string().min(1).max(1000), options: z.array(z.string().min(1).max(500)).min(2).max(6), correctIndex: z.number().int().min(0).max(5), difficultyByOption: z.array(z.string().min(1).max(500)).min(2).max(6), hint: z.string().min(1).max(1000), reinforcement: z.string().min(1).max(2000) }).strict()
const exerciseBlock = z.object({ id: z.string().min(1), type: z.literal('miniExercise'), title: z.string().min(1).max(160), instruction: z.string().min(1).max(2000), nextAction: z.enum(['NEXT_TOPIC', 'RETRY', 'REVIEW', 'PRACTICE', 'WATCH_VIDEO', 'CONTINUE']) }).strict()
export const studyLessonBlockSchema = z.discriminatedUnion('type', [textBlock, codeBlock, checkpointBlock, exerciseBlock])
export const studyLessonContentSchema = z.object({ title: z.string().min(1).max(200), level: z.enum(['basic', 'intermediate', 'advanced']), objective: z.string().min(1).max(600), blocks: z.array(studyLessonBlockSchema).min(4).max(16) }).strict()
export const getStudyLessonSchema = z.object({ workspaceId: workspaceIdSchema, roadmapId: z.uuid(), moduleId: z.uuid(), topicId: z.string().min(1).max(300) }).strict()
export const evaluateStudyCheckpointSchema = getStudyLessonSchema.extend({ lessonId: z.string().min(1).max(360), checkpointId: z.string().min(1).max(420), selectedIndex: z.number().int().min(0).max(5), attempt: z.number().int().min(1).max(1000) }).strict()

export type StudyLessonBlock = z.infer<typeof studyLessonBlockSchema>
export interface PersistedStudyLesson extends z.infer<typeof studyLessonContentSchema> { readonly id: string; readonly generationKind: 'ai_generated' | 'provisional_fallback'; readonly workspaceId: string; readonly roadmapId: string; readonly moduleId: string; readonly topicId: string; readonly providerId: string | null; readonly modelId: string | null; readonly createdAt: number }
export interface StudyCheckpointEvaluation { readonly correct: boolean; readonly difficulty: string | null; readonly feedback: string; readonly hint: string | null; readonly reinforcement: string | null }
export interface StudyLessonApi { getOrCreate(input: z.infer<typeof getStudyLessonSchema>): Promise<PersistedStudyLesson>; evaluate(input: z.infer<typeof evaluateStudyCheckpointSchema>): Promise<StudyCheckpointEvaluation> }
