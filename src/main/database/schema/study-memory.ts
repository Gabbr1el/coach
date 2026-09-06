import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { studySessions } from './study-workspaces'
import { workspaces } from './workspaces'
export const studentMemory = sqliteTable('student_memory', { id: text('id').primaryKey(), summary: text('summary').notNull().default(''), updatedAt: integer('updated_at').notNull() })
export const workspaceMemories = sqliteTable('workspace_memories', { id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }), summary: text('summary').notNull().default(''), updatedAt: integer('updated_at').notNull() }, (table) => [uniqueIndex('workspace_memories_workspace_idx').on(table.workspaceId)])
export const sessionMemories = sqliteTable('session_memories', { id: text('id').primaryKey(), sessionId: text('session_id').notNull().references(() => studySessions.id, { onDelete: 'cascade' }), summary: text('summary').notNull().default(''), createdAt: integer('created_at').notNull() }, (table) => [uniqueIndex('session_memories_session_idx').on(table.sessionId)])
