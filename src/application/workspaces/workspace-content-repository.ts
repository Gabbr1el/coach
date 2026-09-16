import { createHash } from 'node:crypto'
import type { ContentJob, ContentUnitKind, RequiredContentUnit, WorkspaceContentRevision } from '../../shared/contracts/workspace-content-contract'

export const CONTENT_JOB_DEFAULTS = {
  leaseMs: 120_000,
  renewAfterMs: 60_000,
  maxAttempts: 3,
  retryBaseMs: 30_000,
  retryCapMs: 15 * 60_000,
} as const

export const CONTENT_UNIT_KEYS = {
  roadmap: 'roadmap',
  topic: (topicId: string) => topicId,
} as const

export const CONTENT_GENERATOR_VERSIONS: Record<ContentUnitKind, string> = {
  material_extract: 'material-v1', material_analyze: 'material-analysis-v1', roadmap_generate: 'roadmap-complete-curriculum-v4', lesson_generate: 'lesson-curriculum-v2', exercise_generate: 'exercise-v1', plan_recalculate: 'plan-v1',
}

export function contentJobKey(input: Pick<EnqueueContentJobInput, 'workspaceId' | 'revision' | 'kind' | 'unitKey' | 'inputHash' | 'generatorContractVersion'>): string {
  return createHash('sha256').update([input.workspaceId, input.revision, input.kind, input.unitKey, input.inputHash, input.generatorContractVersion].join('|')).digest('hex')
}

export function canonicalContentJobDependencies(input: Pick<EnqueueContentJobInput, 'workspaceId' | 'revision' | 'kind' | 'unitKey' | 'inputHash'>): string[] {
  const dependency = (kind: ContentUnitKind, unitKey: string) => contentJobKey({
    ...input,
    kind,
    unitKey,
    generatorContractVersion: CONTENT_GENERATOR_VERSIONS[kind],
  })
  if (input.kind === 'lesson_generate') return [dependency('roadmap_generate', CONTENT_UNIT_KEYS.roadmap)]
  if (input.kind === 'exercise_generate') return [dependency('lesson_generate', input.unitKey)]
  return []
}

export function usesCanonicalContentJobDependencies(input: Pick<EnqueueContentJobInput, 'kind' | 'generatorContractVersion'>): boolean {
  return (input.kind === 'lesson_generate' || input.kind === 'exercise_generate') && input.generatorContractVersion === CONTENT_GENERATOR_VERSIONS[input.kind]
}

export function contentJobDependenciesForContract(input: Pick<EnqueueContentJobInput, 'workspaceId' | 'revision' | 'kind' | 'unitKey' | 'inputHash' | 'generatorContractVersion'>): string[] {
  if (!usesCanonicalContentJobDependencies(input)) return []
  return canonicalContentJobDependencies(input)
}

export interface EnqueueContentJobInput {
  readonly workspaceId: string
  readonly revision: number
  readonly kind: ContentUnitKind
  readonly unitKey: string
  readonly priority: number
  readonly inputHash: string
  readonly generatorContractVersion: string
  readonly dependencyKeys?: readonly string[]
  readonly availableAt?: number
  readonly maxAttempts?: number
}

export interface WorkspaceContentRepository {
  getRevision(workspaceId: string): WorkspaceContentRevision | null
  createRevision(input: { workspaceId: string; inputHash: string; now: number }): WorkspaceContentRevision
  ensureRevision(input: { workspaceId: string; inputHash: string; now: number }): WorkspaceContentRevision
  adoptRoadmapRevision(input: { workspaceId: string; roadmapId: string; inputHash: string; now: number }): WorkspaceContentRevision
  replaceRequiredUnits(workspaceId: string, revision: number, units: readonly Omit<RequiredContentUnit, 'workspaceId' | 'revision' | 'createdAt'>[], now: number): RequiredContentUnit[]
  listRequiredUnits(workspaceId: string, revision: number): RequiredContentUnit[]
  enqueue(input: EnqueueContentJobInput, now: number): ContentJob
  getJob(id: string): ContentJob | null
  claimNext(input: { owner: string; now: number; leaseMs?: number }): ContentJob | null
  renewLease(input: { jobId: string; leaseToken: string; now: number; leaseMs?: number }): boolean
  releaseLease(input: { jobId: string; leaseToken: string; now: number; retryAt?: number; restoreAttempt?: boolean; errorCode?: string; errorMessage?: string }): boolean
  failLease(input: { jobId: string; leaseToken: string; now: number; retryAt?: number; errorCode: string; errorMessage?: string; retryable?: boolean }): boolean
  publishLease<T>(input: { jobId: string; leaseToken: string; now: number; publish: () => T }): T | null
  reconcile(now: number): { requeued: number; obsoleted: number }
  invalidateArchivedWorkspace?(workspaceId: string, now: number): number
  retryProviderUnavailable(now: number): number
  evaluateReadiness(input: { workspaceId: string; expectedRevision: number; todayDateKey: string; now: number }): WorkspaceContentRevision
}
