import { performance } from 'node:perf_hooks'
import type { CoachDatabase } from '../database/connection'

export type ChatTimelineStage = 'message_received' | 'context_started' | 'context_ready' | 'provider_request_started' | 'provider_first_token' | 'provider_completed' | 'persistence_completed' | 'renderer_first_token'
export type ProvisioningTimelineStage = 'analyze' | 'context' | 'material_extraction' | 'material_analysis' | 'roadmap' | 'lesson' | 'exercises' | 'planning' | 'persistence'
export type PerformanceTimelineStage = ChatTimelineStage | ProvisioningTimelineStage

const SAFE_METADATA_KEYS = new Set(['intent', 'contextResources', 'historyCount', 'snippetCount', 'cache', 'jobKind', 'outcome', 'ttftMs', 'totalMs'])

function safeMetadata(input: Record<string, unknown>): Record<string, string | number | boolean | null | string[]> {
  const result: Record<string, string | number | boolean | null | string[]> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue
    if (typeof value === 'string') result[key] = value.slice(0, 100)
    else if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.max(0, Math.round(value))
    else if (typeof value === 'boolean' || value === null) result[key] = value
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) result[key] = value.slice(0, 8).map((item) => item.slice(0, 40))
  }
  return result
}

export class PerformanceTimeline {
  private readonly startedMonotonic = performance.now()
  private readonly startedWall = Date.now()

  constructor(private readonly database: CoachDatabase, readonly operationId: string, private readonly operationType: 'chat' | 'provisioning', private readonly workspaceId: string | null) {}

  mark(stage: PerformanceTimelineStage, metadata: Record<string, unknown> = {}): number {
    const elapsedMs = Math.max(0, Math.round(performance.now() - this.startedMonotonic))
    const timing = stage === 'provider_first_token' || stage === 'renderer_first_token' ? { ttftMs: elapsedMs } : stage === 'persistence_completed' ? { totalMs: elapsedMs } : {}
    this.database.sqlite.prepare('INSERT INTO performance_timeline_events (id,operation_id,operation_type,workspace_id,stage,wall_time,elapsed_ms,metadata_json) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), this.operationId, this.operationType, this.workspaceId, stage, this.startedWall + elapsedMs, elapsedMs, JSON.stringify(safeMetadata({ ...metadata, ...timing })))
    return elapsedMs
  }
}

export class PerformanceTimelineStore {
  constructor(private readonly database: CoachDatabase) {}
  startChat(requestId: string, workspaceId: string): PerformanceTimeline { return new PerformanceTimeline(this.database, requestId, 'chat', workspaceId) }
  startProvisioning(operationId: string, workspaceId: string): PerformanceTimeline { return new PerformanceTimeline(this.database, operationId, 'provisioning', workspaceId) }
  markProvisioning(workspaceId: string, stage: ProvisioningTimelineStage, metadata: Record<string, unknown> = {}): void {
    const row = this.database.sqlite.prepare('SELECT COALESCE(started_at,created_at) AS startedAt FROM workspace_provisioning WHERE workspace_id=?').get(workspaceId) as { startedAt: number } | undefined
    if (!row) return
    const wallTime = Date.now()
    const elapsedMs = Math.max(0, wallTime - row.startedAt)
    const operationId = `provisioning:${workspaceId}:${row.startedAt}`
    this.database.sqlite.prepare('INSERT INTO performance_timeline_events (id,operation_id,operation_type,workspace_id,stage,wall_time,elapsed_ms,metadata_json) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), operationId, 'provisioning', workspaceId, stage, wallTime, elapsedMs, JSON.stringify(safeMetadata(metadata)))
  }
  markRendererFirstToken(requestId: string): void {
    const row = this.database.sqlite.prepare("SELECT operation_type AS operationType,workspace_id AS workspaceId,MIN(wall_time-elapsed_ms) AS startedWall FROM performance_timeline_events WHERE operation_id=? AND operation_type='chat'").get(requestId) as { operationType: 'chat'; workspaceId: string | null; startedWall: number | null } | undefined
    if (!row?.startedWall) return
    const elapsedMs = Math.max(0, Date.now() - row.startedWall)
    this.database.sqlite.prepare("INSERT INTO performance_timeline_events (id,operation_id,operation_type,workspace_id,stage,wall_time,elapsed_ms,metadata_json) SELECT ?,operation_id,operation_type,workspace_id,'renderer_first_token',?,?,? FROM performance_timeline_events WHERE operation_id=? AND NOT EXISTS (SELECT 1 FROM performance_timeline_events WHERE operation_id=? AND stage='renderer_first_token') LIMIT 1").run(crypto.randomUUID(), Date.now(), elapsedMs, JSON.stringify({ ttftMs: elapsedMs }), requestId, requestId)
  }
}
