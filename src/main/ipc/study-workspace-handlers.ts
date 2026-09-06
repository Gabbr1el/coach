import { ipcMain } from 'electron'
import type { StudyWorkspaceService } from '../../application/study-workspaces/study-workspace-service'
import { STUDY_WORKSPACE_CHANNELS } from '../../shared/contracts/study-workspace-channels'
import { flushWorkspaceDraftsInputSchema, saveWorkspaceDocumentInputSchema, saveWorkspaceNotesInputSchema, studyWorkspaceIdInputSchema, toggleStudyPlanItemInputSchema, updateContextSharingInputSchema, updateStudyTimerInputSchema } from '../../shared/contracts/study-workspace-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerStudyWorkspaceHandlers(service: StudyWorkspaceService): void {
  ipcMain.handle(STUDY_WORKSPACE_CHANNELS.getState, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.getState(studyWorkspaceIdInputSchema.parse(payload).workspaceId)
  })
  ipcMain.handle(STUDY_WORKSPACE_CHANNELS.saveDocument, (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = saveWorkspaceDocumentInputSchema.parse(payload)
    return service.saveDocument(input.workspaceId, input.fileName, input.language, input.content, input.revision)
  })
  ipcMain.handle(STUDY_WORKSPACE_CHANNELS.saveNotes, (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = saveWorkspaceNotesInputSchema.parse(payload)
    return service.saveNotes(input.workspaceId, input.notes, input.revision)
  })
  ipcMain.handle(STUDY_WORKSPACE_CHANNELS.updateContextSharing, (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = updateContextSharingInputSchema.parse(payload)
    return service.updateContextSharing(input.workspaceId, input.enabled)
  })
  ipcMain.handle(STUDY_WORKSPACE_CHANNELS.togglePlanItem, (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = toggleStudyPlanItemInputSchema.parse(payload)
    return service.togglePlanItem(input.workspaceId, input.itemId)
  })
  ipcMain.handle(STUDY_WORKSPACE_CHANNELS.updateTimer, (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = updateStudyTimerInputSchema.parse(payload)
    return service.updateTimer(input.workspaceId, input.action)
  })
  ipcMain.on(STUDY_WORKSPACE_CHANNELS.flushDrafts, (event, payload: unknown) => {
    try {
      assertTrustedSender(event)
      service.flushDrafts(flushWorkspaceDraftsInputSchema.parse(payload))
      event.returnValue = true
    } catch {
      event.returnValue = false
    }
  })
  ipcMain.handle(STUDY_WORKSPACE_CHANNELS.completeSession, (event, payload: unknown) => { assertTrustedSender(event); return service.completeSession(studyWorkspaceIdInputSchema.parse(payload).workspaceId) })
  ipcMain.handle(STUDY_WORKSPACE_CHANNELS.listSessionHistory, (event, payload: unknown) => { assertTrustedSender(event); return service.listSessionHistory(studyWorkspaceIdInputSchema.parse(payload).workspaceId) })
}
