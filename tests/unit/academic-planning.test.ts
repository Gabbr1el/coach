import { describe, expect, it } from 'vitest'
import { PlanningService, type PlanningRepository } from '../../src/application/planning/planning-service'
import type { AcademicOverview } from '../../src/shared/contracts/planning-contract'

class AcademicRepository implements PlanningRepository {
  deadlines: Array<{ workspaceId: string; dueAt: number; masteryPercent: number | null }> = []
  events: AcademicOverview['events'] = []
  availability: AcademicOverview['availability'] = []
  workspaces = [{ id: 'c-id', name: 'C', objective: 'Aprender C' }]
  createDeadline(input: { workspaceId: string; dueAt: number; masteryPercent: number | null }) { this.deadlines.push(input) }
  addRoutineNote() {}
  listRoutineNotes() { return [] }
  getWorkspaceName() { return 'C' }
  listPriorityInputs() { return this.deadlines.map((item) => ({ ...item, title: 'Prova C', estimatedMinutes: 240, recentFocusSeconds: 0 })) }
  listWorkspaces() { return this.workspaces }
  registerAcademicEvent(input: { id: string; deadlineId: string; workspaceId: string; type: 'exam' | 'assignment' | 'deadline'; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number | null; now: number }) { this.events.push({ id: input.id, workspaceId: input.workspaceId, workspaceName: 'C', type: input.type, title: input.title, dueAt: input.dueAt, phase: 'upcoming' }); this.createDeadline(input) }
  updateLatestAcademicEvent(workspaceId: string, type: 'exam' | 'assignment' | 'deadline', dueAt: number) { const event = [...this.events].reverse().find((item) => item.workspaceId === workspaceId && item.type === type); if (!event) return false; this.events = this.events.map((item) => item.id === event.id ? { ...item, dueAt } : item); this.deadlines = this.deadlines.map((item) => item.workspaceId === workspaceId ? { ...item, dueAt } : item); return true }
  setAvailability(weekday: number, minutes: number) { this.availability = [...this.availability.filter((item) => item.weekday !== weekday), { weekday, minutes }] }
  getAcademicOverview() { return { events: this.events, availability: this.availability, workspaces: [], routine: [] } }
}

describe('academic planning from Home conversation', () => {
  const now = new Date(2026, 8, 7, 10).getTime(); const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  it('persists an exam tomorrow linked to the known workspace with unknown mastery', () => { const repository = new AcademicRepository(); const result = new PlanningService(repository, () => now).applyAcademicMessage('Tenho prova de C amanhã', { currentTime: now, timezone }); expect(result).toMatchObject({ changed: true, workspaceIds: ['c-id'] }); expect(repository.events[0]).toMatchObject({ type: 'exam', workspaceId: 'c-id' }); expect(repository.deadlines[0]?.masteryPercent).toBeNull() })
  it('does not mutate availability before an explicit PlannerAction confirmation', () => { const repository = new AcademicRepository(); const result = new PlanningService(repository, () => now).applyAcademicMessage('Na terça só vou ter 2 horas para estudar', { currentTime: now, timezone }); expect(result.changed).toBe(false); expect(repository.availability).toEqual([]) })
  it('changes the existing exam from 17/09 to 16/09 without duplicating it', () => { const repository = new AcademicRepository(); const service = new PlanningService(repository, () => now); service.applyAcademicMessage('Tenho prova de C dia 17', { currentTime: now, timezone }); const result = service.applyAcademicMessage('na verdade é dia 16', { currentTime: now, timezone }); expect(result.changed).toBe(true); expect(repository.events).toHaveLength(1); expect(new Date(repository.events[0]!.dueAt).getDate()).toBe(16) })
  it('does not mutate small talk or emotion alone', () => { const repository = new AcademicRepository(); const service = new PlanningService(repository, () => now); expect(service.applyAcademicMessage('como você está?', { currentTime: now, timezone }).changed).toBe(false); expect(service.applyAcademicMessage('Estou nervoso com a prova.', { currentTime: now, timezone }).changed).toBe(false); expect(repository.events).toHaveLength(0) })
})
