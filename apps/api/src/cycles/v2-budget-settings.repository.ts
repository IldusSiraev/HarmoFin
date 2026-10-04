import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export type V2BudgetSettingsView = {
  id: string;
  name: string;
  timezone: string;
  allowNegativeAccountBalance: boolean;
  cycleStartDay: number;
  periodBoundaryOffset: number;
  planModelVersion: number;
};

const SELECT = {
  id: true,
  name: true,
  timezone: true,
  allowNegativeBalance: true,
  cycleStartDay: true,
  periodBoundaryOffset: true,
  planModelVersion: true,
} as const;

function toView(row: {
  id: string;
  name: string;
  timezone: string;
  allowNegativeBalance: boolean;
  cycleStartDay: number;
  periodBoundaryOffset: number;
  planModelVersion: number;
}): V2BudgetSettingsView {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    allowNegativeAccountBalance: row.allowNegativeBalance,
    cycleStartDay: row.cycleStartDay,
    periodBoundaryOffset: row.periodBoundaryOffset,
    planModelVersion: row.planModelVersion,
  };
}

/** Every statement filters workspace_id and budget_id in the query itself. */
export class V2BudgetSettingsRepository {
  async findMemberRole(tx: Prisma.TransactionClient, workspaceId: string, userId: string) {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  async find(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    budgetId: string,
  ): Promise<V2BudgetSettingsView | null> {
    const row = await tx.budget.findFirst({
      where: { id: budgetId, workspaceId },
      select: SELECT,
    });
    return row ? toView(row) : null;
  }

  async update(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    budgetId: string,
    data: {
      name?: string | undefined;
      allowNegativeAccountBalance?: boolean | undefined;
      timezone?: string | undefined;
    },
  ): Promise<V2BudgetSettingsView | null> {
    const result = await tx.budget.updateMany({
      where: { id: budgetId, workspaceId },
      data: {
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.timezone === undefined ? {} : { timezone: data.timezone }),
        ...(data.allowNegativeAccountBalance === undefined
          ? {}
          : { allowNegativeBalance: data.allowNegativeAccountBalance }),
      },
    });
    if (result.count === 0) return null;
    return this.find(tx, workspaceId, budgetId);
  }

  async createAudit(
    tx: Prisma.TransactionClient,
    params: {
      workspaceId: string;
      budgetId: string;
      actorUserId: string;
      requestId: string | undefined;
      oldValues: Prisma.InputJsonValue;
      newValues: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'budget',
        entityId: params.budgetId,
        action: 'UPDATED',
        source: 'API',
        requestId: params.requestId ?? null,
        oldValues: params.oldValues,
        newValues: params.newValues,
      },
    });
  }
}
