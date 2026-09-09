import { describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { assertTopicCompletionAllowed, mapStudyProgressState, nextTopicTarget } from '../../src/main/ipc/study-progress-handlers'
import { resolve } from 'node:path'
import { applyLearningEvidence, emptyTopicLearningState } from '../../src/application/study-progress/topic-learning'

const migrationsFolder = resolve('drizzle/migrations')

function state(checkpointStates: Record<string, unknown>) {
  return mapStudyProgressState({ workspaceId: '00000000-0000-4000-8000-000000000001', roadmapId: '00000000-0000-4000-8000-000000000002', currentModuleId: '00000000-0000-4000-8000-000000000003', currentTopicId: 'topic', currentLessonId: 'lesson', currentCheckpointId: null, topicStatusesJson: '{}', lessonPositionsJson: '{}', checkpointStatesJson: JSON.stringify(checkpointStates), updatedAt: 1 })
}
const correctState = { selectedOptionId: 'option-0', studentJustification: 'Corresponde ao comportamento explicado', attempt: 1, correct: true, currentFeedback: 'Correto', currentReinforcement: null, rationale: 'Corresponde ao comportamento descrito', history: [] }

function databaseWithLesson(checkpointCount: number) {
  const database = openCoachDatabase({ databasePath: ':memory:', migrationsFolder })
  database.sqlite.prepare("INSERT INTO workspaces (id, name, objective, status, created_at, updated_at) VALUES (?, 'C', 'Ponteiros', 'active', 1, 1)").run('00000000-0000-4000-8000-000000000001')
  const blocks = Array.from({ length: checkpointCount }, (_, index) => ({ id: `check-${index}`, type: 'checkpoint', questionType: 'multiple_choice', title: `Check ${index}`, question: 'Qual?', options: [{ id: 'option-0', text: 'A', rationale: 'Esta é a alternativa correta porque corresponde ao comportamento descrito.' }, { id: 'option-1', text: 'B', rationale: 'lacuna', misconceptionTag: 'distractor-1' }, { id: 'option-2', text: 'O comportamento seria sempre indefinido', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-2' }, { id: 'option-3', text: 'Uma condição diferente seria necessária', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-3' }, { id: 'option-4', text: 'Nenhuma mudança seria observada', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-4' }], correctOptionId: 'option-0', requiresJustification: true, hint: 'Pense', reinforcement: 'Revise' }))
  while (blocks.length < 4) blocks.push({ id: `text-${blocks.length}`, type: 'explanation', title: 'Texto', content: 'Conteúdo' } as never)
  database.sqlite.prepare('INSERT INTO study_lessons (id, workspace_id, roadmap_id, module_id, topic_id, generation_kind, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)').run('lesson', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'topic', 'ai_generated', JSON.stringify({ title: 'Aula', level: 'basic', objective: 'Aprender', blocks }))
  return database
}

const availableToolchains = [{ language: 'python' as const, available: true, command: '/usr/bin/python3', version: 'test', detail: null }, { language: 'c' as const, available: true, command: '/usr/bin/gcc', version: 'test', detail: null }, { language: 'java' as const, available: true, command: '/usr/bin/javac', version: 'test', detail: null }]

function addRequiredInteractive(database: ReturnType<typeof openCoachDatabase>, code = 'print(1)') {
  const row = database.sqlite.prepare('SELECT content_json AS contentJson FROM study_lessons WHERE id = ?').get('lesson') as { contentJson: string }
  const content = JSON.parse(row.contentJson) as { blocks: unknown[] }
  content.blocks.push({ id: 'required-run', type: 'interactiveCode', title: 'Execute', interactionType: 'EDIT_AND_RUN', language: 'python', instruction: 'Execute', initialCode: code, predictionPrompt: null, evidenceMode: 'validated', requiredForTopicCompletion: true, expectedOutput: '1' })
  database.sqlite.prepare('UPDATE study_lessons SET content_json = ? WHERE id = ?').run(JSON.stringify(content), 'lesson')
}

describe('authoritative topic completion gate', () => {
  it('blocks required interactive work until its current revision is passed', () => {
    const database = databaseWithLesson(2)
    addRequiredInteractive(database)
    const progress = state({ 'check-0': correctState, 'check-1': correctState })
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', availableToolchains)).toThrow('must be validated')
    database.sqlite.prepare("INSERT INTO study_interactive_code_states (workspace_id, lesson_id, block_id, current_code, prediction, current_source_revision, attempts, validation_result_json, updated_at) VALUES (?, ?, ?, ?, NULL, ?, 1, ?, 1)").run(progress.workspaceId, 'lesson', 'required-run', 'print(1)', 'revision-a-000000', JSON.stringify({ status: 'passed', message: 'ok', sourceRevision: 'revision-a-000000', actualOutput: '1', predictionCorrect: null, validatedAt: 1 }))
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', availableToolchains)).not.toThrow()
    database.sqlite.prepare("UPDATE study_interactive_code_states SET current_code = ?, current_source_revision = ? WHERE block_id = ?").run('print(2)', 'revision-b-000000', 'required-run')
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', availableToolchains)).toThrow('current source revision')
    database.sqlite.prepare("UPDATE study_interactive_code_states SET validation_result_json = ? WHERE block_id = ?").run(JSON.stringify({ status: 'passed', message: 'ok', sourceRevision: 'revision-b-000000', actualOutput: '1', predictionCorrect: null, validatedAt: 2 }), 'required-run')
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', availableToolchains)).not.toThrow()
    database.close()
  })

  it('does not deadlock completion when the required toolchain is unavailable', () => {
    const database = databaseWithLesson(2)
    addRequiredInteractive(database)
    const progress = state({ 'check-0': correctState, 'check-1': correctState })
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', availableToolchains.map((status) => status.language === 'python' ? { ...status, available: false } : status))).not.toThrow()
    database.close()
  })
  it('counts only validated inline work as evidence and never an observation', () => {
    const initial = emptyTopicLearningState('workspace', 'topic', 1)
    const validated = applyLearningEvidence(initial, { type: 'INTERACTIVE_CODE_VALIDATED', occurredAt: 2 })
    expect(validated).toMatchObject({ evidenceCount: 1, exercisesCompleted: 1, assessments: 0, masteryEstimate: null })
    expect(initial).toMatchObject({ evidenceCount: 0, exercisesCompleted: 0 })
  })
  it('advances within a module and unlocks the next module after its last topic', () => { const modules = [{ id: '00000000-0000-4000-8000-000000000003', topics: ['1.1', '1.2'] }, { id: '00000000-0000-4000-8000-000000000004', topics: ['2.1'] }]; expect(nextTopicTarget(modules, modules[0]!.id, `${modules[0]!.id}:1.1`)).toMatchObject({ topicId: `${modules[0]!.id}:1.2`, completedModule: false }); expect(nextTopicTarget(modules, modules[0]!.id, `${modules[0]!.id}:1.2`)).toMatchObject({ moduleId: modules[1]!.id, topicId: `${modules[1]!.id}:2.1`, completedModule: true }) })
  it('rejects lessons with fewer than two checkpoints even when the renderer state says correct', () => {
    const database = databaseWithLesson(1)
    expect(() => assertTopicCompletionAllowed(database, state({ 'check-0': { selectedAnswer: 0, attempt: 1, correct: true, feedback: null, reinforcementBlocks: [] } }), 'lesson')).toThrow('requires all lesson checkpoints')
    database.close()
  })

  it('rejects missing evidence and accepts all authoritative lesson checkpoints', () => {
    const database = databaseWithLesson(2)
    expect(() => assertTopicCompletionAllowed(database, state({ 'check-0': { selectedAnswer: 0, attempt: 1, correct: true, feedback: null, reinforcementBlocks: [] } }), 'lesson')).toThrow('requires all lesson checkpoints')
    expect(() => assertTopicCompletionAllowed(database, mapStudyProgressState({ workspaceId: '00000000-0000-4000-8000-000000000001', roadmapId: '00000000-0000-4000-8000-000000000002', currentModuleId: '00000000-0000-4000-8000-000000000003', currentTopicId: 'topic', currentLessonId: 'lesson', currentCheckpointId: null, topicStatusesJson: '{}', lessonPositionsJson: '{}', checkpointStatesJson: JSON.stringify({ 'check-0': correctState, 'check-1': correctState }), updatedAt: 1 }), 'lesson')).not.toThrow()
    database.close()
  })
})
