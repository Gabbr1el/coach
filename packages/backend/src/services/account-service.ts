import { createHash, randomUUID } from 'node:crypto';
import type { AuthBoundary } from '../auth/types.js';
import type { Database } from '../database/client.js';
import { withTenantTransaction, type TenantContext, type TenantTransaction } from '../database/tenant-transaction.js';
import { RevocationOutboxWorker } from './revocation-outbox.js';

export class AccountService {
  constructor(private readonly database: Database, private readonly auth: AuthBoundary) {}

  async provision(input: {
    userId: string;
    authSessionId: string;
    deviceId: string;
    deviceLabel: string;
    platform: string;
    appVersion: string;
  }) {
    return this.database.begin(async (transaction) => {
      await transaction`select set_config('coach.user_id', ${input.userId}, true), set_config('coach.session_id', ${input.authSessionId}, true)`;
      const tenantId = personalTenantId(input.userId);
      await transaction`select set_config('coach.tenant_id', ${tenantId}, true)`;
      const [createdTenant] = await transaction<{ id: string }[]>`
        insert into tenants (id, kind, name, personal_owner_user_id)
        values (${tenantId}, 'personal', 'Pessoal', ${input.userId}::uuid)
        on conflict (personal_owner_user_id) do nothing
        returning id
      `;
      const tenant = createdTenant ?? (await transaction<{ id: string }[]>`select id from tenants where personal_owner_user_id = ${input.userId}::uuid`)[0];
      if (!tenant) throw new Error('tenant_provision_failed');
      await transaction`select set_config('coach.tenant_id', ${tenant.id}, true)`;
      await transaction`insert into profiles (user_id) values (${input.userId}::uuid) on conflict do nothing`;
      await transaction`
        insert into tenant_memberships (tenant_id, user_id, role, status)
        values (${tenant.id}::uuid, ${input.userId}::uuid, 'owner', 'active') on conflict do nothing
      `;
      await transaction`
        insert into devices (id, tenant_id, user_id, label, platform, app_version)
        values (${input.deviceId}::uuid, ${tenant.id}::uuid, ${input.userId}::uuid, ${input.deviceLabel}, ${input.platform}, ${input.appVersion})
        on conflict (id) do update set label = excluded.label, platform = excluded.platform, app_version = excluded.app_version, last_seen_at = now()
      `;
      const appSessionId = randomUUID();
      await transaction`
        insert into app_sessions (id, tenant_id, user_id, device_id, auth_session_id, last_seen_version)
        values (${appSessionId}, ${tenant.id}::uuid, ${input.userId}::uuid, ${input.deviceId}::uuid, ${input.authSessionId}::uuid, ${input.appVersion})
        on conflict (user_id, auth_session_id) do update set device_id = excluded.device_id, last_seen_version = excluded.last_seen_version, last_seen_at = now()
      `;
      const [session] = await transaction<{ id: string }[]>`select id from app_sessions where user_id = ${input.userId}::uuid and auth_session_id = ${input.authSessionId}::uuid`;
      return { tenantId: tenant.id, sessionId: session!.id };
    });
  }

  async listSessions(context: TenantContext) {
    return withTenantTransaction(this.database, context, async (transaction) => transaction<{
      id: string; device_id: string; device_label: string; platform: string; app_version: string; last_seen_at: Date; revoked_at: Date | null;
    }[]>`
      select s.id, s.device_id, d.label as device_label, d.platform, s.last_seen_version as app_version, s.last_seen_at, s.revoked_at
      from app_sessions s join devices d on d.tenant_id = s.tenant_id and d.id = s.device_id
       where s.user_id = ${context.userId}::uuid and s.tenant_id = ${context.tenantId}::uuid order by s.last_seen_at desc
    `);
  }

  async revokeSession(context: TenantContext, sessionId: string, reason: string) {
    await withTenantTransaction(this.database, context, async (transaction) => {
      const [target] = await transaction<{ auth_session_id: string }[]>`update app_sessions set revoked_at = coalesce(revoked_at, now()), revocation_reason = coalesce(revocation_reason, ${reason}) where id = ${sessionId}::uuid and tenant_id = ${context.tenantId}::uuid and user_id = ${context.userId}::uuid returning auth_session_id`;
      if (!target) throw new Error('session_not_found');
      await enqueueRevocation(transaction, { appSessionId: sessionId, tenantId: context.tenantId, userId: context.userId, authSessionId: target.auth_session_id, reason });
      await transaction`insert into security_audit_events (id, tenant_id, user_id, session_id, type, outcome, metadata) values (${randomUUID()}, ${context.tenantId}::uuid, ${context.userId}::uuid, ${context.sessionId}::uuid, 'session.revocation_enqueued', 'success', ${transaction.json({ targetSessionId: sessionId, reason })})`;
    });
    await new RevocationOutboxWorker(this.database, this.auth).drain(1);
  }

  async revokeOthers(context: TenantContext) {
    await withTenantTransaction(this.database, context, async (transaction) => {
      const targets = await transaction<{ id: string; auth_session_id: string }[]>`update app_sessions set revoked_at = now(), revocation_reason = 'revoke_others' where tenant_id = ${context.tenantId}::uuid and user_id = ${context.userId}::uuid and id <> ${context.sessionId}::uuid and revoked_at is null returning id, auth_session_id`;
      for (const target of targets) await enqueueRevocation(transaction, { appSessionId: target.id, tenantId: context.tenantId, userId: context.userId, authSessionId: target.auth_session_id, reason: 'revoke_others' });
      await transaction`insert into security_audit_events (id, tenant_id, user_id, session_id, type, outcome, metadata) values (${randomUUID()}, ${context.tenantId}::uuid, ${context.userId}::uuid, ${context.sessionId}::uuid, 'session.revoke_others_enqueued', 'success', ${transaction.json({ count: targets.length })})`;
    });
    await new RevocationOutboxWorker(this.database, this.auth).drain();
  }

  async logoutAll(context: TenantContext) {
    await withTenantTransaction(this.database, context, async (transaction) => {
      const targets = await transaction<{ revoked_app_session_id: string; revoked_tenant_id: string; revoked_auth_session_id: string }[]>`
        select * from revoke_all_app_sessions(${context.userId}::uuid, ${context.sessionId}::uuid, 'logout_all')
      `;
      await transaction`insert into security_audit_events (id, tenant_id, user_id, session_id, type, outcome, metadata) values (${randomUUID()}, ${context.tenantId}::uuid, ${context.userId}::uuid, ${context.sessionId}::uuid, 'session.logout_all_enqueued', 'success', ${transaction.json({ count: targets.length })})`;
    });
    await new RevocationOutboxWorker(this.database, this.auth).drain();
  }

  async reconcileSecurityEvent(input: { eventId: string; userId: string; authSessionId?: string; reason: string }) {
    const [result] = await this.database<{ applied: boolean }[]>`
      select reconcile_auth_security_event(
        ${input.eventId}, ${input.userId}::uuid, ${input.authSessionId ?? null}::uuid, ${input.reason}
      ) as applied
    `;
    return { duplicate: !result?.applied };
  }
}

async function enqueueRevocation(transaction: TenantTransaction, input: { appSessionId: string; tenantId: string; userId: string; authSessionId: string; reason: string }) {
  await transaction`
    insert into provider_revocation_outbox (id, app_session_id, tenant_id, user_id, auth_session_id, reason)
    values (${randomUUID()}, ${input.appSessionId}::uuid, ${input.tenantId}::uuid, ${input.userId}::uuid, ${input.authSessionId}::uuid, ${input.reason})
    on conflict (app_session_id) do nothing
  `;
}

function personalTenantId(userId: string): string {
  const bytes = createHash('sha256').update(`coach:personal-tenant:${userId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
