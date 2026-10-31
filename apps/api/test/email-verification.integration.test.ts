import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TokenService } from '../src/auth/token.service.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const tokens = new TokenService('test-only-secret-with-at-least-32-bytes');
const origin = 'http://localhost:3000';
let actor: FamilyActor;
let revoked: FamilyActor | undefined;

async function plantToken(userId: string, raw: string, expiresInMs = 60_000) {
  await env.prisma.emailVerificationToken.create({
    data: {
      id: randomUUID(),
      userId,
      tokenHash: tokens.digest(raw),
      expiresAt: new Date(Date.now() + expiresInMs),
    },
  });
}

const confirm = (token: string) =>
  env.server.inject({
    method: 'POST',
    url: '/api/v1/auth/email-verification/confirm',
    headers: { origin },
    payload: { token },
  });

beforeAll(async () => {
  await env.start();
  actor = await env.register();
});

afterAll(async () => {
  // Auth-scoped audit rows have no workspace, so the helper's workspace cleanup cannot reach them.
  const actorIds = [actor, revoked].filter((item): item is FamilyActor => Boolean(item));
  for (const person of actorIds) {
    await env.prisma.auditEvent.deleteMany({ where: { actorUserId: person.user.id } });
  }
  await env.stop();
});

describe('email verification', () => {
  it('requires a session and CSRF to request a letter', async () => {
    const anonymous = await env.server.inject({
      method: 'POST',
      url: '/api/v1/me/email-verification',
      headers: { origin },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('stores a hashed token on request', async () => {
    const response = await env.inject('POST', '/api/v1/me/email-verification', actor);
    expect(response.statusCode).toBe(204);
    const rows = await env.prisma.emailVerificationToken.findMany({
      where: { userId: actor.user.id, consumedAt: null },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('voids the previous unused token when a new letter is requested', async () => {
    revoked = await env.register();
    await plantToken(revoked.user.id, 'stale-raw-token');
    const response = await env.inject('POST', '/api/v1/me/email-verification', revoked);
    expect(response.statusCode).toBe(204);

    const stale = await confirm('stale-raw-token');
    expect(stale.statusCode).toBe(422);
    expect(stale.json()).toMatchObject({ code: 'EMAIL_VERIFICATION_TOKEN_INVALID' });
    const active = await env.prisma.emailVerificationToken.count({
      where: { userId: revoked.user.id, consumedAt: null },
    });
    expect(active).toBe(1);
  });

  it('confirms with a valid token once', async () => {
    await plantToken(actor.user.id, 'valid-token');
    expect((await confirm('valid-token')).statusCode).toBe(204);
    const user = await env.prisma.user.findUniqueOrThrow({ where: { id: actor.user.id } });
    expect(user.emailVerifiedAt).not.toBeNull();

    const again = await confirm('valid-token');
    expect(again.statusCode).toBe(422);
    expect(again.json()).toMatchObject({ code: 'EMAIL_VERIFICATION_TOKEN_INVALID' });
  });

  it('rejects an expired token', async () => {
    const other = await env.register();
    await plantToken(other.user.id, 'expired-token', -1_000);
    expect((await confirm('expired-token')).statusCode).toBe(422);
  });

  it('sends nothing and stores nothing once verified', async () => {
    const before = await env.prisma.emailVerificationToken.count({
      where: { userId: actor.user.id },
    });
    expect((await env.inject('POST', '/api/v1/me/email-verification', actor)).statusCode).toBe(204);
    expect(
      await env.prisma.emailVerificationToken.count({ where: { userId: actor.user.id } }),
    ).toBe(before);
  });

  it('writes audit without the address', async () => {
    const audits = await env.prisma.auditEvent.findMany({
      where: {
        entityId: actor.user.id,
        action: { in: ['EMAIL_VERIFICATION_REQUESTED', 'EMAIL_VERIFIED'] },
      },
    });
    expect(audits.map((item) => item.action).sort()).toEqual([
      'EMAIL_VERIFICATION_REQUESTED',
      'EMAIL_VERIFIED',
    ]);
    expect(JSON.stringify(audits)).not.toContain(actor.user.email);
  });
});
