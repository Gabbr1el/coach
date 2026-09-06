import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openCoachDatabase } from '../../src/main/database/connection'
import { DrizzleWorkspaceRepository } from '../../src/main/repositories/drizzle-workspace-repository'
import { DrizzleConversationRepository } from '../../src/main/repositories/drizzle-conversation-repository'

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
      { name: 'provider_configurations' },
      { name: 'workspaces' },
    ])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 3 })
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
})
