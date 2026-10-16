import type { EnvelopeType, Prisma, WorkspaceMembershipRole } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import type { CycleSettings } from '../cycles/cycle-period.domain.js';
import type { PrismaService } from '../database/prisma.service.js';
import {
  type AssignmentBalanceRow,
  AssignmentBalanceRepository,
} from '../envelope-plans/assignment-balance.repository.js';
import {
  type EnvelopePeriodRecord,
  type PeriodActor,
  FundingRuleRepository,
} from '../envelope-plans/funding-rule.repository.js';
import { MandatoryDueRepository } from '../obligations/mandatory-due.repository.js';
import { PlanOccurrenceRepository } from '../plans/plan-occurrence.repository.js';
import { RegularPlanRepository } from '../plans/regular-plan.repository.js';
import { V2OccurrenceMaterializer } from '../plans/v2-occurrence-materializer.js';

export type DashboardEnvelope = {
  id: string;
  name: string;
  envelopeType: EnvelopeType;
  periodSlot: 'FIRST' | 'SECOND' | null;
  archivedAt: Date | null;
};

export type DashboardAccount = { id: string; name: string; balanceMinor: bigint };

export type DashboardPeriodRange = { id: string; envelopeId: string; endsOn: string };

export type NearestObligation = {
  occurrenceId: string;
  name: string;
  scheduledOn: string;
  unpaidMinor: bigint;
};

export type UpcomingOccurrence = {
  occurrenceId: string;
  scheduledOn: string;
  unpaidMinor: bigint;
};

/**
 * Read queries of the v2 dashboard. Every query filters budget_id in SQL. The only write is the
 * idempotent structural creation of the current main period row (openMainPeriod).
 * All methods run inside the caller's transaction.
 */
export class DashboardV2Repository {
  private readonly cashBalances = new FinancialBalanceRepository();
  private readonly assignmentBalances = new AssignmentBalanceRepository();
  private readonly rules = new FundingRuleRepository();
  private readonly mandatory: MandatoryDueRepository;

  constructor(prisma: PrismaService) {
    const plans = new RegularPlanRepository(prisma);
    this.mandatory = new MandatoryDueRepository(
      plans,
      new V2OccurrenceMaterializer(plans, new PlanOccurrenceRepository()),
    );
  }

  async memberRole(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRole | null> {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  /** Exclusive budget lock; only the write-role pre-step takes it (R01/R02 contract). */
  async lockBudget(tx: Prisma.TransactionClient, budgetId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "budgets"
      WHERE "id" = ${budgetId}::uuid
      FOR UPDATE
    `;
  }

  async budgetSettings(
    tx: Prisma.TransactionClient,
    budgetId: string,
    workspaceId: string,
  ): Promise<CycleSettings | null> {
    return tx.budget.findFirst({
      where: { id: budgetId, workspaceId },
      select: { cycleStartDay: true, periodBoundaryOffset: true, timezone: true },
    });
  }

  async listEnvelopes(
    tx: Prisma.TransactionClient,
    budgetId: string,
  ): Promise<DashboardEnvelope[]> {
    return tx.envelope.findMany({
      where: { budgetId },
      select: { id: true, name: true, envelopeType: true, periodSlot: true, archivedAt: true },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });
  }

  /** Pure read of the main period row by its start date. */
  findPeriodByStart(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    start: string,
  ): Promise<EnvelopePeriodRecord | null> {
    return this.rules.findPeriodByStart(tx, budgetId, envelopeId, start);
  }

  /** Write (pre-step only): idempotent structural UNSET/DRAFT row; an existing row is untouched. */
  async openMainPeriod(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    start: string,
    end: string,
    actor: PeriodActor,
  ): Promise<EnvelopePeriodRecord> {
    return this.rules.getOrCreatePeriod(tx, budgetId, envelopeId, start, end, actor);
  }

  /** Real money on every account of the budget (confirmed facts up to and including the as-of day). */
  cash(tx: Prisma.TransactionClient, budgetId: string, asOf: Date): Promise<bigint> {
    return this.cashBalances.totalCashAsOf(tx, budgetId, asOf);
  }

  /** Funded/spent/balance per envelope and period (CONFIRMED only). */
  balances(
    tx: Prisma.TransactionClient,
    budgetId: string,
    asOf: Date,
  ): Promise<AssignmentBalanceRow[]> {
    return this.assignmentBalances.allBalances(tx, budgetId, asOf);
  }

  /**
   * Write (pre-step only, budget lock held): materializes missing mandatory occurrences up to the
   * horizon end so the pure-read upcoming query sees them.
   */
  async materializeOccurrences(
    tx: Prisma.TransactionClient,
    budgetId: string,
    asOf: string,
    currentEnd: string,
    horizonEnd: string,
  ): Promise<void> {
    await this.mandatory.mandatoryDue(tx, budgetId, asOf, currentEnd, horizonEnd);
  }

  /**
   * Open mandatory expense occurrences inside the protection horizon with an unpaid remainder,
   * overdue ones included. Pure SELECT over existing rows with the same filter as R02
   * mandatoryDue, so the sum of unpaid amounts is the mandatory due.
   */
  async upcoming(
    tx: Prisma.TransactionClient,
    budgetId: string,
    horizonEnd: string,
  ): Promise<UpcomingOccurrence[]> {
    const rows = await tx.$queryRaw<Array<{ id: string; scheduledOn: string; unpaid: bigint }>>`
      SELECT o."id" AS "id",
             to_char(o."scheduled_on", 'YYYY-MM-DD') AS "scheduledOn",
             GREATEST(0, o."amount_minor" - COALESCE(paid."paid_minor", 0))::bigint AS "unpaid"
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
        AND o."scheduled_on" <= ${horizonEnd}::date
        AND e."envelope_type" = 'MANDATORY_EXPENSES'
        AND e."archived_at" IS NULL
        AND o."amount_minor" - COALESCE(paid."paid_minor", 0) > 0
      ORDER BY o."scheduled_on", o."id"
    `;
    return rows.map((row) => ({
      occurrenceId: row.id,
      scheduledOn: row.scheduledOn,
      unpaidMinor: BigInt(row.unpaid),
    }));
  }

  /**
   * The nearest open mandatory expense occurrences with an unpaid remainder, overdue ones first
   * (display list: not tied to the protection horizon, bounded by `to`). Pure SELECT, every join
   * filters budget_id.
   */
  async nearestObligations(
    tx: Prisma.TransactionClient,
    budgetId: string,
    to: string,
    limit: number,
  ): Promise<NearestObligation[]> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; name: string; scheduledOn: string; unpaid: bigint }>
    >`
      SELECT o."id" AS "id",
             o."plan_name" AS "name",
             to_char(o."scheduled_on", 'YYYY-MM-DD') AS "scheduledOn",
             GREATEST(0, o."amount_minor" - COALESCE(paid."paid_minor", 0))::bigint AS "unpaid"
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
        AND o."scheduled_on" <= ${to}::date
        AND e."envelope_type" = 'MANDATORY_EXPENSES'
        AND e."archived_at" IS NULL
        AND o."amount_minor" - COALESCE(paid."paid_minor", 0) > 0
      ORDER BY o."scheduled_on", o."id"
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      occurrenceId: row.id,
      name: row.name,
      scheduledOn: row.scheduledOn,
      unpaidMinor: BigInt(row.unpaid),
    }));
  }

  /**
   * Active accounts (and archived ones that still hold money, so the list sums to the cash figure)
   * with their balance on the as-of day.
   */
  async accounts(
    tx: Prisma.TransactionClient,
    budgetId: string,
    asOf: Date,
  ): Promise<DashboardAccount[]> {
    const rows = await tx.account.findMany({
      where: { budgetId },
      select: { id: true, name: true, archivedAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const result: DashboardAccount[] = [];
    for (const row of rows) {
      const balanceMinor = await this.cashBalances.accountBalanceAsOf(tx, budgetId, row.id, asOf);
      if (row.archivedAt === null || balanceMinor !== 0n) {
        result.push({ id: row.id, name: row.name, balanceMinor });
      }
    }
    return result;
  }

  /** Date ranges of the given period rows of this budget (pure read). */
  async periodRanges(
    tx: Prisma.TransactionClient,
    budgetId: string,
    periodIds: string[],
  ): Promise<DashboardPeriodRange[]> {
    if (periodIds.length === 0) return [];
    const rows = await tx.envelopePeriod.findMany({
      where: { budgetId, id: { in: periodIds } },
      select: { id: true, envelopeId: true, endsOn: true },
    });
    return rows.map((row) => ({
      id: row.id,
      envelopeId: row.envelopeId,
      endsOn: row.endsOn.toISOString().slice(0, 10),
    }));
  }

  /** True when any CONFIRMED assignment is effective on or before the as-of day. */
  async hasConfirmedAssignments(
    tx: Prisma.TransactionClient,
    budgetId: string,
    asOf: string,
  ): Promise<boolean> {
    const found = await tx.envelopeAssignment.findFirst({
      where: {
        budgetId,
        status: 'CONFIRMED',
        effectiveOn: { lte: new Date(`${asOf}T00:00:00.000Z`) },
      },
      select: { id: true },
    });
    return found !== null;
  }

  async hasCategories(tx: Prisma.TransactionClient, budgetId: string): Promise<boolean> {
    const found = await tx.category.findFirst({
      where: { budgetId, archivedAt: null },
      select: { id: true },
    });
    return found !== null;
  }

  /** True when the budget has an active, not deleted expense plan paid from a mandatory envelope. */
  async hasMandatoryPlans(
    tx: Prisma.TransactionClient,
    budgetId: string,
    mandatoryEnvelopeIds: string[],
  ): Promise<boolean> {
    if (mandatoryEnvelopeIds.length === 0) return false;
    const found = await tx.regularPlan.findFirst({
      where: {
        budgetId,
        planType: 'EXPENSE',
        isActive: true,
        deletedAt: null,
        envelopeId: { in: mandatoryEnvelopeIds },
      },
      select: { id: true },
    });
    return found !== null;
  }

  /** True once the owner stated in onboarding that the budget has no mandatory payments. */
  async mandatoryPlansDeclined(
    tx: Prisma.TransactionClient,
    budgetId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const found = await tx.budget.findFirst({
      where: { id: budgetId, workspaceId, onboardingNoMandatoryPlansAt: { not: null } },
      select: { id: true },
    });
    return found !== null;
  }
}
