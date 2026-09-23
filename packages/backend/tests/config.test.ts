import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://localhost/coach',
  AUTH_ISSUER: 'https://auth.example.com',
  AUTH_AUDIENCE: 'authenticated',
  AUTH_JWKS_URL: 'https://auth.example.com/.well-known/jwks.json',
  AUTH_PUBLIC_URL: 'https://auth.example.com',
  AUTH_PUBLIC_KEY: 'public',
  AUTH_ADMIN_KEY: 'admin',
  SYNC_CURSOR_SECRET: 'x'.repeat(32)
};

describe('production auth configuration', () => {
  it('rejects legacy JWT and missing security prerequisites', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_JWT_MODE: 'legacy-hs256', AUTH_JWT_LEGACY_SECRET: 'x'.repeat(32) })).toThrow();
  });

  it('accepts asymmetric JWT only with all verified production contracts', () => {
    expect(loadConfig({
      ...base,
      NODE_ENV: 'production',
      AUTH_JWT_MODE: 'asymmetric',
      AUTH_SESSION_REVOKE_URL: 'https://auth.example.com/internal/revoke-session',
      AUTH_SESSION_REVOKE_KEY: 'x'.repeat(32),
      AUTH_SESSION_CLAIM_VERIFIED_IMMUTABLE: 'true',
      SECURITY_RECONCILIATION_WEBHOOK_SECRET: 'x'.repeat(32),
      TRUST_PROXY_HOPS: '1'
    }).AUTH_JWT_MODE).toBe('asymmetric');
  });

  it('requires HTTPS for every production auth boundary and permits loopback HTTP only outside production', () => {
    for (const key of ['AUTH_ISSUER', 'AUTH_JWKS_URL', 'AUTH_PUBLIC_URL', 'AUTH_SESSION_REVOKE_URL'] as const) {
      expect(() => loadConfig({
        ...base,
        NODE_ENV: 'production',
        AUTH_JWT_MODE: 'asymmetric',
        AUTH_SESSION_REVOKE_URL: 'https://auth.example.com/internal/revoke-session',
        AUTH_SESSION_REVOKE_KEY: 'x'.repeat(32),
        AUTH_SESSION_CLAIM_VERIFIED_IMMUTABLE: 'true',
        SECURITY_RECONCILIATION_WEBHOOK_SECRET: 'x'.repeat(32),
        TRUST_PROXY_HOPS: '1',
        [key]: 'http://auth.example.com/path'
      })).toThrow();
    }
    expect(loadConfig({ ...base, AUTH_ISSUER: 'http://127.0.0.1:9999', AUTH_PUBLIC_URL: 'http://localhost:9999' }).NODE_ENV).toBe('development');
    expect(() => loadConfig({ ...base, AUTH_ISSUER: 'http://auth.internal:9999' })).toThrow();
  });

  it('requires an offline mutation window of at least the 120-day receipt floor', () => {
    expect(() => loadConfig({ ...base, SYNC_MAX_OFFLINE_MUTATION_AGE_DAYS: '119' })).toThrow();
    expect(loadConfig({ ...base, SYNC_MAX_OFFLINE_MUTATION_AGE_DAYS: '180' }).SYNC_MAX_OFFLINE_MUTATION_AGE_DAYS).toBe(180);
  });
});
