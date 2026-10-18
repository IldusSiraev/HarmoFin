import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export type Tx = Prisma.TransactionClient;

export interface OwnedWorkspace {
  id: string;
  timezone: string;
  activeBudgetIds: string[];
  otherActiveMemberCount: number;
}

export class AccountDeletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  findUserCredentials(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true, status: true },
    });
  }

  /** Atomic ACTIVE → PENDING_DELETION; false when another request already won. */
  async claimActiveUser(tx: Tx, userId: string): Promise<boolean> {
    const result = await tx.user.updateMany({
      where: { id: userId, status: 'ACTIVE' },
      data: { status: 'PENDING_DELETION' },
    });
    return result.count === 1;
  }

  async findOwnedActiveWorkspaces(tx: Tx, userId: string): Promise<OwnedWorkspace[]> {
    const workspaces = await tx.workspace.findMany({
      where: { ownerId: userId, status: 'ACTIVE' },
      select: {
        id: true,
        timezone: true,
        budgets: { where: { status: 'ACTIVE' }, select: { id: true } },
        memberships: {
          where: { isActive: true, userId: { not: userId } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return workspaces.map((workspace) => ({
      id: workspace.id,
      timezone: workspace.timezone,
      activeBudgetIds: workspace.budgets.map((budget) => budget.id),
      otherActiveMemberCount: workspace.memberships.length,
    }));
  }

  async archiveScope(tx: Tx, workspaceIds: string[], budgetIds: string[]): Promise<void> {
    if (budgetIds.length > 0)
      await tx.budget.updateMany({ where: { id: { in: budgetIds } }, data: { status: 'ARCHIVED' } });
    if (workspaceIds.length > 0)
      await tx.workspace.updateMany({
        where: { id: { in: workspaceIds } },
        data: { status: 'ARCHIVED' },
      });
  }

  /** Deactivates the user's memberships in workspaces they do not own; returns their ids. */
  async deactivateForeignMemberships(
    tx: Tx,
    userId: string,
    ownedWorkspaceIds: string[],
    now: Date,
  ): Promise<string[]> {
    const memberships = await tx.workspaceMembership.findMany({
      where: { userId, isActive: true, workspaceId: { notIn: ownedWorkspaceIds } },
      select: { id: true },
    });
    const ids = memberships.map((membership) => membership.id);
    if (ids.length > 0)
      await tx.workspaceMembership.updateMany({
        where: { id: { in: ids } },
        data: { isActive: false, removedAt: now },
      });
    return ids;
  }

  async revokeCredentials(tx: Tx, userId: string, now: Date): Promise<void> {
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'ACCOUNT_DELETED' },
    });
    await tx.recoveryToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
  }

  async createDeletion(
    tx: Tx,
    input: {
      userId: string;
      requestedAt: Date;
      purgeAfter: Date;
      restoreTokenHash: string;
      archivedWorkspaceIds: string[];
      archivedBudgetIds: string[];
      deactivatedMembershipIds: string[];
    },
  ): Promise<void> {
    await tx.accountDeletion.create({ data: { id: createUuidV7(input.requestedAt), ...input } });
  }

  async audit(
    tx: Tx,
    input: {
      userId: string;
      workspaceId: string | null;
      action: 'ACCOUNT_DELETION_REQUESTED' | 'ACCOUNT_DELETION_CANCELLED';
      purgeAfter: Date;
      requestId?: string;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: input.userId,
        workspaceId: input.workspaceId,
        entityType: 'auth',
        entityId: input.userId,
        action: input.action,
        newValues: { purgeAfter: input.purgeAfter.toISOString() },
        source: 'API',
        requestId: input.requestId ?? null,
      },
    });
  }
}
