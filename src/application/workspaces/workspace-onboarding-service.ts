import type { AIProviderManager } from '../ai/ai-provider-manager'
import type { ConversationRepository } from '../conversations/conversation-repository'
import type { WorkspaceTopicAnalysis } from '../../shared/contracts/workspace-onboarding-contract'
import { createSubjectLearningContext, declaredSubjectKnowledge, normalizeSubject, type SubjectLearningContext } from './subject-normalizer'

const HOME_THREAD_ID = '00000000-0000-4000-8000-000000000000'

export class WorkspaceOnboardingService {
  constructor(private readonly dependencies: { repository: ConversationRepository; providerManager: AIProviderManager; listObservedLearning?: (subject: string) => Promise<readonly string[]> | readonly string[] }) {}
  async getSubjectLearningContext(topic: string, diagnosticAnswer?: string): Promise<SubjectLearningContext> {
    const normalized = normalizeSubject(topic); const recent = await this.dependencies.repository.listMessages(HOME_THREAD_ID, 100)
    const fromTopic = normalized.userContext && declaredSubjectKnowledge(`${normalized.subject} ${normalized.userContext}`, normalized.subject) ? [normalized.userContext] : []
    const fromHistory = recent.filter((message) => message.role === 'user').map((message) => declaredSubjectKnowledge(message.content, normalized.subject)).filter((value): value is string => Boolean(value))
    const declared = diagnosticAnswer ? [...fromTopic, ...fromHistory, diagnosticAnswer] : [...fromTopic, ...fromHistory]
    const observed = await this.dependencies.listObservedLearning?.(normalized.subject) ?? []
    return createSubjectLearningContext(normalized.subject, declared, observed)
  }
  async analyze(topic: string, diagnosticAnswer?: string): Promise<WorkspaceTopicAnalysis> {
    const context = await this.getSubjectLearningContext(topic, diagnosticAnswer); const normalizedTopic = context.subject
    const provider = this.dependencies.providerManager.route('planner')
    const hasDeclaredKnowledge = context.declared.length > 0
    const objectiveContext = context.declared.at(-1)
    if (!provider) return { topic: normalizedTopic, objective: objectiveContext ? `Aprender ${normalizedTopic}. Contexto declarado: ${objectiveContext}` : `Aprender ${normalizedTopic}`, needsDiagnostic: !hasDeclaredKnowledge, question: hasDeclaredKnowledge ? null : `O que você já sabe sobre ${normalizedTopic}, e onde sente mais dificuldade?`, contextSource: diagnosticAnswer ? 'diagnostic' : hasDeclaredKnowledge ? 'general-memory' : 'none' }
    const response = await provider.sendMessage({ messages: [{ role: 'system', content: 'Você é o cérebro de onboarding do Coach. Receba memória acadêmica estruturada por assunto. Dados declared são alegações do estudante; dados observed são evidências do sistema e nunca devem ser confundidos. Apenas contexto declared concreto dispensa o diagnóstico inicial. Responda somente JSON válido com topic, objective, needsDiagnostic e question. Se diagnosticAnswer existir, needsDiagnostic deve ser false e objective deve refletir o nível. Caso contrário faça uma única pergunta curta que descubra nível, experiência e dificuldade.' }, { role: 'user', content: JSON.stringify({ requestedTopic: normalizedTopic, subjectLearningContext: context, diagnosticAnswer: diagnosticAnswer || null }) }], maxOutputTokens: 260 })
    try {
      const parsed = JSON.parse(response.content.replace(/^```json\s*|\s*```$/g, '')) as Partial<WorkspaceTopicAnalysis>
      const needsDiagnostic = diagnosticAnswer || hasDeclaredKnowledge ? false : parsed.needsDiagnostic !== false
      return { topic: normalizeSubject(String(parsed.topic || normalizedTopic)).subject.slice(0, 80), objective: String(parsed.objective || `Aprender ${normalizedTopic}`).slice(0, 500), needsDiagnostic, question: needsDiagnostic ? String(parsed.question || `O que você já sabe sobre ${normalizedTopic}?`).slice(0, 300) : null, contextSource: diagnosticAnswer ? 'diagnostic' : hasDeclaredKnowledge ? 'general-memory' : needsDiagnostic ? 'none' : 'general-memory' }
    } catch { return { topic: normalizedTopic, objective: objectiveContext ? `Aprender ${normalizedTopic}. Contexto declarado: ${objectiveContext}` : `Aprender ${normalizedTopic}`, needsDiagnostic: !hasDeclaredKnowledge, question: hasDeclaredKnowledge ? null : `O que você já sabe sobre ${normalizedTopic}, e onde sente mais dificuldade?`, contextSource: diagnosticAnswer ? 'diagnostic' : hasDeclaredKnowledge ? 'general-memory' : 'none' } }
  }
}
