import { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';

export type DirectBudgetRecord = {
  id: string;
  allowNegativeBalance: boolean;
  timezone: string;
};

export type DirectAccountRecord = {
  id: string;
  currency: string;
  scale: number;
  archivedAt: Date | null;
};

export type DirectTransferCreateParams = {
  budgetId: string;
  workspaceId: string;
  actorUserId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: bigint;
  occurredOn: Date;
  comment?: string | null;
  requestId?: string | undefined;
};

/**
 * Data access for direct (ACCOUNT_ONLY) transfers.
 *
 * All queries are scoped by budget_id in the database. Locks are acquired in
 * the stable roadmap order: budget row -> advisory idempotency lock (owned by
 * IdempotencyService) -> account rows ordered by id.
 */
export class DirectTransferRepository {
  async lockBudget(tx: Prisma.TransactionClient, budgetId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "budgets"
      WHERE "id" = ${budgetId}::uuid
      FOR UPDATE
    `;
  }

  async requireBudget(tx: Prisma.TransactionClient, budgetId: string): Promise<DirectBudgetRecord> {
    const budget = await tx.budget.findUnique({
      where: { id: budgetId },
      select: {
        id: true,
        allowNegativeBalance: true,
        timezone: true,
      },
    });
    if (!budget) {
      throw resourceNotFound();
    }
    return budget;
  }

  async findAccount(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
  ): Promise<DirectAccountRecord | null> {
    const account = await tx.account.findFirst({
      where: { id: accountId, budgetId },
      select: {
        id: true,
        currency: true,
        scale: true,
        archivedAt: true,
      },
    });
    return account as DirectAccountRecord | null;
  }

  /**
   * Locks account rows in a stable id order so that concurrent transfers
   * between the same pair of accounts never deadlock.
   */
  async lockAccounts(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountIds: string[],
  ): Promise<void> {
    for (const accountId of [...new Set(accountIds)].sort()) {
      await tx.$queryRaw`
        SELECT "id" FROM "accounts"
        WHERE "budget_id" = ${budgetId}::uuid AND "id" = ${accountId}::uuid
        FOR UPDATE
      `;
    }
  }

  async createDirectTransfer(
    tx: Prisma.TransactionClient,
    params: DirectTransferCreateParams,
  ): Promise<{ id: string }> {
    const transfer = await tx.transfer.create({
      data: {
        id: createUuidV7(),
        budgetId: params.budgetId,
        status: 'CONFIRMED',
        mode: 'ACCOUNT_ONLY',
        totalMinor: params.amountMinor,
        occurredOn: params.occurredOn,
        comment: params.comment ?? null,
        sourceAccountId: params.sourceAccountId,
        destinationAccountId: params.destinationAccountId,
        confirmedAt: new Date(),
        createdByUserId: params.actorUserId,
        updatedByUserId: params.actorUserId,
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'transfer',
        entityId: transfer.id,
        action: 'CREATED',
        source: 'API',
        requestId: params.requestId ?? null,
        newValues: {
          mode: 'ACCOUNT_ONLY',
          sourceAccountId: params.sourceAccountId,
          destinationAccountId: params.destinationAccountId,
          totalMinor: params.amountMinor.toString(),
          occurredOn: params.occurredOn.toISOString().slice(0, 10),
        },
      },
    });
    return transfer;
  }
}
