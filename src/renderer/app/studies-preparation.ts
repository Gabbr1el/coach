import type { LearningPathState } from '../../shared/contracts/roadmap-contract'
import type { StudyLessonLoadResult } from '../../shared/contracts/study-lesson-contract'

export function studiesPreparationMessage(lessonLoad: StudyLessonLoadResult | null, pathState: LearningPathState | null): string {
  if (lessonLoad?.status === 'waiting_for_provider') return 'Aguardando a IA para preparar esta aula.'
  if (lessonLoad?.status === 'failed_retryable') return 'A aula não pôde ser preparada agora. O Coach tentará novamente.'
  if (pathState?.status === 'waiting_for_provider') return 'A Trilha será preparada quando a IA estiver disponível.'
  if (pathState?.status === 'failed_retryable') return 'Não foi possível concluir a Trilha agora. O Coach tentará novamente automaticamente.'
  if (pathState?.status === 'ready') return 'Preparando a página de conhecimento…'
  return 'Preparando sua Trilha de Aprendizado…'
}
