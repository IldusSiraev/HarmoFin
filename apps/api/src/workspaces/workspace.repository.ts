import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export interface WorkspaceSummary {
  id: string;
  name: string;
  timezone: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

export interface WorkspaceWithBudget extends WorkspaceSummary {
  budget: { id: string; name: string; primaryCurrency: string };
}

export class WorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAccessible(userId: string): Promise<WorkspaceSummary[]> {
    const rows = await this.prisma.workspace.findMany({
      where: { status: 'ACTIVE', memberships: { some: { userId, isActive: true } } },
      select: {
        id: true,
        name: true,
        timezone: true,
        memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.flatMap((row) => {
      const role = row.memberships[0]?.role;
      return role ? [{ id: row.id, name: row.name, timezone: row.timezone, role }] : [];
    });
  }

  async findMembership(userId: string, workspaceId: string) {
    return this.prisma.workspaceMembership.findFirst({
      where: { userId, workspaceId, isActive: true, workspace: { status: 'ACTIVE' } },
      select: { role: true, workspace: { select: { id: true, name: true, timezone: true } } },
    });
  }

  async createWithFirstBudget(
    userId: string,
    input: { workspaceName: string; budgetName: string },
    requestId?: string,
  ): Promise<WorkspaceWithBudget> {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { id: createUuidV7(), ownerId: userId, name: input.workspaceName },
        select: { id: true, name: true, timezone: true },
      });
      await tx.workspaceMembership.create({
        data: { id: createUuidV7(), workspaceId: workspace.id, userId, role: 'OWNER' },
      });
      const budget = await tx.budget.create({
        data: { id: createUuidV7(), workspaceId: workspace.id, name: input.budgetName },
        select: { id: true, name: true, primaryCurrency: true },
      });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
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
      return { ...workspace, timezone: workspace.timezone, role: 'OWNER' as const, budget };
    });
  }
}
