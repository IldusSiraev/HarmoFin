import { describe, expect, it } from 'vitest';

import { periodChipOptions } from './period-options.js';

describe('periodChipOptions', () => {
  it('offers the current period with its server-computed boundaries', () => {
    const [current] = periodChipOptions({ start: '2026-09-10', end: '2026-09-24' });

    expect(current).toEqual({ value: '2026-09-10', label: 'Текущий период (10.09 – 24.09)' });
  });

  it('points at the previous period by the day before it starts', () => {
    const options = periodChipOptions({ start: '2026-09-10', end: '2026-09-24' });

    expect(options[1]).toEqual({ value: '2026-09-09', label: 'Прошлый период' });
  });

  it('crosses a month boundary without inventing cycle rules', () => {
    expect(periodChipOptions({ start: '2026-09-01', end: '2026-09-14' })[1]?.value).toBe(
      '2026-08-31',
    );
  });

  it('offers nothing without a period from the server', () => {
    expect(periodChipOptions(null)).toEqual([]);
  });
});
