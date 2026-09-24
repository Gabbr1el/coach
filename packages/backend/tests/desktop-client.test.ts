import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachDesktopCloudClient } from '../src/client/desktop-client.js';

afterEach(() => vi.unstubAllGlobals());

describe('CoachDesktopCloudClient recovery', () => {
  it('emits the exact deep link accepted by Electron', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response('{}', { status: 200 }); }));
    const client = new CoachDesktopCloudClient('https://auth.example', 'public', 'https://api.example');
    await client.recover('user@example.test', '00000000-0000-4000-8000-000000000001', 'challenge');
    expect(body.redirect_to).toBe('coach://auth/recovery?state=00000000-0000-4000-8000-000000000001');
  });

  it('retries the same PKCE exchange inputs after a transient failure', async () => {
    const bodies: string[] = []; let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => { bodies.push(String(init?.body)); if (String(url).includes('grant_type=pkce') && attempt++ === 0) return new Response('{}', { status: 503 }); if (String(url).endsWith('/user')) return new Response('{}', { status: 200 }); return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 900 }), { status: 200 }); }));
    const client = new CoachDesktopCloudClient('https://auth.example', 'public', 'https://api.example');
    await expect(client.exchangeRecovery('code', 'verifier')).rejects.toThrow('http_503');
    await expect(client.exchangeRecovery('code', 'verifier')).resolves.toBeDefined();
    expect(bodies.filter((body) => body.includes('code_verifier'))).toEqual(['{"auth_code":"code","code_verifier":"verifier"}', '{"auth_code":"code","code_verifier":"verifier"}']);
  });
});
