import type { ConversationMessage, SendHomeMessageInput } from '../../shared/contracts/conversation-contract'
import type { HomeOrganizerResult } from '../../shared/contracts/planning-contract'
import type { HomePlannerService } from './home-planner-service'
import type { PlanningService } from '../planning/planning-service'
import type { PlannerActionService } from '../planning/planner-action-service'
import type { AcademicSubjectContextService } from '../workspaces/academic-subject-context'
import type { AcademicLifeMutationInput } from '../../shared/contracts/academic-life-contract'
import type { AcademicLifeItem } from '../../shared/contracts/academic-life-contract'
import { parseExplicitDate } from '../planning/planning-service'

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

function requestedMinutes(content: string): number | null {
  const hours = /(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)\b/i.exec(content)?.[1]
  if (hours) return Math.round(Number(hours.replace(',', '.')) * 60)
  const minutes = /(\d+)\s*(?:min|minuto|minutos)\b/i.exec(content)?.[1]
  return minutes ? Number(minutes) : null
}

function planMutationIntent(content: string, clock: HomeTurnClock, plan: ReturnType<PlanningService['getWeeklyPlan']>): { type: 'plan.today-budget.set' | 'plan.weekday-availability.set' | 'plan.recalculate' | 'plan.item-completion.set'; payload: unknown; label: string; workspaceIds: string[] } | null {
  const normalized = content.toLocaleLowerCase('pt-BR'); const minutes = requestedMinutes(content)
  const weekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
  if (minutes !== null && /\bhoje\b/.test(normalized) && /(?:dispon|tempo|estud|planej|orçamento|orcamento|tenho|terei|vou ter)/.test(normalized)) return { type: 'plan.today-budget.set', payload: { dateKey: clock.currentDate, timezone: clock.timezone, minutes }, label: `Usar ${minutes} min disponíveis hoje`, workspaceIds: [] }
  const weekday = weekdays.findIndex((day) => normalized.includes(day))
  if (minutes !== null && weekday >= 0 && /(?:dispon|tempo|estud|planej|tenho|terei|vou ter)/.test(normalized)) return { type: 'plan.weekday-availability.set', payload: { weekday, minutes, timezone: clock.timezone }, label: `Definir ${minutes} min para ${weekdays[weekday]}`, workspaceIds: [] }
  if (/\b(?:recalcule|recalcular|refaça|refaca|redistribua|reorganize)\b/.test(normalized) && /\b(?:plano|semana|estudos?)\b/.test(normalized)) return { type: 'plan.recalculate', payload: { timezone: clock.timezone }, label: 'Recalcular o plano semanal', workspaceIds: [] }
  const completed = /\b(?:concluir|conclua|marcar como conclu[ií]d[ao])\b/.test(normalized)
  const reopened = /\b(?:reabrir|reabra|desfazer conclus[aã]o|marcar como pendente)\b/.test(normalized)
  if (!completed && !reopened) return null
  const candidates = plan.days.flatMap((day) => day.items).filter((item) => reopened ? item.status === 'completed' : item.status !== 'completed')
  const named = candidates.filter((item) => normalized.includes(item.title.toLocaleLowerCase('pt-BR')) || normalized.includes(item.workspaceName.toLocaleLowerCase('pt-BR')))
  const item = named.length === 1 ? named[0] : candidates.length === 1 ? candidates[0] : null
  if (!item) return null
  return { type: 'plan.item-completion.set', payload: { workspaceId: item.workspaceId, itemId: item.id, completed }, label: `${completed ? 'Concluir' : 'Reabrir'} ${item.title}`, workspaceIds: [item.workspaceId] }
}

export function extractAcademicLifeIntent(content: string, clock: HomeTurnClock, workspaces: Array<{ id: string; name: string }>, active: AcademicLifeItem[] = []): AcademicLifeMutationInput | null {
  const normalized = content.toLocaleLowerCase('pt-BR')
  const provenance = { source: 'conversation' as const, reference: null }
  const workspace = workspaces.find((item) => normalized.includes(item.name.toLocaleLowerCase('pt-BR')))
  const weekdayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
  const weekday = weekdayNames.findIndex((day) => normalized.includes(day))
  const hours = /(?:só|so)?\s*(?:vou\s+ter\s+)?(\d+(?:[.,]\d+)?)\s*horas?/.exec(normalized)?.[1]
  const dueAt = parseExplicitDate(content, clock.currentTime)
  const eventMatch = /\b(prova|exame|trabalho|atividade|prazo)\b/.exec(normalized)
  if (eventMatch && dueAt) {
    const kind = eventMatch[1] === 'trabalho' || eventMatch[1] === 'atividade' ? 'commitment' as const : 'event' as const
    const title = `${eventMatch[1]![0]!.toLocaleUpperCase('pt-BR')}${eventMatch[1]!.slice(1)}${workspace ? ` ${workspace.name}` : ''}`
    const correction = /na verdade|corrigindo|mudou|remarcad|adiad/.test(normalized)
    const previous = correction ? active.filter((item) => item.kind === kind && (!workspace || item.workspaceId === workspace.id)).sort((a, b) => b.updatedAt - a.updatedAt)[0] : undefined
    if (!workspace && !previous) return null
    return { kind, title: previous?.title ?? title, details: previous?.details ?? '', workspaceId: workspace?.id ?? null, startsAt: previous?.startsAt ?? null, endsAt: dueAt, expiresAt: dueAt, timezone: clock.timezone, weekday: null, minutes: null, shareWithAi: previous?.shareWithAi ?? true, provenance, ...(previous ? { replacesId: previous.id } : {}) }
  }
  const explicit = /\b(?:registre|salve|anote|lembre)\b/.test(normalized)
  if (!explicit) return null
  const commitment = /\b(?:compromisso|entregar|reunião|reuniao)\b/.test(normalized)
  if (commitment && dueAt) return { kind: 'commitment', title: content.trim().slice(0, 160), details: '', workspaceId: workspace?.id ?? null, startsAt: null, endsAt: dueAt, expiresAt: dueAt, timezone: clock.timezone, weekday: null, minutes: null, shareWithAi: true, provenance }
  if (/\b(?:fato|contexto|preferência|preferencia)\b/.test(normalized)) return { kind: 'fact', title: content.replace(/^.*?\b(?:fato|contexto|preferência|preferencia)\b\s*(?:de|que|:)?\s*/i, '').trim().slice(0, 160) || 'Contexto acadêmico', details: content.trim(), workspaceId: workspace?.id ?? null, startsAt: clock.currentTime, endsAt: null, expiresAt: null, timezone: clock.timezone, weekday: null, minutes: null, shareWithAi: true, provenance }
  return null
}

export class HomeOrganizerService {
  constructor(private readonly conversation: HomePlannerService, private readonly planning: PlanningService, private readonly actions: PlannerActionService, private readonly listWorkspaces: () => Promise<Array<{ id: string; name: string }>>, private readonly recalculate: (workspaceId: string) => Promise<unknown>, private readonly now = Date.now, private readonly academicContext?: AcademicSubjectContextService, private readonly listAcademicLife: () => AcademicLifeItem[] = () => []) {}
  listMessages(): Promise<ConversationMessage[]> { return this.conversation.listMessages() }

  async organize(input: SendHomeMessageInput): Promise<{ messages: ConversationMessage[]; result: HomeOrganizerResult }> {
    const content = input.content.trim(); const normalized = content.toLocaleLowerCase('pt-BR'); const clock = currentClock(this.now); const version = clock.currentTime; const pending = this.actions.listPending()
    this.academicContext?.recordMessage(content)
    if (isPedagogicalQuery(content)) { const workspaces = await this.listWorkspaces(); const named = workspaces.find((workspace) => content.toLocaleLowerCase('pt-BR').includes(workspace.name.toLocaleLowerCase('pt-BR'))); return this.persist(content, named ? { outcome: 'needs_decision', operations: [], actions: [], affectedWorkspaceIds: [named.id], message: `Essa é uma dúvida de conteúdo. Vamos trabalhar isso no seu Workspace de ${named.name}.` } : { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Essa é uma dúvida de conteúdo e o HOME não ministra aulas. Escolha um Workspace adequado ou prepare um novo Workspace para estudar esse tema.' }) }
    if (/\b(?:criar|novo|preparar)\s+(?:um\s+)?workspace\b/i.test(content) && !/\b(?:prova|trabalho|prazo)\b/i.test(content)) return this.persist(content, { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Para criar um Workspace, me diga o tema, seu objetivo e seu nível atual.' })
    if (confirmationText(content)) return this.persist(content, { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: pending.length ? 'Há uma decisão pendente, mas ela só pode ser executada pelo botão ligado à mensagem original.' : 'Não há nenhuma ação aguardando confirmação. Quando uma decisão for necessária, ela aparecerá aqui com um botão próprio.' })
    if (mentionsProposal(content)) return this.persist(content, { outcome: 'informational', operations: [], actions: pending, affectedWorkspaceIds: [], message: pending.length ? 'As decisões pendentes continuam disponíveis nos botões da mensagem que as originou.' : 'Não há nenhuma proposta pendente no estado real do Coach.' })

    try {
      const workspaces = await this.listWorkspaces()
      const planIntent = planMutationIntent(content, clock, this.planning.getWeeklyPlan(clock.timezone))
      if (planIntent) {
        const messageId = crypto.randomUUID()
        const action = this.actions.propose({ type: planIntent.type, payload: planIntent.payload, label: planIntent.label, originMessageId: messageId, contextVersion: version })
        return this.persist(content, { outcome: 'needs_decision', operations: [], actions: [action], affectedWorkspaceIds: planIntent.workspaceIds, message: `Posso ${planIntent.label.toLocaleLowerCase('pt-BR')}. Confirme pelo botão; nada mudou ainda.` }, messageId)
      }
      const academicLifeIntent = extractAcademicLifeIntent(content, clock, workspaces, this.listAcademicLife())
      if (academicLifeIntent) {
        const messageId = crypto.randomUUID()
        const action = this.actions.propose({ type: 'academic-life.save', payload: academicLifeIntent, label: `Salvar ${academicLifeIntent.title}`, originMessageId: messageId, contextVersion: version })
        return this.persist(content, { outcome: 'needs_decision', operations: [], actions: [action], affectedWorkspaceIds: academicLifeIntent.workspaceId ? [academicLifeIntent.workspaceId] : [], message: `Posso salvar “${academicLifeIntent.title}” como registro estruturado. Confirme pelo botão; nada mudou ainda.` }, messageId)
      }
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

      if (mutation.pendingEvent) {
        const messageId = crypto.randomUUID(); const subject = mutation.pendingEvent.subject; const matching = workspaces.find((workspace) => workspace.name.toLocaleLowerCase('pt-BR') === subject.toLocaleLowerCase('pt-BR'))
        if (!matching) {
          const language = subject.toLocaleLowerCase('pt-BR') === 'c' ? 'c' as const : undefined
          const event = mutation.pendingEvent
          const action = this.actions.propose({ type: 'workspace.prepare', payload: { name: subject, objective: `Preparação acadêmica em ${subject}` }, label: `Preparar Workspace de ${subject}`, originMessageId: messageId, contextVersion: version })
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
