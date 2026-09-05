import type { ConversationMessage, SendHomeMessageInput } from '../../shared/contracts/conversation-contract'
import type { ConversationRepository } from './conversation-repository'

const HOME_THREAD_ID = '00000000-0000-4000-8000-000000000000'

export interface HomePlannerServiceDependencies {
  readonly repository: ConversationRepository
  readonly now?: () => number
  readonly createId?: () => string
}

function localPlannerReply(content: string): string {
  const normalized = content.toLocaleLowerCase('pt-BR')
  if (normalized.includes('prova') || normalized.includes('trabalho')) {
    return 'Registrei a intenção, mas ainda não transformo mensagens em prazos automaticamente. Para planejar corretamente, preciso da matéria, da data e de quanto tempo você tem disponível por dia.'
  }
  if (normalized.includes('horário') || normalized.includes('trabalho de') || normalized.includes('faculdade')) {
    return 'Entendi que isso faz parte da sua rotina. Na etapa de Planner, vou converter horários e compromissos em disponibilidade estruturada. Por enquanto, esta conversa já fica salva localmente.'
  }
  return 'Posso organizar seus estudos pela Home. Ainda estou em modo local, sem provedor de IA conectado. Conte qual matéria, prazo ou dificuldade você quer organizar e manterei a conversa salva para continuarmos depois.'
}

export class HomePlannerService {
  private readonly repository: ConversationRepository
  private readonly now: () => number
  private readonly createId: () => string

  constructor({ repository, now = Date.now, createId = () => crypto.randomUUID() }: HomePlannerServiceDependencies) {
    this.repository = repository
    this.now = now
    this.createId = createId
  }

  async listMessages(): Promise<ConversationMessage[]> {
    await this.repository.ensureHomeThread(HOME_THREAD_ID, this.now())
    return this.repository.listMessages(HOME_THREAD_ID, 100)
  }

  async sendMessage(input: SendHomeMessageInput): Promise<ConversationMessage[]> {
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
    const assistantMessage = {
      id: this.createId(),
      threadId: HOME_THREAD_ID,
      role: 'assistant' as const,
      content: localPlannerReply(userMessage.content),
      createdAt: now + 1,
      providerId: 'coach-local',
      modelId: 'planner-rules-v1',
    }
    return this.repository.addTurn({ threadId: HOME_THREAD_ID, user: userMessage, assistant: assistantMessage })
  }
}
