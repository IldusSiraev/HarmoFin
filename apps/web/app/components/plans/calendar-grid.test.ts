import { describe, expect, it } from 'vitest';

import { buildCalendarGrid } from './calendar-grid.js';

describe('buildCalendarGrid', () => {
  it('builds a Monday-first 42-cell grid spanning the neighboring months', () => {
    const grid = buildCalendarGrid('2026-09-01');

    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ date: '2026-08-31', inCurrentMonth: false });
    expect(grid[1]).toEqual({ date: '2026-09-01', inCurrentMonth: true });
    expect(grid[30]).toEqual({ date: '2026-09-30', inCurrentMonth: true });
    expect(grid[41]).toEqual({ date: '2026-10-11', inCurrentMonth: false });
    expect(grid.filter((cell) => cell.inCurrentMonth)).toHaveLength(30);
  });

  it('is stable for any day within the month, not just the first', () => {
    expect(buildCalendarGrid('2026-09-15')).toEqual(buildCalendarGrid('2026-09-01'));
  });
});
