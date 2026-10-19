import { describe, expect, it } from 'vitest';

import { demoPeriodDates, formatDemoDate } from './demo-period-dates.js';

describe('demoPeriodDates', () => {
  it('places the default cycle inside October 2026', () => {
    expect(demoPeriodDates(10, 15)).toEqual({
      periodStart: '2026-10-10',
      periodEnd: '2026-10-24',
      secondPeriodStart: '2026-10-25',
      salaryOn: '2026-10-10',
      mortgageOn: '2026-10-14',
      shoppingFrom: '2026-10-15',
      shoppingTo: '2026-10-21',
      laterPaymentsOn: '2026-10-25',
      daysLeftAfterShopping: 3,
    });
  });

  it('crosses into November when the boundary passes the month end', () => {
    const dates = demoPeriodDates(28, 27);
    expect(dates.periodStart).toBe('2026-10-28');
    expect(dates.secondPeriodStart).toBe('2026-11-24');
    expect(dates.periodEnd).toBe('2026-11-23');
  });

  it('keeps every event inside a short period and never goes negative', () => {
    const dates = demoPeriodDates(1, 1);
    expect(dates).toMatchObject({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-01',
      secondPeriodStart: '2026-10-02',
      mortgageOn: '2026-10-01',
      shoppingFrom: '2026-10-01',
      shoppingTo: '2026-10-01',
      daysLeftAfterShopping: 0,
    });
    expect(demoPeriodDates(5, 6)).toMatchObject({
      periodEnd: '2026-10-10',
      mortgageOn: '2026-10-09',
      shoppingFrom: '2026-10-10',
      shoppingTo: '2026-10-10',
      daysLeftAfterShopping: 0,
    });
  });

  it('formats a date in Russian without a year', () => {
    expect(formatDemoDate('2026-10-05')).toBe('5 октября');
    expect(formatDemoDate('2026-11-24')).toBe('24 ноября');
  });
});
