import type { SessionRevokeReason } from '@prisma/client';

export interface SessionMetadata {
  userAgent?: string;
}

export interface CreatedSession {
  id: string;
  rawToken: string;
  rawCsrfToken: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface AuthenticatedSession {
  userId: string;
  sessionId: string;
  csrfTokenHash: string;
}

export interface SessionView {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  userAgent: string | null;
}

export interface SessionStore {
  create(input: {
    id: string;
    userId: string;
    tokenHash: string;
    csrfTokenHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    userAgent?: string;
  }): Promise<void>;
  findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthenticatedSession | null>;
  touch(sessionId: string, now: Date): Promise<void>;
  revoke(userId: string, sessionId: string, reason: SessionRevokeReason, now: Date): Promise<boolean>;
  revokeAll(userId: string, reason: SessionRevokeReason, now: Date): Promise<number>;
  listActive(userId: string, now: Date): Promise<SessionView[]>;
}
