import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const plannerActions = sqliteTable('planner_actions', {
  id: text('id').primaryKey(), idempotencyKey: text('idempotency_key').notNull(), type: text('type', { enum: ['workspace.create', 'deadline.create', 'routine.add'] }).notNull(), status: text('status', { enum: ['proposed', 'applied', 'rejected'] }).notNull().default('proposed'), payloadJson: text('payload_json').notNull(), resultJson: text('result_json'), createdAt: integer('created_at').notNull(), resolvedAt: integer('resolved_at'),
}, (table) => [check('planner_actions_type_check', sql`${table.type} in ('workspace.create','deadline.create','routine.add')`), check('planner_actions_status_check', sql`${table.status} in ('proposed','applied','rejected')`), uniqueIndex('planner_actions_idempotency_idx').on(table.idempotencyKey), index('planner_actions_status_created_idx').on(table.status, table.createdAt)])
