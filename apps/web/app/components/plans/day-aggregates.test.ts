import { describe, expect, it } from 'vitest';

import { buildDayAggregates } from './day-aggregates.js';

describe('buildDayAggregates', () => {
  it('nets confirmed transactions per day, income positive and expense negative', () => {
    const aggregates = buildDayAggregates(
      [
        { occurredOn: '2026-09-13', amountMinor: '350000', transactionType: 'EXPENSE' },
        { occurredOn: '2026-09-13', amountMinor: '85000', transactionType: 'EXPENSE' },
        { occurredOn: '2026-09-10', amountMinor: '10600000', transactionType: 'INCOME' },
      ],
      [],
      '2026-09-24',
    );

    expect(aggregates['2026-09-13']?.netMinor).toBe(-435000n);
    expect(aggregates['2026-09-10']?.netMinor).toBe(10600000n);
  });

  it('marks a past DUE occurrence overdue and a future PENDING one upcoming', () => {
    const aggregates = buildDayAggregates(
      [],
      [
        { scheduledOn: '2026-09-10', status: 'DUE' },
        { scheduledOn: '2026-09-26', status: 'PENDING' },
        { scheduledOn: '2026-09-24', status: 'DUE' },
      ],
      '2026-09-24',
    );

    expect(aggregates['2026-09-10']?.dot).toBe('overdue');
    expect(aggregates['2026-09-26']?.dot).toBe('upcoming');
    expect(aggregates['2026-09-24']?.dot).toBe('upcoming');
  });

  it('ignores completed, skipped, and cancelled occurrences for the dot', () => {
    const aggregates = buildDayAggregates(
      [],
      [
        { scheduledOn: '2026-09-05', status: 'COMPLETED' },
        { scheduledOn: '2026-09-06', status: 'SKIPPED' },
        { scheduledOn: '2026-09-07', status: 'CANCELLED' },
      ],
      '2026-09-24',
    );

    expect(aggregates['2026-09-05']).toBeUndefined();
    expect(aggregates['2026-09-06']).toBeUndefined();
    expect(aggregates['2026-09-07']).toBeUndefined();
  });

  it('keeps an overdue dot even when a same-day transaction also nets to zero contribution', () => {
    const aggregates = buildDayAggregates(
      [{ occurredOn: '2026-09-10', amountMinor: '100', transactionType: 'INCOME' }],
      [{ scheduledOn: '2026-09-10', status: 'DUE' }],
      '2026-09-24',
    );

    expect(aggregates['2026-09-10']).toEqual({ netMinor: 100n, dot: 'overdue' });
  });
});
