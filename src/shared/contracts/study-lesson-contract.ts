import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
import { roadmapResourceSchema } from './roadmap-contract'

const textBlock = z.object({ id: z.string().min(1), type: z.enum(['explanation', 'analogy', 'warning', 'commonError', 'comparison']), title: z.string().min(1).max(160), content: z.string().min(1).max(4000) }).strict()
const codeBlock = z.object({ id: z.string().min(1), type: z.literal('codeExample'), title: z.string().min(1).max(160), code: z.string().min(1).max(8000), language: z.string().min(1).max(40), expectedOutput: z.string().max(2000).nullable(), walkthrough: z.array(z.string().min(1).max(500)).max(12) }).strict()
export const interactiveCodeBlockSchema = z.object({ id: z.string().min(1), type: z.literal('interactiveCode'), title: z.string().min(1).max(160), interactionType: z.enum(['PREDICT_AND_RUN', 'EDIT_AND_RUN', 'FIX_AND_RUN']), language: z.enum(['python', 'c', 'java']), instruction: z.string().min(1).max(2000), initialCode: z.string().min(1).max(20_000), predictionPrompt: z.string().min(1).max(1000).nullable(), evidenceMode: z.enum(['none', 'observation', 'validated']), requiredForTopicCompletion: z.boolean().optional().default(false), expectedOutput: z.string().max(4000).nullable() }).strict().superRefine((value, context) => {
  if (value.interactionType === 'PREDICT_AND_RUN' && !value.predictionPrompt) context.addIssue({ code: 'custom', path: ['predictionPrompt'], message: 'Prediction blocks require a prediction prompt' })
  if (value.evidenceMode === 'validated' && value.expectedOutput === null) context.addIssue({ code: 'custom', path: ['expectedOutput'], message: 'Validated blocks require an expected output' })
  if (value.requiredForTopicCompletion && value.evidenceMode !== 'validated') context.addIssue({ code: 'custom', path: ['requiredForTopicCompletion'], message: 'Required blocks must use validated evidence' })
})
export const checkpointOptionSchema = z.object({ id: z.string().min(1).max(120), text: z.string().min(1).max(500), rationale: z.string().min(1).max(1000), misconceptionTag: z.string().min(1).max(120).optional() }).strict()
const checkpointBlock = z.object({ id: z.string().min(1), type: z.literal('checkpoint'), title: z.string().min(1).max(160), questionType: z.literal('multiple_choice').default('multiple_choice'), question: z.string().min(1).max(1000), options: z.array(checkpointOptionSchema).length(5), correctOptionId: z.string().min(1).max(120), requiresJustification: z.boolean().default(true), hint: z.string().min(1).max(1000), reinforcement: z.string().min(1).max(2000) }).strict().superRefine((value, context) => {
  const optionIds = value.options.map((option) => option.id)
  if (new Set(optionIds).size !== 5) context.addIssue({ code: 'custom', path: ['options'], message: 'Checkpoint option ids must be unique' })
  if (!optionIds.includes(value.correctOptionId)) context.addIssue({ code: 'custom', path: ['correctOptionId'], message: 'Correct option must reference an available option' })
  const texts = value.options.map((option) => option.text.trim().toLocaleLowerCase('pt-BR'))
  if (new Set(texts).size !== 5) context.addIssue({ code: 'custom', path: ['options'], message: 'Checkpoint options must be distinct' })
})
const exerciseBlock = z.object({ id: z.string().min(1), type: z.literal('miniExercise'), title: z.string().min(1).max(160), instruction: z.string().min(1).max(2000), nextAction: z.enum(['NEXT_TOPIC', 'RETRY', 'REVIEW', 'PRACTICE', 'WATCH_VIDEO', 'CONTINUE']) }).strict()
export const studyLessonBlockSchema = z.discriminatedUnion('type', [textBlock, codeBlock, interactiveCodeBlockSchema, checkpointBlock, exerciseBlock])
export const studyLessonContentSchema = z.object({ title: z.string().min(1).max(200), level: z.enum(['basic', 'intermediate', 'advanced']), objective: z.string().min(1).max(600), blocks: z.array(studyLessonBlockSchema).min(4).max(16), sources: z.array(roadmapResourceSchema).max(24).default([]) }).strict()
export const getStudyLessonSchema = z.object({ workspaceId: workspaceIdSchema, roadmapId: z.uuid(), moduleId: z.uuid(), topicId: z.string().min(1).max(300) }).strict()
export const evaluateStudyCheckpointSchema = getStudyLessonSchema.extend({ lessonId: z.string().min(1).max(360), checkpointId: z.string().min(1).max(420), selectedOptionId: z.string().min(1).max(120), studentJustification: z.string().trim().min(3).max(1000) }).strict()
export const studyPresentationIntentSchema = z.enum(['SIMPLIFY', 'ANALOGY', 'CODE_FIRST', 'REORDER', 'PRESENTATION', 'MORE_EXAMPLES', 'STEP_BY_STEP', 'MORE_DEPTH', 'MORE_CONCISE'])
export const studyLessonAdaptationModeSchema = z.enum(['CUSTOM', 'SIMPLIFY', 'ANALOGY', 'CODE_FIRST', 'REORDER', 'PRESENTATION', 'MORE_EXAMPLES', 'STEP_BY_STEP', 'MORE_DEPTH', 'MORE_CONCISE'])
const emptyRecurringPresentationEvidence = { SIMPLIFY: 0, ANALOGY: 0, CODE_FIRST: 0, REORDER: 0, PRESENTATION: 0, MORE_EXAMPLES: 0, STEP_BY_STEP: 0, MORE_DEPTH: 0, MORE_CONCISE: 0 }
const recurringPresentationEvidenceSchema = z.object({ SIMPLIFY: z.number().int().min(0).default(0), ANALOGY: z.number().int().min(0).default(0), CODE_FIRST: z.number().int().min(0).default(0), REORDER: z.number().int().min(0).default(0), PRESENTATION: z.number().int().min(0).default(0), MORE_EXAMPLES: z.number().int().min(0).default(0), STEP_BY_STEP: z.number().int().min(0).default(0), MORE_DEPTH: z.number().int().min(0).default(0), MORE_CONCISE: z.number().int().min(0).default(0) }).strict()
export const studyPresentationEvidenceSchema = z.object({ intent: studyPresentationIntentSchema, source: z.enum(['situational', 'explicit']), topicId: z.string().min(1).max(300), blockId: z.string().min(1).max(420) }).strict()
export const studyPresentationPreferencesSchema = z.object({ detail: z.enum(['standard', 'concise', 'detailed']).default('standard'), explanation: z.enum(['balanced', 'simple', 'technical', 'step_by_step']).default('balanced'), examples: z.enum(['balanced', 'practical', 'conceptual']).default('balanced'), composition: z.enum(['balanced', 'code_first', 'structured']).default('balanced'), presentation: z.enum(['reading', 'visual']).default('reading'), explicitIntents: z.array(studyPresentationIntentSchema).max(9).default([]), recurringEvidence: recurringPresentationEvidenceSchema.default(emptyRecurringPresentationEvidence), evidence: z.array(studyPresentationEvidenceSchema).max(500).default([]) }).strict()
export const updateStudyPreferencesSchema = z.object({ workspaceId: workspaceIdSchema, preferences: studyPresentationPreferencesSchema }).strict()
export const adaptStudyLessonSectionSchema = getStudyLessonSchema.extend({ lessonId: z.string().min(1).max(360), blockId: z.string().min(1).max(420), instruction: z.string().trim().min(1).max(1000), mode: studyLessonAdaptationModeSchema.default('CUSTOM') }).strict()
export const studyLessonAdaptationSelectionSchema = z.object({ workspaceId: workspaceIdSchema, lessonId: z.string().min(1).max(360), blockId: z.string().min(1).max(420) }).strict()
export const activateStudyLessonAdaptationSchema = studyLessonAdaptationSelectionSchema.extend({ adaptationId: z.string().min(1).max(360) }).strict()

export type StudyLessonBlock = z.infer<typeof studyLessonBlockSchema>
export interface PersistedStudyLesson extends z.infer<typeof studyLessonContentSchema> { readonly id: string; readonly generationKind: 'ai_generated' | 'provisional_fallback'; readonly workspaceId: string; readonly roadmapId: string; readonly moduleId: string; readonly topicId: string; readonly providerId: string | null; readonly modelId: string | null; readonly createdAt: number }
export interface StudyCheckpointEvaluation { readonly correct: boolean; readonly selectedOptionId: string; readonly attempt: number; readonly studentJustification: string; readonly rationale: string; readonly misconceptionTag: string | null; readonly feedback: string; readonly hint: string | null; readonly reinforcement: string | null }
export type StudyLessonLoadResult =
  | { readonly status: 'ready'; readonly lesson: PersistedStudyLesson; readonly sources: PersistedStudyLesson['sources'] }
  | { readonly status: 'waiting_for_provider'; readonly errorCode: 'PROVIDER_UNAVAILABLE' }
  | { readonly status: 'failed_retryable'; readonly errorCode: 'PROVIDER_REQUEST_FAILED' | 'PROVIDER_INVALID_RESPONSE' | 'JSON_EXTRACTION_FAILED' | 'LESSON_SCHEMA_INVALID' | 'LESSON_GENERIC_REJECTED' | 'LESSON_PERSISTENCE_FAILED' | 'UNKNOWN_GENERATION_ERROR' }
export type StudyPresentationPreferences = z.infer<typeof studyPresentationPreferencesSchema>
export type StudyPresentationEvidence = z.infer<typeof studyPresentationEvidenceSchema>
export type StudyPresentationIntent = z.infer<typeof studyPresentationIntentSchema>
export type StudyLessonAdaptationMode = z.infer<typeof studyLessonAdaptationModeSchema>
export interface StudyLessonAdaptation { readonly id: string; readonly workspaceId: string; readonly lessonId: string; readonly blockId: string; readonly revision: number; readonly reason: string; readonly mode: StudyLessonAdaptationMode; readonly originalBlock: StudyLessonBlock; readonly adaptedBlock: StudyLessonBlock; readonly isActive: boolean; readonly providerId: string | null; readonly modelId: string | null; readonly createdAt: number }
export type NewStudyLessonAdaptation = Omit<StudyLessonAdaptation, 'revision' | 'originalBlock' | 'isActive'>
export interface StudyLessonApi {
  getOrCreate(input: z.infer<typeof getStudyLessonSchema>): Promise<StudyLessonLoadResult>
  evaluate(input: z.infer<typeof evaluateStudyCheckpointSchema>): Promise<StudyCheckpointEvaluation>
  adaptSection(input: z.infer<typeof adaptStudyLessonSectionSchema>): Promise<StudyLessonAdaptation>
  listAdaptations(input: z.infer<typeof studyLessonAdaptationSelectionSchema>): Promise<StudyLessonAdaptation[]>
  restoreOriginal(input: z.infer<typeof studyLessonAdaptationSelectionSchema>): Promise<PersistedStudyLesson>
  activateAdaptation(input: z.infer<typeof activateStudyLessonAdaptationSchema>): Promise<PersistedStudyLesson>
  getPreferences(workspaceId: string): Promise<StudyPresentationPreferences>
  updatePreferences(input: z.infer<typeof updateStudyPreferencesSchema>): Promise<StudyPresentationPreferences>
}
