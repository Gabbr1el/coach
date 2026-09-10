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
  const analyzed = (name: string, focus = name, context = '') => ({ analysisRevision: 10, analysisToken: 'server-issued-analysis-token', canonicalFocus: focus, canonicalContext: context })
  it('stores workspace overrides without overwriting global academic context', async () => { const repository = new MemoryWorkspaceRepository(); let globalWrites = 0; let override: unknown; const service = new WorkspaceService({ repository, createId: () => '00000000-0000-4000-8000-000000000099', now: () => 10, academicContext: { record: () => { globalWrites += 1 } } as never, saveLearningOverrides: (_id, _subject, input) => { override = input } }); await service.create({ name: 'Python', objective: 'Automação', declaredLevel: 'advanced', declaredKnowledge: ['Decorators'] }); expect(globalWrites).toBe(0); expect(override).toMatchObject({ declaredLevel: 'advanced', declaredKnowledge: ['Decorators'] }) })
  it('stores declared context separately without converting it to observed mastery', async () => { const repository = new MemoryWorkspaceRepository(); const recorded: any[] = []; const service = new WorkspaceService({ repository, academicContext: { record: (input: unknown) => { recorded.push(input); return {} } } as any }); await service.create({ name: 'Python', objective: 'Automação', declaredLevel: 'advanced', declaredKnowledge: ['Uso pandas'], declaredDifficulties: [], goals: ['Faculdade'] }); expect(recorded[0]).toMatchObject({ subject: 'Python', declaredLevel: 'advanced', declaredKnowledge: ['Uso pandas'] }); expect(JSON.stringify(recorded[0])).not.toContain('mastery') })
  it('creates the workspace and explicit academic relations through one atomic dependency', async () => { const repository = new MemoryWorkspaceRepository(); const calls: unknown[] = []; const service = new WorkspaceService({ repository, createId: () => '00000000-0000-4000-8000-000000000010', createWithAcademicContexts: (workspace, academic, related) => { calls.push([workspace, academic, related]); return { ...workspace, status: 'active', lastOpenedAt: null, archivedAt: null } } }); await service.create({ name: 'Java', objective: 'Aprender POO', relatedSubjects: [{ subject: 'Python', relation: 'user_selected' }] }); expect(calls).toMatchObject([[{ id: '00000000-0000-4000-8000-000000000010', name: 'Java' }, { declaredKnowledge: [], declaredDifficulties: [], goals: ['Aprender POO'] }, [{ subject: 'Python', relation: 'user_selected' }]]]) })
  it('returns a created workspace before learning path generation finishes', async () => { const repository = new MemoryWorkspaceRepository(); let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve }); const service = new WorkspaceService({ repository, ensureLearningPath: async () => pending }); const created = await Promise.race([service.create({ name: 'C', objective: 'Estudar C' }), new Promise((_, reject) => setTimeout(() => reject(new Error('blocked')), 20))]); expect(created).toMatchObject({ name: 'C' }); release() })
  it('rejects stale analysis and requires programming fundamentals in the provisioned flow', async () => { const repository = new MemoryWorkspaceRepository(); const states = new Map<string, any>(); const provisioning = { createDraft: (id: string) => { const state = { workspaceId: id, status: 'draft' }; states.set(id, state); return state }, start: (id: string) => states.get(id), get: (id: string) => states.get(id), retry: (id: string) => states.get(id), discardDraft: () => {} } as never; const service = new WorkspaceService({ repository, provisioning, validateAnalysis: (token) => token === 'server-issued-analysis-token' }); await expect(service.create({ name: 'Python', objective: 'Aprender', ...analyzed('Python'), fundamentals: 'no' })).resolves.toMatchObject({ name: 'Python' }); await expect(service.create({ name: 'Java', objective: 'Aprender', ...analyzed('Java'), analysisToken: 'stale', fundamentals: 'unknown' })).rejects.toThrow('expired'); await expect(service.create({ name: 'TypeScript', objective: 'Aprender', ...analyzed('TypeScript') })).rejects.toThrow('fundamentals') })
  it('blocks a semantic duplicate until a meaningful explicit override is confirmed', async () => { const repository = new MemoryWorkspaceRepository(); const existing = await repository.create({ id: 'existing', name: 'Estruturas de Dados', objective: 'C', createdAt: 1, updatedAt: 1 }); const service = new WorkspaceService({ repository, findSemanticDuplicate: () => existing }); const base = { name: 'Estruturas de Dados', objective: 'Filas em C', ...analyzed('Estruturas de Dados', 'Estruturas de Dados em C', 'linguagem:C'), fundamentals: 'unknown' as const }; await expect(service.create(base)).rejects.toThrow('WORKSPACE_DUPLICATE|existing|Estruturas de Dados'); await expect(service.create({ ...base, duplicateOverride: { confirmed: true, meaningfulDifference: 'Foco exclusivo em filas circulares' } })).resolves.toMatchObject({ objective: 'Filas em C' }) })
  it('uses the default UUID generator without losing its Crypto receiver', async () => {
    const repository = new MemoryWorkspaceRepository()
    const service = new WorkspaceService({ repository, now: () => 42 })

    const workspace = await service.create({ name: 'C', objective: '' })

    expect(workspace.id).toMatch(/^[0-9a-f-]{36}$/)
  })

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
