import { describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { assertTopicCompletionAllowed, mapStudyProgressState, nextTopicTarget } from '../../src/main/ipc/study-progress-handlers'
import { resolve } from 'node:path'
import { applyLearningEvidence, emptyTopicLearningState } from '../../src/application/study-progress/topic-learning'

const migrationsFolder = resolve('drizzle/migrations')

function state(checkpointStates: Record<string, { selectedAnswer: number | null; attempt: number; correct: boolean; feedback: string | null; reinforcementBlocks: string[] }>) {
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

describe('authoritative topic completion gate', () => {
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
