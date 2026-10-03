import { Prisma } from '@prisma/client';

import { todayInTimezone } from '../../cycles/cycle-period.domain.js';

export class FinancialBalanceRepository {
  async accountBalance(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<{ balanceMinor: bigint }[]>`
      SELECT COALESCE((
        SELECT (
          account."starting_balance_minor"
          + COALESCE((
            SELECT SUM(transaction."amount_minor")
            FROM "transactions" AS transaction
            WHERE transaction."budget_id" = ${budgetId}::uuid
              AND transaction."account_id" = ${accountId}::uuid
              AND transaction."transaction_type" = 'INCOME'
              AND transaction."status" = 'CONFIRMED'
          ), 0)
          - COALESCE((
            SELECT SUM(transaction."amount_minor")
            FROM "transactions" AS transaction
            WHERE transaction."budget_id" = ${budgetId}::uuid
              AND transaction."account_id" = ${accountId}::uuid
              AND transaction."transaction_type" = 'EXPENSE'
              AND transaction."status" = 'CONFIRMED'
          ), 0)
          - COALESCE((
            SELECT SUM(part."amount_minor")
            FROM "transfer_parts" AS part
            INNER JOIN "transfers" AS transfer
              ON transfer."id" = part."transfer_id"
              AND transfer."budget_id" = part."budget_id"
            WHERE part."budget_id" = ${budgetId}::uuid
              AND transfer."budget_id" = ${budgetId}::uuid
              AND part."source_account_id" = ${accountId}::uuid
              AND transfer."status" = 'CONFIRMED'
          ), 0)
          - COALESCE((
            SELECT SUM(transfer."total_minor")
            FROM "transfers" AS transfer
            WHERE transfer."budget_id" = ${budgetId}::uuid
              AND transfer."source_account_id" = ${accountId}::uuid
              AND transfer."mode" = 'ACCOUNT_ONLY'
              AND transfer."status" = 'CONFIRMED'
          ), 0)
          + COALESCE((
            SELECT SUM(part."amount_minor")
            FROM "transfer_parts" AS part
            INNER JOIN "transfers" AS transfer
              ON transfer."id" = part."transfer_id"
              AND transfer."budget_id" = part."budget_id"
            WHERE part."budget_id" = ${budgetId}::uuid
              AND transfer."budget_id" = ${budgetId}::uuid
              AND part."destination_account_id" = ${accountId}::uuid
              AND transfer."status" = 'CONFIRMED'
          ), 0)
          + COALESCE((
            SELECT SUM(transfer."total_minor")
            FROM "transfers" AS transfer
            WHERE transfer."budget_id" = ${budgetId}::uuid
              AND transfer."destination_account_id" = ${accountId}::uuid
              AND transfer."mode" = 'ACCOUNT_ONLY'
              AND transfer."status" = 'CONFIRMED'
          ), 0)
        )::BIGINT
        FROM "accounts" AS account
        WHERE account."id" = ${accountId}::uuid
          AND account."budget_id" = ${budgetId}::uuid
      ), 0)::BIGINT AS "balanceMinor"
    `;

    return rows[0]?.balanceMinor ?? 0n;
  }

  // Same formula as accountBalance, but restricted to the asOf window:
  // movements with occurred_on >= accounting_start_date and < asOfExclusive.
  async accountBalanceAsOf(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
    asOf: Date,
  ): Promise<bigint> {
    const timezone = await this.requireBudgetTimezone(tx, budgetId);
    return this.accountBalanceAsOfFor(tx, budgetId, accountId, afterDayInTimezone(asOf, timezone));
  }

  // The sum of accountBalanceAsOf over every account of the budget, active and archived.
  async totalCashAsOf(tx: Prisma.TransactionClient, budgetId: string, asOf: Date): Promise<bigint> {
    const timezone = await this.requireBudgetTimezone(tx, budgetId);
    const asOfExclusive = afterDayInTimezone(asOf, timezone);
    const accounts = await tx.account.findMany({
      where: { budgetId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    let total = 0n;
    for (const account of accounts) {
      total += await this.accountBalanceAsOfFor(tx, budgetId, account.id, asOfExclusive);
    }
    return total;
  }

  private async accountBalanceAsOfFor(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
    asOfExclusive: Date,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<{ balanceMinor: bigint }[]>`
      SELECT COALESCE((
        SELECT (
          account."starting_balance_minor"
          + COALESCE((
            SELECT SUM(transaction."amount_minor")
            FROM "transactions" AS transaction
            WHERE transaction."budget_id" = ${budgetId}::uuid
              AND transaction."account_id" = ${accountId}::uuid
              AND transaction."transaction_type" = 'INCOME'
              AND transaction."status" = 'CONFIRMED'
              AND transaction."occurred_on" >= account."accounting_start_date"
              AND transaction."occurred_on" < ${asOfExclusive}::date
          ), 0)
          - COALESCE((
            SELECT SUM(transaction."amount_minor")
            FROM "transactions" AS transaction
            WHERE transaction."budget_id" = ${budgetId}::uuid
              AND transaction."account_id" = ${accountId}::uuid
              AND transaction."transaction_type" = 'EXPENSE'
              AND transaction."status" = 'CONFIRMED'
              AND transaction."occurred_on" >= account."accounting_start_date"
              AND transaction."occurred_on" < ${asOfExclusive}::date
          ), 0)
          - COALESCE((
            SELECT SUM(part."amount_minor")
            FROM "transfer_parts" AS part
            INNER JOIN "transfers" AS transfer
              ON transfer."id" = part."transfer_id"
              AND transfer."budget_id" = part."budget_id"
            WHERE part."budget_id" = ${budgetId}::uuid
              AND transfer."budget_id" = ${budgetId}::uuid
              AND part."source_account_id" = ${accountId}::uuid
              AND transfer."status" = 'CONFIRMED'
              AND transfer."occurred_on" >= account."accounting_start_date"
              AND transfer."occurred_on" < ${asOfExclusive}::date
          ), 0)
          - COALESCE((
            SELECT SUM(transfer."total_minor")
            FROM "transfers" AS transfer
            WHERE transfer."budget_id" = ${budgetId}::uuid
              AND transfer."source_account_id" = ${accountId}::uuid
              AND transfer."mode" = 'ACCOUNT_ONLY'
              AND transfer."status" = 'CONFIRMED'
              AND transfer."occurred_on" >= account."accounting_start_date"
              AND transfer."occurred_on" < ${asOfExclusive}::date
          ), 0)
          + COALESCE((
            SELECT SUM(part."amount_minor")
            FROM "transfer_parts" AS part
            INNER JOIN "transfers" AS transfer
              ON transfer."id" = part."transfer_id"
              AND transfer."budget_id" = part."budget_id"
            WHERE part."budget_id" = ${budgetId}::uuid
              AND transfer."budget_id" = ${budgetId}::uuid
              AND part."destination_account_id" = ${accountId}::uuid
              AND transfer."status" = 'CONFIRMED'
              AND transfer."occurred_on" >= account."accounting_start_date"
              AND transfer."occurred_on" < ${asOfExclusive}::date
          ), 0)
          + COALESCE((
            SELECT SUM(transfer."total_minor")
            FROM "transfers" AS transfer
            WHERE transfer."budget_id" = ${budgetId}::uuid
              AND transfer."destination_account_id" = ${accountId}::uuid
              AND transfer."mode" = 'ACCOUNT_ONLY'
              AND transfer."status" = 'CONFIRMED'
              AND transfer."occurred_on" >= account."accounting_start_date"
              AND transfer."occurred_on" < ${asOfExclusive}::date
          ), 0)
        )::BIGINT
        FROM "accounts" AS account
        WHERE account."id" = ${accountId}::uuid
          AND account."budget_id" = ${budgetId}::uuid
      ), 0)::BIGINT AS "balanceMinor"
    `;

    return rows[0]?.balanceMinor ?? 0n;
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
}

// UTC midnight of the day after the asOf calendar day in the budget timezone.
function afterDayInTimezone(asOf: Date, timezone: string): Date {
  const today = todayInTimezone(asOf, timezone);
  return new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000);
}
