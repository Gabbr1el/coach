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
  it('extracts authoritative create and update expressions from the original text', () => { expect(extractAcademicDate('prova de C dia 14', context).dateKey).toBe('2026-09-14'); expect(extractAcademicDateChange('a prova de C mudou de dia 14 para dia 21', context)).toMatchObject({ from: { dateKey: '2026-09-14' }, to: { dateKey: '2026-09-21' } }) })
  it('rejects update text without both sides of the change', () => expect(() => extractAcademicDateChange('a prova foi remarcada para dia 21', context)).toThrow(/anterior e nova/i))
})
