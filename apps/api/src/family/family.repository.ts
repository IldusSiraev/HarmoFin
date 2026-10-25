import type { Prisma, WorkspaceMembershipRole } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export type Tx = Prisma.TransactionClient;

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: WorkspaceMembershipRole;
  joinedAt: Date;
}

/**
 * Serializes member/invitation limit checks of one workspace. Lock order everywhere:
 * actor membership (if any) -> workspace -> invitation rows -> acceptor membership.
 */
export async function lockActiveWorkspace(tx: Tx, workspaceId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid AND status = 'ACTIVE' FOR UPDATE
  `;
  return rows.length === 1;
}

export class FamilyRepository {
  constructor(private readonly prisma: PrismaService) {}

  lockWorkspace(tx: Tx, workspaceId: string): Promise<boolean> {
    return lockActiveWorkspace(tx, workspaceId);
  }

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  async lockActiveMembership(tx: Tx, workspaceId: string, userId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT m.id FROM workspace_memberships m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = ${workspaceId}::uuid AND m.user_id = ${userId}::uuid
        AND m.is_active = true AND w.status = 'ACTIVE'
      FOR UPDATE OF m
    `;
    if (locked.length === 0) return null;
    return tx.workspaceMembership.findFirst({
      where: { id: locked[0]!.id, workspaceId },
      select: {
        id: true,
        role: true,
        workspace: { select: { id: true, name: true, ownerId: true } },
      },
    });
  }

  findActiveMembership(workspaceId: string, userId: string) {
    return this.prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true, workspace: { status: 'ACTIVE' } },
      select: {
        id: true,
        role: true,
        workspace: { select: { id: true, name: true, ownerId: true } },
      },
    });
  }

  async listMembers(workspaceId: string): Promise<MemberRow[]> {
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, isActive: true, workspace: { status: 'ACTIVE' } },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .map((row) => ({
        membershipId: row.id,
        userId: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        role: row.role,
        joinedAt: row.createdAt,
      }))
      .sort((left, right) => Number(right.role === 'OWNER') - Number(left.role === 'OWNER'));
  }

  findMemberById(tx: Tx, workspaceId: string, membershipId: string) {
    return tx.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId, isActive: true },
      select: {
        id: true,
        role: true,
        userId: true,
        user: { select: { email: true, displayName: true } },
      },
    });
  }

  countActiveMembers(tx: Tx, workspaceId: string): Promise<number> {
    return tx.workspaceMembership.count({ where: { workspaceId, isActive: true } });
  }

  countPendingInvitations(tx: Tx, workspaceId: string, now: Date): Promise<number> {
    return tx.workspaceInvitation.count({
      where: { workspaceId, status: 'PENDING', expiresAt: { gt: now } },
    });
  }

  async findActiveBudgetId(tx: Tx, workspaceId: string): Promise<string | null> {
    const budget = await tx.budget.findFirst({
      where: { workspaceId, status: 'ACTIVE' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return budget?.id ?? null;
  }

  async audit(
    tx: Tx,
    input: {
      actorUserId: string;
      workspaceId: string;
      budgetId: string | null;
      entityType: string;
      entityId: string;
      action: string;
      newValues?: Prisma.InputJsonValue;
      requestId?: string | undefined;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId,
        budgetId: input.budgetId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        ...(input.newValues === undefined ? {} : { newValues: input.newValues }),
        source: 'API',
        requestId: input.requestId ?? null,
      },
    });
  }
}
