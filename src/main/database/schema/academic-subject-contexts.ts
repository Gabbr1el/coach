import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const academicSubjectContexts = sqliteTable('academic_subject_contexts', {
  subject: text('subject').primaryKey(),
  declaredLevel: text('declared_level', { enum: ['beginner', 'intermediate', 'advanced'] }),
  declaredKnowledgeJson: text('declared_knowledge_json').notNull().default('[]'),
  declaredDifficultiesJson: text('declared_difficulties_json').notNull().default('[]'),
  goalsJson: text('goals_json').notNull().default('[]'),
  sourceEvidenceJson: text('source_evidence_json').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [check('academic_subject_contexts_level_check', sql`${table.declaredLevel} is null or ${table.declaredLevel} in ('beginner','intermediate','advanced')`)])
export const workspaceAcademicContexts = sqliteTable('workspace_academic_contexts', { workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }), subject: text('subject').notNull().references(() => academicSubjectContexts.subject, { onDelete: 'cascade' }), relation: text('relation', { enum: ['primary', 'implementation_language', 'prerequisite', 'user_selected'] }).notNull() }, (table) => [primaryKey({ columns: [table.workspaceId, table.subject] }), uniqueIndex('workspace_academic_contexts_one_primary').on(table.workspaceId).where(sql`${table.relation} = 'primary'`), check('workspace_academic_contexts_relation_check', sql`${table.relation} in ('primary','implementation_language','prerequisite','user_selected')`)])
