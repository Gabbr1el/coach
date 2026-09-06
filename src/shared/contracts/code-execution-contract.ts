import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
import type { ObserverState } from './observer-contract'

export const executeCodeInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  language: z.literal('python'),
  content: z.string().min(1).max(200_000),
}).strict()

export interface CodeExecutionResult {
  readonly command: string
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly durationMs: number
  readonly errorSignature: string | null
  readonly observerState?: ObserverState
}

export interface CodeExecutionApi {
  execute(input: z.infer<typeof executeCodeInputSchema>): Promise<CodeExecutionResult>
}
