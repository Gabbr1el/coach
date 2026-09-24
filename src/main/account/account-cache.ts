import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'

const CACHE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS account_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sync_outbox (mutation_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, command TEXT NOT NULL, base_revision INTEGER, payload_version INTEGER NOT NULL, payload_json TEXT, client_created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT);
  CREATE TABLE IF NOT EXISTS sync_inbox (sequence INTEGER PRIMARY KEY, payload_json TEXT NOT NULL, applied_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sync_entities (entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, entity_class TEXT NOT NULL, aggregate_id TEXT, hierarchy TEXT NOT NULL, revision INTEGER NOT NULL, aggregate_generation INTEGER NOT NULL, payload_version INTEGER NOT NULL, payload_json TEXT, payload_hash TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(entity_type, entity_id));
  CREATE TABLE IF NOT EXISTS sync_cursors (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sync_conflicts (id TEXT PRIMARY KEY, mutation_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, code TEXT NOT NULL, current_revision INTEGER, current_projection_json TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER);
  CREATE INDEX IF NOT EXISTS sync_outbox_pending_idx ON sync_outbox(state, next_attempt_at, client_created_at);
`

export interface LocalMutation {
  readonly mutationId?: string
  readonly entityType: string
  readonly entityId: string
  readonly command: string
  readonly baseRevision: number | null
  readonly payloadVersion: number
  readonly payload: Record<string, unknown> | null
  readonly clientCreatedAt?: string
}

export class AccountCache {
  constructor(readonly path: string, readonly sqlite: Database.Database) {}

  writeWithOutbox(writeProjection: (sqlite: Database.Database) => void, mutation: LocalMutation): string {
    const mutationId = mutation.mutationId ?? randomUUID()
    this.sqlite.transaction(() => {
      writeProjection(this.sqlite)
      this.sqlite.prepare(`INSERT INTO sync_outbox (mutation_id,entity_type,entity_id,command,base_revision,payload_version,payload_json,client_created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
        mutationId, mutation.entityType, mutation.entityId, mutation.command, mutation.baseRevision, mutation.payloadVersion,
        mutation.payload === null ? null : JSON.stringify(mutation.payload), mutation.clientCreatedAt ?? new Date().toISOString(),
      )
    })()
    return mutationId
  }

  close(): void { if (this.sqlite.open) this.sqlite.close() }
}

export class AccountDatabaseManager {
  private active: { accountHash: string; cache: AccountCache } | null = null

  constructor(private readonly root: string) {}

  open(userId: string): AccountCache {
    const accountHash = createHash('sha256').update(`coach:account-cache:v1:${userId}`).digest('hex')
    if (this.active?.accountHash === accountHash) return this.active.cache
    this.close()
    const path = join(this.root, `account-${accountHash}.sqlite`)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    chmodSync(dirname(path), 0o700)
    let sqlite: Database.Database
    try {
      sqlite = new Database(path)
      const check = sqlite.pragma('quick_check') as Array<{ quick_check: string }>
      if (check.some((row) => row.quick_check !== 'ok')) throw new Error('cache_integrity_check_failed')
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = FULL')
      sqlite.pragma('foreign_keys = ON')
      sqlite.exec(CACHE_SCHEMA)
      sqlite.prepare(`INSERT INTO account_metadata(key,value) VALUES('account_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(accountHash)
      chmodSync(path, 0o600)
    } catch (error) {
      try { sqlite!.close() } catch {}
      const quarantine = `${path}.corrupt-${Date.now()}`
      try { renameSync(path, quarantine) } catch {}
      for (const suffix of ['-wal', '-shm']) { try { renameSync(`${path}${suffix}`, `${quarantine}${suffix}`) } catch {} }
      sqlite = new Database(path)
      sqlite.pragma('journal_mode = WAL')
      sqlite.exec(CACHE_SCHEMA)
      sqlite.prepare(`INSERT INTO account_metadata(key,value) VALUES('account_hash',?)`).run(accountHash)
      sqlite.prepare(`INSERT INTO account_metadata(key,value) VALUES('rehydration_required','1')`).run()
      chmodSync(path, 0o600)
    }
    const cache = new AccountCache(path, sqlite)
    this.active = { accountHash, cache }
    return cache
  }

  current(): AccountCache | null { return this.active?.cache ?? null }
  close(): void { this.active?.cache.close(); this.active = null }
}
