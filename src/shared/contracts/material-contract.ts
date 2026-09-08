import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const importMaterialInputSchema = z.object({ workspaceId: workspaceIdSchema }).strict()
export const materialRoleSchema = z.enum(['base', 'priority', 'reference'])
export const materialDocumentTypeSchema = z.enum(['lecture_slides', 'notes', 'textbook', 'exercise_list', 'exam', 'syllabus', 'assignment', 'reference', 'unrelated', 'unknown'])
export const materialSemanticAnalysisSchema = z.object({ documentType: materialDocumentTypeSchema, subject: z.string().max(120), summary: z.string().max(2000), topics: z.array(z.string().max(160)).max(50), prerequisiteTopics: z.array(z.string().max(160)).max(30), estimatedLevel: z.enum(['beginner', 'intermediate', 'advanced', 'unknown']), relationToObjective: z.string().max(1000), relevance: z.enum(['high', 'medium', 'low', 'unrelated']), confidence: z.number().min(0).max(1) }).strict()
export type MaterialSemanticAnalysis = z.infer<typeof materialSemanticAnalysisSchema>
export const searchMaterialInputSchema = z.object({ workspaceId: workspaceIdSchema, query: z.string().trim().min(2).max(500) }).strict()
export interface MaterialSummary { readonly id: string; readonly name: string; readonly mediaType?: string; readonly pageCount: number; readonly status: 'staged' | 'ready' | 'failed' | 'archived'; readonly relevance: number; readonly role?: z.infer<typeof materialRoleSchema>; readonly semanticAnalysis?: MaterialSemanticAnalysis | null; readonly sourceUrl: string | null; readonly errorMessage: string | null; readonly createdAt: number }
export interface MaterialSearchResult { readonly chunkId: string; readonly materialId: string; readonly materialName: string; readonly pageNumber: number; readonly topicId: string | null; readonly retrieval: 'lexical'; readonly content: string }
export const updateMaterialRelevanceInputSchema = z.object({ workspaceId: workspaceIdSchema, materialId: z.uuid(), relevance: z.number().int().min(0).max(100) }).strict()
export const decideMaterialInputSchema = z.object({ workspaceId: workspaceIdSchema, materialId: z.uuid(), decision: z.enum(['approve', 'discard']), role: materialRoleSchema.default('reference') }).strict()
export interface MaterialApi { importPdf(workspaceId: string): Promise<MaterialSummary | null>; importFile(workspaceId: string): Promise<MaterialSummary | null>; list(workspaceId: string): Promise<MaterialSummary[]>; search(input: z.infer<typeof searchMaterialInputSchema>): Promise<MaterialSearchResult[]>; updateRelevance(input: z.infer<typeof updateMaterialRelevanceInputSchema>): Promise<MaterialSummary>; decide(input: z.infer<typeof decideMaterialInputSchema>): Promise<MaterialSummary> }
