import {
  ConflictException,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { PasswordService } from '../auth/password.service.js';
import type { TokenService } from '../auth/token.service.js';
import type { EmailSender } from '../auth/email-sender.js';
import type { ApiConfig } from '../config/env.js';
import type { CancelDeletionInput, RequestDeletionInput } from './account-deletion.schemas.js';
import type { AccountDeletionRepository } from './account-deletion.repository.js';

export const ACCOUNT_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1_000;

export class AccountDeletionApplicationService {
  private readonly logger = new Logger('AccountDeletion');

  constructor(
    private readonly repository: AccountDeletionRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly emailSender: EmailSender,
    private readonly config: Pick<ApiConfig, 'mail'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async requestDeletion(
    userId: string,
    input: RequestDeletionInput,
    meta: { requestId?: string },
  ): Promise<{ purgeAfter: Date }> {
    const user = await this.repository.findUserCredentials(userId);
    if (!user || user.status !== 'ACTIVE') throw sessionInvalid();
    if (!(await this.passwordService.verify(user.passwordHash, input.password)))
      throw passwordInvalid();

    const rawToken = this.tokenService.createRawToken();
    const now = this.clock();
    const purgeAfter = new Date(now.getTime() + ACCOUNT_DELETION_GRACE_MS);

    const timezone = await this.repository.transaction(async (tx) => {
      if (!(await this.repository.claimActiveUser(tx, userId))) throw sessionInvalid();
      const owned = await this.repository.findOwnedActiveWorkspaces(tx, userId);
      if (owned.some((workspace) => workspace.otherActiveMemberCount > 0)) throw hasMembers();

      const workspaceIds = owned.map((workspace) => workspace.id);
      const budgetIds = owned.flatMap((workspace) => workspace.activeBudgetIds);
      const membershipIds = await this.repository.deactivateForeignMemberships(
        tx,
        userId,
        workspaceIds,
        now,
      );
      await this.repository.archiveScope(tx, workspaceIds, budgetIds);
      await this.repository.revokeCredentials(tx, userId, now);
      await this.repository.createDeletion(tx, {
        userId,
        requestedAt: now,
        purgeAfter,
        restoreTokenHash: this.tokenService.digest(rawToken),
        archivedWorkspaceIds: workspaceIds,
        archivedBudgetIds: budgetIds,
        deactivatedMembershipIds: membershipIds,
      });
      await this.repository.audit(tx, {
        userId,
        workspaceId: workspaceIds[0] ?? null,
        action: 'ACCOUNT_DELETION_REQUESTED',
        purgeAfter,
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      });
      return owned[0]?.timezone ?? 'Europe/Moscow';
    });

    const restoreUrl = new URL('/restore-account', this.config.mail.webBaseUrl);
    restoreUrl.searchParams.set('token', rawToken);
    try {
      await this.emailSender.sendAccountDeletionScheduled({
        recipient: user.email,
        restoreUrl: restoreUrl.toString(),
        purgeDateLabel: formatDate(purgeAfter, timezone),
      });
    } catch (error) {
      // The deletion is committed; the operator can resend the link (runbook).
      this.logger.warn({
        event: 'account_deletion_email_failed',
        userId,
        errorName: error instanceof Error ? error.name : 'Unknown',
      });
    }
    return { purgeAfter };
  }

  async cancelDeletion(input: CancelDeletionInput, meta: { requestId?: string }): Promise<void> {
    const now = this.clock();
    await this.repository.transaction(async (tx) => {
      const deletion = await this.repository.lockOpenDeletionByTokenHash(
        tx,
        this.tokenService.digest(input.token),
        now,
      );
      if (!deletion) throw invalidRestoreToken();
      if (!(await this.repository.reactivateUser(tx, deletion.userId))) throw invalidRestoreToken();
      await this.repository.restoreScope(tx, deletion);
      await this.repository.markRestored(tx, deletion.id, now);
      await this.repository.audit(tx, {
        userId: deletion.userId,
        workspaceId: deletion.archivedWorkspaceIds[0] ?? null,
        action: 'ACCOUNT_DELETION_CANCELLED',
        purgeAfter: deletion.purgeAfter,
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      });
    });
  }
}

function formatDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
}

function sessionInvalid(): UnauthorizedException {
  return new UnauthorizedException({ code: 'SESSION_INVALID', detail: 'Сессия недействительна.' });
}

function passwordInvalid(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'CURRENT_PASSWORD_INVALID',
    detail: 'Пароль неверен.',
    fieldErrors: [{ field: 'password', message: 'Пароль неверен.', code: 'invalid' }],
  });
}

function invalidRestoreToken(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'ACCOUNT_RESTORE_TOKEN_INVALID',
    detail: 'Ссылка недействительна или устарела.',
  });
}

function hasMembers(): ConflictException {
  return new ConflictException({
    code: 'ACCOUNT_DELETION_HAS_MEMBERS',
    detail: 'В бюджете есть другие участники. Сначала отключите их доступ.',
  });
}
