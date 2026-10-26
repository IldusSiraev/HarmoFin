import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { createUuidV7 } from '../src/common/identifiers/uuid-v7.js';
import { loadApiConfig } from '../src/config/env.js';
import { CURRENT_LEGAL_DOCUMENTS } from '../src/legal/legal-documents.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const run = randomUUID().slice(0, 8);
const currentConsents = CURRENT_LEGAL_DOCUMENTS.map(({ document, version }) => ({
  document,
  version,
}));

/** Unique per run so a failed cleanup never collides with the next run; the first letter is kept for masking. */
const mail = (local: string) => `${local}-${run}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: RegisteredActor;
let ownerWorkspaceId: string;
let bob: RegisteredActor;

interface Actor {
  user: { id: string; email: string };
  cookie: string;
  csrfToken: string;
}

interface RegisteredActor extends Actor {
  workspaceId: string;
  budgetId: string;
}

describe('family invitation acceptance API', () => {
  beforeAll(async () => {
    app = await createApiApp(
      loadApiConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: origin,
        AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        MAIL_FROM: 'no-reply@harmofin.test',
        WEB_BASE_URL: origin,
        LOG_LEVEL: 'silent',
        RATE_LIMIT_LOGIN_MAX: '100',
        RATE_LIMIT_RECOVERY_MAX: '100',
      }),
    );
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();

    owner = await register(mail('owner'));
    ownerWorkspaceId = owner.workspaceId;
    await setDisplayName(owner, 'Ильдар');
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${run}@harmofin.test` } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const workspaces = await prisma.workspace.findMany({
      where: {
        OR: [{ ownerId: { in: userIds } }, { memberships: { some: { userId: { in: userIds } } } }],
      },
      select: { id: true },
    });
    const workspaceIds = workspaces.map((workspace) => workspace.id);
    await prisma.notification.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspaceInvitation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.auditEvent.deleteMany({
      where: { OR: [{ workspaceId: { in: workspaceIds } }, { actorUserId: { in: userIds } }] },
    });
    await prisma.userConsent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    for (const workspaceId of workspaceIds) {
      await prisma.budget.updateMany({
        where: { workspaceId },
        data: { incomeAllocationSourceCategoryId: null, incomeAllocationTargetEnvelopeId: null },
      });
      await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
      await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
      await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
      await prisma.budget.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('previews without a session and masks the email', async () => {
    const { rawToken } = await createInvitation(owner, mail('alia-preview'), 'EDITOR');
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/invitations/preview',
      headers: { origin },
      payload: { token: rawToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaceName: expect.any(String),
      inviterName: 'Ильдар',
      role: 'EDITOR',
      maskedEmail: 'a***@harmofin.test',
      expiresAt: expect.any(String),
    });
    expect(JSON.stringify(response.json())).not.toContain('alia-preview');
  });

  it('answers 404 for an unknown token without details', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/invitations/preview',
      headers: { origin },
      payload: { token: 'x'.repeat(43) },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
  });

  it('rejects preview from a foreign origin', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/invitations/preview',
      headers: { origin: 'https://evil.example' },
      payload: { token: 'x'.repeat(43) },
    });
    expect(response.statusCode).toBe(403);
  });

  it('registers by invitation without a personal workspace', async () => {
    const email = mail('alia-new');
    const { id, rawToken } = await createInvitation(owner, email, 'EDITOR');
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password, invitationToken: rawToken, consents: currentConsents },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ user: { id: string }; workspace: { id: string } }>();
    expect(body.workspace.id).toBe(ownerWorkspaceId);
    const owned = await prisma.workspace.count({ where: { ownerId: body.user.id } });
    expect(owned).toBe(0);
    const audit = await prisma.auditEvent.findMany({
      where: { OR: [{ entityId: id }, { actorUserId: body.user.id }] },
    });
    expect(JSON.stringify(audit)).not.toContain(rawToken);
    expect(JSON.stringify(audit)).not.toContain(email);
  });

  it('rejects registration by invitation with another email', async () => {
    const { rawToken } = await createInvitation(owner, mail('invited'), 'EDITOR');
    const intruder = mail('intruder');
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email: intruder, password, invitationToken: rawToken, consents: currentConsents },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'INVITATION_EMAIL_MISMATCH' });
    expect(await prisma.user.count({ where: { email: intruder } })).toBe(0);
  });

  it('accepts for a signed-in user, requires a name and notifies the creator', async () => {
    bob = await register(mail('bob-accept'));
    const { id, rawToken } = await createInvitation(owner, bob.user.email, 'VIEWER');
    const withoutName = await inject('POST', '/api/v1/invitations/accept', bob, {
      token: rawToken,
    });
    expect(withoutName.statusCode).toBe(422);
    expect(withoutName.json()).toMatchObject({ code: 'DISPLAY_NAME_REQUIRED' });

    const accepted = await inject('POST', '/api/v1/invitations/accept', bob, {
      token: rawToken,
      displayName: 'Боб',
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ workspaceId: ownerWorkspaceId });
    expect(
      await prisma.notification.count({
        where: {
          userId: owner.user.id,
          notificationType: 'MEMBER_JOINED',
          notificationKey: `access:MEMBER_JOINED:${id}`,
        },
      }),
    ).toBe(1);

    const again = await inject('POST', '/api/v1/invitations/accept', bob, { token: rawToken });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'INVITATION_ALREADY_ACCEPTED' });
  });

  it('requires a session and CSRF to accept', async () => {
    const anonymous = await server.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      headers: { origin },
      payload: { token: 'x'.repeat(43) },
    });
    expect(anonymous.statusCode).toBe(401);
    const noCsrf = await server.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      headers: { origin },
      cookies: { harmofin_session: bob.cookie },
      payload: { token: 'x'.repeat(43) },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('creates exactly one membership under concurrent accepts', async () => {
    const carol = await register(mail('carol'));
    await setDisplayName(carol, 'Кэрол');
    const { rawToken } = await createInvitation(owner, carol.user.email, 'EDITOR');
    const results = await Promise.all([
      inject('POST', '/api/v1/invitations/accept', carol, { token: rawToken }),
      inject('POST', '/api/v1/invitations/accept', carol, { token: rawToken }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect(
      await prisma.workspaceMembership.count({
        where: { workspaceId: ownerWorkspaceId, userId: carol.user.id, isActive: true },
      }),
    ).toBe(1);
  });

  it('rejects expired and revoked invitations', async () => {
    const late = await register(mail('late'));
    await setDisplayName(late, 'Поздний');
    const expired = await createInvitation(owner, late.user.email, 'EDITOR');
    await prisma.workspaceInvitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const lateAccept = await inject('POST', '/api/v1/invitations/accept', late, {
      token: expired.rawToken,
    });
    expect(lateAccept.statusCode).toBe(410);
    expect(lateAccept.json()).toMatchObject({ code: 'INVITATION_EXPIRED' });

    const revoked = await createInvitation(owner, mail('late-revoked'), 'EDITOR');
    await inject(
      'DELETE',
      `/api/v1/workspaces/${ownerWorkspaceId}/invitations/${revoked.id}`,
      owner,
    );
    const preview = await server.inject({
      method: 'POST',
      url: '/api/v1/invitations/preview',
      headers: { origin },
      payload: { token: revoked.rawToken },
    });
    expect(preview.statusCode).toBe(410);
    expect(preview.json()).toMatchObject({ code: 'INVITATION_REVOKED' });
  });

  it('reactivates a removed member with the new role', async () => {
    const dave = await register(mail('dave'));
    await setDisplayName(dave, 'Дэйв');
    const first = await createInvitation(owner, dave.user.email, 'EDITOR');
    await inject('POST', '/api/v1/invitations/accept', dave, { token: first.rawToken });
    const membershipId = (
      await prisma.workspaceMembership.findFirstOrThrow({
        where: { workspaceId: ownerWorkspaceId, userId: dave.user.id },
      })
    ).id;
    await inject('DELETE', `/api/v1/workspaces/${ownerWorkspaceId}/members/${membershipId}`, owner);
    const second = await createInvitation(owner, dave.user.email, 'VIEWER');
    const accepted = await inject('POST', '/api/v1/invitations/accept', dave, {
      token: second.rawToken,
    });
    expect(accepted.statusCode).toBe(200);
    const membership = await prisma.workspaceMembership.findFirstOrThrow({
      where: { workspaceId: ownerWorkspaceId, userId: dave.user.id },
    });
    expect(membership).toMatchObject({ isActive: true, role: 'VIEWER', removedAt: null });
  });

  it('returns memberships with isCreator and the selected workspace in me', async () => {
    await inject('POST', `/api/v1/workspaces/${ownerWorkspaceId}/select`, bob);
    const me = await inject('GET', '/api/v1/me', bob);
    expect(me.statusCode).toBe(200);
    const body = me.json<{
      activeWorkspaceId: string;
      workspaces: Array<{ id: string; isCreator: boolean }>;
    }>();
    expect(body.activeWorkspaceId).toBe(ownerWorkspaceId);
    expect(body.workspaces.find((item) => item.id === ownerWorkspaceId)?.isCreator).toBe(false);
    expect(body.workspaces.find((item) => item.id === bob.workspaceId)?.isCreator).toBe(true);
  });

  it('logs in to the last selected workspace', async () => {
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email: bob.user.email, password },
    });
    expect(login.json<{ workspace: { id: string } }>().workspace.id).toBe(ownerWorkspaceId);
  });

  it('never exceeds the member limit under concurrent accepts of different invitations', async () => {
    const creator = await register(mail('limit-owner'));
    await setDisplayName(creator, 'Лимит');
    for (let index = 0; index < 8; index += 1) {
      const id = createUuidV7();
      await prisma.user.create({
        data: { id, email: mail(`limit-seed-${index}`), passwordHash: 'not-a-real-hash' },
      });
      await prisma.workspaceMembership.create({
        data: { id: createUuidV7(), workspaceId: creator.workspaceId, userId: id, role: 'EDITOR' },
      });
    }
    const first = await register(mail('limit-first'));
    await setDisplayName(first, 'Первый');
    const second = await register(mail('limit-second'));
    await setDisplayName(second, 'Второй');
    const firstInvite = await createInvitation(
      creator,
      first.user.email,
      'EDITOR',
      creator.workspaceId,
    );
    const secondInvite = await createInvitation(
      creator,
      second.user.email,
      'EDITOR',
      creator.workspaceId,
    );

    const results = await Promise.all([
      inject('POST', '/api/v1/invitations/accept', first, { token: firstInvite.rawToken }),
      inject('POST', '/api/v1/invitations/accept', second, { token: secondInvite.rawToken }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.statusCode === 409)?.json()).toMatchObject({
      code: 'MEMBER_LIMIT_REACHED',
    });
    expect(
      await prisma.workspaceMembership.count({
        where: { workspaceId: creator.workspaceId, isActive: true },
      }),
    ).toBe(10);
  });
});

async function register(email: string): Promise<RegisteredActor> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email, password },
  });
  const body = response.json<{
    user: { id: string; email: string };
    workspace: { id: string };
    budget: { id: string };
    csrfToken: string;
  }>();
  const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
  if (!cookie) throw new Error('Missing session cookie');
  return {
    user: body.user,
    cookie,
    csrfToken: body.csrfToken,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
  };
}

async function setDisplayName(actor: Actor, displayName: string): Promise<void> {
  const response = await inject('PATCH', '/api/v1/me', actor, { displayName });
  if (response.statusCode !== 200) throw new Error(`PATCH /me failed: ${response.statusCode}`);
}

async function createInvitation(
  actor: Actor,
  email: string,
  role: 'EDITOR' | 'VIEWER',
  workspaceId: string = ownerWorkspaceId,
): Promise<{ id: string; rawToken: string }> {
  const response = await inject('POST', `/api/v1/workspaces/${workspaceId}/invitations`, actor, {
    email,
    role,
  });
  if (response.statusCode !== 201) throw new Error(`invite failed: ${response.body}`);
  const body = response.json<{ id: string; inviteUrl: string }>();
  const rawToken = new URLSearchParams(new URL(body.inviteUrl).hash.slice(1)).get('token');
  if (!rawToken) throw new Error('Missing token in inviteUrl');
  return { id: body.id, rawToken };
}

async function inject(
  method: 'GET' | 'PATCH' | 'DELETE' | 'POST',
  url: string,
  actor: Actor,
  payload?: Record<string, unknown>,
) {
  const options: InjectOptions = {
    method,
    url,
    headers: method === 'GET' ? { origin } : { origin, 'x-csrf-token': actor.csrfToken },
    cookies: { harmofin_session: actor.cookie },
  };
  if (payload !== undefined) options.payload = payload;
  return server.inject(options);
}
