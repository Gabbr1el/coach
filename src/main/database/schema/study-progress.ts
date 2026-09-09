import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'
import { roadmapModules, roadmaps } from './roadmaps'

export const studyProgress = sqliteTable('study_progress', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  roadmapId: text('roadmap_id').notNull(),
  currentModuleId: text('current_module_id').notNull(),
  currentTopicId: text('current_topic_id').notNull(),
  currentLessonId: text('current_lesson_id').notNull(),
  currentCheckpointId: text('current_checkpoint_id'),
  topicStatusesJson: text('topic_statuses_json').notNull().default('{}'),
  lessonPositionsJson: text('lesson_positions_json').notNull().default('{}'),
  checkpointStatesJson: text('checkpoint_states_json').notNull().default('{}'),
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

export const studyInteractiveCodeStates = sqliteTable('study_interactive_code_states', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  lessonId: text('lesson_id').notNull(),
  blockId: text('block_id').notNull(),
  currentCode: text('current_code').notNull(),
  prediction: text('prediction'),
  currentSourceRevision: text('current_source_revision').notNull().default('legacy-unvalidated'),
  attempts: integer('attempts').notNull().default(0),
  lastExecutionJson: text('last_execution_json'),
  validationResultJson: text('validation_result_json'),
  evidenceGrantedAt: integer('evidence_granted_at'),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  uniqueIndex('study_interactive_code_states_workspace_lesson_block_idx').on(table.workspaceId, table.lessonId, table.blockId),
  index('study_interactive_code_states_lesson_idx').on(table.lessonId),
])

export const topicLearningStates = sqliteTable('topic_learning_states', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }), topicId: text('topic_id').notNull(), evidenceCount: integer('evidence_count').notNull().default(0), assessments: integer('assessments').notNull().default(0), correctFirstTry: integer('correct_first_try').notNull().default(0), correctAfterHelp: integer('correct_after_help').notNull().default(0), incorrect: integer('incorrect').notNull().default(0), hintsUsed: integer('hints_used').notNull().default(0), reinforcementEvents: integer('reinforcement_events').notNull().default(0), exercisesCompleted: integer('exercises_completed').notNull().default(0), lessonsCompleted: integer('lessons_completed').notNull().default(0), difficultyLevel: text('difficulty_level', { enum: ['low', 'medium', 'high'] }).notNull().default('low'), masteryEstimate: integer('mastery_estimate'), confidence: text('confidence', { enum: ['low', 'medium', 'high'] }).notNull().default('low'), needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false), lastPracticedAt: integer('last_practiced_at'), lastAssessedAt: integer('last_assessed_at'), reasonsJson: text('reasons_json').notNull().default('[]'), updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('topic_learning_states_workspace_topic_idx').on(table.workspaceId, table.topicId)])

export const roadmapAdaptations = sqliteTable('roadmap_adaptations', {
  id: text('id').primaryKey(), roadmapId: text('roadmap_id').notNull().references(() => roadmaps.id, { onDelete: 'cascade' }), moduleId: text('module_id').notNull().references(() => roadmapModules.id, { onDelete: 'cascade' }), topicId: text('topic_id').notNull(), kind: text('kind', { enum: ['reinforcement'] }).notNull(), source: text('source', { enum: ['adaptive_reinforcement'] }).notNull(), reasonJson: text('reason_json').notNull(), createdAt: integer('created_at').notNull(),
}, (table) => [uniqueIndex('roadmap_adaptations_module_topic_kind_idx').on(table.moduleId, table.topicId, table.kind)])
