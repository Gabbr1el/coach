import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { workspaces } from './workspaces'

export const workspaceLearningOverrides = sqliteTable('workspace_learning_overrides', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  canonicalFocus: text('canonical_focus').notNull().default(''),
  canonicalContext: text('canonical_context').notNull().default(''),
  declaredLevel: text('declared_level', { enum: ['beginner', 'intermediate', 'advanced'] }),
  declaredKnowledgeJson: text('declared_knowledge_json').notNull().default('[]'),
  declaredDifficultiesJson: text('declared_difficulties_json').notNull().default('[]'),
  goalsJson: text('goals_json').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [check('workspace_learning_overrides_level_check', sql`${table.declaredLevel} is null or ${table.declaredLevel} in ('beginner','intermediate','advanced')`)])

export const workspaceProvisioning = sqliteTable('workspace_provisioning', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['draft', 'queued', 'running', 'waiting_for_provider', 'failed_retryable', 'ready'] }).notNull(),
  stage: text('stage', { enum: ['workspace', 'materials', 'roadmap', 'lesson', 'ready'] }).notNull(),
  materialIdsJson: text('material_ids_json').notNull().default('[]'),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  stageUpdatedAt: integer('stage_updated_at').notNull(),
  completedAt: integer('completed_at'),
  retryAfter: integer('retry_after'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
}, (table) => [check('workspace_provisioning_status_check', sql`${table.status} in ('draft','queued','running','waiting_for_provider','failed_retryable','ready')`), check('workspace_provisioning_stage_check', sql`${table.stage} in ('workspace','materials','roadmap','lesson','ready')`), index('workspace_provisioning_resume_idx').on(table.status, table.retryAfter)])
