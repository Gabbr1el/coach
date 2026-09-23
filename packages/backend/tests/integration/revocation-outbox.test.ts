import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthBoundary, AuthTokens, SignupResult } from '../../src/auth/types.js';
import { createDatabase, type Database } from '../../src/database/client.js';
import { resolveActiveSession } from '../../src/database/tenant-transaction.js';
import { AccountService } from '../../src/services/account-service.js';
import { RevocationOutboxWorker } from '../../src/services/revocation-outbox.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

class FailingAuth implements AuthBoundary {
  calls = 0;
  shouldFail = true;
  async signup(): Promise<SignupResult> { throw new Error('unused'); }
  async verify(): Promise<AuthTokens> { throw new Error('unused'); }
  async login(): Promise<AuthTokens> { throw new Error('unused'); }
  async requestPasswordReset(): Promise<{ state: string }> { throw new Error('unused'); }
  async resetPassword(): Promise<void> { throw new Error('unused'); }
  async refresh(): Promise<AuthTokens> { throw new Error('unused'); }
  async healthcheck(): Promise<void> {}
  async isEmailConfirmed(): Promise<boolean> { return true; }
  async revokeSession(): Promise<void> { this.calls++; if (this.shouldFail) throw new Error('provider unavailable'); }
  async revokeAll(): Promise<void> { throw new Error('unused'); }
}

describeDatabase('durable fail-closed provider revocation', () => {
  let database: Database;
  const userId = randomUUID();
  const tenantId = randomUUID();
  const deviceId = randomUUID();
  const appSessionId = randomUUID();
  const authSessionId = randomUUID();
  const auth = new FailingAuth();

  beforeAll(async () => {
    database = createDatabase(databaseUrl!, 2);
    const admin = createDatabase(process.env.MIGRATION_DATABASE_URL ?? databaseUrl!, 1);
    try {
      await admin`insert into tenants (id, kind, name, personal_owner_user_id) values (${tenantId}, 'personal', 'outbox', ${userId})`;
      await admin`insert into tenant_memberships (tenant_id, user_id, role) values (${tenantId}, ${userId}, 'owner')`;
      await admin`insert into devices (id, tenant_id, user_id, label, platform, app_version) values (${deviceId}, ${tenantId}, ${userId}, 'device', 'linux', 'test')`;
      await admin`insert into app_sessions (id, tenant_id, user_id, device_id, auth_session_id, last_seen_version) values (${appSessionId}, ${tenantId}, ${userId}, ${deviceId}, ${authSessionId}, 'test')`;
    } finally { await admin.end(); }
  });

  afterAll(async () => database.end());

  it('denies access and persists retry work even when provider revocation fails', async () => {
    const account = new AccountService(database, auth);
    await account.revokeSession({ userId, tenantId, sessionId: appSessionId }, appSessionId, 'test_failure');
    expect(await resolveActiveSession(database, userId, authSessionId)).toBeUndefined();
    const [job] = await database<{ status: string; attempts: number; last_error_code: string }[]>`select status, attempts, last_error_code from provider_revocation_outbox where app_session_id = ${appSessionId}`;
    expect(job).toMatchObject({ status: 'pending', attempts: 1, last_error_code: 'provider_revoke_failed' });
  });

  it('recovers after restart and completes the same idempotent outbox row', async () => {
    auth.shouldFail = false;
    await database`update provider_revocation_outbox set next_attempt_at = now(), locked_at = null where app_session_id = ${appSessionId}`;
    const restartedWorker = new RevocationOutboxWorker(database, auth);
    expect(await restartedWorker.drain()).toBe(1);
    expect(await restartedWorker.drain()).toBe(0);
    const [job] = await database<{ status: string; attempts: number }[]>`select status, attempts from provider_revocation_outbox where app_session_id = ${appSessionId}`;
    expect(job).toMatchObject({ status: 'completed', attempts: 2 });
    expect(auth.calls).toBe(2);
  });

  it('revokes the authenticated user across two tenants without permitting a different user', async () => {
    const admin = createDatabase(process.env.MIGRATION_DATABASE_URL ?? databaseUrl!, 1);
    const globalUser = randomUUID();
    const attacker = randomUUID();
    const tenantA = randomUUID(); const tenantB = randomUUID(); const attackerTenant = randomUUID();
    const deviceA = randomUUID(); const deviceB = randomUUID(); const attackerDevice = randomUUID();
    const sessionA = randomUUID(); const sessionB = randomUUID(); const attackerSession = randomUUID();
    const authA = randomUUID(); const authB = randomUUID(); const attackerAuth = randomUUID();
    try {
      await admin`insert into tenants (id, kind, name, personal_owner_user_id) values (${tenantA}, 'personal', 'A', ${globalUser}), (${tenantB}, 'organization', 'B', null), (${attackerTenant}, 'personal', 'attacker', ${attacker})`;
      await admin`insert into tenant_memberships (tenant_id, user_id, role) values (${tenantA}, ${globalUser}, 'owner'), (${tenantB}, ${globalUser}, 'member'), (${attackerTenant}, ${attacker}, 'owner')`;
      await admin`insert into devices (id, tenant_id, user_id, label, platform, app_version) values (${deviceA}, ${tenantA}, ${globalUser}, 'A', 'linux', 'test'), (${deviceB}, ${tenantB}, ${globalUser}, 'B', 'linux', 'test'), (${attackerDevice}, ${attackerTenant}, ${attacker}, 'attacker', 'linux', 'test')`;
      await admin`insert into app_sessions (id, tenant_id, user_id, device_id, auth_session_id, last_seen_version) values (${sessionA}, ${tenantA}, ${globalUser}, ${deviceA}, ${authA}, 'test'), (${sessionB}, ${tenantB}, ${globalUser}, ${deviceB}, ${authB}, 'test'), (${attackerSession}, ${attackerTenant}, ${attacker}, ${attackerDevice}, ${attackerAuth}, 'test')`;
    } finally { await admin.end(); }

    auth.shouldFail = false;
    const beforeCalls = auth.calls;
    const account = new AccountService(database, auth);
    await account.logoutAll({ userId: globalUser, tenantId: tenantA, sessionId: sessionA });
    expect(await resolveActiveSession(database, globalUser, authA)).toBeUndefined();
    expect(await resolveActiveSession(database, globalUser, authB)).toBeUndefined();
    expect(await resolveActiveSession(database, attacker, attackerAuth)).toMatchObject({ id: attackerSession });
    expect(await database<{ count: string }[]>`select count(*)::text as count from provider_revocation_outbox where user_id = ${globalUser}::uuid`).toEqual([{ count: '2' }]);
    expect(await database<{ count: string }[]>`select count(*)::text as count from provider_revocation_outbox where user_id = ${globalUser}::uuid and status = 'completed'`).toEqual([{ count: '2' }]);
    expect(auth.calls - beforeCalls).toBe(2);

    await expect(database.begin(async (transaction) => {
      await transaction`select set_config('coach.user_id', ${globalUser}, true), set_config('coach.tenant_id', ${tenantA}, true), set_config('coach.session_id', ${sessionA}, true)`;
      await transaction`select * from revoke_all_app_sessions(${attacker}::uuid, ${sessionA}::uuid, 'attack')`;
    })).rejects.toThrow('unauthorized_global_revocation');
    expect(await resolveActiveSession(database, attacker, attackerAuth)).toMatchObject({ id: attackerSession });
  });
});
