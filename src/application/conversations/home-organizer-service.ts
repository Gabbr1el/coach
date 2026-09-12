import type { AcademicLifeItem } from '../../shared/contracts/academic-life-contract'
import type { ConversationMessage, SendHomeMessageInput } from '../../shared/contracts/conversation-contract'
import { emptyOrganizerConversationState, type OrganizerConversationState } from '../../shared/contracts/organizer-conversation-state-contract'
import { organizerEntitiesSchema, type OrganizerEntities, type OrganizerIntent } from '../../shared/contracts/organizer-intent-contract'
import type { HomeOrganizerResult } from '../../shared/contracts/planning-contract'
import type { PlannerAction } from '../../shared/contracts/planner-action-contract'
import type { PlanningService } from '../planning/planning-service'
import type { PlannerActionService } from '../planning/planner-action-service'
import type { OrganizerConversationStateRepository } from './organizer-conversation-state-repository'
import type { HomePlannerService } from './home-planner-service'
import { LocalOrganizerIntentInterpreter, type OrganizerIntentInterpreter } from './organizer-intent-interpreter'
import { OrganizerIntentExecutor } from './organizer-intent-executor'

export interface HomeTurnClock { readonly currentTime: number; readonly currentDate: string; readonly timezone: string }

function currentClock(now: () => number): HomeTurnClock {
  const currentTime = now(); const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(currentTime)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { currentTime, currentDate: `${value('year')}-${value('month')}-${value('day')}`, timezone }
}

function normalized(value: string): string { return value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '') }
function confirmationText(content: string): boolean { return /^(autorizo|confirmo|sim)$/i.test(content.trim()) }
function mentionsProposal(content: string): boolean { return /cad[eê]\s+a\s+proposta|qual\s+(?:é\s+)?a\s+proposta/i.test(content) }
function isPedagogicalQuery(content: string): boolean { return /\b(?:o que (?:é|e)|como funciona|me explica|explique|me dê um exercício|me de um exercicio|exercício de|exercicio de|qual a diferença|qual a diferenca)\b/i.test(content) }
function isEventReference(content: string): boolean { return /\b(?:isso|esse trabalho|essa prova|a prova|o trabalho|mude para|remarque para|cancele isso|cancele esse|cancele essa)\b/i.test(content) }
function isGenericEventReference(content: string): boolean { return /\b(?:isso|cancele isso)\b/i.test(content) && !/\b(?:prova|exame|trabalho|atividade|prazo|deadline)\b/i.test(content) }
function explicitSubject(content: string): string | null { return /(?:prova|exame|trabalho|atividade|prazo)\s+(?:de|da|do)\s+(.+?)(?=\s+(?:foi\b|mudou\b|passou\b|no\s+dia|dia\s+\d|em\s+\d|para\s+(?:o\s+)?dia|amanh|hoje)|[,.;]|$)/i.exec(content)?.[1]?.trim() ?? null }
function eventMetadata(item: AcademicLifeItem): { subject: string; eventKind: OrganizerEntities['eventKind'] } | null { try { const value = JSON.parse(item.details) as { schema?: string; subject?: string; eventKind?: OrganizerEntities['eventKind'] }; return value.schema === 'academic-event/v1' && value.subject && value.eventKind ? { subject: value.subject, eventKind: value.eventKind } : null } catch { return null } }
function cap<T>(id: T, current: readonly T[]): T[] { return [id, ...current.filter((value) => value !== id)].slice(0, 4) }
const PENDING_TTL_MS = 24 * 60 * 60 * 1_000

export class HomeOrganizerService {
  private readonly executor: OrganizerIntentExecutor
  constructor(private readonly conversation: HomePlannerService, private readonly planning: PlanningService, private readonly actions: PlannerActionService, private readonly listWorkspaces: () => Promise<Array<{ id: string; name: string }>>, private readonly now = Date.now, private readonly listAcademicLife: () => AcademicLifeItem[] = () => [], private readonly interpreter: OrganizerIntentInterpreter = new LocalOrganizerIntentInterpreter(), private readonly clock?: () => HomeTurnClock, private readonly states?: OrganizerConversationStateRepository) { this.executor = new OrganizerIntentExecutor(actions) }
  listMessages(): Promise<ConversationMessage[]> { return this.conversation.listMessages() }

  async organize(input: SendHomeMessageInput): Promise<{ messages: ConversationMessage[]; result: HomeOrganizerResult }> {
    const content = input.content.trim(); const clock = this.clock?.() ?? currentClock(this.now); const pendingActions = this.actions.listPending(); const userMessageId = this.conversation.createMessageId()
    if (isPedagogicalQuery(content)) { const workspaces = await this.listWorkspaces(); const named = workspaces.find((workspace) => normalized(content).includes(normalized(workspace.name))); return this.persist(content, named ? { outcome: 'needs_decision', operations: [], actions: [], affectedWorkspaceIds: [named.id], message: `Essa é uma dúvida de conteúdo. Vamos trabalhar isso no seu Workspace de ${named.name}.` } : { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Essa é uma dúvida de conteúdo e o HOME não ministra aulas. Escolha um Workspace adequado ou prepare um novo Workspace para estudar esse tema.' }, undefined, userMessageId) }
    if (confirmationText(content)) return this.persist(content, { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: pendingActions.length ? 'Há uma decisão pendente, mas ela só pode ser executada pelo botão ligado à mensagem original.' : 'Não há nenhuma ação aguardando confirmação. Quando uma decisão for necessária, ela aparecerá aqui com um botão próprio.' }, undefined, userMessageId)
    if (mentionsProposal(content)) return this.persist(content, { outcome: 'informational', operations: [], actions: pendingActions, affectedWorkspaceIds: [], message: pendingActions.length ? 'As decisões pendentes continuam disponíveis nos botões da mensagem que as originou.' : 'Não há nenhuma proposta pendente no estado real do Coach.' }, undefined, userMessageId)

    try {
      const workspaces = await this.listWorkspaces(); const academicLife = this.listAcademicLife(); const recentUserMessages = await this.conversation.listRecentUserMessages(4)
      let state = this.revalidate(this.states?.load(this.conversation.threadId) ?? emptyOrganizerConversationState(), workspaces, academicLife, clock.currentTime)
      const fragmentWithoutPending = !state.pending && this.isStandaloneSlotFragment(content)
      if (fragmentWithoutPending) return this.persist(content, { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Entendi o fragmento, mas não há um pedido pendente válido para completá-lo. Diga também qual evento ou matéria você quer organizar.' }, undefined, userMessageId)
      const interpretationContext = (pending: OrganizerConversationState['pending']) => ({ ...clock, conversation: { focus: { academicEvent: Boolean(state.focusedAcademicEventId), workspace: Boolean(state.focusedWorkspaceId), subject: state.focusedSubject }, pending: pending ? { capability: pending.capability, entities: pending.entities, missingFields: pending.missingFields } : null, recentUserMessages } })
      let intent = await this.interpreter.interpret(content, interpretationContext(state.pending))
      let semanticContent = content; let originMessageId = userMessageId; let executionClock = clock
      if (state.pending && this.isPendingContinuation(content, intent, state.pending.missingFields)) {
        const merged = this.mergePending(state.pending.entities, intent.entities, content, state.pending.missingFields)
        const remaining = state.pending.missingFields.filter((field) => merged[field as keyof OrganizerEntities] === null)
        intent = { mode: remaining.length ? 'clarification' : 'mutation', capability: remaining.length ? null : state.pending.capability, entities: merged, confidence: intent.confidence, missingFields: remaining, summary: remaining.length ? 'Ainda faltam dados.' : 'Completar intenção pendente.' }
        semanticContent = `${state.pending.originalText} ${content}`; originMessageId = state.pending.originalMessageId
        executionClock = { currentTime: clock.currentTime, currentDate: state.pending.originalCurrentDate, timezone: state.pending.originalTimezone }
      } else {
        if (state.pending) {
          state = { ...state, pending: null, updatedAt: clock.currentTime }
          this.states?.save(this.conversation.threadId, state)
          intent = await this.interpreter.interpret(content, interpretationContext(null))
        }
        if (isEventReference(content) && !explicitSubject(content)) {
        if (!state.focusedAcademicEventId) return this.persist(content, { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: /cancel/i.test(content) ? 'Entendi um cancelamento, mas não há um evento em foco revalidado. Nenhuma criação foi proposta.' : 'Preciso que você identifique o evento com mais precisão.' }, undefined, userMessageId)
        intent = this.resolveReferences(intent, content, state, academicLife, workspaces)
        }
      }

      if (intent.mode === 'clarification' && intent.missingFields.length && this.pendingCapability(intent, content)) {
        const capability = this.pendingCapability(intent, content)!
        state = { ...state, pending: { capability, entities: intent.entities, missingFields: intent.missingFields, originalMessageId: userMessageId, originalText: content, originalCreatedAt: clock.currentTime, originalCurrentDate: clock.currentDate, originalTimezone: clock.timezone }, updatedAt: clock.currentTime }
        this.states?.save(this.conversation.threadId, state)
      }

      const plan = this.planning.peekWeeklyPlan(clock.timezone); const deadlines = this.planning.getAcademicOverview().events
      const referencedEvent = !explicitSubject(content) && isEventReference(content) && intent.entities.target ? academicLife.find((item) => item.status === 'active' && item.replacedById === null && normalized(item.title) === normalized(intent.entities.target!)) : null
      const execution = this.executor.execute(intent, { content, originContent: semanticContent, originMessageId, ...executionClock, version: clock.currentTime, workspaces, academicLife, deadlines, plan, focusedAcademicEventId: referencedEvent?.id ?? null })
      if (execution) {
        if (execution.result.actions.length) { state = { ...state, pending: null, updatedAt: clock.currentTime }; this.states?.save(this.conversation.threadId, state) }
        return this.persist(content, execution.result, execution.assistantId, userMessageId)
      }
      const messages = await this.conversation.sendMessageWithAuthority({ content }, { ...clock, state: { focus: { hasAcademicEvent: Boolean(state.focusedAcademicEventId), hasWorkspace: Boolean(state.focusedWorkspaceId), subject: state.focusedSubject }, pending: state.pending ? { capability: state.pending.capability, missingFields: state.pending.missingFields } : null, pendingActions: pendingActions.length }, operationResult: null, constraints: ['Não invente cronograma, duração, conteúdo, Workspace ou operação.', 'Não mencione proposta sem actionId real.'] })
      return { messages, result: { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: messages.at(-1)?.content ?? '' } }
    } catch {
      return this.persist(content, { outcome: 'failed', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Não consegui interpretar ou validar esse pedido com segurança. Nenhuma mudança foi confirmada.' }, undefined, userMessageId)
    }
  }

  onPlannerActionResolved(action: PlannerAction): void {
    if (action.status !== 'applied' || !this.states) return
    const current = this.states.load(this.conversation.threadId); const item = this.resultItem(action.result); const payload = action.payload as { id?: string; eventId?: string; workspaceId?: string; replacesId?: string }
    const eventId = item?.id ?? payload.eventId ?? (action.type === 'academic-life.transition' ? payload.id : null)
    const workspaceId = item?.workspaceId ?? payload.workspaceId ?? null
    const metadata = item ? eventMetadata(item) : null
    const replacementId = action.type === 'academic-life.save' ? payload.replacesId ?? null : null
    const recentEvents = eventId ? cap(eventId, replacementId ? current.recentResolvedAcademicEventIds.filter((id) => id !== replacementId) : current.recentResolvedAcademicEventIds) : current.recentResolvedAcademicEventIds
    this.states.save(this.conversation.threadId, { ...current, focusedAcademicEventId: action.type === 'academic-life.transition' ? null : eventId ?? current.focusedAcademicEventId, focusedWorkspaceId: workspaceId ?? current.focusedWorkspaceId, focusedSubject: metadata?.subject ?? current.focusedSubject, recentResolvedAcademicEventIds: recentEvents, recentResolvedWorkspaceIds: workspaceId ? cap(workspaceId, current.recentResolvedWorkspaceIds) : current.recentResolvedWorkspaceIds, updatedAt: this.now() })
  }

  private revalidate(state: OrganizerConversationState, workspaces: Array<{ id: string; name: string }>, academicLife: AcademicLifeItem[], now: number): OrganizerConversationState {
    const activeWorkspaces = new Set(workspaces.map(({ id }) => id)); const activeEvents = new Map(academicLife.filter((item) => item.status === 'active' && item.replacedById === null).map((item) => [item.id, item]))
    const focusedEvent = state.focusedAcademicEventId ? activeEvents.get(state.focusedAcademicEventId) : null
    const pendingAge = state.pending ? now - state.pending.originalCreatedAt : 0
    const pending = state.pending && pendingAge >= 0 && pendingAge <= PENDING_TTL_MS ? state.pending : null
    const next = { ...state, focusedAcademicEventId: focusedEvent?.id ?? null, focusedWorkspaceId: state.focusedWorkspaceId && activeWorkspaces.has(state.focusedWorkspaceId) ? state.focusedWorkspaceId : null, focusedSubject: focusedEvent ? eventMetadata(focusedEvent)?.subject ?? state.focusedSubject : state.focusedSubject, pending, recentResolvedAcademicEventIds: state.recentResolvedAcademicEventIds.filter((id) => activeEvents.has(id)).slice(0, 4), recentResolvedWorkspaceIds: state.recentResolvedWorkspaceIds.filter((id) => activeWorkspaces.has(id)).slice(0, 4), updatedAt: now }
    if (JSON.stringify(next) !== JSON.stringify(state)) this.states?.save(this.conversation.threadId, next)
    return next
  }

  private resolveReferences(intent: OrganizerIntent, content: string, state: OrganizerConversationState, academicLife: AcademicLifeItem[], workspaces: Array<{ id: string; name: string }>): OrganizerIntent {
    const explicit = explicitSubject(content); if (explicit) return intent
    if (!isEventReference(content)) return intent
    const candidates = state.recentResolvedAcademicEventIds.flatMap((id) => academicLife.filter((item) => item.id === id && item.status === 'active' && item.replacedById === null))
    const focused = state.focusedAcademicEventId ? candidates.find((item) => item.id === state.focusedAcademicEventId) ?? academicLife.find((item) => item.id === state.focusedAcademicEventId && item.status === 'active' && item.replacedById === null) : null
    const kindHint = /\b(?:prova|exame)\b/i.test(content) ? 'exam' : /\b(?:trabalho|atividade)\b/i.test(content) ? 'assignment' : /\b(?:prazo|deadline)\b/i.test(content) ? 'deadline' : null
    const matchingCandidates = kindHint ? candidates.filter((item) => eventMetadata(item)?.eventKind === kindHint) : candidates
    const resolved = matchingCandidates.length === 1 ? matchingCandidates[0]! : null
    if (!focused || !resolved || (isGenericEventReference(content) && candidates.length !== 1)) return { ...intent, mode: 'clarification', capability: null, missingFields: ['target'], summary: 'Referência acadêmica ambígua.' }
    const metadata = eventMetadata(resolved); if (!metadata) return intent
    const capability = /cancelad|cancelar|cancele/i.test(content) ? 'academic.event.cancel' : /(?:mude|remarque|mudou|adiad|passou)/i.test(content) ? 'academic.event.update' : intent.capability
    const subject = intent.entities.subject ?? metadata.subject; const eventKind = intent.entities.eventKind ?? metadata.eventKind
    const workspace = state.focusedWorkspaceId ? workspaces.find((item) => item.id === state.focusedWorkspaceId) : null
    return { ...intent, mode: capability ? 'mutation' : intent.mode, capability, entities: { ...intent.entities, subject, eventKind, target: resolved.title, query: intent.entities.query ?? workspace?.name ?? null }, missingFields: capability === 'academic.event.cancel' ? [] : intent.missingFields.filter((field) => !['subject', 'eventKind', 'target'].includes(field)) }
  }

  private mergePending(previous: OrganizerEntities, current: OrganizerEntities, content: string, missing: readonly string[]): OrganizerEntities {
    const patch = { ...current } as OrganizerEntities
    if (missing.includes('dateExpression') && patch.dateExpression === null) { const day = /^\s*(?:dia\s*)?(\d{1,2})\s*$/i.exec(content)?.[1]; if (day) patch.dateExpression = `dia ${day}` }
    const merged = { ...previous } as OrganizerEntities
    for (const key of Object.keys(merged) as Array<keyof OrganizerEntities>) if (missing.includes(key) && patch[key] !== null) (merged as Record<string, unknown>)[key] = patch[key]
    return organizerEntitiesSchema.parse(merged)
  }

  private isPendingContinuation(content: string, intent: OrganizerIntent, missing: readonly string[]): boolean {
    if (intent.capability !== null || explicitSubject(content) || /\b(?:prova|exame|trabalho|atividade|prazo|deadline|workspace|cancele|cancelar|mude|remarque|crie|criar)\b/i.test(content)) return false
    if (missing.includes('dateExpression') && /^\s*(?:(?:dia\s*)?\d{1,2}|hoje|amanh[ãa]|depois\s+de\s+amanh[ãa]|(?:pr[oó]xima\s+)?(?:segunda|terça|quarta|quinta|sexta|sábado|domingo)(?:-feira)?)\s*[.!]?\s*$/i.test(content)) return true
    if (missing.includes('minutes') && /^\s*\d{1,4}\s*(?:minutos?|min|horas?|h)\s*[.!]?\s*$/i.test(content)) return true
    if (missing.includes('weekday') && /^\s*(?:domingo|segunda|terça|quarta|quinta|sexta|sábado)(?:-feira)?\s*[.!]?\s*$/i.test(content)) return true
    if (missing.includes('target') && /^\s*(?:isso|esse|essa|ele|ela)\s*[.!]?\s*$/i.test(content)) return true
    return false
  }

  private isStandaloneSlotFragment(content: string): boolean {
    return /^\s*(?:(?:dia\s*)?\d{1,2}|hoje|amanh[ãa]|depois\s+de\s+amanh[ãa]|(?:pr[oó]xima\s+)?(?:segunda|terça|quarta|quinta|sexta|sábado|domingo)(?:-feira)?)\s*[.!]?\s*$/i.test(content)
  }

  private pendingCapability(intent: OrganizerIntent, content: string): OrganizerIntent['capability'] {
    if (intent.capability) return intent.capability
    if (/\b(?:prova|exame|trabalho|atividade|prazo|deadline)\b/i.test(content) && intent.entities.subject && intent.entities.eventKind) return 'academic.event.create'
    return null
  }

  private resultItem(result: unknown): AcademicLifeItem | null {
    const candidate = result && typeof result === 'object' && 'item' in result ? (result as { item: unknown }).item : result
    return candidate && typeof candidate === 'object' && 'id' in candidate && 'status' in candidate ? candidate as AcademicLifeItem : null
  }

  private async persist(content: string, result: HomeOrganizerResult, assistantId?: string, userId?: string): Promise<{ messages: ConversationMessage[]; result: HomeOrganizerResult }> {
    const messages = await this.conversation.saveAuthoritativeTurn(content, result.message, assistantId, userId)
    return { messages, result }
  }
}
