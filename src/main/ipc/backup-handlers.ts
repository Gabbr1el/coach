import { app, dialog, ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { chmod, open, rename, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { CoachDatabase } from '../database/connection'
import { openCoachDatabase } from '../database/connection'
import { validateCoachDatabaseSchema } from '../database/restore-recovery'
import { migrationCount } from '../database/migrate'
import { BACKUP_CHANNELS } from '../../shared/contracts/backup-channels'
import { assertTrustedSender } from './trusted-sender'

export function registerBackupHandlers(database: CoachDatabase): void {
  let exporting = false
  let restoring = false
  ipcMain.handle(BACKUP_CHANNELS.exportBackup, async (event) => {
    assertTrustedSender(event)
    if (exporting || restoring) throw new Error('A backup operation is already running')
    exporting = true
    const date = new Date().toISOString().slice(0, 10)
    let temporary: string | null = null
    try {
      const selected = await dialog.showSaveDialog({ defaultPath: `coach-backup-${date}.sqlite`, filters: [{ name: 'Coach Backup', extensions: ['sqlite'] }], properties: ['showOverwriteConfirmation'] })
      if (selected.canceled || !selected.filePath) return null
      if (resolve(selected.filePath) === resolve(database.path) || (() => { try { return realpathSync(selected.filePath!) === realpathSync(database.path) } catch { return false } })()) throw new Error('Backup destination cannot be the active database')
      temporary = resolve(dirname(selected.filePath), `.coach-backup-${crypto.randomUUID()}.partial`)
      await database.sqlite.backup(temporary)
      await chmod(temporary, 0o600)
      await rename(temporary, selected.filePath)
      return selected.filePath
    } catch (error) { if (temporary) await rm(temporary, { force: true }); throw error }
    finally { exporting = false }
  })

  ipcMain.handle(BACKUP_CHANNELS.restoreBackup, async (event) => {
    assertTrustedSender(event)
    if (restoring || exporting) throw new Error('A backup operation is already running')
    restoring = true
    const staging = `${database.path}.restore-staging`
    const previous = `${database.path}.restore-previous`
    const marker = `${database.path}.restore-pending`
    let source: Database.Database | null = null
    try {
      const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Coach Backup', extensions: ['sqlite'] }] })
      if (selected.canceled || !selected.filePaths[0]) { restoring = false; return false }
      source = new Database(selected.filePaths[0], { readonly: true, fileMustExist: true })
      const integrity = source.pragma('quick_check') as Array<{ quick_check: string }>
      if (integrity.length !== 1 || integrity[0]?.quick_check !== 'ok') throw new Error('Backup integrity check failed')
      const tables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
      const required = new Set(['__drizzle_migrations', 'workspaces', 'conversation_threads', 'conversation_messages'])
      for (const table of tables) required.delete(table.name)
      if (required.size) throw new Error('The selected file is not a valid Coach backup')
      await rm(staging, { force: true })
      await source.backup(staging)
      source.close()
      source = null
      const migrationsFolder = resolve(app.getAppPath(), 'drizzle/migrations')
      const validation = openCoachDatabase({ databasePath: staging, migrationsFolder })
      try { validateCoachDatabaseSchema(validation.sqlite, migrationCount(migrationsFolder)) } finally { validation.close() }
      await rm(previous, { force: true })
      const markerHandle = await open(marker, 'wx', 0o600)
      try { await markerHandle.writeFile('pending\n'); await markerHandle.sync() } finally { await markerHandle.close() }
      const directoryHandle = await open(dirname(database.path), 'r')
      try { await directoryHandle.sync() } finally { await directoryHandle.close() }
      database.sqlite.pragma('wal_checkpoint(TRUNCATE)')
      database.close()
      app.relaunch()
      app.exit(0)
      return true
    } catch (error) {
      if (source?.open) source.close()
      let markerExists = false
      try { const handle = await open(marker, 'r'); await handle.close(); markerExists = true } catch {}
      if (!markerExists) await rm(staging, { force: true })
      restoring = false
      throw error
    }
  })
}
