import { describe, expect, it } from 'vitest'
import { ExerciseSetLoadGate } from '../../src/renderer/app/exercise-set-load-gate'

describe('ExerciseSetLoadGate', () => {
  it('honors persisted retry time and bounds rejected IPC retries', () => {
    const gate = new ExerciseSetLoadGate()
    gate.record('set', { status: 'failed_retryable', retryAfter: 500 } as never, 100)
    expect(gate.canEnsure('set', 499)).toBe(false)
    expect(gate.canEnsure('set', 500)).toBe(true)
    gate.recordFailure('set', 1_000)
    expect(gate.canEnsure('set', 300_999)).toBe(false)
    expect(gate.canEnsure('set', 301_000)).toBe(true)
  })
})
