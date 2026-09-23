import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const tenantKind = pgEnum('tenant_kind', ['personal', 'organization']);
export const membershipRole = pgEnum('membership_role', ['owner', 'member']);
export const membershipStatus = pgEnum('membership_status', ['active', 'removed']);

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
