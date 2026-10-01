import { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export type OccurrenceRecord = {
  id: string;
  workspaceId: string;
  budgetId: string;
  planId: string;
  scheduledOn: Date;
  planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
  amountMinor: bigint;
  currency: string;
  scale: number;
  envelopeId: string | null;
  status: 'PENDING' | 'DUE' | 'SKIPPED' | 'COMPLETED' | 'CANCELLED';
  plan: { isActive: boolean; deletedAt: Date | null };
};

export type MandatoryEnvelopeRecord = {
  id: string;
  currency: string;
  scale: number;
  envelopeType: string;
};

/** Data access for v2 obligation (plan occurrence) payments. All queries filter budget_id. */
export class ObligationRepository {
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

  async findOccurrence(
    tx: Prisma.TransactionClient,
    budgetId: string,
    occurrenceId: string,
  ): Promise<OccurrenceRecord | null> {
    const row = await tx.planOccurrence.findFirst({
      where: { id: occurrenceId, budgetId },
      select: {
        id: true,
        workspaceId: true,
        budgetId: true,
        planId: true,
        scheduledOn: true,
        planType: true,
        amountMinor: true,
        currency: true,
        scale: true,
        envelopeId: true,
        status: true,
        plan: { select: { isActive: true, deletedAt: true } },
      },
    });
    return row as OccurrenceRecord | null;
  }

  async findEnvelope(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
  ): Promise<MandatoryEnvelopeRecord | null> {
    return tx.envelope.findFirst({
      where: { id: envelopeId, budgetId, archivedAt: null },
      select: { id: true, currency: true, scale: true, envelopeType: true },
    });
  }

  async findAccount(tx: Prisma.TransactionClient, budgetId: string, accountId: string) {
    return tx.account.findFirst({
      where: { id: accountId, budgetId, archivedAt: null },
      select: { id: true, currency: true, scale: true },
    });
  }

  async findExpenseCategory(tx: Prisma.TransactionClient, budgetId: string, categoryId: string) {
    return tx.category.findFirst({
      where: { id: categoryId, budgetId, archivedAt: null },
      select: { id: true, categoryType: true },
    });
  }

  /** Σ of CONFIRMED, not deleted transactions linked to the occurrence. */
  async confirmedPaidMinor(
    tx: Prisma.TransactionClient,
    budgetId: string,
    occurrenceId: string,
  ): Promise<{ total: bigint; count: number }> {
    const payments = await tx.planPayment.findMany({
      where: {
        budgetId,
        occurrenceId,
        transaction: { budgetId, status: 'CONFIRMED', deletedAt: null },
      },
      select: { transaction: { select: { amountMinor: true } } },
    });
    return {
      total: payments.reduce((sum, p) => sum + p.transaction.amountMinor, 0n),
      count: payments.length,
    };
  }

  async createPayment(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      occurrenceId: string;
      transactionId: string;
      actorUserId: string;
      requestId?: string | undefined;
    },
  ): Promise<{ id: string }> {
    const payment = await tx.planPayment.create({
      data: {
        id: createUuidV7(),
        budgetId: params.budgetId,
        occurrenceId: params.occurrenceId,
        transactionId: params.transactionId,
      },
      select: { id: true },
    });
    await this.audit(tx, params, 'plan_payment', payment.id, 'CREATED', null, {
      occurrenceId: params.occurrenceId,
      transactionId: params.transactionId,
    });
    return payment;
  }

  async transitionOccurrence(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      occurrence: OccurrenceRecord;
      to: 'COMPLETED' | 'SKIPPED';
      actorUserId: string;
      requestId?: string | undefined;
    },
  ): Promise<void> {
    const now = new Date();
    await tx.planOccurrence.updateMany({
      where: { id: params.occurrence.id, budgetId: params.budgetId },
      data: {
        status: params.to,
        actedByUserId: params.actorUserId,
        ...(params.to === 'COMPLETED' ? { completedAt: now } : { skippedAt: now }),
      },
    });
    await this.audit(
      tx,
      params,
      'plan_occurrence',
      params.occurrence.id,
      params.to === 'COMPLETED' ? 'COMPLETED' : 'SKIPPED',
      { status: params.occurrence.status },
      { status: params.to },
    );
  }

  private async audit(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      actorUserId: string;
      requestId?: string | undefined;
    },
    entityType: string,
    entityId: string,
    action: string,
    oldValues: Prisma.InputJsonValue | null,
    newValues: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType,
        entityId,
        action,
        source: 'API',
        requestId: params.requestId ?? null,
        ...(oldValues ? { oldValues } : {}),
        newValues,
      },
    });
  }
}
