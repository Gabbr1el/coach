import { ipcMain } from 'electron'
import type { StudyLessonService } from '../../application/study-lessons/study-lesson-service'
import { STUDY_LESSON_CHANNELS } from '../../shared/contracts/study-lesson-channels'
import { activateStudyLessonAdaptationSchema, adaptStudyLessonSectionSchema, evaluateStudyCheckpointSchema, getStudyLessonSchema, studyLessonAdaptationSelectionSchema, updateStudyPreferencesSchema } from '../../shared/contracts/study-lesson-contract'
import { workspaceConversationInputSchema } from '../../shared/contracts/conversation-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerStudyLessonHandlers(service: StudyLessonService): void {
  ipcMain.handle(STUDY_LESSON_CHANNELS.getOrCreate, (event, payload) => { assertTrustedSender(event); return service.getOrCreate(getStudyLessonSchema.parse(payload)) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.evaluate, async (event, payload) => { assertTrustedSender(event); const input = evaluateStudyCheckpointSchema.parse(payload); const lesson = await service.getOrCreate(input); return service.evaluate(lesson, input.checkpointId, input.selectedIndex, input.attempt) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.adaptSection, (event, payload) => { assertTrustedSender(event); return service.adaptSection(adaptStudyLessonSectionSchema.parse(payload)) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.listAdaptations, (event, payload) => { assertTrustedSender(event); return service.listAdaptations(studyLessonAdaptationSelectionSchema.parse(payload)) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.restoreOriginal, (event, payload) => { assertTrustedSender(event); return service.restoreOriginal(studyLessonAdaptationSelectionSchema.parse(payload)) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.activateAdaptation, (event, payload) => { assertTrustedSender(event); return service.activateAdaptation(activateStudyLessonAdaptationSchema.parse(payload)) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.getPreferences, (event, payload) => { assertTrustedSender(event); return service.getPreferences(workspaceConversationInputSchema.parse(payload).workspaceId) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.updatePreferences, (event, payload) => { assertTrustedSender(event); const input = updateStudyPreferencesSchema.parse(payload); return service.updatePreferences(input.workspaceId, input.preferences) })
}
