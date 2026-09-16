import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { PdfMaterialService } from '../materials/pdf-material-service'
import { MATERIAL_CHANNELS } from '../../shared/contracts/material-channels'
import { decideMaterialInputSchema, importMaterialInputSchema, readMaterialInputSchema, readMaterialPageInputSchema, searchMaterialInputSchema, updateMaterialRelevanceInputSchema } from '../../shared/contracts/material-contract'
import { assertTrustedSender } from './trusted-sender'

function publicImportError(error: unknown): Error {
  console.error('Material import failed:', error)
  return new Error('Não foi possível importar o material. Verifique se o PDF ou PPTX é válido e tente novamente.')
}

export function registerMaterialHandlers(service: PdfMaterialService, workspaceExists: (id: string) => Promise<boolean>): void {
  ipcMain.handle(MATERIAL_CHANNELS.importPdf, async (event, payload) => { assertTrustedSender(event); const { workspaceId } = importMaterialInputSchema.parse(payload); if (!await workspaceExists(workspaceId)) throw new Error('Workspace not found'); const owner = BrowserWindow.fromWebContents(event.sender); try { const selected = owner ? await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] }) : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] }); return selected.canceled || !selected.filePaths[0] ? null : service.importPdf(workspaceId, selected.filePaths[0]) } finally { if (owner && !owner.isDestroyed()) { owner.show(); owner.focus(); owner.webContents.focus() } } })
  ipcMain.handle(MATERIAL_CHANNELS.importFile, async (event, payload) => { assertTrustedSender(event); const { workspaceId } = importMaterialInputSchema.parse(payload); if (!await workspaceExists(workspaceId)) throw new Error('Workspace não encontrado.'); const owner = BrowserWindow.fromWebContents(event.sender); try { const selected = owner ? await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: 'Materiais', extensions: ['pdf', 'pptx'] }] }) : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Materiais', extensions: ['pdf', 'pptx'] }] }); if (selected.canceled || !selected.filePaths[0]) return null; try { return await service.importFile(workspaceId, selected.filePaths[0]) } catch (error) { throw publicImportError(error) } } finally { if (owner && !owner.isDestroyed()) { owner.show(); owner.focus(); owner.webContents.focus() } } })
  ipcMain.handle(MATERIAL_CHANNELS.list, (event, payload) => { assertTrustedSender(event); return service.list(importMaterialInputSchema.parse(payload).workspaceId) })
  ipcMain.handle(MATERIAL_CHANNELS.search, (event, payload) => { assertTrustedSender(event); const input = searchMaterialInputSchema.parse(payload); return service.search(input.workspaceId, input.query, input.materialIds) })
  ipcMain.handle(MATERIAL_CHANNELS.read, (event, payload) => { assertTrustedSender(event); const input = readMaterialInputSchema.parse(payload); return service.read(input.workspaceId, input.materialId, input.offset, input.limit) })
  ipcMain.handle(MATERIAL_CHANNELS.readPage, (event, payload) => { assertTrustedSender(event); const input = readMaterialPageInputSchema.parse(payload); return service.readPage(input.workspaceId, input.materialId, input.pageNumber) })
  ipcMain.handle(MATERIAL_CHANNELS.overview, (event, payload) => { assertTrustedSender(event); const input = readMaterialInputSchema.pick({ workspaceId: true, materialId: true }).strict().parse(payload); return service.overview(input.workspaceId, input.materialId) })
  ipcMain.handle(MATERIAL_CHANNELS.updateRelevance, (event, payload) => { assertTrustedSender(event); const input = updateMaterialRelevanceInputSchema.parse(payload); return service.updateRelevance(input.workspaceId, input.materialId, input.relevance) })
  ipcMain.handle(MATERIAL_CHANNELS.decide, (event, payload) => { assertTrustedSender(event); const input = decideMaterialInputSchema.parse(payload); return service.decide(input.workspaceId, input.materialId, input.decision, input.role) })
}
