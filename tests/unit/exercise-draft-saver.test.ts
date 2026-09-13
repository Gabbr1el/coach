import { describe, expect, it, vi } from 'vitest'
import { ExerciseDraftSaver } from '../../src/renderer/app/exercise-draft-saver'

describe('ExerciseDraftSaver', () => {
  it('debounces edits and flushes the current exercise before a switch', async () => {
    vi.useFakeTimers()
    const saved: Array<{ exerciseId: string; code: string }> = []
    const saver = new ExerciseDraftSaver(async ({ exerciseId, code }) => { saved.push({ exerciseId, code }) }, 400)
    saver.schedule({ workspaceId: 'workspace', exerciseId: 'first', code: 'old' })
    saver.schedule({ workspaceId: 'workspace', exerciseId: 'first', code: 'typed' })
    await saver.flush()
    saver.schedule({ workspaceId: 'workspace', exerciseId: 'second', code: 'second draft' })
    await vi.advanceTimersByTimeAsync(400)
    await saver.flush()
    expect(saved).toEqual([{ exerciseId: 'first', code: 'typed' }, { exerciseId: 'second', code: 'second draft' }])
    vi.useRealTimers()
  })

  it('serializes an in-flight save before a newer draft for the same exercise', async () => {
    let release!: () => void
    const first = new Promise<void>((resolve) => { release = resolve })
    const saved: string[] = []
    const saver = new ExerciseDraftSaver(async ({ code }) => { saved.push(code); if (code === 'older') await first }, 0)
    saver.schedule({ workspaceId: 'workspace', exerciseId: 'exercise', code: 'older' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    saver.schedule({ workspaceId: 'workspace', exerciseId: 'exercise', code: 'newer' })
    const flushing = saver.flush()
    expect(saved).toEqual(['older'])
    release()
    await flushing
    expect(saved).toEqual(['older', 'newer'])
  })
})
