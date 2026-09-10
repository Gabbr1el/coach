import { describe, expect, it } from 'vitest'
import { WorkspaceProvisioningService, type WorkspaceProvisioningRepository } from '../../src/application/workspaces/workspace-provisioning-service'
import type { WorkspaceProvisioningState } from '../../src/shared/contracts/workspace-contract'
import type { Roadmap } from '../../src/shared/contracts/roadmap-contract'

class MemoryProvisioning implements WorkspaceProvisioningRepository {
  values = new Map<string, WorkspaceProvisioningState>()
  find(id: string) { return this.values.get(id) ?? null }
  save(value: WorkspaceProvisioningState) { this.values.set(value.workspaceId, value); return value }
  listResumable(now: number) { return [...this.values.values()].filter((item) => !item.retryAfter || item.retryAfter <= now).map((item) => item.workspaceId) }
  removeDraft(id: string) { const value = this.find(id); return Boolean(value?.status === 'draft' && this.values.delete(id)) }
}
const roadmap = { id: 'roadmap', workspaceId: 'workspace', title: 'Trilha', status: 'accepted', generationKind: 'ai_generated', version: 1, providerId: 'p', modelId: 'm', modules: [{ id: 'module', title: 'M', objective: 'O', estimatedMinutes: 30, position: 1, status: 'active', topics: ['Tema'], outcomes: ['Saber'], practice: 'Praticar', completionCriteria: ['Concluir'], resources: [] }], createdAt: 1, updatedAt: 1 } as Roadmap

describe('WorkspaceProvisioningService', () => {
  it('is truly ready only after roadmap and first persisted lesson', async () => { const repository = new MemoryProvisioning(); const stages: string[] = []; const service = new WorkspaceProvisioningService({ repository: { ...repository, find: repository.find.bind(repository), save: (state) => { stages.push(state.stage); return repository.save(state) }, listResumable: repository.listResumable.bind(repository), removeDraft: repository.removeDraft.bind(repository) }, ensureRoadmap: async () => ({ status: 'ready', activeRoadmapId: 'roadmap', lastErrorCode: null, retryAfter: null }), getRoadmap: async () => roadmap, ensureLesson: async () => ({ status: 'ready', lesson: { id: 'lesson' } } as never), listReadyMaterialIds: () => ['material'], now: (() => { let n = 0; return () => ++n })() }); service.createDraft('workspace'); service.start('workspace'); const state = await service.resume('workspace'); expect(state.status).toBe('ready'); expect(state.materialIds).toEqual(['material']); expect(stages).toContain('lesson'); expect(stages.at(-1)).toBe('ready') })
  it('resumes a transient failure after restart without creating a second state', async () => { const repository = new MemoryProvisioning(); let now = 1; let calls = 0; const dependencies = { repository, ensureRoadmap: async () => { calls += 1; if (calls === 1) throw new Error('network unavailable'); return { status: 'ready', activeRoadmapId: 'roadmap', lastErrorCode: null, retryAfter: null } }, getRoadmap: async () => roadmap, ensureLesson: async () => ({ status: 'ready', lesson: { id: 'lesson' } } as never), listReadyMaterialIds: () => [], now: () => now }; const first = new WorkspaceProvisioningService(dependencies); first.createDraft('workspace'); first.start('workspace'); expect((await first.resume('workspace')).status).toBe('failed_retryable'); now = 40_000; const restarted = new WorkspaceProvisioningService(dependencies); await restarted.resume('workspace'); expect(repository.find('workspace')?.status).toBe('ready'); expect(repository.values.size).toBe(1); expect(calls).toBe(2) })
})
