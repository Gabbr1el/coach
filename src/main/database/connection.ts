import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { migrateDatabase } from './migrate'
import * as schema from './schema/workspaces'

export interface CoachDatabase {
  readonly sqlite: Database.Database
  readonly orm: BetterSQLite3Database<typeof schema>
  readonly path: string
  close(): void
}

export interface OpenCoachDatabaseOptions {
  readonly databasePath?: string
  readonly migrationsFolder?: string
}

export function openCoachDatabase(options: OpenCoachDatabaseOptions = {}): CoachDatabase {
  const databasePath = options.databasePath ?? join(app.getPath('userData'), 'coach.sqlite')
  const migrationsFolder = options.migrationsFolder ?? join(app.getAppPath(), 'drizzle/migrations')
  mkdirSync(dirname(databasePath), { recursive: true })

  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = NORMAL')
    sqlite.pragma('busy_timeout = 5000')

    const orm = drizzle(sqlite, { schema })
    migrateDatabase(orm, { migrationsFolder })

    return {
      sqlite,
      orm,
      path: databasePath,
      close: () => {
        if (sqlite.open) sqlite.close()
      },
    }
  } catch (error) {
    if (sqlite.open) sqlite.close()
    const message = error instanceof Error ? error.message : 'Unknown database initialization error'
    throw new Error(`Could not initialize Coach database: ${message}`, { cause: error })
  }
}
