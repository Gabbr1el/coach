import { describe, expect, it } from 'vitest'
import { extractAcademicDate, extractAcademicDateChange, resolveAcademicDate } from '../../src/application/conversations/academic-event-time'

const context = { currentDate: '2026-09-12', timezone: 'America/Sao_Paulo' }

describe('academic event temporal resolver', () => {
  it.each([
    ['hoje', '2026-09-12'],
    ['amanhã', '2026-09-13'],
    ['depois de amanhã', '2026-09-14'],
    ['segunda', '2026-09-14'],
    ['próxima segunda', '2026-09-21'],
    ['dia 14', '2026-09-14'],
    ['14/09', '2026-09-14'],
    ['14 de setembro', '2026-09-14'],
    ['daqui a 3 dias', '2026-09-15'],
  ])('resolves %s from an injected date and IANA timezone', (expression, expected) => expect(resolveAcademicDate(expression, context).dateKey).toBe(expected))

  it('rolls dates without a year forward and rejects impossible or absent dates', () => {
    expect(resolveAcademicDate('prova 10/09', context).dateKey).toBe('2027-09-10')
    expect(() => resolveAcademicDate('31/02', context)).toThrow(/impossível/i)
    expect(() => resolveAcademicDate('algum dia', context)).toThrow(/ambígua/i)
  })

  it('uses the injected timezone rather than the process timezone', () => {
    const result = resolveAcademicDate('amanhã', { currentDate: '2026-09-12', timezone: 'Pacific/Kiritimati' })
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati', year: 'numeric', month: '2-digit', day: '2-digit' }).format(result.timestamp)).toBe('2026-09-13')
  })
  it('honors explicit times, relative days, end of day and DST in an IANA zone', () => {
    const ny = { currentDate: '2026-03-07', timezone: 'America/New_York' }
    const localTime = (timestamp: number) => new Intl.DateTimeFormat('en-GB', { timeZone: ny.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(timestamp)
    expect(localTime(resolveAcademicDate('dia 18 às 19h', ny).timestamp)).toBe('19:00')
    expect(resolveAcademicDate('hoje às 08:15h', ny).timestamp).toBe(Date.parse('2026-03-07T13:15:00Z'))
    expect(resolveAcademicDate('amanhã às 08:15h', ny).timestamp).toBe(Date.parse('2026-03-08T12:15:00Z'))
    expect(resolveAcademicDate('18/03/2026', ny).timestamp).toBe(Date.parse('2026-03-19T03:59:00Z'))
  })
  it.each([
    ['hoje às 17h', '2026-09-12T20:00:00.000Z'],
    ['hoje as 17h', '2026-09-12T20:00:00.000Z'],
    ['hoje 17:00', '2026-09-12T20:00:00.000Z'],
    ['hoje as 5 da tarde', '2026-09-12T20:00:00.000Z'],
    ['hoje 5 da tarde', '2026-09-12T20:00:00.000Z'],
    ['amanhã 8 da manhã', '2026-09-13T11:00:00.000Z'],
    ['hoje meio-dia', '2026-09-12T15:00:00.000Z'],
    ['amanhã meia-noite', '2026-09-13T03:00:00.000Z'],
  ])('resolves date and natural time together in America/Bahia: %s', (expression, expected) => {
    const bahia = { currentDate: '2026-09-12', timezone: 'America/Bahia' }
    expect(new Date(extractAcademicDate(`prova de C ${expression}`, bahia).timestamp).toISOString()).toBe(expected)
  })
  it('extracts authoritative create and update expressions from the original text', () => { expect(extractAcademicDate('prova de C dia 14', context).dateKey).toBe('2026-09-14'); expect(extractAcademicDateChange('a prova de C mudou de dia 14 para dia 21', context)).toMatchObject({ from: { dateKey: '2026-09-14' }, to: { dateKey: '2026-09-21' } }) })
  it('rejects update text without both sides of the change', () => expect(() => extractAcademicDateChange('a prova foi remarcada para dia 21', context)).toThrow(/anterior e nova/i))
})
