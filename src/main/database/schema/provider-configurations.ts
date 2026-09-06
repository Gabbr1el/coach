import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const providerConfigurations = sqliteTable('provider_configurations', {
  id: text('id').primaryKey(),
  providerId: text('provider_id', { enum: ['openai'] }).notNull(),
  displayName: text('display_name').notNull(),
  label: text('label').notNull(),
  model: text('model').notNull(),
  secretReference: text('secret_reference').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('provider_configurations_provider_check', sql`${table.providerId} in ('openai')`),
  check('provider_configurations_secret_reference_check', sql`length(trim(${table.secretReference})) > 0`),
  check('provider_configurations_label_check', sql`length(trim(${table.label})) between 1 and 60`),
  uniqueIndex('provider_configurations_single_active_idx').on(table.isActive).where(sql`${table.isActive} = 1`),
])
