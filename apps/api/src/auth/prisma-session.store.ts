import type { Prisma, SessionRevokeReason } from '@prisma/client';

import type { AuthenticatedSession, SessionStore, SessionView } from './auth.types.js';
import { PrismaService } from '../database/prisma.service.js';

export class PrismaSessionStore implements SessionStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    id: string;
    userId: string;
    tokenHash: string;
    csrfTokenHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.session.create({ data: input });
  }

  async findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthenticatedSession | null> {
    const session = await this.prisma.session.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
        user: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true, csrfTokenHash: true },
    });

    return session
      ? { userId: session.userId, sessionId: session.id, csrfTokenHash: session.csrfTokenHash }
      : null;
  }

  async touch(sessionId: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt: now },
    });
  }

  async revoke(
    userId: string,
    sessionId: string,
    reason: SessionRevokeReason,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return result.count === 1;
  }

  async revokeAll(userId: string, reason: SessionRevokeReason, now: Date): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return result.count;
  }

  async listActive(userId: string, now: Date): Promise<SessionView[]> {
    return this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        userAgent: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}

export type TransactionClient = Prisma.TransactionClient;
