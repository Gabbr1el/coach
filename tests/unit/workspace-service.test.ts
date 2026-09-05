import { describe, expect, it } from 'vitest'
import { WorkspaceService } from '../../src/application/workspaces/workspace-service'
import type { CreateWorkspaceRecord, WorkspaceRepository } from '../../src/application/workspaces/workspace-repository'
import type { Workspace, WorkspaceSummary } from '../../src/shared/contracts/workspace-contract'

class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces = new Map<string, Workspace>()

  async listActive(): Promise<WorkspaceSummary[]> {
    return [...this.workspaces.values()].filter((item) => item.status === 'active')
  }

  async create(input: CreateWorkspaceRecord): Promise<Workspace> {
    const workspace: Workspace = { ...input, status: 'active', lastOpenedAt: null, archivedAt: null }
    this.workspaces.set(workspace.id, workspace)
    return workspace
  }

  async findById(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id) ?? null
  }

  async markOpened(id: string, openedAt: number): Promise<Workspace | null> {
    const workspace = this.workspaces.get(id)
    if (!workspace || workspace.status !== 'active') return null
    const updated = { ...workspace, lastOpenedAt: openedAt, updatedAt: openedAt }
    this.workspaces.set(id, updated)
    return updated
  }

  async archive(id: string, archivedAt: number): Promise<boolean> {
    const workspace = this.workspaces.get(id)
    if (!workspace || workspace.status !== 'active') return false
    this.workspaces.set(id, { ...workspace, status: 'archived', archivedAt, updatedAt: archivedAt })
    return true
  }
}

describe('WorkspaceService', () => {
  it('creates a trimmed workspace with application-owned identity and timestamps', async () => {
    const repository = new MemoryWorkspaceRepository()
    const service = new WorkspaceService({ repository, now: () => 42, createId: () => '00000000-0000-4000-8000-000000000001' })

    const workspace = await service.create({ name: '  Estrutura de Dados ', objective: ' Prova do dia 16 ' })

    expect(workspace).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Estrutura de Dados',
      objective: 'Prova do dia 16',
      createdAt: 42,
      updatedAt: 42,
    })
  })

  it('marks an active workspace as opened', async () => {
    const repository = new MemoryWorkspaceRepository()
    const service = new WorkspaceService({ repository, now: () => 80, createId: () => '00000000-0000-4000-8000-000000000002' })
    const created = await service.create({ name: 'C', objective: '' })

    const opened = await service.open(created.id)

    expect(opened?.lastOpenedAt).toBe(80)
  })

  it('does not list archived workspaces', async () => {
    const repository = new MemoryWorkspaceRepository()
    const service = new WorkspaceService({ repository, now: () => 100, createId: () => '00000000-0000-4000-8000-000000000003' })
    const created = await service.create({ name: 'C', objective: '' })

    await service.archive(created.id)

    expect(await service.list()).toEqual([])
  })
})
