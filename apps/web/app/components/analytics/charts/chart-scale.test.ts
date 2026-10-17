import { describe, expect, it } from 'vitest';

import { basisPointsPercent, ratioPercent } from './chart-scale.js';

describe('ratioPercent', () => {
  it('доля от максимума без float-денег', () => {
    expect(ratioPercent('25', '100')).toBe(25);
    expect(ratioPercent('1', '3')).toBe(33.33);
  });

  it('ограничена 0..100; некорректные и нулевые значения дают 0', () => {
    expect(ratioPercent('200', '100')).toBe(100);
    expect(ratioPercent('-5', '100')).toBe(0);
    expect(ratioPercent('5', '0')).toBe(0);
    expect(ratioPercent('x', '10')).toBe(0);
  });
});

describe('basisPointsPercent', () => {
  it('форматирует базисные пункты сервера', () => {
    expect(basisPointsPercent(2400)).toBe('24%');
    expect(basisPointsPercent(55)).toBe('0,5%');
    expect(basisPointsPercent(5)).toBe('<0,1%');
    expect(basisPointsPercent(0)).toBe('0%');
  });
});
