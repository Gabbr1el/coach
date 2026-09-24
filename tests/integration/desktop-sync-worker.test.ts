import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountDatabaseManager, type AccountCache } from '../../src/main/account/account-cache'
import { DesktopSyncWorker } from '../../src/main/account/sync-worker'
import type { CoachDesktopCloudClient } from '../../packages/backend/src/client/desktop-client'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function cache(): { value: AccountCache; close: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'coach-sync-')); directories.push(directory)
  const manager = new AccountDatabaseManager(directory)
  return { value: manager.open('user-a'), close: () => manager.close() }
}

function mutation(value: AccountCache): string {
  return value.writeWithOutbox(() => {}, { entityType: 'workspace', entityId: '00000000-0000-4000-8000-000000000001', command: 'workspace.create', baseRevision: null, payloadVersion: 1, payload: { title: 'Offline' } })
}

describe('DesktopSyncWorker', () => {
  it('reports offline and converges after reconnect', async () => {
    const local = cache(); mutation(local.value)
    let online = false
    const cloud = { api: async (path: string, _token: string) => {
      if (!online) throw new TypeError('fetch failed')
      if (path === '/v1/sync/push') return { results: [{ mutationId: (local.value.sqlite.prepare('SELECT mutation_id AS mutationId FROM sync_outbox').get() as { mutationId: string }).mutationId, status: 'accepted' }] }
      if (path.startsWith('/v1/sync/pull')) return { changes: [], nextCursor: 'cursor-1', hasMore: false }
      return undefined
    } } as unknown as CoachDesktopCloudClient
    const worker = new DesktopSyncWorker(local.value, cloud, '00000000-0000-4000-8000-000000000010', async () => 'access', () => 0)
    expect((await worker.run()).state).toBe('offline')
    online = true
    expect((await worker.run()).state).toBe('idle')
    expect(worker.getStatus().pending).toBe(0)
    await worker.stop(); local.close()
  })

  it('replays the same mutation id after a push response crash', async () => {
    const local = cache(); const mutationId = mutation(local.value); const seen: string[] = []; let attempt = 0
    const cloud = { api: async (path: string, _token: string, init?: RequestInit) => {
      if (path === '/v1/sync/push') {
        seen.push(JSON.parse(String(init?.body)).mutations[0].mutationId)
        if (attempt++ === 0) throw new TypeError('connection closed after commit')
        return { results: [{ mutationId, status: 'accepted' }] }
      }
      if (path.startsWith('/v1/sync/pull')) return { changes: [], nextCursor: 'cursor-1', hasMore: false }
      return undefined
    } } as unknown as CoachDesktopCloudClient
    const worker = new DesktopSyncWorker(local.value, cloud, '00000000-0000-4000-8000-000000000010', async () => 'access', () => 0)
    await worker.run(); await worker.run()
    expect(seen).toEqual([mutationId, mutationId])
    expect(worker.getStatus().pending).toBe(0)
    await worker.stop(); local.close()
  })

  it('atomically bootstraps after cursor expiry and quarantines old outbox', async () => {
    const local = cache(); mutation(local.value)
    let reset = true
    const cloud = { api: async (path: string) => {
      if (path === '/v1/sync/push') return { results: [] }
      if (path.startsWith('/v1/sync/pull') && reset) { reset = false; throw new Error('sync_reset_required') }
      if (path === '/v1/sync/bootstrap') return { pageToken: 'page-1' }
      if (path.startsWith('/v1/sync/bootstrap/page')) return { items: [{ entityType: 'workspace', entityId: '00000000-0000-4000-8000-000000000002', entityClass: 'mutable', aggregateId: null, hierarchy: 'standalone', revision: 2, aggregateGeneration: 1, payloadVersion: 1, payload: { title: 'Cloud' }, payloadHash: 'hash' }], nextPageToken: null, catchUpCursor: 'bootstrap-cursor' }
      return undefined
    } } as unknown as CoachDesktopCloudClient
    const worker = new DesktopSyncWorker(local.value, cloud, '00000000-0000-4000-8000-000000000010', async () => 'access')
    expect((await worker.run()).state).toBe('reconciliation_required')
    expect(local.value.sqlite.prepare('SELECT entity_id entityId FROM sync_entities').get()).toEqual({ entityId: '00000000-0000-4000-8000-000000000002' })
    expect(local.value.sqlite.prepare('SELECT state FROM sync_outbox').get()).toEqual({ state: 'reconciliation_required' })
    expect(worker.listReconciliation()).toHaveLength(1)
    worker.resolveReconciliation(worker.listReconciliation()[0]!.mutationId)
    expect(worker.getStatus().reconciliationRequired).toBe(0)
    await worker.stop(); local.close()
  })

  it('awaits in-flight work before stop resolves', async () => {
    const local = cache(); let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const cloud = { api: async (path: string) => { if (path.startsWith('/v1/sync/pull')) { await blocked; return { changes: [], nextCursor: 'cursor', hasMore: false } } } } as unknown as CoachDesktopCloudClient
    const worker = new DesktopSyncWorker(local.value, cloud, '00000000-0000-4000-8000-000000000010', async () => 'access')
    const run = worker.run(); let stopped = false; const stop = worker.stop().then(() => { stopped = true })
    await Promise.resolve(); expect(stopped).toBe(false); release(); await run; await stop; local.close()
  })

  it('backs off and retries when bootstrap itself fails', async () => {
    const local = cache(); let pulls = 0
    const cloud = { api: async (path: string) => { if (path.startsWith('/v1/sync/pull')) { pulls += 1; throw new Error('sync_reset_required') } if (path === '/v1/sync/bootstrap') throw new TypeError('bootstrap offline') } } as unknown as CoachDesktopCloudClient
    const worker = new DesktopSyncWorker(local.value, cloud, '00000000-0000-4000-8000-000000000010', async () => 'access', () => 0)
    const status = await worker.run(); expect(status.state).toBe('offline'); expect(status.retryAt).not.toBeNull(); expect(pulls).toBe(1)
    await worker.stop(); local.close()
  })
})
