import { Prisma, type RegularPlanType, type TransactionStatus } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export type MaterializedOccurrence = {
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
  status: 'PENDING' | 'DUE';
};

export class PlanOccurrenceRepository {
  /** Existing occurrences of any status for the given plans in the date range (budget-scoped). */
  findExistingSchedule(
    tx: Prisma.TransactionClient,
    budgetId: string,
    planIds: string[],
    from: Date,
    to: Date,
  ) {
    return tx.planOccurrence.findMany({
      where: { budgetId, planId: { in: planIds }, scheduledOn: { gte: from, lte: to } },
      select: { planId: true, scheduledOn: true },
    });
  }

  /** Inserts missing occurrences and audits each creation. Never touches existing rows. */
  async createMaterialized(
    tx: Prisma.TransactionClient,
    budget: { id: string; workspaceId: string },
    rows: MaterializedOccurrence[],
    source: 'API' | 'WORKER',
    actorUserId: string | null,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const ids = rows.map(() => createUuidV7());
    await tx.planOccurrence.createMany({
      data: rows.map((row, index) => ({
        id: ids[index]!,
        workspaceId: budget.workspaceId,
        budgetId: budget.id,
        ...row,
      })),
    });
    await tx.auditEvent.createMany({
      data: rows.map((row, index) => ({
        id: createUuidV7(),
        actorUserId,
        workspaceId: budget.workspaceId,
        budgetId: budget.id,
        entityType: 'plan_occurrence',
        entityId: ids[index]!,
        action: 'CREATED',
        source,
        newValues: {
          planId: row.planId,
          scheduledOn: row.scheduledOn.toISOString().slice(0, 10),
          planType: row.planType,
          amountMinor: row.amountMinor.toString(),
          status: row.status,
          transactionId: null,
          cancellationReason: null,
        },
      })),
    });
    return rows.length;
  }

  /**
   * Approved raise (or change) of the expected amount of a still-open occurrence. Posted
   * payments are separate transactions and are never modified. Returns false if not open.
   */
  async updateOpenExpected(
    tx: Prisma.TransactionClient,
    budgetId: string,
    occurrenceId: string,
    amountMinor: bigint,
    actorUserId: string,
    requestId?: string,
  ): Promise<boolean> {
    await tx.$queryRaw`
      SELECT "id" FROM "plan_occurrences"
      WHERE "id" = ${occurrenceId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    const current = await tx.planOccurrence.findFirst({
      where: { id: occurrenceId, budgetId, status: { in: ['PENDING', 'DUE'] } },
      select: {
        id: true,
        workspaceId: true,
        planId: true,
        scheduledOn: true,
        planType: true,
        amountMinor: true,
        status: true,
        transactionId: true,
        cancellationReason: true,
      },
    });
    if (!current) return false;
    await tx.planOccurrence.update({
      where: { id: current.id },
      data: { amountMinor, actedByUserId: actorUserId },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId,
        workspaceId: current.workspaceId,
        budgetId,
        entityType: 'plan_occurrence',
        entityId: current.id,
        action: 'EXPECTED_UPDATED',
        source: 'API',
        requestId: requestId ?? null,
        oldValues: occurrenceAuditValues(current, current.status),
        newValues: occurrenceAuditValues({ ...current, amountMinor }, current.status),
      },
    });
    return true;
  }

  async completeForConfirmedTransaction(
    tx: Prisma.TransactionClient,
    transaction: {
      id: string;
      budgetId: string;
      status: TransactionStatus;
      confirmedAt: Date | null;
    },
    actorUserId: string,
    requestId?: string,
  ): Promise<void> {
    if (transaction.status !== 'CONFIRMED') return;
    await tx.$queryRaw`
      SELECT "id" FROM "plan_occurrences"
      WHERE "transaction_id" = ${transaction.id}::uuid
        AND "budget_id" = ${transaction.budgetId}::uuid
      FOR UPDATE
    `;
    const occurrence = await tx.planOccurrence.findFirst({
      where: {
        transactionId: transaction.id,
        budgetId: transaction.budgetId,
        status: { in: ['PENDING', 'DUE'] },
      },
      select: {
        id: true,
        planId: true,
        scheduledOn: true,
        planType: true,
        amountMinor: true,
        transactionId: true,
        cancellationReason: true,
        status: true,
      },
    });
    if (!occurrence) return;

    await tx.planOccurrence.update({
      where: { id: occurrence.id },
      data: {
        status: 'COMPLETED',
        completedAt: transaction.confirmedAt ?? new Date(),
        actedByUserId: actorUserId,
      },
    });
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: transaction.budgetId },
      select: { workspaceId: true },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId,
        workspaceId: budget.workspaceId,
        budgetId: transaction.budgetId,
        entityType: 'plan_occurrence',
        entityId: occurrence.id,
        action: 'COMPLETED',
        source: 'API',
        requestId: requestId ?? null,
        oldValues: occurrenceAuditValues(occurrence, occurrence.status),
        newValues: occurrenceAuditValues(occurrence, 'COMPLETED'),
      },
    });
  }
}

function occurrenceAuditValues(
  occurrence: {
    planId: string;
    scheduledOn: Date;
    planType: string;
    amountMinor: bigint;
    transactionId: string | null;
    cancellationReason: string | null;
  },
  status: string,
) {
  return {
    planId: occurrence.planId,
    scheduledOn: occurrence.scheduledOn.toISOString().slice(0, 10),
    planType: occurrence.planType,
    amountMinor: occurrence.amountMinor.toString(),
    status,
    transactionId: occurrence.transactionId,
    cancellationReason: occurrence.cancellationReason,
  };
}
