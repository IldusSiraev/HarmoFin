import { describe, expect, it } from 'vitest';

import { formatLandingMoney, formatLandingSignedMoney } from './format-money.js';

const normalize = (value: string): string => value.replace(/[\u00A0 ]/g, ' ');

describe('formatLandingMoney', () => {
  it('formats minor units as whole roubles', () => {
    expect(normalize(formatLandingMoney('2180000'))).toBe('21 800 ₽');
    expect(normalize(formatLandingMoney('10600000'))).toBe('106 000 ₽');
  });

  it('keeps non-breaking separators', () => {
    expect(formatLandingMoney('2180000')).toContain('\u00A0');
  });

  it('rejects values that are not integer strings', () => {
    expect(() => formatLandingMoney('21800.5')).toThrow(TypeError);
  });
});

describe('formatLandingSignedMoney', () => {
  it('prefixes the sign', () => {
    expect(normalize(formatLandingSignedMoney('600000', 'plus'))).toBe('+6 000 ₽');
    expect(normalize(formatLandingSignedMoney('100000', 'minus'))).toBe('−1 000 ₽');
  });
});
