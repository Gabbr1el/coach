import { z } from 'zod'
import { declaredAcademicLevelSchema } from './academic-subject-context-contract'

export const workspaceIdSchema = z.uuid()

export const createWorkspaceInputSchema = z.object({
  draftId: workspaceIdSchema.optional(),
  name: z.string().trim().min(1).max(80),
  objective: z.string().trim().max(500),
  declaredLevel: declaredAcademicLevelSchema.optional(),
  declaredKnowledge: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  declaredDifficulties: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  goals: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  relatedSubjects: z.array(z.object({ subject: z.string().trim().min(1).max(80), relation: z.enum(['implementation_language', 'prerequisite', 'user_selected']) }).strict()).max(20).optional(),
}).strict()

export const prepareWorkspaceDraftInputSchema = createWorkspaceInputSchema.omit({ draftId: true })

export type WorkspaceProvisioningStatus = 'draft' | 'queued' | 'running' | 'waiting_for_provider' | 'failed_retryable' | 'ready'
export type WorkspaceProvisioningStage = 'workspace' | 'materials' | 'roadmap' | 'lesson' | 'ready'
export interface WorkspaceLearningOverrides { readonly subject: string; readonly declaredLevel: CreateWorkspaceInput['declaredLevel'] | null; readonly declaredKnowledge: readonly string[]; readonly declaredDifficulties: readonly string[]; readonly goals: readonly string[] }
export interface WorkspaceProvisioningState { readonly workspaceId: string; readonly status: WorkspaceProvisioningStatus; readonly stage: WorkspaceProvisioningStage; readonly materialIds: readonly string[]; readonly attemptCount: number; readonly createdAt: number; readonly startedAt: number | null; readonly stageUpdatedAt: number; readonly completedAt: number | null; readonly retryAfter: number | null; readonly errorCode: string | null; readonly errorMessage: string | null }

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
  readonly provisioning?: WorkspaceProvisioningState | null
}

export interface WorkspaceApi {
  list(): Promise<WorkspaceSummary[]>
  create(input: CreateWorkspaceInput): Promise<Workspace>
  prepareDraft(input: CreateWorkspaceInput): Promise<Workspace>
  discardDraft(id: string): Promise<void>
  getProvisioning(id: string): Promise<WorkspaceProvisioningState | null>
  retryProvisioning(id: string): Promise<WorkspaceProvisioningState>
  open(id: string): Promise<Workspace | null>
  archive(id: string): Promise<void>
}
