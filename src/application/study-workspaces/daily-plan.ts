import type { Roadmap } from '../../shared/contracts/roadmap-contract'
import type { StudyPlanItem } from '../../shared/contracts/study-workspace-contract'
import type { StudyProgressState } from '../../shared/contracts/study-progress-contract'

export interface DailyPlanContext { workspaceId: string; roadmap: Roadmap; progress: StudyProgressState | null; availableMinutes: number; urgency: 'stable' | 'attention' | 'urgent'; difficultyTopicIds: Set<string>; startMinutes: number }

export function deriveDailyPlan(context: DailyPlanContext, existing: StudyPlanItem[], createId: () => string): StudyPlanItem[] {
  const completedByKey = new Map(existing.filter((item) => item.status === 'completed' && item.topicId && item.activityType).map((item) => [`${item.topicId}:${item.activityType}`, item]))
  const candidates = context.roadmap.modules.flatMap((module) => module.topics.map((topic) => ({ module, topic, topicId: `${module.id}:${topic}`, status: context.progress?.topicStatuses[`${module.id}:${topic}`] ?? 'NOT_STARTED' }))).filter((item) => item.status !== 'COMPLETED')
  const sorted = candidates.sort((a, b) => Number(context.difficultyTopicIds.has(b.topicId)) - Number(context.difficultyTopicIds.has(a.topicId)) || a.module.position - b.module.position)
  const plan: StudyPlanItem[] = []
  let remaining = Math.max(25, context.availableMinutes)
  let start = context.startMinutes
  for (const item of sorted) {
    const types: Array<NonNullable<StudyPlanItem['activityType']>> = item.status === 'IN_PROGRESS' || context.difficultyTopicIds.has(item.topicId) ? ['review', 'exercise'] : ['introduction', 'exercise']
    for (const type of types) {
      if (remaining < 15 || plan.length >= 5) break
      const preferred = type === 'exercise' ? (context.urgency === 'urgent' ? 35 : 40) : type === 'review' ? 25 : 30
      const durationMinutes = Math.min(preferred, remaining)
      const preserved = completedByKey.get(`${item.topicId}:${type}`)
      plan.push({ id: preserved?.id ?? createId(), title: `${item.topic} / ${type === 'introduction' ? 'introdução' : type === 'review' ? 'revisão' : 'exercícios'}`, durationMinutes, position: plan.length + 1, status: preserved ? 'completed' : plan.some((entry) => entry.status === 'active') ? 'pending' : 'active', moduleId: item.module.id, topicId: item.topicId, activityType: type, scheduledStartMinutes: start })
      start += durationMinutes; remaining -= durationMinutes
    }
    if (remaining < 15 || plan.length >= 5) break
  }
  return plan
}

export function planActionLabel(item: StudyPlanItem | undefined): string {
  if (!item) return 'Plano concluído'
  const topic = item.title.split(' / ')[0]
  if (item.activityType === 'review') return `Responder revisão: ${topic}`
  if (item.activityType === 'exercise' || item.activityType === 'practice') return `Praticar: ${topic}`
  if (item.activityType === 'video') return `Assistir vídeo: ${topic}`
  return `Continuar: ${topic}`
}
