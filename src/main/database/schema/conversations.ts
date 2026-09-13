import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const conversationThreads = sqliteTable('conversation_threads', {
  id: text('id').primaryKey(),
  scope: text('scope', { enum: ['home', 'workspace'] }).notNull(),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('conversation_threads_scope_check', sql`${table.scope} in ('home', 'workspace')`),
  check('conversation_threads_scope_workspace_check', sql`(${table.scope} = 'home' and ${table.workspaceId} is null) or (${table.scope} = 'workspace' and ${table.workspaceId} is not null)`),
])

export const conversationMessages = sqliteTable(
  'conversation_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull().references(() => conversationThreads.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    createdAt: integer('created_at').notNull(),
    sequence: integer('sequence').notNull(),
  },
  (table) => [
    check('conversation_messages_role_check', sql`${table.role} in ('user', 'assistant', 'system')`),
    uniqueIndex('conversation_messages_thread_sequence_idx').on(table.threadId, table.sequence),
    index('conversation_messages_thread_created_idx').on(table.threadId, table.createdAt),
  ],
)

export const organizerConversationStates = sqliteTable('organizer_conversation_states', {
  threadId: text('thread_id').primaryKey().references(() => conversationThreads.id, { onDelete: 'cascade' }),
  stateJson: text('state_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
