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
  it('drops every input context when context sharing is not authorized', () => {
    const route = new ContextRouter().route({ ...base, content: 'por que não funciona?', activePage: 'practice', practiceContext: { fileName: 'private.py', language: 'python', code: 'PRIVATE_CODE' }, lastExecution: { stdout: 'PRIVATE_STDOUT', stderr: 'PRIVATE_STDERR', exitCode: 1, timedOut: false } })
    expect(route).toMatchObject({ depth: 'MINIMAL', context: undefined })
  })
  it('routes live practice and execution context only when authorized', () => {
    const route = new ContextRouter().route({ ...base, content: 'por que não funciona?', activePage: 'practice', practiceContext: { fileName: 'main.py', language: 'python', code: 'print hello word' }, lastExecution: { stdout: '', stderr: 'SyntaxError: Missing parentheses', exitCode: 1, timedOut: false } }, null, { fileName: 'main.py', editorContent: '', notes: '', activePlanItem: null })
    expect(route.context).toMatchObject({ activePage: 'practice', practiceContext: { code: 'print hello word' }, lastExecution: { exitCode: 1 } })
  })
  it('omits a null execution instead of representing it as evidence', () => {
    const route = new ContextRouter().route({ ...base, activePage: 'practice', practiceContext: { fileName: 'main.py', language: 'python', code: 'print(1)' }, lastExecution: null }, null, { fileName: 'main.py', editorContent: '', notes: '', activePlanItem: null })
    expect(route.context).not.toHaveProperty('lastExecution')
  })
  it('keeps the exact selected study topic as authorized context', () => {
    const activeStudy = { roadmapId: '00000000-0000-4000-8000-000000000003', moduleId: 'module-b', module: 'Saida', topicId: 'module-b:print', topic: 'print', lessonId: 'module-b:print:lesson', currentBlockId: 'module-b:print:lesson:explanation', checkpointId: 'module-b:print:lesson:checkpoint', currentExcerpt: 'print envia texto para a saida' }
    const route = new ContextRouter().route({ ...base, content: 'não entendi essa parte', activePage: 'studies', activeStudy }, null, { fileName: '', editorContent: '', notes: '', activePlanItem: activeStudy.topic })
    expect(route.context?.activeStudy).toEqual(activeStudy)
  })
})
