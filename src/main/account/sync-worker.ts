import type { ReconciliationItem, SyncStatus } from '../../shared/contracts/account-contract'
import type { AccountCache } from './account-cache'
import type { CoachDesktopCloudClient } from '../../../packages/backend/src/client/desktop-client'

type AccessToken = () => Promise<string>

export class DesktopSyncWorker {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private inFlight: Promise<SyncStatus> | null = null
  private stopped = false
  private failures = 0
  private status: SyncStatus = { state: 'idle', pending: 0, conflicts: 0, reconciliationRequired: 0, lastSyncedAt: null, retryAt: null }

  constructor(private readonly cache: AccountCache, private readonly cloud: CoachDesktopCloudClient, private readonly deviceId: string, private readonly accessToken: AccessToken, private readonly random = Math.random) {}

  start(): void { this.stopped = false; this.schedule(0) }
  async stop(): Promise<void> { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; await this.inFlight }
  getStatus(): SyncStatus {
    const reconciliationRequired = this.count('sync_outbox', "state='reconciliation_required'")
    return { ...this.status, state: reconciliationRequired > 0 && !['syncing', 'offline', 'backoff'].includes(this.status.state) ? 'reconciliation_required' : this.status.state, pending: this.count('sync_outbox', "state IN ('pending','sending')"), conflicts: this.count('sync_conflicts', 'resolved_at IS NULL'), reconciliationRequired }
  }

  listReconciliation(): ReconciliationItem[] {
    return (this.cache.sqlite.prepare("SELECT mutation_id AS mutationId,entity_type AS entityType,entity_id AS entityId,command,payload_json AS payloadJson,last_error AS reason,client_created_at AS createdAt FROM sync_outbox WHERE state='reconciliation_required' ORDER BY client_created_at").all() as Array<Record<string, any>>).map((row) => ({ mutationId: row.mutationId, entityType: row.entityType, entityId: row.entityId, command: row.command, payload: row.payloadJson ? JSON.parse(row.payloadJson) : null, reason: row.reason ?? 'reconciliation_required', createdAt: row.createdAt }))
  }
  resolveReconciliation(mutationId: string): void { this.cache.sqlite.prepare("UPDATE sync_outbox SET state='pending',last_error=NULL,next_attempt_at=0 WHERE mutation_id=? AND state='reconciliation_required'").run(mutationId); this.schedule(0) }
  discardReconciliation(mutationId: string): void { this.cache.sqlite.prepare("DELETE FROM sync_outbox WHERE mutation_id=? AND state='reconciliation_required'").run(mutationId) }

  async run(): Promise<SyncStatus> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.runOnce()
    try { return await this.inFlight } finally { this.inFlight = null }
  }

  private async runOnce(): Promise<SyncStatus> {
    if (this.stopped) return this.getStatus()
    this.running = true
    this.status = { ...this.getStatus(), state: 'syncing', retryAt: null }
    try {
      await this.push()
      await this.pull()
      this.failures = 0
      const reconciliationRequired = this.count('sync_outbox', "state='reconciliation_required'")
      this.status = { ...this.getStatus(), state: reconciliationRequired > 0 ? 'reconciliation_required' : 'idle', lastSyncedAt: Date.now(), retryAt: null }
      if (reconciliationRequired === 0) this.schedule(15_000)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'sync_failed'
      this.cache.sqlite.prepare("UPDATE sync_outbox SET state='pending',last_error=? WHERE state='sending'").run(code)
      if (code === 'sync_reset_required' || code === 'invalid_cursor') {
        try { await this.bootstrap() } catch (bootstrapError) { this.backoff(bootstrapError) }
      }
      else if (code === 'reconciliation_required') this.status = { ...this.getStatus(), state: 'reconciliation_required', retryAt: null }
      else {
        this.backoff(error)
      }
    } finally { this.running = false }
    return this.getStatus()
  }

  private async push(): Promise<void> {
    const rows = this.cache.sqlite.prepare("SELECT mutation_id AS mutationId,entity_type AS entityType,entity_id AS entityId,command,base_revision AS baseRevision,payload_version AS payloadVersion,payload_json AS payloadJson,client_created_at AS clientCreatedAt FROM sync_outbox WHERE state IN ('pending','sending') AND next_attempt_at <= ? ORDER BY client_created_at LIMIT 50").all(Date.now()) as Array<Record<string, any>>
    if (!rows.length) return
    const markSending = this.cache.sqlite.prepare(`UPDATE sync_outbox SET state='sending', attempts=attempts+1 WHERE mutation_id=?`)
    this.cache.sqlite.transaction(() => { for (const row of rows) markSending.run(row.mutationId) })()
    const result = await this.cloud.api<{ results: Array<Record<string, any>> }>('/v1/sync/push', await this.accessToken(), { method: 'POST', body: JSON.stringify({ protocolVersion: 1, deviceId: this.deviceId, mutations: rows.map((row) => ({ ...row, payload: row.payloadJson === null ? null : JSON.parse(row.payloadJson), payloadJson: undefined })) }) })
    this.cache.sqlite.transaction(() => {
      for (const item of result.results) {
        if (item.status === 'accepted') this.cache.sqlite.prepare('DELETE FROM sync_outbox WHERE mutation_id=?').run(item.mutationId)
        else if (item.status === 'conflict') {
          const row = rows.find((candidate) => candidate.mutationId === item.mutationId)!
          this.cache.sqlite.prepare(`INSERT OR IGNORE INTO sync_conflicts(id,mutation_id,entity_type,entity_id,code,current_revision,current_projection_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), item.mutationId, row.entityType, row.entityId, item.code, item.currentRevision ?? null, JSON.stringify(item.currentProjection ?? null), Date.now())
          this.cache.sqlite.prepare(`UPDATE sync_outbox SET state='conflict' WHERE mutation_id=?`).run(item.mutationId)
        } else this.cache.sqlite.prepare(`UPDATE sync_outbox SET state='reconciliation_required',last_error=? WHERE mutation_id=?`).run(item.code ?? 'rejected', item.mutationId)
      }
    })()
  }

  private async pull(): Promise<void> {
    let cursor = (this.cache.sqlite.prepare("SELECT value FROM sync_cursors WHERE name='pull'").get() as { value: string } | undefined)?.value
    do {
      const query = new URLSearchParams({ protocolVersion: '1', deviceId: this.deviceId, limit: '200', ...(cursor ? { cursor } : {}) })
      const result = await this.cloud.api<{ changes: Array<Record<string, any>>; nextCursor: string; hasMore: boolean }>(`/v1/sync/pull?${query}`, await this.accessToken())
      this.cache.sqlite.transaction(() => { for (const change of result.changes) this.applyEntity(change); this.setCursor(result.nextCursor) })()
      cursor = result.nextCursor
      if (!result.hasMore) { await this.cloud.api('/v1/sync/ack', await this.accessToken(), { method: 'POST', body: JSON.stringify({ protocolVersion: 1, deviceId: this.deviceId, cursor }) }); break }
    } while (true)
  }

  private async bootstrap(): Promise<void> {
    const token = await this.accessToken()
    const initial = await this.cloud.api<{ pageToken: string }>('/v1/sync/bootstrap', token, { method: 'POST', body: JSON.stringify({ protocolVersion: 1, deviceId: this.deviceId, pageSize: 200 }) })
    this.cache.sqlite.exec('DROP TABLE IF EXISTS sync_entities_staging; CREATE TABLE sync_entities_staging AS SELECT * FROM sync_entities WHERE 0')
    let pageToken: string | null = initial.pageToken
    let cursor: string | null = null
    while (pageToken) {
      const query = new URLSearchParams({ protocolVersion: '1', deviceId: this.deviceId, token: pageToken })
      const page: { items: Array<Record<string, any>>; nextPageToken: string | null; catchUpCursor: string | null } = await this.cloud.api(`/v1/sync/bootstrap/page?${query}`, token)
      const insert = this.cache.sqlite.prepare('INSERT INTO sync_entities_staging(entity_type,entity_id,entity_class,aggregate_id,hierarchy,revision,aggregate_generation,payload_version,payload_json,payload_hash,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,0)')
      this.cache.sqlite.transaction(() => { for (const item of page.items) insert.run(item.entityType, item.entityId, item.entityClass, item.aggregateId, item.hierarchy, item.revision, item.aggregateGeneration, item.payloadVersion, JSON.stringify(item.payload), item.payloadHash) })()
      pageToken = page.nextPageToken; cursor = page.catchUpCursor ?? cursor
    }
    this.cache.sqlite.transaction(() => {
      this.cache.sqlite.exec('DELETE FROM sync_entities; INSERT INTO sync_entities SELECT * FROM sync_entities_staging; DROP TABLE sync_entities_staging')
      this.cache.sqlite.prepare("UPDATE sync_outbox SET state='reconciliation_required',last_error='bootstrap_reset' WHERE state != 'conflict'").run()
      if (cursor) this.setCursor(cursor)
    })()
    this.failures = 0
    const reconciliationRequired = this.count('sync_outbox', "state='reconciliation_required'")
    this.status = { ...this.getStatus(), state: reconciliationRequired > 0 ? 'reconciliation_required' : 'idle', lastSyncedAt: Date.now(), retryAt: null }
  }

  private applyEntity(change: Record<string, any>): void {
    this.cache.sqlite.prepare(`INSERT INTO sync_entities(entity_type,entity_id,entity_class,aggregate_id,hierarchy,revision,aggregate_generation,payload_version,payload_json,payload_hash,deleted) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET revision=excluded.revision,aggregate_generation=excluded.aggregate_generation,payload_version=excluded.payload_version,payload_json=excluded.payload_json,payload_hash=excluded.payload_hash,deleted=excluded.deleted WHERE excluded.revision >= sync_entities.revision`).run(change.entityType, change.entityId, change.entityClass, change.aggregateId, change.hierarchy, change.revision, change.aggregateGeneration, change.payloadVersion, change.payload === null ? null : JSON.stringify(change.payload), change.payloadHash, change.operation === 'delete' ? 1 : 0)
    this.cache.sqlite.prepare('INSERT OR IGNORE INTO sync_inbox(sequence,payload_json,applied_at) VALUES(?,?,?)').run(change.sequence, JSON.stringify(change), Date.now())
  }
  private setCursor(cursor: string): void { this.cache.sqlite.prepare("INSERT INTO sync_cursors(name,value,updated_at) VALUES('pull',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(cursor, Date.now()) }
  private count(table: string, where: string): number { return Number((this.cache.sqlite.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number }).count) }
  private backoff(error: unknown): void { this.failures += 1; const delay = Math.min(300_000, 1_000 * 2 ** Math.min(this.failures, 8)) * (0.5 + this.random()); this.status = { ...this.getStatus(), state: isOfflineError(error) ? 'offline' : 'backoff', retryAt: Date.now() + delay }; this.schedule(delay) }
  private schedule(delay: number): void { if (this.stopped) return; if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { void this.run().catch(() => {}) }, delay); this.timer.unref() }
}

function isOfflineError(error: unknown): boolean { return error instanceof TypeError || (error instanceof Error && /fetch|network|offline/i.test(error.message)) }
