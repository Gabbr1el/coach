import { dialog, ipcMain } from 'electron'
import { chmod, rename, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { CoachDatabase } from '../database/connection'
import { DATA_EXPORT_CHANNELS } from '../../shared/contracts/data-export-channels'
import { assertTrustedSender } from './trusted-sender'

export function registerDataExportHandlers(database: CoachDatabase): void {
  let exporting = false

  ipcMain.handle(DATA_EXPORT_CHANNELS.exportData, async (event) => {
    assertTrustedSender(event)
    if (exporting) throw new Error('A data export is already running')
    exporting = true
    const date = new Date().toISOString().slice(0, 10)
    let temporary: string | null = null

    try {
      const selected = await dialog.showSaveDialog({
        defaultPath: `coach-data-${date}.sqlite`,
        filters: [{ name: 'Coach Data', extensions: ['sqlite'] }],
        properties: ['showOverwriteConfirmation'],
      })
      if (selected.canceled || !selected.filePath) return null
      if (
        resolve(selected.filePath) === resolve(database.path)
        || (() => {
          try { return realpathSync(selected.filePath!) === realpathSync(database.path) } catch { return false }
        })()
      ) throw new Error('Export destination cannot be the active database')

      temporary = resolve(dirname(selected.filePath), `.coach-data-${crypto.randomUUID()}.partial`)
      await database.sqlite.backup(temporary)
      await chmod(temporary, 0o600)
      await rename(temporary, selected.filePath)
      return selected.filePath
    } catch (error) {
      if (temporary) await rm(temporary, { force: true })
      throw error
    } finally {
      exporting = false
    }
  })
}
