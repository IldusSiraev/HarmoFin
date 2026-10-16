import type { Prisma, WorkspaceMembershipRole } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export class OnboardingV2Repository {
  async memberRole(
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

  /** Sets the flag only while it is unset; true when this call changed the row. */
  async declineMandatoryPlans(
    tx: Prisma.TransactionClient,
    budgetId: string,
    workspaceId: string,
    declinedAt: Date,
  ): Promise<boolean> {
    const updated = await tx.budget.updateMany({
      where: { id: budgetId, workspaceId, onboardingNoMandatoryPlansAt: null },
      data: { onboardingNoMandatoryPlansAt: declinedAt },
    });
    return updated.count === 1;
  }

  async recordDeclined(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      actorUserId: string;
      requestId: string | undefined;
      declinedAt: Date;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'budget_onboarding',
        entityId: params.budgetId,
        action: 'MANDATORY_PLANS_DECLINED',
        source: 'API',
        requestId: params.requestId ?? null,
        newValues: { declinedAt: params.declinedAt.toISOString() },
      },
    });
  }
}
