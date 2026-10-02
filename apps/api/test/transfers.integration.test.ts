import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { forceBudgetV1 } from './helpers/plan-model.js';

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

type References = {
  sourceAccountId: string;
  destinationAccountId: string;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
};

describe('transfers API', () => {
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
    owner = await register(`transfer-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`transfer-foreign-${randomUUID()}@harmofin.test`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('documents transfer routes and mutation idempotency headers in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<
        string,
        Record<string, { parameters?: Array<{ name: string; required?: boolean }> }>
      >;
    }>();
    const collection = '/api/v1/budgets/{budgetId}/transfers';
    const item = '/api/v1/budgets/{budgetId}/transfers/{transferId}';

    expect(document.paths[collection]?.get).toBeDefined();
    expect(document.paths[collection]?.post).toBeDefined();
    expect(document.paths[item]?.get).toBeDefined();
    for (const [path, method] of [
      [collection, 'post'],
      [`${item}/confirm`, 'post'],
      [`${item}/cancel`, 'post'],
      [item, 'delete'],
    ] as const) {
      expect(document.paths[path]?.[method]?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        ]),
      );
    }
  });

  it('moves confirmed account money while preserving same-envelope money', async () => {
    const refs = await createReferences('one-part');
    const created = await createTransfer(
      transferPayload(refs, {
        total: '50.00',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '50.00' }],
      }),
      'transfer-one-part',
    );

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'CONFIRMED',
      totalMinor: '5000',
      parts: [
        expect.objectContaining({
          sourceEnvelopeId: refs.sourceEnvelopeId,
          destinationEnvelopeId: refs.sourceEnvelopeId,
          amountMinor: '5000',
        }),
      ],
    });
    await expectAccountBalance(refs.sourceAccountId, '95000');
    await expectAccountBalance(refs.destinationAccountId, '15000');
    await expectEnvelopeBalance(refs.sourceEnvelopeId, '50000');
    expect((await listTransfers()).json<{ items: Array<{ id: string }> }>().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.json<{ id: string }>().id })]),
    );
  });

  it('moves envelope purpose only for a changed destination envelope', async () => {
    const refs = await createReferences('multipart');
    const created = await createTransfer(
      transferPayload(refs, {
        total: '30.00',
        parts: [
          { sourceEnvelopeId: refs.sourceEnvelopeId, amount: '20.00' },
          {
            sourceEnvelopeId: refs.sourceEnvelopeId,
            destinationEnvelopeId: refs.destinationEnvelopeId,
            amount: '10.00',
          },
        ],
      }),
      'transfer-multipart',
    );

    expect(created.statusCode).toBe(201);
    expect(created.json<{ parts: unknown[] }>().parts).toHaveLength(2);
    await expectAccountBalance(refs.sourceAccountId, '97000');
    await expectAccountBalance(refs.destinationAccountId, '13000');
    await expectEnvelopeBalance(refs.sourceEnvelopeId, '49000');
    await expectEnvelopeBalance(refs.destinationEnvelopeId, '1000');
  });

  it('rejects invalid parts, equal accounts, archived or foreign references, and insufficient capacity', async () => {
    const refs = await createReferences('validation');
    const before = await prisma.transfer.count({ where: { budgetId: owner.budgetId } });
    const mismatch = await createTransfer(
      transferPayload(refs, {
        total: '20.01',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '20.00' }],
      }),
      'transfer-mismatch',
    );
    const sameAccount = await createTransfer(
      transferPayload(refs, { destinationAccountId: refs.sourceAccountId }),
      'transfer-same-account',
    );
    const insufficient = await createTransfer(
      transferPayload(refs, {
        total: '1000.01',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '1000.01' }],
      }),
      'transfer-insufficient',
    );
    await prisma.account.update({
      where: { id: refs.sourceAccountId },
      data: { archivedAt: new Date() },
    });
    const archived = await createTransfer(
      transferPayload(refs, {
        total: '1.00',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '1.00' }],
      }),
      'transfer-archived',
    );
    const foreignRefs = await createReferences('foreign', foreign);
    const foreignResponse = await createTransfer(
      transferPayload(refs, {
        sourceAccountId: foreignRefs.sourceAccountId,
        total: '1.00',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '1.00' }],
      }),
      'transfer-foreign-reference',
    );

    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ code: 'TRANSFER_PARTS_TOTAL_MISMATCH' });
    expect(sameAccount.statusCode).toBe(400);
    expect(sameAccount.json()).toMatchObject({ code: 'TRANSFER_ACCOUNTS_MUST_DIFFER' });
    expect(insufficient.statusCode).toBe(422);
    expect(archived.statusCode).toBe(400);
    expect(foreignResponse.statusCode).toBe(400);
    await expect(prisma.transfer.count({ where: { budgetId: owner.budgetId } })).resolves.toBe(
      before,
    );
  });

  it('confirms draft, cancels draft and logically deletes confirmed transfer', async () => {
    const refs = await createReferences('lifecycle');
    const draft = await createTransfer(
      transferPayload(refs, {
        status: 'DRAFT',
        total: '10.00',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '10.00' }],
      }),
      'transfer-draft',
    );
    const draftId = draft.json<{ id: string }>().id;
    const confirmed = await confirmTransfer(draftId, 'transfer-confirm');
    const cancelledDraft = await createTransfer(
      transferPayload(refs, {
        status: 'DRAFT',
        total: '1.00',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '1.00' }],
      }),
      'transfer-cancel-draft',
    );
    const cancelled = await cancelTransfer(
      cancelledDraft.json<{ id: string }>().id,
      'transfer-cancel',
    );
    const deleted = await deleteTransfer(draftId, 'transfer-delete');

    expect(draft.statusCode).toBe(201);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: 'CONFIRMED' });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ status: 'DELETED' });
    await expectAccountBalance(refs.sourceAccountId, '100000');
    await expectAccountBalance(refs.destinationAccountId, '10000');
    await expectEnvelopeBalance(refs.sourceEnvelopeId, '50000');
    await expect(
      prisma.auditEvent.count({
        where: {
          budgetId: owner.budgetId,
          entityType: 'transfer',
          entityId: draftId,
          action: 'DELETED',
        },
      }),
    ).resolves.toBe(1);
  });

  it('replays same idempotency request once and rejects changed payload', async () => {
    const refs = await createReferences('retry');
    const payload = transferPayload(refs, {
      total: '10.00',
      parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '10.00' }],
    });
    const before = await prisma.transfer.count({ where: { budgetId: owner.budgetId } });
    const first = await createTransfer(payload, 'transfer-retry');
    const replay = await createTransfer(payload, 'transfer-retry');
    const conflict = await createTransfer(
      {
        ...payload,
        total: '11.00',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '11.00' }],
      },
      'transfer-retry',
    );

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(prisma.transfer.count({ where: { budgetId: owner.budgetId } })).resolves.toBe(
      before + 1,
    );
  });

  it('permits editor, rejects viewer and hides another budget', async () => {
    const refs = await createReferences('role');
    await setRole('EDITOR');
    const editor = await createTransfer(
      transferPayload(refs, {
        status: 'DRAFT',
        total: '1.00',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '1.00' }],
      }),
      'transfer-editor',
    );
    await setRole('VIEWER');
    const viewer = await createTransfer(
      transferPayload(refs, {
        status: 'DRAFT',
        total: '1.00',
        parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '1.00' }],
      }),
      'transfer-viewer',
    );
    await setRole('OWNER');
    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/transfers`,
      cookies: { harmofin_session: foreignSession().cookie },
    });
    const unauthenticated = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/transfers`,
    });

    expect(editor.statusCode).toBe(201);
    expect(viewer.statusCode).toBe(403);
    expect(foreign.statusCode).toBe(404);
    expect(unauthenticated.statusCode).toBe(401);
  });

  function foreignSession() {
    return foreign;
  }

  async function createReferences(suffix: string, session = owner): Promise<References> {
    const sourceAccount = await createAccount(session, `Источник ${suffix}`, '1000.00');
    const destinationAccount = await createAccount(session, `Получатель ${suffix}`, '100.00');
    const sourceEnvelope = await createEnvelope(session, `Источник ${suffix}`, '500.00', 0);
    const destinationEnvelope = await createEnvelope(session, `Получатель ${suffix}`, '0.00', 1);
    return {
      sourceAccountId: sourceAccount.json<{ id: string }>().id,
      destinationAccountId: destinationAccount.json<{ id: string }>().id,
      sourceEnvelopeId: sourceEnvelope.json<{ id: string }>().id,
      destinationEnvelopeId: destinationEnvelope.json<{ id: string }>().id,
    };
  }

  function transferPayload(refs: References, overrides: Record<string, unknown> = {}) {
    return {
      status: 'CONFIRMED',
      total: '10.00',
      occurredOn: '2026-09-05',
      sourceAccountId: refs.sourceAccountId,
      destinationAccountId: refs.destinationAccountId,
      parts: [{ sourceEnvelopeId: refs.sourceEnvelopeId, amount: '10.00' }],
      ...overrides,
    };
  }

  function createTransfer(payload: Record<string, unknown>, key: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/transfers`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
      payload,
    });
  }

  function listTransfers() {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/transfers`,
      cookies: { harmofin_session: owner.cookie },
    });
  }

  function confirmTransfer(transferId: string, key: string) {
    return lifecycleRequest('confirm', transferId, key);
  }

  function cancelTransfer(transferId: string, key: string) {
    return lifecycleRequest('cancel', transferId, key);
  }

  function deleteTransfer(transferId: string, key: string) {
    return server.inject({
      method: 'DELETE',
      url: `/api/v1/budgets/${owner.budgetId}/transfers/${transferId}`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  function lifecycleRequest(action: 'confirm' | 'cancel', transferId: string, key: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/transfers/${transferId}/${action}`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  async function createAccount(session: Session, name: string, startingBalance: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${session.budgetId}/accounts`,
      headers: { origin, 'x-csrf-token': session.csrfToken },
      cookies: { harmofin_session: session.cookie },
      payload: {
        name,
        accountType: 'CASH',
        currency: 'RUB',
        startingBalance,
        accountingStartDate: '2026-09-01',
      },
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

  async function expectAccountBalance(accountId: string, expected: string) {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/accounts/${accountId}`,
      cookies: { harmofin_session: owner.cookie },
    });
    expect(response.json<{ currentBalanceMinor: string }>().currentBalanceMinor).toBe(expected);
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
    await forceBudgetV1(prisma, body.budget.id);
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
    await prisma.notification.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.planOccurrence.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.regularPlan.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
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
