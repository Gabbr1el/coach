import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
export const workspaceActionTypeSchema = z.enum(['plan.recalculate', 'plan.complete', 'notes.add'])
export const workspaceActionInputSchema = z.discriminatedUnion('type', [z.object({ workspaceId: workspaceIdSchema, type: z.literal('plan.recalculate'), arguments: z.object({}).strict() }).strict(), z.object({ workspaceId: workspaceIdSchema, type: z.literal('plan.complete'), arguments: z.object({ itemId: z.uuid() }).strict() }).strict(), z.object({ workspaceId: workspaceIdSchema, type: z.literal('notes.add'), arguments: z.object({ content: z.string().trim().min(1).max(4000) }).strict() }).strict()])
export interface WorkspaceActionResult { id: string; workspaceId: string; type: z.infer<typeof workspaceActionTypeSchema>; status: 'succeeded' | 'failed' | 'needs_confirmation'; message: string; persisted: boolean; result: unknown }
