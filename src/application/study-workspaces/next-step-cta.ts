import type { StudyPlanItem } from '../../shared/contracts/study-workspace-contract'

export type NextStepRoute = 'studies' | 'exercises' | 'review' | 'practice' | 'materials'

export interface NextStepCta {
  readonly label: string
  readonly description: string
  readonly route: NextStepRoute
  readonly moduleId: string | null
  readonly topicId: string | null
  readonly exerciseSetId: string | null
  readonly materialId: string | null
}

export function deriveNextStepCta(item: StudyPlanItem | undefined): NextStepCta | null {
  if (!item) return null
  const topic = item.title.split(' / ')[0]?.trim() || item.title
  const identity = { moduleId: item.moduleId ?? null, topicId: item.topicId ?? null, exerciseSetId: item.exerciseSetId ?? null, materialId: item.materialId ?? null }
  switch (item.activityType) {
    case 'study': case 'lesson': case 'introduction': return { ...identity, label: 'Abrir Estudos', description: `Continue a aula de ${topic}.`, route: 'studies' }
    case 'exercise': case 'assessment': return { ...identity, label: 'Abrir Exercícios', description: `Resolva o conjunto preparado para ${topic}.`, route: 'exercises' }
    case 'review': return { ...identity, label: 'Abrir Revisão', description: `Revise as evidências de aprendizagem de ${topic}.`, route: 'review' }
    case 'practice': case 'coding': return { ...identity, label: 'Abrir Prática', description: `Pratique ${topic} no projeto do Workspace.`, route: 'practice' }
    case 'material': return { ...identity, label: 'Abrir Material', description: `Consulte o material específico de ${topic}.`, route: 'materials' }
    default: return null
  }
}
