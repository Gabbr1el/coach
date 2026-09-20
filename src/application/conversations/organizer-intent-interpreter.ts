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

export interface OrganizerProviderResult {
  readonly providerId: string
  readonly modelId: string
  readonly conversationReply: string | null
}

export type OrganizerInterpretation =
  OrganizerIntent & {
    readonly providerResult?:
      OrganizerProviderResult
  }

export interface OrganizerIntentInterpreter {
  interpret(
    content: string,
    context: OrganizerInterpretationContext,
  ): Promise<OrganizerInterpretation>
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
  async interpret(content: string, context: OrganizerInterpretationContext): Promise<OrganizerInterpretation> {
    const deterministic = await this.fallback.interpret(content, context)
    const deterministicAcademicCreate =
      (
        deterministic.capability === 'academic.event.create'
        && deterministic.mode === 'mutation'
        && deterministic.missingFields.length === 0
        && deterministic.entities.subject !== null
        && deterministic.entities.eventKind !== null
        && deterministic.entities.dateExpression !== null
      )
      || (
        deterministic.mode === 'clarification'
        && deterministic.capability === null
        && deterministic.entities.subject !== null
        && deterministic.entities.eventKind !== null
        && deterministic.missingFields.length > 0
        && deterministic.missingFields.every((field) => field === 'dateExpression')
      )

    if (deterministicAcademicCreate) return deterministic

    const provider = this.providers.route('planner')
    if (!provider) return deterministic
    try {
      const response = await provider.sendMessage({
        messages: [
          { role: 'system', content: 'Interpret intent; never execute/write. Return only strict JSON matching OrganizerIntent: mode query|mutation|clarification|conversation, capability from the supplied callable catalog or null, Return exactly these top-level keys: mode, capability, entities, confidence, missingFields, summary. "entities" MUST be a nested object containing exactly subject, query, eventKind, dateExpression, dateFromExpression, dateToExpression, weekday, minutes, completed, target and status. Inside entities, include only relevant non-null entity keys; omit unknown entity keys. The Coach fills omitted known entity keys with null. confidence, missingFields and summary are TOP-LEVEL siblings of entities and MUST NEVER be placed inside entities. When mode is conversation, summary MUST be the short, natural, user-facing reply in Brazilian Portuguese; answer the user there instead of merely describing the intent. For query, mutation or clarification, summary is only a terse description and is never authoritative. Example conversation shape: {"mode":"conversation","capability":null,"entities":{},"confidence":0.9,"missingFields":[],"summary":"Oi! Como posso ajudar com seus estudos?"}. For an unavailable capability return mode conversation, capability null, and target "unsupported:<capability>" exactly. Dates must remain verbatim semantic expressions. Never output timestamps, IDs, ownership, persisted records, PlannerAction payloads, provenance, privacy flags, titles or details. A query mentioning prova, prazo, trabalho or evento is never a create. Statements about knowledge or time already studied are conversation, never planning or ConceptMemory mutations. Use academic.event.cancel for cancellation and academic.event.update for rescheduling. Legacy academic-life aliases remain available only for compatibility.' },
          { role: 'user', content: JSON.stringify({ message: content, capabilities: ORGANIZER_CAPABILITY_CATALOG, unavailableCapabilities: ORGANIZER_UNAVAILABLE_CAPABILITIES, currentDate: context.currentDate, timezone: context.timezone, conversation: context.conversation ?? null }) },
        ],
        maxOutputTokens: 320,

        responseFormat:
          'json_object',
      })
      const extracted =
        extractJsonDocument(
          response.content,
        )

      const normalizedExtracted =
        (() => {
          if (
            !extracted
            || typeof extracted !== 'object'
            || Array.isArray(extracted)
          ) {
            return extracted
          }

          const candidate =
            extracted as Record<
              string,
              unknown
            >

          const entityKeys = [
            'subject',
            'query',
            'eventKind',
            'dateExpression',
            'dateFromExpression',
            'dateToExpression',
            'weekday',
            'minutes',
            'completed',
            'target',
            'status',
          ] as const

          const metadataKeys = [
            'confidence',
            'missingFields',
            'summary',
          ] as const

          const allowedTopLevelKeys =
            new Set<string>([
              'mode',
              'capability',
              'entities',
              ...metadataKeys,
              ...entityKeys,
            ])

          /*
           * Só aceitamos as duas variações estruturais
           * conhecidas do provider.
           *
           * Qualquer chave desconhecida continua indo
           * intacta para o schema strict e será rejeitada.
           */
          if (
            Object.keys(candidate)
              .some(
                (key) =>
                  !allowedTopLevelKeys
                    .has(key),
              )
          ) {
            return extracted
          }

          const rawEntities =
            candidate.entities

          if (
            rawEntities !== undefined
            && (
              rawEntities === null
              || typeof rawEntities !== 'object'
              || Array.isArray(rawEntities)
            )
          ) {
            return extracted
          }

          const nested =
            (
              rawEntities
              ?? {}
            ) as Record<
              string,
              unknown
            >

          const allowedNestedKeys =
            new Set<string>([
              ...entityKeys,
              ...metadataKeys,
            ])

          if (
            Object.keys(nested)
              .some(
                (key) =>
                  !allowedNestedKeys
                    .has(key),
              )
          ) {
            return extracted
          }

          /*
           * Não tentamos resolver valores duplicados
           * vindos de dois níveis diferentes.
           * Ambiguidade continua sendo rejeitada.
           */
          if (
            entityKeys.some(
              (key) =>
                key in candidate
                && key in nested,
            )
            || metadataKeys.some(
              (key) =>
                key in candidate
                && key in nested,
            )
          ) {
            return extracted
          }

          const entities:
            Record<string, unknown> = {
              ...blankEntities,
            }

          for (
            const key
            of entityKeys
          ) {
            if (key in nested) {
              entities[key] =
                nested[key]
            } else if (key in candidate) {
              entities[key] =
                candidate[key]
            }
          }

          const normalized:
            Record<string, unknown> =
              Object.fromEntries(
                Object.entries(candidate)
                  .filter(
                    ([key]) =>
                      key !== 'entities'
                      && !entityKeys.includes(
                        key as
                          typeof entityKeys[number],
                      ),
                  ),
              )

          /*
           * Corrige especificamente o segundo formato
           * observado:
           *
           * entities: {
           *   confidence,
           *   missingFields,
           *   summary
           * }
           */
          for (
            const key
            of metadataKeys
          ) {
            if (
              !(key in normalized)
              && key in nested
            ) {
              normalized[key] =
                nested[key]
            }
          }

          normalized.entities =
            entities

          return normalized
        })()

      const parsed =
        organizerIntentSchema.safeParse(
          normalizedExtracted,
        )

      if (!parsed.success) {
        console.error(
          '[Coach Organizer structured intent invalid]',
          {
            providerId:
              response.providerId,

            modelId:
              response.modelId,

            responsePreview:
              response.content.slice(
                0,
                1500,
              ),

            issues:
              parsed.error.issues.map(
                (issue) => ({
                  path:
                    issue.path.join('.'),

                  code:
                    issue.code,

                  message:
                    issue.message,
                }),
              ),
          },
        )

        throw new Error(
          'Organizer provider returned an invalid structured intent',
          {
            cause:
              parsed.error,
          },
        )
      }

      const conversationReply =
        (
          parsed.data.mode === 'conversation'
          && parsed.data.capability === null
          && parsed.data.entities.target === null
          && parsed.data.missingFields.length === 0
        )
          ? parsed.data.summary.trim()
          : null

      return {
        ...parsed.data,

        providerResult: {
          providerId:
            response.providerId,

          modelId:
            response.modelId,

          conversationReply,
        },
      }
    } catch (error) {
      if (error instanceof Error && (error.name === 'ZodError' || /JSON|capability|intent/i.test(error.message))) throw new Error('Organizer provider returned an invalid structured intent', { cause: error })
      return deterministic
    }
  }
}
