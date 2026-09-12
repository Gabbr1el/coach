import type { ConversationMessage, SendHomeMessageInput } from '../../shared/contracts/conversation-contract'
import type { HomeOrganizerResult } from '../../shared/contracts/planning-contract'
import type { HomePlannerService } from './home-planner-service'
import type { PlanningService } from '../planning/planning-service'
import type { PlannerActionService } from '../planning/planner-action-service'
import type { AcademicLifeItem } from '../../shared/contracts/academic-life-contract'
import { LocalOrganizerIntentInterpreter, type OrganizerIntentInterpreter } from './organizer-intent-interpreter'
import { OrganizerIntentExecutor } from './organizer-intent-executor'

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
function isPedagogicalQuery(content: string): boolean { return /\b(?:o que (?:é|e)|como funciona|me explica|explique|me dê um exercício|me de um exercicio|exercício de|exercicio de|qual a diferença|qual a diferenca)\b/i.test(content) }

export class HomeOrganizerService {
  private readonly executor: OrganizerIntentExecutor
  constructor(private readonly conversation: HomePlannerService, private readonly planning: PlanningService, private readonly actions: PlannerActionService, private readonly listWorkspaces: () => Promise<Array<{ id: string; name: string }>>, private readonly now = Date.now, private readonly listAcademicLife: () => AcademicLifeItem[] = () => [], private readonly interpreter: OrganizerIntentInterpreter = new LocalOrganizerIntentInterpreter()) { this.executor = new OrganizerIntentExecutor(actions) }
  listMessages(): Promise<ConversationMessage[]> { return this.conversation.listMessages() }

  async organize(input: SendHomeMessageInput): Promise<{ messages: ConversationMessage[]; result: HomeOrganizerResult }> {
    const content = input.content.trim(); const clock = currentClock(this.now); const version = clock.currentTime; const pending = this.actions.listPending()
    if (isPedagogicalQuery(content)) { const workspaces = await this.listWorkspaces(); const named = workspaces.find((workspace) => content.toLocaleLowerCase('pt-BR').includes(workspace.name.toLocaleLowerCase('pt-BR'))); return this.persist(content, named ? { outcome: 'needs_decision', operations: [], actions: [], affectedWorkspaceIds: [named.id], message: `Essa é uma dúvida de conteúdo. Vamos trabalhar isso no seu Workspace de ${named.name}.` } : { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Essa é uma dúvida de conteúdo e o HOME não ministra aulas. Escolha um Workspace adequado ou prepare um novo Workspace para estudar esse tema.' }) }
    if (confirmationText(content)) return this.persist(content, { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: pending.length ? 'Há uma decisão pendente, mas ela só pode ser executada pelo botão ligado à mensagem original.' : 'Não há nenhuma ação aguardando confirmação. Quando uma decisão for necessária, ela aparecerá aqui com um botão próprio.' })
    if (mentionsProposal(content)) return this.persist(content, { outcome: 'informational', operations: [], actions: pending, affectedWorkspaceIds: [], message: pending.length ? 'As decisões pendentes continuam disponíveis nos botões da mensagem que as originou.' : 'Não há nenhuma proposta pendente no estado real do Coach.' })

    try {
      const workspaces = await this.listWorkspaces()
      const intent = await this.interpreter.interpret(content, clock)
      const academicLife = this.listAcademicLife(); const plan = this.planning.peekWeeklyPlan(clock.timezone); const deadlines = this.planning.getAcademicOverview().events
      const execution = this.executor.execute(intent, { content, ...clock, version, workspaces, academicLife, deadlines, plan })
      if (execution) return this.persist(content, execution.result, execution.assistantId)
      const messages = await this.conversation.sendMessageWithAuthority({ content }, { ...clock, state: { workspaces: workspaces.map(({ id, name }) => ({ id, name })), pendingActions: pending.map(({ id, label, originMessageId }) => ({ id, label, originMessageId })) }, operationResult: null, constraints: ['Não invente cronograma, duração, conteúdo, Workspace ou operação.', 'Não mencione proposta sem actionId real.'] })
      return { messages, result: { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: messages.at(-1)?.content ?? '' } }
    } catch {
      return this.persist(content, { outcome: 'failed', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Não consegui interpretar ou validar esse pedido com segurança. Nenhuma mudança foi confirmada.' })
    }
  }

  private async persist(content: string, result: HomeOrganizerResult, assistantId?: string): Promise<{ messages: ConversationMessage[]; result: HomeOrganizerResult }> {
    const messages = await this.conversation.saveAuthoritativeTurn(content, result.message, assistantId)
    return { messages, result }
  }
}
