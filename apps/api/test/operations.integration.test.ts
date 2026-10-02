import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { forceBudgetV1 } from './helpers/plan-model.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const ownerEmail = `operations-owner-${randomUUID()}@harmofin.test`;
const foreignEmail = `operations-foreign-${randomUUID()}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;
let ownerBudgetId: string;
let foreignBudgetId: string;
let incomeCategoryId: string;
let expenseCategoryId: string;
let vacationEnvelopeId: string;

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

describe('operations API', () => {
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
    owner = await register(ownerEmail);
    foreign = await register(foreignEmail);
    ownerBudgetId = owner.budgetId;
    foreignBudgetId = foreign.budgetId;
    await initializeTemplate(owner);
    const categories = await prisma.category.findMany({
      where: { budgetId: ownerBudgetId },
      select: { id: true, templateKey: true },
    });
    incomeCategoryId = categories.find((item) => item.templateKey === 'income-salary')!.id;
    expenseCategoryId = categories.find((item) => item.templateKey === 'expense-groceries')!.id;
    vacationEnvelopeId = (
      await prisma.envelope.findFirstOrThrow({
        where: { budgetId: ownerBudgetId, templateKey: 'envelope-vacation' },
      })
    ).id;
    await configureRule();
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('documents operation and allocation idempotency headers in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<
        string,
        Record<string, { parameters?: Array<{ name: string; required?: boolean }> }>
      >;
    }>();
    for (const [path, method] of [
      ['/api/v1/budgets/{budgetId}/transactions', 'post'],
      ['/api/v1/budgets/{budgetId}/transactions/{transactionId}/confirm', 'post'],
      ['/api/v1/budgets/{budgetId}/transactions/{transactionId}/allocations', 'post'],
    ] as const) {
      expect(document.paths[path]?.[method]?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        ]),
      );
    }
  });

  it('replays a confirmed expense only once for idempotency key', async () => {
    const refs = await createReferences('retry');
    const payload = expensePayload(refs, '10.00');
    const first = await createTransaction(payload, 'expense-retry-key');
    const replay = await createTransaction(payload, 'expense-retry-key');

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(
      await prisma.transaction.count({
        where: { budgetId: ownerBudgetId, accountId: refs.accountId },
      }),
    ).toBe(1);
  });

  it('keeps draft and deleted expense out of account and envelope totals', async () => {
    const refs = await createReferences('totals');
    const draft = await createTransaction(
      { ...expensePayload(refs, '10.00'), status: 'DRAFT' },
      'draft-key',
    );
    const confirmed = await createTransaction(expensePayload(refs, '10.00'), 'confirmed-key');
    const confirmedId = confirmed.json<{ id: string }>().id;
    const deleted = await deleteTransaction(confirmedId, 'delete-key');

    expect(draft.statusCode).toBe(201);
    expect(deleted.statusCode).toBe(200);
    expect(
      (await getAccount(refs.accountId)).json<{ currentBalanceMinor: string }>()
        .currentBalanceMinor,
    ).toBe('100000');
    expect(
      (await getEnvelope(refs.envelopeId)).json<{ currentBalanceMinor: string }>()
        .currentBalanceMinor,
    ).toBe('50000');
  });

  it('returns a proposal, rejects allocation overflow and excludes sensitive audit fields', async () => {
    const refs = await createReferences('allocation');
    const income = await createTransaction(
      {
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amount: '100.00',
        occurredOn: '2026-09-04',
        accountId: refs.accountId,
        categoryId: incomeCategoryId,
        sourceDescription: 'Только в операции',
        isPlanned: false,
      },
      'income-key',
    );
    const incomeBody = income.json<{
      id: string;
      allocationProposal: { targetEnvelopeId: string; amountMinor: string } | null;
    }>();

    expect(income.statusCode).toBe(201);
    expect(incomeBody.allocationProposal).toMatchObject({
      targetEnvelopeId: vacationEnvelopeId,
      amountMinor: '10000',
    });
    const allocation = await createAllocation(
      incomeBody.id,
      {
        amount: '90.00',
        occurredOn: '2026-09-04',
        accountId: refs.accountId,
        envelopeId: vacationEnvelopeId,
        comment: 'Секретный комментарий',
      },
      'allocation-key',
    );
    const overflow = await createAllocation(
      incomeBody.id,
      {
        amount: '20.00',
        occurredOn: '2026-09-04',
        accountId: refs.accountId,
        envelopeId: vacationEnvelopeId,
      },
      'allocation-overflow-key',
    );

    expect(allocation.statusCode).toBe(201);
    expect(overflow.statusCode).toBe(409);
    expect(overflow.json()).toMatchObject({ code: 'ALLOCATION_EXCEEDS_INCOME' });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: 'income_allocation', entityId: allocation.json<{ id: string }>().id },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit.newValues)).not.toContain('comment');
    const incomeAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: 'transaction', entityId: incomeBody.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(incomeAudit.newValues)).not.toContain('sourceDescription');
  });

  it('rejects unknown fields, archived targets, insufficient balance, non-owner and foreign budget access', async () => {
    const refs = await createReferences('validation');
    const unknown = await createTransaction(
      { ...expensePayload(refs, '1.00'), unexpected: true },
      'unknown-key',
    );
    await prisma.account.update({
      where: { id: refs.accountId },
      data: { archivedAt: new Date() },
    });
    const archived = await createTransaction(expensePayload(refs, '1.00'), 'archived-key');
    const noNegativeRefs = await createReferences('negative');
    const insufficient = await createTransaction(
      expensePayload(noNegativeRefs, '1000.01'),
      'insufficient-key',
    );
    const foreignResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/transactions`,
      cookies: { harmofin_session: foreign.cookie },
    });

    expect(unknown.statusCode).toBe(400);
    expect(archived.statusCode).toBe(400);
    expect(insufficient.statusCode).toBe(422);
    expect(foreignResponse.statusCode).toBe(404);
    expect(foreignBudgetId).not.toBe(ownerBudgetId);
  });

  it('ranks categories by confirmed-transaction usage when sort=popular', async () => {
    const refs = await createReferences('popular');
    const rareCategoryId = (
      await prisma.category.findFirstOrThrow({
        where: { budgetId: ownerBudgetId, templateKey: 'expense-fuel' },
      })
    ).id;
    const unusedCategoryId = (
      await prisma.category.findFirstOrThrow({
        where: { budgetId: ownerBudgetId, templateKey: 'expense-travel' },
      })
    ).id;

    await createTransaction(expensePayload(refs, '10.00'), 'popular-1');
    await createTransaction(expensePayload(refs, '20.00'), 'popular-2');
    await createTransaction(
      { ...expensePayload(refs, '5.00'), categoryId: rareCategoryId },
      'popular-3',
    );
    // A draft must not count toward popularity.
    await createTransaction(
      { ...expensePayload(refs, '999.00'), status: 'DRAFT', categoryId: rareCategoryId },
      'popular-draft',
    );

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/categories?type=EXPENSE&sort=popular&limit=30`,
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
    const ids = response.json<Array<{ id: string }>>().map((item) => item.id);
    expect(ids.indexOf(expenseCategoryId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(expenseCategoryId)).toBeLessThan(ids.indexOf(rareCategoryId));
    expect(ids).not.toContain(unusedCategoryId);
  });

  async function createReferences(suffix: string) {
    const account = await createAccount(`Счёт ${suffix}`, '1000.00');
    const envelope = await createEnvelope(`Конверт ${suffix}`, '500.00');
    return {
      accountId: account.json<{ id: string }>().id,
      envelopeId: envelope.json<{ id: string }>().id,
    };
  }

  function expensePayload(refs: { accountId: string; envelopeId: string }, amount: string) {
    return {
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amount,
      occurredOn: '2026-09-04',
      accountId: refs.accountId,
      categoryId: expenseCategoryId,
      envelopeId: refs.envelopeId,
      merchantName: 'Магазин',
    };
  }

  async function createTransaction(payload: Record<string, unknown>, key: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${ownerBudgetId}/transactions`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
      payload,
    });
  }

  async function deleteTransaction(transactionId: string, key: string) {
    return server.inject({
      method: 'DELETE',
      url: `/api/v1/budgets/${ownerBudgetId}/transactions/${transactionId}`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  async function createAllocation(
    transactionId: string,
    payload: Record<string, unknown>,
    key: string,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${ownerBudgetId}/transactions/${transactionId}/allocations`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
      payload,
    });
  }

  async function createAccount(name: string, startingBalance: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name,
        accountType: 'CASH',
        currency: 'RUB',
        startingBalance,
        accountingStartDate: '2026-09-01',
      },
    });
  }

  async function createEnvelope(name: string, startingBalance: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${ownerBudgetId}/envelopes`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: { name, envelopeType: 'CUSTOM', currency: 'RUB', startingBalance, displayOrder: 0 },
    });
  }

  async function getAccount(accountId: string) {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts/${accountId}`,
      cookies: { harmofin_session: owner.cookie },
    });
  }
  async function getEnvelope(envelopeId: string) {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/envelopes/${envelopeId}`,
      cookies: { harmofin_session: owner.cookie },
    });
  }

  async function initializeTemplate(session: Session) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${session.budgetId}/reference-template`,
      headers: { origin, 'x-csrf-token': session.csrfToken },
      cookies: { harmofin_session: session.cookie },
    });
  }

  async function configureRule() {
    return server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}`,
      headers: { origin, 'x-csrf-token': owner.csrfToken },
      cookies: { harmofin_session: owner.cookie },
      payload: {
        incomeAllocationRuleEnabled: true,
        incomeAllocationSourceCategoryId: incomeCategoryId,
        incomeAllocationTargetEnvelopeId: vacationEnvelopeId,
      },
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
    await prisma.auditEvent.deleteMany({ where: { workspaceId: session.workspaceId } });
    const budgetIds = (
      await prisma.budget.findMany({
        where: { workspaceId: session.workspaceId },
        select: { id: true },
      })
    ).map((item) => item.id);
    await prisma.notification.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.planOccurrence.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.regularPlan.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.incomeAllocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transaction.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.budget.updateMany({
      where: { id: { in: budgetIds } },
      data: {
        incomeAllocationRuleEnabled: false,
        incomeAllocationSourceCategoryId: null,
        incomeAllocationTargetEnvelopeId: null,
      },
    });
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
