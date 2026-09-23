import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthIdentity } from '../auth/types.js';
import type { VerifyAccessToken } from '../auth/verifier.js';
import type { Database } from '../database/client.js';
import { resolveActiveSession } from '../database/tenant-transaction.js';

declare module 'fastify' {
  interface FastifyRequest {
    identity: AuthIdentity;
    coachSession: { id: string; tenantId: string };
  }
}

export function authenticate(verify: VerifyAccessToken, database: Database) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return reply.code(401).send({ code: 'authentication_required', requestId: request.id });
    try {
      const identity = await verify(authorization.slice(7));
      const session = await resolveActiveSession(database, identity.userId, identity.authSessionId);
      if (!session) return reply.code(401).send({ code: 'session_inactive', requestId: request.id });
      request.identity = identity;
      request.coachSession = { id: session.id, tenantId: session.tenant_id };
    } catch {
      return reply.code(401).send({ code: 'invalid_access_token', requestId: request.id });
    }
  };
}
