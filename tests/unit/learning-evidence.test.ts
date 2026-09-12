import { describe, expect, it } from 'vitest'
import { calculateConceptMemory } from '../../src/application/learning-evidence/learning-evidence-service'
import type { LearningEvidenceRecorder, RecordLearningAttempt } from '../../src/shared/contracts/learning-evidence-contract'

const DAY = 86_400_000
const workspaceId = '00000000-0000-4000-8000-000000000001'
const row = (occurredAt: number, correct: 0 | 1, environment: 'checkpoint' | 'exercise' | 'study_interactive' | 'practice' = 'checkpoint', independent = true, helpCount = 0, assessmentVariantId = `variant-${occurredAt}`) => ({ environment, outcome: correct ? 'correct' as const : 'incorrect' as const, correct, independent: Number(independent), reasoningQuality: 'coherent' as const, occurredAt, assessmentVariantId, sourceRef: assessmentVariantId, sourceRevision: '1', helpCount })

describe('unified learning evidence and retention', () => {
  it('keeps two recent successes bounded and rewards delayed independent retrieval', () => {
    const recent = calculateConceptMemory(workspaceId, 'c', [row(0, 1), row(1_000, 1)], 2_000)
    const delayed = calculateConceptMemory(workspaceId, 'c', [row(0, 1), row(2 * DAY, 1), row(6 * DAY, 1), row(14 * DAY, 1, 'exercise')], 14 * DAY)
    expect(recent).toMatchObject({ retention: 'developing', confidence: 'low', performance: 'developing' })
    expect(recent.intervalDays).toBeLessThan(7)
    expect(delayed.intervalDays).toBeGreaterThan(recent.intervalDays)
    expect(delayed.retention).toBe('durable')
  })

  it('reduces interval for errors and help without counting help as an incorrect answer', () => {
    const base = calculateConceptMemory(workspaceId, 'c', [row(0, 1), row(2 * DAY, 1), row(6 * DAY, 1)], 6 * DAY)
    const afterError = calculateConceptMemory(workspaceId, 'c', [row(0, 1), row(2 * DAY, 1), row(6 * DAY, 1), row(7 * DAY, 0)], 7 * DAY)
    const afterHelp = calculateConceptMemory(workspaceId, 'c', [row(0, 1), row(2 * DAY, 1), row(6 * DAY, 1), { ...row(7 * DAY, 1), helpCount: 1 }], 7 * DAY)
    expect(afterError.intervalDays).toBeLessThan(base.intervalDays)
    expect(afterHelp.intervalDays).toBeLessThan(base.intervalDays)
    expect(afterHelp.errorCount).toBe(0)
    expect(afterHelp.helpEvents).toBe(1)
  })

  it('uses explicit adapters for interactive and practice in the same concept memory stream', () => {
    const recorded: RecordLearningAttempt[] = []
    const recorder: LearningEvidenceRecorder = { record: (input) => { recorded.push(input); return { attemptId: String(recorded.length), inserted: true, memory: null } } }
    const common = { workspaceId: '00000000-0000-4000-8000-000000000001', sourceRef: 'source', sourceRevision: 'rev', idempotencyKey: 'key', occurredAt: 1, outcome: 'correct' as const, correct: true, independent: true, conceptId: 'concept', prerequisiteConceptIds: [], reasoningQuality: 'not_assessed' as const, events: [{ type: 'answer_correct' as const, strength: 'strong' as const, ordinal: 0, metadata: {} }] }
    recorder.record({ ...common, environment: 'study_interactive' })
    recorder.record({ ...common, environment: 'practice', idempotencyKey: 'key-2' })
    expect(recorded.map((attempt) => [attempt.environment, attempt.conceptId])).toEqual([['study_interactive', 'concept'], ['practice', 'concept']])
  })

  it('distinguishes immediate lesson success from delayed retrieval', () => {
    const immediate = calculateConceptMemory(workspaceId, 'c', [{ ...row(DAY, 1), firstSeenAt: DAY - 1_000 }], DAY)
    const delayed = calculateConceptMemory(workspaceId, 'c', [{ ...row(8 * DAY, 1), firstSeenAt: 0 }], 8 * DAY)
    expect(delayed.intervalDays).toBeGreaterThan(immediate.intervalDays)
    expect(delayed.confidence).toBe('low')
  })

  it('does not inflate retention from immediate repeats of the same variant', () => {
    const repeated = calculateConceptMemory(workspaceId, 'c', Array.from({ length: 10 }, (_, index) => row(index * 1_000, 1, 'checkpoint', true, 0, 'same-variant')), 10_000)
    expect(repeated).toMatchObject({ performance: 'developing', retention: 'unknown', confidence: 'low' })
    expect(repeated.intervalDays).toBe(2)
    expect(repeated.successfulRetrievals).toBe(10)
  })

  it('counts two variants as distinct opportunities without claiming durable retention', () => {
    const memory = calculateConceptMemory(workspaceId, 'c', [row(0, 1, 'checkpoint', true, 0, 'variant-a'), row(1_000, 1, 'checkpoint', true, 0, 'variant-b')], 2_000)
    expect(memory).toMatchObject({ retention: 'developing', confidence: 'low', performance: 'developing', diversity: 'mixed_contexts' })
    expect(memory.intervalDays).toBeGreaterThan(2)
  })

  it('counts A,A,A,B immediate successes as two genuine opportunities only', () => {
    const memory = calculateConceptMemory(workspaceId, 'c', [
      row(0, 1, 'checkpoint', true, 0, 'variant-a'),
      row(1_000, 1, 'checkpoint', true, 0, 'variant-a'),
      row(2_000, 1, 'checkpoint', true, 0, 'variant-a'),
      row(3_000, 1, 'checkpoint', true, 0, 'variant-b'),
    ], 4_000)
    expect(memory).toMatchObject({
      successfulRetrievals: 4,
      independentSuccesses: 2,
      performance: 'developing',
      retention: 'developing',
      confidence: 'low',
      diversity: 'mixed_contexts',
    })
  })
})
