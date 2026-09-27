import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

type References = { sourceEnvelopeId: string; destinationEnvelopeId: string };

describe('envelope reallocations API', () => {
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
    owner = await register(`envelope-realloc-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`envelope-realloc-foreign-${randomUUID()}@harmofin.test`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('documents envelope reallocation routes and idempotency headers in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<
        string,
        Record<string, { parameters?: Array<{ name: string; required?: boolean }> }>
      >;
    }>();
    const collection = '/api/v1/budgets/{budgetId}/envelope-reallocations';
    const item = '/api/v1/budgets/{budgetId}/envelope-reallocations/{id}';

    expect(document.paths[collection]?.get).toBeDefined();
    expect(document.paths[collection]?.post).toBeDefined();
    expect(document.paths[item]?.get).toBeDefined();
    for (const [path, method] of [
      [collection, 'post'],
      [item, 'delete'],
    ] as const) {
      expect(document.paths[path]?.[method]?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        ]),
      );
    }
  });

  it('moves money between envelopes without touching any account', async () => {
    const refs = await createReferences('move');
    const created = await createReallocation(
      refs,
      { amount: '150.00', occurredOn: '2026-09-26' },
      'realloc-move',
    );

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'CONFIRMED',
      sourceEnvelopeId: refs.sourceEnvelopeId,
      destinationEnvelopeId: refs.destinationEnvelopeId,
      amountMinor: '15000',
    });
    await expectEnvelopeBalance(refs.sourceEnvelopeId, '35000');
    await expectEnvelopeBalance(refs.destinationEnvelopeId, '15000');
    expect(
      (await listReallocations()).json<{ items: Array<{ id: string }> }>().items,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.json<{ id: string }>().id })]));
  });

  it('rejects identical envelopes, archived or foreign references, and insufficient capacity', async () => {
    const refs = await createReferences('validation');
    const before = await prisma.envelopeReallocation.count({ where: { budgetId: owner.budgetId } });
    const sameEnvelope = await createReallocation(
      refs,
      { destinationEnvelopeId: refs.sourceEnvelopeId },
      'realloc-same-envelope',
    );
    const insufficient = await createReallocation(
      refs,
      { amount: '1000.01' },
      'realloc-insufficient',
    );
    await prisma.envelope.update({
      where: { id: refs.sourceEnvelopeId },
      data: { archivedAt: new Date() },
    });
    const archived = await createReallocation(refs, { amount: '1.00' }, 'realloc-archived');
    const foreignRefs = await createReferences('foreign', foreign);
    const foreignResponse = await createReallocation(
      { ...refs, sourceEnvelopeId: foreignRefs.sourceEnvelopeId },
      { amount: '1.00' },
      'realloc-foreign-reference',
    );

    expect(sameEnvelope.statusCode).toBe(400);
    expect(sameEnvelope.json()).toMatchObject({ code: 'ENVELOPE_REALLOCATION_ENVELOPES_MUST_DIFFER' });
    expect(insufficient.statusCode).toBe(422);
    expect(insufficient.json()).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(archived.statusCode).toBe(400);
    expect(foreignResponse.statusCode).toBe(400);
    await expect(
      prisma.envelopeReallocation.count({ where: { budgetId: owner.budgetId } }),
    ).resolves.toBe(before);
  });

  it('logically deletes a reallocation and preserves the audit trail', async () => {
    const refs = await createReferences('lifecycle');
    const created = await createReallocation(refs, { amount: '10.00' }, 'realloc-lifecycle');
    const id = created.json<{ id: string }>().id;
    const deleted = await deleteReallocation(id, 'realloc-delete');

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ status: 'DELETED' });
    await expectEnvelopeBalance(refs.sourceEnvelopeId, '50000');
    await expectEnvelopeBalance(refs.destinationEnvelopeId, '0');
    await expect(
      prisma.auditEvent.count({
        where: {
          budgetId: owner.budgetId,
          entityType: 'envelope_reallocation',
          entityId: id,
          action: 'DELETED',
        },
      }),
    ).resolves.toBe(1);
  });

  it('replays same idempotency request once and rejects changed payload', async () => {
    const refs = await createReferences('retry');
    const payload = { amount: '10.00', occurredOn: '2026-09-26' };
    const before = await prisma.envelopeReallocation.count({ where: { budgetId: owner.budgetId } });
    const first = await createReallocation(refs, payload, 'realloc-retry');
    const replay = await createReallocation(refs, payload, 'realloc-retry');
    const conflict = await createReallocation(refs, { amount: '11.00' }, 'realloc-retry');

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      prisma.envelopeReallocation.count({ where: { budgetId: owner.budgetId } }),
    ).resolves.toBe(before + 1);
  });

  it('permits editor, rejects viewer and hides another budget', async () => {
    const refs = await createReferences('role');
    await setRole('EDITOR');
    const editor = await createReallocation(refs, { amount: '1.00' }, 'realloc-editor');
    await setRole('VIEWER');
    const viewer = await createReallocation(refs, { amount: '1.00' }, 'realloc-viewer');
    await setRole('OWNER');
    const foreignList = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations`,
      cookies: { harmofin_session: foreign.cookie },
    });
    const unauthenticated = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations`,
    });

    expect(editor.statusCode).toBe(201);
    expect(viewer.statusCode).toBe(403);
    expect(foreignList.statusCode).toBe(404);
    expect(unauthenticated.statusCode).toBe(401);
  });

  async function createReferences(suffix: string, session = owner): Promise<References> {
    const sourceEnvelope = await createEnvelope(session, `Источник переноса ${suffix}`, '500.00', 0);
    const destinationEnvelope = await createEnvelope(
      session,
      `Назначение переноса ${suffix}`,
      '0.00',
      1,
    );
    return {
      sourceEnvelopeId: sourceEnvelope.json<{ id: string }>().id,
      destinationEnvelopeId: destinationEnvelope.json<{ id: string }>().id,
    };
  }

  function createReallocation(
    refs: References,
    overrides: Record<string, unknown>,
    key: string,
    session = owner,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${session.budgetId}/envelope-reallocations`,
      headers: { origin, 'x-csrf-token': session.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: session.cookie },
      payload: {
        sourceEnvelopeId: refs.sourceEnvelopeId,
        destinationEnvelopeId: refs.destinationEnvelopeId,
        amount: '10.00',
        occurredOn: '2026-09-26',
        ...overrides,
      },
    });
  }

  function listReallocations() {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations`,
      cookies: { harmofin_session: owner.cookie },
    });
  }

  function deleteReallocation(id: string, key: string) {
    return server.inject({
      method: 'DELETE',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations/${id}`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  async function createEnvelope(
    session: Session,
    name: string,
    startingBalance: string,
    displayOrder: number,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${session.budgetId}/envelopes`,
      headers: { origin, 'x-csrf-token': session.csrfToken },
      cookies: { harmofin_session: session.cookie },
      payload: { name, envelopeType: 'CUSTOM', currency: 'RUB', startingBalance, displayOrder },
    });
  }

  async function expectEnvelopeBalance(envelopeId: string, expected: string) {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes/${envelopeId}`,
      cookies: { harmofin_session: owner.cookie },
    });
    expect(response.json<{ currentBalanceMinor: string }>().currentBalanceMinor).toBe(expected);
  }

  async function setRole(role: 'OWNER' | 'EDITOR' | 'VIEWER') {
    await prisma.workspaceMembership.updateMany({
      where: { workspaceId: owner.workspaceId, userId: owner.userId },
      data: { role },
    });
  }

  async function register(email: string): Promise<Session> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    const body = response.json<{
      user: { id: string };
      workspace: { id: string };
      budget: { id: string };
      csrfToken: string;
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error('Missing session cookie');
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
      csrfToken: body.csrfToken,
      cookie,
    };
  }

  async function cleanup(session: Session) {
    if (!session) return;
    const budgetIds = (
      await prisma.budget.findMany({
        where: { workspaceId: session.workspaceId },
        select: { id: true },
      })
    ).map((budget) => budget.id);
    await prisma.auditEvent.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.envelopeReallocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transferPart.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transfer.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.incomeAllocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transaction.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.account.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.category.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.envelope.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.budget.deleteMany({ where: { id: { in: budgetIds } } });
    await prisma.workspace.deleteMany({ where: { id: session.workspaceId } });
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    await prisma.user.deleteMany({ where: { id: session.userId } });
  }
});
