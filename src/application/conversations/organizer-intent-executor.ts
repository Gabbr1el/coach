import type { AcademicLifeItem } from '../../shared/contracts/academic-life-contract'
import { ORGANIZER_CAPABILITY_REGISTRY, type OrganizerEntities, type OrganizerIntent } from '../../shared/contracts/organizer-intent-contract'
import type { AcademicEvent, HomeOrganizerResult, WeeklyPlan } from '../../shared/contracts/planning-contract'
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
  readonly plan: WeeklyPlan | null
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
function subjectFrom(content: string): string | null { return /(?:prova|exame|trabalho|atividade|prazo)\s+(?:de|da|do)\s+(.+?)(?=\s+(?:mudou\b|passou\b|foi\s+remarcad[ao]\b|foi\s+adiad[ao]\b|ao\s+workspace\b|do\s+workspace\b|sem\s+workspace\b|no\s+dia|dia|em\s+\d|amanh[ãa]|hoje|na\s+(?:segunda|terça|quarta|quinta|sexta|sábado|domingo))\b|[,.;]|\s+e\s+estou\b|$)/i.exec(content)?.[1]?.trim() ?? null }
const CREATE_CAPABILITIES = new Set(['workspace.prepare', 'academic-life.save', 'academic.event.create'])
function isInterrogativeOrQuery(content: string): boolean { const value = normalized(content); return content.includes('?') || /^(?:qual|quais|quando|onde|como|quem|quanto|quantos|quantas|liste|mostre|consulte|busque|procure)\b/.test(value) || /\b(?:quero saber|gostaria de saber|me diga|você sabe|voce sabe)\b/.test(value) }
function isCancellation(content: string): boolean { return /\b(?:cancelar|cancele|cancela|cancelado|cancelada|cancelaram|foi cancelad[ao]|adiar|adie|remover|remova|excluir|exclua|apagar|apague)\b/i.test(content) }

export class OrganizerIntentExecutor {
  constructor(private readonly actions: PlannerActionService) {}
  execute(intent: OrganizerIntent, context: OrganizerExecutionContext): OrganizerExecution {
    if (intent.mode === 'conversation') return null
    if (intent.mode === 'clarification') return { result: { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Preciso de mais informações para identificar uma operação suportada com segurança.' } }
    if (intent.missingFields.length) return { result: { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: this.missingFieldsMessage(intent.missingFields) } }
    const capability = intent.capability
    if (!capability) throw new Error('Organizer capability is required')
    const definition = ORGANIZER_CAPABILITY_REGISTRY[capability]
    if (definition.mode !== intent.mode || definition.access !== (intent.mode === 'query' ? 'read' : 'write')) throw new Error('Organizer capability access does not match intent mode')
    if (intent.mode === 'mutation') {
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
    const action = this.actions.propose({ type: parsed.type as PlannerActionType, payload: parsed.payload, label: proposal.label, originMessageId: assistantId, contextVersion: context.version })
    const workspaceIds = workspace ? [workspace.id] : []
    return { assistantId, result: { outcome: 'needs_decision', operations: [], actions: [action], affectedWorkspaceIds: workspaceIds, message: `Posso ${proposal.label.toLocaleLowerCase('pt-BR')}. Confirme pelo botão; nada mudou ainda.` } }
  }

  private query(capability: string, entities: OrganizerEntities, workspace: { id: string; name: string } | null, context: OrganizerExecutionContext): HomeOrganizerResult {
    let message: string
    if (capability === 'workspaces.list' || capability === 'workspaces.search') {
      const query = entities.query?.toLocaleLowerCase('pt-BR'); const rows = context.workspaces.filter((item) => !query || item.name.toLocaleLowerCase('pt-BR').includes(query))
      message = rows.length ? `Workspaces: ${rows.map((item) => item.name).join(', ')}.` : 'Não encontrei Workspaces correspondentes.'
    } else if (capability === 'plan.week.get') {
      const rows = context.plan?.days.flatMap((day) => day.items) ?? []; message = rows.length ? `O plano semanal tem ${rows.length} item(ns) distribuído(s) em ${context.plan!.days.filter((day) => day.items.length).length} dia(s).` : 'O plano semanal não tem itens persistidos.'
    } else if (capability === 'availability.get') {
      message = context.plan ? `Disponibilidade da semana: ${context.plan.days.map((day) => `${day.dateKey}: ${day.availableMinutes} min`).join('; ')}.` : 'Não há disponibilidade semanal persistida.'
    } else if (capability === 'deadlines.list') {
      const rows = context.deadlines.filter((item) => !workspace || item.workspaceId === workspace.id)
      message = rows.length ? rows.map((item) => `${item.title} — ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: context.timezone }).format(item.dueAt)}`).join('\n') : 'Não encontrei prazos correspondentes.'
    } else {
      const query = capability === 'academicLife.search' ? entities.query?.toLocaleLowerCase('pt-BR') : null
      const eventKind = entities.eventKind ?? this.eventKindFrom(context.content)
      let targetDate: number | null = null
      try { if (entities.dateExpression) targetDate = extractAcademicDate(context.content, context).timestamp } catch { if (entities.dateExpression) return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'A data da consulta é ambígua ou impossível. Informe uma data válida.' } }
      const rows = context.academicLife.filter((item) => { const stored = storedEvent(item); return item.status === 'active' && (!workspace || item.workspaceId === workspace.id) && (!entities.subject || (stored && searchNormalized(stored.subject) === searchNormalized(entities.subject))) && (!eventKind || stored?.eventKind === eventKind) && (!targetDate || item.endsAt === targetDate) && (!query || `${item.title} ${item.details}`.toLocaleLowerCase('pt-BR').includes(query)) })
      message = rows.length ? rows.map((item) => `${item.title}${item.endsAt ? ` — ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: context.timezone }).format(item.endsAt)}` : ''}`).join('\n') : 'Não encontrei registros correspondentes.'
    }
    return { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: workspace ? [workspace.id] : [], message }
  }

  private academicEventMutation(capability: string, entities: OrganizerEntities, context: OrganizerExecutionContext): { type: PlannerActionType; payload: unknown; label: string } | HomeOrganizerResult | null {
    if (capability === 'academic.event.linkWorkspace' || capability === 'academic.event.unlinkWorkspace') return this.eventWorkspaceMutation(capability, entities, context)
    const operation = capability === 'academic.event.create' || capability === 'academic-life.save' ? 'create' : capability === 'academic.event.update' ? 'update' : capability === 'academic.event.cancel' ? 'cancel' : null
    if (!operation) return null
    const statedSubject = subjectFrom(context.content)
    if (!entities.subject || !statedSubject || searchNormalized(entities.subject) !== searchNormalized(statedSubject)) throw new Error('Organizer subject does not correspond to the user message')
    const statedKind = this.eventKindFrom(context.content)
    const eventKind = entities.eventKind ?? (capability === 'academic-life.save' ? statedKind : null)
    if (!eventKind || statedKind !== eventKind) throw new Error('Organizer event kind does not correspond to the user message')
    let targetDate: number | null = null; let nextDate: number | null = null
    try {
      if (operation === 'create') nextDate = extractAcademicDate(context.content, context).timestamp
      else if (operation === 'update') { const change = extractAcademicDateChange(context.content, context); targetDate = change.from.timestamp; nextDate = change.to.timestamp }
      else { try { targetDate = extractAcademicDate(context.content, context).timestamp } catch (error) { if (!(error instanceof Error) || error.message !== 'Data ausente') throw error } }
    } catch (error) {
      return { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: error instanceof Error ? `${error.message}. Informe uma data válida e inequívoca.` : 'Informe uma data válida e inequívoca.' }
    }
    const title = `${eventKind === 'exam' ? 'Prova' : eventKind === 'assignment' ? 'Trabalho' : 'Prazo'} ${entities.subject.trim()}`
    const formattedNextDate = nextDate === null ? null : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: context.timezone }).format(nextDate)
    if (operation === 'create') return { type: 'academic-life.save', payload: { kind: this.lifeKind(eventKind), title, details: eventDetails(eventKind, entities.subject, context.content), workspaceId: null, startsAt: null, endsAt: nextDate, expiresAt: nextDate, timezone: context.timezone, weekday: null, minutes: null, shareWithAi: false, provenance: { source: 'conversation', reference: null } }, label: `Salvar ${title} em ${formattedNextDate}` }
    const matches = context.academicLife.filter((item) => { const stored = storedEvent(item); return item.status === 'active' && item.replacedById === null && stored?.eventKind === eventKind && searchNormalized(stored.subject) === searchNormalized(entities.subject!) && (targetDate === null || item.endsAt === targetDate) })
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
    if (capability === 'plan.today-budget.set') { if (statedMinutes === null || statedMinutes !== entities.minutes) throw new Error('Organizer minutes do not correspond to the user message'); return { type: 'plan.today-budget.set', payload: { dateKey: context.currentDate, timezone: context.timezone, minutes: statedMinutes }, label: `Usar ${statedMinutes} min disponíveis hoje` } }
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
