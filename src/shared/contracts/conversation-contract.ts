import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
import type { HomeOrganizerResult } from './planning-contract'

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
  activePage: z.enum(['overview', 'plan', 'studies', 'materials', 'practice', 'videos', 'reports']).optional(),
  activeStudy: z.object({ moduleId: z.string().max(100), module: z.string().max(160), topicId: z.string().max(300), topic: z.string().max(240), lessonId: z.string().max(360), checkpointId: z.string().max(420).nullable(), currentExcerpt: z.string().max(4000).nullable() }).optional(),
  practiceContext: z.object({ fileName: z.string().max(500), language: z.string().max(40), code: z.string().max(200_000) }).optional(),
  lastExecution: z.object({ stdout: z.string().max(8000), stderr: z.string().max(8000), exitCode: z.number().int().nullable(), timedOut: z.boolean() }).nullable().optional(),
}).strict()

export const cancelWorkspaceStreamInputSchema = z.object({ requestId: z.uuid() }).strict()

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
  streamWorkspaceMessage(input: StreamWorkspaceMessageInput, onEvent: (event: HomeStreamEvent) => void): {
    cancel(): void
    dispose(): void
  }
}

export type HomeStreamEvent =
  | { readonly requestId: string; readonly type: 'started' }
  | { readonly requestId: string; readonly type: 'text-delta'; readonly content: string }
  | { readonly requestId: string; readonly type: 'completed'; readonly messages: ConversationMessage[] }
  | { readonly requestId: string; readonly type: 'cancelled' }
  | { readonly requestId: string; readonly type: 'error'; readonly code: 'PROVIDER_UNAVAILABLE' | 'REQUEST_FAILED' | 'THREAD_BUSY' }
