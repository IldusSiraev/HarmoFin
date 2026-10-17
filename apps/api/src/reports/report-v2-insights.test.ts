import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { CycleAndPeriod } from '../cycles/cycle-period.domain.js';
import {
  addDays,
  assertFiltersAllowed,
  envelopeLimitRows,
  periodComparisonRow,
  periodRangeFor,
  withShareBasisPoints,
  type LimitPeriodRow,
} from './report-v2-insights.js';
import type { FactRow } from './report-v2.repository.js';

const resolveMonthHalves = (date: string): CycleAndPeriod => {
  const [year, month, dayText] = date.split('-');
  const first = Number(dayText) <= 14;
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const start = `${year}-${month}-${first ? '01' : '15'}`;
  const end = `${year}-${month}-${first ? '14' : String(last)}`;
  return {
    cycle: { start: `${year}-${month}-01`, end: `${year}-${month}-${last}` },
    period: { id: first ? 'FIRST' : 'SECOND', start, end },
    daysUntilNextBoundary: 0,
  } as CycleAndPeriod;
};

const expense = (occurredOn: string, amountMinor: bigint): FactRow => ({
  transactionType: 'EXPENSE',
  amountMinor,
  occurredOn,
  categoryId: 'c',
  categoryName: 'Еда',
});

const period = (overrides: Partial<LimitPeriodRow>): LimitPeriodRow => ({
  periodId: 'p1',
  envelopeId: 'e1',
  envelopeName: 'Продукты',
  archived: false,
  startsOn: '2026-03-01',
  endsOn: '2026-03-14',
  targetMinor: 1_000_000n,
  targetStatus: 'CONFIRMED',
  ...overrides,
});

describe('addDays', () => {
  it('переходит через границу месяца и года', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });
});

describe('periodRangeFor', () => {
  it('сохранённый период с самым поздним началом важнее настроек', () => {
    const stored = [
      { start: '2026-03-01', end: '2026-03-20' },
      { start: '2026-03-10', end: '2026-03-31' },
    ];
    expect(periodRangeFor('2026-03-12', stored, resolveMonthHalves)).toEqual({
      start: '2026-03-10',
      end: '2026-03-31',
      source: 'STORED',
    });
  });

  it('без сохранённого периода берёт настройки, действовавшие в тот день', () => {
    expect(periodRangeFor('2026-02-20', [], resolveMonthHalves)).toEqual({
      start: '2026-02-15',
      end: '2026-02-28',
      source: 'SETTINGS_AT',
    });
  });
});

describe('withShareBasisPoints', () => {
  it('доля от суммы ответа, округление к нулю', () => {
    const rows = withShareBasisPoints([
      { expenseMinor: '100' },
      { expenseMinor: '100' },
      { expenseMinor: '100' },
    ]);
    expect(rows.map((row) => row.shareBasisPoints)).toEqual([3333, 3333, 3333]);
  });

  it('пустой ответ и нулевая сумма не делят на ноль', () => {
    expect(withShareBasisPoints([])).toEqual([]);
    expect(withShareBasisPoints([{ expenseMinor: '0' }])[0]!.shareBasisPoints).toBe(0);
  });
});

describe('envelopeLimitRows', () => {
  it('перерасход: остаток отрицательный, доля больше 1000', () => {
    const [row] = envelopeLimitRows([period({})], new Map([['p1', 1_200_000n]]), '2026-10-17');
    expect(row).toMatchObject({
      targetMinor: '1000000',
      spentMinor: '1200000',
      remainingMinor: '-200000',
      overspentMinor: '200000',
      spentPermille: 1200,
      isCurrent: false,
    });
  });

  it('без лимита: target, остаток и доля null, перерасход 0', () => {
    const [row] = envelopeLimitRows(
      [period({ targetStatus: 'UNSET', targetMinor: null })],
      new Map([['p1', 5n]]),
      '2026-10-17',
    );
    expect(row).toMatchObject({
      targetMinor: null,
      remainingMinor: null,
      overspentMinor: '0',
      spentPermille: null,
    });
  });

  it('нулевой лимит: доли нет, весь расход — перерасход', () => {
    const [row] = envelopeLimitRows(
      [period({ targetMinor: 0n })],
      new Map([['p1', 10n]]),
      '2026-10-17',
    );
    expect(row).toMatchObject({ spentPermille: null, overspentMinor: '10' });
  });

  it('архивный конверт без движения в прошлом периоде пропускается, текущий остаётся', () => {
    const rows = envelopeLimitRows(
      [
        period({ periodId: 'old', archived: true }),
        period({ periodId: 'now', archived: true, startsOn: '2026-10-15', endsOn: '2026-10-31' }),
      ],
      new Map(),
      '2026-10-17',
    );
    expect(rows.map((row) => [row.periodId, row.isCurrent])).toEqual([['now', true]]);
  });

  it('сортировка: новые периоды сверху, затем имя конверта', () => {
    const rows = envelopeLimitRows(
      [
        period({ periodId: 'a', envelopeName: 'Транспорт' }),
        period({ periodId: 'b', envelopeName: 'Еда' }),
        period({ periodId: 'c', startsOn: '2026-03-15', endsOn: '2026-03-31' }),
      ],
      new Map(),
      '2026-10-17',
    );
    expect(rows.map((row) => row.periodId)).toEqual(['c', 'b', 'a']);
  });
});

describe('periodComparisonRow', () => {
  const current = { start: '2026-03-15', end: '2026-03-31', source: 'STORED' as const };
  const previous = { start: '2026-03-01', end: '2026-03-14', source: 'STORED' as const };

  it('сравнивает с тем же числом дней прошлого периода', () => {
    const row = periodComparisonRow({
      asOf: '2026-03-20',
      current,
      previous,
      facts: [
        expense('2026-03-03', 100_000n),
        expense('2026-03-10', 50_000n),
        expense('2026-03-16', 80_000n),
        expense('2026-03-25', 999n),
      ],
      limitTotalMinor: 500_000n,
    });
    expect(row).toEqual({
      asOf: '2026-03-20',
      periodStart: '2026-03-15',
      periodEnd: '2026-03-31',
      daysElapsed: 6,
      spentMinor: '80000',
      limitTotalMinor: '500000',
      spentOfLimitPermille: 160,
      previousPeriodStart: '2026-03-01',
      previousPeriodEnd: '2026-03-14',
      previousSameDaySpentMinor: '100000',
      previousTotalSpentMinor: '150000',
      deltaMinor: '-20000',
      deltaBasisPoints: -2000,
    });
  });

  it('окно прошлого периода не выходит за его конец; нулевой прошлый период без процента', () => {
    const row = periodComparisonRow({
      asOf: '2026-03-31',
      current,
      previous,
      facts: [expense('2026-03-31', 7n), expense('2026-03-14', 0n)],
      limitTotalMinor: null,
    });
    expect(row).toMatchObject({
      daysElapsed: 17,
      previousSameDaySpentMinor: '0',
      deltaBasisPoints: null,
      limitTotalMinor: null,
      spentOfLimitPermille: null,
    });
  });

  it('доходы не учитываются; отрицательная разница округляется к нулю', () => {
    const row = periodComparisonRow({
      asOf: '2026-03-15',
      current,
      previous,
      facts: [
        { ...expense('2026-03-15', 1_000n), transactionType: 'INCOME' },
        expense('2026-03-01', 3n),
        expense('2026-03-15', 1n),
      ],
      limitTotalMinor: 0n,
    });
    expect(row).toMatchObject({ spentMinor: '1', deltaMinor: '-2', deltaBasisPoints: -6666 });
    expect(row.spentOfLimitPermille).toBeNull();
  });
});

describe('assertFiltersAllowed', () => {
  it('отклоняет неприменимые фильтры новых ключей', () => {
    expect(() => assertFiltersAllowed('period-comparison', { envelopeId: 'x' })).toThrow(
      BadRequestException,
    );
    expect(() => assertFiltersAllowed('envelope-limits', { accountId: 'x' })).toThrow(
      BadRequestException,
    );
  });

  it('пропускает разрешённые фильтры и старые ключи', () => {
    expect(() => assertFiltersAllowed('period-comparison', { to: '2026-03-20' })).not.toThrow();
    expect(() => assertFiltersAllowed('envelope-limits', { from: '2026-03-01' })).not.toThrow();
    expect(() => assertFiltersAllowed('expenses-by-category', { accountId: 'x' })).not.toThrow();
  });
});
