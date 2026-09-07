import type { ConversationMessage, SendHomeMessageInput } from '../../shared/contracts/conversation-contract'
import type { HomeOrganizerResult } from '../../shared/contracts/planning-contract'
import type { HomePlannerService } from './home-planner-service'
import type { PlanningService } from '../planning/planning-service'
import type { PlannerActionService } from '../planning/planner-action-service'

export interface HomeTurnClock {
  readonly currentTime: number
  readonly currentDate: string
  readonly timezone: string
}

function currentClock(now: () => number): HomeTurnClock {
  const currentTime = now(); const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(currentTime)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { currentTime, currentDate: `${value('year')}-${value('month')}-${value('day')}`, timezone }
}

function confirmationText(content: string): boolean { return /^(autorizo|confirmo|sim)$/i.test(content.trim()) }
function mentionsProposal(content: string): boolean { return /cad[eê]\s+a\s+proposta|qual\s+(?:é\s+)?a\s+proposta/i.test(content) }

export class HomeOrganizerService {
  constructor(private readonly conversation: HomePlannerService, private readonly planning: PlanningService, private readonly actions: PlannerActionService, private readonly listWorkspaces: () => Promise<Array<{ id: string; name: string }>>, private readonly recalculate: (workspaceId: string) => Promise<unknown>, private readonly now = Date.now) {}
  listMessages(): Promise<ConversationMessage[]> { return this.conversation.listMessages() }

  async organize(input: SendHomeMessageInput): Promise<{ messages: ConversationMessage[]; result: HomeOrganizerResult }> {
    const content = input.content.trim(); const normalized = content.toLocaleLowerCase('pt-BR'); const clock = currentClock(this.now); const version = clock.currentTime; const pending = this.actions.listPending()
    if (confirmationText(content)) return this.persist(content, { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: pending.length ? 'Há uma decisão pendente, mas ela só pode ser executada pelo botão ligado à mensagem original.' : 'Não há nenhuma ação aguardando confirmação. Quando uma decisão for necessária, ela aparecerá aqui com um botão próprio.' })
    if (mentionsProposal(content)) return this.persist(content, { outcome: 'informational', operations: [], actions: pending, affectedWorkspaceIds: [], message: pending.length ? 'As decisões pendentes continuam disponíveis nos botões da mensagem que as originou.' : 'Não há nenhuma proposta pendente no estado real do Coach.' })

    try {
      this.actions.invalidateBefore(version)
      const mutation = this.planning.applyAcademicMessage(content, clock)
      if (mutation.changed) {
        try {
          await Promise.all(mutation.workspaceIds.map((workspaceId) => this.recalculate(workspaceId)))
          return this.persist(content, { outcome: 'applied', operations: ['academic_context.update', 'daily_plan.recalculate'], actions: [], affectedWorkspaceIds: mutation.workspaceIds, message: mutation.summary })
        } catch {
          return this.persist(content, { outcome: 'failed', operations: ['academic_context.update'], actions: [], affectedWorkspaceIds: mutation.workspaceIds, message: `${mutation.summary} Porém, não consegui recalcular o plano futuro agora.` })
        }
      }
      if (mutation.ambiguousWorkspaces?.length) {
        const messageId = crypto.randomUUID()
        if (!mutation.pendingEvent) return this.persist(content, { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Encontrei mais de um Workspace, mas ainda preciso da data do evento.' }, messageId)
        const actions = mutation.ambiguousWorkspaces.map((workspace) => this.actions.propose({ type: 'deadline.create', payload: { workspaceId: workspace.id, title: `${mutation.pendingEvent!.type === 'exam' ? 'Prova' : 'Evento'} ${workspace.name}`, dueAt: mutation.pendingEvent!.dueAt, estimatedMinutes: mutation.pendingEvent!.type === 'exam' ? 240 : 180, masteryPercent: null }, label: `Usar ${workspace.name}`, originMessageId: messageId, contextVersion: version }))
        return this.persist(content, { outcome: 'needs_decision', operations: [], actions, affectedWorkspaceIds: [], message: 'Encontrei mais de um Workspace relacionado. Escolha qual devo usar.' }, messageId)
      }

      const workspaces = await this.listWorkspaces()
      if (mutation.pendingEvent) {
        const messageId = crypto.randomUUID(); const subject = mutation.pendingEvent.subject; const matching = workspaces.find((workspace) => workspace.name.toLocaleLowerCase('pt-BR') === subject.toLocaleLowerCase('pt-BR'))
        if (!matching) {
          const language = subject.toLocaleLowerCase('pt-BR') === 'c' ? 'c' as const : undefined
          const action = this.actions.propose({ type: 'workspace.create', payload: { name: subject, objective: `Preparação acadêmica em ${subject}`, language }, label: `Criar Workspace de ${subject}`, originMessageId: messageId, contextVersion: version })
          const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: clock.timezone }).format(mutation.pendingEvent.dueAt)
          return this.persist(content, { outcome: 'needs_decision', operations: [], actions: [action], affectedWorkspaceIds: [], message: `Reconheci a prova de ${subject} em ${date}. Você ainda não tem um Workspace de ${subject}; não alterei nenhum Workspace nem inventei um cronograma. O conteúdo da prova ainda não foi informado.` }, messageId)
        }
      }

      const event = /prova|exame|trabalho|atividade|prazo/.test(normalized)
      if (event) return this.persist(content, { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: mutation.needsRefinement ?? 'Preciso da matéria e da data para registrar esse evento com segurança.' })
      const informational = !event && !/(crie|organize|adicione|altere|mude|remarque)/.test(normalized)
      if (informational) {
        const messages = await this.conversation.sendMessageWithAuthority({ content }, { ...clock, state: { workspaces: workspaces.map(({ id, name }) => ({ id, name })), pendingActions: pending.map(({ id, label, originMessageId }) => ({ id, label, originMessageId })) }, operationResult: null, constraints: ['Não invente cronograma, duração, conteúdo, Workspace ou operação.', 'Não mencione proposta sem actionId real.'] })
        return { messages, result: { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: messages.at(-1)?.content ?? '' } }
      }
      return this.persist(content, { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: mutation.needsRefinement ?? 'Preciso de mais informação para fazer essa alteração com segurança.' })
    } catch {
      return this.persist(content, { outcome: 'failed', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Não consegui salvar a alteração agora. Nenhuma mudança foi confirmada.' })
    }
  }

  private async persist(content: string, result: HomeOrganizerResult, assistantId?: string): Promise<{ messages: ConversationMessage[]; result: HomeOrganizerResult }> {
    const messages = await this.conversation.saveAuthoritativeTurn(content, result.message, assistantId)
    return { messages, result }
  }
}
