import type { Prisma, RegularPlanType } from '@prisma/client';

import { mandatoryPlanFilter } from '../obligations/obligation-plan.repository.js';
import { incomePlanFilter } from '../plans/income-plan-v2.repository.js';
import type { FactRow, MonthWindow, SettlementFact } from './plans-calendar.domain.js';

const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

export interface CompletedOccurrenceRow {
  id: string;
  planId: string;
  planName: string;
  planType: RegularPlanType;
  scheduledOn: Date;
  amountMinor: bigint;
  categoryId: string | null;
  transactionId: string | null;
  ownerUserId: string;
  facts: SettlementFact[];
}

/** Data access for the plans calendar. Every query filters budget_id. */
export class PlansCalendarRepository {
  /** CONFIRMED, not deleted income and expense totals per day. Transfers are a separate table. */
  async factsByDay(
    db: Prisma.TransactionClient,
    budgetId: string,
    window: MonthWindow,
  ): Promise<FactRow[]> {
    const rows = await db.transaction.groupBy({
      by: ['occurredOn', 'transactionType'],
      where: {
        budgetId,
        status: 'CONFIRMED',
        deletedAt: null,
        occurredOn: { gte: dateValue(window.from), lte: dateValue(window.to) },
      },
      _sum: { amountMinor: true },
    });
    return rows.map((row) => ({
      date: isoDate(row.occurredOn),
      type: row.transactionType,
      amountMinor: row._sum.amountMinor ?? 0n,
    }));
  }

  /**
   * COMPLETED mandatory-expense and income occurrences scheduled in the window or settled by
   * a confirmed fact dated in the window, with those confirmed facts: obligation payments and
   * the recorded transaction of an income plan.
   */
  async completedWithFacts(
    db: Prisma.TransactionClient,
    budgetId: string,
    window: MonthWindow,
    ownerUserId?: string,
  ): Promise<CompletedOccurrenceRow[]> {
    const inWindow = { gte: dateValue(window.from), lte: dateValue(window.to) };
    const confirmed = { budgetId, status: 'CONFIRMED' as const, deletedAt: null };
    const factSelect = { id: true, occurredOn: true, amountMinor: true } as const;
    const ownerFilter = ownerUserId ? { ownerUserId } : {};
    const rows = await db.planOccurrence.findMany({
      where: {
        budgetId,
        status: 'COMPLETED',
        OR: [
          {
            planType: 'EXPENSE',
            plan: { is: { ...mandatoryPlanFilter(budgetId), ...ownerFilter } },
          },
          { planType: 'INCOME', plan: { is: { ...incomePlanFilter(budgetId), ...ownerFilter } } },
        ],
        AND: [
          {
            OR: [
              { scheduledOn: inWindow },
              { payments: { some: { transaction: { ...confirmed, occurredOn: inWindow } } } },
              { transaction: { is: { ...confirmed, occurredOn: inWindow } } },
            ],
          },
        ],
      },
      select: {
        id: true,
        planId: true,
        planName: true,
        planType: true,
        scheduledOn: true,
        amountMinor: true,
        categoryId: true,
        transactionId: true,
        plan: { select: { ownerUserId: true } },
        transaction: { select: { ...factSelect, status: true, deletedAt: true } },
        payments: {
          where: { budgetId, transaction: confirmed },
          select: { transaction: { select: factSelect } },
        },
      },
      orderBy: [{ scheduledOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => {
      const linked =
        row.planType === 'INCOME'
          ? row.transaction &&
            row.transaction.status === 'CONFIRMED' &&
            row.transaction.deletedAt === null
            ? [row.transaction]
            : []
          : row.payments.map((payment) => payment.transaction);
      return {
        id: row.id,
        planId: row.planId,
        planName: row.planName,
        planType: row.planType,
        scheduledOn: row.scheduledOn,
        amountMinor: row.amountMinor,
        categoryId: row.categoryId,
        transactionId: row.transactionId,
        ownerUserId: row.plan.ownerUserId,
        facts: linked.map((fact) => ({
          id: fact.id,
          date: isoDate(fact.occurredOn),
          amountMinor: fact.amountMinor,
        })),
      };
    });
  }

  /** Active mandatory-expense and income plans of the budget, optionally one owner. */
  countActivePlans(
    db: Prisma.TransactionClient,
    budgetId: string,
    ownerUserId?: string,
  ): Promise<number> {
    const ownerFilter = ownerUserId ? { ownerUserId } : {};
    return db.regularPlan.count({
      where: {
        isActive: true,
        OR: [
          { ...mandatoryPlanFilter(budgetId), ...ownerFilter },
          { ...incomePlanFilter(budgetId), ...ownerFilter },
        ],
      },
    });
  }

  /** Owner of the given budget plans: planId to owner user id. */
  async planOwners(
    db: Prisma.TransactionClient,
    budgetId: string,
    planIds: readonly string[],
  ): Promise<Map<string, string>> {
    const owners = await db.regularPlan.findMany({
      where: { budgetId, id: { in: [...planIds] } },
      select: { id: true, ownerUserId: true },
    });
    return new Map(owners.map((plan) => [plan.id, plan.ownerUserId]));
  }
}
