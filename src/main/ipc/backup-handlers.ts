import { dialog, ipcMain } from 'electron'
import { rename, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { CoachDatabase } from '../database/connection'
import { BACKUP_CHANNELS } from '../../shared/contracts/backup-channels'
import { assertTrustedSender } from './trusted-sender'

export function registerBackupHandlers(database: CoachDatabase): void {
  let exporting = false
  ipcMain.handle(BACKUP_CHANNELS.exportBackup, async (event) => {
    assertTrustedSender(event)
    if (exporting) throw new Error('A backup export is already running')
    exporting = true
    const date = new Date().toISOString().slice(0, 10)
    let temporary: string | null = null
    try {
      const selected = await dialog.showSaveDialog({ defaultPath: `coach-backup-${date}.sqlite`, filters: [{ name: 'Coach Backup', extensions: ['sqlite'] }], properties: ['showOverwriteConfirmation'] })
      if (selected.canceled || !selected.filePath) return null
      if (resolve(selected.filePath) === resolve(database.path) || (() => { try { return realpathSync(selected.filePath!) === realpathSync(database.path) } catch { return false } })()) throw new Error('Backup destination cannot be the active database')
      temporary = resolve(dirname(selected.filePath), `.coach-backup-${crypto.randomUUID()}.partial`)
      await database.sqlite.backup(temporary)
      await rename(temporary, selected.filePath)
      return selected.filePath
    } catch (error) { if (temporary) await rm(temporary, { force: true }); throw error }
    finally { exporting = false }
  })
}
