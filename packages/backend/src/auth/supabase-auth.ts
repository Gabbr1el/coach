import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthBoundary, AuthFlowStateStore, AuthTokens, SignupResult } from './types.js';

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface SupabaseUser { id: string }

export class SupabaseAuthBoundary implements AuthBoundary {
  constructor(
    private readonly publicUrl: string,
    private readonly publicKey: string,
    private readonly adminKey?: string,
    private readonly sessionRevokeUrl?: string,
    private readonly sessionRevokeKey?: string,
    private readonly sessionRevokeMode: 'exact-session' | 'user-global' = 'exact-session',
    private readonly flowState?: AuthFlowStateStore,
    private readonly recoveryRedirectUrl?: string
  ) {}

  async signup(email: string, password: string): Promise<SignupResult> {
    const response = await this.request('/signup', { email, password });
    const payload = await response.json() as Partial<SupabaseSession>;
    return payload.access_token
      ? { status: 'authenticated', tokens: toTokens(payload as SupabaseSession) }
      : { status: 'verification_required' };
  }

  async verify(tokenHash: string): Promise<AuthTokens> {
    const response = await this.request('/verify', { type: 'signup', token_hash: tokenHash });
    return toTokens(await response.json() as SupabaseSession);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const response = await this.request('/token?grant_type=password', { email, password });
    return toTokens(await response.json() as SupabaseSession);
  }

  async requestPasswordReset(email: string): Promise<{ state: string }> {
    if (!this.flowState || !this.recoveryRedirectUrl) throw new Error('pkce_flow_storage_unavailable');
    const state = randomUUID();
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    await this.flowState.put(state, { codeVerifier, expiresAt: Date.now() + 10 * 60_000 });
    const redirect = new URL(this.recoveryRedirectUrl);
    redirect.searchParams.set('state', state);
    await this.request('/recover', { email, redirect_to: redirect.toString(), code_challenge: codeChallenge, code_challenge_method: 's256' });
    return { state };
  }

  async resetPassword(state: string, code: string, password: string): Promise<void> {
    const pending = await this.flowState?.take(state);
    if (!pending || pending.expiresAt < Date.now()) throw new Error('invalid_or_expired_recovery_state');
    const exchange = await this.request('/token?grant_type=pkce', { auth_code: code, code_verifier: pending.codeVerifier });
    const tokens = toTokens(await exchange.json() as SupabaseSession);
    const currentUser = await this.request('/user', undefined, tokens.accessToken);
    const { id: userId } = await currentUser.json() as SupabaseUser;
    await this.request('/user', { password }, tokens.accessToken);
    await this.revokeAll(userId);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const response = await this.request('/token?grant_type=refresh_token', { refresh_token: refreshToken });
    return toTokens(await response.json() as SupabaseSession);
  }

  async healthcheck(): Promise<void> {
    const response = await fetch(`${this.publicUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error(`auth_healthcheck_failed:${response.status}`);
  }

  async isEmailConfirmed(accessToken: string): Promise<boolean> {
    const response = await this.request('/user', undefined, accessToken);
    const user = await response.json() as { email_confirmed_at?: string; confirmed_at?: string };
    return typeof user.email_confirmed_at === 'string' || typeof user.confirmed_at === 'string';
  }

  async revokeSession(userId: string, authSessionId: string): Promise<void> {
    if (!this.sessionRevokeKey || !this.sessionRevokeUrl) throw new Error('individual_auth_revocation_unavailable');
    const target = this.sessionRevokeUrl
      .replace('{user_id}', encodeURIComponent(userId))
      .replace('{session_id}', encodeURIComponent(authSessionId));
    const response = await fetch(target, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.sessionRevokeKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, session_id: authSessionId, mode: this.sessionRevokeMode })
    });
    if (!response.ok) throw new Error(`auth_session_revoke_failed:${response.status}`);
  }

  async revokeAll(userId: string): Promise<void> {
    if (!this.adminKey) throw new Error('auth_administration_unavailable');
    const response = await fetch(`${this.publicUrl}/admin/users/${encodeURIComponent(userId)}/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.adminKey}`, apikey: this.adminKey }
    });
    if (!response.ok) throw new Error(`auth_global_revoke_failed:${response.status}`);
  }

  private async request(path: string, body?: object, accessToken?: string): Promise<Response> {
    const response = await fetch(`${this.publicUrl}${path}`, {
      method: path === '/user' ? (body ? 'PUT' : 'GET') : 'POST',
      headers: {
        apikey: this.publicKey,
        authorization: `Bearer ${accessToken ?? this.publicKey}`,
        'content-type': 'application/json'
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error(`auth_request_failed:${response.status}`);
    return response;
  }
}

function toTokens(session: SupabaseSession): AuthTokens {
  return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresIn: session.expires_in };
}
