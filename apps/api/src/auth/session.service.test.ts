import { describe, expect, it, vi } from 'vitest';

import type { SessionStore } from './auth.types.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

describe('SessionService', () => {
  it('stores only token digests and sets fixed expiry dates', async () => {
    const store = createStore();
    const now = new Date('2026-09-01T00:00:00.000Z');
    const service = new SessionService(
      store,
      new TokenService('test-only-secret-with-at-least-32-bytes'),
      () => now,
    );

    const session = await service.create('01800000-0000-7000-8000-000000000001', {
      userAgent: 'Test browser',
    });

    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '01800000-0000-7000-8000-000000000001',
        tokenHash: expect.not.stringMatching(session.rawToken),
        csrfTokenHash: expect.not.stringMatching(session.rawCsrfToken),
        userAgent: 'Test browser',
      }),
    );
    expect(session.idleExpiresAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(session.absoluteExpiresAt).toEqual(new Date('2026-11-30T00:00:00.000Z'));
  });

  it('authenticates active session and throttles last seen updates', async () => {
    const store = createStore({
      findActiveByTokenHash: vi.fn(async () => ({
        userId: '01800000-0000-7000-8000-000000000001',
        sessionId: '01800000-0000-7000-8000-000000000002',
        csrfTokenHash: 'hash',
      })),
    });
    const now = new Date('2026-09-01T00:00:00.000Z');
    const service = new SessionService(
      store,
      new TokenService('test-only-secret-with-at-least-32-bytes'),
      () => now,
    );

    await expect(service.authenticate('raw-token')).resolves.toEqual({
      userId: '01800000-0000-7000-8000-000000000001',
      sessionId: '01800000-0000-7000-8000-000000000002',
      csrfTokenHash: 'hash',
    });
    await service.authenticate('raw-token');

    expect(store.touch).toHaveBeenCalledTimes(1);
  });

  it('rotates by revoking every old session before creating one', async () => {
    const store = createStore();
    const service = new SessionService(
      store,
      new TokenService('test-only-secret-with-at-least-32-bytes'),
      () => new Date('2026-09-01T00:00:00.000Z'),
    );

    const session = await service.rotateForUser('01800000-0000-7000-8000-000000000001', {});

    expect(store.revokeAll).toHaveBeenCalledWith(
      '01800000-0000-7000-8000-000000000001',
      'ROTATED',
      new Date('2026-09-01T00:00:00.000Z'),
    );
    expect(session.rawToken).toEqual(expect.any(String));
  });

  it('does not expose token material in active session list', async () => {
    const store = createStore({
      listActive: vi.fn(async () => [
        {
          id: '01800000-0000-7000-8000-000000000002',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          lastSeenAt: new Date('2026-09-01T00:00:00.000Z'),
          idleExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
          absoluteExpiresAt: new Date('2026-11-30T00:00:00.000Z'),
          userAgent: null,
        },
      ]),
    });
    const service = new SessionService(
      store,
      new TokenService('test-only-secret-with-at-least-32-bytes'),
      () => new Date('2026-09-01T00:00:00.000Z'),
    );

    await expect(service.list('01800000-0000-7000-8000-000000000001')).resolves.toEqual([
      expect.not.objectContaining({
        tokenHash: expect.anything(),
        csrfTokenHash: expect.anything(),
      }),
    ]);
  });
});

function createStore(overrides: Partial<SessionStore> = {}): SessionStore {
  return {
    create: vi.fn(async () => undefined),
    findActiveByTokenHash: vi.fn(async () => null),
    touch: vi.fn(async () => undefined),
    revoke: vi.fn(async () => true),
    revokeAll: vi.fn(async () => 0),
    listActive: vi.fn(async () => []),
    ...overrides,
  };
}
