import { describe, expect, it } from 'vitest'
import { AcademicLifeService } from '../../src/application/academic-life/academic-life-service'
import { SqliteAcademicLifeRepository } from '../../src/main/repositories/sqlite-academic-life-repository'
import { openCoachDatabase } from '../../src/main/database/connection'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const input = (overrides: Record<string, unknown> = {}) => ({ kind: 'fact' as const, title: 'Aulas noturnas', details: 'Rotina acadêmica', workspaceId: null, startsAt: null, endsAt: null, expiresAt: null, timezone: 'America/Sao_Paulo', weekday: null, minutes: null, shareWithAi: true, provenance: { source: 'user_ui' as const, reference: null }, ...overrides })

describe('AcademicLifeService', () => {
  it('keeps expiry and temporal replacement out of current while retaining history', () => {
    let now = 1000; const rows: any[] = []
    const repository: any = { save: (value: any) => { const prior = value.replacesId && rows.find((row) => row.id === value.replacesId); if (prior) { prior.status = 'archived'; prior.replacedById = value.id } const row = { ...value, status: 'active', replacesId: value.replacesId ?? null, replacedById: null, createdAt: now, updatedAt: now, resolvedAt: null, archivedAt: null }; rows.push(row); return row }, transition: () => { throw new Error() }, projection: (at: number) => ({ current: rows.filter((row) => row.status === 'active' && !row.replacedById && (!row.expiresAt || row.expiresAt > at)), history: rows.filter((row) => row.status !== 'active' || row.replacedById || (row.expiresAt && row.expiresAt <= at)), generatedAt: at }), activeForContext: (at: number, limit: number) => rows.filter((row) => row.status === 'active' && row.shareWithAi && !row.replacedById && (!row.expiresAt || row.expiresAt > at)).slice(0, limit) }
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
})
