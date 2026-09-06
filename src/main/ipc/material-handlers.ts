import { dialog, ipcMain } from 'electron'
import type { PdfMaterialService } from '../materials/pdf-material-service'
import { MATERIAL_CHANNELS } from '../../shared/contracts/material-channels'
import { importMaterialInputSchema, searchMaterialInputSchema } from '../../shared/contracts/material-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerMaterialHandlers(service: PdfMaterialService, workspaceExists: (id: string) => Promise<boolean>): void {
  ipcMain.handle(MATERIAL_CHANNELS.importPdf, async (event, payload) => { assertTrustedSender(event); const { workspaceId } = importMaterialInputSchema.parse(payload); if (!await workspaceExists(workspaceId)) throw new Error('Workspace not found'); const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] }); return selected.canceled || !selected.filePaths[0] ? null : service.importPdf(workspaceId, selected.filePaths[0]) })
  ipcMain.handle(MATERIAL_CHANNELS.list, (event, payload) => { assertTrustedSender(event); return service.list(importMaterialInputSchema.parse(payload).workspaceId) })
  ipcMain.handle(MATERIAL_CHANNELS.search, (event, payload) => { assertTrustedSender(event); const input = searchMaterialInputSchema.parse(payload); return service.search(input.workspaceId, input.query) })
}
