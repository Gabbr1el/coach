import type { ContentJob } from '../../shared/contracts/workspace-content-contract'
import type { RoadmapService } from '../../application/roadmaps/roadmap-service'
import type { StudyLessonService } from '../../application/study-lessons/study-lesson-service'
import type { ExerciseService } from '../../application/exercises/exercise-service'
import type { PlanningService } from '../../application/planning/planning-service'
import type { ContentJobHandler } from '../../application/workspaces/content-generation-worker'
import type { CoachDatabase } from '../database/connection'

function topicContext(database: CoachDatabase, job: ContentJob) {
  const roadmap = database.sqlite.prepare("SELECT id FROM roadmaps WHERE workspace_id=? AND status='accepted' AND content_revision=? ORDER BY version DESC LIMIT 1").get(job.workspaceId, job.revision) as { id: string } | undefined
  if (!roadmap) throw new Error('Current revision roadmap unavailable')
  const separator = job.unitKey.indexOf(':')
  const moduleId = separator < 1 ? '' : job.unitKey.slice(0, separator)
  if (!database.sqlite.prepare('SELECT 1 FROM roadmap_modules WHERE id=? AND roadmap_id=?').get(moduleId, roadmap.id)) throw new Error('Current revision topic unavailable')
  return { workspaceId: job.workspaceId, roadmapId: roadmap.id, moduleId, topicId: job.unitKey }
}

export function createContentJobHandlers(input: { database: CoachDatabase; roadmap: RoadmapService; lessons: StudyLessonService; exercises: ExerciseService; planning: PlanningService }): Partial<Record<ContentJob['kind'], ContentJobHandler>> {
  return {
    roadmap_generate: (job, signal) => {
      const materials = input.database.sqlite.prepare("SELECT id FROM materials WHERE workspace_id=? AND status='ready' ORDER BY CASE role WHEN 'priority' THEN 0 WHEN 'base' THEN 1 ELSE 2 END,created_at,id").all(job.workspaceId) as Array<{ id: string }>
      return input.roadmap.prepareGeneration(job.workspaceId, job.revision, job.inputHash, signal, materials.map((item) => item.id))
    },
    lesson_generate: (job, signal) => input.lessons.prepareGeneration({ ...topicContext(input.database, job), revision: job.revision, inputHash: job.inputHash }, signal),
    exercise_generate: async (job, signal) => {
      const context = topicContext(input.database, job)
      const lesson = input.database.sqlite.prepare('SELECT id FROM study_lessons WHERE workspace_id=? AND roadmap_id=? AND module_id=? AND topic_id=? AND content_revision=?').get(job.workspaceId, context.roadmapId, context.moduleId, context.topicId, job.revision) as { id: string } | undefined
      if (!lesson) throw new Error('Current revision lesson unavailable')
      return input.exercises.prepareGeneration({ ...context, lessonId: lesson.id, revision: job.revision, inputHash: job.inputHash }, signal)
    },
    plan_recalculate: async (job) => ({ publish: () => input.planning.ensureAuthoritativeNextStudyItem(job.workspaceId) }),
  }
}
