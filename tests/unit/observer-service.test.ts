import { describe, expect, it } from 'vitest'
import { ObserverService, type ObserverRepository } from '../../src/application/observer/observer-service'

class MemoryObserverRepository implements ObserverRepository {
  readonly events: Array<{ type: string; payloadJson: string; createdAt: number }> = []
  getActiveSession() { return { id: 'session' } }
  addEvent(input: { type: string; payloadJson: string; createdAt: number }) { this.events.push(input) }
  listSession() { return this.events }
}

describe('ObserverService', () => {
  it('suggests an intervention after the third equivalent execution error', () => {
    const repository = new MemoryObserverRepository()
    const service = new ObserverService(repository, () => 100, () => crypto.randomUUID())
    expect(service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same' }).interventionSuggested).toBe(false)
    service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same' })
    expect(service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same' })).toMatchObject({ repeatedErrorCount: 3, interventionSuggested: true })
    expect(repository.events.at(-1)?.type).toBe('possible_learning_loop')
  })

  it('tracks focus exits and time away without labeling them', () => {
    const repository = new MemoryObserverRepository()
    let now = 1_000
    const service = new ObserverService(repository, () => now, () => crypto.randomUUID())
    service.recordFocus('workspace', false)
    now = 8_000
    expect(service.recordFocus('workspace', true)).toMatchObject({ focusExitCount: 1, timeAwaySeconds: 7 })
  })

  it('resets a repeated-error sequence after a successful execution', () => {
    const repository = new MemoryObserverRepository()
    const service = new ObserverService(repository, () => 100, () => crypto.randomUUID())
    service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same' })
    service.recordExecution('workspace', { exitCode: 0, durationMs: 10, errorSignature: null })
    expect(service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same' }).repeatedErrorCount).toBe(1)
  })
})
