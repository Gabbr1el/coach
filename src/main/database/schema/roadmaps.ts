import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const roadmaps = sqliteTable('roadmaps', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }), title: text('title').notNull(), status: text('status', { enum: ['proposed', 'accepted', 'archived'] }).notNull().default('proposed'), generationKind: text('generation_kind', { enum: ['ai_generated', 'provisional_fallback'] }).notNull().default('ai_generated'), version: integer('version').notNull(), providerId: text('provider_id'), modelId: text('model_id'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [check('roadmaps_status_check', sql`${table.status} in ('proposed','accepted','archived')`), uniqueIndex('roadmaps_workspace_version_idx').on(table.workspaceId, table.version), index('roadmaps_workspace_status_idx').on(table.workspaceId, table.status)])

export const roadmapModules = sqliteTable('roadmap_modules', {
  id: text('id').primaryKey(), roadmapId: text('roadmap_id').notNull().references(() => roadmaps.id, { onDelete: 'cascade' }), title: text('title').notNull(), objective: text('objective').notNull(), estimatedMinutes: integer('estimated_minutes').notNull(), position: integer('position').notNull(), status: text('status', { enum: ['locked', 'available', 'active', 'completed'] }).notNull().default('locked'), topicsJson: text('topics_json').notNull().default('[]'), outcomesJson: text('outcomes_json').notNull().default('[]'), practice: text('practice').notNull().default(''), completionCriteriaJson: text('completion_criteria_json').notNull().default('[]'), resourcesJson: text('resources_json').notNull().default('[]'),
}, (table) => [check('roadmap_modules_status_check', sql`${table.status} in ('locked','available','active','completed')`), uniqueIndex('roadmap_modules_position_idx').on(table.roadmapId, table.position)])
