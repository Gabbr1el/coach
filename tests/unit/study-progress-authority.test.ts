import { describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { assertTopicCompletionAllowed, mapStudyProgressState, nextTopicTarget } from '../../src/main/ipc/study-progress-handlers'
import { resolve } from 'node:path'
import { applyLearningEvidence, emptyTopicLearningState } from '../../src/application/study-progress/topic-learning'
import { readFileSync } from 'node:fs'

const migrationsFolder = resolve('drizzle/migrations')

function state(checkpointStates: Record<string, unknown>) {
  return mapStudyProgressState({ workspaceId: '00000000-0000-4000-8000-000000000001', roadmapId: '00000000-0000-4000-8000-000000000002', currentModuleId: '00000000-0000-4000-8000-000000000003', currentTopicId: 'topic', currentLessonId: 'lesson', currentCheckpointId: null, topicStatusesJson: '{}', lessonPositionsJson: '{}', checkpointStatesJson: JSON.stringify(checkpointStates), updatedAt: 1 })
}
const correctState = { selectedOptionId: 'option-0', studentJustification: 'Corresponde ao comportamento explicado', attempt: 1, correct: true, currentFeedback: 'Correto', currentReinforcement: null, rationale: 'Corresponde ao comportamento descrito', history: [] }

function databaseWithLesson(checkpointCount: number) {
  const database = openCoachDatabase({ databasePath: ':memory:', migrationsFolder })
  database.sqlite.prepare("INSERT INTO workspaces (id, name, objective, status, created_at, updated_at) VALUES (?, 'C', 'Ponteiros', 'active', 1, 1)").run('00000000-0000-4000-8000-000000000001')
  const blocks = Array.from({ length: checkpointCount }, (_, index) => ({ id: `check-${index}`, type: 'checkpoint', questionType: 'multiple_choice', title: `Check ${index}`, question: 'Qual?', options: [{ id: 'option-0', text: 'A', rationale: 'Esta é a alternativa correta porque corresponde ao comportamento descrito.' }, { id: 'option-1', text: 'B', rationale: 'lacuna', misconceptionTag: 'distractor-1' }, { id: 'option-2', text: 'O comportamento seria sempre indefinido', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-2' }, { id: 'option-3', text: 'Uma condição diferente seria necessária', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-3' }, { id: 'option-4', text: 'Nenhuma mudança seria observada', rationale: 'Esta alternativa não corresponde ao comportamento avaliado.', misconceptionTag: 'distractor-4' }], correctOptionId: 'option-0', reasoningRequirement: 'required' as const, hint: 'Pense', reinforcement: 'Revise' }))
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
  it('never mutates exact roadmap topics_json during repeated difficulty and completion updates', () => {
    const database = databaseWithLesson(1)
    const moduleId = '00000000-0000-4000-8000-000000000003'
    database.sqlite.prepare("INSERT INTO roadmaps (id,workspace_id,title,status,generation_kind,version,content_revision,content_hash,created_at,updated_at) VALUES (?,'00000000-0000-4000-8000-000000000001','C','accepted','ai_generated',1,1,'test',1,1)").run('00000000-0000-4000-8000-000000000002')
    database.sqlite.prepare("INSERT INTO roadmap_modules (id,roadmap_id,title,objective,estimated_minutes,position,status,topics_json,outcomes_json,practice,completion_criteria_json,resources_json) VALUES (?,'00000000-0000-4000-8000-000000000002','Ponteiros','Aprender',60,1,'active','[\"Ponteiros\"]','[]','','[]','[]')").run(moduleId)
    const before = (database.sqlite.prepare('SELECT topics_json AS topicsJson FROM roadmap_modules WHERE id=?').get(moduleId) as { topicsJson: string }).topicsJson
    let learning = emptyTopicLearningState('00000000-0000-4000-8000-000000000001', `${moduleId}:Ponteiros`, 1)
    for (let attempt = 1; attempt <= 5; attempt++) learning = applyLearningEvidence(learning, { type: 'CHECKPOINT_ANSWERED', correct: false, attempt, hintUsed: true, reinforcementUsed: true, occurredAt: attempt + 1 })
    for (let completion = 0; completion < 3; completion++) learning = applyLearningEvidence(learning, { type: 'TOPIC_COMPLETED', exerciseCompleted: false, occurredAt: 20 + completion })
    expect(learning.difficultyLevel).toBe('high')
    expect((database.sqlite.prepare('SELECT topics_json AS topicsJson FROM roadmap_modules WHERE id=?').get(moduleId) as { topicsJson: string }).topicsJson).toBe(before)
    expect(readFileSync('src/main/ipc/study-progress-handlers.ts', 'utf8')).not.toContain('Reforço adaptativo:')
    database.close()
  })
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
  it('gates only required exercises from a ready set with an available toolchain', () => {
    const database = databaseWithLesson(2); const progress = state({ 'check-0': correctState, 'check-1': correctState })
    database.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,status,generation_attempts,created_at,updated_at) VALUES ('set',?,?,?,?,?,'ready',1,1,1)").run(progress.workspaceId, progress.roadmapId, progress.moduleId, progress.topicId, progress.lessonId)
    database.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,hint,created_at) VALUES ('required','set',1,'PROGRAMMING_PROBLEM','standard','Required','Do','in','out','python','',1,'[]','[]','secret','hint',1),('optional','set',2,'FIX_CODE','challenge','Optional','Do','in','out','python','',0,'[]','[]','secret','hint',1)").run()
    database.sqlite.prepare("INSERT INTO exercise_progress (workspace_id,exercise_id,status,current_code,attempts,help_count,updated_at) VALUES (?,'required','in_progress','',1,0,1),(?,'optional','not_started','',0,0,1)").run(progress.workspaceId, progress.workspaceId)
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', availableToolchains)).toThrow('Required exercises')
    database.sqlite.prepare("UPDATE exercise_progress SET status='passed' WHERE exercise_id='required'").run()
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', availableToolchains)).not.toThrow()
    database.sqlite.prepare("UPDATE exercise_progress SET status='in_progress' WHERE exercise_id='required'").run()
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', availableToolchains.map((item) => item.language === 'python' ? { ...item, available: false } : item))).not.toThrow()
    database.close()
  })
  it('treats non-ready sets and unavailable toolchains as non-applicable without fabricating a pass', () => {
    const database = databaseWithLesson(2); const progress = state({ 'check-0': correctState, 'check-1': correctState })
    database.sqlite.prepare("INSERT INTO exercise_sets (id,workspace_id,roadmap_id,module_id,topic_id,lesson_id,status,generation_attempts,created_at,updated_at) VALUES ('set',?,?,?,?,?,'waiting_for_provider',1,1,1)").run(progress.workspaceId, progress.roadmapId, progress.moduleId, progress.topicId, progress.lessonId)
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', availableToolchains)).not.toThrow()
    database.sqlite.prepare("UPDATE exercise_sets SET status='ready' WHERE id='set'").run()
    database.sqlite.prepare("INSERT INTO exercises (id,set_id,position,kind,difficulty,title,statement,input_description,output_description,language,starter_code,prediction_prompt,code_to_observe,required_for_topic_completion,public_tests_json,private_tests_json,reference_solution,expected_prediction,hint,created_at) VALUES ('required','set',1,'PROGRAMMING_PROBLEM','standard','Required','Do','in','out','python','print(1)',NULL,NULL,1,'[]','[]','print(1)',NULL,'hint',1)").run()
    database.sqlite.prepare("INSERT INTO exercise_progress (workspace_id,exercise_id,status,current_code,attempts,help_count,updated_at) VALUES (?,'required','not_started','print(1)',0,0,1)").run(progress.workspaceId)
    const unavailable = availableToolchains.map((status) => status.language === 'python' ? { ...status, available: false } : status)
    expect(() => assertTopicCompletionAllowed(database, progress, 'lesson', unavailable)).not.toThrow()
    expect(database.sqlite.prepare("SELECT status FROM exercise_progress WHERE exercise_id='required'").get()).toEqual({ status: 'not_started' })
    database.close()
  })
  it('counts only validated inline work as evidence and never an observation', () => {
    const initial = emptyTopicLearningState('workspace', 'topic', 1)
    const validated = applyLearningEvidence(initial, { type: 'INTERACTIVE_CODE_VALIDATED', occurredAt: 2 })
    expect(validated).toMatchObject({ evidenceCount: 1, exercisesCompleted: 1, assessments: 0, masteryEstimate: null })
    expect(initial).toMatchObject({ evidenceCount: 0, exercisesCompleted: 0 })
  })
  it('records restrained exercise failure evidence and distinguishes first try from help', () => {
    const initial = emptyTopicLearningState('workspace', 'topic', 1)
    const failed = applyLearningEvidence(initial, { type: 'EXERCISE_FAILED', occurredAt: 2 })
    const firstTry = applyLearningEvidence(initial, { type: 'EXERCISE_PASSED', attempt: 1, hintUsed: false, occurredAt: 2 })
    const afterHelp = applyLearningEvidence(initial, { type: 'EXERCISE_PASSED', attempt: 2, hintUsed: true, occurredAt: 2 })
    expect(failed).toMatchObject({ incorrect: 1, exercisesCompleted: 0, masteryEstimate: null })
    expect(firstTry).toMatchObject({ correctFirstTry: 1, correctAfterHelp: 0, exercisesCompleted: 1, masteryEstimate: null })
    expect(afterHelp).toMatchObject({ correctFirstTry: 0, correctAfterHelp: 1, exercisesCompleted: 1, masteryEstimate: null })
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
