import type { AcademicLifeItem, AcademicLifeMutationInput, AcademicLifeProjection } from '../../shared/contracts/academic-life-contract'
import { resolveAcademicDate } from '../../application/conversations/academic-event-time'

export type AcademicView = 'calendar' | 'board' | 'list'
export type AcademicViewAction = { readonly type: 'select'; readonly view: AcademicView }
export type AcademicBoardLane = 'upcoming' | 'preparing' | 'completed'
export type AcademicHumanKind = 'exam' | 'assignment' | 'class' | 'presentation' | 'deadline' | 'availability' | 'commitment' | 'context'

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

export interface AcademicHumanItem {
  readonly item: AcademicLifeItem
  readonly humanKind: AcademicHumanKind
  readonly label: string
  readonly details: string
  readonly timestamp: number | null
  readonly lane: AcademicBoardLane
}

export interface SimpleAcademicDraft {
  readonly title: string
  readonly startsAt: number | null
  readonly endsAt: number | null
  readonly details: string
  readonly workspaceId: string | null
  readonly shareWithAi: boolean
  readonly timezone: string
  readonly now?: number
  readonly replacesId?: string
  readonly existingItem?: AcademicLifeItem
}

function normalized(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR') }
function includesAny(value: string, terms: string[]): boolean { return terms.some((term) => value.includes(term)) }

export function academicHumanKind(item: Pick<AcademicLifeItem, 'kind' | 'title' | 'details'>): AcademicHumanKind {
  if (item.kind === 'availability') return 'availability'
  try {
    const metadata = JSON.parse(item.details) as { schema?: string; eventKind?: string }
    if (metadata.schema === 'academic-event/v1') {
      if (metadata.eventKind === 'exam') return 'exam'
      if (metadata.eventKind === 'assignment') return 'assignment'
      if (metadata.eventKind === 'deadline') return 'deadline'
    }
  } catch {}
  const text = normalized(`${item.title} ${item.details}`)
  if (includesAny(text, ['prova', 'exame', 'avaliacao', 'simulado'])) return 'exam'
  if (includesAny(text, ['trabalho', 'atividade', 'entrega', 'lista de exercicio'])) return 'assignment'
  if (includesAny(text, ['apresentacao', 'seminario', 'defesa'])) return 'presentation'
  if (includesAny(text, ['aula', 'monitoria', 'laboratorio'])) return 'class'
  if (includesAny(text, ['prazo', 'deadline', 'ate dia'])) return 'deadline'
  return item.kind === 'fact' ? 'context' : 'commitment'
}

export function academicHumanLabel(kind: AcademicHumanKind): string {
  return ({ exam: 'Avaliação', assignment: 'Entrega', class: 'Aula importante', presentation: 'Apresentação', deadline: 'Prazo', availability: 'Tempo disponível', commitment: 'Compromisso', context: 'Contexto acadêmico' } as const)[kind]
}

export function visibleAcademicDetails(item: Pick<AcademicLifeItem, 'details'>): string {
  try {
    const metadata = JSON.parse(item.details) as { schema?: string; sourceText?: string; notes?: string }
    if (metadata.schema === 'academic-event/v1') return metadata.notes?.trim() || metadata.sourceText?.trim() || ''
  } catch {}
  return item.details
}

export function authoritativeAcademicItems(projection: AcademicLifeProjection | null): AcademicLifeItem[] {
  if (!projection) return []
  const current = new Map(projection.current.map((item) => [item.id, item]))
  for (const item of projection.history) if (item.replacedById === null && !current.has(item.id)) current.set(item.id, item)
  return [...current.values()]
}

export function academicHumanItems(projection: AcademicLifeProjection | null, now = Date.now()): AcademicHumanItem[] {
  return authoritativeAcademicItems(projection).map((item) => {
    const timestamp = item.startsAt ?? item.endsAt ?? item.expiresAt
    const lane: AcademicBoardLane = item.status !== 'active' ? 'completed' : timestamp !== null && timestamp <= now + 14 * 86_400_000 ? 'preparing' : 'upcoming'
    const humanKind = academicHumanKind(item)
    return { item, humanKind, label: academicHumanLabel(humanKind), details: visibleAcademicDetails(item), timestamp, lane }
  }).sort((a, b) => (a.item.status === 'resolved' ? 1 : 0) - (b.item.status === 'resolved' ? 1 : 0) || (a.timestamp ?? Number.MAX_SAFE_INTEGER) - (b.timestamp ?? Number.MAX_SAFE_INTEGER) || b.item.updatedAt - a.item.updatedAt)
}

export function academicMutationAffectsPlanning(before: AcademicLifeItem | null, after: Pick<AcademicLifeItem, 'kind' | 'status' | 'workspaceId' | 'startsAt' | 'endsAt' | 'weekday' | 'minutes'>): boolean {
  const consumed = (value: typeof after | null) => Boolean(value && value.status === 'active' && ((value.kind === 'availability' && value.workspaceId === null) || ((value.kind === 'event' || value.kind === 'commitment') && value.workspaceId !== null && (value.startsAt !== null || value.endsAt !== null))))
  const wasConsumed = consumed(before); const isConsumed = consumed(after)
  if (!wasConsumed && !isConsumed) return false
  if (wasConsumed !== isConsumed) return true
  return before!.kind !== after.kind || before!.workspaceId !== after.workspaceId || before!.startsAt !== after.startsAt || before!.endsAt !== after.endsAt || before!.weekday !== after.weekday || before!.minutes !== after.minutes
}

export async function refreshAfterAcademicMutation<T>(affectsPlanning: boolean, dependencies: { replan(): Promise<unknown>; read(): Promise<T> }): Promise<T> {
  if (affectsPlanning) await dependencies.replan()
  return dependencies.read()
}

export function academicViewReducer(_view: AcademicView, action: AcademicViewAction): AcademicView { return action.view }

export interface AcademicViewCommands {
  save(input: AcademicLifeMutationInput): Promise<AcademicLifeItem>
  transition(input: { id: string; status: 'resolved' | 'archived' }): Promise<AcademicLifeItem>
}

export async function saveAcademicViewItem(commands: AcademicViewCommands, input: AcademicLifeMutationInput, previous: AcademicLifeItem | null, refresh: (affectsPlanning: boolean) => void | Promise<void>): Promise<AcademicLifeItem> {
  const saved = await commands.save(input)
  await refresh(academicMutationAffectsPlanning(previous, saved))
  return saved
}

export async function transitionAcademicViewItem(commands: AcademicViewCommands, item: AcademicLifeItem, status: 'resolved' | 'archived', refresh: (affectsPlanning: boolean) => void | Promise<void>): Promise<AcademicLifeItem> {
  const saved = await commands.transition({ id: item.id, status })
  await refresh(academicMutationAffectsPlanning(item, saved))
  return saved
}

function weekdayFrom(text: string): number | null {
  const value = normalized(text)
  const index = WEEKDAYS.findIndex((day) => value.includes(normalized(day)))
  return index >= 0 ? index : null
}

function minutesFrom(text: string): number | null {
  const value = normalized(text)
  const hours = value.match(/\b(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\b/)
  const minutes = value.match(/\b(\d+)\s*min(?:utos?)?\b/)
  if (!hours && !minutes) return null
  return Math.min(1440, Math.round(Number(hours?.[1]?.replace(',', '.') ?? 0) * 60 + Number(minutes?.[1] ?? 0)))
}

export function inferAcademicMutation(draft: SimpleAcademicDraft): AcademicLifeMutationInput {
  const title = draft.title.trim()
  const text = normalized(`${title} ${draft.details}`)
  const referenceNow = draft.now ?? Date.now()
  const currentDate = calendarDateKey(referenceNow, draft.timezone)
  let phraseTimestamp: number | null = null
  try { phraseTimestamp = resolveAcademicDate(title, { currentDate, timezone: draft.timezone }).timestamp } catch {}
  const startsAt = draft.startsAt ?? draft.existingItem?.startsAt ?? null
  const endsAt = draft.endsAt ?? phraseTimestamp ?? draft.existingItem?.endsAt ?? null
  const weekday = weekdayFrom(text)
  const minutes = minutesFrom(text)
  const recurring = includesAny(text, ['toda ', 'todo ', 'semanal', 'por semana', 'disponivel', 'livre']) && weekday !== null && minutes !== null
  let kind: AcademicLifeMutationInput['kind'] = draft.existingItem?.kind ?? 'fact'
  let eventKind: 'exam' | 'assignment' | 'deadline' | null = null
  if (recurring) kind = 'availability'
  else if (includesAny(text, ['prova', 'exame', 'avaliacao', 'simulado'])) { kind = 'event'; eventKind = 'exam' }
  else if (includesAny(text, ['trabalho', 'atividade', 'entrega', 'lista de exercicio'])) { kind = 'commitment'; eventKind = 'assignment' }
  else if (includesAny(text, ['prazo', 'deadline'])) { kind = 'commitment'; eventKind = 'deadline' }
  else if (startsAt !== null || endsAt !== null) kind = 'event'
  if ((kind === 'event' || kind === 'commitment') && endsAt === null) throw new Error('DATE_REQUIRED')
  if (startsAt !== null && endsAt !== null && endsAt < startsAt) throw new Error('INVALID_INTERVAL')
  const priorEventKind = draft.existingItem ? academicHumanKind(draft.existingItem) : null
  if (!eventKind && (priorEventKind === 'exam' || priorEventKind === 'assignment' || priorEventKind === 'deadline')) eventKind = priorEventKind
  const details = eventKind ? JSON.stringify({ schema: 'academic-event/v1', eventKind, subject: title.replace(/^\s*(?:prova|exame|avaliação|trabalho|atividade|entrega|prazo)(?:\s+de)?\s*/i, '').trim() || title, sourceText: title, ...(draft.details.trim() ? { notes: draft.details.trim() } : {}) }) : draft.details.trim()
  return {
    kind,
    title,
    details,
    workspaceId: draft.workspaceId,
    startsAt: kind === 'event' || kind === 'commitment' ? startsAt : null,
    endsAt: kind === 'event' || kind === 'commitment' ? endsAt : null,
    expiresAt: null,
    timezone: draft.timezone,
    weekday: kind === 'availability' ? weekday ?? draft.existingItem?.weekday ?? null : null,
    minutes: kind === 'availability' ? minutes ?? draft.existingItem?.minutes ?? null : null,
    shareWithAi: draft.shareWithAi,
    provenance: { source: 'user_ui', reference: null },
    ...(draft.replacesId ? { replacesId: draft.replacesId } : {}),
  }
}

export function calendarDateKey(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12)
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay(), 12)
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12))
}
