import { createHash, randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK } from 'jose';
import type { AuthBoundary, AuthTokens, SignupResult } from './types.js';

interface UserRecord { id: string; email: string; passwordHash: string; verified: boolean }
interface RefreshRecord { userId: string; sessionId: string; generation: number; revoked: boolean }

export class LocalTestAuthBoundary implements AuthBoundary {
  private readonly users = new Map<string, UserRecord>();
  private readonly verificationCodes = new Map<string, string>();
  private readonly recoveryCodes = new Map<string, string>();
  private readonly refreshTokens = new Map<string, RefreshRecord>();
  private constructor(
    private readonly issuer: string,
    private readonly audience: string,
    private readonly privateKey: CryptoKey,
    private readonly publicJwk: JWK
  ) {}

  static async create(issuer: string, audience: string): Promise<LocalTestAuthBoundary> {
    const keys = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const jwk = await exportJWK(keys.publicKey);
    return new LocalTestAuthBoundary(issuer, audience, keys.privateKey, { ...jwk, kid: 'coach-local-test', alg: 'RS256', use: 'sig' });
  }

  jwks(): { keys: JWK[] } { return { keys: [this.publicJwk] }; }

  latestVerificationCode(email: string): string | undefined { return this.verificationCodes.get(normalize(email)); }
  latestRecoveryCode(email: string): string | undefined { return this.recoveryCodes.get(normalize(email)); }

  async signup(email: string, password: string): Promise<SignupResult> {
    const normalized = normalize(email);
    if (!this.users.has(normalized)) {
      this.users.set(normalized, { id: randomUUID(), email: normalized, passwordHash: hash(password), verified: false });
    }
    this.verificationCodes.set(normalized, deterministicCode('verify', normalized));
    return { status: 'verification_required' };
  }

  async verify(code: string): Promise<AuthTokens> {
    const email = [...this.verificationCodes].find(([, candidate]) => candidate === code)?.[0];
    if (!email) throw new Error('invalid_or_used_code');
    const user = this.users.get(email)!;
    user.verified = true;
    this.verificationCodes.delete(email);
    return this.issue(user);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = this.users.get(normalize(email));
    if (!user || user.passwordHash !== hash(password) || !user.verified) throw new Error('invalid_credentials');
    return this.issue(user);
  }

  async requestPasswordReset(email: string): Promise<{ state: string }> {
    const normalized = normalize(email);
    if (this.users.has(normalized)) this.recoveryCodes.set(normalized, deterministicCode('recover', normalized));
    return { state: deterministicCode('state', normalized) };
  }

  async resetPassword(_state: string, code: string, password: string): Promise<void> {
    const email = [...this.recoveryCodes].find(([, candidate]) => candidate === code)?.[0];
    if (!email) throw new Error('invalid_or_used_code');
    const user = this.users.get(email)!;
    user.passwordHash = hash(password);
    this.recoveryCodes.delete(email);
    await this.revokeAll(user.id);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const record = this.refreshTokens.get(refreshToken);
    if (!record || record.revoked) {
      if (record) await this.revokeSession(record.userId, record.sessionId);
      throw new Error('refresh_reuse_detected');
    }
    record.revoked = true;
    const user = [...this.users.values()].find((candidate) => candidate.id === record.userId)!;
    return this.issue(user, record.sessionId, record.generation + 1);
  }

  async healthcheck(): Promise<void> {}
  async isEmailConfirmed(accessToken: string): Promise<boolean> {
    const { payload } = await jwtVerify(accessToken, this.privateKey);
    return typeof payload.email_confirmed_at === 'string';
  }

  async revokeSession(_userId: string, authSessionId: string): Promise<void> {
    for (const record of this.refreshTokens.values()) if (record.sessionId === authSessionId) record.revoked = true;
  }

  async revokeAll(userId: string): Promise<void> {
    for (const record of this.refreshTokens.values()) if (record.userId === userId) record.revoked = true;
  }

  private async issue(user: UserRecord, sessionId: string = randomUUID(), generation = 0): Promise<AuthTokens> {
    const refreshToken = randomUUID();
    this.refreshTokens.set(refreshToken, { userId: user.id, sessionId, generation, revoked: false });
    const accessToken = await new SignJWT({ session_id: sessionId, email_confirmed_at: user.verified ? '2026-01-01T00:00:00.000Z' : null })
      .setProtectedHeader({ alg: 'RS256', kid: 'coach-local-test' })
      .setIssuer(this.issuer).setAudience(this.audience).setSubject(user.id)
      .setIssuedAt().setExpirationTime('15m').sign(this.privateKey);
    return { accessToken, refreshToken, expiresIn: 900 };
  }

  async inspect(accessToken: string): Promise<void> { await jwtVerify(accessToken, this.privateKey); }
}

function normalize(value: string): string { return value.trim().toLowerCase(); }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function deterministicCode(kind: string, email: string): string { return createHash('sha256').update(`${kind}:${email}`).digest('hex').slice(0, 24); }
