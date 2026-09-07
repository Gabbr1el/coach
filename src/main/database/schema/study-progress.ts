import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const studyProgress = sqliteTable('study_progress', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  roadmapId: text('roadmap_id').notNull(),
  currentModuleId: text('current_module_id').notNull(),
  currentTopicId: text('current_topic_id').notNull(),
  currentLessonId: text('current_lesson_id').notNull(),
  currentCheckpointId: text('current_checkpoint_id'),
  topicStatusesJson: text('topic_statuses_json').notNull().default('{}'),
  lessonPositionsJson: text('lesson_positions_json').notNull().default('{}'),
  updatedAt: integer('updated_at').notNull(),
})

export const studyProgressEvents = sqliteTable('study_progress_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['TOPIC_STARTED', 'TOPIC_COMPLETED', 'CHECKPOINT_ANSWERED', 'HELP_USED'] }).notNull(),
  moduleId: text('module_id').notNull(),
  topicId: text('topic_id').notNull(),
  lessonId: text('lesson_id').notNull(),
  checkpointId: text('checkpoint_id'),
  correct: integer('correct', { mode: 'boolean' }),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  check('study_progress_events_type_check', sql`${table.type} in ('TOPIC_STARTED','TOPIC_COMPLETED','CHECKPOINT_ANSWERED','HELP_USED')`),
  index('study_progress_events_workspace_created_idx').on(table.workspaceId, table.createdAt),
  index('study_progress_events_topic_type_idx').on(table.topicId, table.type),
])
