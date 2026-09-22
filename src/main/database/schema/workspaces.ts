import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    objective: text('objective').notNull().default(''),
    status: text('status', { enum: ['active', 'completed', 'archived'] }).notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastOpenedAt: integer('last_opened_at'),
    archivedAt: integer('archived_at'),
    completedAt: integer('completed_at'),
    confirmedAt: integer('confirmed_at'),
    equivalenceKey: text('equivalence_key').notNull().default(sql`(lower(hex(randomblob(16))))`),
    meaningfulDistinction: text('meaningful_distinction'),
    predecessorId: text('predecessor_id').references((): any => workspaces.id, { onDelete: 'set null' }),
  },
  (table) => [
    check('workspaces_name_length_check', sql`length(trim(${table.name})) between 1 and 80`),
    check('workspaces_status_check', sql`${table.status} in ('active', 'completed', 'archived')`),
    check(
      'workspaces_archive_consistency_check',
      sql`(${table.status} = 'active' and ${table.archivedAt} is null and ${table.completedAt} is null) or (${table.status} = 'completed' and ${table.completedAt} is not null and ${table.archivedAt} is null) or (${table.status} = 'archived' and ${table.archivedAt} is not null)`,
    ),
    index('workspaces_status_updated_idx').on(table.status, table.updatedAt),
    index('workspaces_last_opened_idx').on(table.lastOpenedAt),
    uniqueIndex('workspaces_confirmed_active_equivalence_unique').on(table.equivalenceKey).where(sql`${table.status} = 'active' and ${table.confirmedAt} is not null`),
  ],
)

export type WorkspaceRow = typeof workspaces.$inferSelect
export type NewWorkspaceRow = typeof workspaces.$inferInsert

export const workspaceTerminalMemory = sqliteTable('workspace_terminal_memory', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  consolidatedAt: integer('consolidated_at').notNull(),
})

export const workspaceRepairConflicts = sqliteTable(
  'workspace_repair_conflicts',
  {
    equivalenceKey: text('equivalence_key').primaryKey(),
    canonicalWorkspaceId: text('canonical_workspace_id').notNull().references(() => workspaces.id, { onDelete: 'restrict' }),
    workspaceIdsJson: text('workspace_ids_json').notNull(),
    evidenceWorkspaceIdsJson: text('evidence_workspace_ids_json').notNull(),
    reason: text('reason', { enum: ['multiple_meaningful_evidence'] }).notNull(),
    detectedAt: integer('detected_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (table) => [
    check('workspace_repair_conflicts_reason_check', sql`${table.reason} in ('multiple_meaningful_evidence')`),
    index('workspace_repair_conflicts_resolution_idx').on(table.resolvedAt, table.detectedAt),
  ],
)
