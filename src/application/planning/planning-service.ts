import type { AcademicOverview, AcademicMutationResult, StudyScheduleItem, WorkspacePriority } from '../../shared/contracts/planning-contract'
import { academicEventPhase } from './academic-time'

export interface PlanningRepository {
  createDeadline(input: { id: string; workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number; createdAt: number }): void
  addRoutineNote(input: { id: string; content: string; createdAt: number }): void
  listPriorityInputs(): Array<{ workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number; recentFocusSeconds: number }>
  listRoutineNotes(): string[]
  getWorkspaceName(workspaceId: string): string
  listWorkspaces?(): Array<{ id: string; name: string; objective: string }>
  upsertAcademicEvent?(input: { id: string; workspaceId: string; type: 'exam' | 'assignment' | 'deadline'; title: string; dueAt: number; now: number }): void
  updateLatestAcademicEvent?(workspaceId: string, type: 'exam' | 'assignment' | 'deadline', dueAt: number, now: number): boolean
  setAvailability?(weekday: number, minutes: number, now: number): void
  getAcademicOverview?(now: number): AcademicOverview
}

export class PlanningService {
  constructor(private readonly repository: PlanningRepository, private readonly now = Date.now) {}
  createDeadline(input: { workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number }): void { this.repository.createDeadline({ ...input, id: crypto.randomUUID(), createdAt: this.now() }) }
  addRoutineNote(content: string): void { this.repository.addRoutineNote({ id: crypto.randomUUID(), content, createdAt: this.now() }) }
  listRoutineNotes(): string[] { return this.repository.listRoutineNotes() }
  applyAcademicMessage(content: string): AcademicMutationResult {
    const normalized = content.toLocaleLowerCase('pt-BR'); const now = this.now(); const workspaces = this.repository.listWorkspaces?.() ?? []; const workspace = workspaces.find((item) => normalized.includes(item.name.toLocaleLowerCase('pt-BR'))) ?? workspaces.find((item) => item.name.length <= 3 && new RegExp(`\\b${item.name.toLocaleLowerCase('pt-BR')}\\b`, 'i').test(normalized)); const type = /prova|exame/.test(normalized) ? 'exam' : /trabalho|atividade/.test(normalized) ? 'assignment' : /prazo|deadline/.test(normalized) ? 'deadline' : null; const weekdayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']; const date = new Date(now); const targetName = weekdayNames.find((name) => normalized.includes(name)); let dueAt = /amanhã|amanha/.test(normalized) ? now + 86_400_000 : null; if (targetName) { const target = weekdayNames.indexOf(targetName); const delta = (target - date.getDay() + 7) % 7 || 7; const targetDate = new Date(now); targetDate.setDate(targetDate.getDate() + delta); targetDate.setHours(23, 59, 0, 0); dueAt = targetDate.getTime() }
    const hours = /(?:só|so)?\s*(?:vou\s+ter\s+)?(\d+(?:[.,]\d+)?)\s*horas?/i.exec(content)?.[1]; const availabilityDay = targetName ? weekdayNames.indexOf(targetName) : -1
    if (hours && availabilityDay >= 0 && /ter|dispon|estudar|consigo/.test(normalized)) { const minutes = Math.round(Number(hours.replace(',', '.')) * 60); this.repository.setAvailability?.(availabilityDay, minutes, now); return { changed: true, summary: `Disponibilidade de ${targetName} atualizada para ${minutes / 60}h.`, workspaceIds: workspaces.map((item) => item.id), needsRefinement: null } }
    if (/adiad|mudou|remarcad/.test(normalized) && type && dueAt && workspace) { const changed = this.repository.updateLatestAcademicEvent?.(workspace.id, type, dueAt, now) ?? false; return { changed, summary: changed ? `${type === 'exam' ? 'Prova' : 'Evento'} de ${workspace.name} reagendada.` : 'Não encontrei um evento anterior; mantive o melhor plano disponível.', workspaceIds: [workspace.id], needsRefinement: changed ? null : 'Qual evento deve ser reagendado?' } }
    if (type && dueAt && workspace) { this.repository.upsertAcademicEvent?.({ id: crypto.randomUUID(), workspaceId: workspace.id, type, title: `${type === 'exam' ? 'Prova' : type === 'assignment' ? 'Trabalho' : 'Prazo'} ${workspace.name}`, dueAt, now }); this.repository.createDeadline({ id: crypto.randomUUID(), workspaceId: workspace.id, title: `${type === 'exam' ? 'Prova' : type === 'assignment' ? 'Trabalho' : 'Prazo'} ${workspace.name}`, dueAt, estimatedMinutes: type === 'exam' ? 240 : 180, masteryPercent: 50, createdAt: now }); return { changed: true, summary: `${type === 'exam' ? 'Prova' : type === 'assignment' ? 'Trabalho' : 'Prazo'} de ${workspace.name} registrado e priorizado.`, workspaceIds: [workspace.id], needsRefinement: 'Posso refinar quando você informar sua disponibilidade.' } }
    return { changed: false, summary: 'Mantive o planejamento atual com os dados conhecidos.', workspaceIds: [], needsRefinement: type && !workspace ? 'A qual Workspace esse evento pertence?' : type && !dueAt ? 'Qual é a data do evento?' : null }
  }
  getAcademicOverview(): AcademicOverview { return this.repository.getAcademicOverview?.(this.now()) ?? { events: [], availability: [], workspaces: [], routine: this.listRoutineNotes() } }
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
      const phase = academicEventPhase(input.dueAt, now)
      const deadlineText = phase === 'today' ? 'hoje' : Math.ceil(days) === 1 ? 'amanhã' : `em ${Math.ceil(days)} dias`
      if (!current || score > current.score) priorities.set(input.workspaceId, { workspaceId: input.workspaceId, score, level: score >= 65 ? 'urgent' : score >= 35 ? 'attention' : 'on_track', reason: `${input.title}: ${deadlineText}, domínio ${input.masteryPercent}%`, nextDeadline: input.title, eventPhase: phase, dueAt: input.dueAt })
    }
    return [...priorities.values()].sort((a, b) => b.score - a.score)
  }
}
