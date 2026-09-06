import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'
export const importMaterialInputSchema = z.object({ workspaceId: workspaceIdSchema }).strict()
export const searchMaterialInputSchema = z.object({ workspaceId: workspaceIdSchema, query: z.string().trim().min(2).max(500) }).strict()
export interface MaterialSummary { readonly id: string; readonly name: string; readonly pageCount: number; readonly createdAt: number }
export interface MaterialSearchResult { readonly materialId: string; readonly materialName: string; readonly pageNumber: number; readonly content: string }
export interface MaterialApi { importPdf(workspaceId: string): Promise<MaterialSummary | null>; list(workspaceId: string): Promise<MaterialSummary[]>; search(input: z.infer<typeof searchMaterialInputSchema>): Promise<MaterialSearchResult[]> }
