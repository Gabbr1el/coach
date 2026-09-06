import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const studySessions = sqliteTable('study_sessions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['active', 'completed'] }).notNull().default('active'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  focusSeconds: integer('focus_seconds').notNull().default(0),
}, (table) => [
  check('study_sessions_status_check', sql`${table.status} in ('active', 'completed')`),
  check('study_sessions_end_check', sql`(${table.status} = 'active' and ${table.endedAt} is null) or (${table.status} = 'completed' and ${table.endedAt} is not null)`),
  check('study_sessions_focus_check', sql`${table.focusSeconds} >= 0`),
  uniqueIndex('study_sessions_one_active_per_workspace_idx').on(table.workspaceId).where(sql`${table.status} = 'active'`),
  index('study_sessions_workspace_started_idx').on(table.workspaceId, table.startedAt),
])

export const workspaceStudyStates = sqliteTable('workspace_study_states', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  activeSessionId: text('active_session_id').notNull().references(() => studySessions.id, { onDelete: 'restrict' }),
  fileName: text('file_name').notNull(),
  language: text('language').notNull(),
  editorContent: text('editor_content').notNull().default(''),
  notes: text('notes').notNull().default(''),
  shareContextWithAi: integer('share_context_with_ai', { mode: 'boolean' }).notNull().default(false),
  timerDurationSeconds: integer('timer_duration_seconds').notNull().default(1500),
  timerRemainingSeconds: integer('timer_remaining_seconds').notNull().default(1500),
  timerStatus: text('timer_status', { enum: ['idle', 'running', 'paused'] }).notNull().default('idle'),
  timerStartedAt: integer('timer_started_at'),
  updatedAt: integer('updated_at').notNull(),
  documentRevision: integer('document_revision').notNull().default(0),
  notesRevision: integer('notes_revision').notNull().default(0),
  accumulatedFocusSeconds: integer('accumulated_focus_seconds').notNull().default(0),
}, (table) => [
  check('workspace_study_states_filename_check', sql`length(trim(${table.fileName})) between 1 and 120`),
  check('workspace_study_states_timer_check', sql`${table.timerDurationSeconds} between 60 and 10800 and ${table.timerRemainingSeconds} between 0 and ${table.timerDurationSeconds}`),
  check('workspace_study_states_timer_status_check', sql`${table.timerStatus} in ('idle', 'running', 'paused')`),
  check('workspace_study_states_timer_started_check', sql`(${table.timerStatus} = 'running' and ${table.timerStartedAt} is not null) or (${table.timerStatus} != 'running' and ${table.timerStartedAt} is null)`),
  check('workspace_study_states_context_check', sql`${table.shareContextWithAi} in (0, 1)`),
  check('workspace_study_states_revision_check', sql`${table.documentRevision} >= 0 and ${table.notesRevision} >= 0`),
  check('workspace_study_states_focus_check', sql`${table.accumulatedFocusSeconds} >= 0`),
])

export const studyPlanItems = sqliteTable('study_plan_items', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => studySessions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  position: integer('position').notNull(),
  status: text('status', { enum: ['pending', 'active', 'completed'] }).notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('study_plan_items_title_check', sql`length(trim(${table.title})) between 1 and 160`),
  check('study_plan_items_duration_check', sql`${table.durationMinutes} between 1 and 480`),
  check('study_plan_items_position_check', sql`${table.position} > 0`),
  check('study_plan_items_status_check', sql`${table.status} in ('pending', 'active', 'completed')`),
  uniqueIndex('study_plan_items_session_position_idx').on(table.sessionId, table.position),
  uniqueIndex('study_plan_items_one_active_idx').on(table.sessionId).where(sql`${table.status} = 'active'`),
  index('study_plan_items_workspace_idx').on(table.workspaceId, table.updatedAt),
])
