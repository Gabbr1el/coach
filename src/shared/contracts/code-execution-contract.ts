import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
import type { ObserverState } from './observer-contract'
import { projectIdSchema } from './project-contract'
import { interactiveCodeBlockSchema } from './study-lesson-contract'

export const executeCodeInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  language: z.literal('python'),
  content: z.string().min(1).max(200_000),
}).strict()

export const executeProjectInputSchema = z.object({ workspaceId: workspaceIdSchema, projectId: projectIdSchema }).strict()
export const executeInteractiveCodeInputSchema = z.object({ workspaceId: workspaceIdSchema, lessonId: z.string().min(1).max(360), blockId: z.string().min(1).max(420), currentCode: z.string().min(1).max(20_000), prediction: z.string().max(2000).nullable() }).strict()
export const saveInteractiveCodeStateInputSchema = executeInteractiveCodeInputSchema.omit({}).extend({ currentCode: z.string().max(20_000), previousSourceRevision: z.string().min(16).max(64).optional() }).strict()
export const listInteractiveCodeStatesInputSchema = z.object({ workspaceId: workspaceIdSchema, lessonId: z.string().min(1).max(360) }).strict()

export interface CodeDiagnostic {
  readonly severity: 'error' | 'warning' | 'info'
  readonly filePath: string
  readonly line: number
  readonly column: number
  readonly message: string
  readonly code: string | null
}

export interface CodeExecutionResult {
  readonly command: string
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly durationMs: number
  readonly errorSignature: string | null
  readonly diagnostics?: CodeDiagnostic[]
  readonly phase?: 'compile' | 'run'
  readonly observerState?: ObserverState
}

export const interactiveCodeValidationSchema = z.object({ status: z.enum(['not_applicable', 'passed', 'failed', 'stale', 'unavailable']), message: z.string().min(1).max(1000), sourceRevision: z.string().min(16).max(64), actualOutput: z.string().max(8000), predictionCorrect: z.boolean().nullable(), validatedAt: z.number().int().nonnegative() }).strict()
export function parseInteractiveValidation(value: unknown, currentSourceRevision: string): z.infer<typeof interactiveCodeValidationSchema> | null {
  if (!value || typeof value !== 'object') return null
  const parsed = interactiveCodeValidationSchema.safeParse(value)
  if (parsed.success) return parsed.data.status === 'passed' && parsed.data.sourceRevision !== currentSourceRevision ? { ...parsed.data, status: 'stale', message: 'Código alterado após a última validação. Execute novamente.' } : parsed.data
  const legacy = value as { status?: unknown; message?: unknown; validatedAt?: unknown }
  if (typeof legacy.status !== 'string' || typeof legacy.message !== 'string' || typeof legacy.validatedAt !== 'number') return null
  return { status: 'stale', message: 'Validação anterior precisa ser executada novamente para confirmar o código atual.', sourceRevision: 'legacy-unvalidated', actualOutput: '', predictionCorrect: null, validatedAt: legacy.validatedAt }
}
const codeDiagnosticSchema = z.object({ severity: z.enum(['error', 'warning', 'info']), filePath: z.string(), line: z.number().int(), column: z.number().int(), message: z.string(), code: z.string().nullable() }).strict()
const codeExecutionResultSchema = z.object({ command: z.string(), stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nullable(), timedOut: z.boolean(), durationMs: z.number().nonnegative(), errorSignature: z.string().nullable(), diagnostics: z.array(codeDiagnosticSchema).optional(), phase: z.enum(['compile', 'run']).optional(), observerState: z.unknown().optional() }).strict()
export const interactiveCodeStateSchema = z.object({ blockId: z.string().min(1).max(420), lessonId: z.string().min(1).max(360), currentCode: z.string().max(20_000), prediction: z.string().max(2000).nullable(), currentSourceRevision: z.string().min(16).max(64), attempts: z.number().int().min(0).max(1000), lastExecution: codeExecutionResultSchema.nullable(), validationResult: interactiveCodeValidationSchema.nullable(), applicable: z.boolean(), unavailableReason: z.string().max(1000).nullable(), updatedAt: z.number().int().nonnegative() }).strict()
export type InteractiveCodeBlock = z.infer<typeof interactiveCodeBlockSchema>
export type InteractiveCodeState = z.infer<typeof interactiveCodeStateSchema>

export interface CodeExecutionApi {
  execute(input: z.infer<typeof executeCodeInputSchema>): Promise<CodeExecutionResult>
  executeProject(input: z.infer<typeof executeProjectInputSchema>): Promise<CodeExecutionResult>
  executeInteractive(input: z.infer<typeof executeInteractiveCodeInputSchema>): Promise<InteractiveCodeState>
  saveInteractiveState(input: z.infer<typeof saveInteractiveCodeStateInputSchema>): Promise<InteractiveCodeState>
  listInteractiveStates(input: z.infer<typeof listInteractiveCodeStatesInputSchema>): Promise<InteractiveCodeState[]>
  getToolchains(): Promise<ToolchainStatus[]>
}

export interface ToolchainStatus { readonly language: 'python' | 'c' | 'java'; readonly available: boolean; readonly command: string; readonly version: string | null; readonly detail: string | null }
