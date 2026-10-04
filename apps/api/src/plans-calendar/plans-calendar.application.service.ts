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
  type CalendarDot,
  type CalendarItemKind,
  type PlannedItem,
} from './plans-calendar.domain.js';
import { PlansCalendarRepository } from './plans-calendar.repository.js';
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
        const [obligationRows, incomeRows, overdueRows, facts, activePlanCount] = await Promise.all(
          [
            this.obligations.listOccurrences(tx, budgetId, range),
            this.incomes.listOccurrences(tx, budgetId, range),
            this.obligations.listOccurrences(tx, budgetId, {
              statuses: OPEN,
              to: dateValue(previousDay(today)),
            }),
            this.repository.factsByDay(tx, budgetId, window),
            this.repository.countActivePlans(tx, budgetId),
          ],
        );

        const items = [
          ...obligationRows.map((row) => this.obligationItem(row, today)),
          ...incomeRows.map((row) => this.incomeItem(row)),
        ].sort(byDateThenName);
        const overdue = overdueRows.map((row) => this.obligationItem(row, today));
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

  private obligationItem(row: ObligationRow, today: string): PlansCalendarItemView {
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
    };
  }

  private incomeItem(row: IncomeRow): PlansCalendarItemView {
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
    };
  }
}

function byDateThenName(a: PlansCalendarItemView, b: PlansCalendarItemView): number {
  if (a.scheduledOn !== b.scheduledOn) return a.scheduledOn < b.scheduledOn ? -1 : 1;
  return a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0;
}
