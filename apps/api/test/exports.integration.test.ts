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
let editor: Session;
let viewer: Session;
let foreign: Session;
let foreignAccountId: string;

describe('CSV transactions export API', () => {
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
    owner = await register(`exports-owner-${randomUUID()}@harmofin.test`);
    editor = await register(`exports-editor-${randomUUID()}@harmofin.test`);
    viewer = await register(`exports-viewer-${randomUUID()}@harmofin.test`);
    foreign = await register(`exports-foreign-${randomUUID()}@harmofin.test`);
    await prisma.workspaceMembership.createMany({
      data: [
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          userId: editor.userId,
          role: 'EDITOR',
        },
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          userId: viewer.userId,
          role: 'VIEWER',
        },
      ],
    });
    await seedExportData();
  });

  afterAll(async () => {
    for (const session of [owner, editor, viewer, foreign]) await cleanup(session);
    await app.close();
    await prisma.$disconnect();
  });

  it('exports filtered owner journal rows with safe CSV bytes without mutations', async () => {
    const before = await prisma.transaction.count({ where: { budgetId: owner.budgetId } });
    const response = await exportCsv(owner, owner.budgetId, { search: 'export-formula' });
    const after = await prisma.transaction.count({ where: { budgetId: owner.budgetId } });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="harmofin-operations.csv"',
    );
    expect(response.body).toMatch(/^﻿ID;Дата;Тип;Статус;Сумма \(коп\.\);/);
    expect(response.body).toContain("'=" + 'SUM(A1:A2)');
    expect(response.body).toContain('export-formula');
    expect(response.body).not.toContain('draft-only');
    expect(response.body).toContain('\r\n');
    expect(after).toBe(before);
  });

  it('allows only owner and returns 404 for foreign budget or filter', async () => {
    const [editorResponse, viewerResponse, foreignBudget, foreignFilter] = await Promise.all([
      exportCsv(editor, owner.budgetId),
      exportCsv(viewer, owner.budgetId),
      exportCsv(owner, foreign.budgetId),
      exportCsv(owner, owner.budgetId, { accountId: foreignAccountId }),
    ]);

    expect(editorResponse.statusCode).toBe(403);
    expect(editorResponse.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(viewerResponse.statusCode).toBe(403);
    expect(viewerResponse.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(foreignBudget.statusCode).toBe(404);
    expect(foreignFilter.statusCode).toBe(404);
    expect(foreignFilter.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rejects more than 10,000 filtered rows', async () => {
    const response = await exportCsv(owner, owner.budgetId, { search: 'export-limit' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'EXPORT_LIMIT_EXCEEDED' });
  });

  async function seedExportData() {
    const accountId = randomUUID();
    const categoryId = randomUUID();
    const envelopeId = randomUUID();
    foreignAccountId = randomUUID();
    const occurredOn = new Date('2026-09-10T00:00:00.000Z');

    await prisma.account.createMany({
      data: [
        {
          id: accountId,
          budgetId: owner.budgetId,
          name: 'Экспортный счёт',
          accountType: 'CASH',
          startingBalanceMinor: 100_000n,
          accountingStartDate: occurredOn,
        },
        {
          id: foreignAccountId,
          budgetId: foreign.budgetId,
          name: 'Чужой экспортный счёт',
          accountType: 'CASH',
          startingBalanceMinor: 0n,
          accountingStartDate: occurredOn,
        },
      ],
    });
    await prisma.category.create({
      data: {
        id: categoryId,
        budgetId: owner.budgetId,
        name: 'Экспортная категория',
        categoryType: 'EXPENSE',
        displayOrder: 0,
      },
    });
    await prisma.envelope.create({
      data: {
        id: envelopeId,
        budgetId: owner.budgetId,
        name: 'Экспортный конверт',
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 100_000n,
        displayOrder: 0,
      },
    });
    await prisma.transaction.createMany({
      data: [
        {
          id: randomUUID(),
          budgetId: owner.budgetId,
          transactionType: 'EXPENSE',
          status: 'CONFIRMED',
          amountMinor: 12_345n,
          occurredOn,
          accountId,
          categoryId,
          envelopeId,
          merchantName: 'export-formula',
          comment: '=SUM(A1:A2)',
          isPlanned: true,
          confirmedAt: new Date(),
          createdByUserId: owner.userId,
          updatedByUserId: owner.userId,
        },
        {
          id: randomUUID(),
          budgetId: owner.budgetId,
          transactionType: 'EXPENSE',
          status: 'DRAFT',
          amountMinor: 999n,
          occurredOn,
          accountId,
          categoryId,
          envelopeId,
          merchantName: 'draft-only',
          createdByUserId: owner.userId,
          updatedByUserId: owner.userId,
        },
      ],
    });
    await prisma.transaction.createMany({
      data: Array.from({ length: 10_001 }, () => ({
        id: randomUUID(),
        budgetId: owner.budgetId,
        transactionType: 'EXPENSE' as const,
        status: 'CONFIRMED' as const,
        amountMinor: 1n,
        occurredOn,
        accountId,
        categoryId,
        envelopeId,
        merchantName: 'export-limit',
        confirmedAt: new Date(),
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      })),
    });
  }

  function exportCsv(session: Session, budgetId: string, query: Record<string, string> = {}) {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${budgetId}/exports/transactions.csv?${new URLSearchParams(query)}`,
      cookies: { harmofin_session: session.cookie },
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
