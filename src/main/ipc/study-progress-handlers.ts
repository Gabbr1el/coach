import { ipcMain } from 'electron'
import type { CoachDatabase } from '../database/connection'
import { STUDY_PROGRESS_CHANNELS } from '../../shared/contracts/study-progress-channels'
import { recordStudyEventSchema, studyCheckpointStateSchema, studyLessonPositionSchema, studySelectionSchema, updateStudyPositionSchema, type StudyCheckpointState, type StudyLessonPosition, type StudyProgressState } from '../../shared/contracts/study-progress-contract'
import { studyLessonContentSchema } from '../../shared/contracts/study-lesson-contract'
import { workspaceConversationInputSchema } from '../../shared/contracts/conversation-contract'
import { assertTrustedSender } from './trusted-sender'
import { applyLearningEvidence, emptyTopicLearningState, shouldReplan, type TopicLearningState } from '../../application/study-progress/topic-learning'

type ProgressRow = { workspaceId: string; roadmapId: string; currentModuleId: string; currentTopicId: string; currentLessonId: string; currentCheckpointId: string | null; topicStatusesJson: string; lessonPositionsJson: string; checkpointStatesJson?: string; updatedAt: number }
type LessonBlockRow = { contentJson: string }
type LessonCheckpoint = Extract<ReturnType<typeof studyLessonContentSchema.parse>['blocks'][number], { type: 'checkpoint' }>

function lessonCheckpoints(database: CoachDatabase, state: StudyProgressState, lessonId: string): LessonCheckpoint[] {
  const row = database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ? AND workspace_id = ? AND roadmap_id = ? AND module_id = ? AND topic_id = ?').get(lessonId, state.workspaceId, state.roadmapId, state.moduleId, state.topicId) as LessonBlockRow | undefined
  if (!row) throw new Error('Study lesson not found for evidence')
  return studyLessonContentSchema.parse(JSON.parse(row.contentJson)).blocks.filter((block): block is LessonCheckpoint => block.type === 'checkpoint')
}

export function assertTopicCompletionAllowed(database: CoachDatabase, state: StudyProgressState, lessonId: string): void {
  const checkpoints = lessonCheckpoints(database, state, lessonId)
  if (checkpoints.length < 2 || !checkpoints.every((checkpoint) => state.checkpointStates?.[checkpoint.id]?.correct === true)) throw new Error('Topic completion requires all lesson checkpoints to be correct')
}

export function mapStudyProgressState(row: ProgressRow): StudyProgressState {
  const positions = JSON.parse(row.lessonPositionsJson) as Record<string, StudyLessonPosition>
  const rawCheckpointStates = row.checkpointStatesJson ? JSON.parse(row.checkpointStatesJson) as Record<string, unknown> : {}
  const checkpointStates = Object.fromEntries(Object.entries(rawCheckpointStates).map(([id, state]) => [id, studyCheckpointStateSchema.parse(state)]))
  for (const position of Object.values(positions)) studyLessonPositionSchema.parse(position)
  return { ...row, moduleId: row.currentModuleId, topicId: row.currentTopicId, lessonId: row.currentLessonId, checkpointId: row.currentCheckpointId, topicStatuses: JSON.parse(row.topicStatusesJson) as StudyProgressState['topicStatuses'], lessonPositions: positions, checkpointStates, currentPosition: positions[row.currentLessonId] ?? null }
}

export function registerStudyProgressHandlers(database: CoachDatabase): void {
  const get = (workspaceId: string) => {
    const row = database.sqlite.prepare('SELECT workspace_id AS workspaceId, roadmap_id AS roadmapId, current_module_id AS currentModuleId, current_topic_id AS currentTopicId, current_lesson_id AS currentLessonId, current_checkpoint_id AS currentCheckpointId, topic_statuses_json AS topicStatusesJson, lesson_positions_json AS lessonPositionsJson, checkpoint_states_json AS checkpointStatesJson, updated_at AS updatedAt FROM study_progress WHERE workspace_id = ?').get(workspaceId) as ProgressRow | undefined
    return row ? mapStudyProgressState(row) : null
  }
  ipcMain.handle(STUDY_PROGRESS_CHANNELS.get, (event, payload) => { assertTrustedSender(event); return get(workspaceConversationInputSchema.parse(payload).workspaceId) })
  ipcMain.handle(STUDY_PROGRESS_CHANNELS.select, (event, payload) => {
    assertTrustedSender(event)
    const input = studySelectionSchema.parse(payload)
    const existing = get(input.workspaceId)
    const sameRoadmap = existing?.roadmapId === input.roadmapId
    const statuses = sameRoadmap ? { ...existing.topicStatuses } : {}
    const positions = sameRoadmap ? { ...existing.lessonPositions } : {}
    const topicChanged = !sameRoadmap || existing?.topicId !== input.topicId
    const started = topicChanged && (!statuses[input.topicId] || statuses[input.topicId] === 'NOT_STARTED')
    if (started) statuses[input.topicId] = 'IN_PROGRESS'
    const checkpointId = positions[input.lessonId]?.currentCheckpointId ?? input.checkpointId
    const now = Date.now()
    database.sqlite.transaction(() => {
      database.sqlite.prepare(`INSERT INTO study_progress (workspace_id, roadmap_id, current_module_id, current_topic_id, current_lesson_id, current_checkpoint_id, topic_statuses_json, lesson_positions_json, checkpoint_states_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET roadmap_id=excluded.roadmap_id, current_module_id=excluded.current_module_id, current_topic_id=excluded.current_topic_id, current_lesson_id=excluded.current_lesson_id, current_checkpoint_id=excluded.current_checkpoint_id, topic_statuses_json=excluded.topic_statuses_json, lesson_positions_json=excluded.lesson_positions_json, checkpoint_states_json=excluded.checkpoint_states_json, updated_at=excluded.updated_at`).run(input.workspaceId, input.roadmapId, input.moduleId, input.topicId, input.lessonId, checkpointId, JSON.stringify(statuses), JSON.stringify(positions), JSON.stringify(sameRoadmap ? existing?.checkpointStates ?? {} : {}), now)
      if (started) database.sqlite.prepare('INSERT INTO study_progress_events (id, workspace_id, type, module_id, topic_id, lesson_id, checkpoint_id, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)').run(crypto.randomUUID(), input.workspaceId, 'TOPIC_STARTED', input.moduleId, input.topicId, input.lessonId, checkpointId, now)
    })()
    return get(input.workspaceId)
  })
  ipcMain.handle(STUDY_PROGRESS_CHANNELS.updatePosition, (event, payload) => {
    assertTrustedSender(event)
    const input = updateStudyPositionSchema.parse(payload)
    const existing = get(input.workspaceId)
    if (!existing || existing.lessonId !== input.position.lessonId) throw new Error('Study lesson is not the active lesson')
    const positions = { ...existing.lessonPositions, [input.position.lessonId]: input.position }
    const now = Date.now()
    database.sqlite.prepare('UPDATE study_progress SET current_checkpoint_id = ?, lesson_positions_json = ?, checkpoint_states_json = ?, updated_at = ? WHERE workspace_id = ?').run(input.position.currentCheckpointId, JSON.stringify(positions), JSON.stringify(input.checkpointStates ?? existing.checkpointStates ?? {}), now, input.workspaceId)
    return get(input.workspaceId)
  })
  ipcMain.handle(STUDY_PROGRESS_CHANNELS.record, (event, payload) => {
    assertTrustedSender(event)
    const input = recordStudyEventSchema.parse(payload)
    const active = get(input.workspaceId)
    if (!active || active.moduleId !== input.moduleId || active.topicId !== input.topicId || active.lessonId !== input.lessonId) throw new Error('Study evidence does not match the active topic')
    if (input.type === 'TOPIC_COMPLETED') assertTopicCompletionAllowed(database, active, input.lessonId)
    let checkpointStates = active.checkpointStates ?? {}
    if (input.type === 'CHECKPOINT_ANSWERED') {
      const checkpoint = lessonCheckpoints(database, active, input.lessonId).find((item) => item.id === input.checkpointId)
      if (!checkpoint || input.selectedAnswer === undefined || input.attempt === undefined || input.correct !== (input.selectedAnswer === checkpoint.correctIndex)) throw new Error('Checkpoint evidence does not match the authoritative lesson')
      const previous = checkpointStates[checkpoint.id]
      if (input.attempt !== (previous?.attempt ?? 0) + 1) throw new Error('Checkpoint attempt is not sequential')
      checkpointStates = { ...checkpointStates, [checkpoint.id]: { selectedAnswer: input.selectedAnswer, attempt: input.attempt, correct: input.correct, feedback: previous?.feedback ?? null, reinforcementBlocks: previous?.reinforcementBlocks ?? [] } }
    }
    const id = crypto.randomUUID()
    const now = Date.now()
    let replan = false
    database.sqlite.transaction(() => {
      if (input.type === 'CHECKPOINT_ANSWERED') database.sqlite.prepare('UPDATE study_progress SET current_checkpoint_id = ?, checkpoint_states_json = ?, updated_at = ? WHERE workspace_id = ?').run(input.checkpointId, JSON.stringify(checkpointStates), now, input.workspaceId)
      database.sqlite.prepare('INSERT INTO study_progress_events (id, workspace_id, type, module_id, topic_id, lesson_id, checkpoint_id, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.workspaceId, input.type, input.moduleId, input.topicId, input.lessonId, input.checkpointId, input.correct === undefined ? null : Number(input.correct), now)
      if (input.type === 'TOPIC_COMPLETED') { const state = get(input.workspaceId); if (state) database.sqlite.prepare('UPDATE study_progress SET topic_statuses_json = ?, updated_at = ? WHERE workspace_id = ?').run(JSON.stringify({ ...state.topicStatuses, [input.topicId]: 'COMPLETED' }), now, input.workspaceId) }
      const row = database.sqlite.prepare('SELECT workspace_id AS workspaceId, topic_id AS topicId, evidence_count AS evidenceCount, assessments, correct_first_try AS correctFirstTry, correct_after_help AS correctAfterHelp, incorrect, hints_used AS hintsUsed, reinforcement_events AS reinforcementEvents, exercises_completed AS exercisesCompleted, lessons_completed AS lessonsCompleted, difficulty_level AS difficultyLevel, mastery_estimate AS masteryEstimate, confidence, needs_review AS needsReview, last_practiced_at AS lastPracticedAt, last_assessed_at AS lastAssessedAt, reasons_json AS reasonsJson, updated_at AS updatedAt FROM topic_learning_states WHERE workspace_id = ? AND topic_id = ?').get(input.workspaceId, input.topicId) as (Omit<TopicLearningState, 'reasons'> & { reasonsJson: string }) | undefined
      const previous = row ? { ...row, reasons: JSON.parse(row.reasonsJson) as string[] } : emptyTopicLearningState(input.workspaceId, input.topicId, now)
      const completionAlreadyRecorded = input.type === 'TOPIC_COMPLETED' && Boolean(database.sqlite.prepare("SELECT 1 FROM study_progress_events WHERE workspace_id = ? AND topic_id = ? AND type = 'TOPIC_COMPLETED' AND id != ? LIMIT 1").get(input.workspaceId, input.topicId, id))
      const next = input.type === 'TOPIC_STARTED' || completionAlreadyRecorded ? previous : applyLearningEvidence(previous, { type: input.type, correct: input.correct, attempt: input.attempt, hintUsed: input.hintUsed, reinforcementUsed: input.reinforcementUsed, exerciseCompleted: input.exerciseCompleted, occurredAt: now })
      replan = shouldReplan(previous, next)
      if (next !== previous) database.sqlite.prepare(`INSERT INTO topic_learning_states (workspace_id, topic_id, evidence_count, assessments, correct_first_try, correct_after_help, incorrect, hints_used, reinforcement_events, exercises_completed, lessons_completed, difficulty_level, mastery_estimate, confidence, needs_review, last_practiced_at, last_assessed_at, reasons_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, topic_id) DO UPDATE SET evidence_count=excluded.evidence_count, assessments=excluded.assessments, correct_first_try=excluded.correct_first_try, correct_after_help=excluded.correct_after_help, incorrect=excluded.incorrect, hints_used=excluded.hints_used, reinforcement_events=excluded.reinforcement_events, exercises_completed=excluded.exercises_completed, lessons_completed=excluded.lessons_completed, difficulty_level=excluded.difficulty_level, mastery_estimate=excluded.mastery_estimate, confidence=excluded.confidence, needs_review=excluded.needs_review, last_practiced_at=excluded.last_practiced_at, last_assessed_at=excluded.last_assessed_at, reasons_json=excluded.reasons_json, updated_at=excluded.updated_at`).run(next.workspaceId, next.topicId, next.evidenceCount, next.assessments, next.correctFirstTry, next.correctAfterHelp, next.incorrect, next.hintsUsed, next.reinforcementEvents, next.exercisesCompleted, next.lessonsCompleted, next.difficultyLevel, next.masteryEstimate, next.confidence, Number(next.needsReview), next.lastPracticedAt, next.lastAssessedAt, JSON.stringify(next.reasons), next.updatedAt)
      if (next.difficultyLevel === 'high' && !input.topicId.includes('Reforço adaptativo:')) { const moduleId = input.moduleId; const moduleRow = database.sqlite.prepare('SELECT roadmap_id AS roadmapId, topics_json AS topicsJson FROM roadmap_modules WHERE id = ?').get(moduleId) as { roadmapId: string; topicsJson: string } | undefined; if (moduleRow) { const topics = JSON.parse(moduleRow.topicsJson) as string[]; const original = input.topicId.slice(moduleId.length + 1); const reinforcement = `Reforço adaptativo: ${original}`; if (!topics.includes(reinforcement)) database.sqlite.prepare('UPDATE roadmap_modules SET topics_json = ? WHERE id = ?').run(JSON.stringify([...topics, reinforcement]), moduleId); database.sqlite.prepare("INSERT INTO roadmap_adaptations (id, roadmap_id, module_id, topic_id, kind, source, reason_json, created_at) VALUES (?, ?, ?, ?, 'reinforcement', 'adaptive_reinforcement', ?, ?) ON CONFLICT(module_id, topic_id, kind) DO UPDATE SET reason_json=excluded.reason_json, created_at=excluded.created_at").run(crypto.randomUUID(), moduleRow.roadmapId, moduleId, input.topicId, JSON.stringify(next.reasons), now) } }
    })()
    return { id, type: input.type, topicId: input.topicId, checkpointId: input.checkpointId, correct: input.correct ?? null, shouldReplan: replan, createdAt: now }
  })
}
