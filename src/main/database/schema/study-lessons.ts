import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const studyLessons = sqliteTable('study_lessons', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  roadmapId: text('roadmap_id').notNull(),
  moduleId: text('module_id').notNull(),
  topicId: text('topic_id').notNull(),
  contentJson: text('content_json').notNull(),
  providerId: text('provider_id'),
  modelId: text('model_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('study_lessons_roadmap_topic_unique').on(table.roadmapId, table.topicId), index('study_lessons_workspace_idx').on(table.workspaceId)])
