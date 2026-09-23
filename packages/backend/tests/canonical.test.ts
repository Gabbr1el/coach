import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from '../src/sync/canonical.js';

describe('sync canonical JSON', () => {
  it('orders object keys by raw UTF-8 bytes independent of locale', () => {
    expect(canonicalJson({ 'é': 1, z: 2, a: 3, '😀': 4 })).toBe('{"a":3,"z":2,"é":1,"😀":4}');
  });

  it('preserves canonically equivalent but distinct Unicode keys', () => {
    const composed = 'é';
    const decomposed = 'e\u0301';
    const value = { [composed]: 1, [decomposed]: 2 };
    expect(Object.keys(JSON.parse(canonicalJson(value)))).toHaveLength(2);
    expect(sha256(value)).not.toBe(sha256({ [composed]: 2 }));
  });
});
