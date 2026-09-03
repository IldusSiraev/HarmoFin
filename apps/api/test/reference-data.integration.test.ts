import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const ownerEmail = `template-owner-${randomUUID()}@harmofin.test`;
const otherEmail = `template-other-${randomUUID()}@harmofin.test`;

let app: NestFastifyApplication;
let server: FastifyInstance;
let ownerId: string;
let otherId: string;
let ownerCookie: string;
let ownerCsrf: string;
let ownerWorkspaceId: string;
let ownerBudgetId: string;

const incomeKeys = [
  'income-salary',
  'income-shabashka',
  'income-other',
  'income-cashback',
  'income-deposit-interest',
];
const envelopeKeys = [
  'envelope-current-10-24',
  'envelope-current-25-9',
  'envelope-mandatory',
  'envelope-repair',
  'envelope-car',
  'envelope-free',
];

describe('reference template API', () => {
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

    const owner = await register(ownerEmail);
    ownerId = owner.user.id;
    ownerWorkspaceId = owner.workspace.id;
    ownerBudgetId = owner.budget.id;
    ownerCookie = owner.cookie;
    ownerCsrf = owner.csrfToken;
    const other = await register(otherEmail);
    otherId = other.user.id;
  });

  afterAll(async () => {
    await cleanupUser(ownerId);
    await cleanupUser(otherId);
    await app.close();
    await prisma.$disconnect();
  });

  it('documents reference template action in OpenAPI', async () => {
    const response = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = response.json<{ paths: Record<string, unknown> }>();

    expect(document.paths['/api/v1/budgets/{budgetId}/reference-template']).toMatchObject({
      post: { responses: { '200': expect.anything() } },
    });
    expect(document.paths['/api/v1/budgets/{budgetId}/accounts']).toMatchObject({
      get: { responses: { '200': expect.anything() } },
      post: { requestBody: expect.anything(), responses: { '201': expect.anything() } },
    });
    expect(document.paths['/api/v1/budgets/{budgetId}/accounts/{accountId}/archive']).toMatchObject(
      {
        post: { responses: { '200': expect.anything() } },
      },
    );
  });

  it('creates exact defaults and a safe template audit event', async () => {
    const response = await initializeTemplate(ownerBudgetId, ownerCookie, ownerCsrf);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      createdCategoryKeys: expect.arrayContaining(incomeKeys),
      createdEnvelopeKeys: expect.arrayContaining(envelopeKeys),
      existingCategoryKeys: [],
      existingEnvelopeKeys: [],
    });
    expect(
      await prisma.category.findMany({
        where: { budgetId: ownerBudgetId },
        orderBy: { displayOrder: 'asc' },
      }),
    ).toHaveLength(39);
    expect(
      await prisma.category.findFirst({
        where: { budgetId: ownerBudgetId, name: 'Кэшбек', categoryType: 'INCOME' },
      }),
    ).not.toBeNull();
    expect(
      await prisma.category.findFirst({
        where: { budgetId: ownerBudgetId, name: 'Проценты от вкладов', categoryType: 'INCOME' },
      }),
    ).not.toBeNull();
    expect(await prisma.envelope.count({ where: { budgetId: ownerBudgetId } })).toBe(6);
    const audit = await prisma.auditEvent.findFirst({
      where: { budgetId: ownerBudgetId, action: 'REFERENCE_TEMPLATE_INITIALIZED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.newValues).toMatchObject({
      createdCategoryKeys: expect.arrayContaining(['income-cashback']),
    });
    expect(JSON.stringify(audit?.newValues)).not.toContain('comment');
  });

  it('creates, updates, archives and scopes accounts', async () => {
    const invalidDigits = await createAccount({ lastFourDigits: '12' });
    const negativeWhenDisabled = await createAccount({ startingBalance: '-0.01' });

    expect(invalidDigits.statusCode).toBe(400);
    expect(invalidDigits.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(negativeWhenDisabled.statusCode).toBe(400);

    const created = await createAccount({ startingBalance: '90071992547409.93' });
    const account = created.json<{
      id: string;
      startingBalanceMinor: string;
      currentBalanceMinor: string;
    }>();

    expect(created.statusCode).toBe(201);
    expect(account).toMatchObject({
      startingBalanceMinor: '9007199254740993',
      currentBalanceMinor: '9007199254740993',
    });
    expect((await listAccounts('active')).json()).toHaveLength(1);
    expect((await getAccount(account.id)).statusCode).toBe(200);

    const duplicate = await createAccount({ name: 'Основной счёт' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'REFERENCE_NAME_CONFLICT' });

    const noOrigin = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts/${account.id}`,
      cookies: { harmofin_session: ownerCookie },
      payload: { name: 'Переименованный счёт' },
    });
    const missingCsrf = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts/${account.id}`,
      headers: { origin },
      cookies: { harmofin_session: ownerCookie },
      payload: { name: 'Переименованный счёт' },
    });
    expect(noOrigin.json()).toMatchObject({ code: 'ORIGIN_REQUIRED' });
    expect(missingCsrf.json()).toMatchObject({ code: 'CSRF_INVALID' });

    const settings = await server.inject({
      method: 'PATCH',
      url: `/api/v1/budgets/${ownerBudgetId}`,
      headers: { origin, 'x-csrf-token': ownerCsrf },
      cookies: { harmofin_session: ownerCookie },
      payload: { allowNegativeBalance: true },
    });
    expect(settings.statusCode).toBe(200);

    const updated = await updateAccount(account.id, { startingBalance: '-1.00' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      startingBalanceMinor: '-100',
      currentBalanceMinor: '-100',
    });

    const editorRole = await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'EDITOR' },
    });
    expect(editorRole.count).toBe(1);
    const editorResponse = await createAccount({ name: 'Недоступный счёт' });
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
    expect(editorResponse.statusCode).toBe(403);

    const other = await login(otherEmail);
    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts/${account.id}`,
      cookies: { harmofin_session: other.cookie },
    });
    const foreignList = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ownerBudgetId}/accounts`,
      cookies: { harmofin_session: other.cookie },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreignList.statusCode).toBe(404);

    const archived = await archiveAccount(account.id);
    const archivedAgain = await archiveAccount(account.id);
    expect(archived.statusCode).toBe(200);
    expect(archivedAgain.statusCode).toBe(200);
    expect((await listAccounts('active')).json()).toHaveLength(0);
    expect((await listAccounts('archived')).json()).toHaveLength(1);
    expect((await listAccounts('all')).json()).toHaveLength(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          budgetId: ownerBudgetId,
          entityType: 'account',
          entityId: account.id,
          action: 'ARCHIVED',
        },
      }),
    ).toBe(1);

    const reused = await createAccount({
      name: 'Основной счёт',
      lastFourDigits: null,
      comment: null,
    });
    expect(reused.statusCode).toBe(201);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, entityType: 'account', action: 'CREATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit.newValues)).not.toContain('lastFourDigits');
    expect(JSON.stringify(audit.newValues)).not.toContain('comment');
  });

  it('never duplicates or resurrects manually archived defaults', async () => {
    const repair = await prisma.envelope.findFirstOrThrow({
      where: { budgetId: ownerBudgetId, templateKey: 'envelope-repair' },
    });
    await prisma.envelope.update({ where: { id: repair.id }, data: { archivedAt: new Date() } });

    const response = await initializeTemplate(ownerBudgetId, ownerCookie, ownerCsrf);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      createdCategoryKeys: [],
      existingCategoryKeys: expect.arrayContaining(incomeKeys),
      createdEnvelopeKeys: [],
      existingEnvelopeKeys: expect.arrayContaining(envelopeKeys),
    });
    expect(
      await prisma.envelope.count({
        where: { budgetId: ownerBudgetId, templateKey: 'envelope-repair' },
      }),
    ).toBe(1);
    expect(
      (await prisma.envelope.findUniqueOrThrow({ where: { id: repair.id } })).archivedAt,
    ).not.toBeNull();
  });

  it('returns 403 for an accessible non-owner and 404 for another budget', async () => {
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'EDITOR' },
    });
    const editorResponse = await initializeTemplate(ownerBudgetId, ownerCookie, ownerCsrf);
    await prisma.workspaceMembership.updateMany({
      where: { userId: ownerId, workspaceId: ownerWorkspaceId },
      data: { role: 'OWNER' },
    });
    const other = await login(otherEmail);
    const foreignResponse = await initializeTemplate(ownerBudgetId, other.cookie, other.csrfToken);

    expect(editorResponse.statusCode).toBe(403);
    expect(editorResponse.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(foreignResponse.statusCode).toBe(404);
    expect(foreignResponse.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rolls back all template writes when a required default conflicts', async () => {
    const conflictBudget = await prisma.budget.create({
      data: { id: randomUUID(), workspaceId: ownerWorkspaceId, name: `Конфликт ${randomUUID()}` },
    });
    await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: conflictBudget.id,
        name: 'Зарплата',
        categoryType: 'INCOME',
        displayOrder: 0,
      },
    });

    const response = await initializeTemplate(conflictBudget.id, ownerCookie, ownerCsrf);

    expect(response.statusCode).toBe(500);
    expect(
      await prisma.category.count({
        where: { budgetId: conflictBudget.id, templateKey: { not: null } },
      }),
    ).toBe(0);
    expect(await prisma.envelope.count({ where: { budgetId: conflictBudget.id } })).toBe(0);
  });
});

async function createAccount(overrides: Record<string, unknown> = {}) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
    payload: {
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      bankName: 'Банк',
      lastFourDigits: '1234',
      currency: 'RUB',
      startingBalance: '0.00',
      accountingStartDate: '2026-09-01',
      comment: 'Личный комментарий',
      ...overrides,
    },
  });
}

async function listAccounts(status: 'active' | 'archived' | 'all') {
  return server.inject({
    method: 'GET',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts?status=${status}`,
    cookies: { harmofin_session: ownerCookie },
  });
}

async function getAccount(accountId: string) {
  return server.inject({
    method: 'GET',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts/${accountId}`,
    cookies: { harmofin_session: ownerCookie },
  });
}

async function updateAccount(accountId: string, payload: Record<string, unknown>) {
  return server.inject({
    method: 'PATCH',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts/${accountId}`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
    payload,
  });
}

async function archiveAccount(accountId: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${ownerBudgetId}/accounts/${accountId}/archive`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
  });
}

async function initializeTemplate(budgetId: string, cookie: string, csrfToken: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/budgets/${budgetId}/reference-template`,
    headers: { origin, 'x-csrf-token': csrfToken },
    cookies: { harmofin_session: cookie },
  });
}

async function register(email: string) {
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
  return { ...body, cookie };
}

async function login(email: string) {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  const body = response.json<{ csrfToken: string }>();
  const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
  if (!cookie) throw new Error('Missing session cookie');
  return { ...body, cookie };
}

async function cleanupUser(userId: string) {
  if (!userId) return;
  await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.recoveryToken.deleteMany({ where: { userId } });
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    await prisma.budget.updateMany({
      where: { workspaceId },
      data: {
        incomeAllocationSourceCategoryId: null,
        incomeAllocationTargetEnvelopeId: null,
      },
    });
    await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
