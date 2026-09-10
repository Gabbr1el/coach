import { ipcMain } from 'electron'
import type { CoachDatabase } from '../database/connection'
import { createHash } from 'node:crypto'
import { STUDY_PROGRESS_CHANNELS } from '../../shared/contracts/study-progress-channels'
import { answerStudyCheckpointSchema, completeStudyTopicSchema, recordStudyEventSchema, retryCheckpointReasoningSchema, studyCheckpointStateSchema, studyLessonPositionSchema, studySelectionSchema, updateStudyPositionSchema, type CheckpointReasoningAssessment, type StudyCheckpointState, type StudyLessonPosition, type StudyProgressState } from '../../shared/contracts/study-progress-contract'
import { studyLessonContentSchema } from '../../shared/contracts/study-lesson-contract'
import { workspaceConversationInputSchema } from '../../shared/contracts/conversation-contract'
import { assertTrustedSender } from './trusted-sender'
import { applyLearningEvidence, emptyTopicLearningState, shouldReplan, type TopicLearningState } from '../../application/study-progress/topic-learning'
import { parseInteractiveValidation, type ToolchainStatus } from '../../shared/contracts/code-execution-contract'
import type { AIProviderManager } from '../../application/ai/ai-provider-manager'
import { evaluateCheckpointReasoning, pendingAssessment } from '../../application/study-progress/checkpoint-reasoning'

type ProgressRow = { workspaceId: string; roadmapId: string; currentModuleId: string; currentTopicId: string; currentLessonId: string; currentCheckpointId: string | null; topicStatusesJson: string; lessonPositionsJson: string; checkpointStatesJson?: string; updatedAt: number }
type LessonBlockRow = { contentJson: string }
type LessonCheckpoint = Extract<ReturnType<typeof studyLessonContentSchema.parse>['blocks'][number], { type: 'checkpoint' }>
const answering = new Map<string, Promise<unknown>>()
function answerSignature(selectedOptionId: string, justification: string): string { return createHash('sha256').update(`${selectedOptionId}\u0000${justification}`).digest('hex') }
function matchingHistory(state: StudyCheckpointState | undefined, signature: string) { return [...(state?.history ?? [])].reverse().find((item) => item.signature === signature) }
function responseFor(state: StudyProgressState, checkpoint: LessonCheckpoint, correct: boolean, attempt: number, input: { selectedOptionId: string; studentJustification: string }, reasoningAssessment: CheckpointReasoningAssessment, shouldReplan: boolean) {
  const selected = checkpoint.options.find((option) => option.id === input.selectedOptionId)!
  const reinforcement = !correct && attempt > 1 ? checkpoint.reinforcement : null
  const feedback = correct ? 'Alternativa correta.' : `Alternativa incorreta. ${selected.rationale}`
  return { state, evaluation: { correct, selectedOptionId: input.selectedOptionId, attempt, studentJustification: input.studentJustification, rationale: selected.rationale, misconceptionTag: selected.misconceptionTag ?? null, feedback, hint: correct ? null : checkpoint.hint, reinforcement, reasoningAssessment }, shouldReplan }
}
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
  // Missing local toolchains make their exercises non-applicable; progress is never rewritten as a fabricated pass.
  const available = new Map(toolchains.map((toolchain) => [toolchain.language, toolchain.available]))
  const required = studyLessonContentSchema.parse(JSON.parse(lessonRow.contentJson)).blocks.filter((block) => block.type === 'interactiveCode' && block.requiredForTopicCompletion && available.get(block.language) === true)
  const rows = database.sqlite.prepare('SELECT block_id AS blockId, current_source_revision AS currentSourceRevision, validation_result_json AS validationResultJson FROM study_interactive_code_states WHERE workspace_id = ? AND lesson_id = ?').all(state.workspaceId, lessonId) as Array<{ blockId: string; currentSourceRevision: string; validationResultJson: string | null }>
  const states = new Map(rows.map((row) => [row.blockId, row]))
  for (const block of required) {
    const interactive = states.get(block.id)
    if (!interactive?.validationResultJson) throw new Error('Required interactive experiments must be validated before topic completion')
    let persisted: unknown = null
    try { persisted = JSON.parse(interactive.validationResultJson) } catch { persisted = null }
    const validation = parseInteractiveValidation(persisted, interactive.currentSourceRevision)
    if (validation?.status !== 'passed' || validation.sourceRevision !== interactive.currentSourceRevision) throw new Error('Required interactive experiments must be valid for the current source revision')
  }
  // Provider/generation failures must not deadlock study, so only a ready set contributes requirements.
  const set = database.sqlite.prepare("SELECT id, status FROM exercise_sets WHERE workspace_id = ? AND topic_id = ?").get(state.workspaceId, state.topicId) as { id: string; status: string } | undefined
  if (set?.status === 'ready') {
    const requiredExercises = database.sqlite.prepare('SELECT e.id, e.language, p.status FROM exercises e LEFT JOIN exercise_progress p ON p.exercise_id=e.id AND p.workspace_id=? WHERE e.set_id=? AND e.required_for_topic_completion=1').all(state.workspaceId, set.id) as Array<{ id: string; language: ToolchainStatus['language']; status: string | null }>
    for (const exercise of requiredExercises) if (available.get(exercise.language) === true && exercise.status !== 'passed') throw new Error('Required exercises must be passed before topic completion')
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

export function registerStudyProgressHandlers(database: CoachDatabase, getToolchains: () => ToolchainStatus[] = () => [], providerManager?: AIProviderManager): void {
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
  const evaluateAndPersist = async (input: { workspaceId: string; lessonId: string; checkpointId: string; selectedOptionId: string; studentJustification: string }, retry: boolean) => {
    const active = get(input.workspaceId)
    if (!active || active.lessonId !== input.lessonId) throw new Error('Checkpoint does not belong to the active lesson')
    const lessonRow = database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ? AND workspace_id = ?').get(input.lessonId, input.workspaceId) as LessonBlockRow | undefined
    if (!lessonRow) throw new Error('Study lesson not found for evidence')
    const lesson = studyLessonContentSchema.parse(JSON.parse(lessonRow.contentJson))
    const checkpoint = lesson.blocks.find((item): item is LessonCheckpoint => item.type === 'checkpoint' && item.id === input.checkpointId)
    const selected = checkpoint?.options.find((option) => option.id === input.selectedOptionId)
    if (!checkpoint || !selected) throw new Error('Checkpoint option does not belong to the authoritative lesson')
    const previous = active.checkpointStates?.[input.checkpointId]
    const signature = answerSignature(input.selectedOptionId, input.studentJustification)
    const replay = matchingHistory(previous, signature)
    if (!retry && replay) return responseFor(get(input.workspaceId)!, checkpoint, replay.correct, replay.attempt, input, replay.reasoningAssessment ?? previous?.reasoningAssessment ?? pendingAssessment(0, Date.now()), false)
    const pendingPrevious = previous?.reasoningAssessment?.status === 'reasoning_evaluation_pending' ? previous.reasoningAssessment : null
    if (retry && !pendingPrevious) throw new Error('Checkpoint reasoning is not pending')
    if (retry && pendingPrevious && Date.now() < pendingPrevious.nextRetryAt) return responseFor(active, checkpoint, previous!.correct, previous!.attempt, input, pendingPrevious, false)
    const attempt = retry ? previous!.attempt : (previous?.attempt ?? 0) + 1
    const correct = input.selectedOptionId === checkpoint.correctOptionId
    const reinforcement = !correct && attempt > 1 ? checkpoint.reinforcement : null
    const alternativeFeedback = correct ? 'Alternativa correta.' : `Alternativa incorreta. ${selected.rationale}`
    const answerId = retry ? previous!.history.at(-1)?.answerId ?? crypto.randomUUID() : crypto.randomUUID()
    const pending = pendingAssessment(pendingPrevious?.retryCount ?? 0, Date.now())
    let assessment: CheckpointReasoningAssessment = providerManager
      ? await evaluateCheckpointReasoning(providerManager, { topic: active.topicId.split(':').at(-1) ?? active.topicId, lesson, checkpoint, selectedOptionId: input.selectedOptionId, studentJustification: input.studentJustification })
      : pending
    if (assessment.status === 'reasoning_evaluation_pending') assessment = pending
    const now = Date.now()
    let replan = false
    database.sqlite.transaction(() => {
      const fresh = get(input.workspaceId)
      const freshPrevious = fresh?.checkpointStates?.[input.checkpointId]
      const existing = matchingHistory(freshPrevious, signature)
      if (!retry && existing) return
      if (retry && freshPrevious?.reasoningAssessment?.status !== 'reasoning_evaluation_pending') return
      const historyEntry = { answerId, signature, selectedOptionId: input.selectedOptionId, studentJustification: input.studentJustification, attempt, correct, feedback: alternativeFeedback, rationale: selected.rationale, reasoningAssessment: assessment, answeredAt: retry ? (freshPrevious?.history.at(-1)?.answeredAt ?? now) : now }
      const history = retry ? [...(freshPrevious?.history.slice(0, -1) ?? []), historyEntry] : [...(freshPrevious?.history ?? []), historyEntry]
      const state: StudyCheckpointState = { selectedOptionId: input.selectedOptionId, studentJustification: input.studentJustification, attempt, correct, currentFeedback: alternativeFeedback, currentReinforcement: reinforcement, rationale: selected.rationale, reasoningAssessment: assessment, history }
      const checkpointStates = { ...(fresh?.checkpointStates ?? {}), [input.checkpointId]: state }
      database.sqlite.prepare('UPDATE study_progress SET current_checkpoint_id = ?, checkpoint_states_json = ?, updated_at = ? WHERE workspace_id = ?').run(input.checkpointId, JSON.stringify(checkpointStates), now, input.workspaceId)
      database.sqlite.prepare(`INSERT INTO checkpoint_reasoning_evidence (answer_id, workspace_id, topic_id, lesson_id, checkpoint_id, alternative_correct, reasoning_status, summary, misconception, feedback, evaluated_at, retry_count, next_retry_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(answer_id) DO UPDATE SET reasoning_status=excluded.reasoning_status,summary=excluded.summary,misconception=excluded.misconception,feedback=excluded.feedback,evaluated_at=excluded.evaluated_at,retry_count=excluded.retry_count,next_retry_at=excluded.next_retry_at,updated_at=excluded.updated_at`).run(answerId, input.workspaceId, active.topicId, input.lessonId, input.checkpointId, Number(correct), assessment.status, assessment.summary, assessment.misconception, assessment.feedback, assessment.evaluatedAt, assessment.retryCount, assessment.nextRetryAt, now, now)
      if (assessment.status !== 'reasoning_evaluation_pending') {
        const inserted = database.sqlite.prepare('INSERT OR IGNORE INTO study_progress_events (id, workspace_id, type, module_id, topic_id, lesson_id, checkpoint_id, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(answerId, input.workspaceId, 'CHECKPOINT_ANSWERED', active.moduleId, active.topicId, active.lessonId, input.checkpointId, correct ? 1 : 0, now)
        if (inserted.changes) { const before = readLearningState(database, input.workspaceId, active.topicId, now); const after = applyLearningEvidence(before, { type: 'CHECKPOINT_ANSWERED', correct, attempt, hintUsed: !correct, reinforcementUsed: reinforcement !== null, reasoningStatus: assessment.status, misconception: assessment.misconception, occurredAt: now }); replan = shouldReplan(before, after); writeLearningState(database, after) }
      }
    })()
    const persisted = get(input.workspaceId)!
    return responseFor(persisted, checkpoint, persisted.checkpointStates?.[input.checkpointId]?.correct ?? correct, persisted.checkpointStates?.[input.checkpointId]?.attempt ?? attempt, input, persisted.checkpointStates?.[input.checkpointId]?.reasoningAssessment ?? assessment, replan)
  }
  ipcMain.handle(STUDY_PROGRESS_CHANNELS.answerCheckpoint, async (event, payload) => {
    assertTrustedSender(event)
    const input = answerStudyCheckpointSchema.parse(payload)
    const key = `${input.workspaceId}:${input.lessonId}:${input.checkpointId}`
    const previousTask = answering.get(key) ?? Promise.resolve()
    const task = previousTask.catch(() => undefined).then(() => evaluateAndPersist(input, false)).finally(() => { if (answering.get(key) === task) answering.delete(key) })
    answering.set(key, task)
    return task
  })
  ipcMain.handle(STUDY_PROGRESS_CHANNELS.retryCheckpointReasoning, async (event, payload) => {
    assertTrustedSender(event)
    const input = retryCheckpointReasoningSchema.parse(payload)
    const active = get(input.workspaceId)
    const previous = active?.checkpointStates?.[input.checkpointId]
    if (!previous?.selectedOptionId || !previous.studentJustification) throw new Error('Checkpoint answer not found')
    const key = `${input.workspaceId}:${input.lessonId}:${input.checkpointId}`
    const previousTask = answering.get(key) ?? Promise.resolve()
    const task = previousTask.catch(() => undefined).then(() => evaluateAndPersist({ ...input, selectedOptionId: previous.selectedOptionId!, studentJustification: previous.studentJustification! }, true)).finally(() => { if (answering.get(key) === task) answering.delete(key) })
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
