import { Injectable } from '@nestjs/common';

import { cycleAndPeriodFor } from '../cycles/cycle-period.domain.js';
import { formatMinorUnits } from '../common/money/minor-units.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { ReportRepository } from './report.repository.js';
import type { ReportFilters, ReportKey } from './report.schemas.js';

export type ReportResponse = {
  key: ReportKey;
  rows: Array<Record<string, unknown>>;
};

@Injectable()
export class ReportApplicationService {
  constructor(private readonly repository: ReportRepository) {}

  async get(
    userId: string,
    budgetId: string,
    key: ReportKey,
    filters: ReportFilters,
  ): Promise<ReportResponse> {
    const budget = await this.repository.findAccessible(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (!(await this.repository.validateReferences(budgetId, filters))) throw resourceNotFound();

    if (key === 'account-balances') {
      return {
        key,
        rows: balanceRows(await this.repository.accountBalances(budgetId), 'accountId'),
      };
    }
    if (key === 'envelope-balances') {
      return {
        key,
        rows: balanceRows(await this.repository.envelopeBalances(budgetId), 'envelopeId'),
      };
    }
    if (key === 'savings-goals') {
      return { key, rows: goalRows(await this.repository.savingsGoals(budgetId)) };
    }
    if (key === 'plan-vs-actual') {
      return { key, rows: planVsActualRows(await this.repository.planOccurrences(budgetId, filters)) };
    }

    const [transactions, transferParts] = await Promise.all([
      this.repository.transactions(budgetId, filters),
      key === 'savings-reallocation-by-cycle'
        ? this.repository.transferParts(budgetId, filters)
        : Promise.resolve([]),
    ]);
    if (key === 'expenses-by-category') return { key, rows: expensesByCategory(transactions) };
    if (key === 'expenses-by-period') return { key, rows: expensesByPeriod(transactions, budget) };
    if (key === 'expenses-by-cycle') return { key, rows: expensesByCycle(transactions, budget) };
    if (key === 'incomes-by-cycle') return { key, rows: incomesByCycle(transactions, budget) };
    if (key === 'savings-reallocation-by-cycle') {
      return { key, rows: savingsReallocationByCycle(transferParts, budget) };
    }
    return { key, rows: netCashFlow(transactions, budget) };
  }
}

type TransactionRow = {
  id: string;
  transactionType: 'INCOME' | 'EXPENSE';
  amountMinor: bigint;
  occurredOn: Date;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  category: { name: string };
};

type CycleSettings = { cycleStartDay: number; periodBoundaryOffset: number; timezone: string };

type PlanOccurrenceRow = {
  planId: string;
  planName: string;
  planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
  amountMinor: bigint;
  status: 'PENDING' | 'DUE' | 'SKIPPED' | 'COMPLETED' | 'CANCELLED';
  accountId: string | null;
  categoryId: string | null;
  envelopeId: string | null;
  transaction: { status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED'; amountMinor: bigint } | null;
};

export type PlanVsActualRow = {
  planId: string;
  planName: string;
  planType: 'INCOME' | 'EXPENSE';
  plannedMinor: string;
  actualMinor: string;
  varianceMinor: string;
  plannedOccurrenceCount: number;
  confirmedOccurrenceCount: number;
  journalFilters: { planId: string; status: 'CONFIRMED' };
};

function planVsActualRows(rows: PlanOccurrenceRow[]): PlanVsActualRow[] {
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

  for (const row of rows) {
    if (row.status === 'CANCELLED' || row.planType === 'SAVINGS') continue;
    const current = grouped.get(row.planId) ?? {
      planName: row.planName,
      planType: row.planType,
      plannedMinor: 0n,
      actualMinor: 0n,
      plannedOccurrenceCount: 0,
      confirmedOccurrenceCount: 0,
    };
    current.plannedMinor += row.amountMinor;
    current.plannedOccurrenceCount += 1;
    if (row.transaction?.status === 'CONFIRMED') {
      current.actualMinor += row.transaction.amountMinor;
      current.confirmedOccurrenceCount += 1;
    }
    grouped.set(row.planId, current);
  }

  return [...grouped.entries()]
    .sort(([leftId, left], [rightId, right]) => {
      const comparison = left.planName.localeCompare(right.planName, 'ru');
      return comparison === 0 ? leftId.localeCompare(rightId) : comparison;
    })
    .map(([planId, row]) => ({
      planId,
      planName: row.planName,
      planType: row.planType,
      plannedMinor: formatMinorUnits(row.plannedMinor),
      actualMinor: formatMinorUnits(row.actualMinor),
      varianceMinor: formatMinorUnits(row.actualMinor - row.plannedMinor),
      plannedOccurrenceCount: row.plannedOccurrenceCount,
      confirmedOccurrenceCount: row.confirmedOccurrenceCount,
      journalFilters: { planId, status: 'CONFIRMED' },
    }));
}

function expensesByCategory(rows: TransactionRow[]) {
  const grouped = new Map<string, { id: string; name: string; amountMinor: bigint }>();
  for (const row of rows.filter((row) => row.transactionType === 'EXPENSE')) {
    const current = grouped.get(row.categoryId) ?? {
      id: row.categoryId,
      name: row.category.name,
      amountMinor: 0n,
    };
    current.amountMinor += row.amountMinor;
    grouped.set(row.categoryId, current);
  }
  return [...grouped.values()]
    .sort((left, right) =>
      right.amountMinor > left.amountMinor
        ? 1
        : right.amountMinor < left.amountMinor
          ? -1
          : left.name.localeCompare(right.name, 'ru'),
    )
    .map((row) => ({
      categoryId: row.id,
      categoryName: row.name,
      expenseMinor: formatMinorUnits(row.amountMinor),
      journalFilters: { categoryId: row.id, type: 'EXPENSE' },
    }));
}

function expensesByPeriod(rows: TransactionRow[], settings: CycleSettings) {
  return cycleGroups(
    rows.filter((row) => row.transactionType === 'EXPENSE'),
    settings,
    'period',
  ).map((group) => ({
    periodId: group.id,
    periodStart: group.start,
    periodEnd: group.end,
    expenseMinor: formatMinorUnits(group.amountMinor),
    journalFilters: { from: group.start, to: group.end, type: 'EXPENSE' },
  }));
}

function expensesByCycle(rows: TransactionRow[], settings: CycleSettings) {
  return cycleGroups(
    rows.filter((row) => row.transactionType === 'EXPENSE'),
    settings,
    'cycle',
  ).map((group) => ({
    cycleStart: group.start,
    cycleEnd: group.end,
    expenseMinor: formatMinorUnits(group.amountMinor),
    journalFilters: { from: group.start, to: group.end, type: 'EXPENSE' },
  }));
}

function incomesByCycle(rows: TransactionRow[], settings: CycleSettings) {
  return cycleGroups(
    rows.filter((row) => row.transactionType === 'INCOME'),
    settings,
    'cycle',
  ).map((group) => ({
    cycleStart: group.start,
    cycleEnd: group.end,
    incomeMinor: formatMinorUnits(group.amountMinor),
    journalFilters: { from: group.start, to: group.end, type: 'INCOME' },
  }));
}

function netCashFlow(rows: TransactionRow[], settings: CycleSettings) {
  const grouped = new Map<
    string,
    { start: string; end: string; incomeMinor: bigint; expenseMinor: bigint }
  >();
  for (const row of rows) {
    const cycle = cycleAndPeriodFor(settings, dateText(row.occurredOn)).cycle;
    const current = grouped.get(cycle.start) ?? {
      start: cycle.start,
      end: cycle.end,
      incomeMinor: 0n,
      expenseMinor: 0n,
    };
    if (row.transactionType === 'INCOME') current.incomeMinor += row.amountMinor;
    else current.expenseMinor += row.amountMinor;
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

function savingsReallocationByCycle(
  rows: Array<{
    amountMinor: bigint;
    sourceEnvelopeId: string;
    destinationEnvelopeId: string;
    transfer: { occurredOn: Date };
  }>,
  settings: CycleSettings,
) {
  const grouped = new Map<string, { start: string; end: string; amountMinor: bigint }>();
  for (const row of rows) {
    if (row.sourceEnvelopeId === row.destinationEnvelopeId) continue;
    const cycle = cycleAndPeriodFor(settings, dateText(row.transfer.occurredOn)).cycle;
    const current = grouped.get(cycle.start) ?? {
      start: cycle.start,
      end: cycle.end,
      amountMinor: 0n,
    };
    current.amountMinor += row.amountMinor;
    grouped.set(cycle.start, current);
  }
  return [...grouped.values()]
    .sort((left, right) => left.start.localeCompare(right.start))
    .map((group) => ({
      cycleStart: group.start,
      cycleEnd: group.end,
      reallocatedMinor: formatMinorUnits(group.amountMinor),
      journalFilters: { from: group.start, to: group.end },
    }));
}

function cycleGroups(rows: TransactionRow[], settings: CycleSettings, unit: 'cycle' | 'period') {
  const grouped = new Map<
    string,
    { id: string; start: string; end: string; amountMinor: bigint }
  >();
  for (const row of rows) {
    const value = cycleAndPeriodFor(settings, dateText(row.occurredOn));
    const range = unit === 'cycle' ? value.cycle : value.period;
    const id = unit === 'cycle' ? range.start : `${value.period.id}:${range.start}`;
    const current = grouped.get(id) ?? {
      id: unit === 'cycle' ? range.start : value.period.id,
      start: range.start,
      end: range.end,
      amountMinor: 0n,
    };
    current.amountMinor += row.amountMinor;
    grouped.set(id, current);
  }
  return [...grouped.values()].sort((left, right) => left.start.localeCompare(right.start));
}

function balanceRows(
  rows: Array<{ id: string; name: string; balanceMinor: bigint }>,
  idKey: 'accountId' | 'envelopeId',
) {
  return rows.map((row) => ({
    [idKey]: row.id,
    name: row.name,
    balanceMinor: formatMinorUnits(row.balanceMinor),
    journalFilters: { [idKey]: row.id },
  }));
}

function goalRows(
  rows: Array<{
    id: string;
    name: string;
    balanceMinor: bigint;
    targetAmountMinor: bigint | null;
    targetDate: Date | null;
  }>,
) {
  return rows.map((row) => ({
    envelopeId: row.id,
    name: row.name,
    currentMinor: formatMinorUnits(row.balanceMinor),
    targetMinor: row.targetAmountMinor === null ? null : formatMinorUnits(row.targetAmountMinor),
    targetDate: row.targetDate?.toISOString().slice(0, 10) ?? null,
    journalFilters: { envelopeId: row.id },
  }));
}

function dateText(value: Date): string {
  return value.toISOString().slice(0, 10);
}
