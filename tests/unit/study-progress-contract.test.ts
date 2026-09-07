import { describe, expect, it } from 'vitest'
import { recordStudyEventSchema, studySelectionSchema, updateStudyPositionSchema } from '../../src/shared/contracts/study-progress-contract'
import { mapStudyProgressState } from '../../src/main/ipc/study-progress-handlers'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const roadmapId = '00000000-0000-4000-8000-000000000002'
const moduleId = '00000000-0000-4000-8000-000000000003'

describe('study progress contract', () => {
  it('keeps module, topic, lesson and checkpoint as one selection', () => {
    expect(studySelectionSchema.parse({ workspaceId, roadmapId, moduleId, topicId: `${moduleId}:print`, lessonId: `${moduleId}:print:lesson`, checkpointId: `${moduleId}:print:lesson:checkpoint` })).toMatchObject({ topicId: `${moduleId}:print`, checkpointId: `${moduleId}:print:lesson:checkpoint` })
  })

  it('maps persisted current selection and statuses without completing an opened topic', () => {
    const state = mapStudyProgressState({ workspaceId, roadmapId, currentModuleId: moduleId, currentTopicId: `${moduleId}:print`, currentLessonId: `${moduleId}:print:lesson`, currentCheckpointId: null, topicStatusesJson: JSON.stringify({ [`${moduleId}:print`]: 'IN_PROGRESS' }), lessonPositionsJson: '{}', updatedAt: 1 })
    expect(state.topicId).toBe(`${moduleId}:print`)
    expect(state.topicStatuses[state.topicId]).toBe('IN_PROGRESS')
  })

  it('records checkpoint result and help as pedagogical events', () => {
    expect(recordStudyEventSchema.parse({ workspaceId, type: 'CHECKPOINT_ANSWERED', moduleId, topicId: `${moduleId}:print`, lessonId: `${moduleId}:print:lesson`, checkpointId: `${moduleId}:print:lesson:checkpoint`, correct: false }).correct).toBe(false)
    expect(recordStudyEventSchema.parse({ workspaceId, type: 'HELP_USED', moduleId, topicId: `${moduleId}:print`, lessonId: `${moduleId}:print:lesson`, checkpointId: null }).type).toBe('HELP_USED')
  })

  it('persists a checkpoint position independently from completion', () => {
    const lessonId = `${moduleId}:print:lesson`
    const position = updateStudyPositionSchema.parse({ workspaceId, position: { lessonId, currentBlockId: `${lessonId}:verification`, currentStage: 'verification', currentCheckpointId: `${lessonId}:checkpoint`, currentExerciseId: null, completedBlockIds: [`${lessonId}:explanation`, `${lessonId}:example`], selectedAnswer: null, attempt: 0, feedback: null, reinforcementBlocks: [] } }).position
    expect(position.currentStage).toBe('verification')
    expect(position.completedBlockIds).not.toContain(position.currentBlockId)
  })

  it('restores distinct positions for topics after process restart', () => {
    const lessonA = `${moduleId}:a:lesson`
    const lessonB = `${moduleId}:b:lesson`
    const positions = { [lessonA]: { lessonId: lessonA, currentBlockId: `${lessonA}:exercise`, currentStage: 'exercise' as const, currentCheckpointId: `${lessonA}:checkpoint`, currentExerciseId: `${lessonA}:exercise`, completedBlockIds: [], selectedAnswer: 1, attempt: 1, feedback: 'Correto', reinforcementBlocks: [] }, [lessonB]: { lessonId: lessonB, currentBlockId: `${lessonB}:example`, currentStage: 'example' as const, currentCheckpointId: null, currentExerciseId: null, completedBlockIds: [], selectedAnswer: null, attempt: 0, feedback: null, reinforcementBlocks: [] } }
    const restored = mapStudyProgressState({ workspaceId, roadmapId, currentModuleId: moduleId, currentTopicId: `${moduleId}:a`, currentLessonId: lessonA, currentCheckpointId: `${lessonA}:checkpoint`, topicStatusesJson: '{}', lessonPositionsJson: JSON.stringify(positions), updatedAt: 2 })
    expect(restored.currentPosition?.currentStage).toBe('exercise')
    expect(restored.lessonPositions[lessonB]?.currentStage).toBe('example')
  })

  it('restores incorrect feedback and inserted reinforcement', () => {
    const lessonId = `${moduleId}:print:lesson`
    const position = { lessonId, currentBlockId: `${lessonId}:feedback`, currentStage: 'feedback' as const, currentCheckpointId: `${lessonId}:checkpoint`, currentExerciseId: null, completedBlockIds: [], selectedAnswer: 2, attempt: 1, feedback: 'Revise strings', reinforcementBlocks: ['Strings precisam de aspas'] }
    const restored = mapStudyProgressState({ workspaceId, roadmapId, currentModuleId: moduleId, currentTopicId: `${moduleId}:print`, currentLessonId: lessonId, currentCheckpointId: position.currentCheckpointId, topicStatusesJson: '{}', lessonPositionsJson: JSON.stringify({ [lessonId]: position }), updatedAt: 3 })
    expect(restored.currentPosition).toMatchObject({ currentStage: 'feedback', selectedAnswer: 2, attempt: 1, feedback: 'Revise strings', reinforcementBlocks: ['Strings precisam de aspas'] })
  })

  it('uses no fabricated position for a lesson never started', () => {
    const restored = mapStudyProgressState({ workspaceId, roadmapId, currentModuleId: moduleId, currentTopicId: `${moduleId}:new`, currentLessonId: `${moduleId}:new:lesson`, currentCheckpointId: null, topicStatusesJson: '{}', lessonPositionsJson: '{}', updatedAt: 4 })
    expect(restored.currentPosition).toBeNull()
  })
})
