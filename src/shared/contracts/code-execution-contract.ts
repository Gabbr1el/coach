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
export const saveInteractiveCodeStateInputSchema = executeInteractiveCodeInputSchema.omit({}).extend({ currentCode: z.string().max(20_000) }).strict()
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

export const interactiveCodeValidationSchema = z.object({ status: z.enum(['not_applicable', 'passed', 'failed']), message: z.string().min(1).max(1000), validatedAt: z.number().int().nonnegative() }).strict()
const codeDiagnosticSchema = z.object({ severity: z.enum(['error', 'warning', 'info']), filePath: z.string(), line: z.number().int(), column: z.number().int(), message: z.string(), code: z.string().nullable() }).strict()
const codeExecutionResultSchema = z.object({ command: z.string(), stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nullable(), timedOut: z.boolean(), durationMs: z.number().nonnegative(), errorSignature: z.string().nullable(), diagnostics: z.array(codeDiagnosticSchema).optional(), phase: z.enum(['compile', 'run']).optional(), observerState: z.unknown().optional() }).strict()
export const interactiveCodeStateSchema = z.object({ blockId: z.string().min(1).max(420), lessonId: z.string().min(1).max(360), currentCode: z.string().max(20_000), prediction: z.string().max(2000).nullable(), attempts: z.number().int().min(0).max(1000), lastExecution: codeExecutionResultSchema.nullable(), validationResult: interactiveCodeValidationSchema.nullable(), updatedAt: z.number().int().nonnegative() }).strict()
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
