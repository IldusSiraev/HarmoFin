import { describe, expect, it } from 'vitest';

import { periodLabel } from './period-label.js';

describe('periodLabel', () => {
  it('день.месяц–день.месяц', () => {
    expect(periodLabel('2026-03-01', '2026-03-14')).toBe('01.03–14.03');
  });
});
