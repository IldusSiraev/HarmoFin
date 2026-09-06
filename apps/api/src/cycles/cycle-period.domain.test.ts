import { describe, expect, it } from 'vitest';

import { cycleAndPeriodFor, todayInTimezone } from './cycle-period.domain.js';

const settings = {
  cycleStartDay: 10,
  periodBoundaryOffset: 15,
  timezone: 'Europe/Moscow',
};

describe('cycleAndPeriodFor', () => {
  it.each([
    ['2026-08-24', '2026-08-10', '2026-09-09', 'FIRST', '2026-08-10', '2026-08-24', 1],
    ['2026-08-25', '2026-08-10', '2026-09-09', 'SECOND', '2026-08-25', '2026-09-09', 16],
    ['2026-09-09', '2026-08-10', '2026-09-09', 'SECOND', '2026-08-25', '2026-09-09', 1],
    ['2026-09-10', '2026-09-10', '2026-10-09', 'FIRST', '2026-09-10', '2026-09-24', 15],
    ['2028-03-09', '2028-02-10', '2028-03-09', 'SECOND', '2028-02-25', '2028-03-09', 1],
  ])(
    '%s resolves cycle and period',
    (date, cycleStart, cycleEnd, periodId, periodStart, periodEnd, daysUntilNextBoundary) => {
      expect(cycleAndPeriodFor(settings, date)).toEqual({
        cycle: { start: cycleStart, end: cycleEnd },
        period: { id: periodId, start: periodStart, end: periodEnd },
        daysUntilNextBoundary,
      });
    },
  );

  it('uses budget timezone to derive current date', () => {
    expect(todayInTimezone(new Date('2026-09-09T21:30:00.000Z'), 'Europe/Moscow')).toBe(
      '2026-09-10',
    );
  });

  it('rejects invalid configured boundaries and calendar dates', () => {
    expect(() => cycleAndPeriodFor({ ...settings, cycleStartDay: 29 }, '2026-09-10')).toThrow(
      'cycleStartDay',
    );
    expect(() =>
      cycleAndPeriodFor({ ...settings, periodBoundaryOffset: 28 }, '2026-09-10'),
    ).toThrow('periodBoundaryOffset');
    expect(() => cycleAndPeriodFor(settings, '2026-02-29')).toThrow('date');
  });
});
