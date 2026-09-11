import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const performanceTimelineEvents = sqliteTable('performance_timeline_events', {
  id: text('id').primaryKey(),
  operationId: text('operation_id').notNull(),
  operationType: text('operation_type', { enum: ['chat', 'provisioning'] }).notNull(),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  stage: text('stage').notNull(),
  wallTime: integer('wall_time').notNull(),
  elapsedMs: integer('elapsed_ms').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
}, (table) => [
  index('performance_timeline_operation_idx').on(table.operationId, table.elapsedMs),
  index('performance_timeline_type_time_idx').on(table.operationType, table.wallTime),
])

export const materialAnalysisCache = sqliteTable('material_analysis_cache', {
  analysisFingerprint: text('analysis_fingerprint').primaryKey(),
  contentHash: text('content_hash').notNull(),
  extractionFingerprint: text('extraction_fingerprint').notNull(),
  parserRevision: text('parser_revision').notNull(),
  schemaRevision: text('schema_revision').notNull(),
  roleContextHash: text('role_context_hash').notNull(),
  analysisJson: text('analysis_json').notNull(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at').notNull(),
}, (table) => [index('material_analysis_cache_lookup_idx').on(table.contentHash, table.parserRevision, table.schemaRevision, table.roleContextHash)])
