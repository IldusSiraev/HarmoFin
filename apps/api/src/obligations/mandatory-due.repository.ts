import type { Prisma } from '@prisma/client';

import type { RegularPlanRepository } from '../plans/regular-plan.repository.js';
import type { V2OccurrenceMaterializer } from '../plans/v2-occurrence-materializer.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, name: string): string {
  const parsed = DATE_PATTERN.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${name} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

export type MandatoryDueSlices = {
  /** Unpaid total of the protection horizon [.., nextPeriodEnd]. */
  totalMinor: bigint;
  /** Unpaid part scheduled on or before `currentPeriodEnd` (includes overdue). */
  currentSliceMinor: bigint;
  /** Unpaid part scheduled in (currentPeriodEnd, nextPeriodEnd]. */
  nextSliceMinor: bigint;
};

/**
 * Read model of mandatory-envelope needs, derived from v2 plan occurrences.
 * Only budgets on plan model 2 are supported; for model 1 budgets both methods return 0n.
 */
export class MandatoryDueRepository {
  constructor(
    private readonly plans: Pick<RegularPlanRepository, 'findBudgetPlanModel'>,
    private readonly materializer: Pick<V2OccurrenceMaterializer, 'ensureOccurrences'>,
  ) {}

  /**
   * Unpaid amount of open (PENDING|DUE) mandatory EXPENSE occurrences scheduled on or before
   * `nextPeriodEnd`, including overdue ones with no lower bound. Per occurrence the unpaid part is
   * GREATEST(0, expected - sum of CONFIRMED, not deleted PlanPayment transactions). Future income is
   * never included. SKIPPED, CANCELLED and COMPLETED occurrences are excluded.
   *
   * The caller MUST hold the budget row lock (SELECT ... FOR UPDATE on the budget) inside `tx`:
   * missing occurrences up to `nextPeriodEnd` are materialized here first, so a new period does not
   * depend on the worker. `asOf` is the calculation date (it only decides DUE vs PENDING for rows
   * that get materialized).
   */
  async mandatoryDue(
    tx: Prisma.TransactionClient,
    budgetId: string,
    asOf: string,
    currentPeriodEnd: string,
    nextPeriodEnd: string,
  ): Promise<MandatoryDueSlices> {
    assertIsoDate(asOf, 'asOf');
    assertIsoDate(currentPeriodEnd, 'currentPeriodEnd');
    assertIsoDate(nextPeriodEnd, 'nextPeriodEnd');
    const budget = await this.plans.findBudgetPlanModel(tx, budgetId);
    if (!budget || budget.planModelVersion !== 2 || !budget.planModelActivatedOn) {
      return { totalMinor: 0n, currentSliceMinor: 0n, nextSliceMinor: 0n };
    }
    await this.materializer.ensureOccurrences(
      tx,
      budgetId,
      budget.planModelActivatedOn.toISOString().slice(0, 10),
      nextPeriodEnd,
      { now: new Date(`${asOf}T12:00:00.000Z`) },
    );
    // One pass over the protection horizon; the same unpaid amount is split by `scheduled_on`
    // into the current slice (on or before `currentPeriodEnd`, overdue included) and the next one.
    const rows = await tx.$queryRaw<
      Array<{ total: bigint | null; current: bigint | null; next: bigint | null }>
    >`
      SELECT
        COALESCE(SUM(gap), 0)::bigint AS "total",
        COALESCE(SUM(CASE WHEN "scheduled_on" <= ${currentPeriodEnd}::date THEN gap ELSE 0 END), 0)::bigint AS "current",
        COALESCE(SUM(CASE WHEN "scheduled_on" > ${currentPeriodEnd}::date THEN gap ELSE 0 END), 0)::bigint AS "next"
      FROM (
        SELECT o."scheduled_on",
          GREATEST(0, o."amount_minor" - COALESCE(paid."paid_minor", 0)) AS gap
        FROM "plan_occurrences" o
        JOIN "envelopes" e
          ON e."id" = o."envelope_id" AND e."budget_id" = o."budget_id"
        LEFT JOIN LATERAL (
          SELECT SUM(t."amount_minor") AS "paid_minor"
          FROM "plan_payments" pp
          JOIN "transactions" t
            ON t."id" = pp."transaction_id" AND t."budget_id" = pp."budget_id"
          WHERE pp."occurrence_id" = o."id"
            AND pp."budget_id" = o."budget_id"
            AND t."status" = 'CONFIRMED'
            AND t."deleted_at" IS NULL
        ) paid ON true
        WHERE o."budget_id" = ${budgetId}::uuid
          AND o."plan_type" = 'EXPENSE'
          AND o."status" IN ('PENDING', 'DUE')
          AND o."scheduled_on" <= ${nextPeriodEnd}::date
          AND e."envelope_type" = 'MANDATORY_EXPENSES'
          AND e."archived_at" IS NULL
      ) unpaid
    `;
    const row = rows[0] ?? { total: 0n, current: 0n, next: 0n };
    return {
      totalMinor: row.total ?? 0n,
      currentSliceMinor: row.current ?? 0n,
      nextSliceMinor: row.next ?? 0n,
    };
  }

  /**
   * Planned (expected) total of mandatory EXPENSE occurrences scheduled within
   * [periodStart, periodEnd], excluding CANCELLED and SKIPPED. COMPLETED ones stay as historical
   * plan total. Reads only existing occurrences: nothing is projected beyond the materialized
   * horizon, so future repeats are never doubled.
   */
  async mandatoryPlanTotal(
    tx: Prisma.TransactionClient,
    budgetId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<bigint> {
    assertIsoDate(periodStart, 'periodStart');
    assertIsoDate(periodEnd, 'periodEnd');
    const budget = await this.plans.findBudgetPlanModel(tx, budgetId);
    if (!budget || budget.planModelVersion !== 2) return 0n;
    const rows = await tx.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(SUM(o."amount_minor"), 0)::bigint AS "total"
      FROM "plan_occurrences" o
      JOIN "envelopes" e
        ON e."id" = o."envelope_id" AND e."budget_id" = o."budget_id"
      WHERE o."budget_id" = ${budgetId}::uuid
        AND o."plan_type" = 'EXPENSE'
        AND o."status" IN ('PENDING', 'DUE', 'COMPLETED')
        AND o."scheduled_on" BETWEEN ${periodStart}::date AND ${periodEnd}::date
        AND e."envelope_type" = 'MANDATORY_EXPENSES'
        AND e."archived_at" IS NULL
    `;
    return rows[0]?.total ?? 0n;
  }
}
