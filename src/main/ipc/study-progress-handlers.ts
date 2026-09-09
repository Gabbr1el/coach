import { ipcMain } from 'electron'
import type { CoachDatabase } from '../database/connection'
import { STUDY_PROGRESS_CHANNELS } from '../../shared/contracts/study-progress-channels'
import { answerStudyCheckpointSchema, completeStudyTopicSchema, recordStudyEventSchema, studyCheckpointStateSchema, studyLessonPositionSchema, studySelectionSchema, updateStudyPositionSchema, type StudyCheckpointState, type StudyLessonPosition, type StudyProgressState } from '../../shared/contracts/study-progress-contract'
import { studyLessonContentSchema } from '../../shared/contracts/study-lesson-contract'
import { workspaceConversationInputSchema } from '../../shared/contracts/conversation-contract'
import { assertTrustedSender } from './trusted-sender'
import { applyLearningEvidence, emptyTopicLearningState, shouldReplan, type TopicLearningState } from '../../application/study-progress/topic-learning'
import { parseInteractiveValidation, type ToolchainStatus } from '../../shared/contracts/code-execution-contract'

type ProgressRow = { workspaceId: string; roadmapId: string; currentModuleId: string; currentTopicId: string; currentLessonId: string; currentCheckpointId: string | null; topicStatusesJson: string; lessonPositionsJson: string; checkpointStatesJson?: string; updatedAt: number }
type LessonBlockRow = { contentJson: string }
type LessonCheckpoint = Extract<ReturnType<typeof studyLessonContentSchema.parse>['blocks'][number], { type: 'checkpoint' }>
const answering = new Map<string, Promise<unknown>>()
const recentAnswers = new Map<string, { signature: string; at: number; result: unknown }>()
function readLearningState(database: CoachDatabase, workspaceId: string, topicId: string, now: number): TopicLearningState { const row = database.sqlite.prepare('SELECT workspace_id AS workspaceId, topic_id AS topicId, evidence_count AS evidenceCount, assessments, correct_first_try AS correctFirstTry, correct_after_help AS correctAfterHelp, incorrect, hints_used AS hintsUsed, reinforcement_events AS reinforcementEvents, exercises_completed AS exercisesCompleted, lessons_completed AS lessonsCompleted, difficulty_level AS difficultyLevel, mastery_estimate AS masteryEstimate, confidence, needs_review AS needsReview, last_practiced_at AS lastPracticedAt, last_assessed_at AS lastAssessedAt, reasons_json AS reasonsJson, updated_at AS updatedAt FROM topic_learning_states WHERE workspace_id = ? AND topic_id = ?').get(workspaceId, topicId) as (Omit<TopicLearningState, 'reasons'> & { reasonsJson: string }) | undefined; return row ? { ...row, needsReview: Boolean(row.needsReview), reasons: JSON.parse(row.reasonsJson) as string[] } : emptyTopicLearningState(workspaceId, topicId, now) }
function writeLearningState(database: CoachDatabase, state: TopicLearningState): void { database.sqlite.prepare(`INSERT INTO topic_learning_states (workspace_id, topic_id, evidence_count, assessments, correct_first_try, correct_after_help, incorrect, hints_used, reinforcement_events, exercises_completed, lessons_completed, difficulty_level, mastery_estimate, confidence, needs_review, last_practiced_at, last_assessed_at, reasons_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, topic_id) DO UPDATE SET evidence_count=excluded.evidence_count,assessments=excluded.assessments,correct_first_try=excluded.correct_first_try,correct_after_help=excluded.correct_after_help,incorrect=excluded.incorrect,hints_used=excluded.hints_used,reinforcement_events=excluded.reinforcement_events,exercises_completed=excluded.exercises_completed,lessons_completed=excluded.lessons_completed,difficulty_level=excluded.difficulty_level,mastery_estimate=excluded.mastery_estimate,confidence=excluded.confidence,needs_review=excluded.needs_review,last_practiced_at=excluded.last_practiced_at,last_assessed_at=excluded.last_assessed_at,reasons_json=excluded.reasons_json,updated_at=excluded.updated_at`).run(state.workspaceId, state.topicId, state.evidenceCount, state.assessments, state.correctFirstTry, state.correctAfterHelp, state.incorrect, state.hintsUsed, state.reinforcementEvents, state.exercisesCompleted, state.lessonsCompleted, state.difficultyLevel, state.masteryEstimate, state.confidence, Number(state.needsReview), state.lastPracticedAt, state.lastAssessedAt, JSON.stringify(state.reasons), state.updatedAt) }

function lessonCheckpoints(database: CoachDatabase, state: StudyProgressState, lessonId: string): LessonCheckpoint[] {
  const row = database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ? AND workspace_id = ? AND roadmap_id = ? AND module_id = ? AND topic_id = ?').get(lessonId, state.workspaceId, state.roadmapId, state.moduleId, state.topicId) as LessonBlockRow | undefined
  if (!row) throw new Error('Study lesson not found for evidence')
  return studyLessonContentSchema.parse(JSON.parse(row.contentJson)).blocks.filter((block): block is LessonCheckpoint => block.type === 'checkpoint')
}

export function assertTopicCompletionAllowed(database: CoachDatabase, state: StudyProgressState, lessonId: string, toolchains: ToolchainStatus[] = []): void {
  const checkpoints = lessonCheckpoints(database, state, lessonId)
  if (checkpoints.length < 2 || !checkpoints.every((checkpoint) => { const answer = state.checkpointStates?.[checkpoint.id]; return answer?.correct === true && answer.selectedOptionId === checkpoint.correctOptionId })) throw new Error('Topic completion requires all lesson checkpoints to be correct')
  const lessonRow = database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ? AND workspace_id = ?').get(lessonId, state.workspaceId) as LessonBlockRow | undefined
  if (!lessonRow) throw new Error('Study lesson not found for completion')
  const available = new Map(toolchains.map((toolchain) => [toolchain.language, toolchain.available]))
  const required = studyLessonContentSchema.parse(JSON.parse(lessonRow.contentJson)).blocks.filter((block) => block.type === 'interactiveCode' && block.requiredForTopicCompletion && available.get(block.language) === true)
  const rows = database.sqlite.prepare('SELECT block_id AS blockId, current_source_revision AS currentSourceRevision, validation_result_json AS validationResultJson FROM study_interactive_code_states WHERE workspace_id = ? AND lesson_id = ?').all(state.workspaceId, lessonId) as Array<{ blockId: string; currentSourceRevision: string; validationResultJson: string | null }>
  const states = new Map(rows.map((row) => [row.blockId, row]))
  for (const block of required) {
    const interactive = states.get(block.id)
    if (!interactive?.validationResultJson) throw new Error('Required interactive experiments must be validated before topic completion')
    const validation = parseInteractiveValidation(JSON.parse(interactive.validationResultJson), interactive.currentSourceRevision)
    if (validation?.status !== 'passed' || validation.sourceRevision !== interactive.currentSourceRevision) throw new Error('Required interactive experiments must be valid for the current source revision')
  }
}

export function nextTopicTarget(modules: Array<{ id: string; topics: string[] }>, moduleId: string, topicId: string): { moduleId: string; topicId: string; lessonId: string; completedModule: boolean } | null {
  const moduleIndex = modules.findIndex((module) => module.id === moduleId)
  if (moduleIndex < 0) throw new Error('Active module not found')
  const topicIndex = modules[moduleIndex]!.topics.findIndex((topic) => `${moduleId}:${topic}` === topicId)
  if (topicIndex < 0) throw new Error('Active topic not found')
  if (topicIndex + 1 < modules[moduleIndex]!.topics.length) { const nextTopicId = `${moduleId}:${modules[moduleIndex]!.topics[topicIndex + 1]}`; return { moduleId, topicId: nextTopicId, lessonId: `${nextTopicId}:lesson`, completedModule: false } }
  const nextModule = modules[moduleIndex + 1]
  if (!nextModule?.topics[0]) return null
  const nextTopicId = `${nextModule.id}:${nextModule.topics[0]}`
  return { moduleId: nextModule.id, topicId: nextTopicId, lessonId: `${nextTopicId}:lesson`, completedModule: true }
}

export function mapStudyProgressState(row: ProgressRow): StudyProgressState {
  const positions = JSON.parse(row.lessonPositionsJson) as Record<string, StudyLessonPosition>
  const rawCheckpointStates = row.checkpointStatesJson ? JSON.parse(row.checkpointStatesJson) as Record<string, unknown> : {}
  const checkpointStates = Object.fromEntries(Object.entries(rawCheckpointStates).map(([id, state]) => [id, studyCheckpointStateSchema.parse(state)]))
  for (const position of Object.values(positions)) studyLessonPositionSchema.parse(position)
  return { ...row, moduleId: row.currentModuleId, topicId: row.currentTopicId, lessonId: row.currentLessonId, checkpointId: row.currentCheckpointId, topicStatuses: JSON.parse(row.topicStatusesJson) as StudyProgressState['topicStatuses'], lessonPositions: positions, checkpointStates, currentPosition: positions[row.currentLessonId] ?? null }
}

export function registerStudyProgressHandlers(database: CoachDatabase, getToolchains: () => ToolchainStatus[] = () => []): void {
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
    database.sqlite.prepare('UPDATE study_progress SET current_checkpoint_id = ?, lesson_positions_json = ?, updated_at = ? WHERE workspace_id = ?').run(input.position.currentCheckpointId, JSON.stringify(positions), now, input.workspaceId)
    return get(input.workspaceId)
  })
  ipcMain.handle(STUDY_PROGRESS_CHANNELS.answerCheckpoint, async (event, payload) => {
    assertTrustedSender(event)
    const input = answerStudyCheckpointSchema.parse(payload)
    const key = `${input.workspaceId}:${input.lessonId}:${input.checkpointId}`
    const signature = `${input.selectedOptionId}\u0000${input.studentJustification}`
    const recent = recentAnswers.get(key)
    if (recent?.signature === signature && Date.now() - recent.at < 2_000) return recent.result
    const previousTask = answering.get(key) ?? Promise.resolve()
    const task = previousTask.catch(() => undefined).then(() => {
      const replay = recentAnswers.get(key)
      if (replay?.signature === signature && Date.now() - replay.at < 2_000) return replay.result
      const active = get(input.workspaceId)
      if (!active || active.lessonId !== input.lessonId) throw new Error('Checkpoint does not belong to the active lesson')
      const checkpoint = lessonCheckpoints(database, active, input.lessonId).find((item) => item.id === input.checkpointId)
      const selected = checkpoint?.options.find((option) => option.id === input.selectedOptionId)
      if (!checkpoint || !selected) throw new Error('Checkpoint option does not belong to the authoritative lesson')
      const previous = active.checkpointStates?.[input.checkpointId]
      const attempt = (previous?.attempt ?? 0) + 1
      const correct = input.selectedOptionId === checkpoint.correctOptionId
      const reinforcement = !correct && attempt > 1 ? checkpoint.reinforcement : null
      const feedback = correct ? 'Correto. Sua escolha está consistente com o conceito avaliado.' : `Ainda não. ${selected.rationale}`
      const now = Date.now()
      const state: StudyCheckpointState = { selectedOptionId: input.selectedOptionId, studentJustification: input.studentJustification, attempt, correct, currentFeedback: feedback, currentReinforcement: reinforcement, rationale: selected.rationale, history: [...(previous?.history ?? []), { selectedOptionId: input.selectedOptionId, studentJustification: input.studentJustification, attempt, correct, feedback, rationale: selected.rationale, answeredAt: now }] }
      const checkpointStates = { ...(active.checkpointStates ?? {}), [input.checkpointId]: state }
      let replan = false
      database.sqlite.transaction(() => {
        database.sqlite.prepare('UPDATE study_progress SET current_checkpoint_id = ?, checkpoint_states_json = ?, updated_at = ? WHERE workspace_id = ?').run(input.checkpointId, JSON.stringify(checkpointStates), now, input.workspaceId)
        database.sqlite.prepare('INSERT INTO study_progress_events (id, workspace_id, type, module_id, topic_id, lesson_id, checkpoint_id, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), input.workspaceId, 'CHECKPOINT_ANSWERED', active.moduleId, active.topicId, active.lessonId, input.checkpointId, correct ? 1 : 0, now)
        const before = readLearningState(database, input.workspaceId, active.topicId, now)
        const after = applyLearningEvidence(before, { type: 'CHECKPOINT_ANSWERED', correct, attempt, hintUsed: !correct, reinforcementUsed: reinforcement !== null, occurredAt: now })
        replan = shouldReplan(before, after)
        writeLearningState(database, after)
      })()
      const result = { state: get(input.workspaceId)!, evaluation: { correct, selectedOptionId: input.selectedOptionId, attempt, studentJustification: input.studentJustification, rationale: selected.rationale, misconceptionTag: selected.misconceptionTag ?? null, feedback, hint: correct ? null : checkpoint.hint, reinforcement }, shouldReplan: replan }
      recentAnswers.set(key, { signature, at: now, result })
      return result
    }).finally(() => { if (answering.get(key) === task) answering.delete(key) })
    answering.set(key, task)
    return task
  })
  ipcMain.handle(STUDY_PROGRESS_CHANNELS.completeTopic, (event, payload) => {
    assertTrustedSender(event)
    const input = completeStudyTopicSchema.parse(payload)
    const active = get(input.workspaceId)
    if (active?.topicStatuses[input.topicId] === 'COMPLETED') return { state: active, nextTarget: active.topicId === input.topicId ? null : { moduleId: active.moduleId, topicId: active.topicId, lessonId: active.lessonId }, shouldReplan: false }
    if (!active || active.topicId !== input.topicId) throw new Error('Topic is not the active study topic')
    assertTopicCompletionAllowed(database, active, active.lessonId, getToolchains())
    const now = Date.now()
    const modules = database.sqlite.prepare('SELECT id, position, status, topics_json AS topicsJson FROM roadmap_modules WHERE roadmap_id = ? ORDER BY position').all(active.roadmapId) as Array<{ id: string; position: number; status: string; topicsJson: string }>
    const moduleIndex = modules.findIndex((module) => module.id === active.moduleId)
    if (moduleIndex < 0) throw new Error('Active module not found')
    const normalizedModules = modules.map((module) => ({ id: module.id, topics: JSON.parse(module.topicsJson) as string[] }))
    const currentTopics = normalizedModules[moduleIndex]!.topics
    const currentIndex = currentTopics.findIndex((topic) => `${active.moduleId}:${topic}` === active.topicId)
    const statuses = { ...active.topicStatuses, [active.topicId]: 'COMPLETED' as const }
    let nextTarget: { moduleId: string; topicId: string; lessonId: string } | null = null
    const resolvedTarget = nextTopicTarget(normalizedModules, active.moduleId, active.topicId)
    if (resolvedTarget) nextTarget = resolvedTarget
    if (nextTarget && !statuses[nextTarget.topicId]) statuses[nextTarget.topicId] = 'IN_PROGRESS'
    database.sqlite.transaction(() => {
      const exists = database.sqlite.prepare("SELECT 1 FROM study_progress_events WHERE workspace_id = ? AND type = 'TOPIC_COMPLETED' AND topic_id = ? LIMIT 1").get(input.workspaceId, active.topicId)
      if (!exists) database.sqlite.prepare('INSERT INTO study_progress_events (id, workspace_id, type, module_id, topic_id, lesson_id, checkpoint_id, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)').run(crypto.randomUUID(), input.workspaceId, 'TOPIC_COMPLETED', active.moduleId, active.topicId, active.lessonId, now)
      if (!exists) writeLearningState(database, applyLearningEvidence(readLearningState(database, input.workspaceId, active.topicId, now), { type: 'TOPIC_COMPLETED', occurredAt: now }))
      if (nextTarget && !database.sqlite.prepare("SELECT 1 FROM study_progress_events WHERE workspace_id = ? AND type = 'TOPIC_STARTED' AND topic_id = ? LIMIT 1").get(input.workspaceId, nextTarget.topicId)) database.sqlite.prepare('INSERT INTO study_progress_events (id, workspace_id, type, module_id, topic_id, lesson_id, checkpoint_id, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)').run(crypto.randomUUID(), input.workspaceId, 'TOPIC_STARTED', nextTarget.moduleId, nextTarget.topicId, nextTarget.lessonId, now)
      if (currentIndex === currentTopics.length - 1) { database.sqlite.prepare("UPDATE roadmap_modules SET status = 'completed' WHERE id = ? AND roadmap_id = ?").run(active.moduleId, active.roadmapId); if (nextTarget) database.sqlite.prepare("UPDATE roadmap_modules SET status = 'active' WHERE id = ? AND roadmap_id = ? AND status = 'locked'").run(nextTarget.moduleId, active.roadmapId) }
      database.sqlite.prepare('UPDATE study_progress SET current_module_id = ?, current_topic_id = ?, current_lesson_id = ?, current_checkpoint_id = NULL, topic_statuses_json = ?, updated_at = ? WHERE workspace_id = ?').run(nextTarget?.moduleId ?? active.moduleId, nextTarget?.topicId ?? active.topicId, nextTarget?.lessonId ?? active.lessonId, JSON.stringify(statuses), now, input.workspaceId)
    })()
    return { state: get(input.workspaceId)!, nextTarget, shouldReplan: true }
  })
  ipcMain.handle(STUDY_PROGRESS_CHANNELS.record, (event, payload) => {
    assertTrustedSender(event)
    const input = recordStudyEventSchema.parse(payload)
    if (input.type === 'TOPIC_COMPLETED') throw new Error('Use completeTopic for topic completion')
    const active = get(input.workspaceId)
    if (!active || active.moduleId !== input.moduleId || active.topicId !== input.topicId || active.lessonId !== input.lessonId) throw new Error('Study evidence does not match the active topic')
    if (input.type === 'CHECKPOINT_ANSWERED') throw new Error('Use answerCheckpoint for checkpoint evidence')
    const id = crypto.randomUUID()
    const now = Date.now()
    let replan = false
    database.sqlite.transaction(() => {
      database.sqlite.prepare('INSERT INTO study_progress_events (id, workspace_id, type, module_id, topic_id, lesson_id, checkpoint_id, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.workspaceId, input.type, input.moduleId, input.topicId, input.lessonId, input.checkpointId, input.correct === undefined ? null : Number(input.correct), now)
      const row = database.sqlite.prepare('SELECT workspace_id AS workspaceId, topic_id AS topicId, evidence_count AS evidenceCount, assessments, correct_first_try AS correctFirstTry, correct_after_help AS correctAfterHelp, incorrect, hints_used AS hintsUsed, reinforcement_events AS reinforcementEvents, exercises_completed AS exercisesCompleted, lessons_completed AS lessonsCompleted, difficulty_level AS difficultyLevel, mastery_estimate AS masteryEstimate, confidence, needs_review AS needsReview, last_practiced_at AS lastPracticedAt, last_assessed_at AS lastAssessedAt, reasons_json AS reasonsJson, updated_at AS updatedAt FROM topic_learning_states WHERE workspace_id = ? AND topic_id = ?').get(input.workspaceId, input.topicId) as (Omit<TopicLearningState, 'reasons'> & { reasonsJson: string }) | undefined
      const previous = row ? { ...row, reasons: JSON.parse(row.reasonsJson) as string[] } : emptyTopicLearningState(input.workspaceId, input.topicId, now)
      const next = input.type === 'TOPIC_STARTED' ? previous : applyLearningEvidence(previous, { type: input.type, correct: input.correct, attempt: input.attempt, hintUsed: input.hintUsed, reinforcementUsed: input.reinforcementUsed, exerciseCompleted: input.exerciseCompleted, occurredAt: now })
      replan = shouldReplan(previous, next)
      if (next !== previous) database.sqlite.prepare(`INSERT INTO topic_learning_states (workspace_id, topic_id, evidence_count, assessments, correct_first_try, correct_after_help, incorrect, hints_used, reinforcement_events, exercises_completed, lessons_completed, difficulty_level, mastery_estimate, confidence, needs_review, last_practiced_at, last_assessed_at, reasons_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, topic_id) DO UPDATE SET evidence_count=excluded.evidence_count, assessments=excluded.assessments, correct_first_try=excluded.correct_first_try, correct_after_help=excluded.correct_after_help, incorrect=excluded.incorrect, hints_used=excluded.hints_used, reinforcement_events=excluded.reinforcement_events, exercises_completed=excluded.exercises_completed, lessons_completed=excluded.lessons_completed, difficulty_level=excluded.difficulty_level, mastery_estimate=excluded.mastery_estimate, confidence=excluded.confidence, needs_review=excluded.needs_review, last_practiced_at=excluded.last_practiced_at, last_assessed_at=excluded.last_assessed_at, reasons_json=excluded.reasons_json, updated_at=excluded.updated_at`).run(next.workspaceId, next.topicId, next.evidenceCount, next.assessments, next.correctFirstTry, next.correctAfterHelp, next.incorrect, next.hintsUsed, next.reinforcementEvents, next.exercisesCompleted, next.lessonsCompleted, next.difficultyLevel, next.masteryEstimate, next.confidence, Number(next.needsReview), next.lastPracticedAt, next.lastAssessedAt, JSON.stringify(next.reasons), next.updatedAt)
      if (next.difficultyLevel === 'high' && !input.topicId.includes('Reforço adaptativo:')) { const moduleId = input.moduleId; const moduleRow = database.sqlite.prepare('SELECT roadmap_id AS roadmapId, topics_json AS topicsJson FROM roadmap_modules WHERE id = ?').get(moduleId) as { roadmapId: string; topicsJson: string } | undefined; if (moduleRow) { const topics = JSON.parse(moduleRow.topicsJson) as string[]; const original = input.topicId.slice(moduleId.length + 1); const reinforcement = `Reforço adaptativo: ${original}`; if (!topics.includes(reinforcement)) database.sqlite.prepare('UPDATE roadmap_modules SET topics_json = ? WHERE id = ?').run(JSON.stringify([...topics, reinforcement]), moduleId); database.sqlite.prepare("INSERT INTO roadmap_adaptations (id, roadmap_id, module_id, topic_id, kind, source, reason_json, created_at) VALUES (?, ?, ?, ?, 'reinforcement', 'adaptive_reinforcement', ?, ?) ON CONFLICT(module_id, topic_id, kind) DO UPDATE SET reason_json=excluded.reason_json, created_at=excluded.created_at").run(crypto.randomUUID(), moduleRow.roadmapId, moduleId, input.topicId, JSON.stringify(next.reasons), now) } }
    })()
    return { id, type: input.type, topicId: input.topicId, checkpointId: input.checkpointId, correct: input.correct ?? null, shouldReplan: replan, createdAt: now }
  })
}
