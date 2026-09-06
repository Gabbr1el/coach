import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { studySessions } from './study-workspaces'
import { workspaces } from './workspaces'

export const learningEvents = sqliteTable('learning_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => studySessions.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['session_started', 'session_completed', 'window_blurred', 'window_focused', 'code_executed', 'execution_error', 'possible_learning_loop', 'plan_item_changed'] }).notNull(),
  payloadJson: text('payload_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  check('learning_events_type_check', sql`${table.type} in ('session_started','session_completed','window_blurred','window_focused','code_executed','execution_error','possible_learning_loop','plan_item_changed')`),
  index('learning_events_session_created_idx').on(table.sessionId, table.createdAt),
  index('learning_events_workspace_type_idx').on(table.workspaceId, table.type, table.createdAt),
])
