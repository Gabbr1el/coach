import { randomUUID } from 'node:crypto';
import type { AuthBoundary } from '../auth/types.js';
import type { Database } from '../database/client.js';

interface RevocationJob {
  id: string;
  app_session_id: string;
  tenant_id: string;
  user_id: string;
  auth_session_id: string;
  reason: string;
  attempts: number;
}

export class RevocationOutboxWorker {
  constructor(private readonly database: Database, private readonly auth: AuthBoundary) {}

  async processOne(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;
    try {
      await this.auth.revokeSession(job.user_id, job.auth_session_id);
      await this.database.begin(async (transaction) => {
        await transaction`update provider_revocation_outbox set status = 'completed', completed_at = now(), locked_at = null, last_error_code = null where id = ${job.id}::uuid and status = 'processing'`;
        await transaction`select record_security_audit_event(${randomUUID()}::uuid, ${job.tenant_id}::uuid, ${job.user_id}::uuid, ${job.app_session_id}::uuid, 'provider.session_revoked', 'success', ${transaction.json({ outboxId: job.id, reason: job.reason, attempts: job.attempts })})`;
      });
    } catch {
      const delaySeconds = Math.min(300, 2 ** Math.min(job.attempts, 8));
      await this.database.begin(async (transaction) => {
        await transaction`update provider_revocation_outbox set status = 'pending', next_attempt_at = now() + (${delaySeconds} * interval '1 second'), locked_at = null, last_error_code = 'provider_revoke_failed' where id = ${job.id}::uuid and status = 'processing'`;
        await transaction`select record_security_audit_event(${randomUUID()}::uuid, ${job.tenant_id}::uuid, ${job.user_id}::uuid, ${job.app_session_id}::uuid, 'provider.session_revoked', 'retry', ${transaction.json({ outboxId: job.id, reason: job.reason, attempts: job.attempts })})`;
      });
    }
    return true;
  }

  async drain(limit = 100): Promise<number> {
    let processed = 0;
    while (processed < limit && await this.processOne()) processed++;
    return processed;
  }

  private async claim(): Promise<RevocationJob | undefined> {
    return this.database.begin(async (transaction) => {
      const [job] = await transaction<RevocationJob[]>`
        select id, app_session_id, tenant_id, user_id, auth_session_id, reason, attempts
        from provider_revocation_outbox
        where status <> 'completed' and next_attempt_at <= now()
          and (status = 'pending' or locked_at < now() - interval '5 minutes')
        order by created_at for update skip locked limit 1
      `;
      if (!job) return undefined;
      await transaction`update provider_revocation_outbox set status = 'processing', locked_at = now(), attempts = attempts + 1 where id = ${job.id}::uuid`;
      return { ...job, attempts: job.attempts + 1 };
    }).then((job) => job);
  }
}
