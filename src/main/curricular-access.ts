import type { CoachDatabase } from './database/connection'

export function assertAcceptedTopicAccess(database: CoachDatabase, input: { workspaceId: string; roadmapId: string; moduleId: string; topicId: string }): void {
  const row = database.sqlite.prepare(`SELECT m.id AS moduleId,m.status AS moduleStatus,m.topics_json AS topicsJson FROM roadmaps r JOIN roadmap_modules m ON m.roadmap_id=r.id WHERE r.workspace_id=? AND r.id=? AND r.status='accepted' AND m.id=?`).get(input.workspaceId, input.roadmapId, input.moduleId) as { moduleId: string; moduleStatus: string; topicsJson: string } | undefined
  if (!row || !(JSON.parse(row.topicsJson) as string[]).some((topic) => `${row.moduleId}:${topic}` === input.topicId)) throw new Error('Accepted roadmap topic not found')
  if (row.moduleStatus === 'locked') throw new Error('Topic is locked')
  const progress = database.sqlite.prepare('SELECT current_module_id AS moduleId,current_topic_id AS topicId,topic_statuses_json AS statusesJson FROM study_progress WHERE workspace_id=? AND roadmap_id=?').get(input.workspaceId, input.roadmapId) as { moduleId: string; topicId: string; statusesJson: string } | undefined
  const requestedIndex = (JSON.parse(row.topicsJson) as string[]).findIndex((topic) => `${row.moduleId}:${topic}` === input.topicId)
  if (!progress) { if (requestedIndex === 0) return; throw new Error('Topic is locked') }
  if (progress.topicId === input.topicId) return
  const statuses = JSON.parse(progress.statusesJson) as Record<string, string>
  if (statuses[input.topicId] === 'COMPLETED' || statuses[input.topicId] === 'IN_PROGRESS') return
  if (requestedIndex === 0 && row.moduleStatus === 'available') return
  throw new Error('Topic is locked')
}

export function assertAcceptedTopicIdAccess(database: CoachDatabase, workspaceId: string, topicId: string): void {
  const separator = topicId.indexOf(':')
  const roadmap = database.sqlite.prepare("SELECT id FROM roadmaps WHERE workspace_id=? AND status='accepted' ORDER BY version DESC LIMIT 1").get(workspaceId) as { id: string } | undefined
  if (!roadmap || separator < 1) throw new Error('Accepted roadmap topic not found')
  assertAcceptedTopicAccess(database, { workspaceId, roadmapId: roadmap.id, moduleId: topicId.slice(0, separator), topicId })
}

export function assertExerciseAccess(database: CoachDatabase, workspaceId: string, exerciseId: string): void {
  const row = database.sqlite.prepare('SELECT s.topic_id AS topicId FROM exercise_sets s JOIN exercises e ON e.set_id=s.id WHERE s.workspace_id=? AND e.id=?').get(workspaceId, exerciseId) as { topicId: string } | undefined
  if (!row) throw new Error('Exercise not found')
  assertAcceptedTopicIdAccess(database, workspaceId, row.topicId)
}

export type PersistedLessonAccess = { workspaceId: string; roadmapId: string; moduleId: string; topicId: string; lessonId: string }

export function authorizePersistedLessonAccess(database: CoachDatabase, workspaceId: string, lessonId: string): PersistedLessonAccess {
  const lesson = database.sqlite.prepare('SELECT id AS lessonId,workspace_id AS workspaceId,roadmap_id AS roadmapId,module_id AS moduleId,topic_id AS topicId FROM study_lessons WHERE id=?').get(lessonId) as PersistedLessonAccess | undefined
  if (!lesson || lesson.workspaceId !== workspaceId) throw new Error('Study lesson not found')
  assertAcceptedTopicAccess(database, lesson)
  return lesson
}

export function assertPersistedLessonTuple(lesson: PersistedLessonAccess, claimed: { roadmapId: string; moduleId: string; topicId: string }): void {
  if (lesson.roadmapId !== claimed.roadmapId || lesson.moduleId !== claimed.moduleId || lesson.topicId !== claimed.topicId) throw new Error('Study lesson ownership mismatch')
}
