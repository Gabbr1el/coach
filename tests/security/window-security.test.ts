import { describe, expect, it } from 'vitest'
import { APPLICATION_API_VERSION } from '../../src/shared/contracts/application-contract'

describe('application contract', () => {
  it('starts with an explicit API version', () => {
    expect(APPLICATION_API_VERSION).toBe(1)
  })
})
