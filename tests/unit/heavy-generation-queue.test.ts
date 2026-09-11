import { describe, expect, it } from 'vitest'
import { HeavyGenerationQueue } from '../../src/application/ai/heavy-generation-queue'

describe('HeavyGenerationQueue', () => {
  it('serializes heavy generation globally and continues after failure', async () => {
    const queue = new HeavyGenerationQueue(); const events: string[] = []; let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const first = queue.run(async () => { events.push('first:start'); await blocked; events.push('first:end') })
    const second = queue.run(async () => { events.push('second:start'); throw new Error('transient') })
    const third = queue.run(async () => { events.push('third:start'); return 3 })
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(events).toEqual(['first:start']); release(); await first; await expect(second).rejects.toThrow('transient'); await expect(third).resolves.toBe(3)
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'third:start']); expect(queue.size).toBe(0)
  })
  it('holds background work while a foreground request is preparing', async () => {
    const queue = new HeavyGenerationQueue(); const events: string[] = []
    const release = queue.reserveForeground()
    const background = queue.run(async () => { events.push('background') }, { priority: 'background' })
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(events).toEqual([])
    const foreground = queue.run(async () => { events.push('foreground') }, { priority: 'foreground' })
    release(); await Promise.all([foreground, background])
    expect(events).toEqual(['foreground', 'background'])
  })
})
