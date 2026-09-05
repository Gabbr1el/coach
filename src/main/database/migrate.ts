import { readMigrationFiles, type MigrationConfig } from 'drizzle-orm/migrator'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export function migrateDatabase<TSchema extends Record<string, unknown>>(
  database: BetterSQLite3Database<TSchema>,
  config: MigrationConfig,
): void {
  readMigrationFiles(config)
  migrate(database, config)
}
