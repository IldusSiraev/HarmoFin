import { UnprocessableEntityException } from '@nestjs/common';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { ApiConfig } from '../config/env.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { EmailSender } from './email-sender.js';
import type { TokenService } from './token.service.js';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;

type Meta = { requestId?: string };

/**
 * On-demand email confirmation, the prerequisite for email notifications. Mirrors password
 * recovery: only the HMAC digest of the token is stored, a new request voids the previous unused
 * tokens, and the address and the token never reach the audit trail.
 */
export class EmailVerificationApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly emailSender: EmailSender,
    private readonly config: Pick<ApiConfig, 'mail'>,
  ) {}

  async request(userId: string, meta: Meta): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true, emailVerifiedAt: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) return;

    const rawToken = this.tokens.createRawToken();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      await tx.emailVerificationToken.create({
        data: {
          id: createUuidV7(now),
          userId,
          tokenHash: this.tokens.digest(rawToken),
          expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: userId,
          entityType: 'auth',
          entityId: userId,
          action: 'EMAIL_VERIFICATION_REQUESTED',
          source: 'API',
          requestId: meta.requestId ?? null,
        },
      });
    });

    const verifyUrl = new URL('/verify-email', this.config.mail.webBaseUrl);
    verifyUrl.searchParams.set('token', rawToken);
    await this.emailSender.sendEmailVerification({
      recipient: user.email,
      verifyUrl: verifyUrl.toString(),
    });
  }

  async confirm(token: string, meta: Meta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const row = await tx.emailVerificationToken.findFirst({
        where: { tokenHash: this.tokens.digest(token), consumedAt: null, expiresAt: { gt: now } },
        select: { id: true, userId: true, user: { select: { status: true } } },
      });
      if (!row || row.user.status !== 'ACTIVE') throw invalidToken();
      const consumed = await tx.emailVerificationToken.updateMany({
        where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw invalidToken();
      await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: row.userId,
          entityType: 'auth',
          entityId: row.userId,
          action: 'EMAIL_VERIFIED',
          source: 'API',
          requestId: meta.requestId ?? null,
        },
      });
    });
  }
}

function invalidToken(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'EMAIL_VERIFICATION_TOKEN_INVALID',
    detail: 'Ссылка подтверждения недействительна или устарела. Запросите новую в настройках.',
  });
}
