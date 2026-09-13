import { describe, expect, it } from 'vitest'
import { PlanningService, type PlanningRepository } from '../../src/application/planning/planning-service'

class Repository implements PlanningRepository {
  inputs: ReturnType<PlanningRepository['listPriorityInputs']> = []
  createDeadline() {}
  addRoutineNote() {}
  listRoutineNotes() { return [] }
  getWorkspaceName(workspaceId: string) { return workspaceId }
  listPriorityInputs() { return this.inputs }
}

describe('PlanningService', () => {
  it('can prioritize lower mastery over a slightly earlier deadline', () => {
    const repository = new Repository()
    const now = 1_000
    repository.inputs = [
      { workspaceId: 'java', title: 'Prova Java', dueAt: now + 5 * 86_400_000, estimatedMinutes: 120, masteryPercent: 90, recentFocusSeconds: 0 },
      { workspaceId: 'c', title: 'Prova C', dueAt: now + 8 * 86_400_000, estimatedMinutes: 300, masteryPercent: 35, recentFocusSeconds: 0 },
    ]
    expect(new PlanningService(repository, () => now).listPriorities()[0]?.workspaceId).toBe('c')
  })
  it('does not fabricate a HOME schedule from priority labels', () => { const repository = new Repository(); repository.inputs = [{ workspaceId: 'c', title: 'Prova C', dueAt: 86_401_000, estimatedMinutes: 240, masteryPercent: 30, recentFocusSeconds: 0 }]; expect(new PlanningService(repository, () => 1_000).getSchedule()).toEqual([]) })
  it('does not turn unknown mastery into an invented 50 percent value', () => { const repository = new Repository(); const now = 1_000; repository.inputs = [{ workspaceId: 'unknown', title: 'Prova A', dueAt: now + 8 * 86_400_000, estimatedMinutes: 240, masteryPercent: null, recentFocusSeconds: 0 }, { workspaceId: 'known', title: 'Prova B', dueAt: now + 8 * 86_400_000, estimatedMinutes: 240, masteryPercent: 50, recentFocusSeconds: 0 }]; const priorities = new PlanningService(repository, () => now).listPriorities(); expect(priorities.find((item) => item.workspaceId === 'unknown')?.reason).toContain('domínio ainda não avaliado'); expect(priorities.find((item) => item.workspaceId === 'unknown')?.score).toBeLessThan(priorities.find((item) => item.workspaceId === 'known')?.score ?? 0) })
  it('reads a missing weekly plan snapshot without replanning or saving', () => { let saves = 0; let topicReads = 0; const repository = new Repository() as Repository & PlanningRepository; repository.findWeeklyPlan = () => null; repository.saveWeeklyPlan = () => { saves += 1 }; repository.listWeeklyPlanningTopics = () => { topicReads += 1; return [] }; expect(new PlanningService(repository, () => Date.parse('2026-09-07T12:00:00Z')).peekWeeklyPlan('UTC')).toBeNull(); expect(saves).toBe(0); expect(topicReads).toBe(0) })
})

it('changes event phase with time and removes passed events from priorities', () => { const dueAt = new Date('2026-09-10T14:00:00').getTime(); const repository = { createDeadline() {}, addRoutineNote() {}, listRoutineNotes: () => [], getWorkspaceName: () => 'C', listPriorityInputs: () => [{ workspaceId: 'c', title: 'Prova de C', dueAt, estimatedMinutes: 240, masteryPercent: 40, recentFocusSeconds: 0 }] }; expect(new PlanningService(repository, () => new Date('2026-09-09T14:00:00').getTime()).listPriorities()[0]?.eventPhase).toBe('near'); expect(new PlanningService(repository, () => new Date('2026-09-10T10:00:00').getTime()).listPriorities()[0]?.eventPhase).toBe('today'); expect(new PlanningService(repository, () => new Date('2026-09-11T10:00:00').getTime()).listPriorities()).toEqual([]) })
