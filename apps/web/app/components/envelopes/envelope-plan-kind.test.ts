import { describe, expect, it } from 'vitest';

import { decimalToMinor } from './envelope-plan-kind.js';

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
