import { ipcMain } from 'electron'
import type { WorkspaceService } from '../../application/workspaces/workspace-service'
import {
  createWorkspaceInputSchema,
  prepareWorkspaceDraftInputSchema,
  workspaceIdSchema,
} from '../../shared/contracts/workspace-contract'
import { WORKSPACE_CHANNELS } from '../../shared/contracts/workspace-channels'
import { assertTrustedSender } from './trusted-sender'

function publicWorkspaceError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  console.error('Workspace creation operation failed:', error)
  const duplicate = message.match(/WORKSPACE_DUPLICATE\|[^\r\n]+$/)?.[0]
  if (duplicate) return new Error(duplicate)
  if (message.includes('Workspace draft not found')) return new Error('Workspace draft not found')
  if (message.includes('Workspace draft changed after materials were attached')) return new Error('Workspace draft changed after materials were attached; discard it and analyze again')
  return new Error('Não foi possível concluir a criação do Workspace. Tente novamente.')
}

export function registerWorkspaceHandlers(service: WorkspaceService): void {
  ipcMain.handle(WORKSPACE_CHANNELS.list, (event) => {
    assertTrustedSender(event)
    return service.list()
  })

  ipcMain.handle(WORKSPACE_CHANNELS.create, async (event, payload: unknown) => {
    assertTrustedSender(event)
    try { return await service.create(createWorkspaceInputSchema.parse(payload)) } catch (error) { throw publicWorkspaceError(error) }
  })
  ipcMain.handle(WORKSPACE_CHANNELS.prepareDraft, async (event, payload: unknown) => { assertTrustedSender(event); try { return await service.prepareDraft(prepareWorkspaceDraftInputSchema.parse(payload)) } catch (error) { throw publicWorkspaceError(error) } })
  ipcMain.handle(WORKSPACE_CHANNELS.discardDraft, (event, payload: unknown) => { assertTrustedSender(event); return service.discardDraft(workspaceIdSchema.parse(payload)) })
  ipcMain.handle(WORKSPACE_CHANNELS.getProvisioning, (event, payload: unknown) => { assertTrustedSender(event); return service.getProvisioning(workspaceIdSchema.parse(payload)) })
  ipcMain.handle(WORKSPACE_CHANNELS.retryProvisioning, (event, payload: unknown) => { assertTrustedSender(event); return service.retryProvisioning(workspaceIdSchema.parse(payload)) })

  ipcMain.handle(WORKSPACE_CHANNELS.open, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.open(workspaceIdSchema.parse(payload))
  })

  ipcMain.handle(WORKSPACE_CHANNELS.archive, (event, payload: unknown) => {
    assertTrustedSender(event)
    return service.archive(workspaceIdSchema.parse(payload))
  })
}
