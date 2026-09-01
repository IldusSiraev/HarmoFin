import { randomBytes } from 'node:crypto';

import type { SessionRevokeReason } from '@prisma/client';

import type {
  AuthenticatedSession,
  CreatedSession,
  SessionMetadata,
  SessionStore,
  SessionView,
} from './auth.types.js';
import { TokenService } from './token.service.js';

const IDLE_TIMEOUT_MS = 2_592_000_000;
const ABSOLUTE_TIMEOUT_MS = 7_776_000_000;
const LAST_SEEN_INTERVAL_MS = 300_000;

export class SessionService {
  private readonly lastTouchedAt = new Map<string, number>();

  constructor(
    private readonly store: SessionStore,
    private readonly tokenService: TokenService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(userId: string, metadata: SessionMetadata): Promise<CreatedSession> {
    const now = this.now();
    const rawToken = this.tokenService.createRawToken();
    const rawCsrfToken = this.tokenService.createRawToken();
    const idleExpiresAt = new Date(now.getTime() + IDLE_TIMEOUT_MS);
    const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS);
    const id = createUuidV7(now);

    await this.store.create({
      id,
      userId,
      tokenHash: this.tokenService.digest(rawToken),
      csrfTokenHash: this.tokenService.digest(rawCsrfToken),
      idleExpiresAt,
      absoluteExpiresAt,
      ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 512) } : {}),
    });

    return { id, rawToken, rawCsrfToken, idleExpiresAt, absoluteExpiresAt };
  }

  async authenticate(rawToken: string): Promise<AuthenticatedSession | null> {
    const now = this.now();
    const session = await this.store.findActiveByTokenHash(this.tokenService.digest(rawToken), now);
    if (!session) return null;

    const lastTouchedAt = this.lastTouchedAt.get(session.sessionId);
    if (lastTouchedAt === undefined || now.getTime() - lastTouchedAt >= LAST_SEEN_INTERVAL_MS) {
      await this.store.touch(session.sessionId, now);
      this.lastTouchedAt.set(session.sessionId, now.getTime());
    }

    return session;
  }

  async rotateForUser(userId: string, metadata: SessionMetadata): Promise<CreatedSession> {
    await this.store.revokeAll(userId, 'ROTATED', this.now());
    return this.create(userId, metadata);
  }

  revoke(userId: string, sessionId: string, reason: SessionRevokeReason): Promise<boolean> {
    this.lastTouchedAt.delete(sessionId);
    return this.store.revoke(userId, sessionId, reason, this.now());
  }

  revokeAll(userId: string, reason: SessionRevokeReason): Promise<number> {
    return this.store.revokeAll(userId, reason, this.now());
  }

  list(userId: string): Promise<SessionView[]> {
    return this.store.listActive(userId, this.now());
  }
}

function createUuidV7(now: Date): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now.getTime());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes.set([((bytes.at(6) ?? 0) & 0x0f) | 0x70], 6);
  bytes.set([((bytes.at(8) ?? 0) & 0x3f) | 0x80], 8);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
