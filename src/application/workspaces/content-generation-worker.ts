import type { ContentJob } from '../../shared/contracts/workspace-content-contract'
import type { HeavyGenerationRunner } from '../ai/heavy-generation-queue'
import { CONTENT_JOB_DEFAULTS, type WorkspaceContentRepository } from './workspace-content-repository'

export interface WorkerClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(callback: () => void, delayMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface ContentJobExecution {
  publish(): unknown
}

export type ContentJobHandler = (job: ContentJob, signal: AbortSignal) => Promise<ContentJobExecution>

export interface ContentGenerationWorkerOptions {
  readonly repository: WorkspaceContentRepository
  readonly admission: HeavyGenerationRunner
  readonly handlers: Partial<Record<ContentJob['kind'], ContentJobHandler>>
  readonly owner?: string
  readonly clock?: WorkerClock
  readonly pollMs?: number
  readonly leaseMs?: number
  readonly renewAfterMs?: number
  readonly timeoutMs?: number
  readonly onPublished?: (job: ContentJob) => void
}

const systemClock: WorkerClock = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

function errorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'GENERATION_ABORTED'
  if (error instanceof Error && /provider.*unavailable|network|offline|connect/i.test(error.message)) return 'PROVIDER_UNAVAILABLE'
  return 'GENERATION_FAILED'
}

export class ContentGenerationWorker {
  private readonly repository: WorkspaceContentRepository
  private readonly admission: HeavyGenerationRunner
  private readonly handlers: Partial<Record<ContentJob['kind'], ContentJobHandler>>
  private readonly owner: string
  private readonly clock: WorkerClock
  private readonly pollMs: number
  private readonly leaseMs: number
  private readonly renewAfterMs: number
  private readonly timeoutMs: number
  private readonly onPublished?: (job: ContentJob) => void
  private pollHandle: unknown = null
  private running = false
  private stopping: Promise<void> | null = null
  private activeTask: Promise<void> | null = null
  private active: { job: ContentJob; controller: AbortController; renewal: unknown; timeout: unknown } | null = null

  constructor(options: ContentGenerationWorkerOptions) {
    this.repository = options.repository
    this.admission = options.admission
    this.handlers = options.handlers
    this.owner = options.owner ?? `content-worker:${crypto.randomUUID()}`
    this.clock = options.clock ?? systemClock
    this.pollMs = options.pollMs ?? 1_000
    this.leaseMs = options.leaseMs ?? CONTENT_JOB_DEFAULTS.leaseMs
    this.renewAfterMs = options.renewAfterMs ?? CONTENT_JOB_DEFAULTS.renewAfterMs
    this.timeoutMs = options.timeoutMs ?? this.leaseMs * 3
    this.onPublished = options.onPublished
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.repository.reconcile(this.clock.now())
    this.schedule(0)
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.running = false
    if (this.pollHandle !== null) this.clock.clearTimeout(this.pollHandle)
    this.pollHandle = null
    const active = this.active
    if (!active) return
    active.controller.abort()
    this.stopping = (this.activeTask ?? Promise.resolve()).finally(() => { this.stopping = null })
    return this.stopping
  }

  wake(): void { if (this.running && !this.active) this.schedule(0) }

  cancelWorkspace(workspaceId: string): void {
    if (this.active?.job.workspaceId === workspaceId) this.active.controller.abort()
    this.wake()
  }

  private schedule(delayMs: number): void {
    if (!this.running || this.pollHandle !== null) return
    this.pollHandle = this.clock.setTimeout(() => { this.pollHandle = null; void this.tick() }, delayMs)
  }

  private async tick(): Promise<void> {
    if (!this.running || this.active) return
    const job = this.repository.claimNext({ owner: this.owner, now: this.clock.now(), leaseMs: this.leaseMs })
    if (!job?.leaseToken) { this.schedule(this.pollMs); return }
    const leaseToken = job.leaseToken
    const handler = this.handlers[job.kind]
    if (!handler) {
      this.repository.failLease({ jobId: job.id, leaseToken: job.leaseToken, now: this.clock.now(), errorCode: 'UNSUPPORTED_JOB_KIND' })
      this.schedule(0)
      return
    }
    const controller = new AbortController()
    const renewal = this.clock.setInterval(() => {
      if (!this.repository.renewLease({ jobId: job.id, leaseToken, now: this.clock.now(), leaseMs: this.leaseMs })) controller.abort()
    }, this.renewAfterMs)
    let timedOut = false
    const timeout = this.clock.setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
    const active = { job, controller, renewal, timeout }
    this.active = active
    const task = (async () => { try {
      const output = await this.admission.run(() => handler(job, controller.signal), { priority: 'background', signal: controller.signal })
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
      const published = this.repository.publishLease({ jobId: job.id, leaseToken, now: this.clock.now(), publish: output.publish })
      if (published !== null) this.onPublished?.(job)
    } catch (error) {
      const current = this.repository.getJob(job.id)
      if (current?.status === 'generating' && current.leaseToken === leaseToken) {
        if (!this.running) this.repository.releaseLease({ jobId: job.id, leaseToken, now: this.clock.now(), errorCode: 'WORKER_SHUTDOWN' })
        else if (timedOut) this.repository.failLease({ jobId: job.id, leaseToken, now: this.clock.now(), errorCode: 'GENERATION_TIMEOUT' })
        else this.repository.failLease({ jobId: job.id, leaseToken, now: this.clock.now(), errorCode: errorCode(error), errorMessage: error instanceof Error ? error.message : undefined })
      }
    } finally {
      this.clock.clearInterval(renewal)
      this.clock.clearTimeout(timeout)
      if (this.active === active) this.active = null
      this.schedule(0)
    } })()
    this.activeTask = task
    await task.finally(() => { if (this.activeTask === task) this.activeTask = null })
  }
}
