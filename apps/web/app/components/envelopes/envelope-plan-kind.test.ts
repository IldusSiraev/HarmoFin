import { describe, expect, it } from 'vitest';

import { decimalToMinor, envelopeTone } from './envelope-plan-kind.js';

describe('decimalToMinor', () => {
  it.each([
    ['5000', '500000'],
    ['5000.5', '500050'],
    ['5000.00', '500000'],
    ['5000.05', '500005'],
    ['0', '0'],
    ['0.5', '50'],
    ['0.00', '0'],
    ['123456789012345678.99', '12345678901234567899'],
  ])('converts %s to %s without floating point', (input, expected) => {
    expect(decimalToMinor(input)).toBe(expected);
  });

  it.each(['', 'abc', '-1', '1.234', '1,5', ' 5'])('rejects %j', (input) => {
    expect(decimalToMinor(input)).toBeNull();
  });
});

describe('envelopeTone', () => {
  it('сопоставляет тип конверта с тоном', () => {
    expect(envelopeTone('CURRENT_EXPENSES')).toBe('current');
    expect(envelopeTone('MANDATORY_EXPENSES')).toBe('mandatory');
    expect(envelopeTone('SAVINGS_GOAL')).toBe('savings');
    expect(envelopeTone('RESERVE')).toBe('reserve');
    expect(envelopeTone('CUSTOM')).toBe('custom');
    expect(envelopeTone('UNKNOWN')).toBe('custom');
  });
});
