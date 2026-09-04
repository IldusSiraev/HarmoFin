import { Prisma } from '@prisma/client';

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
        )::BIGINT
        FROM "accounts" AS account
        WHERE account."id" = ${accountId}::uuid
          AND account."budget_id" = ${budgetId}::uuid
      ), 0)::BIGINT AS "balanceMinor"
    `;

    return rows[0]?.balanceMinor ?? 0n;
  }

  async envelopeBalance(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<{ balanceMinor: bigint }[]>`
      SELECT COALESCE((
        SELECT (
          envelope."starting_balance_minor"
          + COALESCE((
            SELECT SUM(allocation."amount_minor")
            FROM "income_allocations" AS allocation
            WHERE allocation."budget_id" = ${budgetId}::uuid
              AND allocation."envelope_id" = ${envelopeId}::uuid
              AND allocation."status" = 'CONFIRMED'
          ), 0)
          - COALESCE((
            SELECT SUM(transaction."amount_minor")
            FROM "transactions" AS transaction
            WHERE transaction."budget_id" = ${budgetId}::uuid
              AND transaction."envelope_id" = ${envelopeId}::uuid
              AND transaction."transaction_type" = 'EXPENSE'
              AND transaction."status" = 'CONFIRMED'
          ), 0)
        )::BIGINT
        FROM "envelopes" AS envelope
        WHERE envelope."id" = ${envelopeId}::uuid
          AND envelope."budget_id" = ${budgetId}::uuid
      ), 0)::BIGINT AS "balanceMinor"
    `;

    return rows[0]?.balanceMinor ?? 0n;
  }
}
