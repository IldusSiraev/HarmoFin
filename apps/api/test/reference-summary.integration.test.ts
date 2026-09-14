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

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;

describe('reference summary API', () => {
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
    owner = await register(`reference-summary-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`reference-summary-foreign-${randomUUID()}@harmofin.test`);
  });

  afterAll(async () => {
    if (owner) await cleanup(owner);
    if (foreign) await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('sums only the accounts the status asks for', async () => {
    const first = await createAccount(owner, { name: 'Карта', startingBalance: '1000.00' });
    await createAccount(owner, { name: 'Наличные', startingBalance: '500.00' });
    const archived = await archiveAccount(owner, first.id);
    expect(archived.statusCode).toBe(200);

    const active = await request(owner, `/api/v1/budgets/${owner.budgetId}/accounts/summary`);
    expect(active.json()).toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '50000',
      count: 1,
    });

    const all = await request(
      owner,
      `/api/v1/budgets/${owner.budgetId}/accounts/summary?status=all`,
    );
    expect(all.json()).toMatchObject({ totalMinor: '150000', count: 2 });
  });

  it('breaks envelope balances down by type', async () => {
    await createEnvelope(owner, {
      name: 'Текущие',
      envelopeType: 'CURRENT_EXPENSES',
      startingBalance: '2100.00',
    });
    await createEnvelope(owner, {
      name: 'Отпуск',
      envelopeType: 'SAVINGS_GOAL',
      startingBalance: '5000.00',
    });

    const response = await request(owner, `/api/v1/budgets/${owner.budgetId}/envelopes/summary`);

    expect(response.json()).toMatchObject({
      totalMinor: '710000',
      count: 2,
      byType: [
        { envelopeType: 'CURRENT_EXPENSES', totalMinor: '210000', count: 1 },
        { envelopeType: 'SAVINGS_GOAL', totalMinor: '500000', count: 1 },
      ],
    });
  });

  it('does not reveal another budget totals', async () => {
    const accounts = await request(foreign, `/api/v1/budgets/${owner.budgetId}/accounts/summary`);
    const envelopes = await request(foreign, `/api/v1/budgets/${owner.budgetId}/envelopes/summary`);

    expect(accounts.statusCode).toBe(404);
    expect(accounts.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(envelopes.statusCode).toBe(404);
    expect(envelopes.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  async function request(session: Session, url: string) {
    return server.inject({
      method: 'GET',
      url,
      cookies: { harmofin_session: session.cookie },
    });
  }

  async function createAccount(
    session: Session,
    overrides: Partial<{
      name: string;
      accountType: string;
      currency: string;
      startingBalance: string;
      accountingStartDate: string;
    }>,
  ) {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${session.budgetId}/accounts`,
      headers: { origin, 'x-csrf-token': session.csrfToken },
      cookies: { harmofin_session: session.cookie },
      payload: {
        name: 'Счёт',
        accountType: 'CASH',
        currency: 'RUB',
        startingBalance: '0.00',
        accountingStartDate: '2026-09-01',
        ...overrides,
      },
    });
    return response.json<{ id: string }>();
  }

  async function archiveAccount(session: Session, accountId: string) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${session.budgetId}/accounts/${accountId}/archive`,
      headers: { origin, 'x-csrf-token': session.csrfToken },
      cookies: { harmofin_session: session.cookie },
    });
  }

  async function createEnvelope(
    session: Session,
    overrides: Partial<{
      name: string;
      envelopeType: string;
      currency: string;
      startingBalance: string;
      displayOrder: number;
    }>,
  ) {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${session.budgetId}/envelopes`,
      headers: { origin, 'x-csrf-token': session.csrfToken },
      cookies: { harmofin_session: session.cookie },
      payload: {
        name: 'Конверт',
        envelopeType: 'CUSTOM',
        currency: 'RUB',
        startingBalance: '0.00',
        displayOrder: 0,
        ...overrides,
      },
    });
    return response.json<{ id: string }>();
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
    if (!cookie) {
      throw new Error(
        `Missing session cookie: ${response.statusCode} ${JSON.stringify(response.json())}`,
      );
    }
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
      csrfToken: body.csrfToken,
      cookie,
    };
  }

  async function cleanup(session: Session) {
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
