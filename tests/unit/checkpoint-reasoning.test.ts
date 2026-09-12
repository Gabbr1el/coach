import { describe, expect, it } from 'vitest'
import { AIProviderManager } from '../../src/application/ai/ai-provider-manager'
import { evaluateCheckpointReasoning, isObviouslyInsufficientReasoning, pendingAssessment } from '../../src/application/study-progress/checkpoint-reasoning'
import type { AIProvider } from '../../src/application/ai/ai-provider'
import type { StudyLessonBlock } from '../../src/shared/contracts/study-lesson-contract'

const checkpoint: Extract<StudyLessonBlock, { type: 'checkpoint' }> = { id: 'topic:check', type: 'checkpoint', title: 'Check', questionType: 'multiple_choice', question: 'Por que a saída contém um espaço?', options: [{ id: 'a', text: 'A vírgula separa argumentos', rationale: 'print usa sep com espaço por padrão.' }, { id: 'b', text: 'As aspas inserem espaço', rationale: 'Aspas delimitam o literal.', misconceptionTag: 'quotes_add_space' }, { id: 'c', text: 'O número cria espaço', rationale: 'Números não alteram o separador.', misconceptionTag: 'number_spacing' }, { id: 'd', text: 'Sempre ocorre', rationale: 'O separador pode ser configurado.', misconceptionTag: 'separator_fixed' }, { id: 'e', text: 'Não há espaço', rationale: 'A saída possui espaço.', misconceptionTag: 'output_reading' }], correctOptionId: 'a', reasoningRequirement: 'required' as const, hint: 'Observe sep', reinforcement: 'print separa argumentos' }
const input = { topic: 'print', lesson: { title: 'Saída', objective: 'Entender print', blocks: [{ id: 'secret', type: 'explanation', title: 'Contexto', content: 'x'.repeat(6000) }, checkpoint] as StudyLessonBlock[] }, checkpoint, selectedOptionId: 'a', studentJustification: 'A vírgula fornece argumentos separados e print usa um espaço como separador padrão.' }

function manager(response?: string, capture?: (content: string) => void) {
  const result = new AIProviderManager()
  if (response !== undefined) {
    const provider: AIProvider = { id: 'test', name: 'Test', testConnection: async () => {}, getCapabilities: () => ({ streaming: false, usageInformation: false, supportedInput: ['text'] }), sendMessage: async (request) => { capture?.(request.messages[1]!.content); return { content: response, providerId: 'test', modelId: 'model' } } }
    result.register(provider); result.select('test')
  }
  return result
}

describe('checkpoint reasoning assessment', () => {
  it('rejects obvious nonsense without calling a provider', async () => {
    expect(isObviouslyInsufficientReasoning('porque sim')).toBe(true)
    await expect(evaluateCheckpointReasoning(manager(undefined), { ...input, studentJustification: 'porque sim' }, 10)).resolves.toMatchObject({ status: 'insufficient', evaluatedAt: 10 })
  })
  it.each(['coherent', 'partial', 'misconception', 'insufficient', 'off_topic'] as const)('accepts strict %s assessments', async (status) => {
    await expect(evaluateCheckpointReasoning(manager(JSON.stringify({ status, summary: 'Resumo útil', misconception: status === 'misconception' ? 'Confunde aspas e separador' : null, feedback: 'Revise o separador.' })), input, 20)).resolves.toMatchObject({ status, evaluatedAt: 20 })
  })
  it('keeps provider input bounded and excludes unrelated application context', async () => {
    let sent = ''
    await evaluateCheckpointReasoning(manager(JSON.stringify({ status: 'coherent', summary: 'Ok', misconception: null, feedback: 'Continue.' }), (value) => { sent = value }), input, 30)
    expect(sent.length).toBeLessThan(8_000)
    expect(JSON.parse(sent)).toEqual(expect.objectContaining({ topic: 'print', question: checkpoint.question, selected: { id: 'a', text: checkpoint.options[0]!.text } }))
    expect(sent).not.toContain('workspaceId')
  })
  it('never fabricates coherent when provider is absent or invalid', async () => {
    await expect(evaluateCheckpointReasoning(manager(undefined), input, 40)).resolves.toMatchObject({ status: 'reasoning_evaluation_pending', retryCount: 1 })
    await expect(evaluateCheckpointReasoning(manager('{"status":"coherent","extra":true}'), input, 40)).resolves.toMatchObject({ status: 'reasoning_evaluation_pending' })
  })
  it('uses bounded exponential retry state', () => {
    expect(pendingAssessment(0, 100)).toMatchObject({ status: 'reasoning_evaluation_pending', retryCount: 1, nextRetryAt: 5_100 })
    expect(pendingAssessment(1, 100).nextRetryAt!).toBeGreaterThan(pendingAssessment(0, 100).nextRetryAt!)
    expect(pendingAssessment(99, 100).nextRetryAt).toBe(300_100)
  })
})
