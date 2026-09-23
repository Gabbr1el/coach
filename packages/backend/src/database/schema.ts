import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const tenantKind = pgEnum('tenant_kind', ['personal', 'organization']);
export const membershipRole = pgEnum('membership_role', ['owner', 'member']);
export const membershipStatus = pgEnum('membership_status', ['active', 'removed']);
export const syncMutationState = pgEnum('sync_mutation_state', ['accepted', 'conflict', 'rejected']);
export const syncEntityClass = pgEnum('sync_entity_class', ['append_only', 'revisioned_text', 'scalar', 'generated']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  kind: tenantKind('kind').notNull(),
  name: text('name').notNull(),
  personalOwnerUserId: uuid('personal_owner_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('tenants_personal_owner_uidx').on(table.personalOwnerUserId),
  check('tenants_kind_owner_check', sql`(${table.kind} = 'personal' AND ${table.personalOwnerUserId} IS NOT NULL) OR (${table.kind} = 'organization' AND ${table.personalOwnerUserId} IS NULL)`)
]);

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('pt-BR'),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const tenantMemberships = pgTable('tenant_memberships', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull(),
  role: membershipRole('role').notNull(),
  status: membershipStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.tenantId, table.userId] }), index('memberships_user_idx').on(table.userId)]);

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull(),
  label: text('label').notNull(),
  platform: text('platform').notNull(),
  appVersion: text('app_version').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('devices_tenant_user_idx').on(table.tenantId, table.userId)]);

export const appSessions = pgTable('app_sessions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull(),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  authSessionId: uuid('auth_session_id').notNull(),
  lastSeenVersion: text('last_seen_version').notNull(),
  networkMetadata: jsonb('network_metadata').notNull().default({}),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revocationReason: text('revocation_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('app_sessions_user_auth_uidx').on(table.userId, table.authSessionId),
  index('app_sessions_tenant_user_idx').on(table.tenantId, table.userId)
]);

export const securityAuditEvents = pgTable('security_audit_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  userId: uuid('user_id'),
  sessionId: uuid('session_id'),
  type: text('type').notNull(),
  outcome: text('outcome').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('audit_tenant_created_idx').on(table.tenantId, table.createdAt)]);

export const syncTenantSequences = pgTable('sync_tenant_sequences', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  committedSequence: bigint('committed_sequence', { mode: 'number' }).notNull().default(0),
  minimumAvailableSequence: bigint('minimum_available_sequence', { mode: 'number' }).notNull().default(1),
  mutationNotBefore: timestamp('mutation_not_before', { withTimezone: true }).notNull().defaultNow()
});

export const syncAggregateGenerations = pgTable('sync_aggregate_generations', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  aggregateId: uuid('aggregate_id').notNull(),
  generation: bigint('generation', { mode: 'number' }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, (table) => [primaryKey({ columns: [table.tenantId, table.aggregateId] })]);

export const syncEntities = pgTable('sync_entities', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  entityClass: syncEntityClass('entity_class').notNull(),
  aggregateId: uuid('aggregate_id'),
  aggregateGeneration: bigint('aggregate_generation', { mode: 'number' }).notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  payloadVersion: integer('payload_version').notNull(),
  payload: jsonb('payload'),
  payloadHash: text('payload_hash').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.tenantId, table.entityType, table.entityId] }), index('sync_entities_tenant_order_idx').on(table.tenantId, table.entityType, table.entityId)]);

export const syncMutations = pgTable('sync_mutations', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  mutationId: uuid('mutation_id').notNull(),
  userId: uuid('user_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  requestHash: text('request_hash').notNull(),
  state: syncMutationState('state').notNull(),
  result: jsonb('result').notNull(),
  committedSequence: bigint('committed_sequence', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.tenantId, table.mutationId] }), index('sync_mutations_retention_idx').on(table.tenantId, table.completedAt)]);

export const syncChanges = pgTable('sync_changes', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  sequence: bigint('sequence', { mode: 'number' }).notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  entityClass: syncEntityClass('entity_class').notNull(),
  aggregateId: uuid('aggregate_id'),
  hierarchy: text('hierarchy').notNull(),
  operation: text('operation').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  aggregateGeneration: bigint('aggregate_generation', { mode: 'number' }).notNull(),
  payloadVersion: integer('payload_version').notNull(),
  payload: jsonb('payload'),
  payloadHash: text('payload_hash').notNull(),
  committedAt: timestamp('committed_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.tenantId, table.sequence] }), index('sync_changes_retention_idx').on(table.tenantId, table.committedAt)]);

export const syncCursors = pgTable('sync_cursors', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  deviceId: uuid('device_id').notNull(),
  acknowledgedSequence: bigint('acknowledged_sequence', { mode: 'number' }).notNull().default(0),
  greatestDeliveredSequence: bigint('greatest_delivered_sequence', { mode: 'number' }).notNull().default(0),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.tenantId, table.deviceId] })]);
