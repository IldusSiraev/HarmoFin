import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WorkspaceInvitationStatus } from '@prisma/client';

import type { EmailSender } from '../auth/email-sender.js';
import { EMAIL_SENDER } from '../auth/email-sender.js';
import { TokenService } from '../auth/token.service.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { API_CONFIG } from '../common/security/security.constants.js';
import type { ApiConfig } from '../config/env.js';
import {
  alreadyMember,
  displayNameRequired,
  invitationAlreadyAccepted,
  invitationAlreadyPending,
  invitationExpired,
  invitationLimitReached,
  invitationNotFound,
  invitationRevoked,
  memberLimitReached,
} from './family.errors.js';
import { FamilyRepository, type Tx } from './family.repository.js';
import { acceptInvitationInTx } from './invitation-acceptance.js';
import {
  MEMBER_LIMIT,
  PENDING_INVITATION_LIMIT,
  ROLE_LABELS,
  buildInviteUrl,
  invitationExpiresAt,
  isExpired,
  maskEmail,
  normalizeEmail,
  type InvitableRole,
} from './invitation.domain.js';

export interface InvitationResponse {
  id: string;
  email: string;
  role: InvitableRole;
  status: 'PENDING' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}
export type CreatedInvitationResponse = InvitationResponse & { inviteUrl: string };
export interface InvitationPreviewResponse {
  workspaceName: string;
  inviterName: string;
  role: InvitableRole;
  maskedEmail: string;
  expiresAt: string;
}
export interface AcceptedInvitationResponse {
  workspaceId: string;
  budgetId: string;
}

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  status: WorkspaceInvitationStatus;
  expiresAt: Date;
  createdAt: Date;
};

function toResponse(row: InvitationRow, now: Date): InvitationResponse {
  return {
    id: row.id,
    email: row.email,
    role: row.role as InvitableRole,
    status: row.status === 'PENDING' && !isExpired(row.expiresAt, now) ? 'PENDING' : 'EXPIRED',
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

const invitationSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} as const;

@Injectable()
export class InvitationsApplicationService {
  private readonly logger = new Logger('InvitationsApplicationService');

  constructor(
    private readonly repository: FamilyRepository,
    private readonly tokens: TokenService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'mail'>,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    input: { email: string; role: InvitableRole },
    requestId?: string,
  ): Promise<CreatedInvitationResponse> {
    const email = normalizeEmail(input.email);
    const rawToken = this.tokens.createRawToken();
    const now = new Date();
    const result = await this.repository.transaction(async (tx) => {
      const actor = await this.requireCreator(tx, workspaceId, userId);
      const inviter = await this.requireInviterName(tx, userId);
      // Concurrent accepts/creates of this workspace wait here, so limits cannot be overshot.
      if (!(await this.repository.lockWorkspace(tx, workspaceId))) throw resourceNotFound();
      await this.expireStale(tx, workspaceId, now);
      const existingMember = await tx.workspaceMembership.findFirst({
        where: { workspaceId, isActive: true, user: { email } },
        select: { id: true },
      });
      if (existingMember) throw alreadyMember();
      if ((await this.repository.countActiveMembers(tx, workspaceId)) >= MEMBER_LIMIT)
        throw memberLimitReached();
      if (
        (await this.repository.countPendingInvitations(tx, workspaceId, now)) >=
        PENDING_INVITATION_LIMIT
      )
        throw invitationLimitReached();
      let row: InvitationRow;
      try {
        row = await tx.workspaceInvitation.create({
          data: {
            id: createUuidV7(now),
            workspaceId,
            email,
            role: input.role,
            tokenHash: this.tokens.digest(rawToken),
            expiresAt: invitationExpiresAt(now),
            invitedByUserId: userId,
          },
          select: invitationSelect,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw invitationAlreadyPending();
        throw error;
      }
      await this.repository.audit(tx, {
        actorUserId: userId,
        workspaceId,
        budgetId: await this.repository.findActiveBudgetId(tx, workspaceId),
        entityType: 'workspace_invitation',
        entityId: row.id,
        action: 'CREATED',
        newValues: { role: input.role },
        requestId,
      });
      return { row, inviterName: inviter, workspaceName: actor.workspace.name };
    });
    return this.deliver(result.row, rawToken, result.inviterName, result.workspaceName, now);
  }

  async list(userId: string, workspaceId: string): Promise<InvitationResponse[]> {
    const now = new Date();
    return this.repository.transaction(async (tx) => {
      await this.requireCreator(tx, workspaceId, userId);
      await this.expireStale(tx, workspaceId, now);
      const rows = await tx.workspaceInvitation.findMany({
        where: { workspaceId, status: 'PENDING' },
        select: invitationSelect,
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => toResponse(row, now));
    });
  }

  async resend(
    userId: string,
    workspaceId: string,
    invitationId: string,
    requestId?: string,
  ): Promise<CreatedInvitationResponse> {
    const rawToken = this.tokens.createRawToken();
    const now = new Date();
    const result = await this.repository.transaction(async (tx) => {
      const actor = await this.requireCreator(tx, workspaceId, userId);
      const inviter = await this.requireInviterName(tx, userId);
      // Concurrent accepts/creates of this workspace wait here, so limits cannot be overshot.
      if (!(await this.repository.lockWorkspace(tx, workspaceId))) throw resourceNotFound();
      await this.expireStale(tx, workspaceId, now);
      const target = await tx.workspaceInvitation.findFirst({
        where: { id: invitationId, workspaceId, status: { in: ['PENDING', 'EXPIRED'] } },
        select: { id: true, email: true, status: true },
      });
      if (!target) throw resourceNotFound();
      // A row that lapsed to EXPIRED re-enters the active pool: re-check the same
      // invariants create() enforces (member limit, pending limit, not already a member).
      if (target.status === 'EXPIRED') {
        const existingMember = await tx.workspaceMembership.findFirst({
          where: { workspaceId, isActive: true, user: { email: target.email } },
          select: { id: true },
        });
        if (existingMember) throw alreadyMember();
        if ((await this.repository.countActiveMembers(tx, workspaceId)) >= MEMBER_LIMIT)
          throw memberLimitReached();
        if (
          (await this.repository.countPendingInvitations(tx, workspaceId, now)) >=
          PENDING_INVITATION_LIMIT
        )
          throw invitationLimitReached();
      }
      let row: InvitationRow;
      try {
        const updated = await tx.workspaceInvitation.updateMany({
          where: { id: invitationId, workspaceId, status: target.status },
          data: {
            status: 'PENDING',
            tokenHash: this.tokens.digest(rawToken),
            expiresAt: invitationExpiresAt(now),
          },
        });
        if (updated.count !== 1) throw resourceNotFound();
        row = await tx.workspaceInvitation.findFirstOrThrow({
          where: { id: invitationId, workspaceId },
          select: invitationSelect,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw invitationAlreadyPending();
        throw error;
      }
      await this.repository.audit(tx, {
        actorUserId: userId,
        workspaceId,
        budgetId: await this.repository.findActiveBudgetId(tx, workspaceId),
        entityType: 'workspace_invitation',
        entityId: row.id,
        action: 'RESENT',
        requestId,
      });
      return { row, inviterName: inviter, workspaceName: actor.workspace.name };
    });
    return this.deliver(result.row, rawToken, result.inviterName, result.workspaceName, now);
  }

  async revoke(userId: string, workspaceId: string, invitationId: string, requestId?: string) {
    await this.repository.transaction(async (tx) => {
      await this.requireCreator(tx, workspaceId, userId);
      const now = new Date();
      const updated = await tx.workspaceInvitation.updateMany({
        where: { id: invitationId, workspaceId, status: { in: ['PENDING', 'EXPIRED'] } },
        data: { status: 'REVOKED', revokedAt: now },
      });
      if (updated.count !== 1) throw resourceNotFound();
      await this.repository.audit(tx, {
        actorUserId: userId,
        workspaceId,
        budgetId: await this.repository.findActiveBudgetId(tx, workspaceId),
        entityType: 'workspace_invitation',
        entityId: invitationId,
        action: 'REVOKED',
        requestId,
      });
    });
  }

  async preview(rawToken: string): Promise<InvitationPreviewResponse> {
    const now = new Date();
    const row = await this.repository.transaction((tx) =>
      tx.workspaceInvitation.findFirst({
        where: { tokenHash: this.tokens.digest(rawToken), workspace: { status: 'ACTIVE' } },
        select: {
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          workspace: { select: { name: true } },
          invitedBy: { select: { displayName: true } },
        },
      }),
    );
    if (!row) throw invitationNotFound();
    if (row.status === 'ACCEPTED') throw invitationAlreadyAccepted();
    if (row.status === 'REVOKED') throw invitationRevoked();
    if (row.status === 'EXPIRED' || isExpired(row.expiresAt, now)) throw invitationExpired();
    return {
      workspaceName: row.workspace.name,
      inviterName: row.invitedBy.displayName ?? 'Создатель семьи',
      role: row.role as InvitableRole,
      maskedEmail: maskEmail(row.email),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async accept(
    userId: string,
    input: { token: string; displayName?: string | undefined },
    requestId?: string,
  ): Promise<AcceptedInvitationResponse> {
    const now = new Date();
    return this.repository.transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, displayName: true },
      });
      const displayName = input.displayName ?? user.displayName;
      if (!displayName) throw displayNameRequired();
      if (input.displayName && input.displayName !== user.displayName) {
        await tx.user.update({ where: { id: userId }, data: { displayName: input.displayName } });
      }
      const accepted = await acceptInvitationInTx(tx, {
        tokenHash: this.tokens.digest(input.token),
        userId,
        userEmail: user.email,
        now,
        requestId,
      });
      return { workspaceId: accepted.workspaceId, budgetId: accepted.budget.id };
    });
  }

  private async deliver(
    row: InvitationRow,
    rawToken: string,
    inviterName: string,
    workspaceName: string,
    now: Date,
  ): Promise<CreatedInvitationResponse> {
    const inviteUrl = buildInviteUrl(this.config.mail.webBaseUrl, rawToken);
    // Mail goes out after commit: a failed send still leaves the copyable link to the creator.
    await this.email
      .sendFamilyInvitation({
        recipient: row.email,
        inviteUrl,
        inviterName,
        workspaceName,
        roleLabel: ROLE_LABELS[row.role as InvitableRole],
      })
      .catch((error: unknown) =>
        this.logger.warn({
          event: 'family_invitation_email_failed',
          invitationId: row.id,
          errorName: error instanceof Error ? error.name : 'Unknown',
        }),
      );
    return { ...toResponse(row, now), inviteUrl };
  }

  private async expireStale(tx: Tx, workspaceId: string, now: Date): Promise<void> {
    await tx.workspaceInvitation.updateMany({
      where: { workspaceId, status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
  }

  private async requireCreator(tx: Tx, workspaceId: string, userId: string) {
    const membership = await this.repository.lockActiveMembership(tx, workspaceId, userId);
    if (!membership) throw resourceNotFound();
    if (membership.role !== 'OWNER' || membership.workspace.ownerId !== userId) throw forbidden();
    return membership;
  }

  private async requireInviterName(tx: Tx, userId: string): Promise<string> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });
    if (!user.displayName) throw displayNameRequired();
    return user.displayName;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
