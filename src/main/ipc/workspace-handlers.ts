import { ipcMain } from 'electron'
import type { WorkspaceService } from '../../application/workspaces/workspace-service'
import {
  createWorkspaceInputSchema,
  workspaceIdSchema,
} from '../../shared/contracts/workspace-contract'
import { WORKSPACE_CHANNELS } from '../../shared/contracts/workspace-channels'
import { assertTrustedSender } from './trusted-sender'

export function registerWorkspaceHandlers(service: WorkspaceService): void {
  ipcMain.handle(WORKSPACE_CHANNELS.list, (event) => {
    assertTrustedSender(event)
    return service.list()
  })

  ipcMain.handle(WORKSPACE_CHANNELS.create, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.create(createWorkspaceInputSchema.parse(payload))
  })

  ipcMain.handle(WORKSPACE_CHANNELS.open, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.open(workspaceIdSchema.parse(payload))
  })

  ipcMain.handle(WORKSPACE_CHANNELS.archive, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.archive(workspaceIdSchema.parse(payload))
  })
}
