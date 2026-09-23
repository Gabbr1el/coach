import { z } from 'zod';

const booleanFromEnv = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_WINDOW: z.string().min(2).default('1 minute'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  SECURITY_WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),
  DATABASE_URL: z.string().url(),
  AUTH_MODE: z.enum(['supabase', 'test']).default('supabase'),
  AUTH_JWT_MODE: z.enum(['asymmetric', 'legacy-hs256']).default('asymmetric'),
  AUTH_ISSUER: z.string().url(),
  AUTH_AUDIENCE: z.string().min(1).default('authenticated'),
  AUTH_JWKS_URL: z.string().url().optional(),
  AUTH_JWT_LEGACY_SECRET: z.string().min(32).optional(),
  AUTH_SESSION_CLAIM: z.string().min(1).default('session_id'),
  AUTH_SESSION_CLAIM_VERIFIED_IMMUTABLE: booleanFromEnv.default(false),
  AUTH_PUBLIC_URL: z.string().url(),
  AUTH_PUBLIC_KEY: z.string().min(1),
  AUTH_ADMIN_KEY: z.string().min(1).optional(),
  AUTH_SESSION_REVOKE_URL: z.string().url().optional(),
  AUTH_SESSION_REVOKE_KEY: z.string().min(32).optional(),
  AUTH_SESSION_REVOKE_MODE: z.enum(['exact-session', 'user-global']).default('exact-session'),
  REVOCATION_WORKER_INTERVAL_MS: z.coerce.number().int().min(100).default(5_000),
  SECURITY_RECONCILIATION_WEBHOOK_SECRET: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && value.AUTH_MODE === 'test') {
    context.addIssue({ code: 'custom', path: ['AUTH_MODE'], message: 'test auth is forbidden in production' });
  }
  if (value.AUTH_JWT_MODE === 'asymmetric' && !value.AUTH_JWKS_URL) {
    context.addIssue({ code: 'custom', path: ['AUTH_JWKS_URL'], message: 'required for asymmetric JWT verification' });
  }
  if (value.AUTH_JWT_MODE === 'legacy-hs256' && (!value.AUTH_JWT_LEGACY_SECRET || value.NODE_ENV === 'production')) {
    context.addIssue({ code: 'custom', path: ['AUTH_JWT_MODE'], message: 'legacy HS256 is allowed only in explicit local development or test mode with a secret' });
  }
  if (value.NODE_ENV === 'production') {
    if (value.AUTH_JWT_MODE !== 'asymmetric') context.addIssue({ code: 'custom', path: ['AUTH_JWT_MODE'], message: 'production requires asymmetric JWKS verification' });
    if (!value.AUTH_SESSION_REVOKE_URL || new URL(value.AUTH_SESSION_REVOKE_URL).protocol !== 'https:') context.addIssue({ code: 'custom', path: ['AUTH_SESSION_REVOKE_URL'], message: 'production requires an HTTPS exact-session revoke endpoint' });
    if (!value.AUTH_SESSION_REVOKE_KEY) context.addIssue({ code: 'custom', path: ['AUTH_SESSION_REVOKE_KEY'], message: 'production requires an authenticated revoke adapter' });
    if (!value.AUTH_SESSION_CLAIM_VERIFIED_IMMUTABLE) context.addIssue({ code: 'custom', path: ['AUTH_SESSION_CLAIM_VERIFIED_IMMUTABLE'], message: 'production requires a verified immutable session claim' });
    if (!value.SECURITY_RECONCILIATION_WEBHOOK_SECRET) context.addIssue({ code: 'custom', path: ['SECURITY_RECONCILIATION_WEBHOOK_SECRET'], message: 'production requires the security reconciliation webhook' });
    if (value.TRUST_PROXY_HOPS < 1) context.addIssue({ code: 'custom', path: ['TRUST_PROXY_HOPS'], message: 'production requires an explicit trusted proxy hop count' });
    for (const key of ['AUTH_ISSUER', 'AUTH_JWKS_URL', 'AUTH_PUBLIC_URL', 'AUTH_SESSION_REVOKE_URL'] as const) {
      const candidate = value[key];
      if (!candidate || new URL(candidate).protocol !== 'https:') context.addIssue({ code: 'custom', path: [key], message: 'production auth URLs must use HTTPS' });
    }
    if (value.AUTH_SESSION_REVOKE_MODE !== 'exact-session') context.addIssue({ code: 'custom', path: ['AUTH_SESSION_REVOKE_MODE'], message: 'production requires verified exact-session revocation' });
  } else {
    for (const key of ['AUTH_ISSUER', 'AUTH_JWKS_URL', 'AUTH_PUBLIC_URL', 'AUTH_SESSION_REVOKE_URL'] as const) {
      const candidate = value[key];
      if (candidate && !isHttpsOrLoopback(candidate)) context.addIssue({ code: 'custom', path: [key], message: 'HTTP auth URLs are allowed only on loopback outside production' });
    }
  }
  if (value.AUTH_MODE === 'supabase' && !value.AUTH_ADMIN_KEY) {
    context.addIssue({ code: 'custom', path: ['AUTH_ADMIN_KEY'], message: 'required for production auth administration' });
  }
  if (value.AUTH_MODE === 'supabase' && value.AUTH_SESSION_REVOKE_URL && !value.AUTH_SESSION_REVOKE_KEY) {
    context.addIssue({ code: 'custom', path: ['AUTH_SESSION_REVOKE_KEY'], message: 'required when a revoke adapter URL is configured' });
  }
});

function isHttpsOrLoopback(value: string): boolean {
  const url = new URL(value);
  return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname));
}

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(environment);
}
