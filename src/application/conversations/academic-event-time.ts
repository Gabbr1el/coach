const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'] as const
const MONTHS: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 }

export type ResolvedAcademicDate = { readonly dateKey: string; readonly timestamp: number }
export type ExtractedAcademicDate = ResolvedAcademicDate & { readonly expression: string }

function plain(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR') }
function dateKey(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function parts(key: string): [number, number, number] { const [year, month, day] = key.split('-').map(Number); return [year!, month!, day!] }
function shift(key: string, days: number): string { const [year, month, day] = parts(key); const value = new Date(Date.UTC(year, month - 1, day + days)); return dateKey(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())! }
function weekday(key: string): number { const [year, month, day] = parts(key); return new Date(Date.UTC(year, month - 1, day)).getUTCDay() }

function localParts(timestamp: number, timezone: string): Record<string, number> {
  const result: Record<string, number> = {}
  for (const part of new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(timestamp)) if (part.type !== 'literal') result[part.type] = Number(part.value)
  return result
}

function localEndOfDay(key: string, timezone: string): number {
  const [year, month, day] = parts(key)
  let candidate = Date.UTC(year, month - 1, day, 23, 59)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = localParts(candidate, timezone)
    const represented = Date.UTC(local.year!, local.month! - 1, local.day!, local.hour!, local.minute!, local.second!)
    candidate += Date.UTC(year, month - 1, day, 23, 59) - represented
  }
  const local = localParts(candidate, timezone)
  if (local.year !== year || local.month !== month || local.day !== day || local.hour !== 23 || local.minute !== 59) throw new Error('A data não existe no fuso horário informado')
  return candidate
}

function rollYear(month: number, day: number, currentDate: string): string | null {
  const [currentYear] = parts(currentDate)
  const thisYear = dateKey(currentYear, month, day)
  if (thisYear && thisYear >= currentDate) return thisYear
  return dateKey(currentYear + 1, month, day)
}

export function resolveAcademicDate(expression: string, context: { currentDate: string; timezone: string }): ResolvedAcademicDate {
  new Intl.DateTimeFormat('en', { timeZone: context.timezone })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(context.currentDate) || !dateKey(...parts(context.currentDate))) throw new Error('Data atual inválida')
  const value = plain(expression).trim()
  let resolved: string | null = null
  if (/\bdepois de amanha\b/.test(value)) resolved = shift(context.currentDate, 2)
  else if (/\bamanha\b/.test(value)) resolved = shift(context.currentDate, 1)
  else if (/\bhoje\b/.test(value)) resolved = context.currentDate
  else {
    const afterDays = /\bdaqui\s+a\s+(\d+)\s+dias?\b/.exec(value)
    if (afterDays) resolved = shift(context.currentDate, Number(afterDays[1]))
  }
  const numeric = !resolved ? /\b(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\s*[\/.]\s*(\d{4}))?\b/.exec(value) : null
  if (numeric) {
    resolved = numeric[3] ? dateKey(Number(numeric[3]), Number(numeric[2]), Number(numeric[1])) : rollYear(Number(numeric[2]), Number(numeric[1]), context.currentDate)
    if (!resolved) throw new Error('Data impossível')
  }
  const named = !resolved ? /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/.exec(value) : null
  if (named) {
    resolved = named[3] ? dateKey(Number(named[3]), MONTHS[named[2]!]!, Number(named[1])) : rollYear(MONTHS[named[2]!]!, Number(named[1]), context.currentDate)
    if (!resolved) throw new Error('Data impossível')
  }
  const numberedDay = !resolved ? /\bdia\s+(\d{1,2})\b/.exec(value) : null
  if (numberedDay) {
    const [year, month, currentDay] = parts(context.currentDate); const day = Number(numberedDay[1])
    resolved = dateKey(year, month, day)
    if (resolved && day < currentDay) { const next = new Date(Date.UTC(year, month, 1)); resolved = dateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, day) }
  }
  if (!resolved) {
    const weekdayMatch = WEEKDAYS.map((name, index) => ({ index, match: new RegExp(`\\b(?:proxima\\s+)?${name}(?:-feira)?\\b`).exec(value) })).find((entry) => entry.match)
    if (weekdayMatch) {
      const forceNext = weekdayMatch.match![0].startsWith('proxima')
      let delta = (weekdayMatch.index - weekday(context.currentDate) + 7) % 7
      if (forceNext || delta === 0) delta += 7
      resolved = shift(context.currentDate, delta)
    }
  }
  if (!resolved) throw new Error('Data ausente, ambígua ou impossível')
  return { dateKey: resolved, timestamp: localEndOfDay(resolved, context.timezone) }
}

const DATE_EXPRESSION = /\b(?:depois\s+de\s+amanha|amanha|hoje|daqui\s+a\s+\d+\s+dias?|\d{1,2}\s*[\/.]\s*\d{1,2}(?:\s*[\/.]\s*\d{4})?|\d{1,2}\s+de\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+\d{4})?|dia\s+\d{1,2}|(?:proxima\s+)?(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?)\b/g

export function extractAcademicDate(text: string, context: { currentDate: string; timezone: string }): ExtractedAcademicDate {
  const matches = [...plain(text).matchAll(DATE_EXPRESSION)].map((match) => match[0])
  if (matches.length !== 1) throw new Error(matches.length ? 'Data ambígua' : 'Data ausente')
  return { ...resolveAcademicDate(matches[0]!, context), expression: matches[0]! }
}

export function extractAcademicDateChange(text: string, context: { currentDate: string; timezone: string }): { readonly from: ExtractedAcademicDate; readonly to: ExtractedAcademicDate } {
  const marker = /\b(?:mudou|remarcad[ao]|adiad[ao]|passou)\b/i.exec(text)
  if (!marker) throw new Error('Alteração de data ausente')
  const tail = text.slice(marker.index + marker[0].length)
  const separator = /\bpara\b/i.exec(tail)
  if (!separator) throw new Error('Datas anterior e nova são obrigatórias')
  const before = tail.slice(0, separator.index)
  const after = tail.slice(separator.index + separator[0].length)
  try { return { from: extractAcademicDate(before, context), to: extractAcademicDate(after, context) } } catch { throw new Error('Datas anterior e nova são obrigatórias e devem ser inequívocas') }
}
