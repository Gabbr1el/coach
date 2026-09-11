import { describe, expect, it, vi } from 'vitest'
import { HeavyGenerationQueue } from '../../src/application/ai/heavy-generation-queue'
import { ContentGenerationWorker, type WorkerClock } from '../../src/application/workspaces/content-generation-worker'
import type { ContentJob } from '../../src/shared/contracts/workspace-content-contract'

const job = (overrides: Partial<ContentJob> = {}): ContentJob => ({ id: 'job', workspaceId: '00000000-0000-4000-8000-000000000001', revision: 1, kind: 'lesson_generate', unitKey: 'module:topic', priority: 500, status: 'generating', idempotencyKey: 'a'.repeat(64), inputHash: 'b'.repeat(64), generatorContractVersion: 'v1', dependencyKeys: [], attemptCount: 1, maxAttempts: 3, availableAt: 0, leaseOwner: 'worker', leaseToken: 'lease', leaseExpiresAt: 120000, claimedCancellationGeneration: 1, startedAt: 0, completedAt: null, obsoleteAt: null, lastErrorCode: null, lastErrorMessage: null, createdAt: 0, updatedAt: 0, ...overrides })

function clock(): WorkerClock & { advance(ms: number): void } {
  let now = 0; let id = 0; const timers = new Map<number, { at: number; callback: () => void; repeat: number | null }>()
  const run = () => { for (;;) { const due = [...timers].filter(([, item]) => item.at <= now).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) return; const [key, item] = due; if (item.repeat === null) timers.delete(key); else item.at += item.repeat; item.callback() } }
  return { now: () => now, setTimeout: (callback, delay) => { timers.set(++id, { at: now + delay, callback, repeat: null }); return id }, clearTimeout: (handle) => timers.delete(handle as number), setInterval: (callback, delay) => { timers.set(++id, { at: now + delay, callback, repeat: delay }); return id }, clearInterval: (handle) => timers.delete(handle as number), advance: (ms) => { now += ms; run() } }
}

describe('ContentGenerationWorker', () => {
  it('claims, renews, and publishes through the global admission queue', async () => {
    const fake = clock(); let available = true; const leased = job(); let release!: () => void
    const repository = { reconcile: vi.fn(() => ({ requeued: 1, obsoleted: 0 })), retryProviderUnavailable: vi.fn(() => 0), claimNext: vi.fn(() => available ? (available = false, leased) : null), renewLease: vi.fn(() => true), publishLease: vi.fn((input: { publish: () => unknown }) => input.publish()), getJob: vi.fn(() => leased), releaseLease: vi.fn(), failLease: vi.fn() }
    const handler = vi.fn(async () => { await new Promise<void>((resolve) => { release = resolve }); return { publish: vi.fn(() => 'saved') } })
    const worker = new ContentGenerationWorker({ repository: repository as never, admission: new HeavyGenerationQueue(), handlers: { lesson_generate: handler }, clock: fake, renewAfterMs: 10, leaseMs: 30 })
    worker.start(); fake.advance(0); await Promise.resolve(); fake.advance(10); expect(repository.renewLease).toHaveBeenCalledTimes(1); release(); await vi.waitFor(() => expect(repository.publishLease).toHaveBeenCalledTimes(1)); await worker.stop()
  })

  it('aborts and releases an owned lease on shutdown', async () => {
    const fake = clock(); let available = true; const leased = job()
    const repository = { reconcile: vi.fn(() => ({ requeued: 0, obsoleted: 0 })), retryProviderUnavailable: vi.fn(() => 0), claimNext: vi.fn(() => available ? (available = false, leased) : null), renewLease: vi.fn(() => true), publishLease: vi.fn(), getJob: vi.fn(() => leased), releaseLease: vi.fn(() => true), failLease: vi.fn() }
    const worker = new ContentGenerationWorker({ repository: repository as never, admission: new HeavyGenerationQueue(), handlers: { lesson_generate: async (_job, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })) }, clock: fake })
    worker.start(); fake.advance(0); await vi.waitFor(() => expect(repository.claimNext).toHaveBeenCalled()); await worker.stop(); expect(repository.releaseLease).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'WORKER_SHUTDOWN' }))
  })

  it('lets waiting foreground work overtake queued background work', async () => {
    const queue = new HeavyGenerationQueue(); let release!: () => void; const order: string[] = []
    const first = queue.run(async () => { order.push('background-1'); await new Promise<void>((resolve) => { release = resolve }) }, { priority: 'background' })
    const second = queue.run(async () => { order.push('background-2') }, { priority: 'background' })
    const foreground = queue.run(async () => { order.push('foreground') })
    release(); await Promise.all([first, second, foreground]); expect(order).toEqual(['background-1', 'foreground', 'background-2'])
  })

  it('does not consume an attempt while the provider is unavailable and wakes on reconnect', async () => {
    const fake = clock(); let available = true; const leased = job({ kind: 'roadmap_generate' })
    const repository = { reconcile: vi.fn(() => ({ requeued: 0, obsoleted: 0 })), retryProviderUnavailable: vi.fn(() => 1), claimNext: vi.fn(() => available ? (available = false, leased) : null), renewLease: vi.fn(() => true), publishLease: vi.fn(), getJob: vi.fn(() => leased), releaseLease: vi.fn(() => true), failLease: vi.fn() }
    const worker = new ContentGenerationWorker({ repository: repository as never, admission: new HeavyGenerationQueue(), handlers: { roadmap_generate: async () => { throw new Error('Provider unavailable') } }, clock: fake })
    worker.start(); fake.advance(0); await vi.waitFor(() => expect(repository.releaseLease).toHaveBeenCalledWith(expect.objectContaining({ restoreAttempt: true, errorCode: 'PROVIDER_UNAVAILABLE', retryAt: 300_000 })))
    expect(repository.failLease).not.toHaveBeenCalled(); worker.retryProviderUnavailable(); expect(repository.retryProviderUnavailable).toHaveBeenCalledWith(0); await worker.stop()
  })

  it('rejects publication after a revision cancellation while the provider is running', async () => {
    const fake = clock(); let available = true; let finish!: (value: { publish(): unknown }) => void; const leased = job({ claimedCancellationGeneration: 1 })
    const repository = { reconcile: vi.fn(() => ({ requeued: 0, obsoleted: 0 })), retryProviderUnavailable: vi.fn(() => 0), claimNext: vi.fn(() => available ? (available = false, leased) : null), renewLease: vi.fn(() => true), publishLease: vi.fn(() => false), getJob: vi.fn(() => leased), releaseLease: vi.fn(), failLease: vi.fn(), cancelRevision: vi.fn((_workspaceId: string, _now: number) => 2) }
    const worker = new ContentGenerationWorker({ repository: repository as never, admission: new HeavyGenerationQueue(), handlers: { lesson_generate: () => new Promise((resolve) => { finish = resolve }) }, clock: fake })
    worker.start(); fake.advance(0); await vi.waitFor(() => expect(repository.claimNext).toHaveBeenCalled()); repository.cancelRevision(leased.workspaceId, 0); worker.cancelWorkspace(leased.workspaceId); expect(repository.cancelRevision).toHaveBeenCalledWith(leased.workspaceId, 0)
    finish({ publish: vi.fn() }); await worker.stop(); expect(repository.publishLease).not.toHaveBeenCalled()
  })
})
