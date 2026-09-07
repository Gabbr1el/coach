import { describe, expect, it } from 'vitest'
import { parseExplicitDate } from '../../src/application/planning/planning-service'

const now = new Date(2026, 8, 7, 12).getTime()
describe('parseExplicitDate', () => {
  it.each([
    ['hoje', 8, 7], ['amanhã', 8, 8], ['terça', 8, 8], ['dia 16', 8, 16], ['dia 16 deste mês', 8, 16], ['dia 16 desse mês', 8, 16], ['dia 16 do próximo mês', 9, 16], ['16/09', 8, 16], ['16/09/2026', 8, 16],
  ])('resolves %s from application time', (text, month, day) => { const parsed = new Date(parseExplicitDate(text, now)!); expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, month, day]) })
})
