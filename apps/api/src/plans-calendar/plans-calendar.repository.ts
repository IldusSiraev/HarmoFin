import type { Prisma } from '@prisma/client';

import { mandatoryPlanFilter } from '../obligations/obligation-plan.repository.js';
import { incomePlanFilter } from '../plans/income-plan-v2.repository.js';
import type { FactRow, MonthWindow } from './plans-calendar.domain.js';

const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

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

  /** Active mandatory-expense and income plans of the budget. */
  countActivePlans(db: Prisma.TransactionClient, budgetId: string): Promise<number> {
    return db.regularPlan.count({
      where: {
        isActive: true,
        OR: [mandatoryPlanFilter(budgetId), incomePlanFilter(budgetId)],
      },
    });
  }
}
