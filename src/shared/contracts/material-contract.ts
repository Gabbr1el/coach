import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const importMaterialInputSchema = z.object({ workspaceId: workspaceIdSchema }).strict()
export const searchMaterialInputSchema = z.object({ workspaceId: workspaceIdSchema, query: z.string().trim().min(2).max(500) }).strict()
export interface MaterialSummary { readonly id: string; readonly name: string; readonly pageCount: number; readonly status: 'staged' | 'ready' | 'failed' | 'archived'; readonly relevance: number; readonly sourceUrl: string | null; readonly errorMessage: string | null; readonly createdAt: number }
export interface MaterialSearchResult { readonly chunkId: string; readonly materialId: string; readonly materialName: string; readonly pageNumber: number; readonly topicId: string | null; readonly retrieval: 'lexical'; readonly content: string }
export const updateMaterialRelevanceInputSchema = z.object({ workspaceId: workspaceIdSchema, materialId: z.uuid(), relevance: z.number().int().min(0).max(100) }).strict()
export interface MaterialApi { importPdf(workspaceId: string): Promise<MaterialSummary | null>; list(workspaceId: string): Promise<MaterialSummary[]>; search(input: z.infer<typeof searchMaterialInputSchema>): Promise<MaterialSearchResult[]>; updateRelevance(input: z.infer<typeof updateMaterialRelevanceInputSchema>): Promise<MaterialSummary> }
