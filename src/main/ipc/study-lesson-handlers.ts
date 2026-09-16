import { ipcMain } from 'electron'
import type { StudyLessonService } from '../../application/study-lessons/study-lesson-service'
import { STUDY_LESSON_CHANNELS } from '../../shared/contracts/study-lesson-channels'
import { activateStudyLessonAdaptationSchema, adaptStudyLessonSectionSchema, evaluateStudyCheckpointSchema, getStudyLessonSchema, studyLessonAdaptationSelectionSchema, updateStudyPreferencesSchema } from '../../shared/contracts/study-lesson-contract'
import { workspaceConversationInputSchema } from '../../shared/contracts/conversation-contract'
import { assertTrustedSender } from './trusted-sender'
import type { CoachDatabase } from '../database/connection'
import { assertAcceptedTopicAccess, assertPersistedLessonTuple, authorizePersistedLessonAccess } from '../curricular-access'

export function registerStudyLessonHandlers(service: StudyLessonService, database?: CoachDatabase): void {
  ipcMain.handle(STUDY_LESSON_CHANNELS.getOrCreate, (event, payload) => { assertTrustedSender(event); const input = getStudyLessonSchema.parse(payload); if (database) assertAcceptedTopicAccess(database, input); return service.getOrCreate(input) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.evaluate, async (event, payload) => { assertTrustedSender(event); const input = evaluateStudyCheckpointSchema.parse(payload); const persisted = database ? authorizePersistedLessonAccess(database, input.workspaceId, input.lessonId) : input; if (database) assertPersistedLessonTuple(persisted, input); const lesson = await service.getOrCreate({ workspaceId: persisted.workspaceId, roadmapId: persisted.roadmapId, moduleId: persisted.moduleId, topicId: persisted.topicId }); if (lesson.status !== 'ready' || lesson.lesson.id !== input.lessonId) throw new Error('Study lesson not found'); return service.evaluate(lesson, input.checkpointId, input.selectedOptionId, 1, input.studentJustification) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.adaptSection, (event, payload) => { assertTrustedSender(event); const input = adaptStudyLessonSectionSchema.parse(payload); const persisted = database ? authorizePersistedLessonAccess(database, input.workspaceId, input.lessonId) : input; if (database) assertPersistedLessonTuple(persisted, input); return service.adaptSection({ ...input, roadmapId: persisted.roadmapId, moduleId: persisted.moduleId, topicId: persisted.topicId }) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.listAdaptations, (event, payload) => { assertTrustedSender(event); const input = studyLessonAdaptationSelectionSchema.parse(payload); if (database) authorizePersistedLessonAccess(database, input.workspaceId, input.lessonId); return service.listAdaptations(input) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.restoreOriginal, (event, payload) => { assertTrustedSender(event); const input = studyLessonAdaptationSelectionSchema.parse(payload); if (database) authorizePersistedLessonAccess(database, input.workspaceId, input.lessonId); return service.restoreOriginal(input) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.activateAdaptation, (event, payload) => { assertTrustedSender(event); const input = activateStudyLessonAdaptationSchema.parse(payload); if (database) authorizePersistedLessonAccess(database, input.workspaceId, input.lessonId); return service.activateAdaptation(input) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.getPreferences, (event, payload) => { assertTrustedSender(event); return service.getPreferences(workspaceConversationInputSchema.parse(payload).workspaceId) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.updatePreferences, (event, payload) => { assertTrustedSender(event); const input = updateStudyPreferencesSchema.parse(payload); return service.updatePreferences(input.workspaceId, input.preferences) })
}
