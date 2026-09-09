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
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;

describe('cycles API', () => {
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
    owner = await register(`cycles-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`cycles-foreign-${randomUUID()}@harmofin.test`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('returns selected cycle and period from server budget settings', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/cycles?date=2026-09-09`,
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      cycle: { start: '2026-08-10', end: '2026-09-09' },
      period: { id: 'SECOND', start: '2026-08-25', end: '2026-09-09' },
      daysUntilNextBoundary: 1,
    });
  });

  it('rejects malformed dates and hides foreign budgets', async () => {
    const invalid = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/cycles?date=2026-02-29`,
      cookies: { harmofin_session: owner.cookie },
    });
    const foreignResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/cycles/current`,
      cookies: { harmofin_session: foreign.cookie },
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(foreignResponse.statusCode).toBe(404);
  });

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
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error('Missing session cookie');
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
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
