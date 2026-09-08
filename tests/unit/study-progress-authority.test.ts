import { describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { assertTopicCompletionAllowed, mapStudyProgressState } from '../../src/main/ipc/study-progress-handlers'
import { resolve } from 'node:path'

const migrationsFolder = resolve('drizzle/migrations')

function state(checkpointStates: Record<string, { selectedAnswer: number | null; attempt: number; correct: boolean; feedback: string | null; reinforcementBlocks: string[] }>) {
  return mapStudyProgressState({ workspaceId: '00000000-0000-4000-8000-000000000001', roadmapId: '00000000-0000-4000-8000-000000000002', currentModuleId: '00000000-0000-4000-8000-000000000003', currentTopicId: 'topic', currentLessonId: 'lesson', currentCheckpointId: null, topicStatusesJson: '{}', lessonPositionsJson: '{}', checkpointStatesJson: JSON.stringify(checkpointStates), updatedAt: 1 })
}

function databaseWithLesson(checkpointCount: number) {
  const database = openCoachDatabase({ databasePath: ':memory:', migrationsFolder })
  database.sqlite.prepare("INSERT INTO workspaces (id, name, objective, status, created_at, updated_at) VALUES (?, 'C', 'Ponteiros', 'active', 1, 1)").run('00000000-0000-4000-8000-000000000001')
  const blocks = Array.from({ length: checkpointCount }, (_, index) => ({ id: `check-${index}`, type: 'checkpoint', title: `Check ${index}`, question: 'Qual?', options: ['A', 'B'], correctIndex: 0, difficultyByOption: ['nenhuma', 'lacuna'], hint: 'Pense', reinforcement: 'Revise' }))
  while (blocks.length < 4) blocks.push({ id: `text-${blocks.length}`, type: 'explanation', title: 'Texto', content: 'Conteúdo' } as never)
  database.sqlite.prepare('INSERT INTO study_lessons (id, workspace_id, roadmap_id, module_id, topic_id, generation_kind, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)').run('lesson', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'topic', 'ai_generated', JSON.stringify({ title: 'Aula', level: 'basic', objective: 'Aprender', blocks }))
  return database
}

describe('authoritative topic completion gate', () => {
  it('rejects lessons with fewer than two checkpoints even when the renderer state says correct', () => {
    const database = databaseWithLesson(1)
    expect(() => assertTopicCompletionAllowed(database, state({ 'check-0': { selectedAnswer: 0, attempt: 1, correct: true, feedback: null, reinforcementBlocks: [] } }), 'lesson')).toThrow('requires all lesson checkpoints')
    database.close()
  })

  it('rejects missing evidence and accepts all authoritative lesson checkpoints', () => {
    const database = databaseWithLesson(2)
    expect(() => assertTopicCompletionAllowed(database, state({ 'check-0': { selectedAnswer: 0, attempt: 1, correct: true, feedback: null, reinforcementBlocks: [] } }), 'lesson')).toThrow('requires all lesson checkpoints')
    expect(() => assertTopicCompletionAllowed(database, state({ 'check-0': { selectedAnswer: 0, attempt: 1, correct: true, feedback: null, reinforcementBlocks: [] }, 'check-1': { selectedAnswer: 0, attempt: 1, correct: true, feedback: null, reinforcementBlocks: [] } }), 'lesson')).not.toThrow()
    database.close()
  })
})
