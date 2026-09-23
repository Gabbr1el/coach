import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/database/client.js';
import { withTenantTransaction } from '../../src/database/tenant-transaction.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('tenant RLS and pooled connection isolation', () => {
  let database: Database;
  const userA = randomUUID(); const userB = randomUUID();
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const organizationA = randomUUID();
  const sessionA = randomUUID(); const sessionB = randomUUID();

  beforeAll(async () => {
    database = createDatabase(databaseUrl!, 1);
    const admin = createDatabase(process.env.MIGRATION_DATABASE_URL ?? databaseUrl!, 1);
    try {
      await admin`insert into tenants (id, kind, name, personal_owner_user_id) values (${tenantA}, 'personal', 'A', ${userA}), (${tenantB}, 'personal', 'B', ${userB}), (${organizationA}, 'organization', 'A org', null)`;
      await admin`insert into tenant_memberships (tenant_id, user_id, role) values (${tenantA}, ${userA}, 'owner'), (${tenantB}, ${userB}, 'owner'), (${organizationA}, ${userA}, 'member')`;
    } finally {
      await admin.end();
    }
  });

  afterAll(async () => { await database.end(); });

  it('denies missing context and cross-tenant reads', async () => {
    expect(await database<{ id: string }[]>`select id from tenants`).toEqual([]);
    const visibleA = await withTenantTransaction(database, { userId: userA, tenantId: tenantA, sessionId: sessionA }, (transaction) => transaction<{ id: string }[]>`select id from tenants`);
    expect(visibleA.map((row) => row.id)).toEqual([tenantA]);
    const guessedB = await withTenantTransaction(database, { userId: userA, tenantId: tenantA, sessionId: sessionA }, (transaction) => transaction<{ id: string }[]>`select id from tenants where id = ${tenantB}`);
    expect(guessedB).toEqual([]);
    await expect(withTenantTransaction(database, { userId: userA, tenantId: tenantA, sessionId: sessionA }, (transaction) => transaction`
      insert into devices (id, tenant_id, user_id, label, platform, app_version)
      values (${randomUUID()}, ${tenantB}, ${userA}, 'forbidden', 'linux', 'test')
    `)).rejects.toThrow();
  });

  it('does not leak transaction-local settings through a reused pool connection', async () => {
    await withTenantTransaction(database, { userId: userA, tenantId: tenantA, sessionId: sessionA }, async (transaction) => { expect((await transaction`select id from tenants`)).toHaveLength(1); });
    expect(await database`select id from tenants`).toEqual([]);
    await expect(withTenantTransaction(database, { userId: userB, tenantId: tenantB, sessionId: sessionB }, async (transaction) => {
      await transaction`select id from tenants`;
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await database`select id from tenants`).toEqual([]);
  });

  it('isolates two tenants belonging to the same user and blocks membership escalation', async () => {
    const personal = await withTenantTransaction(database, { userId: userA, tenantId: tenantA, sessionId: sessionA }, (transaction) => transaction<{ id: string }[]>`select id from tenants`);
    expect(personal.map(({ id }) => id)).toEqual([tenantA]);
    const organization = await withTenantTransaction(database, { userId: userA, tenantId: organizationA, sessionId: sessionA }, (transaction) => transaction<{ id: string }[]>`select id from tenants`);
    expect(organization.map(({ id }) => id)).toEqual([organizationA]);
    await expect(withTenantTransaction(database, { userId: userA, tenantId: organizationA, sessionId: sessionA }, (transaction) => transaction`
      update tenant_memberships set role = 'owner' where tenant_id = ${organizationA} and user_id = ${userA}
    `)).rejects.toThrow();
  });

  it('keeps FORCE ROW LEVEL SECURITY enabled', async () => {
    const admin = createDatabase(process.env.MIGRATION_DATABASE_URL ?? databaseUrl!, 1);
    try {
      const rows = await admin<{ relname: string; relforcerowsecurity: boolean }[]>`
        select relname, relforcerowsecurity from pg_class
        where relname = any(array['tenants', 'tenant_memberships', 'devices', 'app_sessions', 'security_audit_events'])
        order by relname
      `;
      expect(rows).toHaveLength(5);
      expect(rows.every(({ relforcerowsecurity }) => relforcerowsecurity)).toBe(true);
    } finally { await admin.end(); }
  });
});
