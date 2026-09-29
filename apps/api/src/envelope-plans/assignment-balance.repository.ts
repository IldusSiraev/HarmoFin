import { Prisma } from '@prisma/client';

import { todayInTimezone } from '../cycles/cycle-period.domain.js';

export type AssignmentBalance = {
  funded: bigint;
  spent: bigint;
  balance: bigint;
};

export type AssignmentBalanceRow = {
  envelopeId: string;
  periodId: string | null;
  funded: bigint;
  spent: bigint;
  balance: bigint;
};

type BalanceQueryResult = Array<{
  funded: string | bigint | number;
  spent: string | bigint | number;
}>;

type AllBalancesQueryResult = Array<{
  envelope_id: string;
  period_id: string | null;
  funded: string | bigint | number;
  spent: string | bigint | number;
}>;

export class AssignmentBalanceRepository {
  async balance(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    periodId: string | null,
    asOf: Date,
  ): Promise<AssignmentBalance> {
    const timezone = await this.requireBudgetTimezone(tx, budgetId);
    const asOfDate = new Date(`${todayInTimezone(asOf, timezone)}T00:00:00Z`);
    const period = periodId
      ? await this.requirePeriod(tx, budgetId, envelopeId, periodId)
      : null;

    const assignmentPeriodMatch = period
      ? Prisma.sql`"period_id" = ${periodId}::uuid`
      : Prisma.sql`"period_id" IS NULL`;
    const destinationPeriodMatch = period
      ? Prisma.sql`"destination_period_id" = ${periodId}::uuid`
      : Prisma.sql`"destination_period_id" IS NULL`;
    const sourcePeriodMatch = period
      ? Prisma.sql`"source_period_id" = ${periodId}::uuid`
      : Prisma.sql`"source_period_id" IS NULL`;
    const spendingWindow = period
      ? Prisma.sql`AND "occurred_on" BETWEEN ${period.startsOn} AND ${period.endsOn}`
      : Prisma.empty;

    const [row] = (await tx.$queryRaw`
      SELECT
        (
          SELECT COALESCE(SUM(a."amount_minor"), 0)
          FROM "envelope_assignments" a
          WHERE a."budget_id" = ${budgetId}::uuid
              AND a."envelope_id" = ${envelopeId}::uuid
            AND a."status" = 'CONFIRMED'
            AND ${assignmentPeriodMatch}
            AND a."effective_on" <= ${asOfDate}
        )
        + (
          SELECT COALESCE(SUM(m."amount_minor"), 0)
          FROM "envelope_movements" m
          WHERE m."budget_id" = ${budgetId}::uuid
              AND m."status" = 'CONFIRMED'
              AND m."destination_envelope_id" = ${envelopeId}::uuid
            AND ${destinationPeriodMatch}
            AND m."effective_on" <= ${asOfDate}
        )
        - (
          SELECT COALESCE(SUM(m."amount_minor"), 0)
          FROM "envelope_movements" m
          WHERE m."budget_id" = ${budgetId}::uuid
              AND m."status" = 'CONFIRMED'
              AND m."source_envelope_id" = ${envelopeId}::uuid
            AND ${sourcePeriodMatch}
            AND m."effective_on" <= ${asOfDate}
        ) AS funded,
        (
          SELECT COALESCE(SUM(t."amount_minor"), 0)
          FROM "transactions" t
          WHERE t."budget_id" = ${budgetId}::uuid
              AND t."envelope_id" = ${envelopeId}::uuid
            AND t."transaction_type" = 'EXPENSE'
            AND t."status" = 'CONFIRMED'
            AND t."accounting_model_version" = 2
            AND t."deleted_at" IS NULL
            AND t."occurred_on" <= ${asOfDate}
            ${spendingWindow}
        ) AS spent
    `) as unknown as BalanceQueryResult;

    if (!row) {
      throw new Error('Balance row not found.');
    }
    const funded = BigInt(String(row.funded));
    const spent = BigInt(String(row.spent));
    return { funded, spent, balance: funded - spent };
  }

  async allBalances(
    tx: Prisma.TransactionClient,
    budgetId: string,
    asOf: Date,
  ): Promise<AssignmentBalanceRow[]> {
    const timezone = await this.requireBudgetTimezone(tx, budgetId);
    const asOfDate = new Date(`${todayInTimezone(asOf, timezone)}T00:00:00Z`);

    const rows = (await tx.$queryRaw`
      WITH rows AS (
        SELECT e.id AS "envelope_id", p.id AS "period_id", p."starts_on", p."ends_on"
        FROM "envelope_periods" p
        JOIN "envelopes" e ON e.id = p."envelope_id" AND e."budget_id" = p."budget_id"
        WHERE p."budget_id" = ${budgetId}::uuid
          AND p."starts_on" <= ${asOfDate}
        UNION ALL
        SELECT e.id, NULL::uuid, NULL::date, NULL::date
        FROM "envelopes" e
        WHERE e."budget_id" = ${budgetId}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM "envelope_periods" p
            WHERE p."envelope_id" = e.id AND p."budget_id" = ${budgetId}::uuid
          )
      )
      SELECT
        r."envelope_id",
        r."period_id",
        (
          SELECT COALESCE(SUM(a."amount_minor"), 0)
          FROM "envelope_assignments" a
          WHERE a."budget_id" = ${budgetId}::uuid
              AND a."envelope_id" = r."envelope_id"
            AND a."status" = 'CONFIRMED'
            AND a."period_id" IS NOT DISTINCT FROM r."period_id"
            AND a."effective_on" <= ${asOfDate}
        )
        + (
          SELECT COALESCE(SUM(m."amount_minor"), 0)
          FROM "envelope_movements" m
          WHERE m."budget_id" = ${budgetId}::uuid
              AND m."status" = 'CONFIRMED'
              AND m."destination_envelope_id" = r."envelope_id"
            AND m."destination_period_id" IS NOT DISTINCT FROM r."period_id"
            AND m."effective_on" <= ${asOfDate}
        )
        - (
          SELECT COALESCE(SUM(m."amount_minor"), 0)
          FROM "envelope_movements" m
          WHERE m."budget_id" = ${budgetId}::uuid
              AND m."status" = 'CONFIRMED'
              AND m."source_envelope_id" = r."envelope_id"
            AND m."source_period_id" IS NOT DISTINCT FROM r."period_id"
            AND m."effective_on" <= ${asOfDate}
        ) AS funded,
        (
          SELECT COALESCE(SUM(t."amount_minor"), 0)
          FROM "transactions" t
          WHERE t."budget_id" = ${budgetId}::uuid
              AND t."envelope_id" = r."envelope_id"
            AND t."transaction_type" = 'EXPENSE'
            AND t."status" = 'CONFIRMED'
            AND t."accounting_model_version" = 2
            AND t."deleted_at" IS NULL
            AND t."occurred_on" <= ${asOfDate}
            AND (
              r."period_id" IS NULL
              OR (t."occurred_on" >= r."starts_on" AND t."occurred_on" <= r."ends_on")
            )
        ) AS spent
      FROM rows r
      ORDER BY r."envelope_id", r."starts_on"
    `) as unknown as AllBalancesQueryResult;

    return rows.map((row) => {
      const funded = BigInt(String(row.funded));
      const spent = BigInt(String(row.spent));
      return {
        envelopeId: String(row.envelope_id),
        periodId: row.period_id === null ? null : String(row.period_id),
        funded,
        spent,
        balance: funded - spent,
      };
    });
  }

  private async requireBudgetTimezone(
    tx: Prisma.TransactionClient,
    budgetId: string,
  ): Promise<string> {
    const budget = await tx.budget.findUnique({
      where: { id: budgetId },
      select: { timezone: true },
    });
    if (!budget) {
      throw new Error('Budget not found.');
    }
    return budget.timezone;
  }

  private async requirePeriod(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    periodId: string,
  ): Promise<{ startsOn: Date; endsOn: Date }> {
    const period = await tx.envelopePeriod.findUnique({
      where: { id: periodId, budgetId },
      select: { envelopeId: true, startsOn: true, endsOn: true },
    });
    if (!period || period.envelopeId !== envelopeId) {
      throw new Error('Envelope period not found in budget.');
    }
    return { startsOn: period.startsOn, endsOn: period.endsOn };
  }
}
