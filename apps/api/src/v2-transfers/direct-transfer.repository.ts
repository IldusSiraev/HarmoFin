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
  ownerUserId: string;
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

export const transferRowSelect = {
  id: true,
  budgetId: true,
  status: true,
  totalMinor: true,
  currency: true,
  occurredOn: true,
  comment: true,
  sourceAccountId: true,
  destinationAccountId: true,
  createdAt: true,
  deletedAt: true,
  createdByUserId: true,
} as const;

export type TransferRow = Prisma.TransferGetPayload<{ select: typeof transferRowSelect }>;

export type TransferChanges = {
  sourceAccountId: string;
  destinationAccountId: string;
  totalMinor: bigint;
  occurredOn: Date;
  comment: string | null;
};

function transferAuditValues(row: TransferRow) {
  return {
    status: row.status,
    sourceAccountId: row.sourceAccountId,
    destinationAccountId: row.destinationAccountId,
    totalMinor: row.totalMinor.toString(),
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    comment: row.comment,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function changedOnly(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      oldValues[key] = before[key];
      newValues[key] = after[key];
    }
  }
  return { oldValues, newValues };
}

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
        ownerUserId: true,
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

  /** Locks the transfer row of this budget; only ACCOUNT_ONLY transfers are mutable. */
  async findForMutation(
    tx: Prisma.TransactionClient,
    budgetId: string,
    transferId: string,
  ): Promise<TransferRow | null> {
    await tx.$queryRaw`
      SELECT "id" FROM "transfers"
      WHERE "id" = ${transferId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    return tx.transfer.findFirst({
      where: { id: transferId, budgetId, mode: 'ACCOUNT_ONLY' },
      select: transferRowSelect,
    });
  }

  async updateTransfer(
    tx: Prisma.TransactionClient,
    current: TransferRow,
    changes: TransferChanges,
    audit: { workspaceId: string; actorUserId: string; requestId?: string | undefined },
  ): Promise<TransferRow> {
    const updated = await tx.transfer.update({
      where: { id_budgetId: { id: current.id, budgetId: current.budgetId } },
      data: {
        sourceAccountId: changes.sourceAccountId,
        destinationAccountId: changes.destinationAccountId,
        totalMinor: changes.totalMinor,
        occurredOn: changes.occurredOn,
        comment: changes.comment,
        updatedByUserId: audit.actorUserId,
      },
      select: transferRowSelect,
    });
    const diff = changedOnly(transferAuditValues(current), transferAuditValues(updated));
    await this.audit(tx, current, 'UPDATED', audit, diff.oldValues, diff.newValues);
    return updated;
  }

  async setLifecycle(
    tx: Prisma.TransactionClient,
    current: TransferRow,
    status: 'CONFIRMED' | 'DELETED',
    audit: { workspaceId: string; actorUserId: string; requestId?: string | undefined },
  ): Promise<TransferRow> {
    const updated = await tx.transfer.update({
      where: { id_budgetId: { id: current.id, budgetId: current.budgetId } },
      data: {
        status,
        deletedAt: status === 'DELETED' ? new Date() : null,
        updatedByUserId: audit.actorUserId,
      },
      select: transferRowSelect,
    });
    await this.audit(
      tx,
      current,
      status === 'DELETED' ? 'DELETED' : 'RESTORED',
      audit,
      transferAuditValues(current),
      transferAuditValues(updated),
    );
    return updated;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    current: TransferRow,
    action: 'UPDATED' | 'DELETED' | 'RESTORED',
    audit: { workspaceId: string; actorUserId: string; requestId?: string | undefined },
    oldValues: Record<string, unknown>,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: audit.actorUserId,
        workspaceId: audit.workspaceId,
        budgetId: current.budgetId,
        entityType: 'transfer',
        entityId: current.id,
        action,
        source: 'API',
        requestId: audit.requestId ?? null,
        oldValues: oldValues as Prisma.InputJsonValue,
        newValues: newValues as Prisma.InputJsonValue,
      },
    });
  }
}
