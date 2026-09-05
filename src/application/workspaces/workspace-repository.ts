import type { Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'

export interface CreateWorkspaceRecord {
  readonly id: string
  readonly name: string
  readonly objective: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface WorkspaceRepository {
  listActive(): Promise<WorkspaceSummary[]>
  create(input: CreateWorkspaceRecord): Promise<Workspace>
  findById(id: string): Promise<Workspace | null>
  markOpened(id: string, openedAt: number): Promise<Workspace | null>
  archive(id: string, archivedAt: number): Promise<boolean>
}
