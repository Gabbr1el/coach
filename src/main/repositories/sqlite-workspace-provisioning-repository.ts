import type { WorkspaceProvisioningRepository } from '../../application/workspaces/workspace-provisioning-service'
import type { WorkspaceProvisioningState } from '../../shared/contracts/workspace-contract'
import type { CoachDatabase } from '../database/connection'

type Row = Omit<WorkspaceProvisioningState, 'materialIds' | 'readinessState' | 'backgroundPending' | 'progress' | 'legacyState' | 'eta'> & { materialIdsJson: string; readinessState: 'provisioning' | 'usable' | 'fully_provisioned' | null; backgroundPending: number; completedJobs: number; totalJobs: number; legacyState: 'legacy_accessible' | null }
const select = `SELECT p.workspace_id AS workspaceId,p.status,p.stage,p.material_ids_json AS materialIdsJson,p.attempt_count AS attemptCount,p.created_at AS createdAt,p.started_at AS startedAt,p.stage_updated_at AS stageUpdatedAt,p.completed_at AS completedAt,p.retry_after AS retryAfter,p.error_code AS errorCode,p.error_message AS errorMessage,r.state AS readinessState,r.legacy_state AS legacyState,COALESCE((SELECT COUNT(*) FROM content_jobs j WHERE j.workspace_id=p.workspace_id AND j.revision=r.revision AND j.status IN ('pending','queued','generating')),0) AS backgroundPending,CASE WHEN EXISTS (SELECT 1 FROM roadmaps accepted WHERE accepted.workspace_id=p.workspace_id AND accepted.status='accepted' AND accepted.content_revision=r.revision) THEN COALESCE((SELECT COUNT(*) FROM content_jobs j WHERE j.workspace_id=p.workspace_id AND j.revision=r.revision AND j.priority>=850 AND j.status='ready'),0) ELSE 0 END AS completedJobs,CASE WHEN EXISTS (SELECT 1 FROM roadmaps accepted WHERE accepted.workspace_id=p.workspace_id AND accepted.status='accepted' AND accepted.content_revision=r.revision) THEN COALESCE((SELECT COUNT(*) FROM content_jobs j WHERE j.workspace_id=p.workspace_id AND j.revision=r.revision AND j.priority>=850 AND j.status<>'obsolete'),0) ELSE 0 END AS totalJobs FROM workspace_provisioning p LEFT JOIN workspace_content_revisions r ON r.workspace_id=p.workspace_id`
function percentile(values: number[], ratio: number): number { return values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * ratio)))]! }

export class SqliteWorkspaceProvisioningRepository implements WorkspaceProvisioningRepository {
  constructor(private readonly database: CoachDatabase) {}
  find(workspaceId: string): WorkspaceProvisioningState | null {
    const row = this.database.sqlite.prepare(`${select} WHERE p.workspace_id = ?`).get(workspaceId) as Row | undefined
    if (!row) return null
    const { materialIdsJson, readinessState, ...rest } = row
    const materialIds = JSON.parse(materialIdsJson) as string[]
    const samples = (this.database.sqlite.prepare("SELECT elapsed_ms AS elapsedMs FROM performance_timeline_events WHERE operation_type='provisioning' AND stage='persistence' AND json_extract(metadata_json,'$.outcome')='usable' AND wall_time>=? AND COALESCE(json_extract(metadata_json,'$.materialClass'),'none')=? ORDER BY wall_time DESC LIMIT 21").all(Date.now() - 30 * 86_400_000, materialIds.length ? 'with_materials' : 'none') as Array<{ elapsedMs: number }>).map((item) => item.elapsedMs).filter((value) => value > 0).sort((a, b) => a - b)
    const elapsed = row.startedAt === null ? 0 : Math.max(0, Date.now() - row.startedAt)
    const minutes = (value: number) => Math.max(1, Math.ceil(Math.max(0, value - elapsed) / 60_000))
    const eta = samples.length < 3 ? { label: 'Calculando estimativa', medianMinutes: null, lowMinutes: null, highMinutes: null, sampleSize: samples.length } : { label: `${minutes(percentile(samples, .5))} min (faixa ${minutes(percentile(samples, .25))}-${minutes(percentile(samples, .75))} min)`, medianMinutes: minutes(percentile(samples, .5)), lowMinutes: minutes(percentile(samples, .25)), highMinutes: minutes(percentile(samples, .75)), sampleSize: samples.length }
    const total = row.totalJobs || null
    const background = readinessState === 'usable' && row.backgroundPending > 0
    const label = total === null ? 'Calculando etapas' : background ? `Workspace utilizável · ${row.backgroundPending} conteúdo(s) adicional(is) em preparação` : `${row.completedJobs} de ${total} concluído${total === 1 ? '' : 's'}`
    return { ...rest, materialIds, readinessState: readinessState?.toUpperCase() as WorkspaceProvisioningState['readinessState'] ?? 'PROVISIONING', progress: { completed: row.completedJobs, total, label, indeterminate: total === null, background }, eta }
  }
  save(state: WorkspaceProvisioningState): WorkspaceProvisioningState { this.database.sqlite.prepare('INSERT INTO workspace_provisioning (workspace_id,status,stage,material_ids_json,attempt_count,created_at,started_at,stage_updated_at,completed_at,retry_after,error_code,error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET status=excluded.status,stage=excluded.stage,material_ids_json=excluded.material_ids_json,attempt_count=excluded.attempt_count,started_at=excluded.started_at,stage_updated_at=excluded.stage_updated_at,completed_at=excluded.completed_at,retry_after=excluded.retry_after,error_code=excluded.error_code,error_message=excluded.error_message').run(state.workspaceId, state.status, state.stage, JSON.stringify(state.materialIds), state.attemptCount, state.createdAt, state.startedAt, state.stageUpdatedAt, state.completedAt, state.retryAfter, state.errorCode, state.errorMessage); return this.find(state.workspaceId)! }
  listResumable(now: number): string[] { return (this.database.sqlite.prepare("SELECT workspace_id AS workspaceId FROM workspace_provisioning WHERE status IN ('queued','running','failed_retryable','waiting_for_provider') AND (retry_after IS NULL OR retry_after <= ?)").all(now) as Array<{ workspaceId: string }>).map((row) => row.workspaceId) }
  removeDraft(workspaceId: string): boolean { return this.database.sqlite.transaction(() => { const state = this.find(workspaceId); if (!state || state.status !== 'draft') return false; const durable = this.database.sqlite.prepare(`SELECT 1 WHERE
      EXISTS (SELECT 1 FROM study_sessions WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM roadmaps WHERE workspace_id=? AND status='accepted') OR
      EXISTS (SELECT 1 FROM study_progress WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM study_progress_events WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM learning_attempts WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM checkpoint_reasoning_evidence WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM concept_memories WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM workspace_memories WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM saved_for_later WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM workspace_projects WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM conversation_threads WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM weekly_plan_items WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM study_plan_items WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM study_deadlines WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM academic_events WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM academic_life_items WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM study_lessons WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM exercise_sets WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM exercise_attempts WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM exercise_progress WHERE workspace_id=?) OR
      EXISTS (SELECT 1 FROM review_sessions WHERE workspace_id=?)`).get(...Array(21).fill(workspaceId)); if (durable) return false; return this.database.sqlite.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId).changes === 1 })() }
}
