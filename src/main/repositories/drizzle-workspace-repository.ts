import { and, desc, eq } from 'drizzle-orm'
import type { CreateWorkspaceRecord, WorkspaceRepository } from '../../application/workspaces/workspace-repository'
import type { Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { CoachDatabase } from '../database/connection'
import { workspaces, type WorkspaceRow } from '../database/schema/workspaces'
import { usableWorkspaceSql } from './usable-workspace'
import { SqliteWorkspaceProvisioningRepository } from './sqlite-workspace-provisioning-repository'

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    objective: row.objective,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastOpenedAt: row.lastOpenedAt,
    archivedAt: row.archivedAt,
  }
}

export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: CoachDatabase) {}

  async listActive(): Promise<WorkspaceSummary[]> {
    const rows = this.database.sqlite.prepare(`SELECT w.id,w.name,w.objective,w.updated_at AS updatedAt,w.last_opened_at AS lastOpenedAt FROM workspaces w WHERE ${usableWorkspaceSql('w')} ORDER BY w.last_opened_at DESC,w.updated_at DESC`).all() as Array<{ id: string; name: string; objective: string; updatedAt: number; lastOpenedAt: number | null }>
    const provisioning = new SqliteWorkspaceProvisioningRepository(this.database)
    return rows.map((row) => ({ ...row, provisioning: provisioning.find(row.id) }))
  }

  async create(input: CreateWorkspaceRecord): Promise<Workspace> {
    const row = this.database.orm
      .insert(workspaces)
      .values({
        id: input.id,
        name: input.name,
        objective: input.objective,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      })
      .returning()
      .get()

    return toWorkspace(row)
  }

  async removeJustCreated(id: string, createdAt: number): Promise<boolean> {
    const result = this.database.sqlite.prepare('DELETE FROM workspaces WHERE id = ? AND created_at = ? AND NOT EXISTS (SELECT 1 FROM workspace_provisioning p WHERE p.workspace_id = workspaces.id)').run(id, createdAt)
    return result.changes === 1
  }

  async findById(id: string): Promise<Workspace | null> {
    const row = this.database.sqlite.prepare("SELECT id,name,objective,status,created_at AS createdAt,updated_at AS updatedAt,last_opened_at AS lastOpenedAt,archived_at AS archivedAt FROM workspaces WHERE id=? AND status='active'").get(id) as Workspace | undefined
    return row ? toWorkspace(row) : null
  }

  async findAnyById(id: string): Promise<Workspace | null> {
    const row = this.database.orm.select().from(workspaces).where(eq(workspaces.id, id)).get()
    return row ? toWorkspace(row) : null
  }

  async markOpened(id: string, openedAt: number): Promise<Workspace | null> {
    const usable = this.database.sqlite.prepare(`SELECT 1 FROM workspaces w WHERE w.id=? AND ${usableWorkspaceSql('w')}`).get(id)
    if (!usable) return null
    const row = this.database.orm.update(workspaces).set({ lastOpenedAt: openedAt, updatedAt: openedAt }).where(and(eq(workspaces.id, id), eq(workspaces.status, 'active'))).returning().get()
    return row ? toWorkspace(row) : null
  }

  async archive(id: string, archivedAt: number): Promise<boolean> {
    return this.database.sqlite.transaction(() => {
      const workspace = this.database.sqlite.prepare(`SELECT w.id,w.name FROM workspaces w WHERE w.id=? AND ${usableWorkspaceSql('w')}`).get(id) as { id: string; name: string } | undefined
      if (!workspace) return false
      this.consolidateAcademicMemory(workspace.id, workspace.name, archivedAt)
      this.database.sqlite.prepare("DELETE FROM weekly_plan_items WHERE workspace_id=? AND status<>'completed'").run(id)
      this.database.sqlite.prepare("DELETE FROM study_plan_items WHERE workspace_id=? AND status<>'completed'").run(id)
      return this.database.sqlite.prepare("UPDATE workspaces SET status='archived',archived_at=?,updated_at=? WHERE id=? AND status='active'").run(archivedAt, archivedAt, id).changes === 1
    })()
  }

  private consolidateAcademicMemory(workspaceId: string, fallbackSubject: string, now: number): void {
    const override = this.database.sqlite.prepare('SELECT subject,declared_level AS declaredLevel,declared_knowledge_json AS knowledge,declared_difficulties_json AS difficulties,goals_json AS goals FROM workspace_learning_overrides WHERE workspace_id=?').get(workspaceId) as { subject: string; declaredLevel: string | null; knowledge: string; difficulties: string; goals: string } | undefined
    const subject = override?.subject || fallbackSubject
    const current = this.database.sqlite.prepare('SELECT declared_level AS declaredLevel,declared_knowledge_json AS knowledge,declared_difficulties_json AS difficulties,goals_json AS goals,source_evidence_json AS evidence,observed_strengths_json AS strengths,observed_difficulties_json AS observedDifficulties,misconceptions_json AS misconceptions,mastered_concepts_json AS mastered,review_concepts_json AS review FROM academic_subject_contexts WHERE subject=?').get(subject) as Record<string, string | null> | undefined
    const parse = (value: string | null | undefined): string[] => { try { const parsed = JSON.parse(value ?? '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [] } catch { return [] } }
    const merge = (...groups: string[][]): string => JSON.stringify([...new Set(groups.flat().map((value) => value.trim()).filter(Boolean))])
    const concepts = this.database.sqlite.prepare(`SELECT c.canonical_name AS name,cm.performance,cm.retention FROM concepts c JOIN concept_memories cm ON cm.workspace_id=c.workspace_id AND cm.concept_id=c.id WHERE c.workspace_id=?`).all(workspaceId) as Array<{ name: string; performance: string; retention: string }>
    const learning = this.database.sqlite.prepare('SELECT topic_id AS topicId,needs_review AS needsReview,mastery_estimate AS mastery FROM topic_learning_states WHERE workspace_id=? AND evidence_count>0').all(workspaceId) as Array<{ topicId: string; needsReview: number; mastery: number | null }>
    const misconceptions = (this.database.sqlite.prepare("SELECT misconception FROM checkpoint_reasoning_evidence WHERE workspace_id=? AND misconception IS NOT NULL AND trim(misconception)<>''").all(workspaceId) as Array<{ misconception: string }>).map((row) => row.misconception)
    const strengths = [...concepts.filter((item) => item.performance === 'secure').map((item) => item.name), ...learning.filter((item) => item.mastery !== null && item.mastery >= 70 && !item.needsReview).map((item) => item.topicId)]
    const difficulties = [...concepts.filter((item) => item.performance === 'struggling').map((item) => item.name), ...learning.filter((item) => item.needsReview).map((item) => item.topicId)]
    const review = concepts.filter((item) => item.retention === 'fragile' || item.performance === 'struggling').map((item) => item.name)
    const evidence = (this.database.sqlite.prepare('SELECT DISTINCT source_ref AS sourceRef FROM learning_attempts WHERE workspace_id=?').all(workspaceId) as Array<{ sourceRef: string }>).map((row) => row.sourceRef)
    this.database.sqlite.prepare(`INSERT INTO academic_subject_contexts (subject,declared_level,declared_knowledge_json,declared_difficulties_json,goals_json,source_evidence_json,observed_strengths_json,observed_difficulties_json,misconceptions_json,mastered_concepts_json,review_concepts_json,last_consolidated_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subject) DO UPDATE SET declared_level=COALESCE(excluded.declared_level,academic_subject_contexts.declared_level),declared_knowledge_json=excluded.declared_knowledge_json,declared_difficulties_json=excluded.declared_difficulties_json,goals_json=excluded.goals_json,source_evidence_json=excluded.source_evidence_json,observed_strengths_json=excluded.observed_strengths_json,observed_difficulties_json=excluded.observed_difficulties_json,misconceptions_json=excluded.misconceptions_json,mastered_concepts_json=excluded.mastered_concepts_json,review_concepts_json=excluded.review_concepts_json,last_consolidated_at=excluded.last_consolidated_at,updated_at=excluded.updated_at`).run(subject, override?.declaredLevel ?? current?.declaredLevel ?? null, merge(parse(current?.knowledge), parse(override?.knowledge)), merge(parse(current?.difficulties), parse(override?.difficulties)), merge(parse(current?.goals), parse(override?.goals)), merge(parse(current?.evidence), evidence), merge(parse(current?.strengths), strengths), merge(parse(current?.observedDifficulties), difficulties), merge(parse(current?.misconceptions), misconceptions), merge(parse(current?.mastered), strengths), merge(parse(current?.review), review), now, now, now)
  }
}
