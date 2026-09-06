import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { DrizzleWorkspaceRepository } from '../../src/main/repositories/drizzle-workspace-repository'
import { DrizzleConversationRepository } from '../../src/main/repositories/drizzle-conversation-repository'
import { DrizzleStudyWorkspaceRepository } from '../../src/main/repositories/drizzle-study-workspace-repository'

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

describe('Coach database migrations', () => {
  it('creates the current domain schema and migration history', () => {
    const databasePath = createDatabasePath()
    const database = openCoachDatabase({ databasePath, migrationsFolder })
    const sqlite = database.sqlite

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>

    expect(tables).toEqual([
      { name: '__drizzle_migrations' },
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
      { name: 'roadmap_modules' },
      { name: 'roadmaps' },
      { name: 'routine_notes' },
      { name: 'saved_for_later' },
      { name: 'session_memories' },
      { name: 'session_topics' },
      { name: 'student_memory' },
      { name: 'study_deadlines' },
      { name: 'study_plan_items' },
      { name: 'study_sessions' },
      { name: 'workspace_memories' },
      { name: 'workspace_projects' },
      { name: 'workspace_study_states' },
      { name: 'workspaces' },
    ])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 17 })
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
})
