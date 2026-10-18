import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { purgeUserData } from '../../worker/src/account-purge.js';
import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const current = [
  { document: 'TERMS', version: '2026-10-18' },
  { document: 'PRIVACY_POLICY', version: '2026-10-18' },
  { document: 'PD_CONSENT', version: '2026-10-18' },
];

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUserIds: string[] = [];

type Session = { userId: string; cookie: string; csrfToken: string };

async function register(consents?: unknown): Promise<{ status: number; session?: Session }> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: {
      email: `legal-${randomUUID()}@harmofin.test`,
      password,
      ...(consents ? { consents } : {}),
    },
  });
  if (response.statusCode !== 201) return { status: response.statusCode };
  const body = response.json<{ user: { id: string }; csrfToken: string }>();
  const raw = response.headers['set-cookie'];
  const setCookie = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  const cookie = decodeURIComponent(/harmofin_session=([^;]+)/.exec(setCookie)?.[1] ?? '');
  createdUserIds.push(body.user.id);
  return { status: 201, session: { userId: body.user.id, cookie, csrfToken: body.csrfToken } };
}

function me(session: Session) {
  return server.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { cookie: `harmofin_session=${encodeURIComponent(session.cookie)}` },
  });
}

function accept(session: Session, consents: unknown, withCsrf = true) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/me/consents',
    headers: {
      origin,
      cookie: `harmofin_session=${encodeURIComponent(session.cookie)}`,
      ...(withCsrf ? { 'x-csrf-token': session.csrfToken } : {}),
    },
    payload: { consents },
  });
}

describe('legal consents', () => {
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
      }),
    );
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await prisma.$transaction((tx) => purgeUserData(tx, userId), { timeout: 60_000 });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('documents the legal endpoints and new fields in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    }>();
    expect(document.paths['/api/v1/legal/documents']).toMatchObject({ get: expect.any(Object) });
    expect(document.paths['/api/v1/me/consents']).toMatchObject({ post: expect.any(Object) });
    expect(document.components.schemas.RegisterRequest?.properties).toHaveProperty('consents');
    expect(document.components.schemas.MeResponse?.properties).toHaveProperty('pendingConsents');
  });

  it('serves the current document versions without a session', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/legal/documents' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(current.map((doc) => ({ ...doc, effectiveOn: '2026-10-18' })));
  });

  it('records consents given at registration in the same transaction', async () => {
    const { status, session } = await register(current);
    expect(status).toBe(201);
    expect(await prisma.userConsent.count({ where: { userId: session!.userId } })).toBe(3);
    expect((await me(session!)).json()).toMatchObject({ pendingConsents: [] });
  });

  it('rejects an outdated consent set at registration and creates no user', async () => {
    const before = await prisma.user.count();
    const { status } = await register([{ document: 'TERMS', version: '2020-01-01' }]);
    expect(status).toBe(422);
    expect(await prisma.user.count()).toBe(before);
  });

  it('lets a user without consents accept them later, idempotently', async () => {
    const { session } = await register();
    expect((await me(session!)).json<{ pendingConsents: unknown[] }>().pendingConsents).toEqual(
      current,
    );

    expect((await accept(session!, current, false)).statusCode).toBe(403);
    expect((await accept(session!, [current[0]])).statusCode).toBe(422);
    expect((await accept(session!, current)).statusCode).toBe(204);
    expect((await accept(session!, current)).statusCode).toBe(204);

    expect(await prisma.userConsent.count({ where: { userId: session!.userId } })).toBe(3);
    expect((await me(session!)).json()).toMatchObject({ pendingConsents: [] });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { actorUserId: session!.userId, action: 'LEGAL_CONSENT_ACCEPTED' },
    });
    expect(JSON.stringify(audit.newValues)).not.toContain('@');
  });

  it('keeps one user consents invisible to another', async () => {
    const { session: first } = await register(current);
    const { session: second } = await register();
    expect((await me(second!)).json<{ pendingConsents: unknown[] }>().pendingConsents).toHaveLength(3);
    expect((await me(first!)).json()).toMatchObject({ pendingConsents: [] });
  });
});
