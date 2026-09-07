import { z } from 'zod'
import { workspaceIdSchema } from './workspace-contract'

const trustedRoadmapHosts = ['roadmap.sh', 'developer.mozilla.org', 'docs.oracle.com', 'docs.python.org', 'learn.microsoft.com', 'freecodecamp.org', 'khanacademy.org']
export const roadmapResourceSchema = z.object({ title: z.string().trim().min(1).max(160), url: z.url().max(1000).refine((value) => { const url = new URL(value); return url.protocol === 'https:' && trustedRoadmapHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) }, 'Fonte não permitida'), type: z.enum(['roadmap', 'documentation', 'course', 'article', 'video']) }).strict()
export const roadmapModuleProposalSchema = z.object({ title: z.string().trim().min(1).max(160), objective: z.string().trim().min(1).max(500), estimatedMinutes: z.number().int().min(10).max(2400), topics: z.array(z.string().trim().min(1).max(240)).min(2).max(12), outcomes: z.array(z.string().trim().min(1).max(240)).min(1).max(8), practice: z.string().trim().min(1).max(600), completionCriteria: z.array(z.string().trim().min(1).max(240)).min(1).max(6), resources: z.array(roadmapResourceSchema).max(6) }).strict()
export const roadmapProposalSchema = z.object({ title: z.string().trim().min(1).max(160), modules: z.array(roadmapModuleProposalSchema).min(2).max(16) }).strict()
export const workspaceRoadmapInputSchema = z.object({ workspaceId: workspaceIdSchema }).strict()
export const acceptRoadmapInputSchema = z.object({ workspaceId: workspaceIdSchema, roadmapId: z.uuid() }).strict()

export interface RoadmapResource { readonly title: string; readonly url: string; readonly type: 'roadmap' | 'documentation' | 'course' | 'article' | 'video' }
export interface RoadmapModule { readonly id: string; readonly title: string; readonly objective: string; readonly estimatedMinutes: number; readonly position: number; readonly status: 'locked' | 'available' | 'active' | 'completed'; readonly topics: string[]; readonly outcomes: string[]; readonly practice: string; readonly completionCriteria: string[]; readonly resources: RoadmapResource[] }
export interface Roadmap { readonly id: string; readonly workspaceId: string; readonly title: string; readonly status: 'proposed' | 'accepted' | 'archived'; readonly version: number; readonly providerId: string | null; readonly modelId: string | null; readonly modules: RoadmapModule[]; readonly createdAt: number; readonly updatedAt: number }
export interface RoadmapApi { get(workspaceId: string): Promise<Roadmap | null>; generate(workspaceId: string): Promise<Roadmap>; accept(input: z.infer<typeof acceptRoadmapInputSchema>): Promise<Roadmap> }
