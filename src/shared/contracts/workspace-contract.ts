import { z } from 'zod'
import { declaredAcademicLevelSchema } from './academic-subject-context-contract'

export const workspaceIdSchema = z.uuid()

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  objective: z.string().trim().max(500),
  declaredLevel: declaredAcademicLevelSchema.optional(),
  declaredKnowledge: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  declaredDifficulties: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  goals: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
}).strict()

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly objective: string
  readonly status: 'active' | 'archived'
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastOpenedAt: number | null
  readonly archivedAt: number | null
}

export interface WorkspaceSummary {
  readonly id: string
  readonly name: string
  readonly objective: string
  readonly updatedAt: number
  readonly lastOpenedAt: number | null
}

export interface WorkspaceApi {
  list(): Promise<WorkspaceSummary[]>
  create(input: CreateWorkspaceInput): Promise<Workspace>
  open(id: string): Promise<Workspace | null>
  archive(id: string): Promise<void>
}
