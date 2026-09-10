import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { migrateDatabase, repairDraftAdaptiveStudyMigration, repairExerciseSchema, repairInteractiveCodeStateSchema } from './migrate'
import { repairLegacyExerciseData } from './exercise-data-repair'
import * as workspaceSchema from './schema/workspaces'
import * as conversationSchema from './schema/conversations'
import * as providerSchema from './schema/provider-configurations'
import * as studyWorkspaceSchema from './schema/study-workspaces'
import * as learningEventSchema from './schema/learning-events'
import * as planningSchema from './schema/planning'
import * as materialSchema from './schema/materials'
import * as memorySchema from './schema/study-memory'
import * as navigationSchema from './schema/session-navigation'
import * as projectSchema from './schema/projects'
import * as roadmapSchema from './schema/roadmaps'
import * as plannerActionSchema from './schema/planner-actions'
import * as studyProgressSchema from './schema/study-progress'
import * as studyLessonSchema from './schema/study-lessons'
import * as academicSubjectContextSchema from './schema/academic-subject-contexts'
import * as exerciseSchema from './schema/exercises'
import * as workspaceProvisioningSchema from './schema/workspace-provisioning'
import * as academicLifeSchema from './schema/academic-life'

const schema = { ...workspaceSchema, ...conversationSchema, ...providerSchema, ...studyWorkspaceSchema, ...learningEventSchema, ...planningSchema, ...materialSchema, ...memorySchema, ...navigationSchema, ...projectSchema, ...roadmapSchema, ...plannerActionSchema, ...studyProgressSchema, ...studyLessonSchema, ...academicSubjectContextSchema, ...exerciseSchema, ...workspaceProvisioningSchema, ...academicLifeSchema }

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
    repairDraftAdaptiveStudyMigration(sqlite)
    repairInteractiveCodeStateSchema(sqlite)
    repairExerciseSchema(sqlite)
    repairLegacyExerciseData(sqlite)

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
    const detail = error instanceof Error
      ? error.stack ?? `${error.name}: ${error.message}`
      : String(error)
    throw new Error(`Could not initialize Coach database at ${databasePath} using migrations from ${migrationsFolder}: ${detail}`, { cause: error })
  }
}
