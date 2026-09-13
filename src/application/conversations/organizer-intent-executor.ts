import type { AcademicLifeItem } from '../../shared/contracts/academic-life-contract'
import { ORGANIZER_CAPABILITY_REGISTRY, type OrganizerEntities, type OrganizerIntent } from '../../shared/contracts/organizer-intent-contract'
import type { AcademicEvent, HomeOrganizerResult, WeeklyPlan } from '../../shared/contracts/planning-contract'
import type { WeeklyPlanningReview } from '../planning/weekly-planner'
import type { PlannerActionType } from '../../shared/contracts/planner-action-contract'
import { plannerActionProposalSchema } from '../../shared/contracts/planner-action-contract'
import type { PlannerActionService } from '../planning/planner-action-service'
import { extractAcademicDate, extractAcademicDateChange } from './academic-event-time'

interface OrganizerExecutionContext {
  readonly content: string
  readonly currentDate: string
  readonly timezone: string
  readonly version: number
  readonly workspaces: Array<{ id: string; name: string }>
  readonly academicLife: AcademicLifeItem[]
  readonly deadlines: AcademicEvent[]
  readonly availability: Array<{ weekday: number; minutes: number }>
  readonly reviewNeeds: WeeklyPlanningReview[]
  readonly plan: WeeklyPlan | null
  readonly originMessageId?: string
  readonly originContent?: string
  readonly focusedAcademicEventId?: string | null
}

export type OrganizerExecution = { readonly result: HomeOrganizerResult; readonly assistantId?: string } | null

function normalized(value: string): string { return value.trim().toLocaleLowerCase('pt-BR') }
function searchNormalized(value: string): string { return normalized(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '') }
function itemSubject(item: AcademicLifeItem): string { return item.title.replace(/^\s*(?:prova|exame|trabalho|atividade|prazo|deadline)\s+/i, '') }
type AcademicEventKind = NonNullable<OrganizerEntities['eventKind']>
type AcademicEventMetadata = { readonly schema: 'academic-event/v1'; readonly eventKind: AcademicEventKind; readonly subject: string; readonly sourceText: string }
function persistenceKind(eventKind: AcademicEventKind): 'event' | 'commitment' { return eventKind === 'assignment' ? 'commitment' : 'event' }
function eventDetails(eventKind: AcademicEventKind, subject: string, sourceText: string): string { return JSON.stringify({ schema: 'academic-event/v1', eventKind, subject, sourceText: sourceText.slice(0, 700) } satisfies AcademicEventMetadata) }
function storedEvent(item: AcademicLifeItem): { eventKind: AcademicEventKind; subject: string } | null {
  try {
    const value = JSON.parse(item.details) as Partial<AcademicEventMetadata>
    if (value.schema === 'academic-event/v1' && ['exam', 'assignment', 'deadline'].includes(value.eventKind ?? '') && typeof value.subject === 'string' && persistenceKind(value.eventKind!) === item.kind) return { eventKind: value.eventKind!, subject: value.subject }
  } catch {}
  const evidence = `${item.title}\n${item.details}`
  const kinds = ([['exam', /\b(?:prova|exame)\b/i], ['assignment', /\b(?:trabalho|atividade)\b/i], ['deadline', /\b(?:prazo|deadline)\b/i]] as const).filter(([, pattern]) => pattern.test(evidence)).map(([kind]) => kind)
  return kinds.length === 1 && persistenceKind(kinds[0]!) === item.kind ? { eventKind: kinds[0]!, subject: itemSubject(item) } : null
}
function workspaceFor(entities: OrganizerEntities, workspaces: OrganizerExecutionContext['workspaces']): { id: string; name: string } | null { return entities.subject ? workspaces.find((item) => normalized(item.name) === normalized(entities.subject!)) ?? null : null }
function minutesFrom(content: string): number | null { const hours = /(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)\b/i.exec(content)?.[1]; if (hours) return Math.round(Number(hours.replace(',', '.')) * 60); const minutes = /(\d+)\s*(?:min|minuto|minutos)\b/i.exec(content)?.[1]; return minutes ? Number(minutes) : null }
function subjectFrom(content: string): string | null { return /(?:prova|exame|trabalho|atividade|prazo)\s+(?:de|da|do)\s+(.+?)(?=\s+amanh[ãa])/i.exec(content)?.[1]?.trim() ?? /(?:prova|exame|trabalho|atividade|prazo)\s+(?:de|da|do)\s+(.+?)(?=\s+(?:mudou\b|passou\b|foi\s+remarcad[ao]\b|foi\s+adiad[ao]\b|ao\s+workspace\b|do\s+workspace\b|sem\s+workspace\b|no\s+dia|dia|em\s+\d|amanh[ãa]|hoje|(?:na\s+)?(?:pr[oó]xima\s+)?(?:segunda|terça|quarta|quinta|sexta|sábado|domingo)|e\s+\d+(?:[.,]\d+)?\s*(?:h|hora|min))\b|[,.;]|\s+e\s+estou\b|$)/i.exec(content)?.[1]?.trim() ?? null }
const CREATE_CAPABILITIES = new Set(['workspace.prepare', 'academic-life.save', 'academic.event.create'])
function isInterrogativeOrQuery(content: string): boolean { const value = normalized(content); return content.includes('?') || /^(?:qual|quais|quando|onde|como|quem|quanto|quantos|quantas|liste|mostre|consulte|busque|procure)\b/.test(value) || /\b(?:quero saber|gostaria de saber|me diga|você sabe|voce sabe)\b/.test(value) }
function isCancellation(content: string): boolean { return /\b(?:cancelar|cancele|cancela|cancelado|cancelada|cancelaram|foi cancelad[ao]|adiar|adie|remover|remova|excluir|exclua|apagar|apague)\b/i.test(content) }
function isLearningClaim(content: string): boolean { return /\b(?:sei|domino|aprendi|estudei|pratiquei|revisei)\b/i.test(content) && !/\b(?:plano|planej|dispon|reorganize|recalcule|marcar|registre|crie|cancele)\b/i.test(content) }
function formatDate(value: number, timezone: string): string { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: timezone }).format(value) }
function estimatedEffort(content: string): number | null { return /\b(?:prova|exame|trabalho|atividade|prazo|deadline)\b/i.test(content) ? minutesFrom(content) : null }

export class OrganizerIntentExecutor {
  constructor(private readonly actions: PlannerActionService) {}
  execute(intent: OrganizerIntent, context: OrganizerExecutionContext): OrganizerExecution {
    if (intent.mode === 'conversation') {
      const unavailable = intent.entities.target?.startsWith('unsupported:') ? intent.entities.target.slice('unsupported:'.length) : null
      if (unavailable === 'plan.reserveBlock') return { result: { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Reserva de bloco ainda não suportada. Posso mostrar suas necessidades reais de revisão, sem alterar o plano.' } }
      if (unavailable === 'plan.moveItem') return { result: { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Movimentação manual de item ainda não suportada. Nenhuma alteração foi proposta.' } }
      if (unavailable === 'availability.workingUntil') return { result: { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Horário de trabalho até determinada hora ainda não é representável pela disponibilidade atual. Informe quantos minutos terá disponíveis nesse dia.' } }
      if (unavailable === 'availability.vacationUntil') return { result: { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Período de férias até uma data ainda não é representável pela disponibilidade atual. Nenhuma informação aproximada foi salva.' } }
      return null
    }
    if (intent.mode === 'clarification') return { result: { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Preciso de mais informações para identificar uma operação suportada com segurança.' } }
    if (intent.missingFields.length) return { result: { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: this.missingFieldsMessage(intent.missingFields) } }
    const capability = intent.capability
    if (!capability) throw new Error('Organizer capability is required')
    const definition = ORGANIZER_CAPABILITY_REGISTRY[capability]
    if (definition.mode !== intent.mode || definition.access !== (intent.mode === 'query' ? 'read' : 'write')) throw new Error('Organizer capability access does not match intent mode')
    if (intent.mode === 'mutation') {
      if (isLearningClaim(context.content)) return { result: { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Entendi isso como contexto de conversa, não como evidência observada nem comando de planejamento. Nenhuma memória de conceito ou plano foi alterado.' } }
      if (isInterrogativeOrQuery(context.content)) return { result: { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Entendi isso como uma consulta. Nenhuma alteração foi proposta.' } }
      if (isCancellation(context.content) && capability !== 'academic.event.cancel') return { result: { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Entendi um cancelamento, mas não encontrei um registro existente que possa ser alterado com segurança. Nenhuma criação foi proposta.' } }
      if (CREATE_CAPABILITIES.has(capability) && /\b(?:resolver|resolva|arquivar|arquive|concluir|conclua|finalizar|finalize)\b/i.test(context.content)) return { result: { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Esse pedido parece alterar um registro existente, não criar um novo. Nenhuma criação foi proposta.' } }
    }
    const workspace = workspaceFor(intent.entities, context.workspaces)
    if (intent.entities.subject && !workspace && capability !== 'workspace.prepare' && capability !== 'academic-life.save' && !capability.startsWith('academic.event.')) throw new Error('Organizer subject does not match an owned Workspace')

    if (intent.mode === 'query') {
      return { result: this.query(capability, intent.entities, workspace, context) }
    }
    const eventResolution = this.academicEventMutation(capability, intent.entities, context)
    if (eventResolution && 'outcome' in eventResolution) return { result: eventResolution }
    const proposal = eventResolution ?? this.mutationProposal(capability, intent.entities, workspace, context)
    const parsed = plannerActionProposalSchema.parse({ type: proposal.type, payload: proposal.payload })
    const assistantId = crypto.randomUUID()
    const originMessageId = context.originMessageId ?? assistantId
    const action = this.actions.propose({ type: parsed.type as PlannerActionType, payload: parsed.payload, label: proposal.label, originMessageId, contextVersion: context.version, idempotencyScope: `organizer:${originMessageId}:${parsed.type}:${JSON.stringify(parsed.payload)}` })
    const workspaceIds = workspace ? [workspace.id] : []
    return { assistantId, result: { outcome: 'needs_decision', operations: [], actions: [action], affectedWorkspaceIds: workspaceIds, message: `Posso ${proposal.label.toLocaleLowerCase('pt-BR')}. Confirme pelo botão; nada mudou ainda.` } }
  }

  private query(capability: string, entities: OrganizerEntities, workspace: { id: string; name: string } | null, context: OrganizerExecutionContext): HomeOrganizerResult {
    let message: string
    if (capability === 'workspaces.list' || capability === 'workspaces.search') {
      const query = entities.query?.toLocaleLowerCase('pt-BR'); const rows = context.workspaces.filter((item) => !query || item.name.toLocaleLowerCase('pt-BR').includes(query))
      message = rows.length ? `Workspaces: ${rows.map((item) => item.name).join(', ')}.` : 'Não encontrei Workspaces correspondentes.'
    } else if (capability === 'plan.today.get') {
      const today = context.plan?.days.find((day) => day.dateKey === context.currentDate)
      const planItems = today?.items.filter((item) => item.status !== 'completed') ?? []
      const candidates: Array<{ score: number; label: string; reason: string }> = planItems.map((item) => ({ score: 1_000 - item.position, label: `${item.workspaceName}: ${item.title}`, reason: `está no plano de hoje por ${item.reason.toLocaleLowerCase('pt-BR')}` }))
      for (const deadline of context.deadlines.filter((item) => item.dueAt >= context.version)) { const days = Math.max(0.25, (deadline.dueAt - context.version) / 86_400_000); candidates.push({ score: 700 / days, label: deadline.title, reason: `vence em ${formatDate(deadline.dueAt, context.timezone)}` }) }
      for (const review of context.reviewNeeds) { const due = review.nextReviewAt !== null && review.nextReviewAt <= context.version; const fragile = review.retention === 'fragile'; candidates.push({ score: (due ? 650 : 300) + (fragile ? 200 : 0) + (review.performance === 'struggling' ? 150 : 0), label: `${review.workspaceName}: revisão de ${review.conceptName}`, reason: due ? 'a revisão está vencida' : fragile ? 'a retenção está frágil' : 'há necessidade de revisão registrada' }) }
      candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'pt-BR'))
      const first = candidates[0]
      message = first ? `A coisa mais importante hoje é ${first.label}, porque ${first.reason}. Essa classificação usa apenas o plano, os prazos e as memórias de revisão persistidos; nada foi alterado.` : 'Não há item no plano de hoje, prazo futuro ou necessidade de revisão persistida para priorizar. Nada foi alterado.'
    } else if (capability === 'plan.week.get') {
      const rows = context.plan?.days.flatMap((day) => day.items) ?? []; message = rows.length ? `O plano semanal tem ${rows.length} item(ns) distribuído(s) em ${context.plan!.days.filter((day) => day.items.length).length} dia(s).` : 'O plano semanal não tem itens persistidos.'
    } else if (capability === 'availability.get') {
      message = context.availability.length ? `Disponibilidade semanal persistida: ${context.availability.sort((a, b) => a.weekday - b.weekday).map((item) => `${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][item.weekday]}: ${item.minutes} min`).join('; ')}.` : 'Não há disponibilidade semanal persistida.'
    } else if (capability === 'deadlines.list') {
      const rows = context.deadlines.filter((item) => item.dueAt >= context.version && (!workspace || item.workspaceId === workspace.id)).sort((a, b) => a.dueAt - b.dueAt || a.title.localeCompare(b.title, 'pt-BR'))
      message = rows.length ? rows.map((item) => `${item.title} — ${formatDate(item.dueAt, context.timezone)}`).join('\n') : 'Não encontrei prazos correspondentes.'
    } else if (capability === 'review.needs.list') {
      const rows = context.reviewNeeds.filter((item) => !workspace || item.workspaceId === workspace.id).sort((a, b) => (a.nextReviewAt ?? Number.MAX_SAFE_INTEGER) - (b.nextReviewAt ?? Number.MAX_SAFE_INTEGER) || a.conceptName.localeCompare(b.conceptName, 'pt-BR'))
      message = rows.length ? rows.map((item) => `${item.workspaceName}: ${item.conceptName} — ${item.nextReviewAt !== null && item.nextReviewAt <= context.version ? 'revisão vencida' : item.retention === 'fragile' ? 'retenção frágil' : item.performance === 'struggling' ? 'desempenho com dificuldade' : 'revisão indicada'}`).join('\n') : 'Não há necessidades de revisão persistidas no momento.'
    } else {
      const nearestSubjects = /\b(?:mat[eé]rias?|disciplinas?)\b/i.test(context.content) && /\b(?:prazo|prazos|pr[oó]xim[oa])\b/i.test(context.content)
      const query = capability === 'academicLife.search' && !nearestSubjects ? entities.query?.toLocaleLowerCase('pt-BR') : null
      const eventKind = entities.eventKind ?? this.eventKindFrom(context.content)
      let targetDate: number | null = null
      try { if (entities.dateExpression) targetDate = extractAcademicDate(context.content, context).timestamp } catch { if (entities.dateExpression) return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'A data da consulta é ambígua ou impossível. Informe uma data válida.' } }
      const rows = context.academicLife.filter((item) => { const stored = storedEvent(item); return item.status === 'active' && item.replacedById === null && (!workspace || item.workspaceId === workspace.id) && (!entities.subject || (stored && searchNormalized(stored.subject) === searchNormalized(entities.subject))) && (!eventKind || stored?.eventKind === eventKind) && (!targetDate || item.endsAt === targetDate) && (!query || `${item.title} ${item.details}`.toLocaleLowerCase('pt-BR').includes(query)) }).sort((a, b) => (a.endsAt ?? Number.MAX_SAFE_INTEGER) - (b.endsAt ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title, 'pt-BR'))
      if (nearestSubjects) {
        const activeLife = context.academicLife.filter((item) => item.status === 'active' && item.replacedById === null && item.endsAt !== null)
        const combined = [...activeLife.map((item) => ({ key: `life:${item.id}`, title: item.title, dueAt: item.endsAt! })), ...context.deadlines.filter((item) => item.dueAt >= context.version).map((item) => ({ key: `deadline:${item.id}`, title: item.title, dueAt: item.dueAt }))].filter((item, index, all) => all.findIndex((candidate) => candidate.title === item.title && candidate.dueAt === item.dueAt) === index).sort((a, b) => a.dueAt - b.dueAt || a.title.localeCompare(b.title, 'pt-BR'))
        message = combined.length ? combined.map((item) => `${item.title} — ${formatDate(item.dueAt, context.timezone)}`).join('\n') : 'Não encontrei matérias com prazos ativos.'
      } else message = rows.length ? rows.map((item) => `${item.title}${item.endsAt ? ` — ${formatDate(item.endsAt, context.timezone)}` : ''}`).join('\n') : 'Não encontrei registros correspondentes.'
    }
    return { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: workspace ? [workspace.id] : [], message }
  }

  private academicEventMutation(capability: string, entities: OrganizerEntities, context: OrganizerExecutionContext): { type: PlannerActionType; payload: unknown; label: string } | HomeOrganizerResult | null {
    if (capability === 'academic.event.linkWorkspace' || capability === 'academic.event.unlinkWorkspace') return this.eventWorkspaceMutation(capability, entities, context)
    const operation = capability === 'academic.event.create' || capability === 'academic-life.save' ? 'create' : capability === 'academic.event.update' ? 'update' : capability === 'academic.event.cancel' ? 'cancel' : null
    if (!operation) return null
    const semanticContent = context.originContent ?? context.content
    const focused = context.focusedAcademicEventId ? context.academicLife.find((item) => item.id === context.focusedAcademicEventId && item.status === 'active' && item.replacedById === null) : null
    const focusedMetadata = focused ? storedEvent(focused) : null
    const statedSubject = subjectFrom(semanticContent)
    const contextualReference = Boolean(context.focusedAcademicEventId) && !subjectFrom(context.content)
    if (!entities.subject || (contextualReference ? !focusedMetadata || searchNormalized(entities.subject) !== searchNormalized(focusedMetadata.subject) : !statedSubject || searchNormalized(entities.subject) !== searchNormalized(statedSubject))) throw new Error('Organizer subject does not correspond to the user message or focused event')
    const statedKind = contextualReference ? focusedMetadata?.eventKind ?? null : this.eventKindFrom(semanticContent) ?? focusedMetadata?.eventKind ?? null
    const eventKind = entities.eventKind ?? (capability === 'academic-life.save' ? statedKind : null)
    if (!eventKind || statedKind !== eventKind) throw new Error('Organizer event kind does not correspond to the user message')
    let targetDate: number | null = null; let nextDate: number | null = null
    try {
      if (operation === 'create') nextDate = extractAcademicDate(semanticContent, context).timestamp
      else if (operation === 'update' && focused) { nextDate = extractAcademicDate(semanticContent, context).timestamp }
      else if (operation === 'update') { const change = extractAcademicDateChange(semanticContent, context); targetDate = change.from.timestamp; nextDate = change.to.timestamp }
      else { try { targetDate = extractAcademicDate(semanticContent, context).timestamp } catch (error) { if (!(error instanceof Error) || error.message !== 'Data ausente') throw error } }
    } catch (error) {
      return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: error instanceof Error ? `${error.message}. Informe uma data válida e inequívoca.` : 'Informe uma data válida e inequívoca.' }
    }
    const title = `${eventKind === 'exam' ? 'Prova' : eventKind === 'assignment' ? 'Trabalho' : 'Prazo'} ${entities.subject.trim()}`
    const formattedNextDate = nextDate === null ? null : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: context.timezone }).format(nextDate)
    if (operation === 'create') { const effortMinutes = estimatedEffort(semanticContent); return { type: 'academic-life.save', payload: { kind: this.lifeKind(eventKind), title, details: JSON.stringify({ ...JSON.parse(eventDetails(eventKind, entities.subject, context.content)), ...(effortMinutes === null ? {} : { estimatedMinutes: effortMinutes }) }), workspaceId: null, startsAt: null, endsAt: nextDate, expiresAt: nextDate, timezone: context.timezone, weekday: null, minutes: null, shareWithAi: false, provenance: { source: 'conversation', reference: null } }, label: `Salvar ${title} em ${formattedNextDate}${effortMinutes === null ? '' : ` com esforço estimado de ${effortMinutes} min`}` } }
    const matches = context.academicLife.filter((item) => { const stored = storedEvent(item); return item.status === 'active' && item.replacedById === null && stored?.eventKind === eventKind && searchNormalized(stored.subject) === searchNormalized(entities.subject!) && (targetDate === null || item.endsAt === targetDate) && (!context.focusedAcademicEventId || item.id === context.focusedAcademicEventId) })
    if (!matches.length) return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Não encontrei um evento acadêmico ativo correspondente. Nenhuma alteração foi proposta.' }
    if (matches.length > 1) return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Encontrei mais de um evento acadêmico correspondente. Informe a data atual para eu identificar o evento exato.' }
    const match = matches[0]!
    if (operation === 'cancel') return { type: 'academic-life.transition', payload: { id: match.id, status: 'archived' }, label: `Cancelar ${match.title}` }
    return { type: 'academic-life.save', payload: { kind: match.kind, title: match.title, details: eventDetails(eventKind, entities.subject, context.content), workspaceId: null, startsAt: match.startsAt, endsAt: nextDate, expiresAt: nextDate, timezone: context.timezone, weekday: null, minutes: null, shareWithAi: match.shareWithAi, provenance: { source: 'conversation', reference: null }, replacesId: match.id }, label: `Reagendar ${match.title} para ${formattedNextDate}` }
  }

  private eventWorkspaceMutation(capability: string, entities: OrganizerEntities, context: OrganizerExecutionContext): { type: PlannerActionType; payload: unknown; label: string } | HomeOrganizerResult {
    const subject = entities.subject && normalized(context.content).includes(normalized(entities.subject)) ? entities.subject : subjectFrom(context.content)
    if (!subject) return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Informe a matéria do evento para eu identificar o vínculo com segurança.' }
    const matches = context.academicLife.filter((item) => { const stored = storedEvent(item); return item.status === 'active' && item.replacedById === null && stored && searchNormalized(stored.subject) === searchNormalized(subject) })
    if (matches.length !== 1) return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: matches.length ? 'Encontrei mais de um evento correspondente. Informe a data para identificar o evento exato.' : 'Não encontrei um evento acadêmico ativo correspondente.' }
    const event = matches[0]!
    if (capability === 'academic.event.unlinkWorkspace') {
      if (event.workspaceId === null) return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Esse evento já está sem vínculo com Workspace.' }
      return { type: 'academic.event.unlinkWorkspace', payload: { eventId: event.id }, label: `Manter ${event.title} sem Workspace` }
    }
    const workspace = context.workspaces.filter((item) => normalized(context.content).includes(normalized(item.name)))
    if (workspace.length !== 1) return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: workspace.length ? 'Há mais de um Workspace plausível. Escolha qual deve receber o evento.' : 'Informe um Workspace ativo para vincular o evento.' }
    return { type: 'academic.event.linkWorkspace', payload: { eventId: event.id, workspaceId: workspace[0]!.id, subject }, label: `Vincular ${event.title} ao Workspace ${workspace[0]!.name}` }
  }

  private eventKindFrom(content: string): OrganizerEntities['eventKind'] { const word = /\b(provas?|exames?|trabalhos?|atividades?|prazos?|deadlines?)\b/i.exec(content)?.[1]?.toLocaleLowerCase('pt-BR'); return word?.startsWith('prova') || word?.startsWith('exame') ? 'exam' : word?.startsWith('trabalho') || word?.startsWith('atividade') ? 'assignment' : word ? 'deadline' : null }
  private lifeKind(kind: NonNullable<OrganizerEntities['eventKind']>): 'event' | 'commitment' { return persistenceKind(kind) }

  private mutationProposal(capability: string, entities: OrganizerEntities, workspace: { id: string; name: string } | null, context: OrganizerExecutionContext): { type: PlannerActionType; payload: unknown; label: string } {
    const contentSubject = subjectFrom(context.content)
    if (entities.subject && (!contentSubject || normalized(entities.subject) !== normalized(contentSubject))) throw new Error('Organizer subject does not correspond to the user message')
    if (capability === 'workspace.prepare') { if (!contentSubject) throw new Error('Workspace subject is required'); return { type: 'workspace.prepare', payload: { name: contentSubject, objective: `Preparação acadêmica em ${contentSubject}` }, label: `Preparar Workspace de ${contentSubject}` } }
    if (capability === 'academic-life.transition') { const target = entities.target && normalized(context.content).includes(normalized(entities.target)) ? normalized(entities.target) : null; const resolved = /\b(?:resolver|resolva|concluir|conclua|finalizar|finalize)\b/i.test(context.content); const archived = /\b(?:arquivar|arquive)\b/i.test(context.content); const expectedStatus = resolved === archived ? null : resolved ? 'resolved' as const : 'archived' as const; const matches = target ? context.academicLife.filter((item) => normalized(item.title).includes(target) && item.status === 'active') : []; if (matches.length !== 1 || !entities.status || entities.status !== expectedStatus) throw new Error('Academic life transition does not correspond to the user message'); return { type: 'academic-life.transition', payload: { id: matches[0]!.id, status: expectedStatus }, label: `${expectedStatus === 'resolved' ? 'Resolver' : 'Arquivar'} ${matches[0]!.title}` } }
    const statedMinutes = minutesFrom(context.content)
    if (capability === 'plan.today-budget.set') { if (statedMinutes === null || statedMinutes !== entities.minutes) throw new Error('Organizer minutes do not correspond to the user message'); const composite = /\b(?:recalcule|recalcular|refaça|refaca|redistribua|reorganize)\b/i.test(context.content); return { type: 'plan.today-budget.set', payload: { dateKey: context.currentDate, timezone: context.timezone, minutes: statedMinutes }, label: `Usar ${statedMinutes} min disponíveis hoje${composite ? ' e recalcular o plano atomicamente' : ''}` } }
    if (capability === 'plan.weekday-availability.set') { const weekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']; if (statedMinutes === null || statedMinutes !== entities.minutes || entities.weekday === null || !normalized(context.content).includes(weekdays[entities.weekday]!)) throw new Error('Organizer availability does not correspond to the user message'); return { type: 'plan.weekday-availability.set', payload: { weekday: entities.weekday, timezone: context.timezone, minutes: statedMinutes }, label: `Definir ${statedMinutes} min de disponibilidade` } }
    if (capability === 'plan.recalculate') { if (!/\b(?:recalcule|recalcular|refaça|refaca|redistribua|reorganize)\b/i.test(context.content) || !/\b(?:plano|semana|estudos?)\b/i.test(context.content)) throw new Error('Recalculation does not correspond to the user message'); return { type: 'plan.recalculate', payload: { timezone: context.timezone }, label: 'Recalcular o plano semanal' } }
    if (capability === 'plan.item-completion.set') { const target = entities.target && normalized(context.content).includes(normalized(entities.target)) ? normalized(entities.target) : null; const completed = /\b(?:concluir|conclua|terminei|finalizei|marcar como conclu[ií]d[ao])\b/i.test(context.content); const reopened = /\b(?:reabrir|reabra|desfazer conclus[aã]o|marcar como pendente)\b/i.test(context.content); if (entities.completed !== completed || completed === reopened) throw new Error('Completion state does not correspond to the user message'); const matches = target ? (context.plan?.days.flatMap((day) => day.items) ?? []).filter((item) => normalized(item.title).includes(target)) : []; if (matches.length !== 1) throw new Error('Plan item target is missing or ambiguous'); const item = matches[0]!; return { type: 'plan.item-completion.set', payload: { workspaceId: item.workspaceId, itemId: item.id, completed }, label: `${completed ? 'Concluir' : 'Reabrir'} ${item.title}` } }
    throw new Error('Unsupported Organizer mutation capability')
  }

  private missingFieldsMessage(fields: readonly string[]): string {
    const labels: Record<string, string> = { subject: 'a matéria', dateExpression: 'a data', minutes: 'o tempo disponível', weekday: 'o dia da semana', target: 'o item exato', status: 'o estado desejado', objective: 'o objetivo' }
    const missing = fields.map((field) => labels[field]).filter(Boolean)
    return missing.length ? `Ainda preciso de ${missing.join(' e ')} para continuar com segurança.` : 'Ainda faltam informações para continuar com segurança.'
  }
}
