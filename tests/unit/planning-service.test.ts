import { describe, expect, it } from 'vitest'
import { PlanningService, type PlanningRepository } from '../../src/application/planning/planning-service'

class Repository implements PlanningRepository {
  inputs: ReturnType<PlanningRepository['listPriorityInputs']> = []
  createDeadline() {}
  addRoutineNote() {}
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
})
