import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { studySessions } from './study-workspaces'
import { workspaces } from './workspaces'

export const savedForLater = sqliteTable('saved_for_later', { id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }), content: text('content').notNull(), completedAt: integer('completed_at'), createdAt: integer('created_at').notNull() }, (table) => [index('saved_for_later_workspace_idx').on(table.workspaceId, table.createdAt)])
export const sessionTopics = sqliteTable('session_topics', { id: text('id').primaryKey(), sessionId: text('session_id').notNull().references(() => studySessions.id, { onDelete: 'cascade' }), title: text('title').notNull(), kind: text('kind').notNull(), occurredAt: integer('occurred_at').notNull() }, (table) => [index('session_topics_session_idx').on(table.sessionId, table.occurredAt)])
