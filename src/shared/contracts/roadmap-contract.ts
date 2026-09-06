import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

export const roadmapModuleProposalSchema = z.object({ title: z.string().trim().min(1).max(160), objective: z.string().trim().min(1).max(500), estimatedMinutes: z.number().int().min(10).max(2400), outcomes: z.array(z.string().trim().min(1).max(240)).min(1).max(8) }).strict()
export const roadmapProposalSchema = z.object({ title: z.string().trim().min(1).max(160), modules: z.array(roadmapModuleProposalSchema).min(2).max(16) }).strict()
export const workspaceRoadmapInputSchema = z.object({ workspaceId: workspaceIdSchema }).strict()
export const acceptRoadmapInputSchema = z.object({ workspaceId: workspaceIdSchema, roadmapId: z.uuid() }).strict()

export interface RoadmapModule { readonly id: string; readonly title: string; readonly objective: string; readonly estimatedMinutes: number; readonly position: number; readonly status: 'locked' | 'available' | 'active' | 'completed'; readonly outcomes: string[] }
export interface Roadmap { readonly id: string; readonly workspaceId: string; readonly title: string; readonly status: 'proposed' | 'accepted' | 'archived'; readonly version: number; readonly providerId: string | null; readonly modelId: string | null; readonly modules: RoadmapModule[]; readonly createdAt: number; readonly updatedAt: number }
export interface RoadmapApi { get(workspaceId: string): Promise<Roadmap | null>; generate(workspaceId: string): Promise<Roadmap>; accept(input: z.infer<typeof acceptRoadmapInputSchema>): Promise<Roadmap> }
