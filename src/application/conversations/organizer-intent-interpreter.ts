import type { AIProviderManager } from '../ai/ai-provider-manager'
import { extractJsonDocument } from '../ai/structured-json'
import { ORGANIZER_CAPABILITY_CATALOG, organizerIntentSchema, type OrganizerIntent } from '../../shared/contracts/organizer-intent-contract'
import { parseExplicitDate } from '../planning/planning-service'

export interface OrganizerInterpretationContext {
  readonly currentTime: number
  readonly currentDate: string
  readonly timezone: string
}

export interface OrganizerIntentInterpreter {
  interpret(content: string, context: OrganizerInterpretationContext): Promise<OrganizerIntent>
}

const blankEntities = { subject: null, query: null, dateExpression: null, weekday: null, minutes: null, completed: null, target: null, status: null }

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
    const eventWords = /\b(?:prova|exame|trabalho|atividade|prazo)\b/
    if (queryWords.test(normalized) && eventWords.test(normalized)) return organizerIntentSchema.parse({ mode: 'query', capability: 'deadlines.list', entities: blankEntities, confidence: 0.56, missingFields: [], summary: 'Consultar prazos e eventos existentes.' })
    if (/\b(?:cancelar|cancele|apagar|excluir|remover)\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'clarification', capability: null, entities: blankEntities, confidence: 0.35, missingFields: [], summary: 'Cancelamento não é uma capability disponível no Organizer.' })
    if (minutes !== null && /\bhoje\b/.test(normalized) && /(?:dispon|tempo|estud|planej|orçamento|orcamento|tenho|terei|vou ter)/.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'plan.today-budget.set', entities: { ...blankEntities, dateExpression: 'hoje', minutes }, confidence: 0.62, missingFields: [], summary: `Definir ${minutes} minutos disponíveis hoje.` })
    const weekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']; const weekday = weekdays.findIndex((day) => normalized.includes(day))
    if (minutes !== null && weekday >= 0 && /(?:dispon|tempo|estud|planej|tenho|terei|vou ter)/.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'plan.weekday-availability.set', entities: { ...blankEntities, weekday, minutes }, confidence: 0.6, missingFields: [], summary: `Definir ${minutes} minutos para ${weekdays[weekday]}.` })
    if (/\b(?:recalcule|recalcular|refaça|refaca|redistribua|reorganize)\b/.test(normalized) && /\b(?:plano|semana|estudos?)\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'plan.recalculate', entities: blankEntities, confidence: 0.58, missingFields: [], summary: 'Recalcular o plano semanal.' })
    if (/\b(?:criar|novo|preparar)\s+(?:um\s+)?workspace\b/.test(normalized)) return organizerIntentSchema.parse({ mode: 'clarification', capability: null, entities: blankEntities, confidence: 0.48, missingFields: ['subject', 'objective'], summary: 'Para criar um Workspace, me diga o tema, seu objetivo e seu nível atual.' })
    if (eventWords.test(normalized)) {
      const dueAt = parseExplicitDate(content, context.currentTime)
      const subject = /(?:prova|exame|trabalho|atividade|prazo)\s+(?:de|da|do)\s+(.+?)(?=\s+(?:no\s+dia|dia|em\s+\d|amanh[ãa]|hoje|na\s+(?:segunda|terça|quarta|quinta|sexta|sábado|domingo))\b|[,.;]|\s+e\s+estou\b|$)/i.exec(content)?.[1]?.trim() ?? null
      if (dueAt && subject) return organizerIntentSchema.parse({ mode: 'mutation', capability: 'academic-life.save', entities: { ...blankEntities, subject, dateExpression: content }, confidence: 0.5, missingFields: [], summary: 'Registrar evento acadêmico.' })
      return organizerIntentSchema.parse({ mode: 'clarification', capability: null, entities: blankEntities, confidence: 0.32, missingFields: dueAt ? ['subject'] : ['dateExpression'], summary: dueAt ? 'Preciso da matéria e do Workspace para registrar esse evento.' : 'Preciso da data para registrar esse evento.' })
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
          { role: 'system', content: 'Interpret intent; never execute/write. Return only strict JSON matching OrganizerIntent: mode query|mutation|clarification|conversation, capability from the supplied catalog or null, semantic entities limited to subject, query, dateExpression, weekday, minutes, completed, target and status, confidence 0..1, missingFields string[], summary string. Never output IDs, ownership, persisted records, PlannerAction payloads, provenance, privacy flags, titles or details. A query mentioning prova, prazo, trabalho or evento is never a create. A cancellation phrase is never a create. Unsupported transitions use clarification or conversation with null capability.' },
          { role: 'user', content: JSON.stringify({ message: content, capabilities: ORGANIZER_CAPABILITY_CATALOG, currentDate: context.currentDate, timezone: context.timezone }) },
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
