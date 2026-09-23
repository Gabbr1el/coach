import { describe, expect, it } from 'vitest';
import { identityFromPayload } from '../src/auth/verifier.js';

describe('JWT identity claims', () => {
  it('requires subject and immutable session claim', () => {
    expect(identityFromPayload({ sub: 'user', session_id: 'session' }, 'session_id')).toEqual({ userId: 'user', authSessionId: 'session' });
    expect(() => identityFromPayload({ sub: 'user' }, 'session_id')).toThrow('invalid_identity_claims');
  });
});
