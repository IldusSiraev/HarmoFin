import { describe, expect, it } from 'vitest';

import { formatMinorUnits, formatCompactSigned } from './money-format.js';

describe('formatMinorUnits', () => {
  it('formats bigint above Number.MAX_SAFE_INTEGER without number conversion', () => {
    expect(formatMinorUnits('9007199254740993', 'RUB', 2)).toContain('90');
    expect(formatMinorUnits('-1', 'RUB', 2)).toContain('-');
    expect(formatMinorUnits('0', 'RUB', 2)).toContain('0');
  });

  it('rejects invalid minor-unit values', () => {
    expect(() => formatMinorUnits('1.25', 'RUB', 2)).toThrow(TypeError);
  });
});

describe('formatCompactSigned', () => {
  it('shows the exact amount below one thousand', () => {
    expect(formatCompactSigned('85000', 2)).toBe('+850');
    expect(formatCompactSigned('-85000', 2)).toBe('−850');
  });

  it('rounds to the nearest thousand at or above one thousand', () => {
    expect(formatCompactSigned('10600000', 2)).toBe('+106к');
    expect(formatCompactSigned('-300000', 2)).toBe('−3к');
    expect(formatCompactSigned('-435000', 2)).toBe('−4к');
  });

  it('rejects a non-integer minor-unit string the same way formatMinorUnits does', () => {
    expect(() => formatCompactSigned('1.25', 2)).toThrow(TypeError);
  });
});
