import { Prisma, type PeriodSlot } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { PrismaService } from '../database/prisma.service.js';

export type DashboardPeriod = {
  id: PeriodSlot;
  start: Date;
  end: Date;
};

type BalanceItem = {
  id: string;
  name: string;
  balanceMinor: bigint;
};

export type DashboardSummaryRecord = {
  totalAccountMoneyMinor: bigint;
  accounts: BalanceItem[];
  envelopes: BalanceItem[];
  unallocatedIncomeMinor: bigint;
  periodEnvelope: {
    id: string;
    openingMinor: bigint;
    allocatedMinor: bigint;
    reallocatedMinor: bigint;
    spentMinor: bigint;
  } | null;
  warnings: Array<{ subject: 'ACCOUNT' | 'ENVELOPE'; id: string; balanceMinor: bigint }>;
};

export class DashboardRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances = new FinancialBalanceRepository(),
  ) {}

  async findAccessible(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: {
        id: true,
        cycleStartDay: true,
        periodBoundaryOffset: true,
        timezone: true,
      },
    });
  }

  async summary(
    userId: string,
    budgetId: string,
    period: DashboardPeriod,
    asOf: Date,
  ): Promise<DashboardSummaryRecord> {
    return this.prisma.$transaction(async (tx) => {
      const [accounts, envelopes, periodEnvelope, unallocatedIncomeMinor] = await Promise.all([
        tx.account.findMany({
          where: { budgetId, archivedAt: null, budget: activeBudgetWhere(userId, budgetId) },
          select: { id: true, name: true },
          orderBy: [{ createdAt: 'asc' }],
        }),
        tx.envelope.findMany({
          where: { budgetId, archivedAt: null, budget: activeBudgetWhere(userId, budgetId) },
          select: { id: true, name: true },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        tx.envelope.findFirst({
          where: {
            budgetId,
            archivedAt: null,
            periodSlot: period.id,
            budget: activeBudgetWhere(userId, budgetId),
          },
          select: { id: true },
        }),
        unallocatedIncome(tx, budgetId),
      ]);
      const accountBalances = await Promise.all(
        accounts.map(async (account) => ({
          ...account,
          balanceMinor: await this.balances.accountBalance(tx, budgetId, account.id),
        })),
      );
      const envelopeBalances = await Promise.all(
        envelopes.map(async (envelope) => ({
          ...envelope,
          balanceMinor: await this.balances.envelopeBalance(tx, budgetId, envelope.id),
        })),
      );
      const periodValues = periodEnvelope
        ? await periodEnvelopeSummary(tx, budgetId, periodEnvelope.id, period.start, asOf)
        : null;
      const warnings = [
        ...accountBalances
          .filter((account) => account.balanceMinor < 0n)
          .map((account) => ({
            subject: 'ACCOUNT' as const,
            id: account.id,
            balanceMinor: account.balanceMinor,
          })),
        ...envelopeBalances
          .filter((envelope) => envelope.balanceMinor < 0n)
          .map((envelope) => ({
            subject: 'ENVELOPE' as const,
            id: envelope.id,
            balanceMinor: envelope.balanceMinor,
          })),
      ];

      return {
        totalAccountMoneyMinor: accountBalances.reduce(
          (total, account) => total + account.balanceMinor,
          0n,
        ),
        accounts: accountBalances,
        envelopes: envelopeBalances,
        unallocatedIncomeMinor,
        periodEnvelope:
          periodEnvelope && periodValues ? { id: periodEnvelope.id, ...periodValues } : null,
        warnings,
      };
    });
  }
}

async function unallocatedIncome(tx: Prisma.TransactionClient, budgetId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<{ amountMinor: bigint }[]>`
    SELECT (
      COALESCE((
        SELECT SUM(transaction."amount_minor")
        FROM "transactions" AS transaction
        WHERE transaction."budget_id" = ${budgetId}::uuid
          AND transaction."transaction_type" = 'INCOME'
          AND transaction."status" = 'CONFIRMED'
      ), 0)
      - COALESCE((
        SELECT SUM(allocation."amount_minor")
        FROM "income_allocations" AS allocation
        WHERE allocation."budget_id" = ${budgetId}::uuid
          AND allocation."status" = 'CONFIRMED'
      ), 0)
    )::BIGINT AS "amountMinor"
  `;
  return rows[0]?.amountMinor ?? 0n;
}

async function periodEnvelopeSummary(
  tx: Prisma.TransactionClient,
  budgetId: string,
  envelopeId: string,
  periodStart: Date,
  asOf: Date,
) {
  const rows = await tx.$queryRaw<
    Array<{
      openingMinor: bigint;
      allocatedMinor: bigint;
      reallocatedMinor: bigint;
      spentMinor: bigint;
    }>
  >`
    SELECT
      (
        envelope."starting_balance_minor"
        + COALESCE((
          SELECT SUM(allocation."amount_minor")
          FROM "income_allocations" AS allocation
          WHERE allocation."budget_id" = ${budgetId}::uuid
            AND allocation."envelope_id" = ${envelopeId}::uuid
            AND allocation."status" = 'CONFIRMED'
            AND allocation."occurred_on" < ${periodStart}::date
        ), 0)
        - COALESCE((
          SELECT SUM(transaction."amount_minor")
          FROM "transactions" AS transaction
          WHERE transaction."budget_id" = ${budgetId}::uuid
            AND transaction."envelope_id" = ${envelopeId}::uuid
            AND transaction."transaction_type" = 'EXPENSE'
            AND transaction."status" = 'CONFIRMED'
            AND transaction."occurred_on" < ${periodStart}::date
        ), 0)
        - COALESCE((
          SELECT SUM(part."amount_minor")
          FROM "transfer_parts" AS part
          INNER JOIN "transfers" AS transfer
            ON transfer."id" = part."transfer_id"
            AND transfer."budget_id" = part."budget_id"
          WHERE part."budget_id" = ${budgetId}::uuid
            AND transfer."status" = 'CONFIRMED'
            AND part."source_envelope_id" = ${envelopeId}::uuid
            AND transfer."occurred_on" < ${periodStart}::date
        ), 0)
        + COALESCE((
          SELECT SUM(part."amount_minor")
          FROM "transfer_parts" AS part
          INNER JOIN "transfers" AS transfer
            ON transfer."id" = part."transfer_id"
            AND transfer."budget_id" = part."budget_id"
          WHERE part."budget_id" = ${budgetId}::uuid
            AND transfer."status" = 'CONFIRMED'
            AND part."destination_envelope_id" = ${envelopeId}::uuid
            AND transfer."occurred_on" < ${periodStart}::date
        ), 0)
      )::BIGINT AS "openingMinor",
      COALESCE((
        SELECT SUM(allocation."amount_minor")
        FROM "income_allocations" AS allocation
        WHERE allocation."budget_id" = ${budgetId}::uuid
          AND allocation."envelope_id" = ${envelopeId}::uuid
          AND allocation."status" = 'CONFIRMED'
          AND allocation."occurred_on" >= ${periodStart}::date
          AND allocation."occurred_on" <= ${asOf}::date
      ), 0)::BIGINT AS "allocatedMinor",
      (
        COALESCE((
          SELECT SUM(part."amount_minor")
          FROM "transfer_parts" AS part
          INNER JOIN "transfers" AS transfer
            ON transfer."id" = part."transfer_id"
            AND transfer."budget_id" = part."budget_id"
          WHERE part."budget_id" = ${budgetId}::uuid
            AND transfer."status" = 'CONFIRMED'
            AND part."destination_envelope_id" = ${envelopeId}::uuid
            AND part."source_envelope_id" <> part."destination_envelope_id"
            AND transfer."occurred_on" >= ${periodStart}::date
            AND transfer."occurred_on" <= ${asOf}::date
        ), 0)
        - COALESCE((
          SELECT SUM(part."amount_minor")
          FROM "transfer_parts" AS part
          INNER JOIN "transfers" AS transfer
            ON transfer."id" = part."transfer_id"
            AND transfer."budget_id" = part."budget_id"
          WHERE part."budget_id" = ${budgetId}::uuid
            AND transfer."status" = 'CONFIRMED'
            AND part."source_envelope_id" = ${envelopeId}::uuid
            AND part."source_envelope_id" <> part."destination_envelope_id"
            AND transfer."occurred_on" >= ${periodStart}::date
            AND transfer."occurred_on" <= ${asOf}::date
        ), 0)
      )::BIGINT AS "reallocatedMinor",
      COALESCE((
        SELECT SUM(transaction."amount_minor")
        FROM "transactions" AS transaction
        WHERE transaction."budget_id" = ${budgetId}::uuid
          AND transaction."envelope_id" = ${envelopeId}::uuid
          AND transaction."transaction_type" = 'EXPENSE'
          AND transaction."status" = 'CONFIRMED'
          AND transaction."occurred_on" >= ${periodStart}::date
          AND transaction."occurred_on" <= ${asOf}::date
      ), 0)::BIGINT AS "spentMinor"
    FROM "envelopes" AS envelope
    WHERE envelope."id" = ${envelopeId}::uuid
      AND envelope."budget_id" = ${budgetId}::uuid
  `;
  return rows[0] ?? null;
}

function activeBudgetWhere(userId: string, budgetId: string) {
  return {
    id: budgetId,
    status: 'ACTIVE' as const,
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true } },
    },
  };
}
