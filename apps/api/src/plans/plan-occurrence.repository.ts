import { Prisma, type TransactionStatus } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export class PlanOccurrenceRepository {
  async completeForConfirmedTransaction(
    tx: Prisma.TransactionClient,
    transaction: {
      id: string;
      budgetId: string;
      status: TransactionStatus;
      confirmedAt: Date | null;
      workspaceId: string;
    },
    actorUserId: string,
    requestId?: string,
  ): Promise<void> {
    if (transaction.status !== 'CONFIRMED') return;
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
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId,
        workspaceId: transaction.workspaceId,
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
