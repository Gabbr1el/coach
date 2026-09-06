import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const providerConfigurations = sqliteTable('provider_configurations', {
  providerId: text('provider_id', { enum: ['openai'] }).primaryKey(),
  displayName: text('display_name').notNull(),
  model: text('model').notNull(),
  secretReference: text('secret_reference').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  check('provider_configurations_provider_check', sql`${table.providerId} in ('openai')`),
  check('provider_configurations_secret_reference_check', sql`length(trim(${table.secretReference})) > 0`),
])
