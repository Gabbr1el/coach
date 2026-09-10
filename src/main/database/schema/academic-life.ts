import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const academicLifeItems = sqliteTable('academic_life_items', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['fact', 'event', 'commitment', 'availability'] }).notNull(),
  status: text('status', { enum: ['active', 'resolved', 'archived'] }).notNull().default('active'),
  title: text('title').notNull(), details: text('details').notNull().default(''),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  startsAt: integer('starts_at'), endsAt: integer('ends_at'), expiresAt: integer('expires_at'), timezone: text('timezone').notNull(),
  weekday: integer('weekday'), minutes: integer('minutes'), shareWithAi: integer('share_with_ai', { mode: 'boolean' }).notNull().default(true),
  provenanceSource: text('provenance_source', { enum: ['user_ui', 'conversation', 'legacy_migration', 'system'] }).notNull(), provenanceReference: text('provenance_reference'),
  replacesId: text('replaces_id'), replacedById: text('replaced_by_id'), fingerprint: text('fingerprint').notNull(),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(), resolvedAt: integer('resolved_at'), archivedAt: integer('archived_at'),
}, (table) => [
  check('academic_life_kind_check', sql`${table.kind} in ('fact','event','commitment','availability')`),
  check('academic_life_status_check', sql`${table.status} in ('active','resolved','archived')`),
  check('academic_life_availability_check', sql`(${table.kind} = 'availability' and ${table.weekday} between 0 and 6 and ${table.minutes} between 0 and 1440) or (${table.kind} <> 'availability' and ${table.weekday} is null and ${table.minutes} is null)`),
  uniqueIndex('academic_life_fingerprint_idx').on(table.fingerprint),
  index('academic_life_current_idx').on(table.status, table.expiresAt, table.endsAt),
  index('academic_life_workspace_idx').on(table.workspaceId),
])
