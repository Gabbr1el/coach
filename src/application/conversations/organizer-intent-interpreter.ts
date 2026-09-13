import type { AIProviderManager } from '../ai/ai-provider-manager'
import { extractJsonDocument } from '../ai/structured-json'
import { ORGANIZER_CAPABILITY_CATALOG, ORGANIZER_UNAVAILABLE_CAPABILITIES, organizerIntentSchema, type OrganizerIntent } from '../../shared/contracts/organizer-intent-contract'

export interface OrganizerInterpretationContext {
  readonly currentTime: number
  readonly currentDate: string
  readonly timezone: string
  readonly conversation?: {
    readonly focus: { readonly academicEvent: boolean; readonly workspace: boolean; readonly subject: string | null }
    readonly pending: { readonly capability: string; readonly entities: unknown; readonly missingFields: readonly string[] } | null
    readonly recentUserMessages: ReadonlyArray<{ readonly content: string; readonly createdAt: number }>
  }
}

export interface OrganizerIntentInterpreter {
  interpret(content: string, context: OrganizerInterpretationContext): Promise<OrganizerIntent>
}

const blankEntities = { subject: null, query: null, dateExpression: null, dateFromExpression: null, dateToExpression: null, eventKind: null, weekday: null, minutes: null, completed: null, target: null, status: null }

function eventEntities(content: string) {
  const kindWord = /\b(provas?|exames?|trabalhos?|atividades?|prazos?|deadlines?)\b/i.exec(content)?.[1]?.toLocaleLowerCase('pt-BR')
  const eventKind = kindWord?.startsWith('prova') || kindWord?.startsWith('exame') ? 'exam' as const : kindWord?.startsWith('trabalho') || kindWord?.startsWith('atividade') ? 'assignment' as const : kindWord ? 'deadline' as const : null
  const subject = /(?:prova|exame|trabalho|atividade|prazo|deadline)\s+(?:de|da|do)\s+(.+?)(?=\s+amanh[ãa])/i.exec(content)?.[1]?.trim() ?? /(?:prova|exame|trabalho|atividade|prazo|deadline)\s+(?:de|da|do)\s+(.+?)(?=\s+(?:foi\s+|mudou\s+|passou\s+|ao\s+workspace\b|do\s+workspace\b|sem\s+workspace\b|no\s+dia|dia|em\s+\d|para\s+(?:o\s+)?dia|amanh[ãa]|hoje|depois\s+de\s+amanh[ãa]|(?:na\s+)?(?:pr[oó]xima\s+)?(?:segunda|terça|quarta|quinta|sexta|sábado|domingo)|daqui\s+a|e\s+\d+(?:[.,]\d+)?\s*(?:h|hora|min))\b|[,.;]|$)/i.exec(content)?.[1]?.trim() ?? null
  const marker = /\b(?:mudou|remarcad[ao]|adiad[ao]|passou)\b/i.exec(content)
  const changeTail = marker ? content.slice(marker.index + marker[0].length).trim() : ''
  const dateToExpression = /\bpara\s+(.+)$/i.exec(changeTail)?.[1]?.trim() ?? null
  const dateFromExpression = dateToExpression ? /^(?:(?:de|do|da)\s+)?(.+?)\s+para\b/i.exec(changeTail)?.[1]?.trim() ?? null : null
  const hasDate = /\b(?:hoje|depois\s+de\s+amanh[ãa]|dia\s+\d{1,2}|daqui\s+a\s+\d+\s+dias?|(?:pr[oó]xima\s+)?(?:segunda|terça|quarta|quinta|sexta|sábado|domingo)(?:-feira)?|\d{1,2}\s*[\/.]\s*\d{1,2}|\d{1,2}\s+de\s+[a-zç]+)\b/i.test(content) || /\bamanh[ãa](?=\s|[,.;!?]|$)/i.test(content)
  return { subject, eventKind, dateExpression: marker || !hasDate ? null : content, dateFromExpression, dateToExpression }
}

function minutesFrom(content: string): number | null {
  const hours = /(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)\b/i.exec(content)?.[1]
  if (hours) return Math.round(Number(hours.replace(',', '.')) * 60)
  const minutes = /(\d+)\s*(?:min|minuto|minutos)\b/i.exec(content)?.[1]
  return minutes ? Number(minutes) : null
}

export class LocalOrganizerIntentInterpreter implements OrganizerIntentInterpreter {
  async interpret(content: string, context: OrganizerInterpretationContext): Promise<OrganizerIntent> {
    const normalized = content.toLocaleLowerCase('pt-BR'); const minutes = minutesFrom(content)
    const queryWords = /\b(?:qual|quais|quando|liste|mostre|existe|como está|como esta)\b/
    const eventWords = /\b(?:provas?|exames?|trabalhos?|atividades?|prazos?|eventos?)\b/
    if (/\b(?:liste|listar|mostre|mostrar|list|show)\b/.test(normalized) && /\b(?:prazos?|deadlines?)\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'query', capability: 'deadlines.list', entities: { ...blankEntities, ...eventEntities(content) }, confidence: 0.62, missingFields: [], summary: 'Consultar prazos persistidos.' })
    if (/\b(?:reservar|reserve)\b.*\b(?:bloco|revis[aã]o)\b/.test(normalized) || /\bseparar\b.*\b(?:para\s+)?revis[aã]o\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'conversation', capability: null, entities: { ...blankEntities, target: 'unsupported:plan.reserveBlock' }, confidence: 0.6, missingFields: [], summary: 'Capacidade indisponível.' })
    if (/\b(?:mover|mova|remanejar|remaneje)\b.*\b(?:item|plano|estudo)\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'conversation', capability: null, entities: { ...blankEntities, target: 'unsupported:plan.moveItem' }, confidence: 0.58, missingFields: [], summary: 'Capacidade indisponível.' })
    if (/\b(?:trabalho|trabalhar|expediente)\b.*\b(?:at[eé]|18h|18 horas)\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'conversation', capability: null, entities: { ...blankEntities, target: 'unsupported:availability.workingUntil' }, confidence: 0.55, missingFields: [], summary: 'Capacidade indisponível.' })
    if (/\b(?:f[eé]rias|recesso)\b.*\b(?:at[eé])\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'conversation', capability: null, entities: { ...blankEntities, target: 'unsupported:availability.vacationUntil' }, confidence: 0.55, missingFields: [], summary: 'Capacidade indisponível.' })
    if (/\b(?:coisa|tarefa|estudo)\s+mais\s+importante\b.*\bhoje\b|\bo\s+que\s+(?:é|e)\s+mais\s+importante\b.*\bhoje\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'query', capability: 'plan.today.get', entities: blankEntities, confidence: 0.62, missingFields: [], summary: 'Consultar prioridade real de hoje.' })
    if (/\b(?:revis[aã]o|revisar)\b/.test(normalized) && queryWords.test(normalized)) return organizerIntentSchema.parse({ mode: 'query', capability: 'review.needs.list', entities: blankEntities, confidence: 0.58, missingFields: [], summary: 'Consultar necessidades de revisão.' })
    if (queryWords.test(normalized) && /\b(?:plano|estudos?)\b/.test(normalized) && /\bhoje\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'query', capability: 'plan.today.get', entities: blankEntities, confidence: 0.6, missingFields: [], summary: 'Consultar plano de hoje.' })
    if (queryWords.test(normalized) && /\b(?:plano|semana)\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'query', capability: 'plan.week.get', entities: blankEntities, confidence: 0.58, missingFields: [], summary: 'Consultar plano semanal.' })
    if (queryWords.test(normalized) && /\bdisponibilidade\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'query', capability: 'availability.get', entities: blankEntities, confidence: 0.58, missingFields: [], summary: 'Consultar disponibilidade.' })
    if (queryWords.test(normalized) && eventWords.test(normalized)) return organizerIntentSchema.parse({ mode: 'query', capability: 'academicLife.search', entities: { ...blankEntities, ...eventEntities(content) }, confidence: 0.56, missingFields: [], summary: 'Consultar eventos acadêmicos existentes.' })
    if (/\b(?:desvincular|desvincule|sem\s+workspace)\b/.test(normalized) && eventWords.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'academic.event.unlinkWorkspace', entities: { ...blankEntities, ...eventEntities(content) }, confidence: 0.55, missingFields: [], summary: 'Desvincular evento do Workspace.' })
    if (/\b(?:vincular|vincule|ligar|ligue)\b/.test(normalized) && eventWords.test(normalized) && /\bworkspace\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'academic.event.linkWorkspace', entities: { ...blankEntities, ...eventEntities(content) }, confidence: 0.55, missingFields: [], summary: 'Vincular evento ao Workspace.' })
    if (/\b(?:cancelar|cancele|apagar|excluir|remover)\b/.test(normalized) && eventWords.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'academic.event.cancel', entities: { ...blankEntities, ...eventEntities(content) }, confidence: 0.55, missingFields: [], summary: 'Cancelar evento acadêmico.' })
    const weekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']; const weekday = weekdays.findIndex((day) => normalized.includes(day))
    if (minutes !== null && weekday >= 0 && (/(?:dispon|tempo|estud|planej|tenho|terei|vou ter)/.test(normalized) || /\bs[oó](?=\s|$)/.test(normalized)) && !eventWords.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'plan.weekday-availability.set', entities: { ...blankEntities, weekday, minutes }, confidence: 0.6, missingFields: [], summary: `Definir ${minutes} minutos para ${weekdays[weekday]}.` })
    if (minutes !== null && /\bhoje\b/.test(normalized) && /(?:dispon|tempo|estud|planej|orçamento|orcamento|tenho|terei|vou ter|reorganize|recalcule)/.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'plan.today-budget.set', entities: { ...blankEntities, dateExpression: 'hoje', minutes }, confidence: 0.62, missingFields: [], summary: `Definir ${minutes} minutos disponíveis hoje.` })
    if (/\b(?:terminei|finalizei|concluir|conclua|marcar como conclu[ií]d[ao])\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'plan.item-completion.set', entities: { ...blankEntities, target: content.replace(/^.*?\b(?:terminei|finalizei|concluir|conclua)\b\s*/i, '').trim(), completed: true }, confidence: 0.5, missingFields: [], summary: 'Concluir item do plano.' })
    if (/\b(?:reabrir|reabra|desfazer conclus[aã]o|marcar como pendente)\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'plan.item-completion.set', entities: { ...blankEntities, target: content.replace(/^.*?\b(?:reabrir|reabra)\b\s*/i, '').trim(), completed: false }, confidence: 0.48, missingFields: [], summary: 'Reabrir item do plano.' })
    if (/\b(?:recalcule|recalcular|refaça|refaca|redistribua|reorganize)\b/.test(normalized) && /\b(?:plano|semana|estudos?)\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'plan.recalculate', entities: blankEntities, confidence: 0.58, missingFields: [], summary: 'Recalcular o plano semanal.' })
    if (/\b(?:criar|novo|preparar)\s+(?:um\s+)?workspace\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'clarification', capability: null, entities: blankEntities, confidence: 0.48, missingFields: ['subject', 'objective'], summary: 'Para criar um Workspace, me diga o tema, seu objetivo e seu nível atual.' })
    if (eventWords.test(normalized)) {
      const entities = eventEntities(content); const update = /\b(?:mudou|remarcad[ao]|adiad[ao]|passou)\b/.test(normalized)
      const missingFields = [...(!entities.subject ? ['subject'] : []), ...(!entities.eventKind ? ['eventKind'] : []), ...(update ? (!entities.dateToExpression ? ['dateToExpression'] : []) : (!entities.dateExpression ? ['dateExpression'] : []))]
      if (!missingFields.length) return organizerIntentSchema.parse({ mode: 'mutation', capability: update ? 'academic.event.update' : 'academic.event.create', entities: { ...blankEntities, ...entities }, confidence: 0.52, missingFields: [], summary: `${update ? 'Atualizar' : 'Registrar'} evento acadêmico.` })
      return organizerIntentSchema.parse({ mode: 'clarification', capability: null, entities: { ...blankEntities, ...entities }, confidence: 0.32, missingFields, summary: 'Faltam dados do evento acadêmico.' })
    }
    return organizerIntentSchema.parse({ mode: 'conversation', capability: null, entities: blankEntities, confidence: 0.25, missingFields: [], summary: 'Conversa sem operação determinística.' })
  }
}

export class ProviderOrganizerIntentInterpreter implements OrganizerIntentInterpreter {
  constructor(private readonly providers: AIProviderManager, private readonly fallback: OrganizerIntentInterpreter = new LocalOrganizerIntentInterpreter()) {}
  async interpret(content: string, context: OrganizerInterpretationContext): Promise<OrganizerIntent> {
    const provider = this.providers.route('planner')
    if (!provider) return this.fallback.interpret(content, context)
    try {
      const response = await provider.sendMessage({
        messages: [
          { role: 'system', content: 'Interpret intent; never execute/write. Return only strict JSON matching OrganizerIntent: mode query|mutation|clarification|conversation, capability from the supplied callable catalog or null, semantic entities limited to subject, query, eventKind (exam|assignment|deadline), dateExpression, dateFromExpression, dateToExpression, weekday, minutes, completed, target and status, confidence 0..1, missingFields string[], summary string. For an unavailable capability return mode conversation, capability null, and target "unsupported:<capability>" exactly. Dates must remain verbatim semantic expressions. Never output timestamps, IDs, ownership, persisted records, PlannerAction payloads, provenance, privacy flags, titles or details. A query mentioning prova, prazo, trabalho or evento is never a create. Statements about knowledge or time already studied are conversation, never planning or ConceptMemory mutations. Use academic.event.cancel for cancellation and academic.event.update for rescheduling. Legacy academic-life aliases remain available only for compatibility.' },
          { role: 'user', content: JSON.stringify({ message: content, capabilities: ORGANIZER_CAPABILITY_CATALOG, unavailableCapabilities: ORGANIZER_UNAVAILABLE_CAPABILITIES, currentDate: context.currentDate, timezone: context.timezone, conversation: context.conversation ?? null }) },
        ],
        maxOutputTokens: 700,
      })
      return organizerIntentSchema.parse(extractJsonDocument(response.content))
    } catch (error) {
      if (error instanceof Error && (error.name === 'ZodError' || /JSON|capability|intent/i.test(error.message))) throw new Error('Organizer provider returned an invalid structured intent', { cause: error })
      return this.fallback.interpret(content, context)
    }
  }
}
