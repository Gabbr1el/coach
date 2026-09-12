import type { ConversationMessage, SendHomeMessageInput } from '../../shared/contracts/conversation-contract'
import type { ConversationRepository } from './conversation-repository'
import type { AIProviderManager } from '../ai/ai-provider-manager'
import { COACH_POLICY } from '../ai/coach-policy'

export const HOME_THREAD_ID = '00000000-0000-4000-8000-000000000000'

export interface HomePlannerServiceDependencies {
  readonly repository: ConversationRepository
  readonly now?: () => number
  readonly createId?: () => string
  readonly providerManager?: AIProviderManager
}

function localPlannerReply(content: string): string {
  const normalized = content.toLocaleLowerCase('pt-BR')
  if (normalized.includes('prova') || normalized.includes('trabalho')) {
    return 'Usei a matéria, a data e o Workspace já conhecidos para atualizar seu contexto acadêmico e reorganizar as prioridades. Se você informar sua disponibilidade, consigo refinar a distribuição do tempo.'
  }
  if (normalized.includes('horário') || normalized.includes('trabalho de') || normalized.includes('faculdade')) {
    return 'Atualizei sua disponibilidade estruturada e recalculei o planejamento dos Workspaces relacionados.'
  }
  return 'Posso organizar seus estudos pela Home. Ainda estou em modo local, sem provedor de IA conectado. Conte qual matéria, prazo ou dificuldade você quer organizar e manterei a conversa salva para continuarmos depois.'
}

export class HomePlannerService {
  private readonly repository: ConversationRepository
  private readonly now: () => number
  private readonly createId: () => string
  private readonly providerManager: AIProviderManager | null

  constructor({ repository, now = Date.now, createId = () => crypto.randomUUID(), providerManager }: HomePlannerServiceDependencies) {
    this.repository = repository
    this.now = now
    this.createId = createId
    this.providerManager = providerManager ?? null
  }

  async listMessages(): Promise<ConversationMessage[]> {
    await this.repository.ensureHomeThread(HOME_THREAD_ID, this.now())
    return this.repository.listMessages(HOME_THREAD_ID, 100)
  }
  get threadId(): string { return HOME_THREAD_ID }
  createMessageId(): string { return this.createId() }
  async listRecentUserMessages(limit = 4): Promise<Array<Pick<ConversationMessage, 'content' | 'createdAt'>>> {
    await this.repository.ensureHomeThread(HOME_THREAD_ID, this.now())
    return (await this.repository.listMessages(HOME_THREAD_ID, Math.min(8, Math.max(2, limit * 2)))).filter((message) => message.role === 'user').slice(-Math.min(4, Math.max(2, limit))).map(({ content, createdAt }) => ({ content: content.slice(0, 300), createdAt }))
  }

  async sendMessage(input: SendHomeMessageInput): Promise<ConversationMessage[]> { return this.sendMessageWithAuthority(input, { currentTime: this.now(), currentDate: new Date(this.now()).toISOString().slice(0, 10), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, state: {}, operationResult: null, constraints: [] }) }
  async sendMessageWithAuthority(input: SendHomeMessageInput, authority: { currentTime: number; currentDate: string; timezone: string; state: unknown; operationResult: unknown; constraints: string[] }): Promise<ConversationMessage[]> {
    const now = this.now()
    await this.repository.ensureHomeThread(HOME_THREAD_ID, now)
    const userMessage = {
      id: this.createId(),
      threadId: HOME_THREAD_ID,
      role: 'user' as const,
      content: input.content.trim(),
      createdAt: now,
      providerId: null,
      modelId: null,
    }
    const provider = this.providerManager?.route('planner') ?? null
    let assistantContent = localPlannerReply(userMessage.content)
    let providerId = 'coach-local'
    let modelId = 'planner-rules-v1'

    if (provider) {
      const recentMessages = (await this.repository.listMessages(HOME_THREAD_ID, 8)).filter((message) => message.role === 'user').slice(-4).map((message) => ({ ...message, content: message.content.slice(0, 300) }))
      try {
        const response = await provider.sendMessage({
          messages: [
            { role: 'system', content: `Você é Organizador, não Tutor. Nunca ministre conteúdo acadêmico, explique conceitos ou crie exercícios. Você responde somente conversa informativa no Home e nunca executa nem escreve dados. CURRENT_DATE=${authority.currentDate} CURRENT_TIME=${new Date(authority.currentTime).toISOString()} TIMEZONE=${authority.timezone} STATE=${JSON.stringify(authority.state)} OPERATION_RESULT=${JSON.stringify(authority.operationResult)} CONSTRAINTS=${authority.constraints.join(' ')} Nunca afirme ter criado, alterado, confirmado ou proposto algo. Não invente datas, conteúdos, duração ou cronograma. Regras: ${COACH_POLICY.principles.join(' ')}` },
            ...recentMessages.map((message) => ({ role: message.role, content: message.content })),
            { role: 'user', content: userMessage.content },
          ],
          maxOutputTokens: 180,
        })
        assistantContent = response.content
        providerId = response.providerId
        modelId = response.modelId
      } catch {
        assistantContent = 'Não consegui consultar a IA conectada agora. Sua mensagem foi preservada localmente. Você pode tentar novamente depois ou continuar organizando em modo local.'
        providerId = 'coach-local'
        modelId = 'provider-failure-v1'
      }
    }

    const assistantMessage = {
      id: this.createId(),
      threadId: HOME_THREAD_ID,
      role: 'assistant' as const,
      content: assistantContent,
      createdAt: now + 1,
      providerId,
      modelId,
    }
    return this.repository.addTurn({ threadId: HOME_THREAD_ID, user: userMessage, assistant: assistantMessage })
  }

  async *streamMessage(input: SendHomeMessageInput, signal: AbortSignal): AsyncIterable<string> {
    const provider = this.providerManager?.route('planner') ?? null
    if (!provider) {
      if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
      const messages = await this.sendMessage(input)
      if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
      yield messages[1]?.content ?? ''
      return
    }
    if (!provider.streamMessage) throw new Error('Active provider does not support streaming')

    const recentMessages = (await this.repository.listMessages(HOME_THREAD_ID, 8)).filter((message) => message.role === 'user').slice(-4).map((message) => ({ ...message, content: message.content.slice(0, 300) }))
    let content = ''
    let providerId = provider.id
    let modelId = 'unknown'
    let completed = false
    try {
      for await (const event of provider.streamMessage({
        messages: [
          { role: 'system', content: `Você é Organizador, não Tutor. Nunca ministre conteúdo acadêmico, explique conceitos ou crie exercícios. Você responde somente conversa informativa no Home. Este caminho não executa nem propõe operações. CURRENT_DATE=${new Date(this.now()).toISOString().slice(0, 10)} CURRENT_TIME=${new Date(this.now()).toISOString()} TIMEZONE=${Intl.DateTimeFormat().resolvedOptions().timeZone}. Nunca afirme ter criado, alterado, confirmado ou preparado proposta. Não invente datas, conteúdos, duração ou cronograma. Regras: ${COACH_POLICY.principles.join(' ')}` },
          ...recentMessages.map((message) => ({ role: message.role, content: message.content })),
          { role: 'user', content: input.content.trim() },
        ],
        maxOutputTokens: 180,
        signal,
      })) {
        if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
        if (event.type === 'text-delta') {
          content += event.content
          if (content.length > 32_000) throw new Error('Provider response exceeded the safe limit')
          yield event.content
        } else {
          completed = true
          content = event.response.content || content
          providerId = event.response.providerId
          modelId = event.response.modelId
        }
      }
      if (!completed) throw new Error('Provider stream ended before completion')
    } catch (error) {
      if (signal.aborted) throw error
      const now = this.now()
      await this.repository.ensureHomeThread(HOME_THREAD_ID, now)
      await this.repository.addTurn({
        threadId: HOME_THREAD_ID,
        user: { id: this.createId(), threadId: HOME_THREAD_ID, role: 'user', content: input.content.trim(), createdAt: now, providerId: null, modelId: null },
        assistant: { id: this.createId(), threadId: HOME_THREAD_ID, role: 'assistant', content: 'Não consegui consultar a IA conectada agora. Sua mensagem foi preservada localmente.', createdAt: now + 1, providerId: 'coach-local', modelId: 'provider-failure-v1' },
      })
      throw error
    }

    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
    const now = this.now()
    await this.repository.ensureHomeThread(HOME_THREAD_ID, now)
    await this.repository.addTurn({
      threadId: HOME_THREAD_ID,
      user: { id: this.createId(), threadId: HOME_THREAD_ID, role: 'user', content: input.content.trim(), createdAt: now, providerId: null, modelId: null },
      assistant: { id: this.createId(), threadId: HOME_THREAD_ID, role: 'assistant', content, createdAt: now + 1, providerId, modelId },
    })
  }
  async saveAuthoritativeTurn(content: string, assistantContent: string, assistantId?: string, userId?: string): Promise<ConversationMessage[]> { const now = this.now(); await this.repository.ensureHomeThread(HOME_THREAD_ID, now); return this.repository.addTurn({ threadId: HOME_THREAD_ID, user: { id: userId ?? this.createId(), threadId: HOME_THREAD_ID, role: 'user', content, createdAt: now, providerId: null, modelId: null }, assistant: { id: assistantId ?? this.createId(), threadId: HOME_THREAD_ID, role: 'assistant', content: assistantContent, createdAt: now + 1, providerId: 'coach-local', modelId: 'home-organizer-v1' } }) }
  saveSystemResult(content: string): Promise<ConversationMessage[]> { return this.saveAuthoritativeTurn('Ação aplicada pelo botão da Organizadora.', content) }
}
