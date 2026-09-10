import type { WeeklyPlanItem, WeeklyPlanItemStatus } from '../../shared/contracts/planning-contract'

export interface WeeklyPlanningTopic { workspaceId: string; workspaceName: string; moduleId: string; modulePosition: number; topicId: string; topic: string; progress: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'; evidenceCount: number; masteryEstimate: number | null; confidence: 'low' | 'medium' | 'high'; needsReview: boolean; difficultyLevel: 'low' | 'medium' | 'high'; dueAt: number | null; deadlineTitle: string | null }
export interface ExistingWeeklyItem extends Omit<WeeklyPlanItem, 'workspaceName'> { sourceKey: string; workspaceName?: string }
export interface WeeklyPlanDraftItem { id: string; sourceKey: string; workspaceId: string; workspaceName: string; dateKey: string; title: string; durationMinutes: number; position: number; status: WeeklyPlanItemStatus; moduleId: string | null; topicId: string | null; activityType: 'introduction' | 'review' | 'exercise'; scheduledStartMinutes: number; reason: string }

const DAY = 86_400_000
export function zonedDateKey(value: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function shiftDateKey(dateKey: string, days: number): string { const [year, month, day] = dateKey.split('-').map(Number); return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10) }
export function weekdayForDateKey(dateKey: string): number { return new Date(`${dateKey}T12:00:00Z`).getUTCDay() }
export function weekStartKey(value: number, timezone: string): string { const today = zonedDateKey(value, timezone); const weekday = weekdayForDateKey(today); return shiftDateKey(today, -(weekday === 0 ? 6 : weekday - 1)) }

function activityTypes(topic: WeeklyPlanningTopic): Array<'introduction' | 'review' | 'exercise'> {
  if (topic.progress === 'IN_PROGRESS' || topic.needsReview || topic.difficultyLevel === 'high') return ['review', 'exercise']
  if (topic.evidenceCount > 0 || topic.masteryEstimate !== null) return ['exercise']
  return ['introduction', 'exercise']
}
function preferredDuration(topic: WeeklyPlanningTopic, type: 'introduction' | 'review' | 'exercise'): number {
  const base = type === 'introduction' ? 30 : type === 'review' ? 25 : 35
  if (topic.confidence === 'high' && (topic.masteryEstimate ?? 0) >= 80) return Math.max(15, Math.round(base * 0.6))
  if (topic.difficultyLevel === 'high' || topic.needsReview) return Math.round(base * 1.4)
  return base
}
function priority(topic: WeeklyPlanningTopic, now: number): number {
  const days = topic.dueAt === null ? 30 : Math.max(0.25, (topic.dueAt - now) / DAY)
  const deadline = topic.dueAt === null ? 0 : 240 / days
  const evidenceNeed = topic.evidenceCount === 0 ? 35 : Math.max(0, 80 - (topic.masteryEstimate ?? 50))
  const weakness = topic.needsReview ? 55 : topic.difficultyLevel === 'high' ? 45 : topic.difficultyLevel === 'medium' ? 20 : 0
  return deadline + evidenceNeed + weakness - topic.modulePosition
}
function reason(topic: WeeklyPlanningTopic): string {
  if (topic.dueAt !== null) return `${topic.deadlineTitle ?? 'Prazo'} priorizado por data e evidência disponível.`
  if (topic.needsReview || topic.difficultyLevel === 'high') return 'Reforço priorizado por evidência de dificuldade.'
  if (topic.evidenceCount === 0) return 'Próximo passo da Trilha ainda sem evidência observada.'
  return 'Continuidade da Trilha conforme progresso observado.'
}

export function distributeWeeklyPlan(input: { weekStart: string; today: string; timezone: string; now: number; availability: Map<number, number>; topics: WeeklyPlanningTopic[]; existing: ExistingWeeklyItem[]; createId(): string }): WeeklyPlanDraftItem[] {
  const preserved = input.existing.filter((item) => item.dateKey < input.today || item.status !== 'pending')
  const preservedKeys = new Set(preserved.map((item) => item.sourceKey))
  const reusable = new Map(input.existing.filter((item) => item.status === 'pending' && item.dateKey >= input.today).map((item) => [item.sourceKey, item]))
  const generated: WeeklyPlanDraftItem[] = []
  const candidates = input.topics.filter((topic) => topic.progress !== 'COMPLETED').sort((a, b) => priority(b, input.now) - priority(a, input.now) || a.workspaceId.localeCompare(b.workspaceId) || a.modulePosition - b.modulePosition || a.topicId.localeCompare(b.topicId))
  const dayUsage = new Map<string, number>()
  for (const item of preserved) dayUsage.set(item.dateKey, (dayUsage.get(item.dateKey) ?? 0) + item.durationMinutes)
  for (const topic of candidates) for (const activityType of activityTypes(topic)) {
    const sourceKey = `${topic.workspaceId}:${topic.topicId}:${activityType}`
    if (preservedKeys.has(sourceKey) || generated.some((item) => item.sourceKey === sourceKey)) continue
    const preferred = preferredDuration(topic, activityType)
    let selected: { dateKey: string; duration: number } | null = null
    for (let offset = 0; offset < 7; offset++) {
      const dateKey = shiftDateKey(input.weekStart, offset)
      if (dateKey < input.today) continue
      if (topic.dueAt !== null && dateKey > zonedDateKey(topic.dueAt, input.timezone)) continue
      const available = input.availability.get(weekdayForDateKey(dateKey)) ?? 120
      const free = available - (dayUsage.get(dateKey) ?? 0)
      if (free >= 15) { selected = { dateKey, duration: Math.min(preferred, free) }; break }
    }
    if (!selected) continue
    const old = reusable.get(sourceKey)
    const title = `${topic.topic} / ${activityType === 'introduction' ? 'introdução' : activityType === 'review' ? 'revisão' : 'exercícios'}`
    generated.push({ id: old?.id ?? input.createId(), sourceKey, workspaceId: topic.workspaceId, workspaceName: topic.workspaceName, dateKey: selected.dateKey, title, durationMinutes: selected.duration, position: 0, status: 'pending', moduleId: topic.moduleId, topicId: topic.topicId, activityType, scheduledStartMinutes: 0, reason: reason(topic) })
    dayUsage.set(selected.dateKey, (dayUsage.get(selected.dateKey) ?? 0) + selected.duration)
  }
  const names = new Map(input.topics.map((topic) => [topic.workspaceId, topic.workspaceName]))
  const combined: WeeklyPlanDraftItem[] = [...preserved.map((item) => ({ ...item, workspaceName: item.workspaceName ?? names.get(item.workspaceId) ?? 'Workspace' })), ...generated]
  for (let offset = 0; offset < 7; offset++) {
    const dateKey = shiftDateKey(input.weekStart, offset); let start = 18 * 60; let position = 1
    for (const item of combined.filter((entry) => entry.dateKey === dateKey).sort((a, b) => { const historyOrder = Number(a.status !== 'pending') - Number(b.status !== 'pending'); const rank = { introduction: 0, review: 1, exercise: 2 }; return -historyOrder || (a.status !== 'pending' && b.status !== 'pending' ? a.position - b.position : 0) || a.workspaceId.localeCompare(b.workspaceId) || a.topicId!.localeCompare(b.topicId!) || rank[a.activityType] - rank[b.activityType] })) { item.position = position++; item.scheduledStartMinutes = start; start += item.durationMinutes }
  }
  return combined.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.position - b.position)
}

export function projectStatus(status: WeeklyPlanItemStatus): 'pending' | 'active' | 'completed' { return status === 'in_progress' ? 'active' : status }
