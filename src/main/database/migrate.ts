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
      ['content_revision', '1'], ['input_hash', "'legacy-unavailable'"],
      ['status', "'failed_retryable'"], ['provider_id', 'NULL'], ['model_id', 'NULL'], ['generation_attempts', '0'], ['retry_after', 'NULL'],
      ['last_error_code', 'NULL'], ['created_at', '0'], ['updated_at', '0'],
    ],
    create: `CREATE TABLE __coach_repair_exercise_sets (
      id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, roadmap_id text NOT NULL, module_id text NOT NULL,
      topic_id text NOT NULL, lesson_id text NOT NULL, content_revision integer DEFAULT 1 NOT NULL,
      input_hash text DEFAULT 'legacy-unavailable' NOT NULL, status text NOT NULL, provider_id text, model_id text,
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

const evidenceIndexes = [
  'CREATE UNIQUE INDEX IF NOT EXISTS assessment_variants_source_unique ON assessment_variants (workspace_id, intent_id, environment, source_ref, source_revision)',
  'CREATE UNIQUE INDEX IF NOT EXISTS learning_attempts_workspace_environment_key_unique ON learning_attempts (workspace_id, environment, idempotency_key)',
  'CREATE INDEX IF NOT EXISTS learning_attempts_concept_time_idx ON learning_attempts (concept_id, occurred_at, id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS concept_memories_workspace_concept_unique ON concept_memories (workspace_id, concept_id)',
  'CREATE INDEX IF NOT EXISTS concept_memories_next_review_idx ON concept_memories (workspace_id, next_review_at)',
  'CREATE INDEX IF NOT EXISTS exercise_help_events_exercise_created_idx ON exercise_help_events (workspace_id, exercise_id, created_at)',
] as const

function tableColumns(sqlite: Database.Database, table: string): Set<string> {
  return new Set((sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name))
}

export function preflightPublishedReviewMigration(sqlite: Database.Database): void {
  const migrationTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'").get()
  if (!migrationTable) return
  const latest = sqlite.prepare('SELECT MAX(created_at) AS createdAt FROM __drizzle_migrations').get() as { createdAt: number | null }
  if (latest.createdAt === null || latest.createdAt < 1789160400000 || latest.createdAt >= 1789164000000) return
  const columns = tableColumns(sqlite, 'assessment_variants')
  const duplicateColumns = ['public_payload_json', 'evaluator_json'].filter((column) => columns.has(column))
  if (!duplicateColumns.length) return
  const reviewTables = ['review_sessions', 'review_items', 'review_help_events'].filter((table) => tableColumns(sqlite, table).size > 0)
  if (reviewTables.length) throw new Error(`Unsupported partial 0050 schema; review tables already exist: ${reviewTables.join(', ')}`)
  requireLegacyColumns('assessment_variants before 0050', columns, ['id', 'workspace_id', 'intent_id', 'environment', 'source_ref', 'source_revision', 'difficulty', 'prerequisite_concept_ids_json', 'public_metadata_json', 'created_at', 'updated_at'])
  // One known pre-0050 build added these columns without journaling 0050. Remove only that drift so the published migration can run unchanged.
  sqlite.transaction(() => { for (const column of [...duplicateColumns].reverse()) sqlite.exec(`ALTER TABLE assessment_variants DROP COLUMN ${column}`) })()
}

function requireLegacyColumns(table: string, existing: Set<string>, required: string[]): void {
  const missing = required.filter((column) => !existing.has(column))
  if (missing.length) throw new Error(`Unsupported published ${table} schema; missing ${missing.join(', ')}`)
}

function source(existing: Set<string>, column: string, fallback: string, qualifier = ''): string {
  return existing.has(column) ? `${qualifier}${column}` : fallback
}

function normalizedSql(sqlite: Database.Database, type: 'table' | 'index', name: string): string {
  const row = sqlite.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get(type, name) as { sql: string | null } | undefined
  return (row?.sql ?? '').toLowerCase().replaceAll('`', '').replace(/\s+/g, '')
}

export function repairPublishedEvidenceSchema(sqlite: Database.Database): void {
  const migration = sqlite.prepare('SELECT 1 FROM __drizzle_migrations WHERE created_at >= ? LIMIT 1').get(1789160400000)
  if (!migration) return

  const variants = tableColumns(sqlite, 'assessment_variants')
  const attempts = tableColumns(sqlite, 'learning_attempts')
  const currentVariants = ['id', 'workspace_id', 'intent_id', 'environment', 'source_ref', 'source_revision', 'difficulty', 'prerequisite_concept_ids_json', 'public_metadata_json', 'public_payload_json', 'evaluator_json', 'created_at', 'updated_at']
  const currentAttempts = ['id', 'workspace_id', 'concept_id', 'assessment_intent_id', 'assessment_variant_id', 'environment', 'source_ref', 'source_revision', 'first_seen_at', 'idempotency_key', 'payload_hash', 'outcome', 'correct', 'independent', 'reasoning_quality', 'occurred_at', 'created_at']
  const attemptsSql = (sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='learning_attempts'").get() as { sql: string } | undefined)?.sql ?? ''
  const needsVariantRebuild = currentVariants.some((column) => !variants.has(column))
  const needsAttemptRebuild = currentAttempts.some((column) => !attempts.has(column)) || !attemptsSql.includes("'review'")
  const singularMemory = tableColumns(sqlite, 'concept_memory')
  const memories = tableColumns(sqlite, 'concept_memories')
  const needsMemoryRebuild = memories.size > 0 && ['workspace_id', 'concept_id', 'performance', 'evidence_quantity', 'independence', 'diversity', 'recency', 'retention', 'confidence', 'successful_retrievals', 'independent_successes', 'error_count', 'help_events', 'environment_count', 'interval_days', 'last_evidence_at', 'next_review_at', 'updated_at'].some((column) => !memories.has(column))
  const variantIndexCurrent = normalizedSql(sqlite, 'index', 'assessment_variants_source_unique').includes('(workspace_id,intent_id,environment,source_ref,source_revision)')
  const reviewIndexCurrent = !tableColumns(sqlite, 'review_sessions').size || normalizedSql(sqlite, 'index', 'review_sessions_one_current_workspace').includes("statusin('active','preparation')")
  const foreignKeysEnabled = sqlite.pragma('foreign_keys', { simple: true }) === 1
  if (foreignKeysEnabled) sqlite.pragma('foreign_keys = OFF')
  try {
    sqlite.transaction(() => {
      if (needsVariantRebuild) {
        requireLegacyColumns('assessment_variants', variants, ['id', 'intent_id', 'environment', 'source_ref', 'source_revision', 'difficulty', 'created_at', 'updated_at'])
        if (!variants.has('workspace_id')) {
          const unresolved = sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_variants v LEFT JOIN assessment_intents i ON i.id=v.intent_id WHERE i.id IS NULL').get() as { count: number }
          if (unresolved.count) throw new Error('Published assessment_variants repair cannot derive workspace_id')
        }
        sqlite.exec(`
          DROP TABLE IF EXISTS __coach_repair_assessment_variants;
          CREATE TABLE __coach_repair_assessment_variants (
            id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, intent_id text NOT NULL, environment text NOT NULL,
            source_ref text NOT NULL, source_revision text NOT NULL, difficulty text NOT NULL,
            prerequisite_concept_ids_json text DEFAULT '[]' NOT NULL, public_metadata_json text DEFAULT '{}' NOT NULL,
            public_payload_json text DEFAULT '{}' NOT NULL, evaluator_json text DEFAULT '{}' NOT NULL,
            created_at integer NOT NULL, updated_at integer NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE no action ON DELETE cascade,
            FOREIGN KEY (intent_id) REFERENCES assessment_intents(id) ON UPDATE no action ON DELETE cascade,
            CONSTRAINT assessment_variants_difficulty_check CHECK(difficulty in ('introductory','standard','challenge'))
          );
          INSERT INTO __coach_repair_assessment_variants
            (id,workspace_id,intent_id,environment,source_ref,source_revision,difficulty,prerequisite_concept_ids_json,public_metadata_json,public_payload_json,evaluator_json,created_at,updated_at)
          SELECT v.id,${variants.has('workspace_id') ? 'v.workspace_id' : 'i.workspace_id'},v.intent_id,v.environment,v.source_ref,v.source_revision,v.difficulty,
            ${source(variants, 'prerequisite_concept_ids_json', "'[]'", 'v.')},${source(variants, 'public_metadata_json', "'{}'", 'v.')},
            ${source(variants, 'public_payload_json', "'{}'", 'v.')},${source(variants, 'evaluator_json', "'{}'", 'v.')},v.created_at,v.updated_at
          FROM assessment_variants v JOIN assessment_intents i ON i.id=v.intent_id;
          DROP TABLE assessment_variants;
          ALTER TABLE __coach_repair_assessment_variants RENAME TO assessment_variants;
        `)
      }

      if (needsAttemptRebuild) {
        requireLegacyColumns('learning_attempts', attempts, ['id', 'workspace_id', 'environment', 'source_ref', 'source_revision', 'idempotency_key', 'outcome', 'independent', 'reasoning_quality', 'occurred_at', 'created_at'])
        sqlite.exec(`
          DROP TABLE IF EXISTS __coach_repair_learning_attempts;
          CREATE TABLE __coach_repair_learning_attempts (
            id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, concept_id text, assessment_intent_id text,
            assessment_variant_id text, environment text NOT NULL, source_ref text NOT NULL, source_revision text NOT NULL,
            first_seen_at integer, idempotency_key text NOT NULL, payload_hash text NOT NULL, outcome text NOT NULL,
            correct integer, independent integer NOT NULL, reasoning_quality text NOT NULL, occurred_at integer NOT NULL, created_at integer NOT NULL,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE no action ON DELETE cascade,
            FOREIGN KEY (concept_id) REFERENCES concepts(id) ON UPDATE no action ON DELETE set null,
            FOREIGN KEY (assessment_intent_id) REFERENCES assessment_intents(id) ON UPDATE no action ON DELETE set null,
            FOREIGN KEY (assessment_variant_id) REFERENCES assessment_variants(id) ON UPDATE no action ON DELETE set null,
            CONSTRAINT learning_attempts_environment_check CHECK(environment in ('checkpoint','exercise','study_interactive','practice','review'))
          );
          INSERT INTO __coach_repair_learning_attempts
            (id,workspace_id,concept_id,assessment_intent_id,assessment_variant_id,environment,source_ref,source_revision,first_seen_at,idempotency_key,payload_hash,outcome,correct,independent,reasoning_quality,occurred_at,created_at)
          SELECT id,workspace_id,${source(attempts, 'concept_id', 'NULL')},${source(attempts, 'assessment_intent_id', 'NULL')},
            ${source(attempts, 'assessment_variant_id', 'NULL')},environment,source_ref,source_revision,${source(attempts, 'first_seen_at', 'NULL')},idempotency_key,
            ${source(attempts, 'payload_hash', "'legacy-unavailable:' || id")},outcome,${source(attempts, 'correct', 'NULL')},independent,reasoning_quality,occurred_at,created_at
          FROM learning_attempts;
          DROP TABLE learning_attempts;
          ALTER TABLE __coach_repair_learning_attempts RENAME TO learning_attempts;
        `)
      }

      if (needsMemoryRebuild) sqlite.exec('ALTER TABLE concept_memories RENAME TO concept_memories_published_legacy')
      if (memories.size === 0 || needsMemoryRebuild) sqlite.exec(`CREATE TABLE concept_memories (
        workspace_id text NOT NULL, concept_id text NOT NULL, performance text NOT NULL, evidence_quantity text NOT NULL,
        independence text NOT NULL, diversity text NOT NULL, recency text NOT NULL, retention text NOT NULL, confidence text NOT NULL,
        successful_retrievals integer DEFAULT 0 NOT NULL, independent_successes integer DEFAULT 0 NOT NULL,
        error_count integer DEFAULT 0 NOT NULL, help_events integer DEFAULT 0 NOT NULL, environment_count integer DEFAULT 0 NOT NULL,
        interval_days integer DEFAULT 1 NOT NULL, last_evidence_at integer, next_review_at integer, updated_at integer NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE no action ON DELETE cascade,
        FOREIGN KEY (concept_id) REFERENCES concepts(id) ON UPDATE no action ON DELETE cascade
      )`)
      const memorySource = needsMemoryRebuild ? { name: 'concept_memories_published_legacy', columns: memories } : singularMemory.size > 0 && memories.size === 0 ? { name: 'concept_memory', columns: singularMemory } : null
      if (memorySource) {
        requireLegacyColumns(memorySource.name, memorySource.columns, ['workspace_id', 'concept_id'])
        const c = memorySource.columns
        sqlite.exec(`INSERT OR IGNORE INTO concept_memories
          (workspace_id,concept_id,performance,evidence_quantity,independence,diversity,recency,retention,confidence,successful_retrievals,independent_successes,error_count,help_events,environment_count,interval_days,last_evidence_at,next_review_at,updated_at)
          SELECT workspace_id,concept_id,${source(c, 'performance', "'unknown'")},${source(c, 'evidence_quantity', "'none'")},${source(c, 'independence', "'unknown'")},
            ${source(c, 'diversity', "'single_context'")},${source(c, 'recency', "'unknown'")},${source(c, 'retention', "'unknown'")},${source(c, 'confidence', "'low'")},
            ${source(c, 'successful_retrievals', '0')},${source(c, 'independent_successes', '0')},${source(c, 'error_count', '0')},${source(c, 'help_events', '0')},
            ${source(c, 'environment_count', '0')},${source(c, 'interval_days', '1')},${source(c, 'last_evidence_at', 'NULL')},${source(c, 'next_review_at', 'NULL')},${source(c, 'updated_at', '0')}
          FROM ${memorySource.name}`)
        sqlite.exec(`DROP TABLE ${memorySource.name}`)
      }

      sqlite.exec(`CREATE TABLE IF NOT EXISTS exercise_help_events (
        request_id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, exercise_id text NOT NULL, type text NOT NULL, created_at integer NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE no action ON DELETE cascade,
        FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON UPDATE no action ON DELETE cascade,
        CONSTRAINT exercise_help_events_type_check CHECK(type in ('hint_requested','coach_help_requested','worked_example_shown','solution_revealed'))
      )`)
      if (!variantIndexCurrent || needsVariantRebuild) sqlite.exec('DROP INDEX IF EXISTS assessment_variants_source_unique')
      if (!reviewIndexCurrent) sqlite.exec('DROP INDEX IF EXISTS review_sessions_one_current_workspace')
      sqlite.exec(evidenceIndexes.join(';'))
      if (!reviewIndexCurrent) sqlite.exec("CREATE UNIQUE INDEX review_sessions_one_current_workspace ON review_sessions (workspace_id) WHERE status in ('active','preparation')")
      const foreignKeyErrors = sqlite.pragma('foreign_key_check') as unknown[]
      if (foreignKeyErrors.length) throw new Error('Published evidence schema repair found invalid relationships')
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
