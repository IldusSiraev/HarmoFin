import { describe, expect, it } from 'vitest';

import { ChatRateLimiter } from './chat-rate-limiter.js';

describe('ChatRateLimiter', () => {
  it('allows up to the limit per chat inside one window', () => {
    const limiter = new ChatRateLimiter(3, 60_000);
    expect([1, 2, 3, 4].map(() => limiter.allow(1n, 1_000))).toEqual([true, true, true, false]);
    expect(limiter.allow(2n, 1_000)).toBe(true);
  });

  it('starts a new window after the old one ends', () => {
    const limiter = new ChatRateLimiter(1, 60_000);
    expect(limiter.allow(1n, 0)).toBe(true);
    expect(limiter.allow(1n, 59_999)).toBe(false);
    expect(limiter.allow(1n, 60_000)).toBe(true);
  });
});
