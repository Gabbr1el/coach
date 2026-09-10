import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
import type { HomeOrganizerResult } from './planning-contract'
import type { WorkspaceActionResult } from './workspace-action-contract'

export const sendHomeMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
}).strict()

export const streamHomeMessageInputSchema = sendHomeMessageInputSchema.extend({
  requestId: z.uuid(),
}).strict()

export const cancelHomeStreamInputSchema = z.object({ requestId: z.uuid() }).strict()

export const workspaceConversationInputSchema = z.object({ workspaceId: workspaceIdSchema }).strict()

export const streamWorkspaceMessageInputSchema = sendHomeMessageInputSchema.extend({
  requestId: z.uuid(),
  workspaceId: workspaceIdSchema,
  activePage: z.enum(['overview', 'plan', 'studies', 'exercises', 'materials', 'practice', 'videos', 'reports']).optional(),
  activeStudy: z.object({ roadmapId: z.uuid(), moduleId: z.string().max(100), module: z.string().max(160), topicId: z.string().max(300), topic: z.string().max(240), lessonId: z.string().max(360), currentBlockId: z.string().max(420), checkpointId: z.string().max(420).nullable(), currentExcerpt: z.string().max(4000).nullable() }).optional(),
  activeInteractiveCode: z.object({ lessonId: z.string().max(360), blockId: z.string().max(420), interactionType: z.enum(['PREDICT_AND_RUN', 'EDIT_AND_RUN', 'FIX_AND_RUN']), instruction: z.string().max(2000), language: z.enum(['python', 'c', 'java']), code: z.string().max(20_000), prediction: z.string().max(2000).nullable(), attempts: z.number().int().nonnegative(), lastExecution: z.object({ stdout: z.string().max(8000), stderr: z.string().max(8000), exitCode: z.number().int().nullable(), timedOut: z.boolean() }).nullable(), validationResult: z.object({ status: z.enum(['not_applicable', 'passed', 'failed', 'stale', 'unavailable']), message: z.string().max(1000) }).nullable() }).optional(),
  activeExercise: z.object({ exerciseId: z.string().min(1).max(420) }).strict().optional(),
  activeMaterial: z.object({ materialId: z.uuid(), name: z.string().max(500), pageOrSlide: z.number().int().min(1).max(500).nullable(), selectedText: z.string().max(2000).nullable() }).nullable().optional(),
  practiceContext: z.object({ fileName: z.string().max(500), language: z.string().max(40), code: z.string().max(200_000) }).optional(),
  lastExecution: z.object({ stdout: z.string().max(8000), stderr: z.string().max(8000), exitCode: z.number().int().nullable(), timedOut: z.boolean() }).nullable().optional(),
}).strict()

export const cancelWorkspaceStreamInputSchema = z.object({ requestId: z.uuid() }).strict()
export const workspaceCoachDecisionSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('final_response') }).strict(), z.object({ kind: z.literal('context_read'), requests: z.array(z.object({ resource: z.enum(['workspace', 'academic', 'roadmap', 'progress', 'lesson', 'materials', 'plan', 'notes']), id: z.string().max(500).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(6000).optional(), pageNumber: z.number().int().min(1).max(500).optional(), query: z.string().max(500).optional() }).strict()).min(1).max(3) }).strict(), z.object({ kind: z.literal('workspace_action'), action: z.object({ type: z.enum(['plan.recalculate', 'plan.complete', 'notes.add']), arguments: z.record(z.string(), z.unknown()) }).strict() }).strict()])

export type SendHomeMessageInput = z.infer<typeof sendHomeMessageInputSchema>
export type StreamHomeMessageInput = z.infer<typeof streamHomeMessageInputSchema>
export type StreamWorkspaceMessageInput = z.infer<typeof streamWorkspaceMessageInputSchema>

export type ConversationRole = 'user' | 'assistant' | 'system'

export interface ConversationMessage {
  readonly id: string
  readonly role: ConversationRole
  readonly content: string
  readonly createdAt: number
  readonly sequence: number
  readonly providerId: string | null
  readonly modelId: string | null
}

export interface ConversationApi {
  listHomeMessages(): Promise<ConversationMessage[]>
  sendHomeMessage(input: SendHomeMessageInput): Promise<ConversationMessage[]>
  organizeHomeMessage(input: SendHomeMessageInput): Promise<{ messages: ConversationMessage[]; result: HomeOrganizerResult }>
  saveHomeActionResult(content: string): Promise<ConversationMessage[]>
  streamHomeMessage(input: StreamHomeMessageInput, onEvent: (event: HomeStreamEvent) => void): {
    cancel(): void
    dispose(): void
  }
  listWorkspaceMessages(workspaceId: string): Promise<ConversationMessage[]>
  executeWorkspaceAction(input: unknown): Promise<WorkspaceActionResult>
  streamWorkspaceMessage(input: StreamWorkspaceMessageInput, onEvent: (event: HomeStreamEvent) => void): {
    cancel(): void
    dispose(): void
  }
}

export type HomeStreamEvent =
  | { readonly requestId: string; readonly type: 'started' }
  | { readonly requestId: string; readonly type: 'text-delta'; readonly content: string }
  | { readonly requestId: string; readonly type: 'completed'; readonly messages: ConversationMessage[]; readonly metadata?: { readonly lessonAdapted: { readonly lessonId: string; readonly blockId: string } } }
  | { readonly requestId: string; readonly type: 'cancelled' }
  | { readonly requestId: string; readonly type: 'error'; readonly code: 'PROVIDER_UNAVAILABLE' | 'REQUEST_FAILED' | 'THREAD_BUSY' }
