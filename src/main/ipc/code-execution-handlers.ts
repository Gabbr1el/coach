import { ipcMain } from 'electron'
import { CODE_EXECUTION_CHANNELS } from '../../shared/contracts/code-execution-channels'
import { executeCodeInputSchema, executeInteractiveCodeInputSchema, executeProjectInputSchema, interactiveCodeStateSchema, listInteractiveCodeStatesInputSchema, parseInteractiveValidation, saveInteractiveCodeStateInputSchema, type CodeExecutionResult, type InteractiveCodeBlock, type InteractiveCodeState } from '../../shared/contracts/code-execution-contract'
import { runPython } from '../code-execution/python-runner'
import { assertTrustedSender } from './trusted-sender'
import type { ObserverService } from '../../application/observer/observer-service'
import type { DrizzleProjectRepository } from '../repositories/drizzle-project-repository'
import type { CoachDatabase } from '../database/connection'
import { createHash } from 'node:crypto'
import { ToolchainManager } from '../code-execution/toolchain-manager'
import { studyLessonContentSchema } from '../../shared/contracts/study-lesson-contract'
import type { WorkspaceProject } from '../../shared/contracts/project-contract'
import { applyLearningEvidence, emptyTopicLearningState, type TopicLearningState } from '../../application/study-progress/topic-learning'
import { interactiveSourceRevision, normalizeInteractiveOutput } from '../../shared/interactive-source-revision'

const activeSenders = new Set<number>()

function sourceRevision(project: { entryFilePath: string; files: Array<{ path: string; content: string }> }): string {
  const source = project.files.map((file) => `${file.path}\0${file.content}`).sort().join('\0')
  return createHash('sha256').update(`${project.entryFilePath}\0${source}`).digest('hex').slice(0, 16)
}

export function validateInteractiveExecution(block: InteractiveCodeBlock, result: CodeExecutionResult, sourceRevision: string, prediction: string | null, now: number): NonNullable<InteractiveCodeState['validationResult']> {
  const actualOutput = normalizeInteractiveOutput(result.stdout)
  const predictionCorrect = block.interactionType === 'PREDICT_AND_RUN' && prediction !== null ? normalizeInteractiveOutput(prediction) === actualOutput : null
  if (block.evidenceMode !== 'validated') return { status: 'not_applicable', message: block.evidenceMode === 'observation' ? 'Execução registrada como observação, sem evidência avaliativa.' : 'Execução livre, sem evidência pedagógica.', sourceRevision, actualOutput, predictionCorrect, validatedAt: now }
  const passed = result.exitCode === 0 && !result.timedOut && block.expectedOutput !== null && actualOutput === normalizeInteractiveOutput(block.expectedOutput)
  return { status: passed ? 'passed' : 'failed', message: passed ? 'Saída validada contra o resultado esperado.' : 'A execução terminou, mas não corresponde ao resultado esperado.', sourceRevision, actualOutput, predictionCorrect, validatedAt: now }
}

function inlineProject(workspaceId: string, block: InteractiveCodeBlock, content: string): WorkspaceProject {
  const path = block.language === 'python' ? 'main.py' : block.language === 'java' ? 'Main.java' : 'main.c'
  return { id: crypto.randomUUID(), workspaceId, name: block.title, language: block.language, entryFilePath: path, files: [{ id: crypto.randomUUID(), path, content, revision: 0, updatedAt: Date.now() }], activeFileId: '', openFileIds: [], updatedAt: Date.now() }
}

function readLearningState(database: CoachDatabase, workspaceId: string, topicId: string, now: number): TopicLearningState { const row = database.sqlite.prepare('SELECT workspace_id AS workspaceId, topic_id AS topicId, evidence_count AS evidenceCount, assessments, correct_first_try AS correctFirstTry, correct_after_help AS correctAfterHelp, incorrect, hints_used AS hintsUsed, reinforcement_events AS reinforcementEvents, exercises_completed AS exercisesCompleted, lessons_completed AS lessonsCompleted, difficulty_level AS difficultyLevel, mastery_estimate AS masteryEstimate, confidence, needs_review AS needsReview, last_practiced_at AS lastPracticedAt, last_assessed_at AS lastAssessedAt, reasons_json AS reasonsJson, updated_at AS updatedAt FROM topic_learning_states WHERE workspace_id = ? AND topic_id = ?').get(workspaceId, topicId) as (Omit<TopicLearningState, 'reasons'> & { reasonsJson: string }) | undefined; return row ? { ...row, needsReview: Boolean(row.needsReview), reasons: JSON.parse(row.reasonsJson) as string[] } : emptyTopicLearningState(workspaceId, topicId, now) }
function writeLearningState(database: CoachDatabase, state: TopicLearningState): void { database.sqlite.prepare(`INSERT INTO topic_learning_states (workspace_id, topic_id, evidence_count, assessments, correct_first_try, correct_after_help, incorrect, hints_used, reinforcement_events, exercises_completed, lessons_completed, difficulty_level, mastery_estimate, confidence, needs_review, last_practiced_at, last_assessed_at, reasons_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, topic_id) DO UPDATE SET evidence_count=excluded.evidence_count,assessments=excluded.assessments,correct_first_try=excluded.correct_first_try,correct_after_help=excluded.correct_after_help,incorrect=excluded.incorrect,hints_used=excluded.hints_used,reinforcement_events=excluded.reinforcement_events,exercises_completed=excluded.exercises_completed,lessons_completed=excluded.lessons_completed,difficulty_level=excluded.difficulty_level,mastery_estimate=excluded.mastery_estimate,confidence=excluded.confidence,needs_review=excluded.needs_review,last_practiced_at=excluded.last_practiced_at,last_assessed_at=excluded.last_assessed_at,reasons_json=excluded.reasons_json,updated_at=excluded.updated_at`).run(state.workspaceId, state.topicId, state.evidenceCount, state.assessments, state.correctFirstTry, state.correctAfterHelp, state.incorrect, state.hintsUsed, state.reinforcementEvents, state.exercisesCompleted, state.lessonsCompleted, state.difficultyLevel, state.masteryEstimate, state.confidence, Number(state.needsReview), state.lastPracticedAt, state.lastAssessedAt, JSON.stringify(state.reasons), state.updatedAt) }

function authoritativeInteractiveBlock(database: CoachDatabase, input: { workspaceId: string; lessonId: string; blockId: string }): { active: { moduleId: string; topicId: string; lessonId: string }; block: InteractiveCodeBlock } {
  const active = database.sqlite.prepare('SELECT current_module_id AS moduleId, current_topic_id AS topicId, current_lesson_id AS lessonId FROM study_progress WHERE workspace_id = ?').get(input.workspaceId) as { moduleId: string; topicId: string; lessonId: string } | undefined
  if (!active || active.lessonId !== input.lessonId) throw new Error('Interactive block does not belong to the active lesson')
  const lessonRow = database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ? AND workspace_id = ?').get(input.lessonId, input.workspaceId) as { contentJson: string } | undefined
  const block = lessonRow ? studyLessonContentSchema.parse(JSON.parse(lessonRow.contentJson)).blocks.find((item): item is InteractiveCodeBlock => item.type === 'interactiveCode' && item.id === input.blockId) : undefined
  if (!block) throw new Error('Interactive block was not found in the authoritative lesson')
  return { active, block }
}

function workspaceInteractiveBlock(database: CoachDatabase, input: { workspaceId: string; lessonId: string; blockId: string }): InteractiveCodeBlock {
  const lessonRow = database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ? AND workspace_id = ?').get(input.lessonId, input.workspaceId) as { contentJson: string } | undefined
  const block = lessonRow ? studyLessonContentSchema.parse(JSON.parse(lessonRow.contentJson)).blocks.find((item): item is InteractiveCodeBlock => item.type === 'interactiveCode' && item.id === input.blockId) : undefined
  if (!block) throw new Error('Interactive block was not found in the workspace lesson')
  return block
}

export function registerCodeExecutionHandlers(workspaceExists: (id: string) => Promise<boolean>, observer: ObserverService, projects?: DrizzleProjectRepository, database?: CoachDatabase, toolchains = new ToolchainManager()): void {
  const toolchainStatus = (language: InteractiveCodeBlock['language']) => toolchains.getStatuses().find((status) => status.language === language) ?? { available: false, detail: 'Toolchain não encontrado' }
  ipcMain.handle(CODE_EXECUTION_CHANNELS.execute, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = executeCodeInputSchema.parse(payload)
    if (!await workspaceExists(input.workspaceId)) throw new Error('Workspace not found')
    if (activeSenders.has(event.sender.id)) throw new Error('A code execution is already running')
    activeSenders.add(event.sender.id)
    const controller = new AbortController()
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    try {
      const result = await runPython(input.content, controller.signal)
      let observerState
      try { observerState = observer.recordExecution(input.workspaceId, result) }
      catch (error) { console.error('Could not persist local execution event:', error instanceof Error ? error.message : 'unknown error') }
      return { ...result, observerState }
    }
    finally { event.sender.removeListener('destroyed', destroyed); activeSenders.delete(event.sender.id) }
  })
  ipcMain.handle(CODE_EXECUTION_CHANNELS.getToolchains, (event) => { assertTrustedSender(event); return toolchains.getStatuses() })
  ipcMain.handle(CODE_EXECUTION_CHANNELS.listInteractiveStates, (event, payload: unknown) => {
    assertTrustedSender(event)
    if (!database) throw new Error('Interactive study execution is unavailable')
    const input = listInteractiveCodeStatesInputSchema.parse(payload)
    const lessonRow = database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ? AND workspace_id = ?').get(input.lessonId, input.workspaceId) as { contentJson: string } | undefined
    const blocks = lessonRow ? studyLessonContentSchema.parse(JSON.parse(lessonRow.contentJson)).blocks : []
    const rows = database.sqlite.prepare('SELECT lesson_id AS lessonId, block_id AS blockId, current_code AS currentCode, prediction, current_source_revision AS currentSourceRevision, attempts, last_execution_json AS lastExecutionJson, validation_result_json AS validationResultJson, updated_at AS updatedAt FROM study_interactive_code_states WHERE workspace_id = ? AND lesson_id = ? ORDER BY updated_at').all(input.workspaceId, input.lessonId) as Array<{ lessonId: string; blockId: string; currentCode: string; prediction: string | null; currentSourceRevision: string; attempts: number; lastExecutionJson: string | null; validationResultJson: string | null; updatedAt: number }>
    const states = rows.map((row) => {
      const block = blocks.find((item): item is InteractiveCodeBlock => item.type === 'interactiveCode' && item.id === row.blockId)
      const status = block ? toolchainStatus(block.language) : { available: false, detail: 'Bloco não encontrado' }
      const validationResult = row.validationResultJson ? parseInteractiveValidation(JSON.parse(row.validationResultJson), row.currentSourceRevision) : null
      return interactiveCodeStateSchema.parse({ ...row, lastExecution: row.lastExecutionJson ? JSON.parse(row.lastExecutionJson) : null, validationResult, applicable: status.available, unavailableReason: status.available ? null : status.detail ?? 'Toolchain não encontrado' })
    })
    const known = new Set(states.map((state) => state.blockId))
    for (const block of blocks) if (block.type === 'interactiveCode' && !known.has(block.id)) {
      const status = toolchainStatus(block.language)
      states.push(interactiveCodeStateSchema.parse({ lessonId: input.lessonId, blockId: block.id, currentCode: block.initialCode, prediction: null, currentSourceRevision: interactiveSourceRevision(block.initialCode, null), attempts: 0, lastExecution: null, validationResult: status.available ? null : { status: 'unavailable', message: `Ambiente ${block.language} não disponível neste computador.`, sourceRevision: interactiveSourceRevision(block.initialCode, null), actualOutput: '', predictionCorrect: null, validatedAt: Date.now() }, applicable: status.available, unavailableReason: status.available ? null : status.detail ?? 'Toolchain não encontrado', updatedAt: 0 }))
    }
    return states
  })
  ipcMain.handle(CODE_EXECUTION_CHANNELS.saveInteractiveState, async (event, payload: unknown) => {
    assertTrustedSender(event)
    if (!database) throw new Error('Interactive study execution is unavailable')
    const input = saveInteractiveCodeStateInputSchema.parse(payload)
    if (!await workspaceExists(input.workspaceId)) throw new Error('Workspace not found')
    workspaceInteractiveBlock(database, input)
    const previous = database.sqlite.prepare('SELECT current_code AS currentCode, prediction, current_source_revision AS currentSourceRevision, attempts, last_execution_json AS lastExecutionJson, validation_result_json AS validationResultJson FROM study_interactive_code_states WHERE workspace_id = ? AND lesson_id = ? AND block_id = ?').get(input.workspaceId, input.lessonId, input.blockId) as { currentCode: string; prediction: string | null; currentSourceRevision: string; attempts: number; lastExecutionJson: string | null; validationResultJson: string | null } | undefined
    const now = Date.now()
    const contentUnchanged = previous?.currentCode === input.currentCode && previous.prediction === input.prediction && (!input.previousSourceRevision || input.previousSourceRevision === previous.currentSourceRevision)
    const currentSourceRevision = contentUnchanged ? previous.currentSourceRevision : interactiveSourceRevision(input.currentCode, input.prediction)
    const validationResult = previous?.validationResultJson ? parseInteractiveValidation(JSON.parse(previous.validationResultJson), currentSourceRevision) : null
    const status = toolchainStatus(workspaceInteractiveBlock(database, input).language)
    const state = interactiveCodeStateSchema.parse({ lessonId: input.lessonId, blockId: input.blockId, currentCode: input.currentCode, prediction: input.prediction, currentSourceRevision, attempts: previous?.attempts ?? 0, lastExecution: previous?.lastExecutionJson ? JSON.parse(previous.lastExecutionJson) : null, validationResult, applicable: status.available, unavailableReason: status.available ? null : status.detail ?? 'Toolchain não encontrado', updatedAt: now })
    database.sqlite.prepare(`INSERT INTO study_interactive_code_states (workspace_id, lesson_id, block_id, current_code, prediction, current_source_revision, attempts, last_execution_json, validation_result_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, lesson_id, block_id) DO UPDATE SET current_code=excluded.current_code,prediction=excluded.prediction,current_source_revision=excluded.current_source_revision,updated_at=excluded.updated_at`).run(input.workspaceId, input.lessonId, input.blockId, input.currentCode, input.prediction, currentSourceRevision, state.attempts, previous?.lastExecutionJson ?? null, previous?.validationResultJson ?? null, now)
    return state
  })
  ipcMain.handle(CODE_EXECUTION_CHANNELS.executeInteractive, async (event, payload: unknown) => {
    assertTrustedSender(event)
    if (!database) throw new Error('Interactive study execution is unavailable')
    const input = executeInteractiveCodeInputSchema.parse(payload)
    if (!await workspaceExists(input.workspaceId)) throw new Error('Workspace not found')
    const { active, block } = authoritativeInteractiveBlock(database, input)
    const available = toolchainStatus(block.language)
    if (!available.available) throw new Error(`Ambiente ${block.language} não disponível neste computador`)
    if (block.interactionType === 'PREDICT_AND_RUN' && !input.prediction?.trim()) throw new Error('A prediction is required before running this block')
    if (activeSenders.has(event.sender.id)) throw new Error('A code execution is already running')
    activeSenders.add(event.sender.id)
    const controller = new AbortController()
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    try {
      const result = await toolchains.execute(inlineProject(input.workspaceId, block, input.currentCode), controller.signal)
      let observerState
      try { observerState = observer.recordExecution(input.workspaceId, { ...result, sourceRevision: createHash('sha256').update(input.currentCode).digest('hex').slice(0, 16) }) } catch (error) { console.error('Could not persist inline execution observation:', error) }
      const execution = { ...result, observerState }
      const now = Date.now()
      const currentSourceRevision = interactiveSourceRevision(input.currentCode, input.prediction)
      const validationResult = validateInteractiveExecution(block, execution, currentSourceRevision, input.prediction, now)
      const previous = database.sqlite.prepare('SELECT attempts, evidence_granted_at AS evidenceGrantedAt FROM study_interactive_code_states WHERE workspace_id = ? AND lesson_id = ? AND block_id = ?').get(input.workspaceId, input.lessonId, input.blockId) as { attempts: number; evidenceGrantedAt: number | null } | undefined
      const state = interactiveCodeStateSchema.parse({ lessonId: input.lessonId, blockId: input.blockId, currentCode: input.currentCode, prediction: input.prediction, currentSourceRevision, attempts: (previous?.attempts ?? 0) + 1, lastExecution: execution, validationResult, applicable: true, unavailableReason: null, updatedAt: now })
      database.sqlite.transaction(() => {
        database.sqlite.prepare(`INSERT INTO study_interactive_code_states (workspace_id, lesson_id, block_id, current_code, prediction, current_source_revision, attempts, last_execution_json, validation_result_json, evidence_granted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, lesson_id, block_id) DO UPDATE SET current_code=excluded.current_code,prediction=excluded.prediction,current_source_revision=excluded.current_source_revision,attempts=excluded.attempts,last_execution_json=excluded.last_execution_json,validation_result_json=excluded.validation_result_json,evidence_granted_at=COALESCE(study_interactive_code_states.evidence_granted_at,excluded.evidence_granted_at),updated_at=excluded.updated_at`).run(input.workspaceId, input.lessonId, input.blockId, input.currentCode, input.prediction, currentSourceRevision, state.attempts, JSON.stringify(execution), JSON.stringify(validationResult), validationResult.status === 'passed' ? now : null, now)
        if (validationResult.status === 'passed' && previous?.evidenceGrantedAt == null) writeLearningState(database, applyLearningEvidence(readLearningState(database, input.workspaceId, active.topicId, now), { type: 'INTERACTIVE_CODE_VALIDATED', occurredAt: now }))
      })()
      return state
    } finally { event.sender.removeListener('destroyed', destroyed); activeSenders.delete(event.sender.id) }
  })
  ipcMain.handle(CODE_EXECUTION_CHANNELS.executeProject, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = executeProjectInputSchema.parse(payload)
    if (!await workspaceExists(input.workspaceId)) throw new Error('Workspace not found')
    const project = projects?.findById(input.projectId)
    if (!project || project.workspaceId !== input.workspaceId) throw new Error('Project not found')
    if (activeSenders.has(event.sender.id)) throw new Error('A code execution is already running')
    activeSenders.add(event.sender.id)
    const controller = new AbortController()
    const destroyed = () => controller.abort()
    event.sender.once('destroyed', destroyed)
    try {
      const result = await toolchains.execute(project, controller.signal)
      let observerState
      try { observerState = observer.recordExecution(input.workspaceId, { ...result, sourceRevision: sourceRevision(project) }) } catch (error) { console.error('Could not persist local execution event:', error) }
      if (database) database.sqlite.prepare('INSERT INTO project_builds (id, project_id, command, exit_code, timed_out, duration_ms, stdout, stderr, diagnostics_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), project.id, result.command, result.exitCode, Number(result.timedOut), result.durationMs, result.stdout, result.stderr, JSON.stringify(result.diagnostics ?? []), Date.now())
      return { ...result, observerState }
    } finally { event.sender.removeListener('destroyed', destroyed); activeSenders.delete(event.sender.id) }
  })
}
