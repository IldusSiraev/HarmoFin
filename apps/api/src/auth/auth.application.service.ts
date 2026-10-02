import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { ApiConfig } from '../config/env.js';
import { MetricsRegistry } from '../observability/observability.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RecoveryConfirmInput,
  RegisterInput,
} from './auth.schemas.js';
import { AuthRepository } from './auth.repository.js';
import type { CreatedSession, SessionMetadata, SessionView } from './auth.types.js';
import type { EmailSender } from './email-sender.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

const IDLE_TIMEOUT_MS = 2_592_000_000;
const ABSOLUTE_TIMEOUT_MS = 7_776_000_000;
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FmZS1kdW1teS1zYWx0$WeyNVcsROX0VZXbLzZ1g24lOinVi59tTzMUD1M9oHz0';

export interface RequestMeta extends SessionMetadata {
  requestId?: string;
  currentSessionId?: string;
}

export interface AuthSessionResponse {
  user: { id: string; email: string; displayName: string | null };
  workspace: { id: string; name: string };
  budget: { id: string; name: string; primaryCurrency: string };
  csrfToken: string;
  session: CreatedSession;
}

@Injectable()
export class AuthApplicationService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly emailSender: EmailSender,
    private readonly config: ApiConfig,
    private readonly metrics: MetricsRegistry,
  ) {}

  async register(input: RegisterInput, requestMeta: RequestMeta): Promise<AuthSessionResponse> {
    const passwordHash = await this.passwordService.hash(input.password);
    const session = await this.repository.transaction(async (tx) => {
      const userId = createUuidV7();
      const workspaceId = createUuidV7();
      const budgetId = createUuidV7();
      const now = new Date();

      let user;
      try {
        user = await tx.user.create({
          data: { id: userId, email: input.email, passwordHash },
          select: { id: true, email: true, displayName: true },
        });
      } catch (error) {
        if (isUniqueConstraint(error)) {
          throw new ConflictException({
            code: 'EMAIL_ALREADY_REGISTERED',
            detail: 'Пользователь с таким email уже зарегистрирован.',
          });
        }
        throw error;
      }

      const workspace = await tx.workspace.create({
        data: { id: workspaceId, ownerId: user.id, name: input.workspaceName ?? 'Мой бюджет' },
        select: { id: true, name: true },
      });
      await tx.workspaceMembership.create({
        data: { id: createUuidV7(), workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
      });
      const budget = await tx.budget.create({
        data: {
          id: budgetId,
          workspaceId: workspace.id,
          name: input.budgetName ?? 'Семейный бюджет',
        },
        select: { id: true, name: true, primaryCurrency: true },
      });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: user.id,
          workspaceId: workspace.id,
          budgetId: budget.id,
          entityType: 'user',
          entityId: user.id,
          action: 'REGISTERED',
          source: 'API',
          requestId: requestMeta.requestId ?? null,
        },
      });
      const createdSession = await this.createSession(tx, user.id, requestMeta, now);

      return { user, workspace, budget, session: createdSession };
    });

    return { ...session, csrfToken: session.session.rawCsrfToken };
  }

  async login(input: LoginInput, requestMeta: RequestMeta): Promise<AuthSessionResponse> {
    const user = await this.repository.findUserByEmail(input.email);
    const passwordMatches = await this.passwordService.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      input.password,
    );
    if (!user || user.status !== 'ACTIVE' || !passwordMatches) {
      this.metrics.increment('login_failures_total');
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        detail: 'Неверный email или пароль.',
      });
    }

    const result = await this.repository.transaction(async (tx) => {
      const now = new Date();
      if (requestMeta.currentSessionId) {
        await tx.session.updateMany({
          where: { id: requestMeta.currentSessionId, userId: user.id, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'ROTATED' },
        });
      }
      const createdSession = await this.createSession(tx, user.id, requestMeta, now);
      const membership = await this.findDefaultMembership(tx, user.id);
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: user.id,
          workspaceId: membership.workspace.id,
          budgetId: membership.workspace.budgets[0]?.id ?? null,
          entityType: 'auth',
          entityId: user.id,
          action: 'LOGIN',
          source: 'API',
          requestId: requestMeta.requestId ?? null,
        },
      });
      return { membership, session: createdSession };
    });

    const budget = result.membership.workspace.budgets[0];
    if (!budget)
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        detail: 'Сессия недействительна.',
      });

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      workspace: { id: result.membership.workspace.id, name: result.membership.workspace.name },
      budget: { id: budget.id, name: budget.name, primaryCurrency: budget.primaryCurrency },
      csrfToken: result.session.rawCsrfToken,
      session: result.session,
    };
  }

  async requestRecovery(email: string, requestMeta: RequestMeta): Promise<void> {
    const user = await this.repository.findUserByEmail(email);
    if (!user || user.status !== 'ACTIVE') return;

    const rawToken = this.tokenService.createRawToken();
    await this.repository.transaction(async (tx) => {
      const now = new Date();
      await tx.recoveryToken.updateMany({
        where: { userId: user.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      await tx.recoveryToken.create({
        data: {
          id: createUuidV7(),
          userId: user.id,
          tokenHash: this.tokenService.digest(rawToken),
          expiresAt: new Date(now.getTime() + this.config.auth.recoveryTtlSeconds * 1_000),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: user.id,
          entityType: 'auth',
          entityId: user.id,
          action: 'RECOVERY_REQUESTED',
          source: 'API',
          requestId: requestMeta.requestId ?? null,
        },
      });
    });

    const resetUrl = new URL('/reset-password', this.config.mail.webBaseUrl);
    resetUrl.searchParams.set('token', rawToken);
    await this.emailSender.sendPasswordRecovery({
      recipient: user.email,
      resetUrl: resetUrl.toString(),
    });
  }

  async confirmRecovery(
    input: RecoveryConfirmInput,
    requestMeta: RequestMeta,
  ): Promise<AuthSessionResponse> {
    const passwordHash = await this.passwordService.hash(input.password);
    const result = await this.repository.transaction(async (tx) => {
      const now = new Date();
      const recovery = await tx.recoveryToken.findFirst({
        where: {
          tokenHash: this.tokenService.digest(input.token),
          consumedAt: null,
          expiresAt: { gt: now },
        },
        select: {
          id: true,
          userId: true,
          user: { select: { email: true, displayName: true, status: true } },
        },
      });
      if (!recovery || recovery.user.status !== 'ACTIVE') throw invalidRecoveryToken();
      const consumed = await tx.recoveryToken.updateMany({
        where: { id: recovery.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw invalidRecoveryToken();

      await tx.user.update({ where: { id: recovery.userId }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { userId: recovery.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'PASSWORD_RESET' },
      });
      const createdSession = await this.createSession(tx, recovery.userId, requestMeta, now);
      const membership = await this.findDefaultMembership(tx, recovery.userId);
      const budget = membership.workspace.budgets[0];
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: recovery.userId,
          workspaceId: membership.workspace.id,
          budgetId: budget?.id ?? null,
          entityType: 'auth',
          entityId: recovery.userId,
          action: 'PASSWORD_RESET',
          source: 'API',
          requestId: requestMeta.requestId ?? null,
        },
      });
      return { recovery, membership, session: createdSession };
    });

    const budget = result.membership.workspace.budgets[0];
    if (!budget) throw invalidRecoveryToken();
    return {
      user: {
        id: result.recovery.userId,
        email: result.recovery.user.email,
        displayName: result.recovery.user.displayName,
      },
      workspace: { id: result.membership.workspace.id, name: result.membership.workspace.name },
      budget: { id: budget.id, name: budget.name, primaryCurrency: budget.primaryCurrency },
      csrfToken: result.session.rawCsrfToken,
      session: result.session,
    };
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    requestMeta: RequestMeta,
  ): Promise<AuthSessionResponse> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== 'ACTIVE')
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        detail: 'Сессия недействительна.',
      });
    const persisted = await this.repository.findUserByEmail(user.email);
    if (
      !persisted ||
      !(await this.passwordService.verify(persisted.passwordHash, input.currentPassword))
    ) {
      throw new UnprocessableEntityException({
        code: 'CURRENT_PASSWORD_INVALID',
        detail: 'Текущий пароль неверен.',
      });
    }
    const passwordHash = await this.passwordService.hash(input.newPassword);
    const result = await this.repository.transaction(async (tx) => {
      const now = new Date();
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'PASSWORD_CHANGED' },
      });
      const session = await this.createSession(tx, user.id, requestMeta, now);
      const membership = await this.findDefaultMembership(tx, user.id);
      const budget = membership.workspace.budgets[0];
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: user.id,
          workspaceId: membership.workspace.id,
          budgetId: budget?.id ?? null,
          entityType: 'auth',
          entityId: user.id,
          action: 'PASSWORD_CHANGED',
          source: 'API',
          requestId: requestMeta.requestId ?? null,
        },
      });
      return { membership, session };
    });
    const budget = result.membership.workspace.budgets[0];
    if (!budget)
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        detail: 'Сессия недействительна.',
      });
    return {
      user,
      workspace: { id: result.membership.workspace.id, name: result.membership.workspace.name },
      budget: { id: budget.id, name: budget.name, primaryCurrency: budget.primaryCurrency },
      csrfToken: result.session.rawCsrfToken,
      session: result.session,
    };
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.sessionService.revoke(userId, sessionId, 'LOGOUT');
  }

  listSessions(userId: string): Promise<SessionView[]> {
    return this.sessionService.list(userId);
  }
  revokeSession(userId: string, sessionId: string): Promise<boolean> {
    return this.sessionService.revoke(userId, sessionId, 'ALL_SESSIONS_REVOKED');
  }
  revokeAllSessions(userId: string): Promise<number> {
    return this.sessionService.revokeAll(userId, 'ALL_SESSIONS_REVOKED');
  }

  async rotateCsrfToken(userId: string, sessionId: string): Promise<string> {
    const rawToken = this.tokenService.createRawToken();
    const result = await this.repository.transaction((tx) =>
      tx.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { csrfTokenHash: this.tokenService.digest(rawToken) },
      }),
    );
    if (result.count !== 1)
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        detail: 'Сессия недействительна.',
      });
    return rawToken;
  }

  async me(userId: string): Promise<{
    user: { id: string; email: string; displayName: string | null };
    workspaces: Array<{
      id: string;
      name: string;
      role: string;
      budgets: Array<{
        id: string;
        name: string;
        primaryCurrency: string;
        planModelVersion: number;
      }>;
    }>;
  }> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== 'ACTIVE')
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        detail: 'Сессия недействительна.',
      });
    const memberships = await this.repository.transaction((tx) =>
      tx.workspaceMembership.findMany({
        where: { userId, isActive: true, workspace: { status: 'ACTIVE' } },
        select: {
          role: true,
          workspace: {
            select: {
              id: true,
              name: true,
              budgets: {
                where: { status: 'ACTIVE' },
                select: { id: true, name: true, primaryCurrency: true, planModelVersion: true },
              },
            },
          },
        },
      }),
    );
    return { user, workspaces: memberships.map(({ role, workspace }) => ({ ...workspace, role })) };
  }

  private async createSession(
    tx: Prisma.TransactionClient,
    userId: string,
    metadata: SessionMetadata,
    now: Date,
  ): Promise<CreatedSession> {
    const rawToken = this.tokenService.createRawToken();
    const rawCsrfToken = this.tokenService.createRawToken();
    const idleExpiresAt = new Date(now.getTime() + IDLE_TIMEOUT_MS);
    const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS);
    const id = createUuidV7(now);
    await tx.session.create({
      data: {
        id,
        userId,
        tokenHash: this.tokenService.digest(rawToken),
        csrfTokenHash: this.tokenService.digest(rawCsrfToken),
        idleExpiresAt,
        absoluteExpiresAt,
        ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 512) } : {}),
      },
    });
    return { id, rawToken, rawCsrfToken, idleExpiresAt, absoluteExpiresAt };
  }

  private findDefaultMembership(tx: Prisma.TransactionClient, userId: string) {
    return tx.workspaceMembership.findFirstOrThrow({
      where: { userId, isActive: true, workspace: { status: 'ACTIVE' } },
      select: {
        workspace: {
          select: {
            id: true,
            name: true,
            budgets: {
              where: { status: 'ACTIVE' },
              select: { id: true, name: true, primaryCurrency: true },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function invalidRecoveryToken(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INVALID_RECOVERY_TOKEN',
    detail: 'Ссылка восстановления недействительна или истекла.',
  });
}
