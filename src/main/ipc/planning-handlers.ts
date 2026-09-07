import { ipcMain } from 'electron'
import type { PlanningService } from '../../application/planning/planning-service'
import { PLANNING_CHANNELS } from '../../shared/contracts/planning-channels'
import { addRoutineNoteInputSchema, applyAcademicMessageInputSchema, createDeadlineInputSchema } from '../../shared/contracts/planning-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerPlanningHandlers(service: PlanningService): void {
  ipcMain.handle(PLANNING_CHANNELS.listPriorities, (event) => { assertTrustedSender(event); return service.listPriorities() })
  ipcMain.handle(PLANNING_CHANNELS.createDeadline, (event, payload) => { assertTrustedSender(event); service.createDeadline(createDeadlineInputSchema.parse(payload)) })
  ipcMain.handle(PLANNING_CHANNELS.addRoutineNote, (event, payload) => { assertTrustedSender(event); service.addRoutineNote(addRoutineNoteInputSchema.parse(payload).content) })
  ipcMain.handle(PLANNING_CHANNELS.listRoutineNotes, (event) => { assertTrustedSender(event); return service.listRoutineNotes() })
  ipcMain.handle(PLANNING_CHANNELS.getSchedule, (event) => { assertTrustedSender(event); return service.getSchedule() })
  ipcMain.handle(PLANNING_CHANNELS.applyAcademicMessage, (event, payload) => { assertTrustedSender(event); return service.applyAcademicMessage(applyAcademicMessageInputSchema.parse(payload).content) })
  ipcMain.handle(PLANNING_CHANNELS.getAcademicOverview, (event) => { assertTrustedSender(event); return service.getAcademicOverview() })
}
