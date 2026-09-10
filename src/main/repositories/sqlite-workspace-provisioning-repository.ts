import type { WorkspaceProvisioningRepository } from '../../application/workspaces/workspace-provisioning-service'
import type { WorkspaceProvisioningState } from '../../shared/contracts/workspace-contract'
import type { CoachDatabase } from '../database/connection'

type Row = Omit<WorkspaceProvisioningState, 'materialIds'> & { materialIdsJson: string }
const select = 'SELECT workspace_id AS workspaceId,status,stage,material_ids_json AS materialIdsJson,attempt_count AS attemptCount,created_at AS createdAt,started_at AS startedAt,stage_updated_at AS stageUpdatedAt,completed_at AS completedAt,retry_after AS retryAfter,error_code AS errorCode,error_message AS errorMessage FROM workspace_provisioning'
function map(row: Row): WorkspaceProvisioningState { return { ...row, materialIds: JSON.parse(row.materialIdsJson) as string[] } }

export class SqliteWorkspaceProvisioningRepository implements WorkspaceProvisioningRepository {
  constructor(private readonly database: CoachDatabase) {}
  find(workspaceId: string): WorkspaceProvisioningState | null { const row = this.database.sqlite.prepare(`${select} WHERE workspace_id = ?`).get(workspaceId) as Row | undefined; return row ? map(row) : null }
  save(state: WorkspaceProvisioningState): WorkspaceProvisioningState { this.database.sqlite.prepare('INSERT INTO workspace_provisioning (workspace_id,status,stage,material_ids_json,attempt_count,created_at,started_at,stage_updated_at,completed_at,retry_after,error_code,error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET status=excluded.status,stage=excluded.stage,material_ids_json=excluded.material_ids_json,attempt_count=excluded.attempt_count,started_at=excluded.started_at,stage_updated_at=excluded.stage_updated_at,completed_at=excluded.completed_at,retry_after=excluded.retry_after,error_code=excluded.error_code,error_message=excluded.error_message').run(state.workspaceId, state.status, state.stage, JSON.stringify(state.materialIds), state.attemptCount, state.createdAt, state.startedAt, state.stageUpdatedAt, state.completedAt, state.retryAfter, state.errorCode, state.errorMessage); return this.find(state.workspaceId)! }
  listResumable(now: number): string[] { return (this.database.sqlite.prepare("SELECT workspace_id AS workspaceId FROM workspace_provisioning WHERE status IN ('queued','running','failed_retryable','waiting_for_provider') AND (retry_after IS NULL OR retry_after <= ?)").all(now) as Array<{ workspaceId: string }>).map((row) => row.workspaceId) }
  removeDraft(workspaceId: string): boolean { return this.database.sqlite.transaction(() => { const state = this.find(workspaceId); if (!state || state.status !== 'draft') return false; return this.database.sqlite.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId).changes === 1 })() }
}
