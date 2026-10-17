import { BadRequestException } from '@nestjs/common';

import { formatMinorUnits } from '../common/money/minor-units.js';
import type { CycleAndPeriod } from '../cycles/cycle-period.domain.js';
import type { ReportV2Filters, ReportV2Key } from './report-v2.dto.js';
import type { FactRow } from './report-v2.repository.js';

export type Resolve = (date: string) => CycleAndPeriod;

export type PeriodRange = { start: string; end: string; source: 'STORED' | 'SETTINGS_AT' };

export type LimitPeriodRow = {
  periodId: string;
  envelopeId: string;
  envelopeName: string;
  archived: boolean;
  startsOn: string;
  endsOn: string;
  targetMinor: bigint | null;
  targetStatus: 'UNSET' | 'DRAFT' | 'CONFIRMED';
};

export type EnvelopeLimitRow = {
  periodId: string;
  periodStart: string;
  periodEnd: string;
  isCurrent: boolean;
  envelopeId: string;
  envelopeName: string;
  targetMinor: string | null;
  targetStatus: 'UNSET' | 'DRAFT' | 'CONFIRMED';
  spentMinor: string;
  remainingMinor: string | null;
  overspentMinor: string;
  spentPermille: number | null;
};

export type PeriodComparisonRow = {
  asOf: string;
  periodStart: string;
  periodEnd: string;
  daysElapsed: number;
  spentMinor: string;
  limitTotalMinor: string | null;
  spentOfLimitPermille: number | null;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  previousSameDaySpentMinor: string;
  previousTotalSpentMinor: string;
  deltaMinor: string;
  deltaBasisPoints: number | null;
};

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return (
    (new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) /
    DAY_MS
  );
}

/**
 * Period containing `date`: a stored envelope_periods range (latest start wins when ranges
 * overlap), else the period of the cycle settings in force that day. Shared by expenses-by-period
 * and period-comparison so history is never re-sliced by current settings.
 */
export function periodRangeFor(
  date: string,
  stored: Array<{ start: string; end: string }>,
  resolve: Resolve,
): PeriodRange {
  let range: PeriodRange | undefined;
  for (const candidate of stored) {
    if (candidate.start <= date && date <= candidate.end) {
      range = { start: candidate.start, end: candidate.end, source: 'STORED' };
    }
  }
  if (range) return range;
  const { period } = resolve(date);
  return { start: period.start, end: period.end, source: 'SETTINGS_AT' };
}

export function withShareBasisPoints<T extends { expenseMinor: string }>(
  rows: T[],
): Array<T & { shareBasisPoints: number }> {
  const total = rows.reduce((sum, row) => sum + BigInt(row.expenseMinor), 0n);
  return rows.map((row) => ({
    ...row,
    shareBasisPoints: total === 0n ? 0 : Number((BigInt(row.expenseMinor) * 10_000n) / total),
  }));
}

export function envelopeLimitRows(
  periods: LimitPeriodRow[],
  spentByPeriod: Map<string, bigint>,
  today: string,
): EnvelopeLimitRow[] {
  const rows: EnvelopeLimitRow[] = [];
  for (const period of periods) {
    const spent = spentByPeriod.get(period.periodId) ?? 0n;
    const isCurrent = period.startsOn <= today && today <= period.endsOn;
    if (period.archived && spent === 0n && !isCurrent) continue;
    const target = period.targetStatus === 'UNSET' ? null : period.targetMinor;
    rows.push({
      periodId: period.periodId,
      periodStart: period.startsOn,
      periodEnd: period.endsOn,
      isCurrent,
      envelopeId: period.envelopeId,
      envelopeName: period.envelopeName,
      targetMinor: target === null ? null : formatMinorUnits(target),
      targetStatus: period.targetStatus,
      spentMinor: formatMinorUnits(spent),
      remainingMinor: target === null ? null : formatMinorUnits(target - spent),
      overspentMinor: formatMinorUnits(target !== null && spent > target ? spent - target : 0n),
      spentPermille: target === null || target === 0n ? null : Number((spent * 1000n) / target),
    });
  }
  return rows.sort(
    (left, right) =>
      right.periodStart.localeCompare(left.periodStart) ||
      left.envelopeName.localeCompare(right.envelopeName, 'ru') ||
      left.envelopeId.localeCompare(right.envelopeId),
  );
}

export function periodComparisonRow(input: {
  asOf: string;
  current: PeriodRange;
  previous: PeriodRange;
  facts: FactRow[];
  limitTotalMinor: bigint | null;
}): PeriodComparisonRow {
  const { asOf, current, previous, facts, limitTotalMinor } = input;
  const daysElapsed = daysBetween(current.start, asOf) + 1;
  const sameDayCandidate = addDays(previous.start, daysElapsed - 1);
  const sameDayEnd = sameDayCandidate < previous.end ? sameDayCandidate : previous.end;
  let spent = 0n;
  let previousSameDay = 0n;
  let previousTotal = 0n;
  for (const fact of facts) {
    if (fact.transactionType !== 'EXPENSE') continue;
    const day = fact.occurredOn;
    if (current.start <= day && day <= asOf) spent += fact.amountMinor;
    if (previous.start <= day && day <= previous.end) {
      previousTotal += fact.amountMinor;
      if (day <= sameDayEnd) previousSameDay += fact.amountMinor;
    }
  }
  const delta = spent - previousSameDay;
  return {
    asOf,
    periodStart: current.start,
    periodEnd: current.end,
    daysElapsed,
    spentMinor: formatMinorUnits(spent),
    limitTotalMinor: limitTotalMinor === null ? null : formatMinorUnits(limitTotalMinor),
    spentOfLimitPermille:
      limitTotalMinor === null || limitTotalMinor === 0n
        ? null
        : Number((spent * 1000n) / limitTotalMinor),
    previousPeriodStart: previous.start,
    previousPeriodEnd: previous.end,
    previousSameDaySpentMinor: formatMinorUnits(previousSameDay),
    previousTotalSpentMinor: formatMinorUnits(previousTotal),
    deltaMinor: formatMinorUnits(delta),
    deltaBasisPoints: previousSameDay === 0n ? null : Number((delta * 10_000n) / previousSameDay),
  };
}

/** Keys with a restricted filter set; keys not listed accept every filter. */
export const REPORT_ALLOWED_FILTERS: Partial<
  Record<ReportV2Key, ReadonlyArray<keyof ReportV2Filters>>
> = {
  'envelope-limits': ['from', 'to', 'envelopeId'],
  'period-comparison': ['to'],
};

export function assertFiltersAllowed(key: ReportV2Key, filters: ReportV2Filters): void {
  const allowed = REPORT_ALLOWED_FILTERS[key];
  if (!allowed) return;
  const rejected = (Object.keys(filters) as Array<keyof ReportV2Filters>).filter(
    (name) => filters[name] !== undefined && !allowed.includes(name),
  );
  if (rejected.length === 0) return;
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail: 'Этот фильтр не применяется к выбранному отчёту.',
    fieldErrors: rejected.map((field) => ({
      field,
      message: 'Фильтр не применяется к этому отчёту.',
      code: 'unrecognized',
    })),
  });
}
