import { describe, expect, it } from 'vitest'
import { ContextRouter } from '../../src/application/ai/context-router'

const base = { requestId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002', content: 'Olá' }

describe('ContextRouter', () => {
  it('uses minimal context and a compact default budget', () => {
    expect(new ContextRouter().route(base)).toMatchObject({ depth: 'MINIMAL', outputBudget: 'NORMAL_EXPLANATION', maxOutputTokens: 520, context: undefined })
  })
  it('routes explicit help to session context and a short answer', () => {
    expect(new ContextRouter().route({ ...base, content: 'Me dê uma dica sobre este erro', studyContext: { fileName: 'main.py', editorContent: '', notes: '', activePlanItem: null } })).toMatchObject({ depth: 'SESSION', outputBudget: 'SHORT_EXPLANATION', helpLevel: 2 })
  })
  it('prioritizes a short level-one intervention during a loop', () => {
    expect(new ContextRouter().route(base, { active: true, repeatedErrorCount: 3, interventionSuggested: true, focusExitCount: 0, timeAwaySeconds: 0 })).toMatchObject({ outputBudget: 'HINT', helpLevel: 1, maxOutputTokens: 260 })
  })
})
