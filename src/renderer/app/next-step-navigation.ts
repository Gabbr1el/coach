import type { Roadmap } from '../../shared/contracts/roadmap-contract'
import type { NextStepCta } from '../../application/study-workspaces/next-step-cta'

export interface NextStepNavigationHandlers {
  openStudies(target: { moduleId: string | null; topicId: string | null }): void
  openExercises(target: { moduleId: string | null; topicId: string | null; exerciseSetId: string | null }): void
  openMaterial(materialId: string): void
  openPage(route: 'review' | 'practice' | 'videos'): void
}

export function navigateNextStep(nextStep: NextStepCta, handlers: NextStepNavigationHandlers): void {
  if (nextStep.route === 'studies') handlers.openStudies({ moduleId: nextStep.moduleId, topicId: nextStep.topicId })
  else if (nextStep.route === 'exercises') handlers.openExercises({ moduleId: nextStep.moduleId, topicId: nextStep.topicId, exerciseSetId: nextStep.exerciseSetId })
  else if (nextStep.route === 'materials' && nextStep.materialId) handlers.openMaterial(nextStep.materialId)
  else if (nextStep.route === 'review' || nextStep.route === 'practice' || nextStep.route === 'videos') handlers.openPage(nextStep.route)
}

export function exactTopic(roadmap: Roadmap, moduleId: string | null, topicId: string | null): { module: Roadmap['modules'][number]; topicId: string } | null {
  if (!moduleId || !topicId) return null
  const module = roadmap.modules.find((candidate) => candidate.id === moduleId && candidate.status !== 'locked')
  return module?.topics.some((topic) => `${module.id}:${topic}` === topicId) ? { module, topicId } : null
}
