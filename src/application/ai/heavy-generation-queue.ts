export class HeavyGenerationQueue {
  private readonly foreground: Array<QueuedTask<unknown>> = []
  private readonly background: Array<QueuedTask<unknown>> = []
  private running = false
  private foregroundReservations = 0

  reserveForeground(): () => void {
    this.foregroundReservations += 1
    let released = false
    return () => { if (released) return; released = true; this.foregroundReservations -= 1; this.drain() }
  }

  run<T>(task: () => Promise<T>, options: { priority?: 'foreground' | 'background'; signal?: AbortSignal } = {}): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'))
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedTask<T> = { task, resolve, reject, signal: options.signal }
      ;(options.priority === 'background' ? this.background : this.foreground).push(queued as QueuedTask<unknown>)
      this.drain()
    })
  }

  get size(): number { return this.foreground.length + this.background.length + Number(this.running) }

  private drain(): void {
    if (this.running) return
    let queued = this.foreground.shift() ?? (this.foregroundReservations === 0 ? this.background.shift() : undefined)
    while (queued?.signal?.aborted) {
      queued.reject(new DOMException('Request cancelled', 'AbortError'))
      queued = this.foreground.shift() ?? (this.foregroundReservations === 0 ? this.background.shift() : undefined)
    }
    if (!queued) return
    this.running = true
    void queued.task().then(queued.resolve, queued.reject).finally(() => {
      this.running = false
      this.drain()
    })
  }
}

interface QueuedTask<T> {
  readonly task: () => Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
  readonly reject: (reason?: unknown) => void
  readonly signal?: AbortSignal
}

export interface HeavyGenerationRunner { run<T>(task: () => Promise<T>, options?: { priority?: 'foreground' | 'background'; signal?: AbortSignal }): Promise<T>; reserveForeground?(): () => void }
