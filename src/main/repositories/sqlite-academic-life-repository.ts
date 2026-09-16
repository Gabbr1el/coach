import { createHash } from 'node:crypto'
import type { AcademicLifeRepository } from '../../application/academic-life/academic-life-service'
import type { AcademicLifeDeleteResult, AcademicLifeItem, AcademicLifeMutationInput, AcademicLifeProjection } from '../../shared/contracts/academic-life-contract'
import type { CoachDatabase } from '../database/connection'

type Row = Omit<AcademicLifeItem, 'shareWithAi' | 'provenance'> & { shareWithAi: number; provenanceSource: AcademicLifeItem['provenance']['source']; provenanceReference: string | null }
const columns = 'id,kind,status,title,details,workspace_id AS workspaceId,starts_at AS startsAt,ends_at AS endsAt,expires_at AS expiresAt,timezone,weekday,minutes,share_with_ai AS shareWithAi,provenance_source AS provenanceSource,provenance_reference AS provenanceReference,replaces_id AS replacesId,replaced_by_id AS replacedById,created_at AS createdAt,updated_at AS updatedAt,resolved_at AS resolvedAt,archived_at AS archivedAt'

function fingerprint(input: AcademicLifeMutationInput): string {
  return createHash('sha256').update(JSON.stringify({ kind: input.kind, title: input.title.toLocaleLowerCase('pt-BR'), details: input.details, workspaceId: input.workspaceId, startsAt: input.startsAt, endsAt: input.endsAt, expiresAt: input.expiresAt, timezone: input.timezone, weekday: input.weekday, minutes: input.minutes, shareWithAi: input.shareWithAi, source: input.provenance.source, reference: input.provenance.reference, replacesId: input.replacesId ?? null })).digest('hex')
}

export class SqliteAcademicLifeRepository implements AcademicLifeRepository {
  constructor(private readonly database: CoachDatabase) {}
  private map(row: Row): AcademicLifeItem { const { provenanceSource, provenanceReference, ...item } = row; return { ...item, shareWithAi: Boolean(row.shareWithAi), provenance: { source: provenanceSource, reference: provenanceReference } } }
  find(id: string): AcademicLifeItem | null { const row = this.database.sqlite.prepare(`SELECT ${columns} FROM academic_life_items WHERE id=?`).get(id) as Row | undefined; return row ? this.map(row) : null }
  private isLegitimateCurrentReplay(duplicate: AcademicLifeItem, replacesId: string | null): boolean {
    if (duplicate.status !== 'active' || duplicate.replacedById !== null || duplicate.replacesId !== replacesId) return false
    let child = duplicate
    const visited = new Set([child.id])
    while (child.replacesId !== null) {
      if (visited.has(child.replacesId)) return false
      visited.add(child.replacesId)
      const parent = this.find(child.replacesId)
      if (!parent || parent.status !== 'archived' || parent.replacedById !== child.id) return false
      child = parent
    }
    return true
  }
  save(input: AcademicLifeMutationInput & { id: string }, now: number): AcademicLifeItem {
    return this.database.sqlite.transaction(() => {
      const key = fingerprint(input)
      const duplicate = this.database.sqlite.prepare(`SELECT ${columns} FROM academic_life_items WHERE fingerprint=?`).get(key) as Row | undefined
      const mappedDuplicate = duplicate ? this.map(duplicate) : null
      if (mappedDuplicate) {
        if (!this.isLegitimateCurrentReplay(mappedDuplicate, input.replacesId ?? null)) throw new Error('Academic item lineage is no longer current')
        return mappedDuplicate
      }
      const previousId = input.replacesId ?? input.id
      const previous = input.replacesId ? this.find(input.replacesId) : null
      if (input.replacesId && (!previous || previous.status !== 'active' || previous.replacedById !== null)) throw new Error('Academic item is no longer active')
      this.database.sqlite.prepare('INSERT INTO academic_life_items (id,kind,status,title,details,workspace_id,starts_at,ends_at,expires_at,timezone,weekday,minutes,share_with_ai,provenance_source,provenance_reference,replaces_id,replaced_by_id,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(input.id, input.kind, 'active', input.title, input.details, input.workspaceId, input.startsAt, input.endsAt, input.expiresAt, input.timezone, input.weekday, input.minutes, input.shareWithAi ? 1 : 0, input.provenance.source, input.provenance.reference, input.replacesId ?? null, null, key, now, now)
      if (input.replacesId) this.database.sqlite.prepare("UPDATE academic_life_items SET status='archived',archived_at=?,updated_at=?,replaced_by_id=? WHERE id=? AND status='active'").run(now, now, input.id, previousId)
      return this.find(input.id)!
    })()
  }
  transition(id: string, status: 'resolved' | 'archived', now: number): AcademicLifeItem {
    const timeColumn = status === 'resolved' ? 'resolved_at' : 'archived_at'
    const result = this.database.sqlite.prepare(`UPDATE academic_life_items SET status=?,${timeColumn}=?,updated_at=? WHERE id=? AND status='active'`).run(status, now, now, id)
    if (result.changes !== 1) throw new Error('Academic item is no longer active')
    return this.find(id)!
  }
  deleteLineage(id: string, now: number): AcademicLifeDeleteResult {
    return this.database.sqlite.transaction(() => {
      const target = this.find(id)
      if (!target) throw new Error('Academic item no longer exists')
      const root = this.database.sqlite.prepare(`WITH RECURSIVE ancestors(id,replaces_id) AS (SELECT id,replaces_id FROM academic_life_items WHERE id=? UNION ALL SELECT item.id,item.replaces_id FROM academic_life_items item JOIN ancestors ON item.id=ancestors.replaces_id) SELECT id FROM ancestors WHERE replaces_id IS NULL LIMIT 1`).get(id) as { id: string } | undefined
      const rootId = root?.id ?? id
      const lineage = this.database.sqlite.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM academic_life_items WHERE id=? UNION ALL SELECT item.id FROM academic_life_items item JOIN descendants ON item.replaces_id=descendants.id) SELECT id,kind,status,workspace_id AS workspaceId,starts_at AS startsAt,ends_at AS endsAt FROM academic_life_items WHERE id IN (SELECT id FROM descendants)`).all(rootId) as Array<Pick<AcademicLifeItem, 'id' | 'kind' | 'status' | 'workspaceId' | 'startsAt' | 'endsAt'>>
      const affectedPlanning = lineage.some((item) => item.status === 'active' && ((item.kind === 'availability' && item.workspaceId === null) || ((item.kind === 'event' || item.kind === 'commitment') && item.workspaceId !== null && (item.startsAt !== null || item.endsAt !== null))))
      this.database.sqlite.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM academic_life_items WHERE id=? UNION ALL SELECT item.id FROM academic_life_items item JOIN descendants ON item.replaces_id=descendants.id) UPDATE academic_life_items SET status='archived',archived_at=COALESCE(archived_at,?),updated_at=? WHERE id IN (SELECT id FROM descendants)`).run(rootId, now, now)
      return { id, deletedRootId: rootId, affectedPlanning }
    })()
  }
  projection(now: number, historyLimit: number): AcademicLifeProjection {
    const current = (this.database.sqlite.prepare(`SELECT ${columns} FROM academic_life_items WHERE status='active' AND replaced_by_id IS NULL ORDER BY CASE kind WHEN 'event' THEN 0 WHEN 'commitment' THEN 1 WHEN 'availability' THEN 2 ELSE 3 END,COALESCE(ends_at,expires_at,9223372036854775807),created_at DESC`).all() as Row[]).map((row) => this.map(row))
    const history = (this.database.sqlite.prepare(`SELECT ${columns} FROM academic_life_items WHERE status<>'active' OR replaced_by_id IS NOT NULL ORDER BY CASE status WHEN 'resolved' THEN 0 ELSE 1 END,updated_at DESC LIMIT ?`).all(historyLimit) as Row[]).map((row) => this.map(row))
    return { current, history, generatedAt: now }
  }
  activeForContext(now: number, limit: number, workspaceId?: string): AcademicLifeItem[] {
    const workspaceClause = workspaceId ? 'AND (workspace_id IS NULL OR workspace_id=?)' : ''
    const parameters = workspaceId ? [now, now, workspaceId, limit] : [now, now, limit]
    return (this.database.sqlite.prepare(`SELECT ${columns} FROM academic_life_items WHERE status='active' AND share_with_ai=1 AND replaced_by_id IS NULL AND (expires_at IS NULL OR expires_at>?) AND (ends_at IS NULL OR ends_at>=?) ${workspaceClause} ORDER BY updated_at DESC LIMIT ?`).all(...parameters) as Row[]).map((row) => this.map(row))
  }
}
