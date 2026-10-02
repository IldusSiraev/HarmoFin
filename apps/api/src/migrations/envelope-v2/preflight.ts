import { createHash } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

import { FinancialBalanceRepository } from '../../common/finance/financial-balance.repository.js';
import { todayInTimezone } from '../../cycles/cycle-period.domain.js';

export type PreflightBlocker =
  'ARCHIVED_ACCOUNT_HAS_CASH' | 'FUTURE_CONFIRMED_FACT' | 'INCONSISTENT_REFERENCES';

export type PreflightReport = {
  modelVersion: 1;
  cashByAccount: Record<string, string>;
  totalCashMinor: string;
  archivedNonZero: string[];
  futureConfirmed: string[];
  legacyEnvelopeSummary: Array<{
    envelopeId: string;
    archived: boolean;
    legacyBalanceMinor: string;
  }>;
  fingerprint: string;
  blockers: PreflightBlocker[];
  negativeEnvelopes: string[];
  archivedEnvelopes: string[];
  regularPlansForReview: Array<{
    id: string;
    planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
    envelopeId: string | null;
    isActive: boolean;
  }>;
};

const balances = new FinancialBalanceRepository();

export function runPreflight(prisma: PrismaClient, budgetId: string): Promise<PreflightReport> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return preflight(tx, budgetId);
    },
    { isolationLevel: 'RepeatableRead', maxWait: 60_000, timeout: 60_000 },
  );
}

export async function preflight(
  tx: Prisma.TransactionClient,
  budgetId: string,
): Promise<PreflightReport> {
  const budget = await tx.budget.findUnique({
    where: { id: budgetId },
    select: {
      planModelVersion: true,
      timezone: true,
      cycleStartDay: true,
      periodBoundaryOffset: true,
      allowNegativeBalance: true,
    },
  });
  if (!budget) throw new Error('BUDGET_NOT_FOUND');
  // Cross-budget references are impossible: every relation uses a composite (id, budget_id) FK.
  if (budget.planModelVersion !== 1) throw new Error('PLAN_MODEL_NOT_V1');

  const today = todayInTimezone(new Date(), budget.timezone);
  const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000);

  const accounts = await tx.account.findMany({
    where: { budgetId },
    select: { id: true, archivedAt: true, startingBalanceMinor: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
  const cashByAccount: Record<string, string> = {};
  const archivedNonZero: string[] = [];
  let total = 0n;
  for (const account of accounts) {
    const balance = await balances.accountBalance(tx, budgetId, account.id);
    cashByAccount[account.id] = balance.toString();
    total += balance;
    if (account.archivedAt !== null && balance !== 0n) archivedNonZero.push(account.id);
  }

  const envelopes = await tx.envelope.findMany({
    where: { budgetId },
    select: { id: true, archivedAt: true, startingBalanceMinor: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
  const legacyEnvelopeSummary: PreflightReport['legacyEnvelopeSummary'] = [];
  for (const envelope of envelopes) {
    const balance = await balances.envelopeBalance(tx, budgetId, envelope.id);
    legacyEnvelopeSummary.push({
      envelopeId: envelope.id,
      archived: envelope.archivedAt !== null,
      legacyBalanceMinor: balance.toString(),
    });
  }

  const futureTransactions = await tx.transaction.findMany({
    where: { budgetId, status: 'CONFIRMED', occurredOn: { gte: tomorrow } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const futureTransfers = await tx.transfer.findMany({
    where: { budgetId, status: 'CONFIRMED', occurredOn: { gte: tomorrow } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const futureConfirmed = [...futureTransactions, ...futureTransfers].map((row) => row.id).sort();

  const inconsistent = await countInconsistentReferences(tx, budgetId);

  const plans = await tx.regularPlan.findMany({
    where: { budgetId, deletedAt: null, isActive: true },
    select: { id: true, planType: true, envelopeId: true, isActive: true },
    orderBy: { id: 'asc' },
  });

  const blockers: PreflightBlocker[] = [];
  if (archivedNonZero.length > 0) blockers.push('ARCHIVED_ACCOUNT_HAS_CASH');
  if (futureConfirmed.length > 0) blockers.push('FUTURE_CONFIRMED_FACT');
  if (inconsistent > 0) blockers.push('INCONSISTENT_REFERENCES');

  return {
    modelVersion: 1,
    cashByAccount,
    totalCashMinor: total.toString(),
    archivedNonZero,
    futureConfirmed,
    legacyEnvelopeSummary,
    fingerprint: await fingerprintOf(tx, budgetId, budget),
    blockers,
    negativeEnvelopes: legacyEnvelopeSummary
      .filter((row) => BigInt(row.legacyBalanceMinor) < 0n)
      .map((row) => row.envelopeId),
    archivedEnvelopes: legacyEnvelopeSummary
      .filter((row) => row.archived)
      .map((row) => row.envelopeId),
    regularPlansForReview: plans,
  };
}

async function countInconsistentReferences(
  tx: Prisma.TransactionClient,
  budgetId: string,
): Promise<number> {
  const partsMismatch = await tx.$queryRaw<{ id: string }[]>`
    SELECT transfer."id"
    FROM "transfers" AS transfer
    LEFT JOIN (
      SELECT part."transfer_id", SUM(part."amount_minor") AS total
      FROM "transfer_parts" AS part
      WHERE part."budget_id" = ${budgetId}::uuid
      GROUP BY part."transfer_id"
    ) AS parts ON parts."transfer_id" = transfer."id"
    WHERE transfer."budget_id" = ${budgetId}::uuid
      AND transfer."status" = 'CONFIRMED'
      AND transfer."mode" = 'LEGACY_PARTS'
      AND COALESCE(parts.total, 0) <> transfer."total_minor"
  `;
  const directInvalid = await tx.$queryRaw<{ id: string }[]>`
    SELECT transfer."id"
    FROM "transfers" AS transfer
    WHERE transfer."budget_id" = ${budgetId}::uuid
      AND transfer."status" = 'CONFIRMED'
      AND transfer."mode" = 'ACCOUNT_ONLY'
      AND (
        transfer."source_account_id" IS NULL
        OR transfer."destination_account_id" IS NULL
        OR transfer."source_account_id" = transfer."destination_account_id"
      )
  `;
  const overAllocated = await tx.$queryRaw<{ id: string }[]>`
    SELECT income."id"
    FROM "transactions" AS income
    INNER JOIN (
      SELECT allocation."income_transaction_id", SUM(allocation."amount_minor") AS total
      FROM "income_allocations" AS allocation
      WHERE allocation."budget_id" = ${budgetId}::uuid
        AND allocation."status" = 'CONFIRMED'
      GROUP BY allocation."income_transaction_id"
    ) AS allocated ON allocated."income_transaction_id" = income."id"
    WHERE income."budget_id" = ${budgetId}::uuid
      AND (
        income."transaction_type" <> 'INCOME'
        OR income."status" <> 'CONFIRMED'
        OR allocated.total > income."amount_minor"
      )
  `;
  return partsMismatch.length + directInvalid.length + overAllocated.length;
}

type CycleSettings = {
  timezone: string;
  cycleStartDay: number;
  periodBoundaryOffset: number;
  allowNegativeBalance: boolean;
};

async function fingerprintOf(
  tx: Prisma.TransactionClient,
  budgetId: string,
  settings: CycleSettings,
): Promise<string> {
  const where = { budgetId };
  const orderBy = { id: 'asc' as const };
  const [
    accounts,
    envelopes,
    transactions,
    transfers,
    parts,
    allocations,
    reallocations,
    plans,
    revisions,
    assignments,
    movements,
  ] = await Promise.all([
    tx.account.findMany({
      where,
      orderBy,
      select: { id: true, updatedAt: true, archivedAt: true, startingBalanceMinor: true },
    }),
    tx.envelope.findMany({
      where,
      orderBy,
      select: { id: true, updatedAt: true, archivedAt: true, startingBalanceMinor: true },
    }),
    tx.transaction.findMany({
      where,
      orderBy,
      select: {
        id: true,
        updatedAt: true,
        status: true,
        amountMinor: true,
        occurredOn: true,
        accountId: true,
        envelopeId: true,
      },
    }),
    tx.transfer.findMany({
      where,
      orderBy,
      select: {
        id: true,
        updatedAt: true,
        status: true,
        mode: true,
        totalMinor: true,
        occurredOn: true,
        sourceAccountId: true,
        destinationAccountId: true,
      },
    }),
    tx.transferPart.findMany({
      where,
      orderBy,
      select: {
        id: true,
        updatedAt: true,
        amountMinor: true,
        sourceAccountId: true,
        destinationAccountId: true,
        sourceEnvelopeId: true,
        destinationEnvelopeId: true,
      },
    }),
    tx.incomeAllocation.findMany({
      where,
      orderBy,
      select: { id: true, updatedAt: true, status: true, amountMinor: true, envelopeId: true },
    }),
    tx.envelopeReallocation.findMany({
      where,
      orderBy,
      select: { id: true, updatedAt: true, status: true, amountMinor: true },
    }),
    tx.regularPlan.findMany({
      where,
      orderBy,
      select: {
        id: true,
        updatedAt: true,
        planType: true,
        isActive: true,
        deletedAt: true,
        amountMinor: true,
        envelopeId: true,
      },
    }),
    tx.budgetCycleRevision.findMany({
      where,
      orderBy,
      select: {
        id: true,
        effectiveOn: true,
        cycleStartDay: true,
        periodBoundaryOffset: true,
        timezone: true,
      },
    }),
    tx.envelopeAssignment.findMany({
      where,
      orderBy,
      select: { id: true, updatedAt: true, status: true, amountMinor: true, envelopeId: true },
    }),
    tx.envelopeMovement.findMany({
      where,
      orderBy,
      select: { id: true, updatedAt: true, status: true, amountMinor: true },
    }),
  ]);

  const canonical = JSON.stringify(
    {
      budgetId,
      cycle: settings,
      accounts,
      envelopes,
      transactions,
      transfers,
      parts,
      allocations,
      reallocations,
      plans,
      revisions,
      assignments,
      movements,
    },
    (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
  );
  return createHash('sha256').update(canonical).digest('hex');
}
