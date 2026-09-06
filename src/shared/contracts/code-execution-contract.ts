import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
import type { ObserverState } from './observer-contract'
import { projectIdSchema } from './project-contract'

export const executeCodeInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  language: z.literal('python'),
  content: z.string().min(1).max(200_000),
}).strict()

export const executeProjectInputSchema = z.object({ workspaceId: workspaceIdSchema, projectId: projectIdSchema }).strict()

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

export interface CodeExecutionApi {
  execute(input: z.infer<typeof executeCodeInputSchema>): Promise<CodeExecutionResult>
  executeProject(input: z.infer<typeof executeProjectInputSchema>): Promise<CodeExecutionResult>
  getToolchains(): Promise<ToolchainStatus[]>
}

export interface ToolchainStatus { readonly language: 'python' | 'c' | 'java'; readonly available: boolean; readonly command: string; readonly version: string | null; readonly detail: string | null }
