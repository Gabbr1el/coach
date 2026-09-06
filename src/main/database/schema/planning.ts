import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const studyDeadlines = sqliteTable('study_deadlines', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  dueAt: integer('due_at').notNull(),
  estimatedMinutes: integer('estimated_minutes').notNull().default(120),
  masteryPercent: integer('mastery_percent').notNull().default(50),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
}, (table) => [check('study_deadlines_mastery_check', sql`${table.masteryPercent} between 0 and 100`), check('study_deadlines_minutes_check', sql`${table.estimatedMinutes} between 1 and 100000`), index('study_deadlines_due_idx').on(table.dueAt)])

export const routineNotes = sqliteTable('routine_notes', { id: text('id').primaryKey(), content: text('content').notNull(), createdAt: integer('created_at').notNull() })
