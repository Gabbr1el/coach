import { describe, expect, it, vi } from 'vitest'
import { plannerRequestIdentity } from '../../src/renderer/app/planner-request-retry'

describe('plannerRequestIdentity', () => {
  it('reuses the request id after an ambiguous failure with unchanged content', () => {
    const createId = vi.fn(() => 'new-id')
    const pending = { content: 'Tenho prova amanhã', requestId: 'stable-id' }
    expect(plannerRequestIdentity(pending, pending.content, createId)).toBe(pending)
    expect(createId).not.toHaveBeenCalled()
  })

  it('creates a new request id after the content changes', () => {
    const createId = vi.fn(() => 'new-id')
    expect(plannerRequestIdentity({ content: 'Antes', requestId: 'old-id' }, 'Depois', createId)).toEqual({ content: 'Depois', requestId: 'new-id' })
    expect(createId).toHaveBeenCalledOnce()
  })
})
