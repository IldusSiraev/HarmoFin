import type { IncomeAllocationStatus, Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export type LegacyAllocationRow = {
  id: string;
  amountMinor: bigint;
  status: IncomeAllocationStatus;
  envelopeId: string;
  accountId: string;
  occurredOn: Date;
};

/** Data access for the explicit correction of old (model 1) physical facts. */
export class LegacyCorrectionRepository {
  /** Confirmed v1 allocations of one income, filtered by budget in the query itself. */
  listConfirmedAllocations(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeTransactionId: string,
  ): Promise<LegacyAllocationRow[]> {
    return tx.incomeAllocation.findMany({
      where: { budgetId, incomeTransactionId, status: 'CONFIRMED' },
      select: {
        id: true,
        amountMinor: true,
        status: true,
        envelopeId: true,
        accountId: true,
        occurredOn: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  async createCorrectionAudit(
    tx: Prisma.TransactionClient,
    params: {
      workspaceId: string;
      budgetId: string;
      transactionId: string;
      userId: string;
      requestId: string | undefined;
      oldValues: Prisma.InputJsonValue;
      newValues: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.userId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'transaction',
        entityId: params.transactionId,
        action: 'LEGACY_CORRECTED',
        source: 'API',
        requestId: params.requestId ?? null,
        oldValues: params.oldValues,
        newValues: params.newValues,
      },
    });
  }
}
