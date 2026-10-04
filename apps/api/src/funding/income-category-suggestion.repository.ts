import type { CategoryType, Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export type IncomeCategorySuggestionRecord = {
  enabled: boolean;
  sourceCategoryId: string | null;
  targetEnvelopeId: string | null;
};

export type SaveIncomeCategorySuggestionParams = IncomeCategorySuggestionRecord & {
  budgetId: string;
  workspaceId: string;
  actorUserId: string;
  requestId?: string | undefined;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SETTING_SELECT = {
  incomeAllocationRuleEnabled: true,
  incomeAllocationSourceCategoryId: true,
  incomeAllocationTargetEnvelopeId: true,
} as const;

function toRecord(row: {
  incomeAllocationRuleEnabled: boolean;
  incomeAllocationSourceCategoryId: string | null;
  incomeAllocationTargetEnvelopeId: string | null;
}): IncomeCategorySuggestionRecord {
  return {
    enabled: row.incomeAllocationRuleEnabled,
    sourceCategoryId: row.incomeAllocationSourceCategoryId,
    targetEnvelopeId: row.incomeAllocationTargetEnvelopeId,
  };
}

/** Reads/writes the existing Budget setting columns. Every query filters budget_id. */
export class IncomeCategorySuggestionRepository {
  async lockBudget(tx: Prisma.TransactionClient, budgetId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "budgets"
      WHERE "id" = ${budgetId}::uuid
      FOR UPDATE
    `;
  }

  async findCategory(
    tx: Prisma.TransactionClient,
    budgetId: string,
    categoryId: string,
  ): Promise<{ id: string; categoryType: CategoryType; archivedAt: Date | null } | null> {
    if (!UUID_PATTERN.test(categoryId)) return null;
    return tx.category.findFirst({
      where: { id: categoryId, budgetId },
      select: { id: true, categoryType: true, archivedAt: true },
    });
  }

  async findEnvelope(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
  ): Promise<{ id: string; archivedAt: Date | null } | null> {
    if (!UUID_PATTERN.test(envelopeId)) return null;
    return tx.envelope.findFirst({
      where: { id: envelopeId, budgetId },
      select: { id: true, archivedAt: true },
    });
  }

  async save(
    tx: Prisma.TransactionClient,
    params: SaveIncomeCategorySuggestionParams,
  ): Promise<IncomeCategorySuggestionRecord> {
    const before = await tx.budget.findFirstOrThrow({
      where: { id: params.budgetId, workspaceId: params.workspaceId },
      select: SETTING_SELECT,
    });
    await tx.budget.updateMany({
      where: { id: params.budgetId, workspaceId: params.workspaceId },
      data: {
        incomeAllocationRuleEnabled: params.enabled,
        incomeAllocationSourceCategoryId: params.sourceCategoryId,
        incomeAllocationTargetEnvelopeId: params.targetEnvelopeId,
      },
    });
    const saved: IncomeCategorySuggestionRecord = {
      enabled: params.enabled,
      sourceCategoryId: params.sourceCategoryId,
      targetEnvelopeId: params.targetEnvelopeId,
    };
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'income_category_suggestion',
        entityId: params.budgetId,
        action: 'UPDATED',
        source: 'API',
        requestId: params.requestId ?? null,
        oldValues: { ...toRecord(before) },
        newValues: { ...saved },
      },
    });
    return saved;
  }
}
