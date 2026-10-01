import type { Prisma, WorkspaceMembershipRole } from '@prisma/client';

import type { TemplateCategoryRow, TemplateEnvelopeRow } from './v2-template.definitions.js';
import type { TemplatePreviewState } from './v2-template.state.js';

export type TemplateRuleRow = TemplatePreviewState['rules'][number];

/** Read-only queries of the reference-template preview; every query filters by budget. */
export class TemplatePreviewRepository {
  async findMemberRole(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRole | null> {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  async cycleSettings(tx: Prisma.TransactionClient, workspaceId: string, budgetId: string) {
    return tx.budget.findFirst({
      where: { id: budgetId, workspaceId },
      select: { cycleStartDay: true, periodBoundaryOffset: true },
    });
  }

  async listCategories(
    tx: Prisma.TransactionClient,
    budgetId: string,
  ): Promise<Array<TemplateCategoryRow & { parentId: string | null }>> {
    return tx.category.findMany({
      where: { budgetId },
      select: {
        id: true,
        templateKey: true,
        name: true,
        categoryType: true,
        parentId: true,
        archivedAt: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  async listEnvelopes(
    tx: Prisma.TransactionClient,
    budgetId: string,
  ): Promise<TemplateEnvelopeRow[]> {
    return tx.envelope.findMany({
      where: { budgetId },
      select: {
        id: true,
        templateKey: true,
        name: true,
        envelopeType: true,
        periodSlot: true,
        archivedAt: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  async listRules(tx: Prisma.TransactionClient, budgetId: string): Promise<TemplateRuleRow[]> {
    return tx.envelopeFundingRule.findMany({
      where: { budgetId },
      select: {
        envelopeId: true,
        type: true,
        priority: true,
        fixedMinor: true,
        percentBasisPoints: true,
      },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
  }
}
