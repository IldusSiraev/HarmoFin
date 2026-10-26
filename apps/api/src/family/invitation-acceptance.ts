import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { createAccessNotification } from './family-notifications.js';
import {
  alreadyMember,
  invitationAlreadyAccepted,
  invitationEmailMismatch,
  invitationExpired,
  invitationNotFound,
  invitationRevoked,
  memberLimitReached,
} from './family.errors.js';
import { lockActiveWorkspace, type Tx } from './family.repository.js';
import { MEMBER_LIMIT, isExpired, normalizeEmail } from './invitation.domain.js';

type LockedInvitation = {
  id: string;
  workspaceId: string;
  email: string;
  role: 'EDITOR' | 'VIEWER';
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: Date;
};

export interface AcceptedInvitation {
  workspaceId: string;
  workspaceName: string;
  budget: { id: string; name: string; primaryCurrency: string };
}

/** Row lock serializes concurrent accepts of the same token: the second one sees ACCEPTED. */
export async function lockInvitationByTokenHash(
  tx: Tx,
  tokenHash: string,
): Promise<LockedInvitation | null> {
  const rows = await tx.$queryRaw<LockedInvitation[]>`
    SELECT i.id, i.workspace_id AS "workspaceId", i.email, i.role::text AS role,
           i.status::text AS status, i.expires_at AS "expiresAt"
    FROM workspace_invitations i
    JOIN workspaces w ON w.id = i.workspace_id AND w.status = 'ACTIVE'
    WHERE i.token_hash = ${tokenHash}
    FOR UPDATE OF i
  `;
  return rows[0] ?? null;
}

/** Validates state and email, then creates or reactivates the membership. Caller owns the tx. */
export async function acceptInvitationInTx(
  tx: Tx,
  input: {
    tokenHash: string;
    userId: string;
    userEmail: string;
    now: Date;
    requestId?: string | undefined;
  },
): Promise<AcceptedInvitation> {
  // Lock the workspace before the invitation row (same order as create/resend: workspace ->
  // invitations), so accepts of different invitations serialize on the member limit.
  const target = await tx.workspaceInvitation.findFirst({
    where: { tokenHash: input.tokenHash },
    select: { workspaceId: true },
  });
  if (!target || !(await lockActiveWorkspace(tx, target.workspaceId))) throw invitationNotFound();
  const invitation = await lockInvitationByTokenHash(tx, input.tokenHash);
  if (!invitation || invitation.workspaceId !== target.workspaceId) throw invitationNotFound();
  if (invitation.status === 'ACCEPTED') throw invitationAlreadyAccepted();
  if (invitation.status === 'REVOKED') throw invitationRevoked();
  if (invitation.status === 'EXPIRED' || isExpired(invitation.expiresAt, input.now)) {
    // The caller's tx rolls back on the thrown error; the lapse is recorded lazily elsewhere.
    throw invitationExpired();
  }
  if (normalizeEmail(input.userEmail) !== invitation.email) throw invitationEmailMismatch();

  const existing = await tx.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: input.userId } },
    select: { id: true, isActive: true },
  });
  if (existing?.isActive) throw alreadyMember();
  const activeCount = await tx.workspaceMembership.count({
    where: { workspaceId: invitation.workspaceId, isActive: true },
  });
  if (activeCount >= MEMBER_LIMIT) throw memberLimitReached();

  const membershipId = existing?.id ?? createUuidV7(input.now);
  if (existing) {
    await tx.workspaceMembership.update({
      where: { id: existing.id },
      data: { isActive: true, removedAt: null, role: invitation.role, lastSelectedAt: input.now },
    });
  } else {
    await tx.workspaceMembership.create({
      data: {
        id: membershipId,
        workspaceId: invitation.workspaceId,
        userId: input.userId,
        role: invitation.role,
        lastSelectedAt: input.now,
      },
    });
  }
  await tx.workspaceInvitation.update({
    where: { id: invitation.id },
    data: { status: 'ACCEPTED', acceptedAt: input.now, acceptedByUserId: input.userId },
  });

  const workspace = await tx.workspace.findUniqueOrThrow({
    where: { id: invitation.workspaceId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      budgets: {
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, primaryCurrency: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });
  const budget = workspace.budgets[0];
  if (!budget) throw invitationNotFound();
  const member = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { displayName: true, email: true },
  });
  await tx.auditEvent.create({
    data: {
      id: createUuidV7(input.now),
      actorUserId: input.userId,
      workspaceId: workspace.id,
      budgetId: budget.id,
      entityType: 'workspace_invitation',
      entityId: invitation.id,
      action: 'ACCEPTED',
      newValues: { role: invitation.role, membershipId },
      source: 'API',
      requestId: input.requestId ?? null,
    },
  });
  await createAccessNotification(tx, {
    workspaceId: workspace.id,
    budgetId: budget.id,
    userId: workspace.ownerId,
    type: 'MEMBER_JOINED',
    memberName: member.displayName ?? member.email,
    eventKey: invitation.id,
  });
  return { workspaceId: workspace.id, workspaceName: workspace.name, budget };
}
