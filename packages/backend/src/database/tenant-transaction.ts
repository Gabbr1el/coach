import type { TransactionSql } from 'postgres';
import type { Database } from './client.js';

export interface TenantContext {
  userId: string;
  tenantId: string;
  sessionId: string;
}

export type TenantTransaction = TransactionSql<Record<string, never>>;

export async function withTenantTransaction<T>(
  database: Database,
  context: TenantContext,
  operation: (transaction: TenantTransaction) => Promise<T>
): Promise<T> {
  return database.begin(async (transaction) => {
    await transaction`select set_config('coach.user_id', ${context.userId}, true), set_config('coach.tenant_id', ${context.tenantId}, true), set_config('coach.session_id', ${context.sessionId}, true)`;
    const [settings] = await transaction<{ user_id: string; tenant_id: string; session_id: string }[]>`
      select current_setting('coach.user_id', true) as user_id,
             current_setting('coach.tenant_id', true) as tenant_id,
             current_setting('coach.session_id', true) as session_id
    `;
    if (settings?.user_id !== context.userId || settings.tenant_id !== context.tenantId || settings.session_id !== context.sessionId) {
      throw new Error('tenant_context_not_applied');
    }
    return [await operation(transaction)];
  }).then(([result]) => result as T);
}

export async function resolveActiveSession(database: Database, userId: string, authSessionId: string) {
  return database.begin(async (transaction) => {
    await transaction`select set_config('coach.user_id', ${userId}, true), set_config('coach.session_id', ${authSessionId}, true), set_config('coach.tenant_id', '', true)`;
    const [session] = await transaction<{
      id: string;
      tenant_id: string;
      user_id: string;
      auth_session_id: string;
    }[]>`
      select app_session_id as id, tenant_id, resolved_user_id as user_id, resolved_auth_session_id as auth_session_id
      from resolve_active_app_session(${userId}::uuid, ${authSessionId}::uuid)
    `;
    return session;
  });
}
