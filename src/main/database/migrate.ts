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

export function repairInteractiveCodeStateSchema(sqlite: Database.Database): void {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'study_interactive_code_states'").get()
  if (!table) return
  const columns = new Set((sqlite.pragma('table_info(study_interactive_code_states)') as Array<{ name: string }>).map((column) => column.name))
  if (!columns.has('evidence_granted_at')) sqlite.exec('ALTER TABLE study_interactive_code_states ADD COLUMN evidence_granted_at integer')
}

const exerciseTables = {
  exercise_sets: {
    columns: [
      ['id', "''"], ['workspace_id', "''"], ['roadmap_id', "''"], ['module_id', "''"], ['topic_id', "''"], ['lesson_id', "''"],
      ['status', "'failed_retryable'"], ['provider_id', 'NULL'], ['model_id', 'NULL'], ['generation_attempts', '0'], ['retry_after', 'NULL'],
      ['last_error_code', 'NULL'], ['created_at', '0'], ['updated_at', '0'],
    ],
    create: `CREATE TABLE __coach_repair_exercise_sets (
      id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, roadmap_id text NOT NULL, module_id text NOT NULL,
      topic_id text NOT NULL, lesson_id text NOT NULL, status text NOT NULL, provider_id text, model_id text,
      generation_attempts integer DEFAULT 0 NOT NULL, retry_after integer, last_error_code text, created_at integer NOT NULL,
      updated_at integer NOT NULL, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE no action ON DELETE cascade,
      CONSTRAINT exercise_sets_status_check CHECK(status in ('generating','ready','waiting_for_provider','failed_retryable'))
    )`,
  },
  exercises: {
    columns: [
      ['id', "''"], ['set_id', "''"], ['position', 'rowid'], ['kind', "'PROGRAMMING_PROBLEM'"], ['difficulty', "'introductory'"],
      ['title', "''"], ['statement', "''"], ['input_description', "''"], ['output_description', "''"], ['language', "'python'"],
      ['starter_code', "''"], ['prediction_prompt', 'NULL'], ['code_to_observe', 'NULL'], ['required_for_topic_completion', '0'],
      ['public_tests_json', "'[]'"], ['private_tests_json', "'[]'"], ['reference_solution', 'NULL'], ['expected_prediction', 'NULL'],
      ['hint', "''"], ['created_at', '0'],
    ],
    create: `CREATE TABLE __coach_repair_exercises (
      id text PRIMARY KEY NOT NULL, set_id text NOT NULL, position integer NOT NULL, kind text NOT NULL, difficulty text NOT NULL,
      title text NOT NULL, statement text NOT NULL, input_description text NOT NULL, output_description text NOT NULL,
      language text NOT NULL, starter_code text NOT NULL, prediction_prompt text, code_to_observe text,
      required_for_topic_completion integer DEFAULT false NOT NULL, public_tests_json text NOT NULL, private_tests_json text NOT NULL,
      reference_solution text, expected_prediction text, hint text NOT NULL, created_at integer NOT NULL,
      FOREIGN KEY (set_id) REFERENCES exercise_sets(id) ON UPDATE no action ON DELETE cascade,
      CONSTRAINT exercises_kind_check CHECK(kind in ('PROGRAMMING_PROBLEM','FIX_CODE','COMPLETE_CODE','PREDICT_OUTPUT')),
      CONSTRAINT exercises_difficulty_check CHECK(difficulty in ('introductory','standard','challenge'))
    )`,
  },
  exercise_progress: {
    columns: [
      ['workspace_id', "''"], ['exercise_id', "''"], ['status', "'not_started'"], ['current_code', "''"], ['attempts', '0'],
      ['last_run_json', 'NULL'], ['last_submission_json', 'NULL'], ['passed_tests', '0'], ['total_tests', '0'], ['help_used', '0'],
      ['first_try_success', '0'], ['help_count', '0'], ['passed_at', 'NULL'], ['updated_at', '0'],
    ],
    create: `CREATE TABLE __coach_repair_exercise_progress (
      workspace_id text NOT NULL, exercise_id text NOT NULL, status text DEFAULT 'not_started' NOT NULL, current_code text NOT NULL,
      attempts integer DEFAULT 0 NOT NULL, last_run_json text, last_submission_json text, passed_tests integer DEFAULT 0 NOT NULL,
      total_tests integer DEFAULT 0 NOT NULL, help_used integer DEFAULT false NOT NULL, first_try_success integer DEFAULT false NOT NULL,
      help_count integer DEFAULT 0 NOT NULL, passed_at integer, updated_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON UPDATE no action ON DELETE cascade,
      CONSTRAINT exercise_progress_status_check CHECK(status in ('not_started','in_progress','passed'))
    )`,
  },
  exercise_attempts: {
    columns: [
      ['id', "''"], ['workspace_id', "''"], ['exercise_id', "''"], ['idempotency_key', "''"], ['source_revision', "'legacy'"],
      ['code', "''"], ['prediction', 'NULL'], ['status', "'failed'"], ['public_result_json', "'{}'"], ['private_result_json', "'{}'"],
      ['duration_ms', '0'], ['created_at', '0'],
    ],
    create: `CREATE TABLE __coach_repair_exercise_attempts (
      id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, exercise_id text NOT NULL, idempotency_key text NOT NULL,
      source_revision text NOT NULL, code text NOT NULL, prediction text, status text NOT NULL, public_result_json text NOT NULL,
      private_result_json text NOT NULL, duration_ms integer NOT NULL, created_at integer NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE no action ON DELETE cascade,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON UPDATE no action ON DELETE cascade
    )`,
  },
} as const

const exerciseIndexes = [
  'CREATE UNIQUE INDEX IF NOT EXISTS exercise_sets_workspace_topic_unique ON exercise_sets (workspace_id, topic_id)',
  'CREATE INDEX IF NOT EXISTS exercise_sets_status_retry_idx ON exercise_sets (status, retry_after)',
  'CREATE UNIQUE INDEX IF NOT EXISTS exercises_set_position_unique ON exercises (set_id, position)',
  'CREATE INDEX IF NOT EXISTS exercises_set_idx ON exercises (set_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS exercise_progress_workspace_exercise_unique ON exercise_progress (workspace_id, exercise_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS exercise_attempts_workspace_key_unique ON exercise_attempts (workspace_id, idempotency_key)',
  'CREATE INDEX IF NOT EXISTS exercise_attempts_exercise_created_idx ON exercise_attempts (exercise_id, created_at)',
]

export function repairExerciseSchema(sqlite: Database.Database): void {
  const exerciseMigration = sqlite.prepare('SELECT 1 FROM __drizzle_migrations WHERE created_at >= ? LIMIT 1').get(1788982835766)
  if (!exerciseMigration) return
  const schemas = Object.entries(exerciseTables)
  const needsRebuild = schemas.some(([table, definition]) => {
    const columns = sqlite.pragma(`table_info(${table})`) as Array<{ name: string; notnull: number }>
    if (columns.length === 0) return true
    const names = new Set(columns.map((column) => column.name))
    if (definition.columns.some(([column]) => !names.has(column))) return true
    return table === 'exercises' && columns.find((column) => column.name === 'reference_solution')?.notnull === 1
  })

  if (!needsRebuild) {
    sqlite.exec(exerciseIndexes.join(';'))
    return
  }

  const foreignKeysEnabled = sqlite.pragma('foreign_keys', { simple: true }) === 1
  if (foreignKeysEnabled) sqlite.pragma('foreign_keys = OFF')
  try {
    sqlite.transaction(() => {
      for (const [table, definition] of schemas) {
        sqlite.exec(`DROP TABLE IF EXISTS __coach_repair_${table}; ${definition.create}`)
        const existing = new Set((sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name))
        if (existing.size === 0) continue
        const keyColumns = table === 'exercise_sets' ? ['id', 'workspace_id'] : table === 'exercises' ? ['id', 'set_id'] : table === 'exercise_progress' ? ['workspace_id', 'exercise_id'] : ['id', 'workspace_id', 'exercise_id', 'idempotency_key']
        if (keyColumns.some((column) => !existing.has(column))) throw new Error(`Unsupported partial ${table} schema`)
        const columns = definition.columns.map(([column]) => column)
        const values = definition.columns.map(([column, fallback]) => existing.has(column) ? column : fallback)
        const parentFilter = table === 'exercise_sets'
          ? ' WHERE workspace_id IN (SELECT id FROM workspaces)'
          : table === 'exercises'
            ? ' WHERE set_id IN (SELECT id FROM __coach_repair_exercise_sets)'
            : ` WHERE workspace_id IN (SELECT id FROM workspaces) AND exercise_id IN (SELECT id FROM __coach_repair_exercises)`
        sqlite.exec(`INSERT INTO __coach_repair_${table} (${columns.join(',')}) SELECT ${values.join(',')} FROM ${table}${parentFilter}`)
      }
      for (const table of ['exercise_attempts', 'exercise_progress', 'exercises', 'exercise_sets']) sqlite.exec(`DROP TABLE IF EXISTS ${table}`)
      for (const [table] of schemas) sqlite.exec(`ALTER TABLE __coach_repair_${table} RENAME TO ${table}`)
      sqlite.exec(exerciseIndexes.join(';'))
      const foreignKeyErrors = sqlite.pragma('foreign_key_check') as unknown[]
      if (foreignKeyErrors.length) throw new Error('Exercise schema repair found invalid relationships')
    })()
  } finally {
    if (foreignKeysEnabled) sqlite.pragma('foreign_keys = ON')
  }
}

export function migrateDatabase<TSchema extends Record<string, unknown>>(
  database: BetterSQLite3Database<TSchema>,
  config: MigrationConfig,
): void {
  readMigrationFiles(config)
  migrate(database, config)
}

export function migrationCount(migrationsFolder: string): number {
  return readMigrationFiles({ migrationsFolder }).length
}
