import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { createSecretKey } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { AuthIdentity } from './types.js';

export type VerifyAccessToken = (token: string) => Promise<AuthIdentity>;

export function createAccessTokenVerifier(config: Pick<AppConfig, 'AUTH_ISSUER' | 'AUTH_AUDIENCE' | 'AUTH_JWKS_URL' | 'AUTH_JWT_MODE' | 'AUTH_JWT_LEGACY_SECRET' | 'AUTH_SESSION_CLAIM'>): VerifyAccessToken {
  const key = config.AUTH_JWT_MODE === 'legacy-hs256'
    ? createSecretKey(Buffer.from(config.AUTH_JWT_LEGACY_SECRET!, 'utf8'))
    : createRemoteJWKSet(new URL(config.AUTH_JWKS_URL!), { cooldownDuration: 5_000, timeoutDuration: 5_000 });
  return async (token) => identityFromPayload((await jwtVerify(token, key, {
    issuer: config.AUTH_ISSUER,
    audience: config.AUTH_AUDIENCE,
    algorithms: config.AUTH_JWT_MODE === 'legacy-hs256' ? ['HS256'] : ['RS256', 'ES256']
  })).payload, config.AUTH_SESSION_CLAIM);
}

export function identityFromPayload(payload: JWTPayload, sessionClaim: string): AuthIdentity {
  const sessionId = payload[sessionClaim];
  if (!payload.sub || typeof sessionId !== 'string') throw new Error('invalid_identity_claims');
  return { userId: payload.sub, authSessionId: sessionId };
}
