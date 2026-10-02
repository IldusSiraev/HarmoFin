import { Prisma, type PeriodSlot } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { CycleRevisionRepository } from '../cycles/cycle-revision.repository.js';
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
  unassignedStartingBalanceMinor: bigint;
  onboarding: {
    categoriesSeeded: boolean;
    hasAccounts: boolean;
    hasEnvelopeStartingBalances: boolean;
    hasAllocatedIncome: boolean;
  };
  periodEnvelope: {
    id: string;
    openingMinor: bigint;
    allocatedMinor: bigint;
    reallocatedMinor: bigint;
    spentMinor: bigint;
  } | null;
  previousPeriodLeftover: {
    envelopeId: string;
    envelopeName: string;
    balanceMinor: bigint;
    currentPeriodEnvelopeId: string;
    currentPeriodEnvelopeName: string;
  } | null;
  warnings: Array<{ subject: 'ACCOUNT' | 'ENVELOPE'; id: string; balanceMinor: bigint }>;
  upcomingObligations: Array<{
    occurrenceId: string;
    planName: string;
    scheduledOn: Date;
    amountMinor: bigint;
    currency: string;
    scale: number;
    status: 'PENDING' | 'DUE';
    envelopeId: string | null;
  }>;
};

export class DashboardRepository {
  private readonly revisions = new CycleRevisionRepository();

  constructor(
    private readonly prisma: PrismaService,
    private readonly balances = new FinancialBalanceRepository(),
  ) {}

  /** With `asOf`, cycle fields are the settings in force on that date (revisions, else Budget). */
  async findAccessible(userId: string, budgetId: string, asOf?: string) {
    const budget = await this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: {
        id: true,
        cycleStartDay: true,
        periodBoundaryOffset: true,
        timezone: true,
        allowNegativeBalance: true,
      },
    });
    if (!budget || !asOf) return budget;
    const settings = await this.revisions.settingsAt(this.prisma, budgetId, asOf);
    const nextRevisionOn = await this.revisions.nextEffectiveAfter(this.prisma, budgetId, asOf);
    return { ...budget, ...(settings ?? {}), nextRevisionOn };
  }

  async summary(
    userId: string,
    budgetId: string,
    period: DashboardPeriod,
    asOf: Date,
  ): Promise<DashboardSummaryRecord> {
    return this.prisma.$transaction(async (tx) => {
      const [
        accounts,
        envelopes,
        periodEnvelope,
        otherPeriodEnvelope,
        unallocatedIncomeMinor,
        unassignedStartingBalanceMinor,
        onboarding,
        upcomingObligations,
      ] = await Promise.all([
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
        tx.envelope.findFirst({
          where: {
            budgetId,
            archivedAt: null,
            periodSlot: period.id === 'FIRST' ? 'SECOND' : 'FIRST',
            budget: activeBudgetWhere(userId, budgetId),
          },
          select: { id: true },
        }),
        unallocatedIncome(tx, budgetId),
        unassignedStartingBalance(tx, budgetId),
        onboardingStatus(tx, budgetId),
        tx.planOccurrence.findMany({
          where: {
            budgetId,
            planType: 'EXPENSE',
            status: { in: ['PENDING', 'DUE'] },
            scheduledOn: { gte: asOf },
            budget: activeBudgetWhere(userId, budgetId),
          },
          select: {
            id: true,
            planName: true,
            scheduledOn: true,
            amountMinor: true,
            currency: true,
            scale: true,
            status: true,
            envelopeId: true,
          },
          orderBy: [{ scheduledOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: 5,
        }),
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
      const envelopeBalanceById = new Map(
        envelopeBalances.map((envelope) => [envelope.id, envelope]),
      );
      const previousPeriodEnvelope = otherPeriodEnvelope
        ? (envelopeBalanceById.get(otherPeriodEnvelope.id) ?? null)
        : null;
      const currentPeriodEnvelopeForLeftover = periodEnvelope
        ? (envelopeBalanceById.get(periodEnvelope.id) ?? null)
        : null;
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
        unassignedStartingBalanceMinor,
        onboarding,
        periodEnvelope:
          periodEnvelope && periodValues ? { id: periodEnvelope.id, ...periodValues } : null,
        previousPeriodLeftover:
          previousPeriodEnvelope && currentPeriodEnvelopeForLeftover
            ? {
                envelopeId: previousPeriodEnvelope.id,
                envelopeName: previousPeriodEnvelope.name,
                balanceMinor: previousPeriodEnvelope.balanceMinor,
                currentPeriodEnvelopeId: currentPeriodEnvelopeForLeftover.id,
                currentPeriodEnvelopeName: currentPeriodEnvelopeForLeftover.name,
              }
            : null,
        warnings,
        upcomingObligations: upcomingObligations.map((occurrence) => ({
          occurrenceId: occurrence.id,
          planName: occurrence.planName,
          scheduledOn: occurrence.scheduledOn,
          amountMinor: occurrence.amountMinor,
          currency: occurrence.currency,
          scale: occurrence.scale,
          status: occurrence.status as 'PENDING' | 'DUE',
          envelopeId: occurrence.envelopeId,
        })),
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

async function unassignedStartingBalance(
  tx: Prisma.TransactionClient,
  budgetId: string,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ amountMinor: bigint }[]>`
    SELECT (
      COALESCE((
        SELECT SUM(account."starting_balance_minor")
        FROM "accounts" AS account
        WHERE account."budget_id" = ${budgetId}::uuid
          AND account."archived_at" IS NULL
      ), 0)
      - COALESCE((
        SELECT SUM(envelope."starting_balance_minor")
        FROM "envelopes" AS envelope
        WHERE envelope."budget_id" = ${budgetId}::uuid
          AND envelope."archived_at" IS NULL
      ), 0)
    )::BIGINT AS "amountMinor"
  `;
  return rows[0]?.amountMinor ?? 0n;
}

async function onboardingStatus(
  tx: Prisma.TransactionClient,
  budgetId: string,
): Promise<{
  categoriesSeeded: boolean;
  hasAccounts: boolean;
  hasEnvelopeStartingBalances: boolean;
  hasAllocatedIncome: boolean;
}> {
  const rows = await tx.$queryRaw<
    Array<{
      categoriesSeeded: boolean;
      hasAccounts: boolean;
      hasEnvelopeStartingBalances: boolean;
      hasAllocatedIncome: boolean;
    }>
  >`
    SELECT
      (
        EXISTS(
          SELECT 1 FROM "categories"
          WHERE "budget_id" = ${budgetId}::uuid AND "archived_at" IS NULL
        )
        OR EXISTS(
          SELECT 1 FROM "envelopes"
          WHERE "budget_id" = ${budgetId}::uuid AND "archived_at" IS NULL
        )
      ) AS "categoriesSeeded",
      EXISTS(
        SELECT 1 FROM "accounts"
        WHERE "budget_id" = ${budgetId}::uuid AND "archived_at" IS NULL
      ) AS "hasAccounts",
      (
        COALESCE((
          SELECT SUM("starting_balance_minor")
          FROM "envelopes"
          WHERE "budget_id" = ${budgetId}::uuid AND "archived_at" IS NULL
        ), 0) <> 0
      ) AS "hasEnvelopeStartingBalances",
      EXISTS(
        SELECT 1
        FROM "income_allocations" AS allocation
        INNER JOIN "transactions" AS income
          ON income."id" = allocation."income_transaction_id"
          AND income."budget_id" = allocation."budget_id"
        WHERE allocation."budget_id" = ${budgetId}::uuid
          AND allocation."status" = 'CONFIRMED'
          AND income."status" = 'CONFIRMED'
      ) AS "hasAllocatedIncome"
  `;
  return (
    rows[0] ?? {
      categoriesSeeded: false,
      hasAccounts: false,
      hasEnvelopeStartingBalances: false,
      hasAllocatedIncome: false,
    }
  );
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
        + COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."destination_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
            AND reallocation."occurred_on" < ${periodStart}::date
        ), 0)
        - COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."source_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
            AND reallocation."occurred_on" < ${periodStart}::date
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
        + COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."destination_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
            AND reallocation."occurred_on" >= ${periodStart}::date
            AND reallocation."occurred_on" <= ${asOf}::date
        ), 0)
        - COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."source_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
            AND reallocation."occurred_on" >= ${periodStart}::date
            AND reallocation."occurred_on" <= ${asOf}::date
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
