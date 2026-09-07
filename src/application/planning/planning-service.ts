import type { StudyScheduleItem, WorkspacePriority } from '../../shared/contracts/planning-contract'

export interface PlanningRepository {
  createDeadline(input: { id: string; workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number; createdAt: number }): void
  addRoutineNote(input: { id: string; content: string; createdAt: number }): void
  listPriorityInputs(): Array<{ workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number; recentFocusSeconds: number }>
  listRoutineNotes(): string[]
  getWorkspaceName(workspaceId: string): string
}

export class PlanningService {
  constructor(private readonly repository: PlanningRepository, private readonly now = Date.now) {}
  createDeadline(input: { workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number }): void { this.repository.createDeadline({ ...input, id: crypto.randomUUID(), createdAt: this.now() }) }
  addRoutineNote(content: string): void { this.repository.addRoutineNote({ id: crypto.randomUUID(), content, createdAt: this.now() }) }
  listRoutineNotes(): string[] { return this.repository.listRoutineNotes() }
  getSchedule(): StudyScheduleItem[] {
    const routine = this.repository.listRoutineNotes().join(' ').toLocaleLowerCase('pt-BR')
    const unavailableToday = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(this.now()).getDay()]
    const blockedToday = unavailableToday ? routine.includes(`${unavailableToday} não consigo`) || routine.includes(`${unavailableToday} indisponível`) : false
    return this.listPriorities().slice(0, 3).map((priority) => { const base = priority.level === 'urgent' ? 50 : priority.level === 'attention' ? 35 : 25; return { workspaceId: priority.workspaceId, workspaceName: this.repository.getWorkspaceName(priority.workspaceId), title: priority.nextDeadline ?? 'Revisão', suggestedMinutes: blockedToday ? 0 : base, reason: blockedToday ? `Rotina indica indisponibilidade hoje. Próxima prioridade: ${priority.reason}` : priority.reason } })
  }
  listPriorities(): WorkspacePriority[] {
    const now = this.now()
    const priorities = new Map<string, WorkspacePriority>()
    for (const input of this.repository.listPriorityInputs()) {
      const rawDays = (input.dueAt - now) / 86_400_000
      if (rawDays < 0) continue
      const days = Math.max(0.25, rawDays)
      const urgency = Math.min(100, 100 / days)
      const difficulty = 100 - input.masteryPercent
      const workload = Math.min(100, input.estimatedMinutes / 6)
      const recentCredit = Math.min(20, input.recentFocusSeconds / 180)
      const score = Math.max(0, Math.round(urgency * 0.45 + difficulty * 0.35 + workload * 0.2 - recentCredit))
      const current = priorities.get(input.workspaceId)
      const phase = rawDays <= 1 ? (new Date(input.dueAt).toDateString() === new Date(now).toDateString() ? 'today' : 'near') : rawDays <= 3 ? 'near' : 'upcoming'
      const deadlineText = phase === 'today' ? 'hoje' : Math.ceil(days) === 1 ? 'amanhã' : `em ${Math.ceil(days)} dias`
      if (!current || score > current.score) priorities.set(input.workspaceId, { workspaceId: input.workspaceId, score, level: score >= 65 ? 'urgent' : score >= 35 ? 'attention' : 'on_track', reason: `${input.title}: ${deadlineText}, domínio ${input.masteryPercent}%`, nextDeadline: input.title, eventPhase: phase, dueAt: input.dueAt })
    }
    return [...priorities.values()].sort((a, b) => b.score - a.score)
  }
}
