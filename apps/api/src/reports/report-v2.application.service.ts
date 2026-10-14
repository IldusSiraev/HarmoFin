import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { formatMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import {
  cycleAndPeriodFor,
  todayInTimezone,
  type CycleAndPeriod,
  type CycleSettings,
} from '../cycles/cycle-period.domain.js';
import { clipAtNextRevision } from '../cycles/cycle-settings-at.js';
import type { StoredRevision } from '../cycles/cycle-revision.repository.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ReportV2Filters, ReportV2Key } from './report-v2.dto.js';
import {
  type AssignmentLedgerRow,
  type FactRow,
  type PlanOccurrenceFact,
  type SavingsGoalRow,
  ReportV2Repository,
} from './report-v2.repository.js';

export type ReportV2Response = { key: ReportV2Key; rows: Array<Record<string, unknown>> };

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

@Injectable()
export class ReportV2ApplicationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly repository: ReportV2Repository,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  /**
   * Any active member (VIEWER too) of a model-2 budget reads. Access, filter objects and every
   * aggregate run in one read-only snapshot transaction; foreign or missing filter objects are
   * rejected with 404 before anything is aggregated.
   */
  async get(
    userId: string,
    budgetId: string,
    key: ReportV2Key,
    filters: ReportV2Filters,
  ): Promise<ReportV2Response> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const budget = await this.repository.findAccessible(tx, userId, budgetId);
        if (!budget) throw resourceNotFound();
        if (!(await this.repository.validateReferences(tx, budgetId, filters))) {
          throw resourceNotFound();
        }
        return { key, rows: await this.rows(tx, userId, budgetId, budget, key, filters) };
      },
      { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async rows(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    budget: CycleSettings,
    key: ReportV2Key,
    filters: ReportV2Filters,
  ): Promise<Array<Record<string, unknown>>> {
    const repo = this.repository;
    const today = todayInTimezone(new Date(), budget.timezone);
    // Balance-like reports are cumulative: the as-of day is `to`, else today in the budget timezone.
    const asOf = filters.to ?? today;
    if (key === 'account-balances') {
      const balances = await repo.accountBalances(
        tx,
        budgetId,
        instantForLocalDate(asOf, budget.timezone),
        filters.accountId,
      );
      return balances.map((row) => ({
        accountId: row.accountId,
        name: row.name,
        balanceMinor: formatMinorUnits(row.balanceMinor),
        asOf,
      }));
    }
    if (key === 'savings-goals') {
      return goalRows(await repo.savingsGoals(tx, budgetId, asOf, filters.envelopeId), today);
    }
    if (key === 'plan-vs-actual') {
      return planVsActualRows(await repo.planOccurrences(tx, userId, budgetId, filters));
    }
    if (key === 'assignment-movements') {
      return ledgerRows(await repo.assignmentLedger(tx, userId, budgetId, filters));
    }

    const facts = await repo.facts(tx, userId, budgetId, filters);
    if (key === 'expenses-by-category') return expensesByCategory(facts);
    const revisions = await repo.cycleRevisions(tx, budgetId);
    const resolve = cycleResolver(revisions, budget);
    if (key === 'expenses-by-period') {
      const stored = await repo.storedPeriodRanges(tx, budgetId);
      return expensesByPeriod(facts, stored, resolve);
    }
    if (key === 'expenses-by-cycle') return cycleTotals(facts, 'EXPENSE', resolve);
    if (key === 'incomes-by-cycle') return cycleTotals(facts, 'INCOME', resolve);
    return netCashFlow(facts, resolve);
  }
}

type Resolve = (date: string) => CycleAndPeriod;

/**
 * Cycle and period containing `date` under the settings in force that day (latest revision not
 * after it, else the budget fields), clipped at the next revision. Same rules as cycleAndPeriodAt,
 * computed in memory from one revisions read.
 */
function cycleResolver(revisions: StoredRevision[], fallback: CycleSettings): Resolve {
  const cache = new Map<string, CycleAndPeriod>();
  return (date) => {
    const cached = cache.get(date);
    if (cached) return cached;
    let settings: CycleSettings = fallback;
    for (const revision of revisions) {
      if (revision.effectiveOn <= date) settings = revision;
    }
    const next = revisions.find((revision) => revision.effectiveOn > date)?.effectiveOn;
    const value = clipAtNextRevision(cycleAndPeriodFor(settings, date), date, next);
    cache.set(date, value);
    return value;
  };
}

function instantForLocalDate(date: string, timezone: string): Date {
  for (const hour of ['12', '00', '06', '18']) {
    const candidate = new Date(`${date}T${hour}:00:00.000Z`);
    if (todayInTimezone(candidate, timezone) === date) return candidate;
  }
  return new Date(`${date}T12:00:00.000Z`);
}

function expensesByCategory(facts: FactRow[]) {
  const grouped = new Map<string, { name: string; amountMinor: bigint }>();
  for (const fact of facts) {
    if (fact.transactionType !== 'EXPENSE') continue;
    const current = grouped.get(fact.categoryId) ?? { name: fact.categoryName, amountMinor: 0n };
    current.amountMinor += fact.amountMinor;
    grouped.set(fact.categoryId, current);
  }
  return [...grouped.entries()]
    .sort(([, left], [, right]) =>
      right.amountMinor > left.amountMinor
        ? 1
        : right.amountMinor < left.amountMinor
          ? -1
          : left.name.localeCompare(right.name, 'ru'),
    )
    .map(([categoryId, row]) => ({
      categoryId,
      categoryName: row.name,
      expenseMinor: formatMinorUnits(row.amountMinor),
      journalFilters: { categoryId, type: 'EXPENSE' },
    }));
}

/**
 * History is grouped by the boundaries that were stored when the period existed: a date inside a
 * stored envelope_periods range uses that range (latest start wins), a date without one is placed
 * by the settings in force that day. The current periodSlot/settings never re-slice history.
 * Heuristic: stored ranges of different envelopes normally coincide; if they overlap (e.g. a clipped
 * period after a cycle change), the range with the latest start that contains the date wins.
 */
function expensesByPeriod(
  facts: FactRow[],
  stored: Array<{ start: string; end: string }>,
  resolve: Resolve,
) {
  const grouped = new Map<
    string,
    { start: string; end: string; source: 'STORED' | 'SETTINGS_AT'; amountMinor: bigint }
  >();
  for (const fact of facts) {
    if (fact.transactionType !== 'EXPENSE') continue;
    let range: { start: string; end: string; source: 'STORED' | 'SETTINGS_AT' } | undefined;
    for (const candidate of stored) {
      if (candidate.start <= fact.occurredOn && fact.occurredOn <= candidate.end) {
        range = { ...candidate, source: 'STORED' };
      }
    }
    range ??= { ...resolve(fact.occurredOn).period, source: 'SETTINGS_AT' };
    const id = `${range.start}:${range.end}`;
    const current = grouped.get(id) ?? { ...range, amountMinor: 0n };
    current.amountMinor += fact.amountMinor;
    grouped.set(id, current);
  }
  return [...grouped.values()]
    .sort(
      (left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end),
    )
    .map((group) => ({
      periodStart: group.start,
      periodEnd: group.end,
      boundarySource: group.source,
      expenseMinor: formatMinorUnits(group.amountMinor),
      journalFilters: { from: group.start, to: group.end, type: 'EXPENSE' },
    }));
}

function cycleTotals(facts: FactRow[], type: 'INCOME' | 'EXPENSE', resolve: Resolve) {
  const grouped = new Map<string, { start: string; end: string; amountMinor: bigint }>();
  for (const fact of facts) {
    if (fact.transactionType !== type) continue;
    const { cycle } = resolve(fact.occurredOn);
    const current = grouped.get(cycle.start) ?? { ...cycle, amountMinor: 0n };
    current.amountMinor += fact.amountMinor;
    grouped.set(cycle.start, current);
  }
  return [...grouped.values()]
    .sort((left, right) => left.start.localeCompare(right.start))
    .map((group) => ({
      cycleStart: group.start,
      cycleEnd: group.end,
      [type === 'EXPENSE' ? 'expenseMinor' : 'incomeMinor']: formatMinorUnits(group.amountMinor),
      journalFilters: { from: group.start, to: group.end, type },
    }));
}

function netCashFlow(facts: FactRow[], resolve: Resolve) {
  const grouped = new Map<
    string,
    { start: string; end: string; incomeMinor: bigint; expenseMinor: bigint }
  >();
  for (const fact of facts) {
    const { cycle } = resolve(fact.occurredOn);
    const current = grouped.get(cycle.start) ?? {
      ...cycle,
      incomeMinor: 0n,
      expenseMinor: 0n,
    };
    if (fact.transactionType === 'INCOME') current.incomeMinor += fact.amountMinor;
    else current.expenseMinor += fact.amountMinor;
    grouped.set(cycle.start, current);
  }
  return [...grouped.values()]
    .sort((left, right) => left.start.localeCompare(right.start))
    .map((group) => ({
      cycleStart: group.start,
      cycleEnd: group.end,
      incomeMinor: formatMinorUnits(group.incomeMinor),
      expenseMinor: formatMinorUnits(group.expenseMinor),
      netCashFlowMinor: formatMinorUnits(group.incomeMinor - group.expenseMinor),
      journalFilters: { from: group.start, to: group.end },
    }));
}

function goalRows(rows: SavingsGoalRow[], today: string) {
  return rows.map((row) => {
    const movedNet = row.movedInMinor - row.movedOutMinor;
    const current = row.assignedMinor + movedNet - row.spentMinor;
    const remaining = row.targetAmountMinor > current ? row.targetAmountMinor - current : 0n;
    // Total for any target: a zero target is reached by any non-negative balance (no division by
    // zero); an overspent or empty goal shows 0; progress is always capped to 0..1000.
    const permille =
      row.targetAmountMinor <= 0n
        ? current >= 0n
          ? 1000n
          : 0n
        : current <= 0n
          ? 0n
          : (current * 1000n) / row.targetAmountMinor;
    return {
      envelopeId: row.envelopeId,
      name: row.name,
      envelopeType: row.envelopeType,
      currentMinor: formatMinorUnits(current),
      targetMinor: formatMinorUnits(row.targetAmountMinor),
      targetDate: row.targetDate,
      assignedMinor: formatMinorUnits(row.assignedMinor),
      movedNetMinor: formatMinorUnits(movedNet),
      spentMinor: formatMinorUnits(row.spentMinor),
      remainingMinor: formatMinorUnits(remaining),
      progressPermille: Number(permille > 1000n ? 1000n : permille),
      isReached: current >= row.targetAmountMinor,
      daysRemaining: row.targetDate ? calendarDaysBetween(today, row.targetDate) : null,
    };
  });
}

function calendarDaysBetween(start: string, end: string): number {
  return (
    (new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) /
    86_400_000
  );
}

function planVsActualRows(occurrences: PlanOccurrenceFact[]) {
  const grouped = new Map<
    string,
    {
      planName: string;
      planType: 'INCOME' | 'EXPENSE';
      plannedMinor: bigint;
      actualMinor: bigint;
      plannedOccurrenceCount: number;
      confirmedOccurrenceCount: number;
    }
  >();
  for (const occurrence of occurrences) {
    const current = grouped.get(occurrence.planId) ?? {
      planName: occurrence.planName,
      planType: occurrence.planType,
      plannedMinor: 0n,
      actualMinor: 0n,
      plannedOccurrenceCount: 0,
      confirmedOccurrenceCount: 0,
    };
    current.plannedMinor += occurrence.amountMinor;
    current.plannedOccurrenceCount += 1;
    current.actualMinor += occurrence.paidMinor;
    if (occurrence.paidMinor > 0n) current.confirmedOccurrenceCount += 1;
    grouped.set(occurrence.planId, current);
  }
  return [...grouped.entries()]
    .sort(
      ([leftId, left], [rightId, right]) =>
        left.planName.localeCompare(right.planName, 'ru') || leftId.localeCompare(rightId),
    )
    .map(([planId, row]) => ({
      planId,
      planName: row.planName,
      planType: row.planType,
      plannedMinor: formatMinorUnits(row.plannedMinor),
      actualMinor: formatMinorUnits(row.actualMinor),
      varianceMinor: formatMinorUnits(row.actualMinor - row.plannedMinor),
      plannedOccurrenceCount: row.plannedOccurrenceCount,
      confirmedOccurrenceCount: row.confirmedOccurrenceCount,
    }));
}

function ledgerRows(rows: AssignmentLedgerRow[]) {
  return rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    effectiveOn: row.effectiveOn,
    amountMinor: formatMinorUnits(row.amountMinor),
    countsAsAccumulation: row.kind === 'ASSIGNMENT',
    assignmentType: row.assignmentType,
    envelopeId: row.envelopeId,
    periodId: row.periodId,
    sourceEnvelopeId: row.sourceEnvelopeId,
    sourcePeriodId: row.sourcePeriodId,
    destinationEnvelopeId: row.destinationEnvelopeId,
    destinationPeriodId: row.destinationPeriodId,
  }));
}
