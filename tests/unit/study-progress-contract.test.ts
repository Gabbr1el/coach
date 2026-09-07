import { describe, expect, it } from 'vitest'
import { recordStudyEventSchema, studySelectionSchema } from '../../src/shared/contracts/study-progress-contract'
import { mapStudyProgressState } from '../../src/main/ipc/study-progress-handlers'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const roadmapId = '00000000-0000-4000-8000-000000000002'
const moduleId = '00000000-0000-4000-8000-000000000003'

describe('study progress contract', () => {
  it('keeps module, topic, lesson and checkpoint as one selection', () => {
    expect(studySelectionSchema.parse({ workspaceId, roadmapId, moduleId, topicId: `${moduleId}:print`, lessonId: `${moduleId}:print:lesson`, checkpointId: `${moduleId}:print:lesson:checkpoint` })).toMatchObject({ topicId: `${moduleId}:print`, checkpointId: `${moduleId}:print:lesson:checkpoint` })
  })

  it('maps persisted current selection and statuses without completing an opened topic', () => {
    const state = mapStudyProgressState({ workspaceId, roadmapId, currentModuleId: moduleId, currentTopicId: `${moduleId}:print`, currentLessonId: `${moduleId}:print:lesson`, currentCheckpointId: null, topicStatusesJson: JSON.stringify({ [`${moduleId}:print`]: 'IN_PROGRESS' }), updatedAt: 1 })
    expect(state.topicId).toBe(`${moduleId}:print`)
    expect(state.topicStatuses[state.topicId]).toBe('IN_PROGRESS')
  })

  it('records checkpoint result and help as pedagogical events', () => {
    expect(recordStudyEventSchema.parse({ workspaceId, type: 'CHECKPOINT_ANSWERED', moduleId, topicId: `${moduleId}:print`, lessonId: `${moduleId}:print:lesson`, checkpointId: `${moduleId}:print:lesson:checkpoint`, correct: false }).correct).toBe(false)
    expect(recordStudyEventSchema.parse({ workspaceId, type: 'HELP_USED', moduleId, topicId: `${moduleId}:print`, lessonId: `${moduleId}:print:lesson`, checkpointId: null }).type).toBe('HELP_USED')
  })
})
