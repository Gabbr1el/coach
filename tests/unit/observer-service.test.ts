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

  it('does not infer distraction from a brief window blur', () => {
    const repository = new MemoryObserverRepository()
    let now = 1_000
    const service = new ObserverService(repository, () => now, () => crypto.randomUUID())
    service.recordFocus('workspace', false)
    now = 8_000
    expect(service.recordFocus('workspace', true)).toMatchObject({ focusExitCount: 0, timeAwaySeconds: 0 })
  })

  it('records a focus exit only after a meaningful completed absence', () => {
    const repository = new MemoryObserverRepository()
    let now = 1_000
    const service = new ObserverService(repository, () => now, () => crypto.randomUUID())
    service.recordFocus('workspace', false)
    now = 21_000
    expect(service.recordFocus('workspace', true)).toMatchObject({ focusExitCount: 1, timeAwaySeconds: 20 })
  })

  it('resets a repeated-error sequence after a successful execution', () => {
    const repository = new MemoryObserverRepository()
    const service = new ObserverService(repository, () => 100, () => crypto.randomUUID())
    service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same' })
    service.recordExecution('workspace', { exitCode: 0, durationMs: 10, errorSignature: null })
    expect(service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same' }).repeatedErrorCount).toBe(1)
  })

  it('keeps a repeated error loop silent while source revisions progress', () => {
    const repository = new MemoryObserverRepository()
    const service = new ObserverService(repository, () => 100, () => crypto.randomUUID())
    service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same', sourceRevision: 'a' })
    service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same', sourceRevision: 'b' })
    expect(service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same', sourceRevision: 'c' })).toMatchObject({ repeatedErrorCount: 0, interventionSuggested: false })
    expect(repository.events.at(-1)?.type).toBe('code_executed')
    expect(JSON.parse(repository.events.at(-1)!.payloadJson)).toMatchObject({ progress: true, unresolvedError: true })
    expect(repository.events.some((event) => event.type === 'possible_learning_loop')).toBe(false)
  })

  it('does not attach an error to a topic without enough confidence', () => {
    const repository = new MemoryObserverRepository()
    const service = new ObserverService(repository, () => 100, () => crypto.randomUUID())
    service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same', topicId: 'topic', topicConfidence: 0.5 })
    expect(JSON.parse(repository.events[0]!.payloadJson)).not.toHaveProperty('topicId')
    service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'other', topicId: 'topic', topicConfidence: 0.9 })
    expect(JSON.parse(repository.events.at(-1)!.payloadJson)).toMatchObject({ topicId: 'topic' })
  })

  it('suggests each detected loop only once until success restarts detection', () => {
    const repository = new MemoryObserverRepository()
    const service = new ObserverService(repository, () => 100, () => crypto.randomUUID())
    for (let index = 0; index < 3; index += 1) service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same' })
    expect(service.getState('workspace').interventionSuggested).toBe(false)
    service.recordExecution('workspace', { exitCode: 0, durationMs: 10, errorSignature: null })
    expect(service.getState('workspace')).toMatchObject({ repeatedErrorCount: 0, interventionSuggested: false })
    for (let index = 0; index < 3; index += 1) service.recordExecution('workspace', { exitCode: 1, durationMs: 10, errorSignature: 'same' })
    expect(repository.events.filter((event) => event.type === 'possible_learning_loop')).toHaveLength(2)
  })
})
