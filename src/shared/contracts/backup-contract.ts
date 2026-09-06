export interface BackupApi {
  exportBackup(): Promise<string | null>
  restoreBackup(): Promise<boolean>
}
