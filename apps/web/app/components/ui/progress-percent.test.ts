import { describe, expect, it } from 'vitest';

import { progressPercent } from './progress-percent.js';

describe('progressPercent', () => {
  it.each([
    ['0', '100', 0],
    ['50', '100', 50],
    ['100', '100', 100],
    ['3165000', '6500000', 48],
  ])('%s из %s — %i %%', (value, max, expected) => {
    expect(progressPercent(value, max)).toBe(expected);
  });

  it('ограничивает 100 % при превышении', () => {
    expect(progressPercent('900000', '500000')).toBe(100);
  });

  it.each([
    ['-5000', '500000'],
    ['100', '0'],
    ['abc', '100'],
    ['100', '1.5'],
    ['', ''],
  ])('некорректный или пустой ввод %j / %j — 0', (value, max) => {
    expect(progressPercent(value, max)).toBe(0);
  });
});
