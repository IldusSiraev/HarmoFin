import { describe, expect, it } from 'vitest';

import { dateLabel } from './date-label.js';

describe('dateLabel', () => {
  it('YYYY-MM-DD → DD.MM.YYYY', () => {
    expect(dateLabel('2026-03-02')).toBe('02.03.2026');
  });

  it('non-matching input returned unchanged', () => {
    expect(dateLabel('Продукты')).toBe('Продукты');
  });
});
