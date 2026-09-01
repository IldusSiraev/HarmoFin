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

  it('creates deterministic HMAC digests that never equal raw tokens', () => {
    const token = service.createRawToken();

    expect(service.digest(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(service.digest(token)).toBe(service.digest(token));
    expect(service.digest(token)).not.toBe(token);
  });
});
