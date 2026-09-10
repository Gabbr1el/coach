export class HeavyGenerationQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private pending = 0

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1
    const result = this.tail.catch(() => undefined).then(task)
    this.tail = result.finally(() => { this.pending -= 1 })
    return result
  }

  get size(): number { return this.pending }
}

export interface HeavyGenerationRunner { run<T>(task: () => Promise<T>): Promise<T> }
