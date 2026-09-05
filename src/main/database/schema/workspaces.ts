import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    objective: text('objective').notNull().default(''),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastOpenedAt: integer('last_opened_at'),
    archivedAt: integer('archived_at'),
  },
  (table) => [
    check('workspaces_name_length_check', sql`length(trim(${table.name})) between 1 and 80`),
    check('workspaces_status_check', sql`${table.status} in ('active', 'archived')`),
    check(
      'workspaces_archive_consistency_check',
      sql`(${table.status} = 'active' and ${table.archivedAt} is null) or (${table.status} = 'archived' and ${table.archivedAt} is not null)`,
    ),
    index('workspaces_status_updated_idx').on(table.status, table.updatedAt),
    index('workspaces_last_opened_idx').on(table.lastOpenedAt),
  ],
)

export type WorkspaceRow = typeof workspaces.$inferSelect
export type NewWorkspaceRow = typeof workspaces.$inferInsert
