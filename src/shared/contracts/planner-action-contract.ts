import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
import { academicLifeMutationInputSchema } from './academic-life-contract'
export const plannerActionProposalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace.prepare'), payload: z.object({ name: z.string().trim().min(1).max(80), objective: z.string().trim().max(500) }).strict() }).strict(),
  z.object({ type: z.literal('workspace.create'), payload: z.object({ name: z.string().trim().min(1).max(80), objective: z.string().trim().max(500), language: z.enum(['python', 'c', 'java']).optional() }).strict() }).strict(),
  z.object({ type: z.literal('deadline.create'), payload: z.object({ workspaceId: workspaceIdSchema, title: z.string().trim().min(1).max(160), dueAt: z.number().int().positive(), estimatedMinutes: z.number().int().min(1).max(100000), masteryPercent: z.number().int().min(0).max(100).nullable() }).strict() }).strict(),
  z.object({ type: z.literal('routine.add'), payload: z.object({ content: z.string().trim().min(1).max(500) }).strict() }).strict(),
  z.object({ type: z.literal('academic-life.save'), payload: academicLifeMutationInputSchema }).strict(),
  z.object({ type: z.literal('academic-life.transition'), payload: z.object({ id: z.uuid(), status: z.enum(['resolved', 'archived']) }).strict() }).strict(),
])
export const resolvePlannerActionInputSchema = z.object({ actionId: z.uuid(), decision: z.enum(['apply', 'reject']) }).strict()
export type PlannerActionType = z.infer<typeof plannerActionProposalSchema>['type']
export interface PlannerAction { readonly id: string; readonly originMessageId: string; readonly label: string; readonly contextVersion: number; readonly type: PlannerActionType; readonly status: 'proposed' | 'applying' | 'applied' | 'rejected' | 'obsolete'; readonly payload: unknown; readonly result: unknown | null; readonly createdAt: number; readonly resolvedAt: number | null }
export interface PlannerActionApi { listPending(): Promise<PlannerAction[]>; resolve(input: z.infer<typeof resolvePlannerActionInputSchema>): Promise<PlannerAction> }
