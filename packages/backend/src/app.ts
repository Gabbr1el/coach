import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { AuthBoundary } from './auth/types.js';
import type { VerifyAccessToken } from './auth/verifier.js';
import type { AppConfig } from './config.js';
import type { Database } from './database/client.js';
import { authenticate } from './http/authenticate.js';
import { AccountService } from './services/account-service.js';
import { ackSchema, bootstrapPageSchema, bootstrapSchema, pullSchema, pushSchema, retentionSchema } from './sync/contracts.js';
import { SyncError } from './sync/errors.js';
import { SyncService } from './sync/service.js';

const provisionBody = z.object({
  deviceId: z.string().uuid(),
  deviceLabel: z.string().trim().min(1).max(120),
  platform: z.enum(['linux', 'windows', 'macos']),
  appVersion: z.string().trim().min(1).max(40)
});
const sessionParams = z.object({ sessionId: z.string().uuid() });
const reconciliationBody = z.object({
  eventId: z.string().min(1).max(200),
  userId: z.string().uuid(),
  authSessionId: z.string().uuid().optional(),
  reason: z.enum(['password_recovery', 'refresh_reuse', 'provider_logout', 'admin_revoke'])
});

export function buildApp(dependencies: { config: AppConfig; database: Database; auth: AuthBoundary; verifyAccessToken: VerifyAccessToken }) {
  const app = Fastify({
    logger: {
      level: dependencies.config.LOG_LEVEL,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.refreshToken', 'res.headers.set-cookie'],
        censor: '[REDACTED]'
      }
    },
    genReqId: (request) => typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : crypto.randomUUID(),
    trustProxy: dependencies.config.TRUST_PROXY_HOPS > 0
  });
  const account = new AccountService(dependencies.database, dependencies.auth);
  const sync = new SyncService(dependencies.database, dependencies.config.SYNC_CURSOR_SECRET, dependencies.config.SYNC_BOOTSTRAP_TTL_SECONDS, dependencies.config.SYNC_MAX_OFFLINE_MUTATION_AGE_DAYS);
  const requireSession = authenticate(dependencies.verifyAccessToken, dependencies.database);
  const context = (request: { identity: { userId: string }; coachSession: { id: string; tenantId: string; deviceId: string } }) => ({
    userId: request.identity.userId, tenantId: request.coachSession.tenantId, sessionId: request.coachSession.id, deviceId: request.coachSession.deviceId
  });

  void app.register(rateLimit, {
    global: true,
    max: dependencies.config.RATE_LIMIT_MAX,
    timeWindow: dependencies.config.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => request.ip
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/v1/sync/capabilities', { preHandler: requireSession }, async () => sync.capabilities());
  app.get('/ready', async (_request, reply) => {
    try {
      const [schema] = await dependencies.database<{ app_sessions: string | null; migrations: string | null; sync_changes: string | null }[]>`select to_regclass('public.app_sessions') as app_sessions, to_regclass('public.coach_migrations') as migrations, to_regclass('public.sync_changes') as sync_changes`;
      if (!schema?.app_sessions || !schema.migrations || !schema.sync_changes) throw new Error('schema_not_ready');
      if (dependencies.config.AUTH_JWT_MODE === 'asymmetric') {
        const response = await fetch(dependencies.config.AUTH_JWKS_URL!, { method: 'GET', signal: AbortSignal.timeout(3_000) });
        if (!response.ok) throw new Error('jwks_not_ready');
      }
      await dependencies.auth.healthcheck();
      return { status: 'ready' };
    }
    catch { return reply.code(503).send({ status: 'not_ready' }); }
  });

  app.post('/internal/security/reconcile', {
    config: { rateLimit: { max: dependencies.config.SECURITY_WEBHOOK_RATE_LIMIT_MAX, timeWindow: dependencies.config.RATE_LIMIT_WINDOW } },
    preHandler: async (request, reply) => {
      const expected = dependencies.config.SECURITY_RECONCILIATION_WEBHOOK_SECRET;
      if (!expected || request.headers.authorization !== `Bearer ${expected}`) return reply.code(401).send({ code: 'authentication_required', requestId: request.id });
    }
  }, async (request) => {
    const body = reconciliationBody.parse(request.body);
    return account.reconcileSecurityEvent({
      eventId: body.eventId,
      userId: body.userId,
      reason: body.reason,
      ...(body.authSessionId ? { authSessionId: body.authSessionId } : {})
    });
  });

  app.post('/v1/account/provision', { config: { rateLimit: { max: dependencies.config.AUTH_RATE_LIMIT_MAX, timeWindow: dependencies.config.RATE_LIMIT_WINDOW } }, preHandler: async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return reply.code(401).send({ code: 'authentication_required', requestId: request.id });
    try {
      const token = authorization.slice(7);
      request.identity = await dependencies.verifyAccessToken(token);
      if (!await dependencies.auth.isEmailConfirmed(token)) return reply.code(403).send({ code: 'email_verification_required', requestId: request.id });
    }
    catch { return reply.code(401).send({ code: 'invalid_access_token', requestId: request.id }); }
  } }, async (request, reply) => {
    const body = provisionBody.parse(request.body);
    const result = await account.provision({ ...body, userId: request.identity.userId, authSessionId: request.identity.authSessionId });
    return reply.code(201).send(result);
  });

  app.get('/v1/account/sessions', { preHandler: requireSession }, async (request) => ({ sessions: await account.listSessions(context(request)) }));
  app.delete('/v1/account/sessions/:sessionId', { preHandler: requireSession }, async (request, reply) => {
    const { sessionId } = sessionParams.parse(request.params);
    await account.revokeSession(context(request), sessionId, 'user_revoked');
    return reply.code(204).send();
  });
  app.post('/v1/account/sessions/revoke-others', { preHandler: requireSession }, async (request, reply) => {
    await account.revokeOthers(context(request)); return reply.code(204).send();
  });
  app.post('/v1/account/logout', { preHandler: requireSession }, async (request, reply) => {
    await account.revokeSession(context(request), request.coachSession.id, 'logout'); return reply.code(204).send();
  });
  app.post('/v1/account/logout-all', { preHandler: requireSession }, async (request, reply) => {
    await account.logoutAll(context(request)); return reply.code(204).send();
  });

  app.post('/v1/sync/push', { preHandler: requireSession }, async (request) => sync.push(context(request), pushSchema.parse(request.body)));
  app.get('/v1/sync/pull', { preHandler: requireSession }, async (request) => {
    const input = pullSchema.parse(request.query);
    return sync.pull(context(request), { protocolVersion: input.protocolVersion, deviceId: input.deviceId, limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) });
  });
  app.post('/v1/sync/ack', { preHandler: requireSession }, async (request, reply) => {
    await sync.acknowledge(context(request), ackSchema.parse(request.body));
    return reply.code(204).send();
  });
  app.post('/v1/sync/bootstrap', { preHandler: requireSession }, async (request, reply) => reply.code(201).send(await sync.bootstrap(context(request), bootstrapSchema.parse(request.body))));
  app.get('/v1/sync/bootstrap/page', { preHandler: requireSession }, async (request) => sync.bootstrapPage(context(request), bootstrapPageSchema.parse(request.query)));
  app.post('/v1/sync/retention/run', { preHandler: requireSession }, async (request) => sync.runRetention(context(request), retentionSchema.parse(request.body)));

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ err: error, requestId: request.id }, 'request failed');
    if (error instanceof SyncError) return reply.code(error.statusCode).send({ code: error.code, ...error.details, requestId: request.id });
    const invalid = error instanceof z.ZodError;
    return reply.code(invalid ? 400 : 500).send({ code: invalid ? 'invalid_request' : 'internal_error', requestId: request.id });
  });
  return app;
}
