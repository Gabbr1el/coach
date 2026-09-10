import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
import { projectLanguageSchema } from './project-contract'

const entityIdSchema = z.string().min(1).max(420)
const exerciseContextSchema = z.object({
  workspaceId: workspaceIdSchema,
  roadmapId: entityIdSchema,
  moduleId: entityIdSchema,
  topicId: entityIdSchema,
  lessonId: entityIdSchema,
}).strict()

export const ensureExerciseSetInputSchema = exerciseContextSchema
export const getExerciseSetInputSchema = z.object({ workspaceId: workspaceIdSchema, topicId: entityIdSchema }).strict()
export const exerciseSaveDraftInputSchema = z.object({ workspaceId: workspaceIdSchema, exerciseId: entityIdSchema, code: z.string().max(20_000) }).strict()
export const exerciseRunInputSchema = z.object({ workspaceId: workspaceIdSchema, exerciseId: entityIdSchema, code: z.string().max(20_000).default(''), stdin: z.string().max(20_000).default('') }).strict()
export const exerciseSubmitInputSchema = z.object({ workspaceId: workspaceIdSchema, exerciseId: entityIdSchema, code: z.string().max(20_000).default(''), prediction: z.string().trim().max(20_000).nullable().default(null), idempotencyKey: z.string().min(8).max(200) }).strict()
export const exerciseHelpInputSchema = z.object({ workspaceId: workspaceIdSchema, exerciseId: entityIdSchema }).strict()

export const publicExerciseTestSchema = z.object({ id: entityIdSchema, input: z.string().max(20_000), expectedOutput: z.string().max(20_000) }).strict()
export const exerciseKindSchema = z.enum(['PROGRAMMING_PROBLEM', 'FIX_CODE', 'COMPLETE_CODE', 'PREDICT_OUTPUT'])
export const exerciseDifficultySchema = z.enum(['introductory', 'standard', 'challenge'])
export const exerciseSchema = z.object({ id: entityIdSchema, position: z.number().int().positive(), kind: exerciseKindSchema, difficulty: exerciseDifficultySchema, title: z.string().min(1).max(180), statement: z.string().min(1).max(5000), inputDescription: z.string().max(2000), outputDescription: z.string().max(2000), language: projectLanguageSchema, starterCode: z.string().max(20_000), predictionPrompt: z.string().min(1).max(1000).nullable(), codeToObserve: z.string().min(1).max(20_000).nullable(), requiredForTopicCompletion: z.boolean(), publicTests: z.array(publicExerciseTestSchema).max(8) }).strict().superRefine((value, context) => {
  if (value.kind === 'PREDICT_OUTPUT') {
    if (!value.predictionPrompt || !value.codeToObserve) context.addIssue({ code: 'custom', message: 'Prediction exercises require a prompt and code to observe' })
    if (value.starterCode || value.publicTests.length) context.addIssue({ code: 'custom', message: 'Prediction exercises cannot expose an editable solution or tests' })
  } else {
    if (!value.starterCode || value.publicTests.length < 1) context.addIssue({ code: 'custom', message: 'Code exercises require starter code and public tests' })
    if (value.predictionPrompt || value.codeToObserve) context.addIssue({ code: 'custom', message: 'Code exercises cannot contain prediction fields' })
  }
})
export const exerciseSummarySchema = z.object({ status: z.enum(['executed', 'passed', 'failed', 'compile_error', 'runtime_error', 'timed_out']), passedTests: z.number().int().nonnegative(), totalTests: z.number().int().nonnegative(), message: z.string().min(1).max(1000), compileDiagnostics: z.array(z.string().min(1).max(1000)).max(20) }).strict()
export const exerciseProgressSchema = z.object({ exerciseId: entityIdSchema, status: z.enum(['not_started', 'in_progress', 'passed']), currentCode: z.string().max(20_000), attempts: z.number().int().nonnegative(), lastRun: exerciseSummarySchema.nullable(), lastSubmission: exerciseSummarySchema.nullable(), passedTests: z.number().int().nonnegative(), totalTests: z.number().int().nonnegative(), helpUsed: z.boolean(), firstTrySuccess: z.boolean(), helpCount: z.number().int().nonnegative(), passedAt: z.number().int().nonnegative().nullable(), updatedAt: z.number().int().nonnegative() }).strict()
const publicExerciseAggregateSchema = exerciseSummarySchema.pick({ status: true, passedTests: true, totalTests: true, message: true }).strict()
export const publicExerciseContextSchema = z.object({ exerciseId: entityIdSchema, roadmapId: entityIdSchema, moduleId: entityIdSchema, topicId: entityIdSchema, kind: exerciseKindSchema, title: z.string().min(1).max(180), statement: z.string().min(1).max(5000), language: projectLanguageSchema, currentCode: z.string().max(20_000), lastRun: publicExerciseAggregateSchema.nullable(), lastSubmission: publicExerciseAggregateSchema.nullable(), passedTests: z.number().int().nonnegative(), totalTests: z.number().int().nonnegative(), attemptCount: z.number().int().nonnegative(), helpUsed: z.boolean(), progressStatus: z.enum(['not_started', 'in_progress', 'passed']) }).strict()
export const exerciseSetSchema = z.object({ id: entityIdSchema, workspaceId: workspaceIdSchema, roadmapId: entityIdSchema, moduleId: entityIdSchema, topicId: entityIdSchema, lessonId: entityIdSchema, status: z.enum(['generating', 'ready', 'waiting_for_provider', 'failed_retryable']), retryAfter: z.number().int().nonnegative().nullable(), lastErrorCode: z.string().max(100).nullable(), exercises: z.array(exerciseSchema).max(7), progress: z.array(exerciseProgressSchema), updatedAt: z.number().int().nonnegative() }).strict()
export const exerciseCaseResultSchema = z.object({ id: entityIdSchema, visibility: z.literal('public'), passed: z.boolean(), actualOutput: z.string().max(8000).nullable(), message: z.string().max(1000) }).strict()
export const exerciseExecutionSchema = z.object({ mode: z.enum(['run', 'submit']), exerciseId: entityIdSchema, attemptId: entityIdSchema.nullable(), status: z.enum(['executed', 'passed', 'failed', 'compile_error', 'runtime_error', 'timed_out']), passed: z.boolean(), passedTests: z.number().int().nonnegative(), totalTests: z.number().int().nonnegative(), message: z.string().min(1).max(1000), compileDiagnostics: z.array(z.string().min(1).max(1000)).max(20), cases: z.array(exerciseCaseResultSchema).max(8), stdout: z.string().max(8000), stderr: z.string().max(8000), durationMs: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative() }).strict()
export const exerciseHelpResultSchema = z.object({ exerciseId: entityIdSchema, helpCount: z.number().int().positive(), hint: z.string().min(1).max(1000) }).strict()

export type ExerciseSet = z.infer<typeof exerciseSetSchema>
export type ExerciseExecution = z.infer<typeof exerciseExecutionSchema>
export type PublicExerciseContext = z.infer<typeof publicExerciseContextSchema>
export interface ExerciseApi {
  ensureSet(input: z.infer<typeof ensureExerciseSetInputSchema>): Promise<ExerciseSet>
  getSet(input: z.infer<typeof getExerciseSetInputSchema>): Promise<ExerciseSet | null>
  saveDraft(input: z.infer<typeof exerciseSaveDraftInputSchema>): Promise<void>
  run(input: z.infer<typeof exerciseRunInputSchema>): Promise<ExerciseExecution>
  submit(input: z.infer<typeof exerciseSubmitInputSchema>): Promise<ExerciseExecution>
  requestHelp(input: z.infer<typeof exerciseHelpInputSchema>): Promise<z.infer<typeof exerciseHelpResultSchema>>
}
