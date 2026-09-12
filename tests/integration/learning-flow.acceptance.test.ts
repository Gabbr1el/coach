import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, payload: unknown) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => ipc.handlers.set(channel, handler) } }))
vi.mock('../../src/main/ipc/trusted-sender', () => ({ assertTrustedSender: vi.fn() }))

import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import type { AIProvider } from '../../src/application/ai/ai-provider'
import { ExerciseService } from '../../src/application/exercises/exercise-service'
import { SqliteLearningEvidenceService } from '../../src/application/learning-evidence/learning-evidence-service'
import { ReviewService } from '../../src/application/review/review-service'
import { RoadmapService } from '../../src/application/roadmaps/roadmap-service'
import { StudyLessonService } from '../../src/application/study-lessons/study-lesson-service'
import { WorkspaceService } from '../../src/application/workspaces/workspace-service'
import { openCoachDatabase } from '../../src/main/database/connection'
import { registerCodeExecutionHandlers } from '../../src/main/ipc/code-execution-handlers'
import { registerStudyProgressHandlers } from '../../src/main/ipc/study-progress-handlers'
import { DrizzleRoadmapRepository } from '../../src/main/repositories/drizzle-roadmap-repository'
import { DrizzleWorkspaceRepository } from '../../src/main/repositories/drizzle-workspace-repository'
import { SqliteExerciseRepository } from '../../src/main/repositories/sqlite-exercise-repository'
import { SqliteStudyLessonRepository } from '../../src/main/repositories/sqlite-study-lesson-repository'
import { CODE_EXECUTION_CHANNELS } from '../../src/shared/contracts/code-execution-channels'
import { EXERCISE_CHANNELS } from '../../src/shared/contracts/exercise-channels'
import { registerExerciseHandlers } from '../../src/main/ipc/exercise-handlers'
import { STUDY_PROGRESS_CHANNELS } from '../../src/shared/contracts/study-progress-channels'

const directories: string[] = []
afterEach(() => { ipc.handlers.clear(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

const concepts = ['loops', 'conditionals', 'variables', 'output', 'iteration']
const intent = (key: string, conceptKey: string, evidenceType: 'multiple_choice' | 'code_execution' | 'prediction') => ({ key, conceptKey, objective: `Avaliar ${conceptKey}`, evidenceType, difficulty: 'standard', prerequisiteConceptKeys: [] })
const roadmapResponse = { title: 'Python prático', modules: [{ title: 'Controle de fluxo', objective: 'Compreender decisões e repetição em Python', estimatedMinutes: 120, topics: ['Laços e condições'], curricularTopics: [{ topic: 'Laços e condições', concepts: concepts.map((key) => ({ key, name: key, aliases: [], domain: 'Python' })), assessmentIntents: [intent('loops-check', 'loops', 'multiple_choice'), intent('conditions-check', 'conditionals', 'multiple_choice'), intent('variables-run', 'variables', 'code_execution'), intent('output-predict', 'output', 'prediction'), intent('iteration-predict', 'iteration', 'prediction')] }], outcomes: ['Explicar laços e condições'], practice: 'Executar e prever programas curtos', completionCriteria: ['Responder verificações'], sourceIds: [] }] }

function checkpoint(id: string, assessmentIntentKey: string, question: string) {
  return { id, type: 'checkpoint', assessmentIntentKey, title: question, questionType: 'multiple_choice', question, options: Array.from({ length: 5 }, (_, index) => ({ id: `${id}-o${index}`, text: `${question} opção ${index}`, rationale: `Justificativa ${index}`, ...(index === 0 ? {} : { misconceptionTag: `erro-${index}` }) })), correctOptionId: `${id}-o0`, reasoningRequirement: 'none', hint: 'Revise o exemplo.', reinforcement: 'Compare as alternativas.' }
}
const lessonResponse = (topicId: string) => ({ title: 'Laços e condições em Python', level: 'basic', objective: 'Entender laços e condições com execução real', blocks: [
  { id: `${topicId}:intro`, type: 'explanation', title: 'Ideia central', content: 'Laços repetem ações e condições escolhem caminhos em Python.' },
  { id: `${topicId}:example`, type: 'codeExample', title: 'Exemplo Python', code: 'for i in range(2): print(i)', language: 'python', expectedOutput: '0\n1', walkthrough: ['Crie a faixa', 'Repita a impressão'] },
  { id: `${topicId}:run`, type: 'interactiveCode', assessmentIntentKey: 'variables-run', title: 'Execute uma variável', interactionType: 'EDIT_AND_RUN', language: 'python', instruction: 'Execute o código e confira a saída.', initialCode: 'print("2")', predictionPrompt: null, evidenceMode: 'validated', requiredForTopicCompletion: false, expectedOutput: '2' },
  checkpoint(`${topicId}:check-loops`, 'loops-check', 'O que um laço faz?'),
  { id: `${topicId}:comparison`, type: 'comparison', title: 'Laço e condição', content: 'O laço repete; a condição decide qual caminho executar.' },
  checkpoint(`${topicId}:check-conditions`, 'conditions-check', 'O que uma condição faz?'),
  { id: `${topicId}:error`, type: 'commonError', title: 'Erro comum', content: 'Confundir repetição com decisão altera o fluxo do programa.' },
  { id: `${topicId}:practice`, type: 'miniExercise', title: 'Pratique', instruction: 'Resolva os exercícios sobre saída e iteração.', nextAction: 'PRACTICE' },
], usedSourceIds: [] })

const codeExercise = (kind: 'PROGRAMMING_PROBLEM' | 'FIX_CODE' | 'COMPLETE_CODE', assessmentIntentKey: string, conceptKey: string, index: number) => ({ assessmentIntentKey, conceptKeys: [conceptKey], kind, difficulty: 'standard', title: `${kind} ${index}`, statement: kind === 'FIX_CODE' ? 'Corrija o erro do programa.' : 'Complete o programa para repetir a entrada.', inputDescription: 'Uma linha', outputDescription: 'A mesma linha', language: 'python', starterCode: kind === 'COMPLETE_CODE' ? '# TODO COMPLETE\nprint(input())' : kind === 'FIX_CODE' ? 'print("erro")' : 'print(input())', predictionPrompt: null, codeToObserve: null, requiredForTopicCompletion: index === 1, publicTests: [{ input: 'ok\n', expectedOutput: 'ok' }], hiddenTests: Array.from({ length: 3 }, (_, test) => ({ input: `h${test}\n`, expectedOutput: `h${test}` })), referenceSolution: 'print(input())', expectedPrediction: null, hint: 'Leia a entrada.' })
const predictionExercise = (assessmentIntentKey: string, conceptKey: string, output: string) => ({ assessmentIntentKey, conceptKeys: [conceptKey], kind: 'PREDICT_OUTPUT', difficulty: 'standard', title: `Preveja ${output}`, statement: 'Determine a saída exata.', inputDescription: '', outputDescription: '', language: 'python', starterCode: '', predictionPrompt: 'Qual será a saída?', codeToObserve: `print(${JSON.stringify(output)})`, requiredForTopicCompletion: false, publicTests: [], hiddenTests: [], referenceSolution: null, expectedPrediction: output, hint: 'Acompanhe o print.' })

describe('authoritative learning acceptance flow', () => {
  it('creates, studies and reviews only through public services and IPC handlers, then survives restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'coach-learning-acceptance-')); directories.push(directory)
    const databasePath = join(directory, 'coach.sqlite')
    let database = openCoachDatabase({ databasePath, migrationsFolder: resolve('drizzle/migrations') })
    const workspaces = new DrizzleWorkspaceRepository(database)
    const providers = new AIProviderManager()
    let topicId = ''
    const provider: AIProvider = { id: 'fixture', name: 'Fixture', async testConnection() {}, getCapabilities: () => ({ streaming: false, usageInformation: false, supportedInput: ['text'] }), async sendMessage(request) { const system = request.messages[0]?.content ?? ''; const content = system.includes('estrutura curricular progressiva') ? roadmapResponse : system.includes('aula profunda') ? lessonResponse(topicId) : { exercises: [codeExercise('PROGRAMMING_PROBLEM', 'loops-check', 'loops', 1), codeExercise('FIX_CODE', 'conditions-check', 'conditionals', 2), codeExercise('COMPLETE_CODE', 'variables-run', 'variables', 3), predictionExercise('output-predict', 'output', '4'), predictionExercise('iteration-predict', 'iteration', '5'), predictionExercise('output-predict', 'output', '6'), predictionExercise('iteration-predict', 'iteration', '7')] }; return { content: JSON.stringify(content), providerId: 'fixture', modelId: 'fixture-model' } } }
    providers.register(provider); providers.select(provider.id)
    const workspace = await new WorkspaceService({ repository: workspaces }).create({ name: 'Python', objective: 'Aprender laços e condições' })
    const roadmaps = new DrizzleRoadmapRepository(database)
    const roadmapService = new RoadmapService(roadmaps, providers, (id) => workspaces.findById(id))
    expect((await roadmapService.ensureLearningPath(workspace.id)).status).toBe('ready')
    const roadmap = await roadmapService.get(workspace.id); expect(roadmap).not.toBeNull()
    const module = roadmap!.modules[0]!; topicId = `${module.id}:${module.topics[0]}`
    const lessons = new SqliteStudyLessonRepository(database)
    const lessonResult = await new StudyLessonService(lessons, providers, (id) => workspaces.findById(id), (id) => roadmaps.findCurrent(id)).getOrCreate({ workspaceId: workspace.id, roadmapId: roadmap!.id, moduleId: module.id, topicId })
    if (lessonResult.status !== 'ready') throw new Error('Fixture lesson was not accepted')
    const lesson = lessonResult.lesson
    const evidence = new SqliteLearningEvidenceService(database)
    const fakeToolchain = { getStatuses: () => [{ language: 'python' as const, available: true, command: 'fixture', version: '1', detail: null }], execute: async (project: { files: Array<{ content: string }> }, _signal?: AbortSignal, stdin = '') => { const source = project.files[0]!.content; const literal = source.match(/print\(["'](.+)["']\)/)?.[1]; return { command: 'fixture', stdout: `${literal ?? stdin.trim()}\n`, stderr: '', exitCode: 0, timedOut: false, durationMs: 1, errorSignature: null, phase: 'run' as const, diagnostics: [] } } }
    const exercises = new ExerciseService(new SqliteExerciseRepository(database, Date.now, evidence), providers, fakeToolchain as never, (id) => workspaces.findById(id), (id) => roadmaps.findCurrent(id))
    const preparedSet = await exercises.prepareGeneration({ workspaceId: workspace.id, roadmapId: roadmap!.id, moduleId: module.id, topicId, lessonId: lesson.id, revision: 1, inputHash: 'acceptance' }, new AbortController().signal)
    const set = preparedSet.publish(); expect(set, set.lastErrorCode ?? undefined).toMatchObject({ status: 'ready' })
    registerStudyProgressHandlers(database, () => fakeToolchain.getStatuses(), undefined, undefined, evidence)
    registerCodeExecutionHandlers((id) => workspaces.findById(id).then(Boolean), { recordExecution: vi.fn() } as never, undefined, database, fakeToolchain as never, evidence)
    registerExerciseHandlers(exercises)
    const invoke = async <T>(channel: string, payload: unknown): Promise<T> => { const handler = ipc.handlers.get(channel); if (!handler) throw new Error(`Missing IPC bridge for ${channel}`); const sender = { id: 1, once: vi.fn(), removeListener: vi.fn() }; return await handler({ sender }, payload) as T }
    await invoke(STUDY_PROGRESS_CHANNELS.select, { workspaceId: workspace.id, roadmapId: roadmap!.id, moduleId: module.id, topicId, lessonId: lesson.id, checkpointId: null })
    const checkpoints = lesson.blocks.filter((block) => block.type === 'checkpoint')
    const checkpointAttemptIds: string[] = []
    for (const block of checkpoints) { const result = await invoke<{ learningAttemptId: string | null }>(STUDY_PROGRESS_CHANNELS.answerCheckpoint, { workspaceId: workspace.id, lessonId: lesson.id, checkpointId: block.id, selectedOptionId: block.options.find((option) => option.id !== block.correctOptionId)!.id, studentJustification: '' }); expect(result.learningAttemptId).not.toBeNull(); checkpointAttemptIds.push(result.learningAttemptId!) }
    const interactive = lesson.blocks.find((block) => block.type === 'interactiveCode')!
    const interactiveState = await invoke<{ validationResult: { learningAttemptId?: string | null } }>(CODE_EXECUTION_CHANNELS.executeInteractive, { workspaceId: workspace.id, lessonId: lesson.id, blockId: interactive.id, currentCode: interactive.initialCode, prediction: null }); expect(interactiveState.validationResult.learningAttemptId).not.toBeNull()
    const exerciseAttemptIds: string[] = []
    for (const item of set.exercises) { const result = await invoke<{ attemptId: string | null; learningAttemptId?: string | null }>(EXERCISE_CHANNELS.submit, { workspaceId: workspace.id, exerciseId: item.id, code: item.starterCode || '', prediction: item.kind === 'PREDICT_OUTPUT' ? 'wrong' : null, idempotencyKey: `acceptance-${item.id}` }); expect(result.attemptId).not.toBeNull(); expect(result.learningAttemptId).not.toBeNull(); exerciseAttemptIds.push(result.learningAttemptId!) }
    const attempts = database.sqlite.prepare('SELECT id,concept_id AS conceptId,assessment_intent_id AS intentId,assessment_variant_id AS variantId FROM learning_attempts WHERE id IN (' + [...checkpointAttemptIds, interactiveState.validationResult.learningAttemptId!, ...exerciseAttemptIds].map(() => '?').join(',') + ')').all(...checkpointAttemptIds, interactiveState.validationResult.learningAttemptId!, ...exerciseAttemptIds) as Array<{ id: string; conceptId: string | null; intentId: string | null; variantId: string | null }>
    expect(attempts).toHaveLength(10); expect(attempts.every((row) => row.conceptId && row.intentId && row.variantId)).toBe(true)
    expect((database.sqlite.prepare('SELECT COUNT(DISTINCT assessment_variant_id) AS count FROM learning_attempts WHERE workspace_id=? AND assessment_variant_id IS NOT NULL').get(workspace.id) as { count: number }).count).toBeGreaterThanOrEqual(4)
    expect((database.sqlite.prepare('SELECT COUNT(*) AS count FROM concept_memories WHERE workspace_id=?').get(workspace.id) as { count: number }).count).toBeGreaterThanOrEqual(4)
    const review = new ReviewService(database, evidence)
    let session = review.start({ workspaceId: workspace.id, targetSize: 4 }); expect(session, JSON.stringify(database.sqlite.prepare("SELECT c.canonical_name AS concept,v.environment,v.source_ref AS sourceRef,v.public_payload_json AS payload FROM assessment_variants v JOIN assessment_intents i ON i.id=v.intent_id JOIN concepts c ON c.id=i.concept_id WHERE v.workspace_id=?").all(workspace.id))).toMatchObject({ status: 'active' }); expect(session.items).toHaveLength(4)
    for (const item of session.items) { const payload = item.payload as { options?: Array<{ id: string }> }; session = review.submit({ workspaceId: workspace.id, sessionId: session.id, itemId: item.id, answer: payload.options?.[0]?.id ?? (JSON.stringify(item.payload).includes('print("4")') ? '4' : '5'), idempotencyKey: `review-${item.id}` }) }
    expect(session.status).toBe('completed')
    database.close(); database = openCoachDatabase({ databasePath, migrationsFolder: resolve('drizzle/migrations') })
    const stored = database.sqlite.prepare('SELECT status FROM review_sessions WHERE id=?').get(session.id) as { status: string }
    expect(stored.status).toBe('completed'); expect((database.sqlite.prepare('SELECT COUNT(*) AS count FROM review_items WHERE session_id=? AND learning_attempt_id IS NOT NULL').get(session.id) as { count: number }).count).toBe(4)
    expect((database.sqlite.prepare('SELECT COUNT(*) AS count FROM learning_attempts WHERE workspace_id=? AND concept_id IS NOT NULL AND assessment_intent_id IS NOT NULL AND assessment_variant_id IS NOT NULL').get(workspace.id) as { count: number }).count).toBeGreaterThanOrEqual(14)
    expect((database.sqlite.prepare('SELECT COUNT(*) AS count FROM concept_memories WHERE workspace_id=?').get(workspace.id) as { count: number }).count).toBeGreaterThanOrEqual(4)
    database.close()
  }, 30_000)
})
