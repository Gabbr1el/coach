import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const studyLessons = sqliteTable('study_lessons', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  roadmapId: text('roadmap_id').notNull(),
  moduleId: text('module_id').notNull(),
  topicId: text('topic_id').notNull(),
  generationKind: text('generation_kind', { enum: ['ai_generated', 'provisional_fallback'] }).notNull().default('ai_generated'),
  contentRevision: integer('content_revision').notNull().default(1),
  inputHash: text('input_hash').notNull().default('legacy-unavailable'),
  contentJson: text('content_json').notNull(),
  providerId: text('provider_id'),
  modelId: text('model_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('study_lessons_roadmap_topic_unique').on(table.roadmapId, table.topicId), index('study_lessons_workspace_idx').on(table.workspaceId)])

export const studyLessonAdaptations = sqliteTable('study_lesson_adaptations', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }), lessonId: text('lesson_id').notNull().references(() => studyLessons.id, { onDelete: 'cascade' }), blockId: text('source_block_id').notNull(), revision: integer('revision').notNull(), reason: text('reason').notNull(), mode: text('mode').notNull(), adaptedBlockJson: text('adapted_block_json').notNull(), isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false), providerId: text('provider_id'), modelId: text('model_id'), createdAt: integer('created_at').notNull(),
}, (table) => [uniqueIndex('study_lesson_adaptations_revision_unique').on(table.lessonId, table.blockId, table.revision), uniqueIndex('study_lesson_adaptations_one_active').on(table.lessonId, table.blockId).where(sql`${table.isActive} = 1`), index('study_lesson_adaptations_lesson_block_idx').on(table.lessonId, table.blockId, table.createdAt)])

export const workspaceStudyPreferences = sqliteTable('workspace_study_preferences', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }), preferencesJson: text('preferences_json').notNull().default('{}'), updatedAt: integer('updated_at').notNull(),
})
