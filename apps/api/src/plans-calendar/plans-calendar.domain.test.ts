import { describe, expect, it } from 'vitest';

import {
  buildDays,
  isOpenStatus,
  isOverdue,
  monthWindow,
  plannedTotals,
  previousDay,
  settlementOf,
} from './plans-calendar.domain.js';

describe('monthWindow', () => {
  it('returns inclusive first and last day', () => {
    expect(monthWindow('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthWindow('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthWindow('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthWindow('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('previousDay', () => {
  it('crosses month and year boundaries', () => {
    expect(previousDay('2026-09-24')).toBe('2026-09-23');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

describe('overdue', () => {
  it('open statuses are PENDING and DUE', () => {
    expect(isOpenStatus('PENDING')).toBe(true);
    expect(isOpenStatus('DUE')).toBe(true);
    for (const status of ['SKIPPED', 'COMPLETED', 'CANCELLED']) {
      expect(isOpenStatus(status)).toBe(false);
    }
  });

  it('only an open obligation before today is overdue', () => {
    expect(isOverdue('OBLIGATION', 'DUE', '2026-09-23', '2026-09-24')).toBe(true);
    expect(isOverdue('OBLIGATION', 'DUE', '2026-09-24', '2026-09-24')).toBe(false);
    expect(isOverdue('OBLIGATION', 'COMPLETED', '2026-09-01', '2026-09-24')).toBe(false);
    expect(isOverdue('OBLIGATION', 'SKIPPED', '2026-09-01', '2026-09-24')).toBe(false);
    expect(isOverdue('INCOME_PLAN', 'PENDING', '2026-09-01', '2026-09-24')).toBe(false);
  });
});

describe('plannedTotals', () => {
  it('sums expected amounts without cancelled and skipped, keeping completed', () => {
    const totals = plannedTotals([
      {
        kind: 'INCOME_PLAN',
        status: 'PENDING',
        scheduledOn: '2026-09-25',
        expectedMinor: 10_000_000n,
      },
      { kind: 'INCOME_PLAN', status: 'CANCELLED', scheduledOn: '2026-09-26', expectedMinor: 999n },
      { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-10', expectedMinor: 300_000n },
      {
        kind: 'OBLIGATION',
        status: 'COMPLETED',
        scheduledOn: '2026-09-11',
        expectedMinor: 4_000_000n,
      },
      { kind: 'OBLIGATION', status: 'SKIPPED', scheduledOn: '2026-09-12', expectedMinor: 777n },
    ]);
    expect(totals).toEqual({
      plannedIncomeMinor: 10_000_000n,
      plannedExpenseMinor: 4_300_000n,
      balanceMinor: 5_700_000n,
    });
  });

  it('balance can be negative and empty input is zero', () => {
    expect(plannedTotals([])).toEqual({
      plannedIncomeMinor: 0n,
      plannedExpenseMinor: 0n,
      balanceMinor: 0n,
    });
    expect(
      plannedTotals([
        { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-10', expectedMinor: 500n },
      ]).balanceMinor,
    ).toBe(-500n);
  });
});

describe('buildDays', () => {
  it('merges facts per day, adds dots, sorts by date and drops empty days', () => {
    const days = buildDays(
      [
        { date: '2026-09-05', type: 'EXPENSE', amountMinor: 600_000n },
        { date: '2026-09-05', type: 'INCOME', amountMinor: 4_300_000n },
        { date: '2026-09-02', type: 'EXPENSE', amountMinor: 100n },
      ],
      [
        { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-05' },
        { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-10' },
        { kind: 'OBLIGATION', status: 'PENDING', scheduledOn: '2026-09-30' },
        { kind: 'INCOME_PLAN', status: 'PENDING', scheduledOn: '2026-09-25' },
        { kind: 'OBLIGATION', status: 'COMPLETED', scheduledOn: '2026-09-12' },
      ],
      '2026-09-24',
    );
    expect(days).toEqual([
      { date: '2026-09-02', incomeMinor: 0n, expenseMinor: 100n, dot: null },
      { date: '2026-09-05', incomeMinor: 4_300_000n, expenseMinor: 600_000n, dot: 'overdue' },
      { date: '2026-09-10', incomeMinor: 0n, expenseMinor: 0n, dot: 'overdue' },
      { date: '2026-09-25', incomeMinor: 0n, expenseMinor: 0n, dot: 'upcoming' },
      { date: '2026-09-30', incomeMinor: 0n, expenseMinor: 0n, dot: 'upcoming' },
    ]);
  });

  it('overdue wins over upcoming on the same day', () => {
    const days = buildDays(
      [],
      [
        { kind: 'INCOME_PLAN', status: 'PENDING', scheduledOn: '2026-09-10' },
        { kind: 'OBLIGATION', status: 'DUE', scheduledOn: '2026-09-10' },
      ],
      '2026-09-24',
    );
    expect(days).toEqual([
      { date: '2026-09-10', incomeMinor: 0n, expenseMinor: 0n, dot: 'overdue' },
    ]);
  });
});

describe('settlementOf', () => {
  it('folds the facts into the latest date and the paid sum', () => {
    expect(
      settlementOf([
        { id: 'a', date: '2026-10-20', amountMinor: 400_000n },
        { id: 'b', date: '2026-10-24', amountMinor: 600_000n },
      ]),
    ).toEqual({ factOn: '2026-10-24', factMinor: 1_000_000n, transactionIds: ['a', 'b'] });
  });

  it('is null without a confirmed fact', () => {
    expect(settlementOf([])).toBeNull();
  });
});
