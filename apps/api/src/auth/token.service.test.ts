import { describe, expect, it } from 'vitest';

import { TokenService } from './token.service.js';

describe('TokenService', () => {
  const service = new TokenService('test-only-secret-with-at-least-32-bytes');

  it('generates distinct opaque tokens from at least 32 random bytes', () => {
    const first = service.createRawToken();
    const second = service.createRawToken();

    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
  });

  it('matches only a raw token corresponding to stored digest', () => {
    const token = service.createRawToken();
    const digest = service.digest(token);

    expect(service.matchesDigest(token, digest)).toBe(true);
    expect(service.matchesDigest('wrong-token', digest)).toBe(false);
  });
});
