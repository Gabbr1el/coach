import { describe, expect, it } from 'vitest'
import { PlannerActionService, type PlannerActionRepository } from '../../src/application/planning/planner-action-service'
import type { PlannerAction } from '../../src/shared/contracts/planner-action-contract'

class MemoryActions implements PlannerActionRepository {
  actions: PlannerAction[] = []
  listPending() { return this.actions.filter((item) => item.status === 'proposed') }
  find(id: string) { return this.actions.find((item) => item.id === id) ?? null }
  create(action: PlannerAction) { this.actions.push(action); return action }
  claim(id: string, now: number) { const action = this.find(id); if (!action || action.status !== 'proposed') throw new Error('not pending'); return this.replace(action, { ...action, status: 'applying', resolvedAt: now }) }
  complete(id: string, status: 'applied' | 'rejected', result: unknown, now: number) { const action = this.find(id); if (!action || action.status !== 'applying') throw new Error('not applying'); return this.replace(action, { ...action, status, result, resolvedAt: now }) }
  release(id: string) { const action = this.find(id); if (action?.status === 'applying') this.replace(action, { ...action, status: 'proposed', resolvedAt: null }) }
  invalidateSiblings(originMessageId: string, exceptId: string, now: number) { this.actions = this.actions.map((action) => action.originMessageId === originMessageId && action.id !== exceptId && action.status === 'proposed' ? { ...action, status: 'obsolete', resolvedAt: now } : action) }
  invalidatePending(contextVersion: number, now: number) { this.actions = this.actions.map((action) => action.status === 'proposed' && action.contextVersion < contextVersion ? { ...action, status: 'obsolete', resolvedAt: now } : action) }
  private replace(previous: PlannerAction, next: PlannerAction) { this.actions[this.actions.indexOf(previous)] = next; return next }
}

function service(repository: MemoryActions, createWorkspace = async (input: { name: string }) => ({ id: crypto.randomUUID(), name: input.name })) {
  return new PlannerActionService({ repository, createWorkspace, createProject: async () => {}, createDeadline: () => {}, addRoutine: () => {}, now: () => 10 })
}

describe('PlannerActionService', () => {
  it('persists structured action metadata and applies its known payload', async () => { const repository = new MemoryActions(); const planner = service(repository); const action = planner.propose({ type: 'workspace.create', payload: { name: 'C', objective: 'Estudar C', language: 'c' }, label: 'Criar Workspace de C', originMessageId: crypto.randomUUID(), contextVersion: 1 }); expect(action).toMatchObject({ label: 'Criar Workspace de C', status: 'proposed' }); expect((await planner.resolve(action.id, 'apply')).status).toBe('applied') })
  it('claims before execution so a second click cannot execute twice', async () => { const repository = new MemoryActions(); let creates = 0; const planner = service(repository, async (input) => { creates += 1; return { id: crypto.randomUUID(), name: input.name } }); const action = planner.propose({ type: 'workspace.create', payload: { name: 'C', objective: 'Estudar C' }, label: 'Criar C', originMessageId: crypto.randomUUID(), contextVersion: 1 }); const results = await Promise.allSettled([planner.resolve(action.id, 'apply'), planner.resolve(action.id, 'apply')]); expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1); expect(creates).toBe(1) })
  it('invalidates stale pending actions', () => { const repository = new MemoryActions(); const planner = service(repository); const action = planner.propose({ type: 'workspace.create', payload: { name: 'C', objective: 'Estudar C' }, label: 'Criar C', originMessageId: crypto.randomUUID(), contextVersion: 1 }); planner.invalidateBefore(2); expect(repository.find(action.id)?.status).toBe('obsolete') })
  it('invalidates alternative actions from the same message after one applies', async () => { const repository = new MemoryActions(); const planner = service(repository); const messageId = crypto.randomUUID(); const first = planner.propose({ type: 'routine.add', payload: { content: 'Usar C' }, label: 'Usar C', originMessageId: messageId, contextVersion: 1 }); const second = planner.propose({ type: 'routine.add', payload: { content: 'Usar ED' }, label: 'Usar ED', originMessageId: messageId, contextVersion: 1 }); await planner.resolve(first.id, 'apply'); expect(repository.find(second.id)?.status).toBe('obsolete') })
})
