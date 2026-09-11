import type { Roadmap } from '../../shared/contracts/roadmap-contract'
import type { StudyLessonLoadResult } from '../../shared/contracts/study-lesson-contract'
import type { WorkspaceProvisioningState } from '../../shared/contracts/workspace-contract'

const RETRY_DELAY = 30_000

export interface WorkspaceProvisioningRepository {
  find(workspaceId: string): WorkspaceProvisioningState | null
  save(state: WorkspaceProvisioningState): WorkspaceProvisioningState
  listResumable(now: number): string[]
  removeDraft(workspaceId: string): boolean
}

export interface WorkspaceProvisioningDependencies {
  readonly repository: WorkspaceProvisioningRepository
  readonly ensureRoadmap: (workspaceId: string, materialIds: string[]) => Promise<{ status: string; activeRoadmapId: string | null; lastErrorCode: string | null; retryAfter: number | null }>
  readonly getRoadmap: (workspaceId: string) => Promise<Roadmap | null>
  readonly ensureLesson: (input: { workspaceId: string; roadmapId: string; moduleId: string; topicId: string }) => Promise<StudyLessonLoadResult>
  readonly listReadyMaterialIds: (workspaceId: string) => string[]
  readonly now?: () => number
  readonly initializeContent?: (workspaceId: string) => void
}

function safeMessage(error: unknown): string { return (error instanceof Error ? error.message : 'Falha desconhecida').replace(/[\r\n\t]+/g, ' ').slice(0, 500) }

export class WorkspaceProvisioningService {
  private readonly running = new Map<string, Promise<WorkspaceProvisioningState>>()
  private readonly now: () => number
  constructor(private readonly dependencies: WorkspaceProvisioningDependencies) { this.now = dependencies.now ?? Date.now }

  createDraft(workspaceId: string): WorkspaceProvisioningState {
    const now = this.now()
    return this.dependencies.repository.save({ workspaceId, status: 'draft', stage: 'workspace', materialIds: [], readinessState: 'PROVISIONING', backgroundPending: 0, legacyState: null, attemptCount: 0, createdAt: now, startedAt: null, stageUpdatedAt: now, completedAt: null, retryAfter: null, errorCode: null, errorMessage: null })
  }
  get(workspaceId: string): WorkspaceProvisioningState | null { return this.dependencies.repository.find(workspaceId) }
  discardDraft(workspaceId: string): void { if (!this.dependencies.repository.removeDraft(workspaceId)) throw new Error('Workspace draft not found') }
  start(workspaceId: string): WorkspaceProvisioningState {
    const current = this.require(workspaceId)
    if (current.status === 'ready') return current
    const now = this.now(); const materialIds = this.dependencies.listReadyMaterialIds(workspaceId)
    const queued = this.dependencies.repository.save({ ...current, status: 'queued', stage: materialIds.length ? 'materials' : 'workspace', materialIds, stageUpdatedAt: now, retryAfter: null, errorCode: null, errorMessage: null })
    if (this.dependencies.initializeContent) { this.dependencies.initializeContent(workspaceId); return this.require(workspaceId) }
    void this.resume(workspaceId)
    return queued
  }
  retry(workspaceId: string): WorkspaceProvisioningState { return this.start(workspaceId) }
  resumePending(): void { for (const workspaceId of this.dependencies.repository.listResumable(this.now())) { const state = this.dependencies.repository.find(workspaceId); if (state?.status === 'running') this.dependencies.repository.save({ ...state, status: 'failed_retryable', retryAfter: null, errorCode: 'INTERRUPTED', errorMessage: 'A preparação foi interrompida e será retomada.', stageUpdatedAt: this.now() }); void this.resume(workspaceId) } }
  resume(workspaceId: string): Promise<WorkspaceProvisioningState> {
    const active = this.running.get(workspaceId); if (active) return active
    if (this.dependencies.initializeContent) { this.dependencies.initializeContent(workspaceId); return Promise.resolve(this.require(workspaceId)) }
    const task = this.run(workspaceId).finally(() => this.running.delete(workspaceId)); this.running.set(workspaceId, task); return task
  }
  private async run(workspaceId: string): Promise<WorkspaceProvisioningState> {
    let state = this.require(workspaceId)
    if (state.status === 'ready' || state.status === 'draft' || (state.status !== 'running' && state.retryAfter !== null && state.retryAfter > this.now())) return state
    const startedAt = state.startedAt ?? this.now()
    state = this.dependencies.repository.save({ ...state, status: 'running', stage: 'roadmap', attemptCount: state.attemptCount + 1, startedAt, stageUpdatedAt: this.now(), retryAfter: null, errorCode: null, errorMessage: null })
    try {
      const pathState = await this.dependencies.ensureRoadmap(workspaceId, [...state.materialIds])
      if (pathState.status !== 'ready') return this.dependencies.repository.save({ ...state, status: pathState.status === 'waiting_for_provider' ? 'waiting_for_provider' : 'failed_retryable', stage: 'roadmap', stageUpdatedAt: this.now(), retryAfter: pathState.retryAfter ?? this.now() + RETRY_DELAY, errorCode: pathState.lastErrorCode ?? 'ROADMAP_NOT_READY', errorMessage: 'A Trilha ainda não ficou pronta.' })
      const roadmap = await this.dependencies.getRoadmap(workspaceId)
      const module = roadmap?.modules.find((item) => item.status === 'active' || item.status === 'available') ?? roadmap?.modules[0]
      const topic = module?.topics[0]
      if (!roadmap || !module || !topic) throw new Error('A Trilha persistida não possui um primeiro tópico válido')
      state = this.dependencies.repository.save({ ...state, status: 'running', stage: 'lesson', stageUpdatedAt: this.now(), retryAfter: null, errorCode: null, errorMessage: null })
      const lesson = await this.dependencies.ensureLesson({ workspaceId, roadmapId: roadmap.id, moduleId: module.id, topicId: `${module.id}:${topic}` })
      if (lesson.status !== 'ready') return this.dependencies.repository.save({ ...state, status: lesson.status === 'waiting_for_provider' ? 'waiting_for_provider' : 'failed_retryable', stage: 'lesson', stageUpdatedAt: this.now(), retryAfter: this.now() + RETRY_DELAY, errorCode: lesson.errorCode, errorMessage: 'A primeira aula ainda não ficou pronta.' })
      const completedAt = this.now()
      return this.dependencies.repository.save({ ...state, status: 'ready', stage: 'ready', stageUpdatedAt: completedAt, completedAt, retryAfter: null, errorCode: null, errorMessage: null })
    } catch (error) {
      return this.dependencies.repository.save({ ...state, status: 'failed_retryable', stageUpdatedAt: this.now(), retryAfter: this.now() + RETRY_DELAY, errorCode: 'PROVISIONING_FAILED', errorMessage: safeMessage(error) })
    }
  }
  private require(workspaceId: string): WorkspaceProvisioningState { const state = this.dependencies.repository.find(workspaceId); if (!state) throw new Error('Workspace provisioning not found'); return state }
}
