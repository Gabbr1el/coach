import { describe, expect, it } from 'vitest'
import { AcademicLifeService } from '../../src/application/academic-life/academic-life-service'
import { SqliteAcademicLifeRepository } from '../../src/main/repositories/sqlite-academic-life-repository'
import { DrizzlePlanningRepository } from '../../src/main/repositories/drizzle-planning-repository'
import { openCoachDatabase } from '../../src/main/database/connection'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const input = (overrides: Record<string, unknown> = {}) => ({ kind: 'fact' as const, title: 'Aulas noturnas', details: 'Rotina acadêmica', workspaceId: null, startsAt: null, endsAt: null, expiresAt: null, timezone: 'America/Sao_Paulo', weekday: null, minutes: null, shareWithAi: true, provenance: { source: 'user_ui' as const, reference: null }, ...overrides })

describe('AcademicLifeService', () => {
  it('keeps expiry and temporal replacement out of current while retaining history', () => {
    let now = 1000; const rows: any[] = []
    const repository: any = { find: (id: string) => rows.find((row) => row.id === id) ?? null, save: (value: any) => { const prior = value.replacesId && rows.find((row) => row.id === value.replacesId); if (prior) { prior.status = 'archived'; prior.replacedById = value.id } const row = { ...value, status: 'active', replacesId: value.replacesId ?? null, replacedById: null, createdAt: now, updatedAt: now, resolvedAt: null, archivedAt: null }; rows.push(row); return row }, transition: () => { throw new Error() }, projection: (at: number) => ({ current: rows.filter((row) => row.status === 'active' && !row.replacedById && (!row.expiresAt || row.expiresAt > at)), history: rows.filter((row) => row.status !== 'active' || row.replacedById || (row.expiresAt && row.expiresAt <= at)), generatedAt: at }), activeForContext: (at: number, limit: number) => rows.filter((row) => row.status === 'active' && row.shareWithAi && !row.replacedById && (!row.expiresAt || row.expiresAt > at)).slice(0, limit) }
    let n = 0; const service = new AcademicLifeService(repository, () => now, () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`)
    const old = service.save(input({ expiresAt: 2000 })); const replacement = service.save(input({ title: 'Aulas pela manhã', replacesId: old.id }))
    expect(service.getProjection().current.map((row) => row.id)).toEqual([replacement.id])
    expect(service.getProjection().history[0]).toMatchObject({ id: old.id, replacedById: replacement.id })
    now = 3000; expect(service.activeForContext()).toEqual([replacement])
  })

  it('persists, avoids duplicates, separates privacy and survives restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'academic-life-')); const path = join(directory, 'coach.sqlite'); const migrationsFolder = resolve('drizzle/migrations')
    try {
      let database = openCoachDatabase({ databasePath: path, migrationsFolder }); let service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 1000)
      const saved = service.save(input()); expect(service.save(input()).id).toBe(saved.id)
      service.save(input({ title: 'Segredo pessoal', shareWithAi: false }))
      expect(service.getProjection().current).toHaveLength(2); expect(service.activeForContext().map((item) => item.title)).toEqual(['Aulas noturnas'])
      database.close(); database = openCoachDatabase({ databasePath: path, migrationsFolder }); service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 1000)
      expect(service.getProjection().current.map((item) => item.title).sort()).toEqual(['Aulas noturnas', 'Segredo pessoal'])
      database.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('keeps elapsed calendar items in the local projection but excludes them from AI context', () => {
    const directory = mkdtempSync(join(tmpdir(), 'academic-elapsed-')); const path = join(directory, 'coach.sqlite'); const migrationsFolder = resolve('drizzle/migrations')
    try {
      const database = openCoachDatabase({ databasePath: path, migrationsFolder }); const service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 10_000)
      const elapsed = service.save(input({ kind: 'event', title: 'Aula importante', endsAt: 9_000, shareWithAi: true }))
      expect(service.getProjection().current).toEqual([expect.objectContaining({ id: elapsed.id })])
      expect(service.activeForContext()).toEqual([])
      database.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('persists a workspace-independent event, replacement and cancellation across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'academic-events-')); const path = join(directory, 'coach.sqlite'); const migrationsFolder = resolve('drizzle/migrations')
    try {
      let now = 1000; let database = openCoachDatabase({ databasePath: path, migrationsFolder }); let service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => now)
      const details = JSON.stringify({ schema: 'academic-event/v1', eventKind: 'exam', subject: 'C', sourceText: 'prova de C' }); const created = service.save(input({ kind: 'event', title: 'Prova C', details, workspaceId: null, endsAt: 21_000, expiresAt: 21_000, shareWithAi: false, provenance: { source: 'conversation', reference: null } })); expect(created.workspaceId).toBeNull(); expect(JSON.parse(created.details).eventKind).toBe('exam')
      now = 2000; const updated = service.save(input({ kind: 'event', title: 'Prova C', details, workspaceId: null, endsAt: 24_000, expiresAt: 24_000, shareWithAi: false, provenance: { source: 'conversation', reference: null }, replacesId: created.id })); expect(updated.replacesId).toBe(created.id)
      service.transition(updated.id, 'archived'); database.close(); database = openCoachDatabase({ databasePath: path, migrationsFolder }); service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => now)
      expect(service.getProjection().current).toHaveLength(0); expect(service.getProjection().history).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, replacedById: updated.id }), expect.objectContaining({ id: updated.id, status: 'archived' })])); database.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('can unlink back to null as a new active replacement', () => {
    const directory = mkdtempSync(join(tmpdir(), 'academic-event-unlink-')); const path = join(directory, 'coach.sqlite'); const migrationsFolder = resolve('drizzle/migrations')
    try {
      const database = openCoachDatabase({ databasePath: path, migrationsFolder }); database.sqlite.prepare('INSERT INTO workspaces (id,name,objective,created_at,updated_at) VALUES (?,?,?,?,?)').run('00000000-0000-4000-8000-000000000099', 'Java', '', 1, 1); let n = 0; const service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 1000 + n, () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`)
      const base = input({ kind: 'event', title: 'Prova POO', details: JSON.stringify({ schema: 'academic-event/v1', eventKind: 'exam', subject: 'POO', sourceText: 'prova' }), endsAt: 20_000, expiresAt: 20_000, shareWithAi: false, provenance: { source: 'conversation', reference: null } }); const original = service.save(base); const linked = service.save({ ...base, workspaceId: '00000000-0000-4000-8000-000000000099', replacesId: original.id }); const unlinked = service.save({ ...base, workspaceId: null, replacesId: linked.id }); expect(unlinked).toMatchObject({ status: 'active', workspaceId: null, replacesId: linked.id }); expect(unlinked.id).not.toBe(original.id); database.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('requires explicit confirmation to permanently hide a completed item', () => {
    const directory = mkdtempSync(join(tmpdir(), 'academic-delete-confirm-')); const path = join(directory, 'coach.sqlite'); const migrationsFolder = resolve('drizzle/migrations')
    try {
      const database = openCoachDatabase({ databasePath: path, migrationsFolder }); const service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 2000)
      const completed = service.transition(service.save(input()).id, 'resolved')
      expect(() => service.delete(completed.id, false)).toThrow(/explicit confirmation/i)
      expect(service.getProjection().history).toContainEqual(expect.objectContaining({ id: completed.id, status: 'resolved' }))
      expect(service.delete(completed.id, true)).toMatchObject({ id: completed.id, deletedRootId: completed.id, affectedPlanning: false })
      expect(service.getProjection()).toMatchObject({ current: [], history: [expect.objectContaining({ id: completed.id, status: 'archived' })] })
      database.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('tombstones the replacement root and descendants without resurrection after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'academic-delete-lineage-')); const path = join(directory, 'coach.sqlite'); const migrationsFolder = resolve('drizzle/migrations')
    try {
      let database = openCoachDatabase({ databasePath: path, migrationsFolder }); let service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 3000)
      const original = service.save(input({ title: 'Prova antiga', kind: 'event', endsAt: 5000, workspaceId: null })); const replacement = service.save(input({ title: 'Prova atual', kind: 'event', endsAt: 6000, workspaceId: null, replacesId: original.id }))
      expect(service.delete(replacement.id, false)).toMatchObject({ deletedRootId: original.id, affectedPlanning: false })
      expect(service.getProjection().current).toEqual([])
      database.close(); database = openCoachDatabase({ databasePath: path, migrationsFolder }); service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 4000)
      expect(service.getProjection().current).toEqual([])
      expect(service.getProjection().history).toEqual(expect.arrayContaining([expect.objectContaining({ id: original.id, status: 'archived' }), expect.objectContaining({ id: replacement.id, status: 'archived' })]))
      expect(() => service.save(input({ title: 'Outra versão', kind: 'event', endsAt: 7000, workspaceId: null, replacesId: original.id }))).toThrow(/no longer active/i)
      database.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('rejects exact replacement and root duplicate replays after permanent deletion and restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'academic-delete-replay-')); const path = join(directory, 'coach.sqlite'); const migrationsFolder = resolve('drizzle/migrations')
    try {
      let database = openCoachDatabase({ databasePath: path, migrationsFolder }); database.sqlite.prepare('INSERT INTO workspaces (id,name,objective,created_at,updated_at) VALUES (?,?,?,?,?)').run('00000000-0000-4000-8000-000000000099', 'Java', '', 1, 1); let service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 3000)
      const rootPayload = input({ title: 'Prova Java', kind: 'event', endsAt: 9000, workspaceId: '00000000-0000-4000-8000-000000000099' }); const original = service.save(rootPayload)
      const replacementPayload = input({ title: 'Prova Java atualizada', kind: 'event', endsAt: 10_000, workspaceId: original.workspaceId, replacesId: original.id }); const replacement = service.save(replacementPayload)
      expect(service.save(replacementPayload).id).toBe(replacement.id)
      service.delete(replacement.id, false); database.close()
      database = openCoachDatabase({ databasePath: path, migrationsFolder }); service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 4000)
      expect(() => service.save(replacementPayload)).toThrow(/lineage is no longer current/i)
      expect(() => service.save(rootPayload)).toThrow(/lineage is no longer current/i)
      expect(service.getProjection().current).toEqual([])
      expect(service.activeForContext()).toEqual([])
      expect(new DrizzlePlanningRepository(database).listPriorityInputs()).toEqual([])
      database.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('reports replanning only when the deleted item was consumed by planning', () => {
    const directory = mkdtempSync(join(tmpdir(), 'academic-delete-planning-')); const path = join(directory, 'coach.sqlite'); const migrationsFolder = resolve('drizzle/migrations')
    try {
      const database = openCoachDatabase({ databasePath: path, migrationsFolder }); database.sqlite.prepare('INSERT INTO workspaces (id,name,objective,created_at,updated_at) VALUES (?,?,?,?,?)').run('00000000-0000-4000-8000-000000000099', 'Java', '', 1, 1); const service = new AcademicLifeService(new SqliteAcademicLifeRepository(database), () => 3000)
      const context = service.save(input({ title: 'Contexto local' })); expect(service.delete(context.id, false).affectedPlanning).toBe(false)
      const linked = service.save(input({ title: 'Prova Java', kind: 'event', endsAt: 9000, workspaceId: '00000000-0000-4000-8000-000000000099' })); expect(service.delete(linked.id, false).affectedPlanning).toBe(true)
      const availability = service.save(input({ title: 'Segunda livre', kind: 'availability', weekday: 1, minutes: 120 })); expect(service.delete(availability.id, false).affectedPlanning).toBe(true)
      database.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('validates keep-unlinked only for current active unreplaced null-workspace events', () => { const item = (overrides: Record<string, unknown> = {}) => ({ id: 'event', kind: 'event', status: 'active', workspaceId: null, replacedById: null, ...overrides }); let current: any = item(); const service = new AcademicLifeService({ find: () => current } as any); expect(service.requireActiveUnlinkedEvent('event')).toBe(current); for (const invalid of [item({ status: 'archived' }), item({ replacedById: 'next' }), item({ workspaceId: 'workspace' })]) { current = invalid; expect(() => service.requireActiveUnlinkedEvent('event')).toThrow('no longer active and unlinked') } })
})
