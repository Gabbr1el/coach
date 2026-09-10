import { describe, expect, it } from 'vitest'
import { applyLearningEvidence, emptyTopicLearningState } from '../../src/application/study-progress/topic-learning'

const now = 1_000
const apply = (events: Parameters<typeof applyLearningEvidence>[1][]) => events.reduce(applyLearningEvidence, emptyTopicLearningState('workspace', 'topic', now))

describe('topic learning state', () => {
  it('distinguishes answer correctness from reasoning quality', () => {
    const initial = emptyTopicLearningState('workspace', 'topic', 1)
    const insufficient = applyLearningEvidence(initial, { type: 'CHECKPOINT_ANSWERED', correct: true, attempt: 1, reasoningStatus: 'insufficient', occurredAt: 2 })
    const coherent = applyLearningEvidence(initial, { type: 'CHECKPOINT_ANSWERED', correct: true, attempt: 1, reasoningStatus: 'coherent', occurredAt: 2 })
    const misconception = applyLearningEvidence(initial, { type: 'CHECKPOINT_ANSWERED', correct: false, reasoningStatus: 'misconception', misconception: 'Confunde valor e endereço', occurredAt: 2 })
    expect(insufficient).toMatchObject({ correctFirstTry: 0, correctAfterHelp: 0, needsReview: true, masteryEstimate: null })
    expect(coherent).toMatchObject({ correctFirstTry: 1, needsReview: false })
    expect(misconception.reasons[0]).toContain('Confunde valor e endereço')
  })
  it('never turns repeated correct alternatives with insufficient reasoning into mastery', () => {
    let state = emptyTopicLearningState('workspace', 'topic', 1)
    for (let attempt = 1; attempt <= 6; attempt += 1) state = applyLearningEvidence(state, { type: 'CHECKPOINT_ANSWERED', correct: true, attempt, reasoningStatus: 'insufficient', occurredAt: attempt + 1 })
    expect(state).toMatchObject({ assessments: 6, correctFirstTry: 0, correctAfterHelp: 0, masteryEstimate: null, needsReview: true })
  })
  it('does not treat opening or one answer as mastery', () => { const empty = emptyTopicLearningState('workspace', 'topic', now); expect(empty.masteryEstimate).toBeNull(); const one = apply([{ type: 'CHECKPOINT_ANSWERED', correct: true, attempt: 1, occurredAt: now }]); expect(one.masteryEstimate).toBeNull(); expect(one.confidence).toBe('low') })
  it('recognizes consistent fast mastery without help', () => { const state = apply([{ type: 'CHECKPOINT_ANSWERED', correct: true, attempt: 1, occurredAt: now }, { type: 'CHECKPOINT_ANSWERED', correct: true, attempt: 1, occurredAt: now + 1 }, { type: 'TOPIC_COMPLETED', exerciseCompleted: true, occurredAt: now + 2 }]); expect(state.masteryEstimate).toBeGreaterThanOrEqual(80); expect(state.difficultyLevel).toBe('low'); expect(state.needsReview).toBe(false) })
  it('weights errors, hints and reinforcement as difficulty', () => { const state = apply([{ type: 'CHECKPOINT_ANSWERED', correct: false, attempt: 1, hintUsed: true, occurredAt: now }, { type: 'CHECKPOINT_ANSWERED', correct: false, attempt: 2, hintUsed: true, reinforcementUsed: true, occurredAt: now + 1 }, { type: 'CHECKPOINT_ANSWERED', correct: true, attempt: 3, hintUsed: true, reinforcementUsed: true, occurredAt: now + 2 }]); expect(state.difficultyLevel).toBe('high'); expect(state.needsReview).toBe(true); expect(state.reasons.join(' ')).toContain('reforços') })
  it('treats repeated Coach help as secondary evidence only', () => { const once = apply([{ type: 'HELP_USED', occurredAt: now }]); expect(once.difficultyLevel).toBe('low'); expect(once.masteryEstimate).toBeNull(); const combined = apply([{ type: 'HELP_USED', occurredAt: now }, { type: 'HELP_USED', occurredAt: now + 1 }, { type: 'CHECKPOINT_ANSWERED', correct: false, occurredAt: now + 2 }]); expect(combined.difficultyLevel).toBe('medium'); expect(combined.needsReview).toBe(true) })
  it('allows later evidence to change an earlier estimate', () => { const strong = apply([{ type: 'CHECKPOINT_ANSWERED', correct: true, attempt: 1, occurredAt: now }, { type: 'CHECKPOINT_ANSWERED', correct: true, attempt: 1, occurredAt: now + 1 }, { type: 'TOPIC_COMPLETED', exerciseCompleted: true, occurredAt: now + 2 }]); const forgotten = [{ type: 'CHECKPOINT_ANSWERED' as const, correct: false, hintUsed: true, occurredAt: now + 3 }, { type: 'CHECKPOINT_ANSWERED' as const, correct: false, hintUsed: true, reinforcementUsed: true, occurredAt: now + 4 }, { type: 'CHECKPOINT_ANSWERED' as const, correct: false, hintUsed: true, reinforcementUsed: true, occurredAt: now + 5 }].reduce(applyLearningEvidence, strong); expect(forgotten.masteryEstimate).toBeLessThan(strong.masteryEstimate!); expect(forgotten.needsReview).toBe(true) })
})
