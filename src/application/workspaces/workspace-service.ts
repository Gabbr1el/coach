import type { CreateWorkspaceInput, Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { WorkspaceRepository } from './workspace-repository'

export interface WorkspaceServiceDependencies {
  readonly repository: WorkspaceRepository
  readonly now?: () => number
  readonly createId?: () => string
}

export class WorkspaceService {
  private readonly repository: WorkspaceRepository
  private readonly now: () => number
  private readonly createId: () => string

  constructor({ repository, now = Date.now, createId = crypto.randomUUID }: WorkspaceServiceDependencies) {
    this.repository = repository
    this.now = now
    this.createId = createId
  }

  list(): Promise<WorkspaceSummary[]> {
    return this.repository.listActive()
  }

  create(input: CreateWorkspaceInput): Promise<Workspace> {
    const now = this.now()
    return this.repository.create({
      id: this.createId(),
      name: input.name.trim(),
      objective: input.objective.trim(),
      createdAt: now,
      updatedAt: now,
    })
  }

  open(id: string): Promise<Workspace | null> {
    return this.repository.markOpened(id, this.now())
  }

  async archive(id: string): Promise<void> {
    const archived = await this.repository.archive(id, this.now())
    if (!archived) {
      throw new Error('Workspace not found')
    }
  }
}
