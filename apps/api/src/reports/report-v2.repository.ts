import { Prisma, type EnvelopeAssignmentType, type EnvelopeType } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import type { CycleSettings } from '../cycles/cycle-period.domain.js';
import {
  CycleRevisionRepository,
  type StoredRevision,
} from '../cycles/cycle-revision.repository.js';
import type { ReportV2Filters } from './report-v2.dto.js';
import type { LimitPeriodRow } from './report-v2-insights.js';

export type ReportBudget = CycleSettings & { id: string };

export type FactRow = {
  transactionType: 'INCOME' | 'EXPENSE';
  amountMinor: bigint;
  occurredOn: string;
  categoryId: string;
  categoryName: string;
};

export type AccountBalanceRow = { accountId: string; name: string; balanceMinor: bigint };

export type SavingsGoalRow = {
  envelopeId: string;
  name: string;
  envelopeType: EnvelopeType;
  targetAmountMinor: bigint;
  targetDate: string | null;
  assignedMinor: bigint;
  movedInMinor: bigint;
  movedOutMinor: bigint;
  spentMinor: bigint;
};

export type PlanOccurrenceFact = {
  planId: string;
  planName: string;
  planType: 'INCOME' | 'EXPENSE';
  amountMinor: bigint;
  /** Distinct confirmed, not deleted payments of the occurrence (plan_payments plus legacy link). */
  paidMinor: bigint;
};

export type AssignmentLedgerRow = {
  kind: 'ASSIGNMENT' | 'MOVEMENT';
  id: string;
  effectiveOn: string;
  amountMinor: bigint;
  assignmentType: EnvelopeAssignmentType | null;
  envelopeId: string | null;
  periodId: string | null;
  sourceEnvelopeId: string | null;
  sourcePeriodId: string | null;
  destinationEnvelopeId: string | null;
  destinationPeriodId: string | null;
};

const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateText = (value: Date) => value.toISOString().slice(0, 10);

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

function dateRange(filters: ReportV2Filters) {
  return filters.from || filters.to
    ? {
        ...(filters.from ? { gte: dateValue(filters.from) } : {}),
        ...(filters.to ? { lte: dateValue(filters.to) } : {}),
      }
    : undefined;
}

/**
 * Read queries of the v2 reports. Every method runs in the caller's (read-only) transaction and
 * filters budget_id in the query itself; rows read through Prisma also carry the accessible-budget
 * predicate (active budget + active membership of the user) in WHERE.
 */
export class ReportV2Repository {
  private readonly balances = new FinancialBalanceRepository();
  private readonly revisions = new CycleRevisionRepository();

  /** Confirms the budget is active and the user is an active member; null otherwise. */
  async findAccessible(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
  ): Promise<ReportBudget | null> {
    return tx.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: { id: true, cycleStartDay: true, periodBoundaryOffset: true, timezone: true },
    });
  }

  async validateReferences(
    tx: Prisma.TransactionClient,
    budgetId: string,
    filters: ReportV2Filters,
  ): Promise<boolean> {
    const [account, category, envelope] = await Promise.all([
      filters.accountId
        ? tx.account.findFirst({ where: { id: filters.accountId, budgetId }, select: { id: true } })
        : Promise.resolve(true),
      filters.categoryId
        ? tx.category.findFirst({
            where: { id: filters.categoryId, budgetId },
            select: { id: true },
          })
        : Promise.resolve(true),
      filters.envelopeId
        ? tx.envelope.findFirst({
            where: { id: filters.envelopeId, budgetId },
            select: { id: true },
          })
        : Promise.resolve(true),
    ]);
    return Boolean(account && category && envelope);
  }

  /**
   * CONFIRMED real income and expense of both accounting eras (legacy v1 facts included: they are
   * real money). Logically deleted rows never count.
   */
  async facts(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    filters: ReportV2Filters,
  ): Promise<FactRow[]> {
    const occurredOn = dateRange(filters);
    const rows = await tx.transaction.findMany({
      where: {
        budgetId,
        budget: activeBudgetWhere(userId, budgetId),
        status: 'CONFIRMED',
        deletedAt: null,
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.envelopeId ? { envelopeId: filters.envelopeId } : {}),
        ...(occurredOn ? { occurredOn } : {}),
      },
      select: {
        transactionType: true,
        amountMinor: true,
        occurredOn: true,
        categoryId: true,
        category: { select: { name: true } },
      },
      orderBy: [{ occurredOn: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      transactionType: row.transactionType,
      amountMinor: row.amountMinor,
      occurredOn: dateText(row.occurredOn),
      categoryId: row.categoryId,
      categoryName: row.category.name,
    }));
  }

  async cycleRevisions(tx: Prisma.TransactionClient, budgetId: string): Promise<StoredRevision[]> {
    return this.revisions.listRevisions(tx, budgetId);
  }

  /** Distinct stored period boundaries of the budget (envelope_periods rows), oldest first. */
  async storedPeriodRanges(
    tx: Prisma.TransactionClient,
    budgetId: string,
  ): Promise<Array<{ start: string; end: string }>> {
    const rows = await tx.envelopePeriod.findMany({
      where: { budgetId },
      distinct: ['startsOn', 'endsOn'],
      select: { startsOn: true, endsOn: true },
      orderBy: [{ startsOn: 'asc' }, { endsOn: 'asc' }],
    });
    return rows.map((row) => ({ start: dateText(row.startsOn), end: dateText(row.endsOn) }));
  }

  /** Physical account balances (legacy transfer parts and direct transfers) on the as-of day. */
  async accountBalances(
    tx: Prisma.TransactionClient,
    budgetId: string,
    asOf: Date,
    accountId: string | undefined,
  ): Promise<AccountBalanceRow[]> {
    const accounts = await tx.account.findMany({
      where: { budgetId, ...(accountId ? { id: accountId } : {}) },
      select: { id: true, name: true, archivedAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const result: AccountBalanceRow[] = [];
    for (const account of accounts) {
      const balanceMinor = await this.balances.accountBalanceAsOf(tx, budgetId, account.id, asOf);
      if (account.archivedAt === null || balanceMinor !== 0n) {
        result.push({ accountId: account.id, name: account.name, balanceMinor });
      }
    }
    return result;
  }

  /**
   * Continuous v2 figures per goal envelope across all periods: CONFIRMED assignments, CONFIRMED
   * movements in/out and CONFIRMED v2 expenses up to the as-of day. Legacy v1 expenses and the old
   * startingBalance/transfers/reallocations are not part of it.
   */
  async savingsGoals(
    tx: Prisma.TransactionClient,
    budgetId: string,
    asOf: string,
    envelopeId: string | undefined,
  ): Promise<SavingsGoalRow[]> {
    const asOfDate = dateValue(asOf);
    const envelopeFilter = envelopeId ? Prisma.sql`AND e."id" = ${envelopeId}::uuid` : Prisma.empty;
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        name: string;
        envelope_type: EnvelopeType;
        target: bigint;
        target_date: Date | null;
        assigned: bigint;
        moved_in: bigint;
        moved_out: bigint;
        spent: bigint;
      }>
    >`
      SELECT e."id" AS "id",
             e."name" AS "name",
             e."envelope_type" AS "envelope_type",
             e."target_amount_minor" AS "target",
             e."target_date" AS "target_date",
             (SELECT COALESCE(SUM(a."amount_minor"), 0)::bigint
                FROM "envelope_assignments" a
               WHERE a."budget_id" = ${budgetId}::uuid
                 AND a."envelope_id" = e."id"
                 AND a."status" = 'CONFIRMED'
                 AND a."effective_on" <= ${asOfDate}) AS "assigned",
             (SELECT COALESCE(SUM(m."amount_minor"), 0)::bigint
                FROM "envelope_movements" m
               WHERE m."budget_id" = ${budgetId}::uuid
                 AND m."destination_envelope_id" = e."id"
                 AND m."status" = 'CONFIRMED'
                 AND m."effective_on" <= ${asOfDate}) AS "moved_in",
             (SELECT COALESCE(SUM(m."amount_minor"), 0)::bigint
                FROM "envelope_movements" m
               WHERE m."budget_id" = ${budgetId}::uuid
                 AND m."source_envelope_id" = e."id"
                 AND m."status" = 'CONFIRMED'
                 AND m."effective_on" <= ${asOfDate}) AS "moved_out",
             (SELECT COALESCE(SUM(t."amount_minor"), 0)::bigint
                FROM "transactions" t
               WHERE t."budget_id" = ${budgetId}::uuid
                 AND t."envelope_id" = e."id"
                 AND t."transaction_type" = 'EXPENSE'
                 AND t."status" = 'CONFIRMED'
                 AND t."accounting_model_version" = 2
                 AND t."deleted_at" IS NULL
                 AND t."occurred_on" <= ${asOfDate}) AS "spent"
        FROM "envelopes" e
       WHERE e."budget_id" = ${budgetId}::uuid
         AND e."archived_at" IS NULL
         AND e."target_amount_minor" IS NOT NULL
         ${envelopeFilter}
       ORDER BY e."display_order", e."created_at", e."id"
    `;
    return rows.map((row) => ({
      envelopeId: row.id,
      name: row.name,
      envelopeType: row.envelope_type,
      targetAmountMinor: BigInt(row.target),
      targetDate: row.target_date ? dateText(row.target_date) : null,
      assignedMinor: BigInt(row.assigned),
      movedInMinor: BigInt(row.moved_in),
      movedOutMinor: BigInt(row.moved_out),
      spentMinor: BigInt(row.spent),
    }));
  }

  /**
   * One row per non-cancelled income/expense occurrence with its snapshot amount and the sum of
   * distinct confirmed payments (several plan_payments of one occurrence add up; each transaction
   * counts once even when also linked through the legacy transaction_id).
   */
  async planOccurrences(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    filters: ReportV2Filters,
  ): Promise<PlanOccurrenceFact[]> {
    const scheduledOn = dateRange(filters);
    const occurrences = await tx.planOccurrence.findMany({
      where: {
        budgetId,
        budget: activeBudgetWhere(userId, budgetId),
        planType: { in: ['INCOME', 'EXPENSE'] },
        status: { not: 'CANCELLED' },
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.envelopeId ? { envelopeId: filters.envelopeId } : {}),
        ...(scheduledOn ? { scheduledOn } : {}),
      },
      select: {
        planId: true,
        planName: true,
        planType: true,
        amountMinor: true,
        transaction: { select: { id: true, status: true, deletedAt: true, amountMinor: true } },
        payments: {
          where: { budgetId },
          select: {
            transaction: { select: { id: true, status: true, deletedAt: true, amountMinor: true } },
          },
        },
      },
      orderBy: [{ scheduledOn: 'asc' }, { id: 'asc' }],
    });
    return occurrences.map((occurrence) => {
      const paid = new Map<string, bigint>();
      const linked = [
        ...(occurrence.transaction ? [occurrence.transaction] : []),
        ...occurrence.payments.map((payment) => payment.transaction),
      ];
      for (const transaction of linked) {
        if (transaction.status === 'CONFIRMED' && transaction.deletedAt === null) {
          paid.set(transaction.id, transaction.amountMinor);
        }
      }
      return {
        planId: occurrence.planId,
        planName: occurrence.planName,
        planType: occurrence.planType as 'INCOME' | 'EXPENSE',
        amountMinor: occurrence.amountMinor,
        paidMinor: [...paid.values()].reduce((sum, amount) => sum + amount, 0n),
      };
    });
  }

  /** CONFIRMED assignments and movements of the budget, oldest first. */
  async assignmentLedger(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    filters: ReportV2Filters,
  ): Promise<AssignmentLedgerRow[]> {
    const effectiveOn = dateRange(filters);
    const access = activeBudgetWhere(userId, budgetId);
    const [assignments, movements] = await Promise.all([
      tx.envelopeAssignment.findMany({
        where: {
          budgetId,
          budget: access,
          status: 'CONFIRMED',
          ...(filters.envelopeId ? { envelopeId: filters.envelopeId } : {}),
          ...(effectiveOn ? { effectiveOn } : {}),
        },
        select: {
          id: true,
          type: true,
          amountMinor: true,
          effectiveOn: true,
          envelopeId: true,
          periodId: true,
        },
      }),
      tx.envelopeMovement.findMany({
        where: {
          budgetId,
          budget: access,
          status: 'CONFIRMED',
          ...(filters.envelopeId
            ? {
                OR: [
                  { sourceEnvelopeId: filters.envelopeId },
                  { destinationEnvelopeId: filters.envelopeId },
                ],
              }
            : {}),
          ...(effectiveOn ? { effectiveOn } : {}),
        },
        select: {
          id: true,
          amountMinor: true,
          effectiveOn: true,
          sourceEnvelopeId: true,
          sourcePeriodId: true,
          destinationEnvelopeId: true,
          destinationPeriodId: true,
        },
      }),
    ]);
    const rows: AssignmentLedgerRow[] = [
      ...assignments.map((row) => ({
        kind: 'ASSIGNMENT' as const,
        id: row.id,
        effectiveOn: dateText(row.effectiveOn),
        amountMinor: row.amountMinor,
        assignmentType: row.type,
        envelopeId: row.envelopeId,
        periodId: row.periodId,
        sourceEnvelopeId: null,
        sourcePeriodId: null,
        destinationEnvelopeId: null,
        destinationPeriodId: null,
      })),
      ...movements.map((row) => ({
        kind: 'MOVEMENT' as const,
        id: row.id,
        effectiveOn: dateText(row.effectiveOn),
        amountMinor: row.amountMinor,
        assignmentType: null,
        envelopeId: null,
        periodId: null,
        sourceEnvelopeId: row.sourceEnvelopeId,
        sourcePeriodId: row.sourcePeriodId,
        destinationEnvelopeId: row.destinationEnvelopeId,
        destinationPeriodId: row.destinationPeriodId,
      })),
    ];
    return rows.sort(
      (left, right) =>
        left.effectiveOn.localeCompare(right.effectiveOn) ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id),
    );
  }

  /**
   * Period rows of CURRENT_EXPENSES envelopes that started on or before `startsOnLte` and end on or
   * after `endsOnGte`. Budget is filtered on both the period and its envelope.
   */
  async limitPeriods(
    tx: Prisma.TransactionClient,
    budgetId: string,
    range: { endsOnGte?: string; startsOnLte: string; envelopeId?: string },
  ): Promise<LimitPeriodRow[]> {
    const rows = await tx.envelopePeriod.findMany({
      where: {
        budgetId,
        startsOn: { lte: dateValue(range.startsOnLte) },
        ...(range.endsOnGte ? { endsOn: { gte: dateValue(range.endsOnGte) } } : {}),
        envelope: {
          budgetId,
          envelopeType: 'CURRENT_EXPENSES',
          ...(range.envelopeId ? { id: range.envelopeId } : {}),
        },
      },
      select: {
        id: true,
        envelopeId: true,
        startsOn: true,
        endsOn: true,
        targetMinor: true,
        targetStatus: true,
        envelope: { select: { name: true, archivedAt: true } },
      },
      orderBy: [{ startsOn: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      periodId: row.id,
      envelopeId: row.envelopeId,
      envelopeName: row.envelope.name,
      archived: row.envelope.archivedAt !== null,
      startsOn: dateText(row.startsOn),
      endsOn: dateText(row.endsOn),
      targetMinor: row.targetMinor,
      targetStatus: row.targetStatus,
    }));
  }
}
