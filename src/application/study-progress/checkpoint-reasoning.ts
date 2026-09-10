import { z } from 'zod'
import type { AIProviderManager } from '../ai/ai-provider-manager'
import type { StudyLessonBlock } from '../../shared/contracts/study-lesson-contract'
import { checkpointReasoningAssessmentSchema, type CheckpointReasoningAssessment } from '../../shared/contracts/study-progress-contract'

type Checkpoint = Extract<StudyLessonBlock, { type: 'checkpoint' }>

const providerAssessmentSchema = z.object({
  status: z.enum(['coherent', 'partial', 'misconception', 'insufficient', 'off_topic']),
  summary: z.string().trim().min(1).max(600),
  misconception: z.string().trim().min(1).max(600).nullable(),
  feedback: z.string().trim().min(1).max(1000),
}).strict()

const nonsensePhrases = new Set([
  'porque sim', 'por que sim', 'sei la', 'nao sei', 'não sei', 'qualquer coisa', 'tanto faz',
  'chutei', 'chute', 'sla', 'asdf', 'qwerty', 'teste', 'testando', '...', '???',
])

export function isObviouslyInsufficientReasoning(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase('pt-BR').replace(/[.!?,;:]+$/g, '').replace(/\s+/g, ' ')
  if (normalized.length < 8 || nonsensePhrases.has(normalized)) return true
  if (/^(.)\1{5,}$/u.test(normalized.replace(/\s/g, ''))) return true
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  return words.length < 3 || new Set(words).size === 1
}

function lessonContext(blocks: StudyLessonBlock[], checkpointId: string): Array<{ id: string; type: string; text: string }> {
  const result: Array<{ id: string; type: string; text: string }> = []
  let remaining = 4_000
  for (const block of blocks) {
    if (block.id === checkpointId || remaining <= 0) break
    const raw = 'content' in block ? block.content : block.type === 'codeExample' ? `${block.code}\n${block.walkthrough.join('\n')}` : block.type === 'interactiveCode' || block.type === 'miniExercise' ? block.instruction : ''
    if (!raw) continue
    const text = raw.slice(0, Math.min(remaining, 1_200))
    result.push({ id: block.id.slice(0, 420), type: block.type, text })
    remaining -= text.length
  }
  return result.slice(-6)
}

export interface ReasoningEvaluationInput {
  topic: string
  lesson: { title: string; objective: string; blocks: StudyLessonBlock[] }
  checkpoint: Checkpoint
  selectedOptionId: string
  studentJustification: string
}

export async function evaluateCheckpointReasoning(
  providerManager: AIProviderManager,
  input: ReasoningEvaluationInput,
  now = Date.now(),
): Promise<CheckpointReasoningAssessment> {
  if (isObviouslyInsufficientReasoning(input.studentJustification)) return {
    status: 'insufficient',
    summary: 'A justificativa não apresenta raciocínio verificável.',
    misconception: null,
    feedback: 'Explique a relação entre a alternativa e o conceito da pergunta com suas próprias palavras.',
    evaluatedAt: now,
    retryCount: 0,
    nextRetryAt: null,
  }

  const provider = providerManager.route('lesson')
  if (!provider) return pendingAssessment(0, now)
  const selected = input.checkpoint.options.find((option) => option.id === input.selectedOptionId)!
  const correct = input.checkpoint.options.find((option) => option.id === input.checkpoint.correctOptionId)!
  const request = {
    topic: input.topic.slice(0, 300),
    lesson: { title: input.lesson.title.slice(0, 200), objective: input.lesson.objective.slice(0, 600), context: lessonContext(input.lesson.blocks, input.checkpoint.id) },
    question: input.checkpoint.question,
    options: input.checkpoint.options.map(({ id, text }) => ({ id, text })),
    selected: { id: selected.id, text: selected.text },
    justification: input.studentJustification,
    correctRationale: correct.rationale,
    predictedMisconceptions: input.checkpoint.options.flatMap((option) => option.misconceptionTag ? [{ optionId: option.id, tag: option.misconceptionTag }] : []),
  }
  try {
    const response = await provider.sendMessage({
      messages: [
        { role: 'system', content: 'Avalie somente o raciocínio escrito, nunca a correção da alternativa. Não infira compreensão ausente. Use coherent apenas quando a justificativa explica corretamente a relação causal/conceitual; partial para compreensão real mas incompleta; misconception para um modelo mental incorreto identificável; insufficient para texto sem explicação avaliável; off_topic para explicação sem relação com a pergunta. Retorne APENAS um objeto JSON exato com status, summary, misconception (string ou null) e feedback. Não inclua markdown nem chaves adicionais.' },
        { role: 'user', content: JSON.stringify(request) },
      ],
      maxOutputTokens: 700,
      signal: AbortSignal.timeout(30_000),
    })
    const parsed = providerAssessmentSchema.parse(JSON.parse(response.content.trim()))
    return checkpointReasoningAssessmentSchema.parse({ ...parsed, evaluatedAt: now, retryCount: 0, nextRetryAt: null })
  } catch {
    return pendingAssessment(0, now)
  }
}

export function pendingAssessment(previousRetries: number, now: number): CheckpointReasoningAssessment {
  const retryCount = previousRetries + 1
  return {
    status: 'reasoning_evaluation_pending',
    summary: null,
    misconception: null,
    feedback: null,
    evaluatedAt: null,
    retryCount,
    nextRetryAt: now + Math.min(300_000, 5_000 * (2 ** Math.min(retryCount - 1, 6))),
  }
}
