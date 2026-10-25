import { Injectable } from '@nestjs/common';

import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { cannotChangeCreator } from './family.errors.js';
import { createAccessNotification, resolveUserNotifications } from './family-notifications.js';
import { FamilyRepository, type MemberRow, type Tx } from './family.repository.js';
import type { InvitableRole } from './invitation.domain.js';
import { createPersonalWorkspace } from './personal-workspace.js';

export interface MemberResponse {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  isCreator: boolean;
  joinedAt: string;
}

function toResponse(row: MemberRow, ownerId: string): MemberResponse {
  return {
    membershipId: row.membershipId,
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    isCreator: row.userId === ownerId,
    joinedAt: row.joinedAt.toISOString(),
  };
}

@Injectable()
export class MembersApplicationService {
  constructor(private readonly repository: FamilyRepository) {}

  async list(userId: string, workspaceId: string): Promise<MemberResponse[]> {
    const membership = await this.repository.findActiveMembership(workspaceId, userId);
    if (!membership) throw resourceNotFound();
    const rows = await this.repository.listMembers(workspaceId);
    return rows.map((row) => toResponse(row, membership.workspace.ownerId));
  }

  async changeRole(
    userId: string,
    workspaceId: string,
    membershipId: string,
    role: InvitableRole,
    requestId?: string,
  ): Promise<MemberResponse> {
    return this.repository.transaction(async (tx) => {
      const actor = await this.requireCreator(tx, workspaceId, userId);
      const target = await this.repository.findMemberById(tx, workspaceId, membershipId);
      if (!target) throw resourceNotFound();
      if (target.userId === actor.workspace.ownerId) throw cannotChangeCreator();
      const updated = await tx.workspaceMembership.updateMany({
        where: { id: target.id, workspaceId, isActive: true },
        data: { role },
      });
      if (updated.count !== 1) throw resourceNotFound();
      await this.repository.audit(tx, {
        actorUserId: userId,
        workspaceId,
        budgetId: await this.repository.findActiveBudgetId(tx, workspaceId),
        entityType: 'workspace_membership',
        entityId: target.id,
        action: 'ROLE_CHANGED',
        newValues: { from: target.role, to: role },
        requestId,
      });
      const rows = await tx.workspaceMembership.findFirstOrThrow({
        where: { id: target.id, workspaceId },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true, displayName: true } },
        },
      });
      return toResponse(
        {
          membershipId: rows.id,
          userId: rows.user.id,
          email: rows.user.email,
          displayName: rows.user.displayName,
          role: rows.role,
          joinedAt: rows.createdAt,
        },
        actor.workspace.ownerId,
      );
    });
  }

  async remove(userId: string, workspaceId: string, membershipId: string, requestId?: string) {
    await this.repository.transaction(async (tx) => {
      const actor = await this.requireCreator(tx, workspaceId, userId);
      const target = await this.repository.findMemberById(tx, workspaceId, membershipId);
      if (!target) throw resourceNotFound();
      if (target.userId === actor.workspace.ownerId) throw cannotChangeCreator();
      await this.deactivate(tx, {
        workspaceId,
        ownerId: actor.workspace.ownerId,
        membershipId: target.id,
        memberUserId: target.userId,
        memberName: target.user.displayName ?? target.user.email,
        actorUserId: userId,
        action: 'REMOVED',
        requestId,
      });
    });
  }

  async leave(userId: string, workspaceId: string, requestId?: string) {
    await this.repository.transaction(async (tx) => {
      const membership = await this.repository.lockActiveMembership(tx, workspaceId, userId);
      if (!membership) throw resourceNotFound();
      if (membership.workspace.ownerId === userId) throw cannotChangeCreator();
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, displayName: true },
      });
      await this.deactivate(tx, {
        workspaceId,
        ownerId: membership.workspace.ownerId,
        membershipId: membership.id,
        memberUserId: userId,
        memberName: user.displayName ?? user.email,
        actorUserId: userId,
        action: 'LEFT',
        requestId,
      });
    });
  }

  async select(userId: string, workspaceId: string): Promise<void> {
    const result = await this.repository.transaction((tx) =>
      tx.workspaceMembership.updateMany({
        where: { workspaceId, userId, isActive: true, workspace: { status: 'ACTIVE' } },
        data: { lastSelectedAt: new Date() },
      }),
    );
    if (result.count !== 1) throw resourceNotFound();
  }

  private async requireCreator(tx: Tx, workspaceId: string, userId: string) {
    const membership = await this.repository.lockActiveMembership(tx, workspaceId, userId);
    if (!membership) throw resourceNotFound();
    if (membership.role !== 'OWNER' || membership.workspace.ownerId !== userId) throw forbidden();
    return membership;
  }

  private async deactivate(
    tx: Tx,
    input: {
      workspaceId: string;
      ownerId: string;
      membershipId: string;
      memberUserId: string;
      memberName: string;
      actorUserId: string;
      action: 'REMOVED' | 'LEFT';
      requestId?: string | undefined;
    },
  ): Promise<void> {
    const now = new Date();
    const deactivated = await tx.workspaceMembership.updateMany({
      where: { id: input.membershipId, workspaceId: input.workspaceId, isActive: true },
      data: { isActive: false, removedAt: now, lastSelectedAt: null },
    });
    if (deactivated.count !== 1) throw resourceNotFound();
    await resolveUserNotifications(tx, input.workspaceId, input.memberUserId, now);
    const budgetId = await this.repository.findActiveBudgetId(tx, input.workspaceId);
    await this.repository.audit(tx, {
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      budgetId,
      entityType: 'workspace_membership',
      entityId: input.membershipId,
      action: input.action,
      requestId: input.requestId,
    });
    if (budgetId) {
      await createAccessNotification(tx, {
        workspaceId: input.workspaceId,
        budgetId,
        userId: input.ownerId,
        type: input.action === 'REMOVED' ? 'MEMBER_REMOVED' : 'MEMBER_LEFT',
        memberName: input.memberName,
        eventKey: `${input.membershipId}:${now.toISOString()}`,
      });
    }
    const remaining = await tx.workspaceMembership.count({
      where: { userId: input.memberUserId, isActive: true, workspace: { status: 'ACTIVE' } },
    });
    if (remaining === 0) await createPersonalWorkspace(tx, input.memberUserId, now, input.requestId);
  }
}
