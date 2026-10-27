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
  comment: true,
  isActive: true,
} as const;

export const incomePlanFilter = (budgetId: string) =>
  ({
    budgetId,
    deletedAt: null,
    planType: 'INCOME' as const,
  }) satisfies Prisma.RegularPlanWhereInput;

export type IncomeOccurrenceFilter = {
  planId?: string | undefined;
  ownerUserId?: string | undefined;
  status?: PlanOccurrenceStatus | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
};

/** Data access for v2 income plans (forecasts). Every query filters budget_id. */
export class IncomePlanRepository {
  listPlans(
    db: Prisma.TransactionClient,
    budgetId: string,
    status: 'active' | 'archived' | 'all',
    ownerUserId?: string,
  ) {
    return db.regularPlan.findMany({
      where: {
        ...incomePlanFilter(budgetId),
        ...(status === 'all' ? {} : { isActive: status === 'active' }),
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      select: planSelect,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async listOccurrences(
    db: Prisma.TransactionClient,
    budgetId: string,
    query: IncomeOccurrenceFilter,
  ) {
    const rows = await db.planOccurrence.findMany({
      where: {
        budgetId,
        planType: 'INCOME',
        plan: {
          is: {
            ...incomePlanFilter(budgetId),
            ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
          },
        },
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
      select: {
        id: true,
        planId: true,
        planName: true,
        scheduledOn: true,
        status: true,
        amountMinor: true,
        categoryId: true,
        transactionId: true,
        plan: { select: { ownerUserId: true } },
      },
      orderBy: [{ scheduledOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ ...row, ownerUserId: row.plan.ownerUserId }));
  }

  /** Active (non-archived) category of the budget; the caller checks the category type. */
  findIncomeCategory(tx: Prisma.TransactionClient, budgetId: string, categoryId: string) {
    return tx.category.findFirst({
      where: { id: categoryId, budgetId, archivedAt: null },
      select: { id: true, categoryType: true },
    });
  }

  async lockOccurrence(
    tx: Prisma.TransactionClient,
    budgetId: string,
    occurrenceId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "plan_occurrences"
      WHERE "id" = ${occurrenceId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
  }

  findOccurrence(tx: Prisma.TransactionClient, budgetId: string, occurrenceId: string) {
    return tx.planOccurrence.findFirst({
      where: { id: occurrenceId, budgetId, planType: 'INCOME' },
      select: {
        id: true,
        workspaceId: true,
        planId: true,
        scheduledOn: true,
        planType: true,
        amountMinor: true,
        categoryId: true,
        status: true,
        transactionId: true,
        cancellationReason: true,
        plan: { select: { isActive: true, deletedAt: true, ownerUserId: true } },
      },
    });
  }

  /** Owner (member) of the plan of this budget; null when the plan is absent. */
  async findPlanOwnerUserId(
    tx: Prisma.TransactionClient,
    budgetId: string,
    planId: string,
  ): Promise<string | null> {
    const row = await tx.regularPlan.findFirst({
      where: { ...incomePlanFilter(budgetId), id: planId },
      select: { ownerUserId: true },
    });
    return row?.ownerUserId ?? null;
  }

  /**
   * Atomically links the confirmed income and completes a still-open occurrence. Returns false
   * when the occurrence is no longer open (the caller rolls back).
   */
  async completeWithTransaction(
    tx: Prisma.TransactionClient,
    occurrence: {
      id: string;
      workspaceId: string;
      budgetId: string;
      planId: string;
      scheduledOn: Date;
      amountMinor: bigint;
      status: PlanOccurrenceStatus;
    },
    transactionId: string,
    completedAt: Date,
    actorUserId: string,
    requestId?: string,
  ): Promise<boolean> {
    const result = await tx.planOccurrence.updateMany({
      where: {
        id: occurrence.id,
        budgetId: occurrence.budgetId,
        planType: 'INCOME',
        status: { in: ['PENDING', 'DUE'] },
        transactionId: null,
      },
      data: { transactionId, status: 'COMPLETED', completedAt, actedByUserId: actorUserId },
    });
    if (result.count !== 1) return false;
    const values = (status: string, linked: string | null) => ({
      planId: occurrence.planId,
      scheduledOn: occurrence.scheduledOn.toISOString().slice(0, 10),
      planType: 'INCOME',
      amountMinor: occurrence.amountMinor.toString(),
      status,
      transactionId: linked,
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId,
        workspaceId: occurrence.workspaceId,
        budgetId: occurrence.budgetId,
        entityType: 'plan_occurrence',
        entityId: occurrence.id,
        action: 'COMPLETED',
        source: 'API',
        requestId: requestId ?? null,
        oldValues: values(occurrence.status, null),
        newValues: values('COMPLETED', transactionId),
      },
    });
    return true;
  }
}
