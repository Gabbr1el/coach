import type { Workspace, WorkspaceContinuationRecommendation, WorkspaceSummary } from '../../shared/contracts/workspace-contract'

export interface CreateWorkspaceRecord {
  readonly id: string
  readonly name: string
  readonly objective: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly equivalenceKey?: string
  readonly meaningfulDistinction?: string | null
  readonly predecessorId?: string | null
  readonly confirmedAt?: number | null
}

export interface WorkspaceRepository {
  listActive(): Promise<WorkspaceSummary[]>
  listHistory?(): Promise<WorkspaceSummary[]>
  create(input: CreateWorkspaceRecord): Promise<Workspace>
  removeJustCreated(id: string, createdAt: number): Promise<boolean>
  findById(id: string): Promise<Workspace | null>
  findAnyById(id: string): Promise<Workspace | null>
  markOpened(id: string, openedAt: number): Promise<Workspace | null>
  archive(id: string, archivedAt: number): Promise<boolean>
  complete(id: string, completedAt: number): Promise<boolean>
  confirm(id: string, confirmedAt: number, afterConfirm?: () => void): Promise<Workspace | null>
  getHistoryDetail?(id: string): Promise<import('../../shared/contracts/workspace-contract').WorkspaceHistoryDetail | null>
  createContinuation?(predecessorId: string, input: CreateWorkspaceRecord, now: number, afterCreate?: (workspace: Workspace) => void): Promise<Workspace>
  findAcceptedContinuation?(predecessorId: string): Promise<Workspace | null>
  getContinuationRecommendation?(predecessorId: string, now: number): Promise<WorkspaceContinuationRecommendation | null>
  resolveContinuation?(id: string, decision: 'accepted' | 'declined', successorId: string | null, now: number): Promise<boolean>
}
