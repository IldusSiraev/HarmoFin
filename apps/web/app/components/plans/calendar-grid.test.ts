import { describe, expect, it } from 'vitest';

import { buildCalendarGrid } from './calendar-grid.js';

describe('buildCalendarGrid', () => {
  it('builds 42 cells starting on Monday', () => {
    const grid = buildCalendarGrid('2026-09-01'); // 2026-09-01 is Tuesday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ date: '2026-08-31', inCurrentMonth: false });
    expect(grid[1]).toEqual({ date: '2026-09-01', inCurrentMonth: true });
    expect(grid.filter((cell) => cell.inCurrentMonth)).toHaveLength(30);
    expect(grid[41]).toEqual({ date: '2026-10-11', inCurrentMonth: false });
  });

  it('accepts any day of the month as anchor', () => {
    expect(buildCalendarGrid('2026-09-17')[1]?.date).toBe('2026-09-01');
  });
});
