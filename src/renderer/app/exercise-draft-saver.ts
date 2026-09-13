export type ExerciseDraft = { workspaceId: string; exerciseId: string; code: string }

export class ExerciseDraftSaver {
  private pending: ExerciseDraft | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly save: (draft: ExerciseDraft) => Promise<void>, private readonly delayMs = 400) {}

  schedule(draft: ExerciseDraft): void {
    this.pending = draft
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.enqueuePending() }, this.delayMs)
  }

  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.enqueuePending()
    return this.queue
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }

  private enqueuePending(): void {
    const draft = this.pending
    if (!draft) return
    this.pending = null
    this.queue = this.queue.catch(() => undefined).then(() => this.save(draft))
  }
}
