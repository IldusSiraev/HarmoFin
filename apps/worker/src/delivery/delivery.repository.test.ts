import { describe, expect, it } from 'vitest';

import { MAX_DELIVERY_ATTEMPTS, retryDelayMs } from './delivery.repository.js';

describe('retryDelayMs', () => {
  it('backs off 1 min, 5 min, 30 min, 2 h and then gives up', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
    expect(retryDelayMs(MAX_DELIVERY_ATTEMPTS)).toBeNull();
  });
});
