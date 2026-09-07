import type { Roadmap } from '../../shared/contracts/roadmap-contract'
import type { StudyPlanItem } from '../../shared/contracts/study-workspace-contract'
import type { StudyProgressState } from '../../shared/contracts/study-progress-contract'
import type { TopicLearningState } from '../study-progress/topic-learning'

export interface DailyPlanContext { workspaceId: string; roadmap: Roadmap; progress: StudyProgressState | null; availableMinutes: number; phase: 'upcoming' | 'near' | 'today' | 'passed' | null; learningStates: Map<string, TopicLearningState>; startMinutes: number }

export function deriveDailyPlan(context: DailyPlanContext, existing: StudyPlanItem[], createId: () => string): StudyPlanItem[] {
  const completed = existing.filter((item) => item.status === 'completed')
  const completedByKey = new Map(completed.filter((item) => item.topicId && item.activityType).map((item) => [`${item.topicId}:${item.activityType}`, item]))
  const candidates = context.roadmap.modules.flatMap((module) => module.topics.map((topic) => ({ module, topic, topicId: `${module.id}:${topic}`, status: context.progress?.topicStatuses[`${module.id}:${topic}`] ?? 'NOT_STARTED' }))).filter((item) => item.status !== 'COMPLETED')
  const learningFor = (topicId: string) => { const marker = ':Reforço adaptativo: '; if (!topicId.includes(marker)) return context.learningStates.get(topicId); const [moduleId, original] = topicId.split(marker); return context.learningStates.get(`${moduleId}:${original}`) }
  const weight = (topicId: string) => { const state = learningFor(topicId); const reinforcement = topicId.includes(':Reforço adaptativo: ') ? 1 : 0; return (state?.difficultyLevel === 'high' ? 3 : state?.difficultyLevel === 'medium' ? 2 : state?.needsReview ? 1 : 0) + reinforcement }
  const sorted = candidates.sort((a, b) => weight(b.topicId) - weight(a.topicId) || a.module.position - b.module.position)
  const plan: StudyPlanItem[] = completed.map((item, index) => ({ ...item, position: index + 1 }))
  let remaining = Math.max(0, context.availableMinutes - completed.reduce((sum, item) => sum + item.durationMinutes, 0))
  let futureCount = 0
  let start = context.startMinutes
  for (const item of sorted) {
    const learning = learningFor(item.topicId); const weak = learning?.difficultyLevel === 'high' || learning?.needsReview === true; const strong = learning?.confidence !== 'low' && (learning?.masteryEstimate ?? 0) >= 80
    const types: Array<NonNullable<StudyPlanItem['activityType']>> = context.phase === 'today' ? weak ? ['review', 'exercise'] : ['review'] : context.phase === 'near' ? weak || item.status === 'IN_PROGRESS' ? ['review', 'exercise'] : ['exercise'] : item.status === 'IN_PROGRESS' || weak ? ['review', 'exercise'] : ['introduction', 'exercise']
    for (const type of types) {
      if (remaining < 15 || futureCount >= 5) break
      const base = type === 'exercise' ? (context.phase === 'today' ? 20 : context.phase === 'near' ? 35 : 40) : type === 'review' ? (context.phase === 'today' ? 20 : 25) : 30
      const preferred = strong ? Math.max(15, Math.round(base * 0.6)) : learning?.difficultyLevel === 'high' ? Math.round(base * 1.4) : base
      const durationMinutes = Math.min(preferred, remaining)
      const preserved = completedByKey.get(`${item.topicId}:${type}`)
      if (preserved) continue
      plan.push({ id: createId(), title: `${item.topic} / ${type === 'introduction' ? 'introdução' : type === 'review' ? 'revisão' : 'exercícios'}`, durationMinutes, position: plan.length + 1, status: plan.some((entry) => entry.status === 'active') ? 'pending' : 'active', moduleId: item.module.id, topicId: item.topicId, activityType: type, scheduledStartMinutes: start })
      futureCount++
      start += durationMinutes; remaining -= durationMinutes
    }
    if (remaining < 15 || futureCount >= 5) break
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
