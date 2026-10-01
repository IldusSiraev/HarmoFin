import type {
  CategoryType,
  EnvelopeType,
  FundingRuleType,
  PeriodSlot,
  Prisma,
} from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export type NewTemplateCategory = {
  id: string;
  templateKey: string;
  name: string;
  categoryType: CategoryType;
  parentId: string | null;
  displayOrder: number;
  comment: string | null;
  icon: string | null;
};

export type NewTemplateEnvelope = {
  id: string;
  templateKey: string;
  name: string;
  envelopeType: EnvelopeType;
  periodSlot: PeriodSlot | null;
  displayOrder: number;
};

export type NewTemplateRule = {
  envelopeId: string;
  type: FundingRuleType;
  priority: number;
  fixedMinor: bigint | null;
};

/** Writes of the reference-template apply; every statement is scoped by budget_id. */
export class TemplateApplyRepository {
  async budgetTimezone(tx: Prisma.TransactionClient, budgetId: string): Promise<string> {
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: { timezone: true },
    });
    return budget.timezone;
  }

  async createCategories(
    tx: Prisma.TransactionClient,
    budgetId: string,
    rows: NewTemplateCategory[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await tx.category.createMany({ data: rows.map((row) => ({ ...row, budgetId })) });
  }

  async createEnvelope(
    tx: Prisma.TransactionClient,
    budgetId: string,
    row: NewTemplateEnvelope,
  ): Promise<void> {
    await tx.envelope.create({
      data: { ...row, budgetId, startingBalanceMinor: 0n },
    });
  }

  async createRule(
    tx: Prisma.TransactionClient,
    budgetId: string,
    actorUserId: string,
    rule: NewTemplateRule,
  ): Promise<void> {
    await tx.envelopeFundingRule.create({
      data: {
        id: createUuidV7(),
        budgetId,
        envelopeId: rule.envelopeId,
        type: rule.type,
        priority: rule.priority,
        fixedMinor: rule.fixedMinor,
        percentBasisPoints: null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
    });
  }

  async updateCycle(
    tx: Prisma.TransactionClient,
    budgetId: string,
    workspaceId: string,
    cycleStartDay: number,
    periodBoundaryOffset: number,
  ): Promise<void> {
    await tx.budget.updateMany({
      where: { id: budgetId, workspaceId },
      data: { cycleStartDay, periodBoundaryOffset },
    });
  }

  async createAudit(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      actorUserId: string;
      requestId: string | undefined;
      newValues: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'reference_template',
        entityId: params.budgetId,
        action: 'APPLIED',
        source: 'API',
        requestId: params.requestId ?? null,
        newValues: params.newValues,
      },
    });
  }
}
