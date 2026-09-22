import { and, desc, eq } from 'drizzle-orm'
import type { CreateWorkspaceRecord, WorkspaceRepository } from '../../application/workspaces/workspace-repository'
import type { PriorSubjectMemory, Workspace, WorkspaceContinuationRecommendation, WorkspaceHistoryDetail, WorkspaceRepairConflictDetail, WorkspaceRepairConflictSummary, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { CoachDatabase } from '../database/connection'
import { workspaces, type WorkspaceRow } from '../database/schema/workspaces'
import { usableWorkspaceSql } from './usable-workspace'
import { SqliteWorkspaceProvisioningRepository } from './sqlite-workspace-provisioning-repository'
import { workspaceEquivalenceKey } from '../../application/workspaces/workspace-equivalence'

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
    completedAt: row.completedAt,
    equivalenceKey: row.equivalenceKey,
    meaningfulDistinction: row.meaningfulDistinction,
    predecessorId: row.predecessorId,
    confirmedAt: row.confirmedAt,
  }
}

export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: CoachDatabase) {}

  async listActive(): Promise<WorkspaceSummary[]> {
    const rows = this.database.sqlite.prepare(`SELECT w.id,w.name,w.objective,w.status,w.updated_at AS updatedAt,w.last_opened_at AS lastOpenedAt,w.completed_at AS completedAt,w.archived_at AS archivedAt FROM workspaces w WHERE ${usableWorkspaceSql('w')} ORDER BY w.last_opened_at DESC,w.updated_at DESC`).all() as WorkspaceSummary[]
    const provisioning = new SqliteWorkspaceProvisioningRepository(this.database)
    return rows.map((row) => ({ ...row, provisioning: provisioning.find(row.id) }))
  }

  async listHistory(): Promise<WorkspaceSummary[]> {
    const rows = this.database.sqlite.prepare("SELECT id,name,objective,status,updated_at AS updatedAt,last_opened_at AS lastOpenedAt,completed_at AS completedAt,archived_at AS archivedAt FROM workspaces WHERE status IN ('completed','archived') ORDER BY COALESCE(archived_at,completed_at,updated_at) DESC").all() as WorkspaceSummary[]
    return Promise.all(rows.map(async (row) => ({ ...row, repairConflict: this.getRepairConflict(row.id), continuationRecommendation: row.status === 'completed' ? await this.getContinuationRecommendation(row.id, Date.now()) : null })))
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
        equivalenceKey: input.equivalenceKey ?? workspaceEquivalenceKey(input.name),
        meaningfulDistinction: input.meaningfulDistinction,
        predecessorId: input.predecessorId ?? null,
        confirmedAt: input.confirmedAt === undefined ? input.createdAt : input.confirmedAt,
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
    const row = this.database.sqlite.prepare("SELECT id,name,objective,status,created_at AS createdAt,updated_at AS updatedAt,last_opened_at AS lastOpenedAt,archived_at AS archivedAt,completed_at AS completedAt,confirmed_at AS confirmedAt,equivalence_key AS equivalenceKey,meaningful_distinction AS meaningfulDistinction,predecessor_id AS predecessorId FROM workspaces WHERE id=? AND status='active'").get(id) as Workspace | undefined
    return row ? toWorkspace(row as WorkspaceRow) : null
  }

  async findAnyById(id: string): Promise<Workspace | null> {
    const row = this.database.orm.select().from(workspaces).where(eq(workspaces.id, id)).get()
    return row ? toWorkspace(row) : null
  }

  async markOpened(id: string, openedAt: number): Promise<Workspace | null> {
    const terminal = this.database.sqlite.prepare("SELECT id,name,objective,status,created_at AS createdAt,updated_at AS updatedAt,last_opened_at AS lastOpenedAt,archived_at AS archivedAt,completed_at AS completedAt,confirmed_at AS confirmedAt,equivalence_key AS equivalenceKey,meaningful_distinction AS meaningfulDistinction,predecessor_id AS predecessorId FROM workspaces WHERE id=? AND status IN ('completed','archived')").get(id) as Workspace | undefined
    if (terminal) return toWorkspace(terminal as WorkspaceRow)
    const usable = this.database.sqlite.prepare(`SELECT 1 FROM workspaces w WHERE w.id=? AND ${usableWorkspaceSql('w')}`).get(id)
    if (!usable) return null
    const row = this.database.orm.update(workspaces).set({ lastOpenedAt: openedAt, updatedAt: openedAt }).where(and(eq(workspaces.id, id), eq(workspaces.status, 'active'))).returning().get()
    return row ? toWorkspace(row) : null
  }

  async archive(id: string, archivedAt: number): Promise<boolean> {
    return this.database.sqlite.transaction(() => {
      const workspace = this.database.sqlite.prepare(`SELECT w.id,w.name FROM workspaces w WHERE w.id=? AND (w.status='completed' OR ${usableWorkspaceSql('w')})`).get(id) as { id: string; name: string } | undefined
      if (!workspace) return false
      this.consolidateAcademicMemory(workspace.id, workspace.name, archivedAt)
      this.markTerminalMemoryConsolidated(id, archivedAt)
      this.database.sqlite.prepare("DELETE FROM weekly_plan_items WHERE workspace_id=? AND status<>'completed'").run(id)
      this.database.sqlite.prepare("DELETE FROM study_plan_items WHERE workspace_id=? AND status<>'completed'").run(id)
      return this.database.sqlite.prepare("UPDATE workspaces SET status='archived',archived_at=?,updated_at=? WHERE id=? AND status IN ('active','completed')").run(archivedAt, archivedAt, id).changes === 1
    })()
  }

  async complete(id: string, completedAt: number): Promise<boolean> {
    return this.database.sqlite.transaction(() => {
      const workspace = this.database.sqlite.prepare("SELECT id,name,status FROM workspaces WHERE id=?").get(id) as { id: string; name: string; status: Workspace['status'] } | undefined
      if (!workspace) return false
      if (workspace.status === 'completed') {
        this.consolidateAcademicMemory(id, workspace.name, completedAt)
        this.markTerminalMemoryConsolidated(id, completedAt)
        this.database.sqlite.prepare("DELETE FROM weekly_plan_items WHERE workspace_id=? AND status<>'completed'").run(id)
        this.database.sqlite.prepare("DELETE FROM study_plan_items WHERE workspace_id=? AND status<>'completed'").run(id)
        return true
      }
      if (workspace.status !== 'active') return false
      this.consolidateAcademicMemory(id, workspace.name, completedAt)
      this.markTerminalMemoryConsolidated(id, completedAt)
      this.database.sqlite.prepare("DELETE FROM weekly_plan_items WHERE workspace_id=? AND status<>'completed'").run(id)
      this.database.sqlite.prepare("DELETE FROM study_plan_items WHERE workspace_id=? AND status<>'completed'").run(id)
      return this.database.sqlite.prepare("UPDATE workspaces SET status='completed',completed_at=?,updated_at=? WHERE id=? AND status='active'").run(completedAt, completedAt, id).changes === 1
    })()
  }

  async confirm(id: string, confirmedAt: number, afterConfirm?: () => void): Promise<Workspace | null> {
    return this.database.sqlite.transaction(() => {
      const row = this.database.orm.update(workspaces).set({ confirmedAt, updatedAt: confirmedAt }).where(and(eq(workspaces.id, id), eq(workspaces.status, 'active'))).returning().get()
      if (!row) return null
      afterConfirm?.()
      return toWorkspace(row)
    })()
  }

  reconcileTerminalAcademicMemory(now = Date.now()): void {
    const tables = new Set((this.database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('workspace_terminal_memory','workspace_learning_overrides','academic_subject_contexts')").all() as Array<{ name: string }>).map((row) => row.name))
    const columns = new Set((this.database.sqlite.pragma('table_info(workspaces)') as Array<{ name: string }>).map((row) => row.name))
    if (tables.size !== 3 || !columns.has('completed_at')) return
    this.database.sqlite.transaction(() => {
      const rows = this.database.sqlite.prepare("SELECT w.id,w.name,COALESCE(w.completed_at,w.archived_at,w.updated_at) AS terminalAt FROM workspaces w LEFT JOIN workspace_terminal_memory m ON m.workspace_id=w.id WHERE w.status IN ('completed','archived') AND m.workspace_id IS NULL ORDER BY w.id").all() as Array<{ id: string; name: string; terminalAt: number }>
      for (const row of rows) {
        const reconciledAt = Math.max(row.terminalAt, now)
        this.consolidateAcademicMemory(row.id, row.name, reconciledAt)
        this.markTerminalMemoryConsolidated(row.id, reconciledAt)
      }
    })()
  }

  private markTerminalMemoryConsolidated(workspaceId: string, consolidatedAt: number): void {
    this.database.sqlite.prepare('INSERT INTO workspace_terminal_memory (workspace_id,consolidated_at) VALUES (?,?) ON CONFLICT(workspace_id) DO UPDATE SET consolidated_at=MAX(workspace_terminal_memory.consolidated_at,excluded.consolidated_at)').run(workspaceId, consolidatedAt)
  }

  async getHistoryDetail(id: string): Promise<WorkspaceHistoryDetail | null> {
    const workspace = await this.findAnyById(id)
    if (!workspace || workspace.status === 'active') return null
    const roadmapRow = this.database.sqlite.prepare("SELECT id,title FROM roadmaps WHERE workspace_id=? AND status='accepted' ORDER BY updated_at DESC LIMIT 1").get(id) as { id: string; title: string } | undefined
    const modules = roadmapRow ? (this.database.sqlite.prepare('SELECT title,status,topics_json AS topics FROM roadmap_modules WHERE roadmap_id=? ORDER BY position').all(roadmapRow.id) as Array<{ title: string; status: string; topics: string }>).map((row) => ({ ...row, topics: JSON.parse(row.topics) as string[] })) : []
    const materials = this.database.sqlite.prepare('SELECT id,name,status,page_count AS pageCount FROM materials WHERE workspace_id=? ORDER BY created_at').all(id) as WorkspaceHistoryDetail['materials']
    const progress = this.database.sqlite.prepare("SELECT (SELECT count(DISTINCT topic_id) FROM study_progress_events WHERE workspace_id=? AND type='TOPIC_COMPLETED') AS completedTopics,(SELECT COALESCE(sum(json_array_length(m.topics_json)),0) FROM roadmap_modules m JOIN roadmaps r ON r.id=m.roadmap_id WHERE r.workspace_id=? AND r.status='accepted') AS totalTopics,(SELECT count(*) FROM study_progress_events WHERE workspace_id=?) AS evidenceEvents").get(id, id, id) as WorkspaceHistoryDetail['progress']
    const performance = this.database.sqlite.prepare("SELECT (SELECT count(*) FROM learning_attempts WHERE workspace_id=?) AS attempts,(SELECT count(*) FROM learning_attempts WHERE workspace_id=? AND correct=1) AS successfulAttempts,COALESCE((SELECT sum(focus_seconds) FROM study_sessions WHERE workspace_id=?),0) AS focusSeconds").get(id, id, id) as WorkspaceHistoryDetail['performance']
    const sessions = this.database.sqlite.prepare('SELECT started_at AS startedAt,ended_at AS endedAt,focus_seconds AS focusSeconds,status FROM study_sessions WHERE workspace_id=? ORDER BY started_at DESC LIMIT 100').all(id) as WorkspaceHistoryDetail['sessions']
    return { workspace, repairConflict: this.getRepairConflict(id, true), roadmap: roadmapRow ? { title: roadmapRow.title, modules } : null, materials, progress, performance, sessions }
  }

  private getRepairConflict(workspaceId: string, detail: true): WorkspaceRepairConflictDetail | null
  private getRepairConflict(workspaceId: string, detail?: false): WorkspaceRepairConflictSummary | null
  private getRepairConflict(workspaceId: string, detail = false): WorkspaceRepairConflictSummary | WorkspaceRepairConflictDetail | null {
    const workspace = this.database.sqlite.prepare('SELECT equivalence_key AS equivalenceKey FROM workspaces WHERE id=?').get(workspaceId) as { equivalenceKey: string } | undefined
    if (!workspace) return null
    const conflict = this.database.sqlite.prepare('SELECT canonical_workspace_id AS canonicalWorkspaceId,evidence_workspace_ids_json AS evidenceIds,reason FROM workspace_repair_conflicts WHERE equivalence_key=?').get(workspace.equivalenceKey) as { canonicalWorkspaceId: string; evidenceIds: string; reason: WorkspaceRepairConflictSummary['reason'] } | undefined
    if (!conflict) return null
    const evidenceIds = this.parseIds(conflict.evidenceIds)
    if (!evidenceIds.includes(workspaceId)) return null
    const related = this.database.sqlite.prepare('SELECT id,name,status FROM workspaces WHERE equivalence_key=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,created_at,id').all(workspace.equivalenceKey, conflict.canonicalWorkspaceId) as Array<Pick<Workspace, 'id' | 'name' | 'status'>>
    const canonicalWorkspace = related.find((item) => item.id === conflict.canonicalWorkspaceId)
    if (!canonicalWorkspace) return null
    const summary: WorkspaceRepairConflictSummary = { reason: conflict.reason, relation: 'preserved_duplicate_of_canonical', canonicalWorkspace }
    return detail ? { ...summary, evidenceWorkspaceIds: evidenceIds, relatedWorkspaces: related } : summary
  }

  private parseIds(value: string): string[] {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [] } catch { return [] }
  }

  async getContinuationRecommendation(predecessorId: string, now: number): Promise<WorkspaceContinuationRecommendation | null> {
    this.database.sqlite.prepare("UPDATE workspace_continuation_decisions SET status='pending',successor_id=NULL,resolved_at=NULL WHERE predecessor_id=? AND status='accepted' AND (successor_id IS NULL OR NOT EXISTS (SELECT 1 FROM workspaces successor WHERE successor.id=workspace_continuation_decisions.successor_id AND successor.status='active' AND successor.confirmed_at IS NOT NULL))").run(predecessorId)
    const resolved = this.database.sqlite.prepare('SELECT status FROM workspace_continuation_decisions WHERE predecessor_id=?').get(predecessorId) as { status: string } | undefined
    if (resolved && resolved.status !== 'pending') return null
    const workspace = this.database.sqlite.prepare("SELECT id,name,objective,equivalence_key AS equivalenceKey FROM workspaces WHERE id=? AND status='completed'").get(predecessorId) as { id: string; name: string; objective: string; equivalenceKey: string } | undefined
    if (!workspace) return null
    const parse = (value: string | null | undefined): string[] => { try { const parsed = JSON.parse(value ?? '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [] } catch { return [] } }
    const override = this.database.sqlite.prepare('SELECT goals_json AS goals,curricular_scope_json AS scope FROM workspace_learning_overrides WHERE workspace_id=?').get(predecessorId) as { goals: string; scope: string } | undefined
    const outcomeRows = this.database.sqlite.prepare("SELECT DISTINCT COALESCE(c.canonical_name,e.topic_id) AS value FROM study_progress_events e LEFT JOIN topic_concepts tc ON tc.workspace_id=e.workspace_id AND tc.topic_id=e.topic_id LEFT JOIN concepts c ON c.workspace_id=tc.workspace_id AND c.id=tc.concept_id WHERE e.workspace_id=? AND e.type='TOPIC_COMPLETED' ORDER BY e.created_at DESC LIMIT 8").all(predecessorId) as Array<{ value: string }>
    const prerequisiteRows = this.database.sqlite.prepare("SELECT subject FROM workspace_academic_contexts WHERE workspace_id=? AND relation IN ('prerequisite','implementation_language') ORDER BY subject LIMIT 5").all(predecessorId) as Array<{ subject: string }>
    const memory = (this.database.sqlite.prepare('SELECT summary FROM workspace_memories WHERE workspace_id=?').get(predecessorId) as { summary: string } | undefined)?.summary?.slice(0, 800) ?? null
    const goals = parse(override?.goals).slice(0, 5)
    const outcomes = outcomeRows.map((row) => row.value).slice(0, 8)
    const prerequisites = prerequisiteRows.map((row) => row.subject)
    const focus = outcomes[0] ?? goals.find((goal) => goal !== workspace.objective) ?? workspace.objective ?? workspace.name
    const suggestedName = `${workspace.name}: ${focus}`.slice(0, 80)
    const equivalenceKey = workspaceEquivalenceKey(suggestedName)
    const context: PriorSubjectMemory[] = [{ subject: workspace.name, outcomes, goals, prerequisites, memory }]
    const existing = this.database.sqlite.prepare("SELECT id,status FROM workspaces WHERE id<>? AND status='active' AND confirmed_at IS NOT NULL AND (equivalence_key=? OR lower(trim(name))=lower(trim(?))) ORDER BY updated_at DESC LIMIT 1").get(predecessorId, equivalenceKey, suggestedName) as { id: string; status: Workspace['status'] } | undefined
    const objective = `Aprofundar ${focus} a partir dos resultados de ${workspace.name}`.slice(0, 500)
    const rationale = outcomes.length ? `A continuação parte de ${outcomes.slice(0, 3).join(', ')} e preserva o histórico concluído.` : goals.length ? `A continuação parte do objetivo ${goals[0]} e preserva o histórico concluído.` : `A continuação aprofunda o tema sem reabrir o ciclo concluído.`
    this.database.sqlite.prepare("INSERT OR IGNORE INTO workspace_continuation_decisions (id,predecessor_id,suggested_name,objective,rationale,equivalence_key,context_json,status,successor_id,created_at,resolved_at) VALUES (?,?,?,?,?,?,?,'pending',NULL,?,NULL)").run(crypto.randomUUID(), predecessorId, suggestedName, objective, rationale, equivalenceKey, JSON.stringify(context), now)
    const row = this.database.sqlite.prepare("SELECT id,predecessor_id AS predecessorId,suggested_name AS suggestedName,objective,rationale FROM workspace_continuation_decisions WHERE predecessor_id=? AND status='pending'").get(predecessorId) as Omit<WorkspaceContinuationRecommendation, 'action' | 'existingWorkspaceId' | 'context'> | undefined
    return row ? { ...row, action: existing ? 'open_existing' : 'create', existingWorkspaceId: existing?.id ?? null, context } : null
  }

  async resolveContinuation(predecessorId: string, decision: 'accepted' | 'declined', successorId: string | null, now: number): Promise<boolean> {
    return this.database.sqlite.prepare("UPDATE workspace_continuation_decisions SET status=?,successor_id=?,resolved_at=? WHERE predecessor_id=? AND status='pending'").run(decision, successorId, now, predecessorId).changes === 1
  }

  async findAcceptedContinuation(predecessorId: string): Promise<Workspace | null> {
    const row = this.database.sqlite.prepare("SELECT d.successor_id AS id FROM workspace_continuation_decisions d JOIN workspaces w ON w.id=d.successor_id WHERE d.predecessor_id=? AND d.status='accepted' AND w.status='active' AND w.confirmed_at IS NOT NULL").get(predecessorId) as { id: string } | undefined
    return row ? this.findAnyById(row.id) : null
  }

  async createContinuation(predecessorId: string, input: CreateWorkspaceRecord, now: number, afterCreate?: (workspace: Workspace) => void): Promise<Workspace> {
    return this.database.sqlite.transaction(() => {
      const accepted = this.database.sqlite.prepare("SELECT successor_id AS id FROM workspace_continuation_decisions WHERE predecessor_id=? AND status='accepted' AND successor_id IS NOT NULL").get(predecessorId) as { id: string } | undefined
      if (accepted) return toWorkspace(this.database.orm.select().from(workspaces).where(eq(workspaces.id, accepted.id)).get()!)
      const predecessor = this.database.sqlite.prepare('SELECT * FROM workspace_learning_overrides WHERE workspace_id=?').get(predecessorId) as Record<string, unknown> | undefined
      const row = this.database.orm.insert(workspaces).values({ id: input.id, name: input.name, objective: input.objective, createdAt: input.createdAt, updatedAt: input.updatedAt, confirmedAt: input.confirmedAt ?? now, equivalenceKey: input.equivalenceKey ?? workspaceEquivalenceKey(input.name), meaningfulDistinction: input.meaningfulDistinction, predecessorId }).returning().get()
      if (predecessor) this.database.sqlite.prepare(`INSERT INTO workspace_learning_overrides (workspace_id,subject,canonical_focus,canonical_context,declared_level,declared_knowledge_json,declared_difficulties_json,goals_json,curricular_scope_json,onboarding_analysis_revision,onboarding_analysis_fingerprint,created_at,updated_at) SELECT ?,subject,canonical_focus,canonical_context,declared_level,declared_knowledge_json,declared_difficulties_json,goals_json,curricular_scope_json,onboarding_analysis_revision,onboarding_analysis_fingerprint,?,? FROM workspace_learning_overrides WHERE workspace_id=?`).run(input.id, now, now, predecessorId)
      this.database.sqlite.prepare("INSERT OR IGNORE INTO workspace_academic_contexts (workspace_id,subject,relation) SELECT ?,subject,relation FROM workspace_academic_contexts WHERE workspace_id=?").run(input.id, predecessorId)
      const memory = (this.database.sqlite.prepare('SELECT summary FROM workspace_memories WHERE workspace_id=?').get(predecessorId) as { summary: string } | undefined)?.summary
      if (memory) this.database.sqlite.prepare('INSERT INTO workspace_memories (id,workspace_id,summary,updated_at) VALUES (?,?,?,?)').run(crypto.randomUUID(), input.id, `Contexto do predecessor ${predecessorId}: ${memory}`.slice(0, 1200), now)
      const successor = toWorkspace(row)
      afterCreate?.(successor)
      const resolved = this.database.sqlite.prepare("UPDATE workspace_continuation_decisions SET status='accepted',successor_id=?,resolved_at=? WHERE predecessor_id=? AND status='pending'").run(input.id, now, predecessorId)
      if (resolved.changes !== 1) throw new Error('Continuation recommendation is no longer pending')
      return successor
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
