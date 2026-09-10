import { describe, expect, it } from 'vitest'
import { studyLessonContentSchema, studyPresentationPreferencesSchema } from '../../src/shared/contracts/study-lesson-contract'
import { mapStudyProgressState } from '../../src/main/ipc/study-progress-handlers'
import { studyCheckpointStateSchema } from '../../src/shared/contracts/study-progress-contract'

describe('adaptive study backward compatibility', () => {
  it('defaults sources on persisted lesson content from older versions', () => {
    const content = studyLessonContentSchema.parse({ title: 'Aula', level: 'basic', objective: 'Aprender', blocks: Array.from({ length: 4 }, (_, index) => ({ id: `b${index}`, type: 'explanation', title: `Bloco ${index}`, content: 'Conteúdo' })) })
    expect(content.sources).toEqual([])
  })

  it('defaults checkpoint states on progress rows from older versions', () => {
    const state = mapStudyProgressState({ workspaceId: crypto.randomUUID(), roadmapId: crypto.randomUUID(), currentModuleId: crypto.randomUUID(), currentTopicId: 'topic', currentLessonId: 'lesson', currentCheckpointId: null, topicStatusesJson: '{}', lessonPositionsJson: '{}', updatedAt: 1 })
    expect(state.checkpointStates).toEqual({})
  })

  it('defaults correctness for checkpoint states persisted before the evidence gate', () => {
    expect(studyCheckpointStateSchema.parse({ selectedAnswer: 1, attempt: 1, feedback: 'Revise', reinforcementBlocks: [] }).correct).toBe(false)
  })

  it('defaults workspace presentation preferences', () => {
    expect(studyPresentationPreferencesSchema.parse({})).toEqual({ detail: 'standard', explanation: 'balanced', examples: 'balanced', composition: 'balanced', presentation: 'reading', explicitIntents: [], recurringEvidence: { SIMPLIFY: 0, ANALOGY: 0, CODE_FIRST: 0, REORDER: 0, PRESENTATION: 0, MORE_EXAMPLES: 0, STEP_BY_STEP: 0, MORE_DEPTH: 0, MORE_CONCISE: 0 }, evidence: [] })
  })

  it('loads preferences persisted before contextual evidence existed', () => {
    expect(studyPresentationPreferencesSchema.parse({ detail: 'concise', recurringEvidence: { ANALOGY: 1 } })).toMatchObject({ detail: 'concise', evidence: [], recurringEvidence: { ANALOGY: 1 } })
  })
})
