import { readMigrationFiles, type MigrationConfig } from 'drizzle-orm/migrator'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type Database from 'better-sqlite3'

export function repairDraftAdaptiveStudyMigration(sqlite: Database.Database): void {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'study_lesson_adaptations'").get()
  if (!table) return
  const columns = new Set((sqlite.pragma('table_info(study_lesson_adaptations)') as Array<{ name: string }>).map((column) => column.name))
  if (columns.has('source_block_id')) return
  const requiredLegacy = ['id', 'workspace_id', 'lesson_id', 'block_id', 'instruction', 'adapted_block_json', 'provider_id', 'model_id', 'created_at', 'restored_at']
  if (requiredLegacy.some((column) => !columns.has(column))) throw new Error('Unsupported draft adaptive study schema')
  sqlite.transaction(() => {
    sqlite.exec(`
      ALTER TABLE study_lesson_adaptations RENAME TO study_lesson_adaptations_draft;
      CREATE TABLE study_lesson_adaptations (
        id text PRIMARY KEY NOT NULL,
        workspace_id text NOT NULL,
        lesson_id text NOT NULL,
        source_block_id text NOT NULL,
        revision integer NOT NULL,
        reason text NOT NULL,
        mode text NOT NULL,
        adapted_block_json text NOT NULL,
        is_active integer DEFAULT false NOT NULL,
        provider_id text,
        model_id text,
        created_at integer NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE no action ON DELETE cascade,
        FOREIGN KEY (lesson_id) REFERENCES study_lessons(id) ON UPDATE no action ON DELETE cascade
      );
    `)
    const rows = sqlite.prepare('SELECT id, workspace_id AS workspaceId, lesson_id AS lessonId, block_id AS blockId, instruction, adapted_block_json AS adaptedBlockJson, provider_id AS providerId, model_id AS modelId, created_at AS createdAt, restored_at AS restoredAt FROM study_lesson_adaptations_draft ORDER BY lesson_id, block_id, created_at, rowid').all() as Array<{ id: string; workspaceId: string; lessonId: string; blockId: string; instruction: string; adaptedBlockJson: string; providerId: string | null; modelId: string | null; createdAt: number; restoredAt: number | null }>
    const latestActive = new Map<string, string>()
    for (const row of rows) if (row.restoredAt === null) latestActive.set(`${row.lessonId}:${row.blockId}`, row.id)
    const revisions = new Map<string, number>()
    const insert = sqlite.prepare('INSERT INTO study_lesson_adaptations (id, workspace_id, lesson_id, source_block_id, revision, reason, mode, adapted_block_json, is_active, provider_id, model_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const row of rows) { const key = `${row.lessonId}:${row.blockId}`; const revision = (revisions.get(key) ?? 0) + 1; revisions.set(key, revision); insert.run(row.id, row.workspaceId, row.lessonId, row.blockId, revision, row.instruction, 'CUSTOM', row.adaptedBlockJson, latestActive.get(key) === row.id ? 1 : 0, row.providerId, row.modelId, row.createdAt) }
    sqlite.exec(`
      DROP TABLE study_lesson_adaptations_draft;
      CREATE INDEX study_lesson_adaptations_lesson_block_idx ON study_lesson_adaptations (lesson_id, source_block_id, created_at);
      CREATE UNIQUE INDEX study_lesson_adaptations_revision_unique ON study_lesson_adaptations (lesson_id, source_block_id, revision);
      CREATE UNIQUE INDEX study_lesson_adaptations_one_active ON study_lesson_adaptations (lesson_id, source_block_id) WHERE is_active = 1;
    `)
  })()
}

export function migrateDatabase<TSchema extends Record<string, unknown>>(
  database: BetterSQLite3Database<TSchema>,
  config: MigrationConfig,
): void {
  readMigrationFiles(config)
  migrate(database, config)
}
