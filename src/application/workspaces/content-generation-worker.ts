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
  verifyPublished?(): boolean
}

export type ContentJobHandler = (job: ContentJob, signal: AbortSignal) => Promise<ContentJobExecution>
export const CONTENT_GENERATION_TIMEOUT_MS = 300_000
export function contentJobAdmissionPriority(job: Pick<ContentJob, 'kind' | 'priority'>): 'foreground' | 'background' {
  return job.kind === 'roadmap_generate' || ((job.kind === 'lesson_generate' || job.kind === 'exercise_generate') && job.priority >= 900) ? 'foreground' : 'background'
}

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
  readonly onSettled?: (job: ContentJob) => void
}

const systemClock: WorkerClock = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

export interface ContentGenerationFailure { readonly code: string; readonly retryable: boolean; readonly providerUnavailable: boolean; readonly diagnostic?: string }

const INVARIANT_CODES = new Set(['UNSUPPORTED_JOB_KIND', 'CURRENT_CONTENT_INVALID', 'PUBLISHED_CONTENT_MISSING'])
const RECOVERABLE_PROVIDER_CODES = new Set(['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_REQUEST_FAILED', 'PROVIDER_INVALID_RESPONSE', 'INVALID_CREDENTIAL', 'AUTHENTICATION_FAILED', 'HTTP_410', 'RATE_LIMITED', 'MODEL_UNAVAILABLE', 'GENERATION_TIMEOUT', 'JSON_EXTRACTION_FAILED', 'ROADMAP_SCHEMA_INVALID', 'ROADMAP_GENERIC_REJECTED', 'LESSON_SCHEMA_INVALID', 'LESSON_GENERIC_REJECTED'])

export function classifyContentGenerationFailure(error: unknown): ContentGenerationFailure {
  if (error instanceof DOMException && error.name === 'AbortError') return { code: 'GENERATION_ABORTED', retryable: true, providerUnavailable: false }
  const declared = error instanceof Error && 'code' in error && typeof (error as Error & { code?: unknown }).code === 'string' ? (error as Error & { code: string }).code : null
  const message = error instanceof Error ? `${error.name} ${error.message}` : ''
  const code = declared ?? (/\b410\b/.test(message) ? 'HTTP_410' : /credential|unauthori[sz]ed|authentication|auth\b/i.test(message) ? 'AUTHENTICATION_FAILED' : /rate.?limit|quota|429/i.test(message) ? 'RATE_LIMITED' : /model.*unavailable|unknown model/i.test(message) ? 'MODEL_UNAVAILABLE' : /provider.*unavailable|network|offline|connect/i.test(message) ? 'PROVIDER_UNAVAILABLE' : /timeout|timed out/i.test(message) ? 'GENERATION_TIMEOUT' : 'GENERATION_FAILED')
  return { code, retryable: !INVARIANT_CODES.has(code), providerUnavailable: RECOVERABLE_PROVIDER_CODES.has(code), diagnostic: error instanceof Error ? error.message : undefined }
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
  private readonly onSettled?: (job: ContentJob) => void
  private pollHandle: unknown = null
  private running = false
  private stopping: Promise<void> | null = null
  private activeTask: Promise<void> | null = null
  private active: { job: ContentJob; controller: AbortController; renewal: unknown; timeout: unknown | null } | null = null

  constructor(options: ContentGenerationWorkerOptions) {
    this.repository = options.repository
    this.admission = options.admission
    this.handlers = options.handlers
    this.owner = options.owner ?? `content-worker:${crypto.randomUUID()}`
    this.clock = options.clock ?? systemClock
    this.pollMs = options.pollMs ?? 1_000
    this.leaseMs = options.leaseMs ?? CONTENT_JOB_DEFAULTS.leaseMs
    this.renewAfterMs = options.renewAfterMs ?? CONTENT_JOB_DEFAULTS.renewAfterMs
    this.timeoutMs = options.timeoutMs ?? CONTENT_GENERATION_TIMEOUT_MS
    this.onPublished = options.onPublished
    this.onSettled = options.onSettled
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

  retryProviderUnavailable(): void {
    this.repository.retryProviderUnavailable(this.clock.now())
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
      try { this.onSettled?.(job) } catch (error) { console.error('Content job settlement projection failed:', error) }
      this.schedule(0)
      return
    }
    const controller = new AbortController()
    const renewal = this.clock.setInterval(() => {
      if (!this.repository.renewLease({ jobId: job.id, leaseToken, now: this.clock.now(), leaseMs: this.leaseMs })) controller.abort()
    }, this.renewAfterMs)
    let timedOut = false
    const active = { job, controller, renewal, timeout: null as unknown | null }
    this.active = active
    const task = (async () => { try {
      const output = await this.admission.run(() => {
        if (!this.running) throw new DOMException('Request cancelled', 'AbortError')
        active.timeout = this.clock.setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
        return handler(job, controller.signal)
      }, { priority: contentJobAdmissionPriority(job), signal: controller.signal })
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
      if (!this.repository.renewLease({ jobId: job.id, leaseToken, now: this.clock.now(), leaseMs: this.leaseMs })) throw new DOMException('Content job lease expired before publication', 'AbortError')
      const published = this.repository.publishLease({ jobId: job.id, leaseToken, now: this.clock.now(), publish: () => {
        const result = output.publish()
        if (output.verifyPublished && !output.verifyPublished()) throw Object.assign(new Error(`Published content for job ${job.id} does not exist`), { code: 'PUBLISHED_CONTENT_MISSING' })
        return result
      } })
      if (published !== null) this.onPublished?.(job)
    } catch (error) {
      const current = this.repository.getJob(job.id)
      if (current?.status === 'generating' && current.leaseToken === leaseToken) {
        if (!this.running) this.repository.releaseLease({ jobId: job.id, leaseToken, now: this.clock.now(), errorCode: 'WORKER_SHUTDOWN' })
        else if (timedOut) this.repository.releaseLease({ jobId: job.id, leaseToken, now: this.clock.now(), retryAt: this.clock.now() + 30_000, restoreAttempt: true, errorCode: 'GENERATION_TIMEOUT' })
        else {
          const failure = classifyContentGenerationFailure(error)
          if (failure.providerUnavailable) this.repository.releaseLease({ jobId: job.id, leaseToken, now: this.clock.now(), retryAt: this.clock.now() + 300_000, restoreAttempt: true, errorCode: failure.code, errorMessage: failure.diagnostic })
          else this.repository.failLease({ jobId: job.id, leaseToken, now: this.clock.now(), errorCode: failure.code, errorMessage: failure.diagnostic, retryable: failure.retryable })
        }
      }
    } finally {
      try { this.onSettled?.(job) } catch (error) { console.error('Content job settlement projection failed:', error) }
      this.clock.clearInterval(renewal)
      if (active.timeout !== null) this.clock.clearTimeout(active.timeout)
      if (this.active === active) this.active = null
      this.schedule(0)
    } })()
    this.activeTask = task
    await task.finally(() => { if (this.activeTask === task) this.activeTask = null })
  }
}
