import { argon2id, hash } from 'argon2';
import { PrismaClient, WorkspaceMembershipRole } from '@prisma/client';
import { newBudgetModelData } from '../common/plan-model/new-budget-model.js';

const demo = {
  userId: '01800000-0000-7000-8000-000000000001',
  workspaceId: '01800000-0000-7000-8000-000000000002',
  membershipId: '01800000-0000-7000-8000-000000000003',
  budgetId: '01800000-0000-7000-8000-000000000004',
  auditEventId: '01800000-0000-7000-8000-000000000005',
  email: 'demo@harmofin.test',
  workspaceName: 'Демонстрационное пространство',
  budgetName: 'Демонстрационный бюджет',
} as const;

type SeedClient = Pick<PrismaClient, '$disconnect' | '$transaction'>;

export interface SeedDependencies {
  createClient?: () => SeedClient;
}

export async function runSeed(
  input: NodeJS.ProcessEnv,
  dependencies: SeedDependencies = {},
): Promise<void> {
  if (input.NODE_ENV === 'production') {
    throw new Error('Seed cannot run in production.');
  }

  const password = input.SEED_DEMO_PASSWORD;
  if (!password) {
    throw new Error('SEED_DEMO_PASSWORD is required.');
  }

  if (password.length < 10) {
    throw new Error('SEED_DEMO_PASSWORD must contain at least 10 characters.');
  }

  const client = dependencies.createClient?.() ?? new PrismaClient();

  try {
    const passwordHash = await hash(password, {
      type: argon2id,
      timeCost: 3,
      memoryCost: 65_536,
      parallelism: 1,
    });

    await client.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: demo.email },
        update: {},
        create: {
          id: demo.userId,
          email: demo.email,
          passwordHash,
        },
      });

      const workspace = await tx.workspace.upsert({
        where: { id: demo.workspaceId },
        update: { ownerId: user.id },
        create: {
          id: demo.workspaceId,
          ownerId: user.id,
          name: demo.workspaceName,
        },
      });

      await tx.workspaceMembership.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: user.id,
          },
        },
        update: { role: WorkspaceMembershipRole.OWNER, isActive: true, removedAt: null },
        create: {
          id: demo.membershipId,
          workspaceId: workspace.id,
          userId: user.id,
          role: WorkspaceMembershipRole.OWNER,
        },
      });

      const budget = await tx.budget.upsert({
        where: { id: demo.budgetId },
        update: { workspaceId: workspace.id, status: 'ACTIVE' },
        create: {
          id: demo.budgetId,
          workspaceId: workspace.id,
          name: demo.budgetName,
          primaryCurrency: 'RUB',
          ...newBudgetModelData(),
        },
      });

      await tx.auditEvent.upsert({
        where: { id: demo.auditEventId },
        update: {},
        create: {
          id: demo.auditEventId,
          actorUserId: user.id,
          workspaceId: workspace.id,
          budgetId: budget.id,
          entityType: 'seed',
          entityId: user.id,
          action: 'DEMO_SEED_CREATED',
          source: 'SEED',
          newValues: {
            email: demo.email,
            workspaceName: demo.workspaceName,
            budgetName: demo.budgetName,
          },
        },
      });
    });
  } finally {
    await client.$disconnect();
  }
}
