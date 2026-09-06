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
  getSchedule(): StudyScheduleItem[] { return this.listPriorities().slice(0, 3).map((priority) => ({ workspaceId: priority.workspaceId, workspaceName: this.repository.getWorkspaceName(priority.workspaceId), title: priority.nextDeadline ?? 'Revisão', suggestedMinutes: priority.level === 'urgent' ? 50 : priority.level === 'attention' ? 35 : 25, reason: priority.reason })) }
  listPriorities(): WorkspacePriority[] {
    const now = this.now()
    const priorities = new Map<string, WorkspacePriority>()
    for (const input of this.repository.listPriorityInputs()) {
      const rawDays = (input.dueAt - now) / 86_400_000
      const days = Math.max(0.25, rawDays)
      const urgency = Math.min(100, 100 / days)
      const difficulty = 100 - input.masteryPercent
      const workload = Math.min(100, input.estimatedMinutes / 6)
      const recentCredit = Math.min(20, input.recentFocusSeconds / 180)
      const score = Math.max(0, Math.round(urgency * 0.45 + difficulty * 0.35 + workload * 0.2 - recentCredit))
      const current = priorities.get(input.workspaceId)
      const deadlineText = rawDays < 0 ? `atrasado há ${Math.max(1, Math.ceil(Math.abs(rawDays)))} dia(s)` : `${Math.ceil(days)} dia(s)`
      if (!current || score > current.score) priorities.set(input.workspaceId, { workspaceId: input.workspaceId, score, level: score >= 65 ? 'urgent' : score >= 35 ? 'attention' : 'on_track', reason: `${input.title}: ${deadlineText}, domínio ${input.masteryPercent}%`, nextDeadline: input.title })
    }
    return [...priorities.values()].sort((a, b) => b.score - a.score)
  }
}
