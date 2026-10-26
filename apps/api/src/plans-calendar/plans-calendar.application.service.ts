import { Prisma, type PlanOccurrenceStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';

import { formatMinorUnits } from '../common/money/minor-units.js';
import type { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import type { PrismaService } from '../database/prisma.service.js';
import { computeUnpaidMinor } from '../obligations/obligation.application.service.js';
import { ObligationPlanRepository } from '../obligations/obligation-plan.repository.js';
import { IncomePlanRepository } from '../plans/income-plan-v2.repository.js';
import {
  buildDays,
  isOverdue,
  monthWindow,
  plannedTotals,
  previousDay,
  settlementOf,
  type CalendarDot,
  type CalendarItemKind,
  type PlannedItem,
  type Settlement,
} from './plans-calendar.domain.js';
import {
  PlansCalendarRepository,
  type CompletedOccurrenceRow,
} from './plans-calendar.repository.js';
import type { PlansCalendarQuery } from './plans-calendar.schemas.js';

const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const OPEN: PlanOccurrenceStatus[] = ['PENDING', 'DUE'];

export interface PlansCalendarItemView {
  kind: CalendarItemKind;
  occurrenceId: string;
  planId: string;
  name: string;
  scheduledOn: string;
  status: string;
  expectedMinor: string;
  paidMinor: string;
  unpaidMinor: string;
  categoryId: string | null;
  overdue: boolean;
  transactionId: string | null;
  /** COMPLETED with a confirmed fact: date of the latest fact, the plan is shown on it. */
  factOn: string | null;
  /** Sum of the confirmed facts that settled the plan. */
  factMinor: string | null;
  /** Confirmed operations that settled the plan; the day list shows them as this plan. */
  factTransactionIds: string[];
}

export interface PlansCalendarView {
  month: string;
  today: string;
  days: Array<{
    date: string;
    incomeMinor: string;
    expenseMinor: string;
    dot: CalendarDot | null;
  }>;
  items: PlansCalendarItemView[];
  overdue: PlansCalendarItemView[];
  overdueCount: number;
  totals: {
    plannedIncomeMinor: string;
    plannedExpenseMinor: string;
    balanceMinor: string;
    activePlanCount: number;
  };
}

type ObligationRow = Awaited<ReturnType<ObligationPlanRepository['listOccurrences']>>[number];
type IncomeRow = Awaited<ReturnType<IncomePlanRepository['listOccurrences']>>[number];

export class PlansCalendarApplicationService {
  private readonly obligations = new ObligationPlanRepository();
  private readonly incomes = new IncomePlanRepository();

  constructor(
    private readonly prisma: PrismaService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly repository = new PlansCalendarRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async calendar(
    userId: string,
    budgetId: string,
    query: PlansCalendarQuery,
  ): Promise<PlansCalendarView> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const window = monthWindow(query.month);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const budget = await tx.budget.findFirst({
          where: { id: budgetId, workspaceId: model.workspaceId },
          select: { timezone: true },
        });
        if (!budget) {
          throw new NotFoundException({
            code: 'RESOURCE_NOT_FOUND',
            detail: 'Бюджет не найден или недоступен для этого пользователя.',
          });
        }
        const today = todayInTimezone(this.now(), budget.timezone);
        const range = { from: dateValue(window.from), to: dateValue(window.to) };
        const [obligationRows, incomeRows, overdueRows, facts, activePlanCount, completed] =
          await Promise.all([
            this.obligations.listOccurrences(tx, budgetId, range),
            this.incomes.listOccurrences(tx, budgetId, range),
            this.obligations.listOccurrences(tx, budgetId, {
              statuses: OPEN,
              to: dateValue(previousDay(today)),
            }),
            this.repository.factsByDay(tx, budgetId, window),
            this.repository.countActivePlans(tx, budgetId),
            this.repository.completedWithFacts(tx, budgetId, window),
          ]);

        // A completed plan is shown once, on the date of the operation that settled it. One
        // scheduled in another month but settled in this one is added here; totals stay on
        // the plans scheduled in this month.
        const settlements = new Map(
          completed.map((row) => [row.id, settlementOf(row.facts)] as const),
        );
        const scheduledIds = new Set([...obligationRows, ...incomeRows].map((row) => row.id));
        const settledHere = completed.filter((row) => {
          const settlement = settlements.get(row.id);
          return (
            !scheduledIds.has(row.id) &&
            settlement != null &&
            settlement.factOn >= window.from &&
            settlement.factOn <= window.to
          );
        });
        const items = [
          ...obligationRows.map((row) =>
            this.obligationItem(row, today, settlements.get(row.id) ?? null),
          ),
          ...incomeRows.map((row) => this.incomeItem(row, settlements.get(row.id) ?? null)),
          ...settledHere.map((row) => this.settledItem(row, settlements.get(row.id)!)),
        ].sort(byDateThenName);
        const overdue = overdueRows.map((row) => this.obligationItem(row, today, null));
        const planned: PlannedItem[] = [
          ...obligationRows.map((row) => ({
            kind: 'OBLIGATION' as const,
            status: row.status,
            scheduledOn: isoDate(row.scheduledOn),
            expectedMinor: row.amountMinor,
          })),
          ...incomeRows.map((row) => ({
            kind: 'INCOME_PLAN' as const,
            status: row.status,
            scheduledOn: isoDate(row.scheduledOn),
            expectedMinor: row.amountMinor,
          })),
        ];
        const totals = plannedTotals(planned);
        return {
          month: query.month,
          today,
          days: buildDays(facts, planned, today).map((day) => ({
            date: day.date,
            incomeMinor: formatMinorUnits(day.incomeMinor),
            expenseMinor: formatMinorUnits(day.expenseMinor),
            dot: day.dot,
          })),
          items,
          overdue,
          overdueCount: overdue.length,
          totals: {
            plannedIncomeMinor: formatMinorUnits(totals.plannedIncomeMinor),
            plannedExpenseMinor: formatMinorUnits(totals.plannedExpenseMinor),
            balanceMinor: formatMinorUnits(totals.balanceMinor),
            activePlanCount,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private obligationItem(
    row: ObligationRow,
    today: string,
    settlement: Settlement | null,
  ): PlansCalendarItemView {
    const scheduledOn = isoDate(row.scheduledOn);
    return {
      kind: 'OBLIGATION',
      occurrenceId: row.id,
      planId: row.planId,
      name: row.planName,
      scheduledOn,
      status: row.status,
      expectedMinor: formatMinorUnits(row.amountMinor),
      paidMinor: formatMinorUnits(row.paidMinor),
      unpaidMinor: formatMinorUnits(computeUnpaidMinor(row.status, row.amountMinor, row.paidMinor)),
      categoryId: row.categoryId,
      overdue: isOverdue('OBLIGATION', row.status, scheduledOn, today),
      transactionId: null,
      ...settlementFields(settlement),
    };
  }

  private incomeItem(row: IncomeRow, settlement: Settlement | null): PlansCalendarItemView {
    return {
      kind: 'INCOME_PLAN',
      occurrenceId: row.id,
      planId: row.planId,
      name: row.planName,
      scheduledOn: isoDate(row.scheduledOn),
      status: row.status,
      expectedMinor: formatMinorUnits(row.amountMinor),
      paidMinor: '0',
      unpaidMinor: '0',
      categoryId: row.categoryId,
      overdue: false,
      transactionId: row.transactionId,
      ...settlementFields(settlement),
    };
  }

  private settledItem(row: CompletedOccurrenceRow, settlement: Settlement): PlansCalendarItemView {
    const income = row.planType === 'INCOME';
    return {
      kind: income ? 'INCOME_PLAN' : 'OBLIGATION',
      occurrenceId: row.id,
      planId: row.planId,
      name: row.planName,
      scheduledOn: isoDate(row.scheduledOn),
      status: 'COMPLETED',
      expectedMinor: formatMinorUnits(row.amountMinor),
      paidMinor: income ? '0' : formatMinorUnits(settlement.factMinor),
      unpaidMinor: '0',
      categoryId: row.categoryId,
      overdue: false,
      transactionId: income ? row.transactionId : null,
      ...settlementFields(settlement),
    };
  }
}

function settlementFields(
  settlement: Settlement | null,
): Pick<PlansCalendarItemView, 'factOn' | 'factMinor' | 'factTransactionIds'> {
  return {
    factOn: settlement?.factOn ?? null,
    factMinor: settlement ? formatMinorUnits(settlement.factMinor) : null,
    factTransactionIds: settlement?.transactionIds ?? [],
  };
}

function byDateThenName(a: PlansCalendarItemView, b: PlansCalendarItemView): number {
  if (a.scheduledOn !== b.scheduledOn) return a.scheduledOn < b.scheduledOn ? -1 : 1;
  return a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0;
}
