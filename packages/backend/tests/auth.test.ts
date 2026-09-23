import { describe, expect, it } from 'vitest';
import { LocalTestAuthBoundary } from '../src/auth/local-test-auth.js';

describe('local deterministic auth contract', () => {
  it('requires verification, rotates refresh tokens, and detects reuse', async () => {
    const auth = await LocalTestAuthBoundary.create('http://auth.test', 'authenticated');
    expect(await auth.signup('User@Example.com', 'correct horse battery staple')).toEqual({ status: 'verification_required' });
    const code = auth.latestVerificationCode('user@example.com')!;
    const first = await auth.verify(code);
    const rotated = await auth.refresh(first.refreshToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    await expect(auth.refresh(first.refreshToken)).rejects.toThrow('refresh_reuse_detected');
    await expect(auth.refresh(rotated.refreshToken)).rejects.toThrow('refresh_reuse_detected');
  });

  it('uses a generic recovery request and revokes sessions after reset', async () => {
    const auth = await LocalTestAuthBoundary.create('http://auth.test', 'authenticated');
    await auth.signup('user@example.com', 'old password');
    const tokens = await auth.verify(auth.latestVerificationCode('user@example.com')!);
    await expect(auth.requestPasswordReset('unknown@example.com')).resolves.toHaveProperty('state');
    const { state } = await auth.requestPasswordReset('user@example.com');
    await auth.resetPassword(state, auth.latestRecoveryCode('user@example.com')!, 'new password');
    await expect(auth.refresh(tokens.refreshToken)).rejects.toThrow('refresh_reuse_detected');
    await expect(auth.login('user@example.com', 'new password')).resolves.toBeDefined();
  });
});
