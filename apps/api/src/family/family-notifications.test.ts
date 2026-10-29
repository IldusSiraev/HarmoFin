import { describe, expect, it } from 'vitest';

import { transferSummary } from './family-notifications.js';

describe('transferSummary', () => {
  it.each([
    [{ accounts: 3, envelopes: 2, plans: 0 }, '3 счёта, 2 конверта'],
    [{ accounts: 1, envelopes: 5, plans: 11 }, '1 счёт, 5 конвертов, 11 планов'],
    [{ accounts: 21, envelopes: 0, plans: 0 }, '21 счёт'],
    [{ accounts: 0, envelopes: 0, plans: 2 }, '2 плана'],
  ])('%o -> %s', (counts, expected) => {
    expect(transferSummary(counts)).toBe(expected);
  });
});
