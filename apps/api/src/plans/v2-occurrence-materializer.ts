import type { Prisma } from '@prisma/client';

import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import {
  PlanOccurrenceRepository,
  type MaterializedOccurrence,
} from './plan-occurrence.repository.js';
import { datesForPlanV2InWindow } from './recurrence-v2.domain.js';
import { RegularPlanRepository } from './regular-plan.repository.js';

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * Idempotently materializes occurrences of active mandatory EXPENSE and INCOME plans (not SAVINGS) for a v2 budget inside
 * the caller's transaction. Effective start = max(plan.startOn, planModelActivatedOn, from), so
 * pre-cutover months are never invented. Existing rows (open v1, paid, skipped) are untouched.
 */
export class V2OccurrenceMaterializer {
  constructor(
    private readonly plans: RegularPlanRepository,
    private readonly occurrences: PlanOccurrenceRepository,
  ) {}

  async ensureOccurrences(
    tx: Prisma.TransactionClient,
    budgetId: string,
    from: string,
    to: string,
    options: { now?: Date; source?: 'API' | 'WORKER'; actorUserId?: string | null } = {},
  ): Promise<number> {
    const budget = await this.plans.findBudgetPlanModel(tx, budgetId);
    if (!budget || budget.planModelVersion !== 2 || !budget.planModelActivatedOn) return 0;
    const activatedOn = isoDate(budget.planModelActivatedOn);
    const today = todayInTimezone(options.now ?? new Date(), budget.timezone);
    const windowFrom = maxDate(from, activatedOn);
    if (to < windowFrom) return 0;

    const plans = await this.plans.lockMaterializablePlans(tx, budgetId, dateValue(to));
    if (plans.length === 0) return 0;
    const existing = await this.occurrences.findExistingSchedule(
      tx,
      budgetId,
      plans.map((plan) => plan.id),
      dateValue(windowFrom),
      dateValue(to),
    );
    const known = new Set(existing.map((row) => `${row.planId}:${isoDate(row.scheduledOn)}`));

    const missing: MaterializedOccurrence[] = [];
    for (const plan of plans) {
      const planFrom = maxDate(windowFrom, isoDate(plan.startOn));
      const dates = datesForPlanV2InWindow(
        {
          anchorOn: isoDate(plan.anchorOn),
          startOn: isoDate(plan.startOn),
          endOn: plan.endOn ? isoDate(plan.endOn) : null,
          recurrence: plan.recurrence,
          intervalMonths: plan.intervalMonths,
        },
        { from: planFrom, to },
      );
      for (const scheduledOn of dates) {
        const key = `${plan.id}:${scheduledOn}`;
        if (known.has(key)) continue;
        known.add(key);
        missing.push({
          planId: plan.id,
          scheduledOn: dateValue(scheduledOn),
          planName: plan.name,
          planType: plan.planType,
          amountMinor: plan.amountMinor,
          currency: plan.currency,
          scale: plan.scale,
          accountId: plan.accountId,
          categoryId: plan.categoryId,
          envelopeId: plan.envelopeId,
          comment: plan.comment,
          status: scheduledOn <= today ? 'DUE' : 'PENDING',
        });
      }
    }
    return this.occurrences.createMaterialized(
      tx,
      { id: budget.id, workspaceId: budget.workspaceId },
      missing,
      options.source ?? 'API',
      options.actorUserId ?? null,
    );
  }
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}
