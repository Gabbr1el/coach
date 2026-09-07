import { ipcMain } from 'electron'
import type { StudyLessonService } from '../../application/study-lessons/study-lesson-service'
import { STUDY_LESSON_CHANNELS } from '../../shared/contracts/study-lesson-channels'
import { evaluateStudyCheckpointSchema, getStudyLessonSchema } from '../../shared/contracts/study-lesson-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerStudyLessonHandlers(service: StudyLessonService): void {
  ipcMain.handle(STUDY_LESSON_CHANNELS.getOrCreate, (event, payload) => { assertTrustedSender(event); return service.getOrCreate(getStudyLessonSchema.parse(payload)) })
  ipcMain.handle(STUDY_LESSON_CHANNELS.evaluate, async (event, payload) => { assertTrustedSender(event); const input = evaluateStudyCheckpointSchema.parse(payload); const lesson = await service.getOrCreate(input); return service.evaluate(lesson, input.checkpointId, input.selectedIndex, input.attempt) })
}
