import type { AcademicLifeItem } from '../../shared/contracts/academic-life-contract'
import { ORGANIZER_CAPABILITY_REGISTRY, type OrganizerEntities, type OrganizerIntent } from '../../shared/contracts/organizer-intent-contract'
import type { AcademicEvent, HomeOrganizerResult, WeeklyPlan } from '../../shared/contracts/planning-contract'
import type { PlannerActionType } from '../../shared/contracts/planner-action-contract'
import { plannerActionProposalSchema } from '../../shared/contracts/planner-action-contract'
import type { PlannerActionService } from '../planning/planner-action-service'
import { parseExplicitDate } from '../planning/planning-service'

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
function workspaceFor(entities: OrganizerEntities, workspaces: OrganizerExecutionContext['workspaces']): { id: string; name: string } | null { return entities.subject ? workspaces.find((item) => normalized(item.name) === normalized(entities.subject!)) ?? null : null }
function minutesFrom(content: string): number | null { const hours = /(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)\b/i.exec(content)?.[1]; if (hours) return Math.round(Number(hours.replace(',', '.')) * 60); const minutes = /(\d+)\s*(?:min|minuto|minutos)\b/i.exec(content)?.[1]; return minutes ? Number(minutes) : null }
function subjectFrom(content: string): string | null { return /(?:prova|exame|trabalho|atividade|prazo)\s+(?:de|da|do)\s+(.+?)(?=\s+(?:no\s+dia|dia|em\s+\d|amanh[ãa]|hoje|na\s+(?:segunda|terça|quarta|quinta|sexta|sábado|domingo))\b|[,.;]|\s+e\s+estou\b|$)/i.exec(content)?.[1]?.trim() ?? null }
const CREATE_CAPABILITIES = new Set(['workspace.prepare', 'academic-life.save'])
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
      if (isCancellation(context.content)) return { result: { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Entendi um cancelamento, mas não encontrei um registro existente que possa ser alterado com segurança. Nenhuma criação foi proposta.' } }
      if (CREATE_CAPABILITIES.has(capability) && /\b(?:resolver|resolva|arquivar|arquive|concluir|conclua|finalizar|finalize)\b/i.test(context.content)) return { result: { outcome: 'needs_information', operations: [], actions: [], affectedWorkspaceIds: [], message: 'Esse pedido parece alterar um registro existente, não criar um novo. Nenhuma criação foi proposta.' } }
    }
    const workspace = workspaceFor(intent.entities, context.workspaces)
    if (intent.entities.subject && !workspace && capability !== 'workspace.prepare' && capability !== 'academic-life.save') throw new Error('Organizer subject does not match an owned Workspace')

    if (intent.mode === 'query') {
      return { result: this.query(capability, intent.entities, workspace, context) }
    }
    const proposal = this.mutationProposal(capability, intent.entities, workspace, context)
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
      const rows = context.academicLife.filter((item) => (!workspace || item.workspaceId === workspace.id) && (!query || `${item.title} ${item.details}`.toLocaleLowerCase('pt-BR').includes(query)))
      message = rows.length ? rows.map((item) => `${item.title}${item.endsAt ? ` — ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: context.timezone }).format(item.endsAt)}` : ''}`).join('\n') : 'Não encontrei registros correspondentes.'
    }
    return { outcome: 'informational', operations: [], actions: [], affectedWorkspaceIds: workspace ? [workspace.id] : [], message }
  }

  private mutationProposal(capability: string, entities: OrganizerEntities, workspace: { id: string; name: string } | null, context: OrganizerExecutionContext): { type: PlannerActionType; payload: unknown; label: string } {
    const contentSubject = subjectFrom(context.content)
    if (entities.subject && (!contentSubject || normalized(entities.subject) !== normalized(contentSubject))) throw new Error('Organizer subject does not correspond to the user message')
    if (capability === 'workspace.prepare') { if (!contentSubject) throw new Error('Workspace subject is required'); return { type: 'workspace.prepare', payload: { name: contentSubject, objective: `Preparação acadêmica em ${contentSubject}` }, label: `Preparar Workspace de ${contentSubject}` } }
    if (capability === 'academic-life.save') {
      const dueAt = parseExplicitDate(context.content, context.version); if (!contentSubject || !dueAt) throw new Error('Academic event subject and date are required')
      if (!workspace) return { type: 'workspace.prepare', payload: { name: contentSubject, objective: `Preparação acadêmica em ${contentSubject}` }, label: `Preparar Workspace de ${contentSubject}` }
      const word = /\b(prova|exame|trabalho|atividade|prazo)\b/i.exec(context.content)?.[1]?.toLocaleLowerCase('pt-BR') ?? 'evento'; const kind = word === 'trabalho' || word === 'atividade' ? 'commitment' as const : 'event' as const; const title = `${word[0]!.toLocaleUpperCase('pt-BR')}${word.slice(1)} ${workspace.name}`
      return { type: 'academic-life.save', payload: { kind, title, details: context.content.slice(0, 1000), workspaceId: workspace.id, startsAt: null, endsAt: dueAt, expiresAt: dueAt, timezone: context.timezone, weekday: null, minutes: null, shareWithAi: false, provenance: { source: 'conversation', reference: null } }, label: `Salvar ${title}` }
    }
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
