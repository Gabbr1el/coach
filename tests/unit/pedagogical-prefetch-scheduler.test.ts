import { describe, expect, it, vi } from 'vitest'
import { PedagogicalPrefetchScheduler } from '../../src/application/workspaces/pedagogical-prefetch-scheduler'

describe('PedagogicalPrefetchScheduler', () => {
  it('coalesces current complete unit and N+1 from pedagogical events only', () => {
    const jobs = new Map<string, any>(); const revision = { workspaceId: '00000000-0000-4000-8000-000000000001', revision: 2, inputHash: 'a'.repeat(64), roadmapId: null, firstTopicId: null, firstLessonId: null, state: 'PROVISIONING', cancellationGeneration: 1, createdAt: 1, updatedAt: 1, usableAt: null, fullyProvisionedAt: null }
    const repository = { getRevision: () => revision, enqueue: vi.fn((input) => { const key = `${input.kind}:${input.unitKey}`; const current = jobs.get(key); const value = { ...input, id: current?.id ?? key, priority: Math.max(current?.priority ?? 0, input.priority) }; jobs.set(key, value); return value }) }
    const scheduler = new PedagogicalPrefetchScheduler({ repository: repository as never, getRoadmap: () => ({ id: 'roadmap', workspaceId: revision.workspaceId, title: 'C', status: 'accepted', generationKind: 'ai_generated', version: 1, providerId: 'p', modelId: 'm', modules: [{ id: 'm', title: 'M', objective: 'O', estimatedMinutes: 60, position: 1, status: 'active', topics: ['one', 'two'], outcomes: ['O'], practice: 'P', completionCriteria: ['C'], resources: [] }], createdAt: 1, updatedAt: 1 }), now: () => 10 })
    scheduler.schedule({ type: 'topic_opened', workspaceId: revision.workspaceId, topicId: 'm:one' }); scheduler.schedule({ type: 'checkpoint_interacted', workspaceId: revision.workspaceId, topicId: 'm:one' })
    expect([...jobs.keys()]).toEqual(['lesson_generate:m:one', 'exercise_generate:m:one', 'lesson_generate:m:two']); expect(jobs.get('lesson_generate:m:one').priority).toBe(1000); expect(repository.enqueue).toHaveBeenCalledTimes(5)
  })

  it('does nothing until the workspace has a persisted non-legacy content revision', () => {
    const repository = { getRevision: () => null, enqueue: () => { throw new Error('must not enqueue') } }
    const scheduler = new PedagogicalPrefetchScheduler({ repository: repository as never, getRoadmap: () => null })
    expect(scheduler.schedule({ type: 'topic_opened', workspaceId: '00000000-0000-4000-8000-000000000001', topicId: 'm:t' })).toEqual([])
  })

  it('queues the complete N+1 unit from required exercise progress', () => {
    const jobs: any[] = []; const revision = { workspaceId: '00000000-0000-4000-8000-000000000001', revision: 2, inputHash: 'a'.repeat(64) }
    const repository = { getRevision: () => revision, enqueue: vi.fn((input) => { jobs.push(input); return input }) }
    const scheduler = new PedagogicalPrefetchScheduler({ repository: repository as never, getRoadmap: () => ({ id: 'roadmap', workspaceId: revision.workspaceId, modules: [{ id: 'm', topics: ['one', 'two'] }] }) as never })
    scheduler.schedule({ type: 'required_exercise_near_completion', workspaceId: revision.workspaceId, topicId: 'm:one' })
    expect(jobs.map((job) => `${job.kind}:${job.unitKey}`)).toEqual(['exercise_generate:m:one', 'lesson_generate:m:two', 'exercise_generate:m:two'])
    expect(jobs[2].dependencyKeys).toEqual([expect.any(String)])
  })
})
