import { describe, expect, it } from 'vitest'
import { interactiveSourceRevision } from '../../src/shared/interactive-source-revision'
import { parseInteractiveValidation } from '../../src/shared/contracts/code-execution-contract'

describe('interactiveSourceRevision', () => {
  it('is deterministic and reacts to code and prediction changes', () => {
    expect(interactiveSourceRevision('abc', null)).toBe(interactiveSourceRevision('abc', null))
    expect(interactiveSourceRevision('abc', null)).not.toBe(interactiveSourceRevision('abcd', null))
    expect(interactiveSourceRevision('abc', '1')).not.toBe(interactiveSourceRevision('abc', '2'))
  })

  it('keeps a persisted legacy algorithm revision valid when content is unchanged', () => {
    const shaRevision = '1234567890abcdef1234567890abcdef'
    expect(parseInteractiveValidation({ status: 'passed', message: 'ok', sourceRevision: shaRevision, actualOutput: '1', predictionCorrect: null, validatedAt: 1 }, shaRevision)).toMatchObject({ status: 'passed' })
  })
})
