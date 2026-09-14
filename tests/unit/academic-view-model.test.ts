import { describe, expect, it } from 'vitest'
import type { AcademicLifeItem, AcademicLifeProjection } from '../../src/shared/contracts/academic-life-contract'
import { academicHumanItems, academicMutationAffectsPlanning, academicViewReducer, authoritativeAcademicItems, calendarDateKey, inferAcademicMutation, monthGrid, refreshAfterAcademicMutation, saveAcademicViewItem, transitionAcademicViewItem } from '../../src/renderer/app/academic-view-model'

const now = new Date(2026, 8, 13, 12).getTime()
const item = (overrides: Partial<AcademicLifeItem> = {}): AcademicLifeItem => ({ id: crypto.randomUUID(), kind: 'fact', status: 'active', title: 'Semestre 2026.2', details: 'Período letivo atual', workspaceId: null, startsAt: null, endsAt: null, expiresAt: null, timezone: 'America/Sao_Paulo', weekday: null, minutes: null, shareWithAi: true, provenance: { source: 'user_ui', reference: null }, replacesId: null, replacedById: null, createdAt: now, updatedAt: now, resolvedAt: null, archivedAt: null, ...overrides })
const draft = (title: string, endsAt: number | null = null, details = '', workspaceId: string | null = null) => ({ title, startsAt: null, endsAt, details, workspaceId, shareWithAi: false, timezone: 'America/Sao_Paulo', now })

describe('Visão Acadêmica view model', () => {
  it('infers an exam from a natural phrase without asking for an internal type', () => {
    const value = inferAcademicMutation(draft('Prova de Cálculo dia 18 às 19h'))
    expect(value).toMatchObject({ kind: 'event', workspaceId: null, shareWithAi: false, weekday: null, minutes: null })
    expect(JSON.parse(value.details)).toMatchObject({ schema: 'academic-event/v1', eventKind: 'exam', subject: 'Cálculo dia 18 às 19h' })
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: value.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value.endsAt!)).toBe('19:00')
  })

  it('infers a dated delivery and preserves its optional Workspace identity', () => {
    const workspaceId = crypto.randomUUID(); const value = inferAcademicMutation(draft('Entrega do trabalho de Java', Date.parse('2026-09-20T21:00:00Z'), 'Enviar PDF', workspaceId))
    expect(value).toMatchObject({ kind: 'commitment', workspaceId })
    expect(JSON.parse(value.details)).toMatchObject({ eventKind: 'assignment', notes: 'Enviar PDF' })
  })

  it('models recurring availability with weekday and weekly minutes', () => {
    expect(inferAcademicMutation(draft('Toda terça tenho 2h livres'))).toMatchObject({ kind: 'availability', weekday: 2, minutes: 120, endsAt: null })
  })

  it('keeps stable semester information as timeless general context', () => {
    expect(inferAcademicMutation(draft('Semestre 2026.2', null, 'Vai até dezembro'))).toMatchObject({ kind: 'fact', workspaceId: null, endsAt: null, expiresAt: null })
  })

  it('uses one authoritative identity for global and Workspace projections', () => {
    const global = item({ title: 'Apresentação final', kind: 'event', endsAt: now + 86_400_000 })
    const linked = item({ title: 'Entrega Java', kind: 'commitment', workspaceId: crypto.randomUUID(), endsAt: now + 172_800_000 })
    const projection = { current: [global, linked, linked], history: [], generatedAt: now }
    expect(authoritativeAcademicItems(projection).map((value) => value.id)).toEqual([global.id, linked.id])
  })

  it('keeps edit versions secondary and exposes only the replacement as current', () => {
    const old = item({ title: 'Prova dia 18', status: 'archived', replacedById: 'new' }); const replacement = item({ id: 'new', title: 'Prova dia 20', kind: 'event', endsAt: now + 86_400_000, replacesId: old.id })
    const projection: AcademicLifeProjection = { current: [replacement], history: [old], generatedAt: now }
    expect(authoritativeAcademicItems(projection)).toEqual([replacement])
  })

  it('preserves inferred semantics when editing an item to a neutral title', () => {
    const original = item({ kind: 'event', title: 'Prova de C', details: JSON.stringify({ schema: 'academic-event/v1', eventKind: 'exam', subject: 'C', sourceText: 'prova' }), endsAt: now + 86_400_000 })
    const edited = inferAcademicMutation({ ...draft('Avaliação final', Date.parse('2026-09-20T22:00:00Z')), replacesId: original.id, existingItem: original })
    expect(edited.kind).toBe('event')
    expect(JSON.parse(edited.details).eventKind).toBe('exam')
  })

  it('places completion in the concluded board lane without duplicating authority', () => {
    const completed = item({ status: 'resolved', resolvedAt: now, title: 'Entrega concluída' })
    const values = academicHumanItems({ current: [], history: [completed], generatedAt: now }, now)
    expect(values).toHaveLength(1); expect(values[0]).toMatchObject({ lane: 'completed', item: { id: completed.id } })
  })

  it('projects calendar, board and chronological list from the same item set', () => {
    const exam = item({ kind: 'event', title: 'Prova', endsAt: now + 86_400_000 }); const context = item(); const projection = { current: [context, exam], history: [], generatedAt: now }
    const values = academicHumanItems(projection, now)
    expect(values.map((value) => value.item.id)).toEqual([exam.id, context.id])
    expect(calendarDateKey(exam.endsAt!, exam.timezone)).toMatch(/^2026-09-1[34]$/)
    expect(monthGrid(new Date(2026, 8, 1))).toHaveLength(42)
  })

  it('keeps private items locally visible while repository context filtering remains authoritative', () => {
    const privateItem = item({ title: 'Compromisso privado', shareWithAi: false })
    expect(academicHumanItems({ current: [privateItem], history: [], generatedAt: now })).toHaveLength(1)
    expect(inferAcademicMutation(draft('Prazo pessoal', Date.parse('2026-09-20T15:00:00Z'))).shareWithAi).toBe(false)
  })

  it('preserves endpoint, interval and timezone during edit', () => {
    const deadline = item({ kind: 'commitment', startsAt: null, endsAt: 20_000, timezone: 'Pacific/Auckland' })
    expect(inferAcademicMutation({ ...draft('Prazo atualizado', 30_000), timezone: deadline.timezone, existingItem: deadline, replacesId: deadline.id })).toMatchObject({ startsAt: null, endsAt: 30_000, timezone: 'Pacific/Auckland' })
    const interval = item({ kind: 'event', startsAt: 20_000, endsAt: 30_000, timezone: 'Europe/Berlin' })
    expect(inferAcademicMutation({ ...draft('Aula especial', 40_000), startsAt: 25_000, timezone: interval.timezone, existingItem: interval })).toMatchObject({ startsAt: 25_000, endsAt: 40_000, timezone: 'Europe/Berlin' })
    expect(() => inferAcademicMutation({ ...draft('Aula especial', 20_000), startsAt: 30_000, existingItem: interval })).toThrow('INVALID_INTERVAL')
  })

  it('uses identical authority identity sets in all views including archived roots', () => {
    const active = item(); const completed = item({ status: 'resolved' }); const archived = item({ status: 'archived' }); const previous = item({ status: 'archived', replacedById: active.id })
    const ids = academicHumanItems({ current: [active], history: [completed, archived, previous], generatedAt: now }, now).map((value) => value.item.id)
    expect([...ids]).toEqual([...ids]); expect(ids).toEqual(expect.arrayContaining([active.id, completed.id, archived.id])); expect(ids).not.toContain(previous.id)
  })

  it('flags only planning-relevant mutations and leaves read projections pure', () => {
    const stable = item(); expect(academicMutationAffectsPlanning(stable, stable)).toBe(false)
    const availability = item({ kind: 'availability', weekday: 2, minutes: 120 }); expect(academicMutationAffectsPlanning(null, availability)).toBe(true); expect(academicMutationAffectsPlanning(availability, { ...availability, minutes: 180 })).toBe(true)
    const deadline = item({ kind: 'commitment', endsAt: now + 1000, workspaceId: crypto.randomUUID() }); expect(academicMutationAffectsPlanning(deadline, { ...deadline, status: 'resolved' })).toBe(true)
    expect(academicHumanItems({ current: [deadline], history: [], generatedAt: now })).toHaveLength(1)
  })

  it('mirrors Planner consumption for linkage and global availability', () => {
    const unlinked = item({ kind: 'event', endsAt: now + 1000, workspaceId: null }); const linked = { ...unlinked, workspaceId: crypto.randomUUID() }
    expect(academicMutationAffectsPlanning(null, unlinked)).toBe(false)
    expect(academicMutationAffectsPlanning(unlinked, linked)).toBe(true)
    expect(academicMutationAffectsPlanning(linked, { ...linked, status: 'resolved' })).toBe(true)
    const globalAvailability = item({ kind: 'availability', weekday: 2, minutes: 120, workspaceId: null }); const scopedAvailability = { ...globalAvailability, workspaceId: crypto.randomUUID() }
    expect(academicMutationAffectsPlanning(null, globalAvailability)).toBe(true)
    expect(academicMutationAffectsPlanning(null, scopedAvailability)).toBe(false)
    expect(academicMutationAffectsPlanning(globalAvailability, { ...globalAvailability, status: 'archived' })).toBe(true)
  })

  it('sequences mutation follow-up as replan before dependent reads and skips stable replan', async () => {
    const calls: string[] = []; let repositoryRevision = 1; const dependencies = { replan: async () => { repositoryRevision += 1; calls.push('replan') }, read: async () => { calls.push('read'); return repositoryRevision } }
    await expect(refreshAfterAcademicMutation(true, dependencies)).resolves.toBe(2); expect(calls).toEqual(['replan', 'read']); expect(repositoryRevision).toBe(2)
    calls.length = 0; await refreshAfterAcademicMutation(false, dependencies); expect(calls).toEqual(['read']); expect(repositoryRevision).toBe(2)
  })

  it('drives view switching and create/edit/complete/cancel callbacks behaviorally', async () => {
    expect(academicViewReducer('calendar', { type: 'select', view: 'board' })).toBe('board'); expect(academicViewReducer('board', { type: 'select', view: 'list' })).toBe('list')
    const calls: string[] = []; const linked = item({ kind: 'event', workspaceId: crypto.randomUUID(), endsAt: now + 1000 })
    const commands = { save: async () => { calls.push('save'); return linked }, transition: async ({ status }: { id: string; status: 'resolved' | 'archived' }) => { calls.push(status); return { ...linked, status, resolvedAt: status === 'resolved' ? now : null, archivedAt: status === 'archived' ? now : null } } }
    await saveAcademicViewItem(commands, inferAcademicMutation(draft('Semestre 2026.2')), null, async (replan) => { calls.push(`refresh:${replan}`) })
    await saveAcademicViewItem(commands, inferAcademicMutation({ ...draft('Prova dia 18 às 19h'), workspaceId: linked.workspaceId }), linked, async (replan) => { calls.push(`refresh:${replan}`) })
    await transitionAcademicViewItem(commands, linked, 'resolved', async (replan) => { calls.push(`refresh:${replan}`) })
    await transitionAcademicViewItem(commands, linked, 'archived', async (replan) => { calls.push(`refresh:${replan}`) })
    expect(calls).toEqual(['save', 'refresh:true', 'save', 'refresh:false', 'resolved', 'refresh:true', 'archived', 'refresh:true'])
  })
})
