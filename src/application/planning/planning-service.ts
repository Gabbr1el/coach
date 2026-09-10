import type { AcademicMutationResult, AcademicOverview, StudyScheduleItem, WeeklyPlan, WeeklyPlanItem, WorkspacePriority } from '../../shared/contracts/planning-contract'
import { normalizeSubject } from '../workspaces/subject-normalizer'
import { academicEventPhase } from './academic-time'
import { distributeWeeklyPlan, shiftDateKey, weekStartKey, weekdayForDateKey, zonedDateKey, type ExistingWeeklyItem, type WeeklyPlanningTopic } from './weekly-planner'

export interface HomeTurnTimeContext {
  readonly currentTime: number
  readonly timezone: string
}

export interface PlanningRepository {
  createDeadline(input: { id: string; workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number | null; createdAt: number }): void
  addRoutineNote(input: { id: string; content: string; createdAt: number }): void
  listPriorityInputs(): Array<{ workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number | null; recentFocusSeconds: number }>
  listRoutineNotes(): string[]
  getWorkspaceName(workspaceId: string): string
  listAuthoritativeSchedule?(): StudyScheduleItem[]
  listWorkspaces?(): Array<{ id: string; name: string; objective: string }>
  registerAcademicEvent?(input: { id: string; deadlineId: string; workspaceId: string; type: 'exam' | 'assignment' | 'deadline'; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number | null; now: number }): void
  updateLatestAcademicEvent?(workspaceId: string, type: 'exam' | 'assignment' | 'deadline', dueAt: number, now: number): boolean
  setAvailability?(weekday: number, minutes: number, now: number): void
  getAcademicOverview?(now: number): AcademicOverview
  findWeeklyPlan?(weekStart: string, timezone: string): { id: string; revision: number; generatedAt: number; items: ExistingWeeklyItem[] } | null
  listWeeklyPlanningTopics?(now: number): WeeklyPlanningTopic[]
  listWeeklyAvailability?(now: number): Array<{ weekday: number; minutes: number }>
  saveWeeklyPlan?(input: { id: string; weekStart: string; timezone: string; revision: number; generatedAt: number; items: ExistingWeeklyItem[] }): void
  listLegacyDailyItems?(dateKey: string): ExistingWeeklyItem[]
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

function endOfLocalDay(year: number, month: number, day: number): number | null {
  const result = new Date(year, month, day, 23, 59, 0, 0)
  return result.getFullYear() === year && result.getMonth() === month && result.getDate() === day ? result.getTime() : null
}

export function parseExplicitDate(text: string, currentTime: number): number | null {
  const current = new Date(currentTime)
  if (/\bhoje\b/i.test(text)) return endOfLocalDay(current.getFullYear(), current.getMonth(), current.getDate())
  if (/\bamanh[ãa](?=\b|$)/i.test(text)) return endOfLocalDay(current.getFullYear(), current.getMonth(), current.getDate() + 1)

  const weekday = WEEKDAYS.findIndex((name) => text.toLocaleLowerCase('pt-BR').includes(name))
  if (weekday >= 0) {
    const delta = (weekday - current.getDay() + 7) % 7 || 7
    return endOfLocalDay(current.getFullYear(), current.getMonth(), current.getDate() + delta)
  }

  const full = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(text)
  if (full) return endOfLocalDay(Number(full[3]), Number(full[2]) - 1, Number(full[1]))
  const short = /\b(\d{1,2})[/.](\d{1,2})\b/.exec(text)
  if (short) {
    const day = Number(short[1]); const month = Number(short[2]) - 1
    let year = current.getFullYear()
    const candidate = endOfLocalDay(year, month, day)
    if (candidate !== null && candidate < currentTime) year += 1
    return endOfLocalDay(year, month, day)
  }

  const dayExpression = /\bdia\s+(\d{1,2})(?:\s+(?:deste|desse)\s+m[eê]s|\s+do\s+pr[oó]ximo\s+m[eê]s)?\b/i.exec(text)
  if (!dayExpression) return null
  const day = Number(dayExpression[1]); let month = current.getMonth(); let year = current.getFullYear()
  const fixedCurrentMonth = /(?:deste|desse)\s+m[eê]s/i.test(dayExpression[0])
  if (/pr[oó]ximo\s+m[eê]s/i.test(dayExpression[0]) || (!fixedCurrentMonth && day < current.getDate())) {
    month += 1
    if (month > 11) { month = 0; year += 1 }
  }
  return endOfLocalDay(year, month, day)
}

function eventType(content: string, correction: boolean): 'exam' | 'assignment' | 'deadline' | null {
  if (/prova|exame/.test(content) || (correction && /\bdia\s+\d/.test(content))) return 'exam'
  if (/trabalho|atividade/.test(content)) return 'assignment'
  if (/prazo|deadline/.test(content)) return 'deadline'
  return null
}

function statedSubject(content: string): string | null {
  const match = /(?:prova|exame|trabalho|atividade|prazo)\s+(?:de|da|do)\s+(.+?)(?=\s+(?:no\s+dia|dia|em\s+\d|amanh[ãa]|hoje|na\s+(?:segunda|terça|quarta|quinta|sexta|sábado|domingo))\b|[,.;]|\s+e\s+estou\b|$)/i.exec(content)
  return match?.[1]?.trim().replace(/^(?:um|uma)\s+/i, '') || null
}

export class PlanningService {
  constructor(private readonly repository: PlanningRepository, private readonly now = Date.now) {}
  createDeadline(input: { workspaceId: string; title: string; dueAt: number; estimatedMinutes: number; masteryPercent: number | null }): void { this.repository.createDeadline({ ...input, id: crypto.randomUUID(), createdAt: this.now() }) }
  addRoutineNote(content: string): void { this.repository.addRoutineNote({ id: crypto.randomUUID(), content, createdAt: this.now() }) }
  listRoutineNotes(): string[] { return this.repository.listRoutineNotes() }

  applyAcademicMessage(content: string, time: HomeTurnTimeContext = { currentTime: this.now(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }): AcademicMutationResult {
    const normalized = content.toLocaleLowerCase('pt-BR'); const now = time.currentTime
    const workspaces = this.repository.listWorkspaces?.() ?? []
    const correction = /na verdade|corrigindo|mudou|remarcad|adiad/.test(normalized)
    const type = eventType(normalized, correction); const dueAt = parseExplicitDate(normalized, now)
    const stated = type ? statedSubject(content) : null
    const normalizedSubject = stated ? normalizeSubject(stated).subject.toLocaleLowerCase('pt-BR') : null
    const matches = workspaces.filter((item) => { const workspaceSubject = normalizeSubject(item.name).subject.toLocaleLowerCase('pt-BR'); return normalizedSubject ? workspaceSubject === normalizedSubject : normalized.includes(item.name.toLocaleLowerCase('pt-BR')) || (item.name.length <= 3 && new RegExp(`\\b${item.name.toLocaleLowerCase('pt-BR')}\\b`, 'i').test(normalized)) })
    const workspace = matches.length === 1 ? matches[0] : matches.length === 0 && workspaces.length === 1 && correction ? workspaces[0] : undefined
    const targetName = WEEKDAYS.find((name) => normalized.includes(name)); const availabilityDay = targetName ? WEEKDAYS.indexOf(targetName) : -1
    const hours = /(?:só|so)?\s*(?:vou\s+ter\s+)?(\d+(?:[.,]\d+)?)\s*horas?/i.exec(content)?.[1]

    if (hours && availabilityDay >= 0 && /ter|dispon|estudar|consigo/.test(normalized)) {
      const minutes = Math.round(Number(hours.replace(',', '.')) * 60)
      this.repository.setAvailability?.(availabilityDay, minutes, now)
      return { changed: true, summary: `Disponibilidade de ${targetName} atualizada para ${minutes / 60}h.`, workspaceIds: workspaces.map((item) => item.id), needsRefinement: null }
    }
    if (type && matches.length > 1) return { changed: false, summary: 'Encontrei mais de um Workspace relacionado.', workspaceIds: [], needsRefinement: 'Escolha o Workspace correto.', ambiguousWorkspaces: matches, pendingEvent: dueAt ? { type, subject: stated ?? 'evento', dueAt } : undefined }
    if (correction && type && dueAt && workspace) {
      const changed = this.repository.updateLatestAcademicEvent?.(workspace.id, type, dueAt, now) ?? false
      return { changed, summary: changed ? `${type === 'exam' ? 'Prova' : 'Evento'} de ${workspace.name} reagendada para ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: time.timezone }).format(dueAt)}.` : 'Não encontrei um evento anterior; nenhuma alteração foi feita.', workspaceIds: changed ? [workspace.id] : [], needsRefinement: changed ? null : 'Qual evento deve ser reagendado?' }
    }
    if (type && dueAt && workspace) {
      const title = `${type === 'exam' ? 'Prova' : type === 'assignment' ? 'Trabalho' : 'Prazo'} ${workspace.name}`
      this.repository.registerAcademicEvent?.({ id: crypto.randomUUID(), deadlineId: crypto.randomUUID(), workspaceId: workspace.id, type, title, dueAt, estimatedMinutes: type === 'exam' ? 240 : 180, masteryPercent: null, now })
      return { changed: true, summary: `${title} registrada para ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: time.timezone }).format(dueAt)}.`, workspaceIds: [workspace.id], needsRefinement: null }
    }
    return { changed: false, summary: 'Nenhuma alteração foi feita.', workspaceIds: [], needsRefinement: type && !dueAt ? 'Qual é a data do evento?' : type && !stated ? 'Qual é a matéria desse evento?' : type && !workspace ? 'A qual Workspace esse evento pertence?' : null, pendingEvent: type && dueAt && stated ? { type, subject: stated, dueAt } : undefined }
  }

  getAcademicOverview(): AcademicOverview { return this.repository.getAcademicOverview?.(this.now()) ?? { events: [], availability: [], workspaces: [], routine: this.listRoutineNotes() } }
  getSchedule(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): StudyScheduleItem[] { if (!this.repository.findWeeklyPlan) return []; const plan = this.getWeeklyPlan(timezone); const today = zonedDateKey(this.now(), timezone); return plan.days.find((day) => day.dateKey === today)?.items.map((item) => ({ workspaceId: item.workspaceId, workspaceName: item.workspaceName, title: item.title, suggestedMinutes: item.durationMinutes, reason: item.reason })) ?? [] }
  getWeeklyPlan(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): WeeklyPlan {
    const now = this.now(); const weekStart = weekStartKey(now, timezone)
    const found = this.repository.findWeeklyPlan?.(weekStart, timezone)
    if (!found) return this.replanWeek(timezone)
    return this.presentWeeklyPlan(found.id, weekStart, timezone, found.revision, found.generatedAt, found.items, now)
  }
  replanWeek(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): WeeklyPlan {
    if (!this.repository.findWeeklyPlan || !this.repository.listWeeklyPlanningTopics || !this.repository.listWeeklyAvailability || !this.repository.saveWeeklyPlan) throw new Error('Weekly planning persistence is unavailable')
    const now = this.now(); const today = zonedDateKey(now, timezone); const weekStart = weekStartKey(now, timezone); const existing = this.repository.findWeeklyPlan(weekStart, timezone)
    const availability = new Map(this.repository.listWeeklyAvailability(now).map((item) => [item.weekday, item.minutes]))
    const topics = this.repository.listWeeklyPlanningTopics(now)
    const previous = existing?.items ?? this.repository.listLegacyDailyItems?.(today) ?? []
    const items = distributeWeeklyPlan({ weekStart, today, timezone, now, availability, topics, existing: previous, createId: () => crypto.randomUUID() })
    const id = existing?.id ?? crypto.randomUUID(); const revision = (existing?.revision ?? 0) + 1
    this.repository.saveWeeklyPlan({ id, weekStart, timezone, revision, generatedAt: now, items })
    const persisted = this.repository.findWeeklyPlan(weekStart, timezone)
    if (!persisted || persisted.revision !== revision) throw new Error('Weekly plan was not persisted')
    return this.presentWeeklyPlan(persisted.id, weekStart, timezone, revision, persisted.generatedAt, persisted.items, now)
  }
  getTodayPlan(workspaceId: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): import('../../shared/contracts/study-workspace-contract').StudyPlanItem[] { const plan = this.getWeeklyPlan(timezone); const today = zonedDateKey(this.now(), timezone); const items = plan.days.find((day) => day.dateKey === today)?.items.filter((item) => item.workspaceId === workspaceId) ?? []; const hasActive = items.some((item) => item.status === 'in_progress'); const firstPending = items.find((item) => item.status === 'pending')?.id; return items.map((item) => ({ id: item.id, title: item.title, durationMinutes: item.durationMinutes, position: item.position, status: item.status === 'in_progress' || (!hasActive && item.id === firstPending) ? 'active' : item.status, moduleId: item.moduleId ?? undefined, topicId: item.topicId ?? undefined, activityType: item.activityType, scheduledStartMinutes: item.scheduledStartMinutes })) }
  private presentWeeklyPlan(id: string, weekStart: string, timezone: string, revision: number, generatedAt: number, items: ExistingWeeklyItem[], now: number): WeeklyPlan {
    const today = zonedDateKey(now, timezone)
    const names = new Map((this.repository.listWorkspaces?.() ?? []).map((item) => [item.id, item.name]))
    const days = Array.from({ length: 7 }, (_, offset) => { const dateKey = shiftDateKey(weekStart, offset); const dayItems: WeeklyPlanItem[] = items.filter((item) => item.dateKey === dateKey).map(({ sourceKey: _, workspaceName, ...item }) => ({ ...item, workspaceName: workspaceName ?? names.get(item.workspaceId) ?? 'Workspace' })); const availableMinutes = this.repository.listWeeklyAvailability?.(now).find((item) => item.weekday === weekdayForDateKey(dateKey))?.minutes ?? 120; return { dateKey, weekday: weekdayForDateKey(dateKey), availableMinutes, scheduledMinutes: dayItems.reduce((sum, item) => sum + item.durationMinutes, 0), status: dateKey < today ? 'past' as const : dateKey === today ? 'today' as const : 'future' as const, items: dayItems } })
    return { id, weekStart, timezone, revision, generatedAt, days }
  }
  listPriorities(): WorkspacePriority[] {
    const now = this.now(); const priorities = new Map<string, WorkspacePriority>()
    for (const input of this.repository.listPriorityInputs()) {
      const rawDays = (input.dueAt - now) / 86_400_000; if (rawDays < 0) continue
      const days = Math.max(0.25, rawDays); const urgency = Math.min(100, 100 / days); const difficulty = input.masteryPercent === null ? 0 : 100 - input.masteryPercent; const workload = Math.min(100, input.estimatedMinutes / 6); const recentCredit = Math.min(20, input.recentFocusSeconds / 180); const score = Math.max(0, Math.round(urgency * 0.45 + difficulty * 0.35 + workload * 0.2 - recentCredit)); const current = priorities.get(input.workspaceId); const phase = academicEventPhase(input.dueAt, now); const deadlineText = phase === 'today' ? 'hoje' : Math.ceil(days) === 1 ? 'amanhã' : `em ${Math.ceil(days)} dias`; const masteryText = input.masteryPercent === null ? 'domínio ainda não avaliado' : `domínio ${input.masteryPercent}%`
      if (!current || score > current.score) priorities.set(input.workspaceId, { workspaceId: input.workspaceId, score, level: score >= 65 ? 'urgent' : score >= 35 ? 'attention' : 'on_track', reason: `${input.title}: ${deadlineText}, ${masteryText}`, nextDeadline: input.title, eventPhase: phase, dueAt: input.dueAt })
    }
    return [...priorities.values()].sort((a, b) => b.score - a.score)
  }
}
