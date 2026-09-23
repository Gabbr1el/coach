import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseAuthBoundary } from '../src/auth/supabase-auth.js';
import type { AuthFlowStateStore } from '../src/auth/types.js';

class MemoryState implements AuthFlowStateStore {
  values = new Map<string, { codeVerifier: string; expiresAt: number }>();
  async put(state: string, value: { codeVerifier: string; expiresAt: number }) { this.values.set(state, value); }
  async take(state: string) { const value = this.values.get(state); this.values.delete(state); return value; }
}

const session = { access_token: 'access', refresh_token: 'refresh', expires_in: 900 };

describe('Supabase browser/deep-link contracts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('verifies signup with token_hash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new SupabaseAuthBoundary('http://auth.test', 'public');
    await auth.verify('email-token-hash');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ type: 'signup', token_hash: 'email-token-hash' });
  });

  it('uses the authoritative GoTrue user confirmation timestamps', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 })));
    const auth = new SupabaseAuthBoundary('http://auth.test', 'public');
    await expect(auth.isEmailConfirmed('access')).resolves.toBe(true);
  });

  it('stores one-time PKCE state and revokes all sessions after recovery', async () => {
    const state = new MemoryState();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new SupabaseAuthBoundary('http://auth.test', 'public', 'admin', undefined, undefined, 'exact-session', state, 'coach://auth/recovery');
    const flow = await auth.requestPasswordReset('user@example.com');
    const pending = state.values.get(flow.state)!;
    expect(pending.codeVerifier).toBeTruthy();
    const recoveryBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { redirect_to: string; code_challenge: string };
    expect(new URL(recoveryBody.redirect_to).searchParams.get('state')).toBe(flow.state);
    expect(recoveryBody.code_challenge).not.toBe(pending.codeVerifier);

    await auth.resetPassword(flow.state, 'authorization-code', 'new-password');
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ auth_code: 'authorization-code', code_verifier: pending.codeVerifier });
    expect(fetchMock.mock.calls[4]![0]).toBe('http://auth.test/admin/users/11111111-1111-4111-8111-111111111111/logout');
    await expect(auth.resetPassword(flow.state, 'reused-code', 'password')).rejects.toThrow('invalid_or_expired_recovery_state');
  });

  it('uses the verified GoTrue global logout endpoint when configured locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new SupabaseAuthBoundary(
      'http://auth.test',
      'public',
      'service-role',
      'http://auth.test/admin/users/{user_id}/logout',
      'adapter-secret-adapter-secret-1234',
      'user-global'
    );
    await auth.revokeSession('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://auth.test/admin/users/11111111-1111-4111-8111-111111111111/logout');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
  });
});
