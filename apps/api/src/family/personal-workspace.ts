import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { newBudgetModelData } from '../common/plan-model/new-budget-model.js';

export async function createPersonalWorkspace(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  requestId?: string,
  names: { workspaceName: string; budgetName: string } = {
    workspaceName: 'Мой бюджет',
    budgetName: 'Мой бюджет',
  },
) {
  const workspace = await tx.workspace.create({
    data: { id: createUuidV7(now), ownerId: userId, name: names.workspaceName },
    select: { id: true, name: true, timezone: true },
  });
  await tx.workspaceMembership.create({
    data: {
      id: createUuidV7(now),
      workspaceId: workspace.id,
      userId,
      role: 'OWNER',
      lastSelectedAt: now,
    },
  });
  const budget = await tx.budget.create({
    data: {
      id: createUuidV7(now),
      workspaceId: workspace.id,
      name: names.budgetName,
      ...newBudgetModelData(now),
    },
    select: { id: true, name: true, primaryCurrency: true },
  });
  await tx.auditEvent.create({
    data: {
      id: createUuidV7(now),
      actorUserId: userId,
      workspaceId: workspace.id,
      budgetId: budget.id,
      entityType: 'workspace',
      entityId: workspace.id,
      action: 'CREATED',
      source: 'API',
      requestId: requestId ?? null,
    },
  });
  return { workspace, budget };
}
