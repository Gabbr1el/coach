import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
import { conceptMemorySchema } from './learning-evidence-contract'

const id = z.string().min(1).max(420)
export const reviewReasonSchema = z.enum(['due_review', 'recent_failure', 'retention_decay', 'maintenance', 'deadline_priority', 'misconception_followup'])
export const reviewPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('multiple_choice'), prompt: z.string().min(1).max(5000), options: z.array(z.object({ id, label: z.string().min(1).max(2000) }).strict()).min(2).max(6) }).strict(),
  z.object({ type: z.literal('code_observation'), prompt: z.string().min(1).max(5000), language: z.enum(['python', 'c', 'java']), code: z.string().min(1).max(20_000) }).strict(),
])
export const reviewItemSchema = z.object({ id, position: z.number().int().positive(), conceptId: id, conceptName: z.string().min(1).max(240), assessmentIntentId: id, assessmentVariantId: id, sourceTopicId: id.nullable(), sourceExerciseId: id.nullable(), reason: reviewReasonSchema, status: z.enum(['pending', 'answered']), attempts: z.number().int().nonnegative(), helpCount: z.number().int().nonnegative(), result: z.enum(['correct', 'incorrect']).nullable(), payload: reviewPayloadSchema, memoryBefore: conceptMemorySchema.nullable(), memoryAfter: conceptMemorySchema.nullable(), firstSeenAt: z.number().int().nonnegative(), answeredAt: z.number().int().nonnegative().nullable() }).strict()
export const reviewSessionSchema = z.object({ id, workspaceId: workspaceIdSchema, targetSize: z.number().int().min(4).max(12), status: z.enum(['active', 'completed', 'preparation']), startedAt: z.number().int().nonnegative(), completedAt: z.number().int().nonnegative().nullable(), updatedAt: z.number().int().nonnegative(), items: z.array(reviewItemSchema).max(12), message: z.string().min(1).max(1000).nullable() }).strict()
export const startReviewInputSchema = z.object({ workspaceId: workspaceIdSchema, targetSize: z.number().int().min(4).max(12).default(8) }).strict()
export const submitReviewInputSchema = z.object({ workspaceId: workspaceIdSchema, sessionId: id, itemId: id, answer: z.string().max(20_000), idempotencyKey: z.string().min(8).max(200) }).strict()
export const helpReviewInputSchema = z.object({ workspaceId: workspaceIdSchema, sessionId: id, itemId: id, requestId: z.string().min(8).max(200) }).strict()
export type ReviewSession = z.infer<typeof reviewSessionSchema>
export interface ReviewApi { getActive(workspaceId: string): Promise<ReviewSession | null>; start(input: z.input<typeof startReviewInputSchema>): Promise<ReviewSession>; submit(input: z.infer<typeof submitReviewInputSchema>): Promise<ReviewSession>; requestHelp(input: z.infer<typeof helpReviewInputSchema>): Promise<ReviewSession> }
