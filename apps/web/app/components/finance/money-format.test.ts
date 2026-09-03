import { describe, expect, it } from 'vitest';

import { formatMinorUnits } from './money-format.js';

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
