import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const recordFocusInputSchema = z.object({ workspaceId: workspaceIdSchema, focused: z.boolean() }).strict()

export interface ObserverState {
  readonly active: boolean
  readonly repeatedErrorCount: number
  readonly interventionSuggested: boolean
  readonly focusExitCount: number
  readonly timeAwaySeconds: number
}

export interface ObserverApi {
  getState(workspaceId: string): Promise<ObserverState>
  recordFocus(input: z.infer<typeof recordFocusInputSchema>): Promise<ObserverState>
}
