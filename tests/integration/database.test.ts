import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { CURRENT_MIGRATION_COUNT, finishPendingRestore, recoverPendingRestore, rollbackPendingRestore, validateCoachDatabaseSchema } from '../../src/main/database/restore-recovery'
import { DrizzleWorkspaceRepository } from '../../src/main/repositories/drizzle-workspace-repository'
import { DrizzleConversationRepository } from '../../src/main/repositories/drizzle-conversation-repository'
import { DrizzleStudyWorkspaceRepository } from '../../src/main/repositories/drizzle-study-workspace-repository'
import { DrizzlePlannerActionRepository } from '../../src/main/repositories/drizzle-planner-action-repository'
import { DrizzleRoadmapRepository } from '../../src/main/repositories/drizzle-roadmap-repository'

const temporaryDirectories: string[] = []
const migrationsFolder = resolve('drizzle/migrations')

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'coach-database-test-'))
  temporaryDirectories.push(directory)
  return join(directory, 'coach.sqlite')
}

function migrationsThrough0028(): string {
  const directory = mkdtempSync(join(tmpdir(), 'coach-migrations-0028-'))
  temporaryDirectories.push(directory)
  cpSync(migrationsFolder, directory, { recursive: true })
  const journalPath = join(directory, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number }> }
  journal.entries = journal.entries.filter((entry) => entry.idx <= 28)
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  rmSync(join(directory, '0029_adaptive_study_pages.sql'))
  return directory
}

describe('Coach database migrations', () => {
  it('upgrades a populated 0028 database through migration 0029 without losing data', () => {
    const databasePath = createDatabasePath()
    const oldMigrations = migrationsThrough0028()
    let database = openCoachDatabase({ databasePath, migrationsFolder: oldMigrations })
    database.sqlite.prepare("INSERT INTO workspaces (id, name, objective, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run('workspace-0028', 'Sentinela 0028', 'Preservar no upgrade', 1, 1)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 29 })
    database.close()

    database = openCoachDatabase({ databasePath, migrationsFolder })
    expect(database.sqlite.prepare("SELECT name, objective FROM workspaces WHERE id = 'workspace-0028'").get()).toEqual({ name: 'Sentinela 0028', objective: 'Preservar no upgrade' })
    expect(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('study_lesson_adaptations', 'workspace_study_preferences') ORDER BY name").all()).toEqual([{ name: 'study_lesson_adaptations' }, { name: 'workspace_study_preferences' }])
    expect((database.sqlite.pragma('table_info(study_progress)') as Array<{ name: string }>).some((column) => column.name === 'checkpoint_states_json')).toBe(true)
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: CURRENT_MIGRATION_COUNT })
    expect(() => validateCoachDatabaseSchema(database.sqlite)).not.toThrow()
    database.close()
  })

  it('creates the current domain schema and migration history', () => {
    const databasePath = createDatabasePath()
    const database = openCoachDatabase({ databasePath, migrationsFolder })
    const sqlite = database.sqlite

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>

    expect(tables).toEqual([
      { name: '__drizzle_migrations' },
      { name: 'academic_availability' },
      { name: 'academic_events' },
      { name: 'conversation_messages' },
      { name: 'conversation_threads' },
      { name: 'learning_events' },
      { name: 'material_chunks' },
      { name: 'materials' },
      { name: 'planner_actions' },
      { name: 'project_builds' },
      { name: 'project_files' },
      { name: 'project_ui_states' },
      { name: 'provider_configurations' },
      { name: 'roadmap_adaptations' },
      { name: 'roadmap_modules' },
      { name: 'roadmaps' },
      { name: 'routine_notes' },
      { name: 'saved_for_later' },
      { name: 'session_memories' },
      { name: 'session_topics' },
      { name: 'student_memory' },
      { name: 'study_deadlines' },
      { name: 'study_lesson_adaptations' },
      { name: 'study_lessons' },
      { name: 'study_plan_items' },
      { name: 'study_progress' },
      { name: 'study_progress_events' },
      { name: 'study_sessions' },
      { name: 'topic_learning_states' },
      { name: 'workspace_learning_path_state' },
      { name: 'workspace_memories' },
      { name: 'workspace_projects' },
      { name: 'workspace_study_preferences' },
      { name: 'workspace_study_states' },
      { name: 'workspaces' },
    ])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: CURRENT_MIGRATION_COUNT })
    expect(() => validateCoachDatabaseSchema(sqlite)).not.toThrow()
    database.close()
  })

  it('preserves a valid restored database across interrupted recovery and finalization', () => {
    const databasePath = createDatabasePath()
    let database = openCoachDatabase({ databasePath, migrationsFolder })
    database.sqlite.prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('current', 'Atual', 'Banco anterior', 1, 1)
    database.close()

    const staging = `${databasePath}.restore-staging`
    database = openCoachDatabase({ databasePath: staging, migrationsFolder })
    database.sqlite.prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('restored', 'Restaurado', 'Banco selecionado', 2, 2)
    database.close()
    writeFileSync(`${databasePath}.restore-pending`, 'pending\n')

    recoverPendingRestore(databasePath)
    recoverPendingRestore(databasePath)
    database = openCoachDatabase({ databasePath, migrationsFolder })
    expect(database.sqlite.prepare('SELECT id FROM workspaces ORDER BY id').all()).toEqual([{ id: 'restored' }])
    expect(() => validateCoachDatabaseSchema(database.sqlite)).not.toThrow()
    database.close()

    finishPendingRestore(databasePath)
    expect(existsSync(`${databasePath}.restore-pending`)).toBe(false)
    expect(existsSync(`${databasePath}.restore-previous`)).toBe(false)
  })

  it('rolls back a restored database and removes stale WAL state after startup failure', () => {
    const databasePath = createDatabasePath()
    let database = openCoachDatabase({ databasePath, migrationsFolder })
    database.sqlite.prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('current', 'Atual', 'Banco anterior', 1, 1)
    database.close()
    renameSync(databasePath, `${databasePath}.restore-previous`)
    writeFileSync(databasePath, 'not a sqlite database')
    writeFileSync(`${databasePath}-wal`, 'stale wal')
    writeFileSync(`${databasePath}-shm`, 'stale shm')
    writeFileSync(`${databasePath}.restore-pending`, 'pending\n')

    rollbackPendingRestore(databasePath)
    expect(existsSync(`${databasePath}-wal`)).toBe(false)
    expect(existsSync(`${databasePath}-shm`)).toBe(false)
    database = openCoachDatabase({ databasePath, migrationsFolder })
    expect(database.sqlite.prepare("SELECT name FROM workspaces WHERE id = 'current'").get()).toEqual({ name: 'Atual' })
    database.close()
  })

  it('preserves workspace data when the database is reopened and migrated again', () => {
    const databasePath = createDatabasePath()
    const createdAt = Date.now()
    let database = openCoachDatabase({ databasePath, migrationsFolder })
    let sqlite = database.sqlite
    sqlite
      .prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('workspace-1', 'Estrutura de Dados', 'Preparar a próxima prova', createdAt, createdAt)
    database.close()

    expect(existsSync(databasePath)).toBe(true)
    database = openCoachDatabase({ databasePath, migrationsFolder })
    sqlite = database.sqlite

    const workspace = sqlite.prepare('SELECT id, name, objective, status FROM workspaces WHERE id = ?').get('workspace-1')
    expect(workspace).toEqual({
      id: 'workspace-1',
      name: 'Estrutura de Dados',
      objective: 'Preparar a próxima prova',
      status: 'active',
    })
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000)
    database.close()
    expect(database.sqlite.open).toBe(false)
  })

  it('retains migration location and root cause when startup initialization fails', () => {
    const databasePath = createDatabasePath()
    const missingMigrations = join(dirname(databasePath), 'missing-migrations')
    let thrown: unknown
    try { openCoachDatabase({ databasePath, migrationsFolder: missingMigrations }) } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain(databasePath)
    expect((thrown as Error).message).toContain(missingMigrations)
    expect((thrown as Error).cause).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain((thrown as Error & { cause: Error }).cause.message)
  })

  it('rejects invalid names and inconsistent archive state', () => {
    const databasePath = createDatabasePath()
    const database = openCoachDatabase({ databasePath, migrationsFolder })
    const sqlite = database.sqlite
    const insert = sqlite.prepare(
      'INSERT INTO workspaces (id, name, objective, status, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )

    expect(() => insert.run('empty', '   ', '', 'active', 1, 1, null)).toThrow()
    expect(() => insert.run('invalid-archive', 'C', '', 'archived', 1, 1, null)).toThrow()
    database.close()
  })

  it('persists workspace repository operations and excludes archived records', async () => {
    const databasePath = createDatabasePath()
    const database = openCoachDatabase({ databasePath, migrationsFolder })
    const repository = new DrizzleWorkspaceRepository(database)

    const created = await repository.create({
      id: '00000000-0000-4000-8000-000000000004',
      name: 'Estrutura de Dados',
      objective: 'Próxima prova',
      createdAt: 10,
      updatedAt: 10,
    })
    expect((await repository.listActive()).map((item) => item.id)).toEqual([created.id])
    expect((await repository.markOpened(created.id, 20))?.lastOpenedAt).toBe(20)
    expect(await repository.archive(created.id, 30)).toBe(true)
    expect(await repository.listActive()).toEqual([])
    database.close()
  })

  it('persists a planner turn atomically with stable sequence ordering', async () => {
    const databasePath = createDatabasePath()
    const database = openCoachDatabase({ databasePath, migrationsFolder })
    const repository = new DrizzleConversationRepository(database)
    const threadId = '00000000-0000-4000-8000-000000000000'
    await repository.ensureHomeThread(threadId, 10)

    await repository.addTurn({
      threadId,
      user: { id: 'message-user', threadId, role: 'user', content: 'Prova dia 16', createdAt: 11, providerId: null, modelId: null },
      assistant: { id: 'message-assistant', threadId, role: 'assistant', content: 'Qual matéria?', createdAt: 12, providerId: 'coach-local', modelId: 'planner-rules-v1' },
    })

    expect((await repository.listMessages(threadId, 100)).map((message) => [message.sequence, message.role])).toEqual([[1, 'user'], [2, 'assistant']])
    database.close()
  })

  it('creates an isolated conversation thread for a workspace', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspaces = new DrizzleWorkspaceRepository(database)
    const conversations = new DrizzleConversationRepository(database)
    const workspace = await workspaces.create({ id: '00000000-0000-4000-8000-000000000111', name: 'Cálculo', objective: 'Derivadas', createdAt: 1, updatedAt: 1 })
    const threadId = '00000000-0000-4000-8000-000000000222'

    await conversations.ensureWorkspaceThread(threadId, workspace.id, workspace.name, 2)
    const row = database.sqlite.prepare('SELECT scope, workspace_id AS workspaceId, title FROM conversation_threads WHERE id = ?').get(threadId)

    expect(row).toEqual({ scope: 'workspace', workspaceId: workspace.id, title: workspace.name })
    database.close()
  })

  it('persists the complete study workspace state', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const workspaces = new DrizzleWorkspaceRepository(database)
    const repository = new DrizzleStudyWorkspaceRepository(database)
    const workspace = await workspaces.create({ id: '00000000-0000-4000-8000-000000000311', name: 'Algoritmos', objective: 'Listas', createdAt: 1, updatedAt: 1 })
    const state = { workspaceId: workspace.id, sessionId: '00000000-0000-4000-8000-000000000312', sessionStartedAt: 2, fileName: 'main.py', language: 'python', editorContent: 'print(1)', notes: 'Nota', shareContextWithAi: true, timerDurationSeconds: 1500, timerRemainingSeconds: 1400, timerStatus: 'paused' as const, timerStartedAt: null, plan: [{ id: '00000000-0000-4000-8000-000000000313', title: 'Praticar', durationMinutes: 20, position: 1, status: 'active' as const }], updatedAt: 3, documentRevision: 1, notesRevision: 1, accumulatedFocusSeconds: 0 }
    await repository.createState(state)
    database.close()

    const reopened = openCoachDatabase({ databasePath: database.path, migrationsFolder })
    expect(await new DrizzleStudyWorkspaceRepository(reopened).findState(workspace.id, 4)).toMatchObject({ editorContent: 'print(1)', notes: 'Nota', plan: [{ title: 'Praticar' }] })
    reopened.close()
  })
  it('persists a study workspace with an empty plan', async () => { const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const workspaces = new DrizzleWorkspaceRepository(database); const repository = new DrizzleStudyWorkspaceRepository(database); const workspace = await workspaces.create({ id: crypto.randomUUID(), name: 'C', objective: 'Estudar C', createdAt: 1, updatedAt: 1 }); const state = { workspaceId: workspace.id, sessionId: crypto.randomUUID(), sessionStartedAt: 2, fileName: 'main.c', language: 'c', editorContent: '', notes: '', shareContextWithAi: false, timerDurationSeconds: 1500, timerRemainingSeconds: 1500, timerStatus: 'idle' as const, timerStartedAt: null, plan: [], updatedAt: 3, documentRevision: 0, notesRevision: 0, accumulatedFocusSeconds: 0 }; await repository.createState(state); expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM study_plan_items WHERE session_id = ?').get(state.sessionId)).toEqual({ count: 0 }); expect(await repository.findState(workspace.id, 4)).toMatchObject({ sessionId: state.sessionId, plan: [] }); database.close() })
  it('persists contextual planner actions and resolves them atomically', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    const repository = new DrizzlePlannerActionRepository(database)
    const action = repository.create({ id: crypto.randomUUID(), originMessageId: crypto.randomUUID(), label: 'Criar Workspace de C', contextVersion: 10, type: 'workspace.create', status: 'proposed', payload: { name: 'C', objective: 'Estudar C' }, result: null, createdAt: 10, resolvedAt: null }, 'action-key')
    expect(repository.listPending()[0]).toMatchObject({ id: action.id, label: 'Criar Workspace de C', contextVersion: 10 })
    expect(repository.claim(action.id, 11).status).toBe('applying')
    expect(() => repository.claim(action.id, 12)).toThrow('no longer pending')
    expect(repository.complete(action.id, 'applied', { id: 'c' }, 13)).toMatchObject({ status: 'applied', result: { id: 'c' } })
    database.close()
  })
  it('invalidates sibling decisions from the same message', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const repository = new DrizzlePlannerActionRepository(database); const messageId = crypto.randomUUID()
    const create = (label: string, key: string) => repository.create({ id: crypto.randomUUID(), originMessageId: messageId, label, contextVersion: 10, type: 'routine.add', status: 'proposed', payload: { content: label }, result: null, createdAt: 10, resolvedAt: null }, key)
    const first = create('Usar C', 'first'); const second = create('Usar ED', 'second'); repository.claim(first.id, 11); repository.complete(first.id, 'applied', { ok: true }, 12); repository.invalidateSiblings(messageId, first.id, 12)
    expect(repository.find(second.id)?.status).toBe('obsolete'); database.close()
  })
  it('stores unknown mastery as null', () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder })
    database.sqlite.prepare('INSERT INTO workspaces (id, name, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c', 'C', 'Estudar C', 1, 1)
    database.sqlite.prepare('INSERT INTO study_deadlines (id, workspace_id, title, due_at, estimated_minutes, mastery_percent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('d', 'c', 'Prova C', 2, 120, null, 1)
    expect(database.sqlite.prepare('SELECT mastery_percent AS masteryPercent FROM study_deadlines WHERE id = ?').get('d')).toEqual({ masteryPercent: null })
    database.close()
  })
  it('preserves learning path lifecycle and active roadmap after reopening SQLite', async () => {
    const database = openCoachDatabase({ databasePath: createDatabasePath(), migrationsFolder }); const workspaces = new DrizzleWorkspaceRepository(database); const workspace = await workspaces.create({ id: crypto.randomUUID(), name: 'C', objective: 'Aprender C', createdAt: 1, updatedAt: 1 }); const repository = new DrizzleRoadmapRepository(database); repository.setLearningPathState({ workspaceId: workspace.id, status: 'waiting_for_provider', activeRoadmapId: null, lastAttemptAt: 2, retryAfter: 302000, lastErrorCode: 'PROVIDER_UNAVAILABLE', updatedAt: 2 }); const path = { id: crypto.randomUUID(), workspaceId: workspace.id, title: 'Trilha C', status: 'accepted' as const, generationKind: 'ai_generated' as const, version: 1, providerId: 'test', modelId: 'test', createdAt: 3, updatedAt: 3, modules: [{ id: crypto.randomUUID(), title: 'Tipos e compilação', objective: 'Compilar', estimatedMinutes: 60, position: 1, status: 'active' as const, topics: ['gcc', 'tipos'], outcomes: ['Compilar'], practice: 'Programa C', completionCriteria: ['Sem erros'], resources: [] }, { id: crypto.randomUUID(), title: 'Ponteiros', objective: 'Usar endereços', estimatedMinutes: 90, position: 2, status: 'locked' as const, topics: ['endereços', 'arrays'], outcomes: ['Explicar ponteiros'], practice: 'Vetor', completionCriteria: ['Sem acesso inválido'], resources: [] }] }; repository.activate(path); const databasePath = database.path; database.close(); const reopened = openCoachDatabase({ databasePath, migrationsFolder }); const restored = new DrizzleRoadmapRepository(reopened); expect(restored.getLearningPathState(workspace.id)).toMatchObject({ status: 'ready', activeRoadmapId: path.id, retryAfter: null }); expect(restored.findCurrent(workspace.id)?.id).toBe(path.id); reopened.close()
  })
})
