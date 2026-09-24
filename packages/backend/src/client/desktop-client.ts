import type { AuthTokens } from '../auth/types.js';

export interface DesktopSessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface DesktopAuthClient {
  signup(email: string, password: string, state?: string): Promise<{ status: 'verification_required' } | { status: 'authenticated'; tokens: DesktopSessionTokens }>;
  verify(tokenHash: string): Promise<DesktopSessionTokens>;
  login(email: string, password: string): Promise<DesktopSessionTokens>;
  recover(email: string, state: string, challenge: string): Promise<void>;
  exchangeRecovery(code: string, verifier: string): Promise<DesktopSessionTokens>;
  updatePassword(accessToken: string, password: string): Promise<void>;
  reserveRefresh(accessToken: string, requestId: string, refreshToken: string, recoverySecret: string): Promise<{ capability: string; expiresAt: string }>;
  recoverReservation(requestId: string, refreshToken: string, recoverySecret: string): Promise<{ capability: string; expiresAt: string }>;
  executeRefresh(requestId: string, refreshToken: string, capability: string): Promise<DesktopSessionTokens>;
}

export interface CloudResponseError extends Error { status: number; code: string }

export class CoachDesktopCloudClient implements DesktopAuthClient {
  constructor(private readonly authUrl: string, private readonly publicKey: string, private readonly apiUrl: string, private readonly recoveryRedirect = 'coach://auth/recovery') {}

  async signup(email: string, password: string, state?: string) {
    const redirect = new URL('coach://auth/callback'); if (state) redirect.searchParams.set('state', state);
    const payload = await this.auth('/signup', { email, password, email_redirect_to: redirect.toString() });
    return payload.access_token
      ? { status: 'authenticated' as const, tokens: this.tokens(payload) }
      : { status: 'verification_required' as const };
  }
  async verify(tokenHash: string) { return this.tokens(await this.auth('/verify', { type: 'signup', token_hash: tokenHash })); }
  async login(email: string, password: string) { return this.tokens(await this.auth('/token?grant_type=password', { email, password })); }
  async recover(email: string, state: string, challenge: string): Promise<void> {
    const redirect = new URL(this.recoveryRedirect);
    redirect.searchParams.set('state', state);
    await this.auth('/recover', { email, redirect_to: redirect.toString(), code_challenge: challenge, code_challenge_method: 's256' });
  }
  async exchangeRecovery(code: string, verifier: string) { return this.tokens(await this.auth('/token?grant_type=pkce', { auth_code: code, code_verifier: verifier })); }
  async updatePassword(accessToken: string, password: string): Promise<void> { await this.auth('/user', { password }, accessToken, 'PUT'); }
  async reserveRefresh(accessToken: string, requestId: string, refreshToken: string, recoverySecret: string) { return this.api<{ capability: string; expiresAt: string }>('/v1/account/refresh/reserve', accessToken, { method: 'POST', body: JSON.stringify({ requestId, refreshToken, recoverySecret }) }); }
  async recoverReservation(requestId: string, refreshToken: string, recoverySecret: string) { return this.api<{ capability: string; expiresAt: string }>('/v1/account/refresh/recover-reservation', '', { method: 'POST', body: JSON.stringify({ requestId, refreshToken, recoverySecret }) }); }
  async executeRefresh(requestId: string, refreshToken: string, capability: string) { return this.tokens(await this.api<Record<string, unknown>>('/v1/account/refresh/execute', '', { method: 'POST', body: JSON.stringify({ requestId, refreshToken, capability }) })); }

  async api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...init.headers } });
    if (!response.ok) throw await responseError(response);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  private async auth(path: string, body: object, accessToken?: string, method = 'POST'): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.authUrl}${path}`, {
      method,
      headers: { apikey: this.publicKey, authorization: `Bearer ${accessToken ?? this.publicKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw await responseError(response);
    return await response.json() as Record<string, unknown>;
  }

  private tokens(payload: Record<string, unknown>): DesktopSessionTokens {
    if (typeof payload.accessToken === 'string') return { accessToken: payload.accessToken, refreshToken: String(payload.refreshToken), expiresAt: Number(payload.expiresAt) };
    const raw: Partial<AuthTokens> = { accessToken: payload.access_token as string, refreshToken: payload.refresh_token as string, expiresIn: payload.expires_in as number };
    if (typeof raw.accessToken !== 'string' || typeof raw.refreshToken !== 'string' || typeof raw.expiresIn !== 'number') throw new Error('invalid_auth_response');
    return { accessToken: raw.accessToken, refreshToken: raw.refreshToken, expiresAt: Date.now() + raw.expiresIn * 1000 };
  }
}

async function responseError(response: Response): Promise<CloudResponseError> {
  let code = `http_${response.status}`;
  try { code = String((await response.json() as { code?: string }).code ?? code); } catch {}
  return Object.assign(new Error(code), { status: response.status, code });
}
