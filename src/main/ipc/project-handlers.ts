import { ipcMain } from 'electron'
import type { ProjectService } from '../../application/projects/project-service'
import { PROJECT_CHANNELS } from '../../shared/contracts/project-channels'
import { createProjectFileInputSchema, createProjectInputSchema, deleteProjectFileInputSchema, openProjectFileInputSchema, renameProjectFileInputSchema, saveProjectFileInputSchema, workspaceProjectInputSchema } from '../../shared/contracts/project-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerProjectHandlers(service: ProjectService): void {
  ipcMain.handle(PROJECT_CHANNELS.get, (event, payload: unknown) => { assertTrustedSender(event); return service.get(workspaceProjectInputSchema.parse(payload).workspaceId) })
  ipcMain.handle(PROJECT_CHANNELS.create, (event, payload: unknown) => { assertTrustedSender(event); const input = createProjectInputSchema.parse(payload); return service.create(input.workspaceId, input.name, input.language) })
  ipcMain.handle(PROJECT_CHANNELS.createFile, (event, payload: unknown) => { assertTrustedSender(event); const input = createProjectFileInputSchema.parse(payload); return service.createFile(input.projectId, input.path, input.content) })
  ipcMain.handle(PROJECT_CHANNELS.saveFile, (event, payload: unknown) => { assertTrustedSender(event); const input = saveProjectFileInputSchema.parse(payload); return service.saveFile(input.projectId, input.fileId, input.content, input.expectedRevision) })
  ipcMain.handle(PROJECT_CHANNELS.renameFile, (event, payload: unknown) => { assertTrustedSender(event); const input = renameProjectFileInputSchema.parse(payload); return service.renameFile(input.projectId, input.fileId, input.path) })
  ipcMain.handle(PROJECT_CHANNELS.deleteFile, (event, payload: unknown) => { assertTrustedSender(event); const input = deleteProjectFileInputSchema.parse(payload); return service.deleteFile(input.projectId, input.fileId) })
  ipcMain.handle(PROJECT_CHANNELS.openFile, (event, payload: unknown) => { assertTrustedSender(event); const input = openProjectFileInputSchema.parse(payload); return service.openFile(input.projectId, input.fileId) })
}
