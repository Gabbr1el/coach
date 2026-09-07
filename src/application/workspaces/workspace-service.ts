import type { CreateWorkspaceInput, Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { WorkspaceRepository } from './workspace-repository'
import { normalizeSubject } from './subject-normalizer'

export interface WorkspaceServiceDependencies {
  readonly repository: WorkspaceRepository
  readonly now?: () => number
  readonly createId?: () => string
  readonly ensureLearningPath?: (workspaceId: string) => Promise<unknown>
}

export class WorkspaceService {
  private readonly repository: WorkspaceRepository
  private readonly now: () => number
  private readonly createId: () => string
  private ensureLearningPath: ((workspaceId: string) => Promise<unknown>) | null

  constructor({ repository, now = Date.now, createId = () => crypto.randomUUID(), ensureLearningPath }: WorkspaceServiceDependencies) {
    this.repository = repository
    this.now = now
    this.createId = createId
    this.ensureLearningPath = ensureLearningPath ?? null
  }

  list(): Promise<WorkspaceSummary[]> {
    return this.repository.listActive()
  }

  setLearningPathEnsurer(ensureLearningPath: (workspaceId: string) => Promise<unknown>): void { this.ensureLearningPath = ensureLearningPath }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const now = this.now()
    const normalized = normalizeSubject(input.name)
    const workspace = await this.repository.create({
      id: this.createId(),
      name: normalized.subject,
      objective: [input.objective.trim(), normalized.userContext ? `Contexto declarado: ${normalized.userContext}` : ''].filter(Boolean).join('\n'),
      createdAt: now,
      updatedAt: now,
    })
    void this.ensureLearningPath?.(workspace.id).catch(() => {})
    return workspace
  }

  async open(id: string): Promise<Workspace | null> {
    const workspace = await this.repository.markOpened(id, this.now())
    if (workspace) void this.ensureLearningPath?.(workspace.id).catch(() => {})
    return workspace
  }

  async archive(id: string): Promise<void> {
    const archived = await this.repository.archive(id, this.now())
    if (!archived) {
      throw new Error('Workspace not found')
    }
  }
}
