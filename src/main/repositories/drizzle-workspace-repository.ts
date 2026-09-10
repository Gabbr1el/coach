import { and, desc, eq } from 'drizzle-orm'
import type { CreateWorkspaceRecord, WorkspaceRepository } from '../../application/workspaces/workspace-repository'
import type { Workspace, WorkspaceSummary } from '../../shared/contracts/workspace-contract'
import type { CoachDatabase } from '../database/connection'
import { workspaces, type WorkspaceRow } from '../database/schema/workspaces'

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
    const rows = this.database.orm.select({ id: workspaces.id, name: workspaces.name, objective: workspaces.objective, updatedAt: workspaces.updatedAt, lastOpenedAt: workspaces.lastOpenedAt }).from(workspaces).where(eq(workspaces.status, 'active')).orderBy(desc(workspaces.lastOpenedAt), desc(workspaces.updatedAt)).all()
    return rows.filter((row) => { const state = this.database.sqlite.prepare('SELECT status FROM workspace_provisioning WHERE workspace_id = ?').get(row.id) as { status: string } | undefined; return state?.status !== 'draft' }).map((row) => { const state = this.database.sqlite.prepare('SELECT workspace_id AS workspaceId,status,stage,material_ids_json AS materialIdsJson,attempt_count AS attemptCount,created_at AS createdAt,started_at AS startedAt,stage_updated_at AS stageUpdatedAt,completed_at AS completedAt,retry_after AS retryAfter,error_code AS errorCode,error_message AS errorMessage FROM workspace_provisioning WHERE workspace_id = ?').get(row.id) as any; return { ...row, provisioning: state ? { ...state, materialIds: JSON.parse(state.materialIdsJson) } : null } })
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

  async findById(id: string): Promise<Workspace | null> {
    const row = this.database.orm.select().from(workspaces).where(eq(workspaces.id, id)).get()
    return row ? toWorkspace(row) : null
  }

  async markOpened(id: string, openedAt: number): Promise<Workspace | null> {
    const row = this.database.orm
      .update(workspaces)
      .set({ lastOpenedAt: openedAt, updatedAt: openedAt })
      .where(and(eq(workspaces.id, id), eq(workspaces.status, 'active')))
      .returning()
      .get()

    return row ? toWorkspace(row) : null
  }

  async archive(id: string, archivedAt: number): Promise<boolean> {
    const row = this.database.orm
      .update(workspaces)
      .set({ status: 'archived', archivedAt, updatedAt: archivedAt })
      .where(and(eq(workspaces.id, id), eq(workspaces.status, 'active')))
      .returning({ id: workspaces.id })
      .get()

    return Boolean(row)
  }
}
