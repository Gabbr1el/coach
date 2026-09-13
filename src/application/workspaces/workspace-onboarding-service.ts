import type { AIProviderManager } from '../ai/ai-provider-manager'
import type { ConversationRepository } from '../conversations/conversation-repository'
import { workspaceTopicAnalysisStatusSchema, type WorkspaceRelatedContext, type WorkspaceTopicAnalysis, type WorkspaceTopicAnalysisStatus } from '../../shared/contracts/workspace-onboarding-contract'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { analyzeWorkspaceTopicInputSchema } from '../../shared/contracts/workspace-onboarding-contract'
import { createSubjectLearningContext, declaredSubjectKnowledge, isProgrammingSubject, normalizeSubject, type SubjectLearningContext } from './subject-normalizer'
import type { AcademicSubjectContextService } from './academic-subject-context'

const HOME_THREAD_ID = '00000000-0000-4000-8000-000000000000'
const DEFAULT_PROVIDER_TIMEOUT_MS = 1_500
const providerAnalysisSchema = z.object({ status: workspaceTopicAnalysisStatusSchema, canonicalSubject: z.string().trim().min(1).max(80), canonicalFocus: z.string().trim().min(1).max(160), explanation: z.string().trim().min(1).max(500), question: z.string().trim().min(1).max(300).nullable() }).strict()

export interface WorkspaceOnboardingContextCandidate { readonly subject: string; readonly source: 'workspace' | 'concept-memory' | 'academic-context'; readonly strength: number; readonly explanation: string }

interface SemanticAnalysis { status: WorkspaceTopicAnalysisStatus; canonicalSubject: string; canonicalFocus: string; explanation: string; question: string | null; confirmationSubject?: string }

function plain(value: string): string { return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim() }
const SUBJECT_QUALIFIERS = new Set(['fisica', 'lingua', 'linguagem', 'programacao', 'computadores', 'ciencia', 'ciencias'])
const FOCUS_QUALIFIERS = new Set([...SUBJECT_QUALIFIERS, 'fundamentos', 'introducao', 'aplicada', 'aplicado', 'basica', 'basico', 'avancada', 'avancado'])
const SEMANTIC_STOP_WORDS = new Set(['com', 'das', 'dos', 'para', 'por', 'uma', 'the', 'and', 'for', 'with'])
function semanticTokens(value: string): string[] { return (plain(value).match(/[a-z0-9+#]{3,}/g) ?? []).filter((token) => !SEMANTIC_STOP_WORDS.has(token)) }
function editDistance(left: string, right: string): number { const previous = Array.from({ length: right.length + 1 }, (_, index) => index); for (let row = 1; row <= left.length; row += 1) { let diagonal = previous[0]!; previous[0] = row; for (let column = 1; column <= right.length; column += 1) { const above = previous[column]!; previous[column] = left[row - 1] === right[column - 1] ? diagonal : Math.min(diagonal, above, previous[column - 1]!) + 1; diagonal = above } } return previous[right.length]! }
function providerInterpretationIsGrounded(topic: string, value: z.infer<typeof providerAnalysisSchema>): boolean {
  const topicTokens = semanticTokens(topic)
  const subjectTokens = semanticTokens(value.canonicalSubject)
  const focusTokens = semanticTokens(value.canonicalFocus)
  if (!topicTokens.length || !subjectTokens.length || !focusTokens.length) return false
  const overlaps = (left: string, right: string) => left === right || (Math.min(left.length, right.length) >= 5 && (left.startsWith(right) || right.startsWith(left))) || (Math.min(left.length, right.length) >= 6 && editDistance(left, right) <= 2)
  const subjectIsGrounded = topicTokens.every((token) => subjectTokens.some((candidate) => overlaps(token, candidate))) && subjectTokens.every((token) => SUBJECT_QUALIFIERS.has(token) || topicTokens.some((candidate) => overlaps(token, candidate)))
  const focusIsGrounded = focusTokens.every((token) => FOCUS_QUALIFIERS.has(token) || subjectTokens.some((candidate) => overlaps(token, candidate)))
  return subjectIsGrounded && focusIsGrounded
}
function providerStatusIsCoherent(topic: string, local: SemanticAnalysis, value: z.infer<typeof providerAnalysisSchema>): boolean {
  if (value.status === 'INVALID') return local.status === 'INVALID'
  if (value.status === 'VALID') return value.question === null
  if (value.status === 'NEEDS_CLARIFICATION') return value.question !== null
  if (value.question !== null) return false
  const requested = plain(topic).replace(/\s+/g, ' ')
  const canonical = plain(value.canonicalSubject).replace(/\s+/g, ' ')
  return local.status === 'NEEDS_CONFIRMATION' || requested !== canonical
}
function fallbackSemantic(topic: string): SemanticAnalysis {
  const value = plain(topic).replace(/\s+/g, ' ')
  if (/^(?:c|linguagem c)$/.test(value)) return { status: 'NEEDS_CONFIRMATION', canonicalSubject: 'Linguagem C', canonicalFocus: 'Programação em C', explanation: 'Interpretei “C” como a linguagem de programação C, não como uma sigla ou conceito isolado.', question: null, confirmationSubject: 'Linguagem C' }
  if (/^(?:poo|programacao orientada a objetos?)$/.test(value)) return { status: 'NEEDS_CLARIFICATION', canonicalSubject: 'Programação Orientada a Objetos', canonicalFocus: 'Programação Orientada a Objetos', explanation: 'Expandi POO para Programação Orientada a Objetos. A linguagem de implementação pode contextualizar os exemplos, mas não é obrigatória.', question: 'Se quiser contextualizar os exemplos, qual linguagem de implementação você prefere?' }
  if (/^estruturas? de dados$/.test(value)) return { status: 'VALID', canonicalSubject: 'Estrutura de Dados', canonicalFocus: 'Estrutura de Dados', explanation: 'Reconheci uma disciplina acadêmica de Estrutura de Dados; a linguagem é contexto opcional.', question: 'Há alguma linguagem ou experiência anterior que você queira usar como contexto?' }
  if (/^(?:ingles|english)$/.test(value)) return { status: 'VALID', canonicalSubject: 'Inglês', canonicalFocus: 'Inglês', explanation: 'Reconheci Inglês como área de estudo. Não preciso de informação adicional para criar o Workspace.', question: null }
  if (/^(?:matematica|math|mathematics)$/.test(value)) return { status: 'VALID', canonicalSubject: 'Matemática', canonicalFocus: 'Matemática', explanation: 'Reconheci Matemática como área de estudo. Não preciso de informação adicional para criar o Workspace.', question: null }
  if (/^(?:matematca|matemtica|matematia)$/.test(value)) return { status: 'NEEDS_CONFIRMATION', canonicalSubject: 'Matemática', canonicalFocus: 'Matemática', explanation: `Corrigi o provável erro de digitação “${topic.trim()}” para “Matemática”.`, question: null, confirmationSubject: 'Matemática' }
  if (/^(?:asdf|asdfg|asdfgh|qwerty|xyzzy|teste teste|aaa+|kkk+)$/.test(value) || !/[aeiou]/.test(value) || /(.)\1{3}/.test(value)) return { status: 'INVALID', canonicalSubject: '', canonicalFocus: '', explanation: 'Não reconheci um tema acadêmico ou habilidade estudável. Informe uma disciplina, assunto ou habilidade específica.', question: null }
  if (!/^[\p{L}\p{N}+#.()\s-]{2,80}$/u.test(topic.trim())) return { status: 'INVALID', canonicalSubject: '', canonicalFocus: '', explanation: 'O tema informado não parece uma disciplina, assunto ou habilidade estudável.', question: null }
  const subject = normalizeSubject(topic).subject
  return { status: 'NEEDS_CLARIFICATION', canonicalSubject: subject, canonicalFocus: subject, explanation: `Interpretei “${topic.trim()}” como “${subject}”. Você pode criar agora ou acrescentar um contexto opcional.`, question: `Há algum recorte ou experiência anterior relevante para ${subject}?` }
}

function implementationFrom(answer: string): string | null {
  const normalized = plain(answer)
  if (/\b(?:nao|no|nunca|jamais|sem|evite|evitar|never|don't|dont|do not|avoid|without)\b/.test(normalized)) return null
  const languages = [{ pattern: /\b(?:linguagem\s+)?c\b/g, subject: 'C' }, { pattern: /\bpython\b/g, subject: 'Python' }, { pattern: /\btypescript\b/g, subject: 'TypeScript' }, { pattern: /\bjavascript\b/g, subject: 'JavaScript' }, { pattern: /\bjava\b/g, subject: 'Java' }]
  const mentions = languages.flatMap((language) => [...normalized.matchAll(language.pattern)].map(() => language.subject))
  const distinct = [...new Set(mentions)]
  if (distinct.length !== 1) return null
  return distinct[0] ?? null
}

export class WorkspaceOnboardingService {
  private readonly analyses = new Map<string, { revision: number; subject: string; focus: string; context: string; explanation: string; status: WorkspaceTopicAnalysisStatus; creatable: boolean }>()
  constructor(private readonly dependencies: { repository: ConversationRepository; providerManager: AIProviderManager; academicContext?: AcademicSubjectContextService; listObservedLearning?: (subject: string) => Promise<readonly string[]> | readonly string[]; listContextCandidates?: (subject: string) => Promise<readonly WorkspaceOnboardingContextCandidate[]> | readonly WorkspaceOnboardingContextCandidate[]; providerTimeoutMs?: number }) {}
  async getSubjectLearningContext(topic: string, diagnosticAnswer?: string): Promise<SubjectLearningContext> {
    const normalized = normalizeSubject(topic); const persisted = this.dependencies.academicContext?.get(normalized.subject)
    if (persisted) return createSubjectLearningContext(normalized.subject, [...persisted.declaredKnowledge, ...persisted.declaredDifficulties, ...persisted.goals, ...(diagnosticAnswer ? [diagnosticAnswer] : [])], await this.dependencies.listObservedLearning?.(normalized.subject) ?? [])
    const recent = await this.dependencies.repository.listMessages(HOME_THREAD_ID, 100)
    const fromTopic = normalized.userContext && declaredSubjectKnowledge(`${normalized.subject} ${normalized.userContext}`, normalized.subject) ? [normalized.userContext] : []
    const fromHistory = recent.filter((message) => message.role === 'user').map((message) => declaredSubjectKnowledge(message.content, normalized.subject)).filter((value): value is string => Boolean(value))
    const declared = diagnosticAnswer ? [...fromTopic, ...fromHistory, diagnosticAnswer] : [...fromTopic, ...fromHistory]
    const observed = await this.dependencies.listObservedLearning?.(normalized.subject) ?? []
    const context = createSubjectLearningContext(normalized.subject, declared, observed)
    if (context.declared.length) this.dependencies.academicContext?.record({ subject: normalized.subject, declaredLevel: null, declaredKnowledge: [...context.declared], declaredDifficulties: [], goals: [], sourceEvidence: [...context.declared] })
    return context
  }
  async analyze(topic: string, diagnosticAnswer?: string, choices: Pick<z.infer<typeof analyzeWorkspaceTopicInputSchema>, 'confirmation' | 'fundamentals' | 'implementationLanguage'> = {}): Promise<WorkspaceTopicAnalysis> {
    const fallback = fallbackSemantic(topic)
    let semantic = fallback
    const provider = this.dependencies.providerManager.route('planner')
    if (choices.confirmation) {
      const prior = this.analyses.get(choices.confirmation.analysisToken)
      if (!prior || prior.revision !== choices.confirmation.revision || prior.status !== 'NEEDS_CONFIRMATION' || prior.subject !== choices.confirmation.canonicalSubject || prior.focus !== choices.confirmation.canonicalFocus || normalizeSubject(topic).subject !== normalizeSubject(prior.subject).subject) throw new Error('Workspace interpretation confirmation is stale or mismatched')
      this.analyses.delete(choices.confirmation.analysisToken)
      semantic = { status: 'VALID', canonicalSubject: prior.subject, canonicalFocus: prior.focus, explanation: `${prior.explanation} Interpretação confirmada.`, question: null }
    } else if (provider && fallback.status !== 'INVALID') {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Workspace topic provider timed out')) }, this.dependencies.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS) })
        const response = await Promise.race([provider.sendMessage({ messages: [{ role: 'system', content: 'Analise somente o tema fornecido. Você pode normalizar grafia, expandir abreviação ou especificar um foco diretamente relacionado, mas nunca substituir por outro assunto. Retorne SOMENTE JSON estrito: {status:VALID|NEEDS_CONFIRMATION|NEEDS_CLARIFICATION|INVALID,canonicalSubject,canonicalFocus,explanation,question}. question deve ser null ou uma única pergunta opcional. Não invente currículo, domínio ou evidência.' }, { role: 'user', content: JSON.stringify({ topic: topic.trim() }) }], maxOutputTokens: 300, signal: controller.signal }), timeout])
        const parsed = providerAnalysisSchema.parse(JSON.parse(response.content.replace(/^```json\s*|\s*```$/g, '')))
        if (providerInterpretationIsGrounded(topic, parsed) && providerStatusIsCoherent(topic, fallback, parsed)) semantic = parsed
      } catch {} finally { if (timer) clearTimeout(timer) }
    }
    if (!choices.confirmation && (fallback.status === 'INVALID' || fallback.confirmationSubject || /^(?:poo|programacao orientada a objetos?|estruturas? de dados|ingles|english|matematica|math|mathematics)$/i.test(plain(topic)))) semantic = fallback
    if (semantic.status === 'INVALID') {
      const finishInvalid = this.finish({ status: 'INVALID', explanation: semantic.explanation, topic: topic.trim(), canonicalSubject: '', canonicalFocus: '', canonicalContext: '', objective: '', needsDiagnostic: false, question: null, questionOptional: false, contextSource: 'none', declaredLevel: null, declaredKnowledge: [], declaredDifficulties: [], declarations: [], evidence: [], goals: [], relatedContexts: [], isProgramming: false, needsFundamentals: false, fundamentals: null, implementationLanguage: null, needsImplementationLanguage: false, localKnowledgeProjection: '' })
      return finishInvalid
    }
    const normalizedTopic = semantic.canonicalSubject
    let persisted = this.dependencies.academicContext?.get(normalizedTopic)
    const context = await this.getSubjectLearningContext(normalizedTopic, diagnosticAnswer)
    persisted ??= this.dependencies.academicContext?.get(normalizedTopic) ?? null
    const hasDeclaredKnowledge = context.declared.length > 0
    const candidates = [...(await this.dependencies.listContextCandidates?.(normalizedTopic) ?? []), ...(this.dependencies.academicContext?.list().filter((item) => item.subject !== normalizedTopic).map((item) => ({ subject: item.subject, source: 'academic-context' as const, strength: (item.declaredLevel === 'advanced' ? 80 : item.declaredLevel === 'intermediate' ? 60 : 30) + item.declaredKnowledge.length * 5, explanation: `Contexto acadêmico existente em ${item.subject}` })) ?? [])].filter((candidate, index, values) => values.findIndex((item) => plain(item.subject) === plain(candidate.subject)) === index).sort((a, b) => (b.strength + (plain(b.subject) === 'c' ? 10 : 0)) - (a.strength + (plain(a.subject) === 'c' ? 10 : 0)))
    const answerImplementation = diagnosticAnswer ? implementationFrom(diagnosticAnswer) : null
    const acceptsImplementationContext = /programa|estrutura de dados/i.test(plain(normalizedTopic))
    const inferredImplementation = diagnosticAnswer ? answerImplementation : (acceptsImplementationContext ? candidates.find((item) => ['c', 'linguagem c', 'python', 'java', 'javascript', 'typescript'].includes(plain(item.subject)))?.subject ?? 'C' : null)
    const relatedContexts: WorkspaceRelatedContext[] = inferredImplementation ? [{ subject: inferredImplementation, relation: 'implementation_language', explanation: answerImplementation ? `Você indicou ${inferredImplementation} na resposta opcional.` : candidates.find((item) => item.subject === inferredImplementation)?.explanation ?? `Sem contexto relacionado anterior, ${inferredImplementation} foi adotada como linguagem de implementação inicial e pode ser ajustada depois.`, context: this.dependencies.academicContext?.get(inferredImplementation) ?? null }] : []
    const canonicalFocus = inferredImplementation ? `${semantic.canonicalFocus} em ${inferredImplementation}` : semantic.canonicalFocus
    const canonicalContext = [diagnosticAnswer ? `declaração:${diagnosticAnswer}` : '', inferredImplementation ? `linguagem:${inferredImplementation}` : '', !diagnosticAnswer && !inferredImplementation && semantic.question ? 'contexto acadêmico geral' : ''].filter(Boolean).join(' | ')
    const objective = persisted?.goals.at(-1) ?? `Aprender ${canonicalFocus}`
    const declarations = [...(persisted?.sourceEvidence ?? []), ...context.declared]
    const evidence = [...context.observed]
    const question = diagnosticAnswer ? null : semantic.question
    return this.finish({ status: semantic.status, explanation: semantic.explanation, topic: normalizedTopic, objective, needsDiagnostic: semantic.status === 'NEEDS_CONFIRMATION', question, questionOptional: Boolean(question), contextSource: persisted ? 'academic-context' : diagnosticAnswer ? 'diagnostic' : inferredImplementation ? 'workspace-context' : hasDeclaredKnowledge ? 'general-memory' : 'fallback', canonicalSubject: normalizedTopic, canonicalFocus, canonicalContext, declaredLevel: persisted?.declaredLevel ?? null, declaredKnowledge: persisted?.declaredKnowledge ?? context.declared, declaredDifficulties: persisted?.declaredDifficulties ?? [], declarations, evidence, goals: persisted?.goals ?? [], relatedContexts, isProgramming: isProgrammingSubject(normalizedTopic), needsFundamentals: false, fundamentals: choices.fundamentals ?? null, implementationLanguage: choices.implementationLanguage ?? null, needsImplementationLanguage: false, localKnowledgeProjection: [...(persisted?.declaredKnowledge ?? context.declared), ...(persisted?.declaredDifficulties ?? []).map((item) => `Dificuldade declarada: ${item}`), ...(diagnosticAnswer ? [`Contexto declarado: ${diagnosticAnswer}`] : []), ...(inferredImplementation ? [`Contexto relacionado: ${inferredImplementation}`] : [])].join('\n') })
  }
  private finish(value: Omit<WorkspaceTopicAnalysis, 'analysisToken' | 'revision'>): WorkspaceTopicAnalysis { const revision = Date.now(); const analysisToken = randomUUID(); this.analyses.set(analysisToken, { revision, subject: value.canonicalSubject, focus: value.canonicalFocus, context: value.canonicalContext, explanation: value.explanation, status: value.status, creatable: value.status === 'VALID' || value.status === 'NEEDS_CLARIFICATION' }); if (this.analyses.size > 100) this.analyses.delete(this.analyses.keys().next().value!); return { ...value, revision, analysisToken } }
  validate(token: string, revision: number, subject: string, focus = '', context = ''): boolean { const value = this.analyses.get(token); return Boolean(value?.creatable && value.revision === revision && normalizeSubject(value.subject).subject === normalizeSubject(subject).subject && value.focus === focus && value.context === context) }
}
