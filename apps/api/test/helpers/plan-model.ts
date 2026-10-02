import type { PrismaClient } from '@prisma/client';

/** Test fixture: new budgets default to plan model 2; legacy tests need an explicit model 1 budget. */
export async function forceBudgetV1(prisma: PrismaClient, budgetId: string): Promise<void> {
  await prisma.budget.update({
    where: { id: budgetId },
    data: { planModelVersion: 1, planModelActivatedOn: null },
  });
}

export async function forceWorkspaceBudgetsV1(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<void> {
  await prisma.budget.updateMany({
    where: { workspaceId },
    data: { planModelVersion: 1, planModelActivatedOn: null },
  });
}
