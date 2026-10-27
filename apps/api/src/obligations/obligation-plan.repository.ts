import { Prisma, type PlanOccurrenceStatus } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

const planSelect = {
  id: true,
  ownerUserId: true,
  name: true,
  amountMinor: true,
  recurrence: true,
  intervalMonths: true,
  startOn: true,
  endOn: true,
  categoryId: true,
  envelopeId: true,
  comment: true,
  isActive: true,
} as const;

export const mandatoryPlanFilter = (budgetId: string) =>
  ({
    budgetId,
    deletedAt: null,
    planType: 'EXPENSE' as const,
    envelope: { is: { budgetId, envelopeType: 'MANDATORY_EXPENSES' as const } },
  }) satisfies Prisma.RegularPlanWhereInput;

export type OccurrenceListFilter = {
  planId?: string | undefined;
  ownerUserId?: string | undefined;
  status?: PlanOccurrenceStatus | undefined;
  statuses?: PlanOccurrenceStatus[] | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
};

/** Data access for v2 obligation plan management. Every query filters budget_id. */
export class ObligationPlanRepository {
  /** Earliest active mandatory envelope of the budget (deterministic), or null. */
  findMandatoryEnvelope(tx: Prisma.TransactionClient, budgetId: string) {
    return tx.envelope.findFirst({
      where: { budgetId, envelopeType: 'MANDATORY_EXPENSES', archivedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, currency: true, scale: true },
    });
  }

  listPlans(
    db: Prisma.TransactionClient,
    budgetId: string,
    status: 'active' | 'archived' | 'all',
    ownerUserId?: string,
  ) {
    return db.regularPlan.findMany({
      where: {
        ...mandatoryPlanFilter(budgetId),
        ...(status === 'all' ? {} : { isActive: status === 'active' }),
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      select: planSelect,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Owner id of a plan within the budget (mandatory-envelope EXPENSE scope), or null. */
  async findPlanOwnerUserId(
    tx: Prisma.TransactionClient,
    budgetId: string,
    planId: string,
  ): Promise<string | null> {
    const row = await tx.regularPlan.findFirst({
      where: { id: planId, ...mandatoryPlanFilter(budgetId) },
      select: { ownerUserId: true },
    });
    return row?.ownerUserId ?? null;
  }

  async listOccurrences(
    db: Prisma.TransactionClient,
    budgetId: string,
    query: OccurrenceListFilter,
  ) {
    const rows = await db.planOccurrence.findMany({
      where: {
        budgetId,
        planType: 'EXPENSE',
        plan: {
          is: {
            ...mandatoryPlanFilter(budgetId),
            ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
          },
        },
        ...(query.planId ? { planId: query.planId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.statuses ? { status: { in: query.statuses } } : {}),
        ...(query.from || query.to
          ? {
              scheduledOn: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        planId: true,
        planName: true,
        scheduledOn: true,
        status: true,
        amountMinor: true,
        categoryId: true,
        envelopeId: true,
      },
      orderBy: [{ scheduledOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const payments = rows.length
      ? await db.planPayment.findMany({
          where: {
            budgetId,
            occurrenceId: { in: rows.map((row) => row.id) },
            transaction: { budgetId, status: 'CONFIRMED', deletedAt: null },
          },
          select: { occurrenceId: true, transaction: { select: { amountMinor: true } } },
        })
      : [];
    const paid = new Map<string, bigint>();
    for (const payment of payments) {
      paid.set(
        payment.occurrenceId,
        (paid.get(payment.occurrenceId) ?? 0n) + payment.transaction.amountMinor,
      );
    }
    return rows.map((row) => ({ ...row, paidMinor: paid.get(row.id) ?? 0n }));
  }

  async findOccurrenceIdAt(
    tx: Prisma.TransactionClient,
    budgetId: string,
    planId: string,
    scheduledOn: Date,
  ): Promise<string | null> {
    const row = await tx.planOccurrence.findFirst({
      where: { budgetId, planId, scheduledOn },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Open PENDING occurrences after `today` without any payment link: "future unpaid". */
  async findFutureUnpaidIds(
    tx: Prisma.TransactionClient,
    budgetId: string,
    planId: string,
    today: Date,
  ): Promise<string[]> {
    const rows = await tx.planOccurrence.findMany({
      where: {
        budgetId,
        planId,
        status: 'PENDING',
        scheduledOn: { gt: today },
        payments: { none: {} },
      },
      select: { id: true },
      orderBy: { scheduledOn: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  /** Open occurrences already due (scheduledOn <= today): "current open". */
  async findCurrentOpenIds(
    tx: Prisma.TransactionClient,
    budgetId: string,
    planId: string,
    today: Date,
  ): Promise<string[]> {
    const rows = await tx.planOccurrence.findMany({
      where: {
        budgetId,
        planId,
        status: { in: ['PENDING', 'DUE'] },
        scheduledOn: { lte: today },
      },
      select: { id: true },
      orderBy: { scheduledOn: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  /** Renames future unpaid occurrences and writes one audit event for the plan with the count. */
  async renameOccurrences(
    tx: Prisma.TransactionClient,
    budget: { id: string; workspaceId: string },
    planId: string,
    ids: string[],
    planName: string,
    userId: string,
    requestId?: string,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await tx.planOccurrence.updateMany({
      where: { budgetId: budget.id, planId, id: { in: ids }, status: 'PENDING' },
      data: { planName },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: budget.workspaceId,
        budgetId: budget.id,
        entityType: 'regular_plan',
        entityId: planId,
        action: 'OCCURRENCES_RENAMED',
        source: 'API',
        requestId: requestId ?? null,
        newValues: { planName, occurrences: result.count },
      },
    });
    return result.count;
  }

  /**
   * Restores occurrences cancelled by archiving (PLAN_DISABLED, no payments, scheduledOn >= today)
   * to PENDING (DUE when scheduledOn <= today). Older cancelled history is left alone.
   */
  async restoreDisabledOccurrences(
    tx: Prisma.TransactionClient,
    budget: { id: string; workspaceId: string },
    planId: string,
    today: Date,
    userId: string,
    requestId?: string,
  ): Promise<string[]> {
    const rows = await tx.planOccurrence.findMany({
      where: {
        budgetId: budget.id,
        planId,
        status: 'CANCELLED',
        cancellationReason: 'PLAN_DISABLED',
        scheduledOn: { gte: today },
        payments: { none: {} },
      },
      select: { id: true, scheduledOn: true, amountMinor: true },
      orderBy: { scheduledOn: 'asc' },
    });
    if (rows.length === 0) return [];
    const restore = (status: 'PENDING' | 'DUE', ids: string[]) =>
      ids.length === 0
        ? Promise.resolve()
        : tx.planOccurrence.updateMany({
            where: { budgetId: budget.id, id: { in: ids }, status: 'CANCELLED' },
            data: {
              status,
              cancelledAt: null,
              cancellationReason: null,
              actedByUserId: userId,
            },
          });
    const isDue = (row: { scheduledOn: Date }) => row.scheduledOn.getTime() <= today.getTime();
    await restore(
      'DUE',
      rows.filter(isDue).map((row) => row.id),
    );
    await restore(
      'PENDING',
      rows.filter((row) => !isDue(row)).map((row) => row.id),
    );
    await tx.auditEvent.createMany({
      data: rows.map((row) => ({
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: budget.workspaceId,
        budgetId: budget.id,
        entityType: 'plan_occurrence',
        entityId: row.id,
        action: 'RESTORED',
        source: 'API' as const,
        requestId: requestId ?? null,
        oldValues: { status: 'CANCELLED', cancellationReason: 'PLAN_DISABLED' },
        newValues: {
          status: isDue(row) ? 'DUE' : 'PENDING',
          planId,
          scheduledOn: row.scheduledOn.toISOString().slice(0, 10),
          amountMinor: row.amountMinor.toString(),
        },
      })),
    });
    return rows.map((row) => row.id);
  }

  /** Cancels still-unpaid future occurrences; paid, due, skipped and completed rows stay. */
  async cancelOccurrences(
    tx: Prisma.TransactionClient,
    budget: { id: string; workspaceId: string },
    ids: string[],
    userId: string,
    requestId?: string,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const now = new Date();
    const rows = await tx.planOccurrence.findMany({
      where: { budgetId: budget.id, id: { in: ids }, status: 'PENDING' },
      select: { id: true, planId: true, scheduledOn: true, planType: true, amountMinor: true },
    });
    if (rows.length === 0) return 0;
    await tx.planOccurrence.updateMany({
      where: { budgetId: budget.id, id: { in: rows.map((row) => row.id) }, status: 'PENDING' },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancellationReason: 'PLAN_DISABLED',
        actedByUserId: userId,
      },
    });
    await tx.auditEvent.createMany({
      data: rows.map((row) => ({
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: budget.workspaceId,
        budgetId: budget.id,
        entityType: 'plan_occurrence',
        entityId: row.id,
        action: 'CANCELLED',
        source: 'API' as const,
        requestId: requestId ?? null,
        oldValues: { status: 'PENDING', amountMinor: row.amountMinor.toString() },
        newValues: {
          status: 'CANCELLED',
          cancellationReason: 'PLAN_DISABLED',
          planId: row.planId,
          scheduledOn: row.scheduledOn.toISOString().slice(0, 10),
        },
      })),
    });
    return rows.length;
  }
}
