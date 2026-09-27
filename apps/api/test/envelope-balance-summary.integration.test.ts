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
const suffix = Date.now().toString(36);
let envelopeA = '';

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

describe('envelope balance summary API', () => {
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
    owner = await register(`balance-summary-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`balance-summary-foreign-${randomUUID()}@harmofin.test`);
    await seedBreakdownData();
  });

  afterAll(async () => {
    if (owner) await cleanup(owner);
    if (foreign) await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('documents the balance summary route in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, unknown>>;
    }>();

    expect(
      document.paths['/api/v1/budgets/{budgetId}/envelopes/{envelopeId}/balance-summary']?.get,
    ).toBeDefined();
  });

  it('splits the current balance into five terms that add up exactly', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes/${envelopeA}/balance-summary`,
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      startingBalanceMinor: string;
      incomeAllocatedMinor: string;
      expensesMinor: string;
      envelopeTransfersNetMinor: string;
      reallocationsNetMinor: string;
      currentBalanceMinor: string;
      reallocations: Array<{ direction: string; otherEnvelopeName: string | null }>;
    }>();

    expect(body).toMatchObject({
      startingBalanceMinor: '10000',
      incomeAllocatedMinor: '50000',
      expensesMinor: '15000',
      envelopeTransfersNetMinor: '70000',
      reallocationsNetMinor: '20000',
      currentBalanceMinor: '135000',
    });
    const total =
      BigInt(body.startingBalanceMinor) +
      BigInt(body.incomeAllocatedMinor) -
      BigInt(body.expensesMinor) +
      BigInt(body.envelopeTransfersNetMinor) +
      BigInt(body.reallocationsNetMinor);
    expect(total.toString()).toBe(body.currentBalanceMinor);
    expect(body.reallocations).toEqual([
      expect.objectContaining({ direction: 'IN', otherEnvelopeName: `Назначение ${suffix}` }),
    ]);
  });

  it('hides the summary of a foreign budget and a missing envelope', async () => {
    const foreignResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes/${envelopeA}/balance-summary`,
      cookies: { harmofin_session: foreign.cookie },
    });
    const missingResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes/${randomUUID()}/balance-summary`,
      cookies: { harmofin_session: owner.cookie },
    });

    expect(foreignResponse.statusCode).toBe(404);
    expect(foreignResponse.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  async function seedBreakdownData() {
    const accountId = randomUUID();
    const secondAccountId = randomUUID();
    const incomeCategoryId = randomUUID();
    const expenseCategoryId = randomUUID();
    const envelopeB = randomUUID();
    const incomeId = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const occurredOn = new Date(`${today}T00:00:00.000Z`);

    await prisma.budget.update({
      where: { id: owner.budgetId },
      data: { allowNegativeBalance: true },
    });

    await prisma.account.create({
      data: {
        id: accountId,
        budgetId: owner.budgetId,
        name: 'Счёт breakdown',
        accountType: 'CASH',
        startingBalanceMinor: 1_000_000n,
        accountingStartDate: occurredOn,
      },
    });
    await prisma.account.create({
      data: {
        id: secondAccountId,
        budgetId: owner.budgetId,
        name: 'Счёт breakdown 2',
        accountType: 'CASH',
        startingBalanceMinor: 0n,
        accountingStartDate: occurredOn,
      },
    });
    await prisma.category.createMany({
      data: [
        {
          id: incomeCategoryId,
          budgetId: owner.budgetId,
          name: 'Доход breakdown',
          categoryType: 'INCOME',
          displayOrder: 0,
        },
        {
          id: expenseCategoryId,
          budgetId: owner.budgetId,
          name: 'Расход breakdown',
          categoryType: 'EXPENSE',
          displayOrder: 1,
        },
      ],
    });

    envelopeA = randomUUID();
    await prisma.envelope.create({
      data: {
        id: envelopeA,
        budgetId: owner.budgetId,
        name: `Источник ${suffix}`,
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 10_000n,
        displayOrder: 0,
      },
    });
    await prisma.envelope.create({
      data: {
        id: envelopeB,
        budgetId: owner.budgetId,
        name: `Назначение ${suffix}`,
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 0n,
        displayOrder: 1,
      },
    });

    await prisma.transaction.create({
      data: {
        id: incomeId,
        budgetId: owner.budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amountMinor: 50_000n,
        occurredOn,
        accountId,
        categoryId: incomeCategoryId,
        confirmedAt: new Date(),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.incomeAllocation.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        incomeTransactionId: incomeId,
        status: 'CONFIRMED',
        amountMinor: 50_000n,
        occurredOn,
        accountId,
        envelopeId: envelopeA,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: owner.budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: 15_000n,
        occurredOn,
        accountId,
        categoryId: expenseCategoryId,
        envelopeId: envelopeA,
        confirmedAt: new Date(),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });

    const transferFromB = randomUUID();
    await prisma.transfer.create({
      data: {
        id: transferFromB,
        budgetId: owner.budgetId,
        status: 'CONFIRMED',
        totalMinor: 70_000n,
        occurredOn,
        confirmedAt: new Date(),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    await prisma.transferPart.create({
      data: {
        id: randomUUID(),
        transferId: transferFromB,
        budgetId: owner.budgetId,
        amountMinor: 70_000n,
        sourceAccountId: accountId,
        destinationAccountId: secondAccountId,
        sourceEnvelopeId: envelopeB,
        destinationEnvelopeId: envelopeA,
      },
    });

    const reallocated = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations`,
      headers: {
        origin,
        'x-csrf-token': owner.csrfToken,
        'idempotency-key': 'balance-summary-realloc',
      },
      cookies: { harmofin_session: owner.cookie },
      payload: {
        sourceEnvelopeId: envelopeB,
        destinationEnvelopeId: envelopeA,
        amount: '200.00',
        occurredOn: today,
      },
    });
    expect(reallocated.statusCode).toBe(201);
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
