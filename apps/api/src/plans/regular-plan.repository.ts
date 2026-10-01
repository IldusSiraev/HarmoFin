import {
  Prisma,
  type PlanOccurrenceCancellationReason,
  type PlanOccurrenceStatus,
  type PlanRecurrence,
  type RegularPlanType,
} from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export type RegularPlanRecord = {
  id: string;
  workspaceId: string;
  budgetId: string;
  name: string;
  planType: RegularPlanType;
  amountMinor: bigint;
  currency: string;
  scale: number;
  anchorOn: Date;
  startOn: Date;
  endOn: Date | null;
  recurrence: PlanRecurrence;
  intervalMonths: number | null;
  accountId: string | null;
  categoryId: string | null;
  envelopeId: string | null;
  comment: string | null;
  isActive: boolean;
  disabledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PlanOccurrenceRecord = {
  id: string;
  workspaceId: string;
  budgetId: string;
  planId: string;
  scheduledOn: Date;
  planName: string;
  planType: RegularPlanType;
  amountMinor: bigint;
  currency: string;
  scale: number;
  accountId: string | null;
  categoryId: string | null;
  envelopeId: string | null;
  comment: string | null;
  status: PlanOccurrenceStatus;
  transactionId: string | null;
  skippedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: PlanOccurrenceCancellationReason | null;
  actedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RegularPlanCreateData = Omit<
  RegularPlanRecord,
  'id' | 'currency' | 'scale' | 'deletedAt' | 'createdAt' | 'updatedAt'
> & {
  createdByUserId: string;
  updatedByUserId: string;
};

export type RegularPlanUpdateData = Pick<
  RegularPlanCreateData,
  | 'name'
  | 'planType'
  | 'amountMinor'
  | 'anchorOn'
  | 'startOn'
  | 'endOn'
  | 'recurrence'
  | 'intervalMonths'
  | 'accountId'
  | 'categoryId'
  | 'envelopeId'
  | 'comment'
  | 'isActive'
  | 'updatedByUserId'
> & {
  disabledAt: Date | null;
};

export type OccurrenceListQuery = {
  planId?: string;
  status?: PlanOccurrenceStatus;
  from?: Date;
  to?: Date;
};

export class RegularPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  runTransaction<T>(write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(write);
  }

  async findAccessibleWithRole(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: {
        id: true,
        workspaceId: true,
        timezone: true,
        workspace: {
          select: {
            memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
    });
  }

  list(userId: string, budgetId: string, status: 'active' | 'inactive' | 'all') {
    return this.prisma.regularPlan.findMany({
      where: {
        budgetId,
        deletedAt: null,
        budget: activeBudgetWhere(userId, budgetId),
        ...(status === 'all' ? {} : { isActive: status === 'active' }),
      },
      select: regularPlanSelect,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
  }

  find(userId: string, budgetId: string, planId: string) {
    return this.prisma.regularPlan.findFirst({
      where: { id: planId, budgetId, deletedAt: null, budget: activeBudgetWhere(userId, budgetId) },
      select: regularPlanSelect,
    });
  }

  async findPlanForMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    planId: string,
  ): Promise<RegularPlanRecord | null> {
    const accessible = await tx.regularPlan.findFirst({
      where: { id: planId, budgetId, deletedAt: null, budget: activeBudgetWhere(userId, budgetId) },
      select: { id: true },
    });
    if (!accessible) return null;
    await tx.$queryRaw`
      SELECT "id" FROM "regular_plans"
      WHERE "id" = ${planId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    return tx.regularPlan.findFirst({
      where: { id: planId, budgetId, deletedAt: null, budget: activeBudgetWhere(userId, budgetId) },
      select: regularPlanSelect,
    });
  }

  /** Budget model facts needed to materialize v2 occurrences; filtered by budget id. */
  findBudgetPlanModel(tx: Prisma.TransactionClient, budgetId: string) {
    return tx.budget.findFirst({
      where: { id: budgetId, status: 'ACTIVE', workspace: { status: 'ACTIVE' } },
      select: {
        id: true,
        workspaceId: true,
        timezone: true,
        planModelVersion: true,
        planModelActivatedOn: true,
      },
    });
  }

  /**
   * Active EXPENSE plans bound to a mandatory envelope that can produce dates up to `to`.
   * Plan rows are locked (ordered by id) so concurrent materializers serialize per budget and
   * the existing-date check that follows cannot race into duplicate occurrences.
   */
  async lockMaterializablePlans(tx: Prisma.TransactionClient, budgetId: string, to: Date) {
    await tx.$queryRaw`
      SELECT "id" FROM "regular_plans"
      WHERE "budget_id" = ${budgetId}::uuid
        AND "is_active" = true
        AND "deleted_at" IS NULL
      ORDER BY "id"
      FOR UPDATE
    `;
    return tx.regularPlan.findMany({
      where: {
        budgetId,
        isActive: true,
        deletedAt: null,
        planType: 'EXPENSE',
        startOn: { lte: to },
        envelope: { is: { budgetId, envelopeType: 'MANDATORY_EXPENSES', archivedAt: null } },
      },
      select: regularPlanSelect,
      orderBy: { id: 'asc' },
    });
  }

  async createPlan(
    tx: Prisma.TransactionClient,
    data: RegularPlanCreateData,
    userId: string,
    requestId?: string,
  ): Promise<RegularPlanRecord> {
    const plan = await tx.regularPlan.create({
      data: { id: createUuidV7(), ...data },
      select: regularPlanSelect,
    });
    await this.createPlanAudit(tx, plan, userId, requestId, 'CREATED');
    return plan;
  }

  async updatePlan(
    tx: Prisma.TransactionClient,
    current: RegularPlanRecord,
    data: RegularPlanUpdateData,
    userId: string,
    requestId?: string,
  ): Promise<RegularPlanRecord> {
    const plan = await tx.regularPlan.update({
      where: { id: current.id },
      data,
      select: regularPlanSelect,
    });
    await this.createPlanAudit(tx, plan, userId, requestId, 'UPDATED', current);
    return plan;
  }

  async removePlan(
    tx: Prisma.TransactionClient,
    current: RegularPlanRecord,
    userId: string,
    requestId?: string,
  ): Promise<RegularPlanRecord> {
    const now = new Date();
    const plan = await tx.regularPlan.update({
      where: { id: current.id },
      data: {
        isActive: false,
        disabledAt: current.disabledAt ?? now,
        deletedAt: now,
        updatedByUserId: userId,
      },
      select: regularPlanSelect,
    });
    await this.createPlanAudit(tx, plan, userId, requestId, 'DELETED', current);
    return plan;
  }

  listOccurrences(userId: string, budgetId: string, query: OccurrenceListQuery) {
    return this.prisma.planOccurrence.findMany({
      where: {
        budgetId,
        budget: activeBudgetWhere(userId, budgetId),
        ...(query.planId ? { planId: query.planId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to
          ? {
              scheduledOn: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      select: occurrenceSelect,
      orderBy: [{ scheduledOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async findOccurrenceForMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    occurrenceId: string,
  ): Promise<PlanOccurrenceRecord | null> {
    const accessible = await tx.planOccurrence.findFirst({
      where: { id: occurrenceId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: { id: true },
    });
    if (!accessible) return null;
    await tx.$queryRaw`
      SELECT "id" FROM "plan_occurrences"
      WHERE "id" = ${occurrenceId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    return tx.planOccurrence.findFirst({
      where: { id: occurrenceId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: occurrenceSelect,
    });
  }

  async transitionOccurrence(
    tx: Prisma.TransactionClient,
    current: PlanOccurrenceRecord,
    status: 'SKIPPED' | 'COMPLETED',
    userId: string,
    requestId?: string,
  ): Promise<PlanOccurrenceRecord> {
    const now = new Date();
    const occurrence = await tx.planOccurrence.update({
      where: { id: current.id },
      data: {
        status,
        actedByUserId: userId,
        ...(status === 'SKIPPED' ? { skippedAt: now } : { completedAt: now }),
      },
      select: occurrenceSelect,
    });
    await this.createOccurrenceAudit(tx, occurrence, userId, requestId, status, current);
    return occurrence;
  }

  async linkDraftTransaction(
    tx: Prisma.TransactionClient,
    current: PlanOccurrenceRecord,
    transactionId: string,
    userId: string,
    requestId?: string,
  ): Promise<PlanOccurrenceRecord> {
    const occurrence = await tx.planOccurrence.update({
      where: { id: current.id },
      data: { transactionId, actedByUserId: userId },
      select: occurrenceSelect,
    });
    await this.createOccurrenceAudit(tx, occurrence, userId, requestId, 'DRAFT_CREATED', current);
    return occurrence;
  }

  async cancelFuturePendingOccurrences(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    planId: string,
    after: Date,
    reason: PlanOccurrenceCancellationReason,
    requestId?: string,
  ): Promise<PlanOccurrenceRecord[]> {
    const rows = await tx.planOccurrence.findMany({
      where: { budgetId, planId, status: 'PENDING', scheduledOn: { gt: after } },
      select: occurrenceSelect,
    });
    if (rows.length === 0) return [];
    const now = new Date();
    await tx.planOccurrence.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancellationReason: reason,
        actedByUserId: userId,
      },
    });
    const cancelled = rows.map((row) => ({
      ...row,
      status: 'CANCELLED' as const,
      cancelledAt: now,
      cancellationReason: reason,
      actedByUserId: userId,
    }));
    await Promise.all(
      cancelled.map((occurrence) =>
        this.createOccurrenceAudit(tx, occurrence, userId, requestId, 'CANCELLED', undefined),
      ),
    );
    return cancelled;
  }

  async findActiveReferences(
    tx: Prisma.TransactionClient,
    budgetId: string,
    references: { accountId: string | null; categoryId: string | null; envelopeId: string | null },
  ) {
    const [account, category, envelope] = await Promise.all([
      references.accountId
        ? tx.account.findFirst({
            where: { id: references.accountId, budgetId, archivedAt: null },
            select: { id: true, currency: true, scale: true },
          })
        : Promise.resolve(null),
      references.categoryId
        ? tx.category.findFirst({
            where: { id: references.categoryId, budgetId, archivedAt: null },
            select: { id: true, categoryType: true },
          })
        : Promise.resolve(null),
      references.envelopeId
        ? tx.envelope.findFirst({
            where: { id: references.envelopeId, budgetId, archivedAt: null },
            select: { id: true, envelopeType: true, currency: true, scale: true },
          })
        : Promise.resolve(null),
    ]);
    return { account, category, envelope };
  }

  private async createPlanAudit(
    tx: Prisma.TransactionClient,
    plan: RegularPlanRecord,
    userId: string,
    requestId: string | undefined,
    action: string,
    previous?: RegularPlanRecord,
  ) {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: plan.workspaceId,
        budgetId: plan.budgetId,
        entityType: 'regular_plan',
        entityId: plan.id,
        action,
        source: 'API',
        requestId: requestId ?? null,
        ...(previous ? { oldValues: planAuditValues(previous) } : {}),
        newValues: planAuditValues(plan),
      },
    });
  }

  private async createOccurrenceAudit(
    tx: Prisma.TransactionClient,
    occurrence: PlanOccurrenceRecord,
    userId: string,
    requestId: string | undefined,
    action: string,
    previous?: PlanOccurrenceRecord,
  ) {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: occurrence.workspaceId,
        budgetId: occurrence.budgetId,
        entityType: 'plan_occurrence',
        entityId: occurrence.id,
        action,
        source: 'API',
        requestId: requestId ?? null,
        ...(previous ? { oldValues: occurrenceAuditValues(previous) } : {}),
        newValues: occurrenceAuditValues(occurrence),
      },
    });
  }
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

function planAuditValues(plan: RegularPlanRecord) {
  return {
    name: plan.name,
    planType: plan.planType,
    amountMinor: plan.amountMinor.toString(),
    anchorOn: plan.anchorOn.toISOString().slice(0, 10),
    startOn: plan.startOn.toISOString().slice(0, 10),
    endOn: plan.endOn?.toISOString().slice(0, 10) ?? null,
    recurrence: plan.recurrence,
    intervalMonths: plan.intervalMonths,
    accountId: plan.accountId,
    categoryId: plan.categoryId,
    envelopeId: plan.envelopeId,
    comment: plan.comment,
    isActive: plan.isActive,
    disabledAt: plan.disabledAt?.toISOString() ?? null,
    deletedAt: plan.deletedAt?.toISOString() ?? null,
  };
}

function occurrenceAuditValues(occurrence: PlanOccurrenceRecord) {
  return {
    planId: occurrence.planId,
    scheduledOn: occurrence.scheduledOn.toISOString().slice(0, 10),
    planType: occurrence.planType,
    amountMinor: occurrence.amountMinor.toString(),
    status: occurrence.status,
    transactionId: occurrence.transactionId,
    cancellationReason: occurrence.cancellationReason,
  };
}

export const regularPlanSelect = {
  id: true,
  workspaceId: true,
  budgetId: true,
  name: true,
  planType: true,
  amountMinor: true,
  currency: true,
  scale: true,
  anchorOn: true,
  startOn: true,
  endOn: true,
  recurrence: true,
  intervalMonths: true,
  accountId: true,
  categoryId: true,
  envelopeId: true,
  comment: true,
  isActive: true,
  disabledAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const occurrenceSelect = {
  id: true,
  workspaceId: true,
  budgetId: true,
  planId: true,
  scheduledOn: true,
  planName: true,
  planType: true,
  amountMinor: true,
  currency: true,
  scale: true,
  accountId: true,
  categoryId: true,
  envelopeId: true,
  comment: true,
  status: true,
  transactionId: true,
  skippedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  actedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;
