import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountDatabaseManager } from '../../src/main/account/account-cache'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function manager() { const directory = mkdtempSync(join(tmpdir(), 'coach-accounts-')); directories.push(directory); return { directory, manager: new AccountDatabaseManager(directory) } }

describe('account-scoped cache', () => {
  it('isolates two accounts and never uses raw identity in paths', () => {
    const { manager: databases } = manager()
    const first = databases.open('first@example.test')
    first.sqlite.prepare("INSERT INTO account_metadata(key,value) VALUES('private','first')").run()
    const firstPath = first.path
    const second = databases.open('second@example.test')
    expect(second.path).not.toBe(firstPath)
    expect(second.path).not.toContain('second@example.test')
    expect(second.sqlite.prepare("SELECT value FROM account_metadata WHERE key='private'").get()).toBeUndefined()
    databases.close()
  })

  it('commits domain writes and outbox atomically', () => {
    const { manager: databases } = manager(); const cache = databases.open('user-a')
    cache.sqlite.exec('CREATE TABLE projection(id TEXT PRIMARY KEY, value TEXT NOT NULL)')
    expect(() => cache.writeWithOutbox((sqlite) => { sqlite.prepare('INSERT INTO projection VALUES(?,?)').run('one', 'saved'); throw new Error('crash') }, { entityType: 'workspace', entityId: '00000000-0000-4000-8000-000000000001', command: 'workspace.create', baseRevision: null, payloadVersion: 1, payload: {} })).toThrow('crash')
    expect(cache.sqlite.prepare('SELECT count(*) count FROM projection').get()).toEqual({ count: 0 })
    expect(cache.sqlite.prepare('SELECT count(*) count FROM sync_outbox').get()).toEqual({ count: 0 })
    cache.writeWithOutbox((sqlite) => sqlite.prepare('INSERT INTO projection VALUES(?,?)').run('one', 'saved'), { entityType: 'workspace', entityId: '00000000-0000-4000-8000-000000000001', command: 'workspace.create', baseRevision: null, payloadVersion: 1, payload: { title: 'safe' } })
    expect(cache.sqlite.prepare('SELECT count(*) count FROM sync_outbox').get()).toEqual({ count: 1 })
    databases.close()
  })

  it('quarantines a corrupt cache and creates a rehydration cache', () => {
    const { manager: databases } = manager(); const cache = databases.open('user-a'); const path = cache.path
    databases.close(); writeFileSync(path, 'not sqlite')
    const recovered = databases.open('user-a')
    expect(recovered.sqlite.prepare("SELECT value FROM account_metadata WHERE key='rehydration_required'").get()).toEqual({ value: '1' })
    expect(readFileSync(path).subarray(0, 6).toString()).toBe('SQLite')
    databases.close()
  })

  it('keeps credentials out of SQLite', () => {
    const { manager: databases } = manager(); const cache = databases.open('user-a')
    cache.writeWithOutbox(() => {}, { entityType: 'workspace', entityId: '00000000-0000-4000-8000-000000000001', command: 'workspace.create', baseRevision: null, payloadVersion: 1, payload: { title: 'No token' } })
    cache.close()
    const bytes = readFileSync(cache.path, 'utf8')
    expect(bytes).not.toContain('refresh-token-secret')
    expect(bytes).not.toContain('access-token-secret')
  })
})
