import { describe, expect, it } from 'vitest'
import { PlanningService, type PlanningRepository } from '../../src/application/planning/planning-service'
import type { AcademicOverview } from '../../src/shared/contracts/planning-contract'

class AcademicRepository implements PlanningRepository {
  deadlines: Array<{ workspaceId: string; dueAt: number }> = []; events: AcademicOverview['events'] = []; availability: AcademicOverview['availability'] = []
  createDeadline(input: { workspaceId: string; dueAt: number }) { this.deadlines.push(input) }
  addRoutineNote() {}; listRoutineNotes() { return [] }; getWorkspaceName() { return 'C' }; listPriorityInputs() { return this.deadlines.map((item) => ({ ...item, title: 'Prova C', estimatedMinutes: 240, masteryPercent: 50, recentFocusSeconds: 0 })) }
  listWorkspaces() { return [{ id: 'c-id', name: 'C', objective: 'Aprender C' }] }
  upsertAcademicEvent(input: { id: string; workspaceId: string; type: 'exam' | 'assignment' | 'deadline'; title: string; dueAt: number }) { this.events.push({ ...input, workspaceName: 'C' }) }
  updateLatestAcademicEvent(workspaceId: string, type: 'exam' | 'assignment' | 'deadline', dueAt: number) { const event = [...this.events].reverse().find((item) => item.workspaceId === workspaceId && item.type === type); if (!event) return false; this.events = this.events.map((item) => item.id === event.id ? { ...item, dueAt } : item); return true }
  setAvailability(weekday: number, minutes: number) { this.availability = [...this.availability.filter((item) => item.weekday !== weekday), { weekday, minutes }] }
  getAcademicOverview() { return { events: this.events, availability: this.availability, workspaces: [], routine: [] } }
}

describe('academic planning from Home conversation', () => {
  const now = new Date('2026-09-07T10:00:00').getTime()
  it('persists an exam tomorrow linked to the known workspace', () => { const repository = new AcademicRepository(); const result = new PlanningService(repository, () => now).applyAcademicMessage('Tenho prova de C amanhã'); expect(result).toMatchObject({ changed: true, workspaceIds: ['c-id'] }); expect(repository.events[0]).toMatchObject({ type: 'exam', workspaceId: 'c-id' }); expect(repository.deadlines).toHaveLength(1) })
  it('updates availability used by replanning', () => { const repository = new AcademicRepository(); new PlanningService(repository, () => now).applyAcademicMessage('Na terça só vou ter 2 horas para estudar'); expect(repository.availability).toContainEqual({ weekday: 2, minutes: 120 }) })
  it('postpones the existing exam instead of duplicating it', () => { const repository = new AcademicRepository(); const service = new PlanningService(repository, () => now); service.applyAcademicMessage('Tenho prova de C amanhã'); const before = repository.events[0]!.dueAt; const result = service.applyAcademicMessage('Minha prova de C foi adiada para sexta'); expect(result.changed).toBe(true); expect(repository.events).toHaveLength(1); expect(repository.events[0]!.dueAt).toBeGreaterThan(before) })
  it('restores academic data from the repository overview', () => { const repository = new AcademicRepository(); const service = new PlanningService(repository, () => now); service.applyAcademicMessage('Tenho prova de C amanhã'); service.applyAcademicMessage('Na terça só vou ter 2 horas para estudar'); const restarted = new PlanningService(repository, () => now); expect(restarted.getAcademicOverview()).toMatchObject({ events: [{ workspaceName: 'C' }], availability: [{ weekday: 2, minutes: 120 }] }) })
})
