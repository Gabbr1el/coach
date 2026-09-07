import type { AIProviderManager } from '../ai/ai-provider-manager'
import type { ConversationRepository } from '../conversations/conversation-repository'
import type { WorkspaceTopicAnalysis } from '../../shared/contracts/workspace-onboarding-contract'
import { normalizeSubject } from './subject-normalizer'

const HOME_THREAD_ID = '00000000-0000-4000-8000-000000000000'

export class WorkspaceOnboardingService {
  constructor(private readonly dependencies: { repository: ConversationRepository; providerManager: AIProviderManager }) {}
  async analyze(topic: string, diagnosticAnswer?: string): Promise<WorkspaceTopicAnalysis> {
    const normalized = normalizeSubject(topic); const normalizedTopic = normalized.subject
    const recent = await this.dependencies.repository.listMessages(HOME_THREAD_ID, 100)
    const userMemory = recent.filter((message) => message.role === 'user').map((message) => message.content).join('\n').slice(-12000)
    const provider = this.dependencies.providerManager.route('planner')
    if (!provider) return { topic: normalizedTopic, objective: diagnosticAnswer ? `Aprender ${normalizedTopic}. Contexto: ${diagnosticAnswer}` : normalized.userContext ? `Aprender ${normalizedTopic}. Contexto: ${normalized.userContext}` : `Aprender ${normalizedTopic}`, needsDiagnostic: !diagnosticAnswer, question: diagnosticAnswer ? null : `O que você já sabe sobre ${normalizedTopic}, e onde sente mais dificuldade?`, contextSource: diagnosticAnswer ? 'diagnostic' : 'none' }
    const response = await provider.sendMessage({ messages: [{ role: 'system', content: 'Você é o cérebro de onboarding do Coach. Avalie se a memória geral contém uma descrição CONCRETA do conhecimento do usuário sobre o tema. Apenas mencionar o tema ou querer estudá-lo não conta. Responda somente JSON válido com topic, objective, needsDiagnostic e question. Se diagnosticAnswer existir, needsDiagnostic deve ser false e objective deve refletir o nível. Se a memória já contém conhecimento concreto, needsDiagnostic=false. Caso contrário faça uma única pergunta curta que descubra nível, experiência e dificuldade.' }, { role: 'user', content: JSON.stringify({ requestedTopic: normalizedTopic, generalMemory: userMemory || null, diagnosticAnswer: diagnosticAnswer || null }) }], maxOutputTokens: 260 })
    try {
      const parsed = JSON.parse(response.content.replace(/^```json\s*|\s*```$/g, '')) as Partial<WorkspaceTopicAnalysis>
      const needsDiagnostic = diagnosticAnswer ? false : parsed.needsDiagnostic !== false
      return { topic: normalizeSubject(String(parsed.topic || normalizedTopic)).subject.slice(0, 80), objective: String(parsed.objective || `Aprender ${normalizedTopic}`).slice(0, 500), needsDiagnostic, question: needsDiagnostic ? String(parsed.question || `O que você já sabe sobre ${normalizedTopic}?`).slice(0, 300) : null, contextSource: diagnosticAnswer ? 'diagnostic' : needsDiagnostic ? 'none' : 'general-memory' }
    } catch { return { topic: normalizedTopic, objective: `Aprender ${normalizedTopic}`, needsDiagnostic: !diagnosticAnswer, question: diagnosticAnswer ? null : `O que você já sabe sobre ${normalizedTopic}, e onde sente mais dificuldade?`, contextSource: diagnosticAnswer ? 'diagnostic' : 'none' } }
  }
}
