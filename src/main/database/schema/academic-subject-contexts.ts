import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

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
