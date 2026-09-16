import type { ExerciseSetProjection } from '../../shared/contracts/exercise-contract'
import type { Roadmap, RoadmapModule } from '../../shared/contracts/roadmap-contract'
import type { StudyProgressState } from '../../shared/contracts/study-progress-contract'

export type CurriculumItemState = 'completed' | 'current' | 'in_progress' | 'available' | 'locked' | 'preparing'

export interface CurriculumTopicProjection {
  readonly module: RoadmapModule
  readonly topic: string
  readonly topicId: string
  readonly state: CurriculumItemState
  readonly exerciseSet: ExerciseSetProjection | undefined
}

export const curriculumStateLabel: Record<CurriculumItemState, string> = {
  completed: 'Concluido',
  current: 'Atual',
  in_progress: 'Em andamento',
  available: 'Disponivel',
  locked: 'Bloqueado',
  preparing: 'Em preparacao',
}

export function projectCurriculum(roadmap: Roadmap, progress: StudyProgressState | null, exerciseSets: Readonly<Record<string, ExerciseSetProjection | undefined>> = {}): CurriculumTopicProjection[] {
  return roadmap.modules.flatMap((module) => module.topics.map((topic) => {
    const topicId = `${module.id}:${topic}`
    const persisted = progress?.topicStatuses[topicId]
    const state: CurriculumItemState = persisted === 'COMPLETED' || module.status === 'completed'
      ? 'completed'
      : topicId === progress?.topicId
        ? persisted === 'IN_PROGRESS' ? 'in_progress' : 'current'
        : module.status === 'locked'
          ? 'locked'
          : exerciseSets[topicId]?.status === 'preparing'
            ? 'preparing'
            : 'available'
    return { module, topic, topicId, state, exerciseSet: exerciseSets[topicId] }
  }))
}
