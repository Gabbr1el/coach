import { describe, expect, it } from 'vitest'
import { ContextRouter } from '../../src/application/ai/context-router'

const base = { requestId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002', content: 'Olá' }

describe('ContextRouter', () => {
  it('uses minimal context and a compact default budget', () => {
    expect(new ContextRouter().route(base)).toMatchObject({ depth: 'MINIMAL', outputBudget: 'NORMAL_EXPLANATION', maxOutputTokens: 240, context: undefined })
  })
  it('routes explicit help to session context and a short answer', () => {
    expect(new ContextRouter().route({ ...base, content: 'Me dê uma dica sobre este erro' }, null, { fileName: 'main.py', editorContent: '', notes: '', activePlanItem: null })).toMatchObject({ depth: 'SESSION', outputBudget: 'SHORT_EXPLANATION', helpLevel: 2 })
  })
  it('prioritizes a short level-one intervention during a loop', () => {
    expect(new ContextRouter().route(base, { active: true, repeatedErrorCount: 3, interventionSuggested: true, focusExitCount: 0, timeAwaySeconds: 0 })).toMatchObject({ outputBudget: 'HINT', helpLevel: 1, maxOutputTokens: 160 })
  })
  it('routes live practice context even when persisted context sharing is off', () => {
    const route = new ContextRouter().route({ ...base, content: 'por que não funciona?', activePage: 'practice', practiceContext: { fileName: 'main.py', language: 'python', code: 'print hello word' }, lastExecution: { stdout: '', stderr: 'SyntaxError: Missing parentheses', exitCode: 1, timedOut: false } })
    expect(route.context).toMatchObject({ activePage: 'practice', practiceContext: { code: 'print hello word' }, lastExecution: { exitCode: 1 } })
  })
  it('keeps the exact selected study topic as authorized context', () => {
    const activeStudy = { moduleId: 'module-b', module: 'Saida', topicId: 'module-b:print', topic: 'print', lessonId: 'module-b:print:lesson', checkpointId: 'module-b:print:lesson:checkpoint', currentExcerpt: 'print envia texto para a saida' }
    const route = new ContextRouter().route({ ...base, content: 'não entendi essa parte', activePage: 'studies', activeStudy })
    expect(route.context?.activeStudy).toEqual(activeStudy)
  })
})
