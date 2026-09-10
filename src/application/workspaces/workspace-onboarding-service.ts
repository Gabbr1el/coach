import type { AIProviderManager } from '../ai/ai-provider-manager'
import type { ConversationRepository } from '../conversations/conversation-repository'
import type { WorkspaceTopicAnalysis } from '../../shared/contracts/workspace-onboarding-contract'
import type { z } from 'zod'
import type { analyzeWorkspaceTopicInputSchema } from '../../shared/contracts/workspace-onboarding-contract'
import { createSubjectLearningContext, declaredSubjectKnowledge, isProgrammingSubject, normalizeSubject, workspaceAnalysisSignature, type SubjectLearningContext } from './subject-normalizer'
import type { AcademicSubjectContextService } from './academic-subject-context'

const HOME_THREAD_ID = '00000000-0000-4000-8000-000000000000'

export class WorkspaceOnboardingService {
  constructor(private readonly dependencies: { repository: ConversationRepository; providerManager: AIProviderManager; academicContext?: AcademicSubjectContextService; listObservedLearning?: (subject: string) => Promise<readonly string[]> | readonly string[] }) {}
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
  async analyze(topic: string, diagnosticAnswer?: string, choices: Pick<z.infer<typeof analyzeWorkspaceTopicInputSchema>, 'fundamentals' | 'implementationLanguage'> = {}): Promise<WorkspaceTopicAnalysis> {
    const normalized = normalizeSubject(topic); let persisted = this.dependencies.academicContext?.get(normalized.subject); const context = await this.getSubjectLearningContext(topic, diagnosticAnswer); persisted ??= this.dependencies.academicContext?.get(normalized.subject) ?? null; const normalizedTopic = context.subject
    const provider = this.dependencies.providerManager.route('planner')
    const hasDeclaredKnowledge = context.declared.length > 0
    const objectiveContext = context.declared.at(-1)
    const isProgramming = isProgrammingSubject(topic)
    const needsImplementationLanguage = /estrutura(?:s)? de dados/i.test(normalizedTopic) && !choices.implementationLanguage
    const confidenceAbsent = !persisted?.declaredLevel && context.observed.length === 0
    const needsFundamentals = isProgramming && confidenceAbsent && !choices.fundamentals
    const relatedContexts = this.dependencies.academicContext?.list().filter((item) => item.subject !== normalizedTopic) ?? []
    const implementationSubject = choices.implementationLanguage ? ({ python: 'Python', c: 'C', java: 'Java', javascript: 'JavaScript', typescript: 'TypeScript', other: 'Outra linguagem' } as const)[choices.implementationLanguage] : null
    const canonicalFocus = implementationSubject ? `${normalizedTopic} em ${implementationSubject}` : normalizedTopic
    const canonicalContext = [diagnosticAnswer, choices.fundamentals ? `fundamentos:${choices.fundamentals}` : '', implementationSubject ? `linguagem:${implementationSubject}` : ''].filter(Boolean).join(' | ')
    const objective = persisted?.goals.at(-1) ?? (objectiveContext ? `Aprender ${canonicalFocus}. Contexto declarado: ${objectiveContext}` : `Aprender ${canonicalFocus}`)
    const declarations = [...(persisted?.sourceEvidence ?? []), ...context.declared]
    const evidence = [...context.observed]
    const details = { canonicalSubject: normalizedTopic, canonicalFocus, canonicalContext, declaredLevel: persisted?.declaredLevel ?? null, declaredKnowledge: persisted?.declaredKnowledge ?? context.declared, declaredDifficulties: persisted?.declaredDifficulties ?? [], declarations, evidence, goals: persisted?.goals ?? [], relatedContexts, isProgramming, needsFundamentals, fundamentals: choices.fundamentals ?? null, implementationLanguage: choices.implementationLanguage ?? null, needsImplementationLanguage, localKnowledgeProjection: [...(persisted?.declaredKnowledge ?? context.declared), ...(persisted?.declaredDifficulties ?? []).map((item) => `Dificuldade: ${item}`), ...evidence.map((item) => `Evidência observada: ${item}`)].join('\n') }
    const finish = (value: Omit<WorkspaceTopicAnalysis, 'analysisToken' | 'revision'>): WorkspaceTopicAnalysis => { const revision = Date.now(); return { ...value, revision, analysisToken: `${revision}.${workspaceAnalysisSignature(value.canonicalSubject, value.canonicalFocus, value.canonicalContext)}` } }
    const blockingQuestion = needsImplementationLanguage ? `Qual linguagem você quer usar para implementar ${normalizedTopic}?` : needsFundamentals ? 'Você já domina fundamentos de programação? Escolha sim, não ou não sei; isso calibra a Trilha sem presumir domínio.' : !hasDeclaredKnowledge && !diagnosticAnswer ? `O que você já sabe sobre ${normalizedTopic}, e onde sente mais dificuldade?` : null
    if (!provider || blockingQuestion) return finish({ topic: normalizedTopic, objective, needsDiagnostic: Boolean(blockingQuestion), question: blockingQuestion, contextSource: persisted ? 'academic-context' : diagnosticAnswer ? 'diagnostic' : hasDeclaredKnowledge ? 'general-memory' : 'none', ...details })
    const response = await provider.sendMessage({ messages: [{ role: 'system', content: 'Você é o cérebro de onboarding do Coach. Receba memória acadêmica estruturada por assunto. Dados declared são alegações do estudante; dados observed são evidências do sistema e nunca devem ser confundidos. Apenas contexto declared concreto dispensa o diagnóstico inicial. Responda somente JSON válido com topic, objective, needsDiagnostic e question. Se diagnosticAnswer existir, needsDiagnostic deve ser false e objective deve refletir o nível. Caso contrário faça uma única pergunta curta que descubra nível, experiência e dificuldade.' }, { role: 'user', content: JSON.stringify({ requestedTopic: normalizedTopic, subjectLearningContext: context, diagnosticAnswer: diagnosticAnswer || null }) }], maxOutputTokens: 260 })
    try {
      const parsed = JSON.parse(response.content.replace(/^```json\s*|\s*```$/g, '')) as Partial<WorkspaceTopicAnalysis>
      const needsDiagnostic = diagnosticAnswer || hasDeclaredKnowledge ? false : parsed.needsDiagnostic !== false
      return finish({ topic: normalizeSubject(String(parsed.topic || normalizedTopic)).subject.slice(0, 80), objective: String(parsed.objective || objective).slice(0, 500), needsDiagnostic, question: needsDiagnostic ? String(parsed.question || `O que você já sabe sobre ${normalizedTopic}?`).slice(0, 300) : null, contextSource: persisted ? 'academic-context' : diagnosticAnswer ? 'diagnostic' : hasDeclaredKnowledge ? 'general-memory' : needsDiagnostic ? 'none' : 'general-memory', ...details })
    } catch { return finish({ topic: normalizedTopic, objective, needsDiagnostic: false, question: null, contextSource: persisted ? 'academic-context' : diagnosticAnswer ? 'diagnostic' : hasDeclaredKnowledge ? 'general-memory' : 'none', ...details }) }
  }
}
