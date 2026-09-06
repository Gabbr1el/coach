import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
export const addSavedForLaterSchema = z.object({ workspaceId: workspaceIdSchema, content: z.string().trim().min(1).max(500) }).strict()
export interface SavedForLaterItem { readonly id: string; readonly content: string; readonly completedAt: number | null; readonly createdAt: number }
export interface SessionOutlineItem { readonly id: string; readonly title: string; readonly kind: string; readonly occurredAt: number }
export interface SessionNavigationApi { addSavedForLater(input: z.infer<typeof addSavedForLaterSchema>): Promise<SavedForLaterItem>; listSavedForLater(workspaceId: string): Promise<SavedForLaterItem[]>; listOutline(workspaceId: string): Promise<SessionOutlineItem[]> }
