import { z } from 'zod'
import { declaredAcademicLevelSchema } from './academic-subject-context-contract'
import { curricularScopeSchema, fundamentalsAnswerSchema, implementationLanguageSchema } from './workspace-onboarding-contract'

export const workspaceIdSchema = z.uuid()

export const createWorkspaceInputSchema = z.object({
  draftId: workspaceIdSchema.optional(),
  analysisToken: z.string().trim().min(1).max(200).optional(),
  analysisRevision: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(80),
  objective: z.string().trim().max(500),
  canonicalFocus: z.string().trim().max(160).optional(),
  canonicalContext: z.string().trim().max(500).optional(),
  fundamentals: fundamentalsAnswerSchema.optional(),
  implementationLanguage: implementationLanguageSchema.optional(),
  localKnowledgeProjection: z.string().max(4000).optional(),
  curricularScope: curricularScopeSchema.optional(),
  duplicateOverride: z.object({ confirmed: z.literal(true), meaningfulDifference: z.string().trim().min(8).max(500) }).strict().optional(),
  declaredLevel: declaredAcademicLevelSchema.optional(),
  declaredKnowledge: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  declaredDifficulties: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  goals: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  relatedSubjects: z.array(z.object({ subject: z.string().trim().min(1).max(80), relation: z.enum(['implementation_language', 'prerequisite', 'user_selected']) }).strict()).max(20).optional(),
}).strict()

export const prepareWorkspaceDraftInputSchema = createWorkspaceInputSchema.omit({ draftId: true })

export type WorkspaceProvisioningStatus = 'draft' | 'queued' | 'running' | 'waiting_for_provider' | 'failed_retryable' | 'ready'
export type WorkspaceProvisioningStage = 'workspace' | 'materials' | 'roadmap' | 'lesson' | 'exercises' | 'plan' | 'background' | 'ready'
export interface WorkspaceLearningOverrides { readonly subject: string; readonly declaredLevel: CreateWorkspaceInput['declaredLevel'] | null; readonly declaredKnowledge: readonly string[]; readonly declaredDifficulties: readonly string[]; readonly goals: readonly string[] }
export interface ProvisioningEta { readonly label: string; readonly medianMinutes: number | null; readonly lowMinutes: number | null; readonly highMinutes: number | null; readonly sampleSize: number }
export interface ProvisioningProgress { readonly completed: number; readonly total: number | null; readonly label: string; readonly indeterminate: boolean; readonly background: boolean }
export interface WorkspaceProvisioningState { readonly workspaceId: string; readonly status: WorkspaceProvisioningStatus; readonly stage: WorkspaceProvisioningStage; readonly materialIds: readonly string[]; readonly readinessState: 'PROVISIONING' | 'USABLE' | 'FULLY_PROVISIONED'; readonly backgroundPending: number; readonly progress: ProvisioningProgress; readonly legacyState: 'legacy_accessible' | null; readonly attemptCount: number; readonly createdAt: number; readonly startedAt: number | null; readonly stageUpdatedAt: number; readonly completedAt: number | null; readonly retryAfter: number | null; readonly errorCode: string | null; readonly errorMessage: string | null; readonly eta?: ProvisioningEta }

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>

export interface PriorSubjectMemory {
  readonly subject: string
  readonly outcomes: readonly string[]
  readonly goals: readonly string[]
  readonly prerequisites: readonly string[]
  readonly memory: string | null
}

export interface WorkspaceContinuationRecommendation {
  readonly id: string
  readonly predecessorId: string
  readonly suggestedName: string
  readonly objective: string
  readonly rationale: string
  readonly action: 'create' | 'open_existing'
  readonly existingWorkspaceId: string | null
  readonly context: readonly PriorSubjectMemory[]
}

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly objective: string
  readonly status: 'active' | 'completed' | 'archived'
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastOpenedAt: number | null
  readonly archivedAt: number | null
  readonly completedAt?: number | null
  readonly equivalenceKey?: string
  readonly meaningfulDistinction?: string | null
  readonly predecessorId?: string | null
  readonly confirmedAt?: number | null
}

export type WorkspaceRepairConflictReason = 'multiple_meaningful_evidence'

export interface WorkspaceRepairConflictSummary {
  readonly reason: WorkspaceRepairConflictReason
  readonly relation: 'preserved_duplicate_of_canonical'
  readonly canonicalWorkspace: Pick<Workspace, 'id' | 'name' | 'status'>
}

export interface WorkspaceRepairConflictDetail extends WorkspaceRepairConflictSummary {
  readonly evidenceWorkspaceIds: readonly string[]
  readonly relatedWorkspaces: readonly Pick<Workspace, 'id' | 'name' | 'status'>[]
}

export interface WorkspaceHistoryDetail {
  readonly workspace: Workspace
  readonly repairConflict: WorkspaceRepairConflictDetail | null
  readonly roadmap: { readonly title: string; readonly modules: readonly { readonly title: string; readonly status: string; readonly topics: readonly string[] }[] } | null
  readonly materials: readonly { readonly id: string; readonly name: string; readonly status: string; readonly pageCount: number }[]
  readonly progress: { readonly completedTopics: number; readonly totalTopics: number; readonly evidenceEvents: number }
  readonly performance: { readonly attempts: number; readonly successfulAttempts: number; readonly focusSeconds: number }
  readonly sessions: readonly { readonly startedAt: number; readonly endedAt: number | null; readonly focusSeconds: number; readonly status: string }[]
}

export interface WorkspaceSummary {
  readonly id: string
  readonly name: string
  readonly objective: string
  readonly updatedAt: number
  readonly lastOpenedAt: number | null
  readonly status?: Workspace['status']
  readonly completedAt?: number | null
  readonly archivedAt?: number | null
  readonly provisioning?: WorkspaceProvisioningState | null
  readonly continuationRecommendation?: WorkspaceContinuationRecommendation | null
  readonly repairConflict?: WorkspaceRepairConflictSummary | null
}

export interface WorkspaceApi {
  list(): Promise<WorkspaceSummary[]>
  listHistory(): Promise<WorkspaceSummary[]>
  getHistoryDetail(id: string): Promise<WorkspaceHistoryDetail | null>
  create(input: CreateWorkspaceInput): Promise<Workspace>
  prepareDraft(input: CreateWorkspaceInput): Promise<Workspace>
  discardDraft(id: string): Promise<void>
  getProvisioning(id: string): Promise<WorkspaceProvisioningState | null>
  retryProvisioning(id: string): Promise<WorkspaceProvisioningState>
  open(id: string): Promise<Workspace | null>
  archive(id: string): Promise<void>
  acceptContinuation(id: string): Promise<Workspace>
  declineContinuation(id: string): Promise<void>
}
