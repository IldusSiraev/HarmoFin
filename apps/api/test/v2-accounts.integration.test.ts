import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { FinancialBalanceRepository } from '../src/common/finance/financial-balance.repository.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const dayMs = 86_400_000;

const d = (delta: number) => new Date(Date.now() + delta * dayMs);
const asOfNow = new Date();

const emails = {
  owner: `v2-acc-owner-${randomUUID()}@harmofin.test`,
  editor: `v2-acc-editor-${randomUUID()}@harmofin.test`,
  outsider: `v2-acc-outsider-${randomUUID()}@harmofin.test`,
  legacy: `v2-acc-legacy-${randomUUID()}@harmofin.test`,
};

type FixtureUser = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const balances = new FinancialBalanceRepository();
const ctx: Partial<Record<keyof typeof emails, FixtureUser>> = {};

let cashAccountId: string;
let zeroAccountId: string;
let v1AccountId: string;
let envelopeId: string;
let futureTransferId: string;

describe('v2: доступность счетов (asOf-балансы, lockBudget, create/update/archive/restore)', () => {
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

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      ctx[key] = await registerFixture(emails[key]);
    }

    // Бюджет owner — v2 (разрешаем отрицательный остаток для проверок guards)
    await prisma.budget.update({
      where: { id: ctx.owner!.budgetId },
      data: {
        planModelVersion: 2,
        planModelActivatedOn: d(-60),
        timezone: 'UTC',
        allowNegativeBalance: true,
      },
    });

    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: ctx.owner!.workspaceId,
        userId: ctx.editor!.userId,
        role: 'EDITOR',
      },
    });

    cashAccountId = await createRawAccount(ctx.owner!.budgetId, 'Рублевый', 100_000n);
    zeroAccountId = await createRawAccount(ctx.owner!.budgetId, 'Нулевой', 0n);

    // Конверт с FREE-назначением, создающим положительный остаток (20k RUB)
    envelopeId = await createEnvelope(ctx.owner!.budgetId, 'DEFICIT');
    await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.owner!.budgetId,
        envelopeId,
        type: 'FREE',
        amountMinor: 2_000_000n,
        effectiveOn: d(-1),
      },
    });

    // Будущий confirmed-перевод: v1-формула его считает, asOf-окно — нет
    futureTransferId = randomUUID();
    await prisma.transfer.create({
      data: {
        id: futureTransferId,
        budgetId: ctx.owner!.budgetId,
        status: 'CONFIRMED',
        mode: 'ACCOUNT_ONLY',
        totalMinor: 500n,
        occurredOn: d(1),
        confirmedAt: new Date(),
        sourceAccountId: cashAccountId,
        destinationAccountId: zeroAccountId,
        createdByUserId: ctx.owner!.userId,
        updatedByUserId: ctx.owner!.userId,
      },
    });

    v1AccountId = await createRawAccount(ctx.legacy!.budgetId, 'v1-счёт', 100_000n);
  });

  afterAll(async () => {
    const editor = ctx.editor;
    if (editor) {
      await prisma.workspaceMembership.deleteMany({
        where: { userId: editor.userId, workspaceId: { not: editor.workspaceId } },
      });
    }
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await cleanupUser(ctx[key]?.userId ?? '');
    }
  });

  const budgetOf = (user: keyof typeof emails) => ctx[user]!.budgetId;

  const accountsUrl = (budgetId: string, accountId?: string, action?: 'archive' | 'restore') => {
    const base = `/api/v1/budgets/${budgetId}/accounts`;
    if (!accountId) return base;
    return action ? `${base}/${accountId}/${action}` : `${base}/${accountId}`;
  };

  const authHeaders = (user: FixtureUser) => ({
    origin,
    cookie: `harmofin_session=${user.cookie}`,
  });

  const mutationHeaders = (user: FixtureUser) => ({
    ...authHeaders(user),
    'x-csrf-token': user.csrfToken,
  });

  const accountBalance = (budgetId: string, accountId: string) =>
    prisma.$transaction((tx) => balances.accountBalance(tx, budgetId, accountId));

  const accountBalanceAsOf = (budgetId: string, accountId: string) =>
    prisma.$transaction((tx) => balances.accountBalanceAsOf(tx, budgetId, accountId, asOfNow));

  const totalCashAsOf = (budgetId: string) =>
    prisma.$transaction((tx) => balances.totalCashAsOf(tx, budgetId, asOfNow));

  it('asOf-баланс учитывает окно дат: будущие confirmed и DRAFT не считаются', async () => {
    const ownerBudgetId = budgetOf('owner');

    // asOf (сегодня): будущий confirmed-перевод F1 (0.50) вне окна
    expect(await accountBalanceAsOf(ownerBudgetId, cashAccountId)).toBe(100_000n);
    expect(await accountBalanceAsOf(ownerBudgetId, zeroAccountId)).toBe(0n);
    expect(await totalCashAsOf(ownerBudgetId)).toBe(100_000n);

    // v1-формула дату не фильтрует: будущий перевод засчитан
    expect(await accountBalance(ownerBudgetId, cashAccountId)).toBe(99_500n);
    expect(await accountBalance(ownerBudgetId, zeroAccountId)).toBe(500n);

    // DRAFT-перевод не считается ни в v1, ни в asOf
    await prisma.transfer.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        status: 'DRAFT',
        mode: 'ACCOUNT_ONLY',
        totalMinor: 50_000n,
        occurredOn: d(-1),
        sourceAccountId: cashAccountId,
        destinationAccountId: zeroAccountId,
        createdByUserId: ctx.owner!.userId,
        updatedByUserId: ctx.owner!.userId,
      },
    });

    expect(await accountBalanceAsOf(ownerBudgetId, cashAccountId)).toBe(100_000n);
    expect(await accountBalanceAsOf(ownerBudgetId, zeroAccountId)).toBe(0n);
    expect(await accountBalance(ownerBudgetId, cashAccountId)).toBe(99_500n);
    expect(await accountBalance(ownerBudgetId, zeroAccountId)).toBe(500n);
  });

  it('v2-создание счёта: 201; дубль имени — 409 REFERENCE_NAME_CONFLICT', async () => {
    const payload = {
      name: 'V2 карта',
      accountType: 'BANK_CARD',
      currency: 'RUB',
      startingBalance: '12.34',
      accountingStartDate: d(-60).toISOString().slice(0, 10),
    };

    const created = await server.inject({
      method: 'POST',
      url: accountsUrl(budgetOf('owner')),
      headers: mutationHeaders(ctx.owner!),
      payload,
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<Record<string, unknown>>();
    expect(body.startingBalanceMinor).toBe('1234');

    const duplicate = await server.inject({
      method: 'POST',
      url: accountsUrl(budgetOf('owner')),
      headers: mutationHeaders(ctx.owner!),
      payload,
    });
    expect(duplicate.statusCode).toBe(409);
    const dupBody = duplicate.json<Record<string, unknown>>();
    expect(dupBody.code).toBe('REFERENCE_NAME_CONFLICT');
  });

  it('v2-архивация: с остатком — 409 ACCOUNT_HAS_BALANCE; без остатка — 200; повтор — 200', async () => {
    const ownerBudgetId = budgetOf('owner');

    const archiveZero = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, zeroAccountId, 'archive'),
      headers: mutationHeaders(ctx.owner!),
    });
    expect(archiveZero.statusCode).toBe(200);
    expect(archiveZero.json<{ archivedAt: string | null }>().archivedAt).not.toBeNull();

    const archiveCash = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, cashAccountId, 'archive'),
      headers: mutationHeaders(ctx.owner!),
    });
    expect(archiveCash.statusCode).toBe(409);
    const errorBody = archiveCash.json<Record<string, unknown>>();
    expect(errorBody.code).toBe('ACCOUNT_HAS_BALANCE');

    const cash = await server.inject({
      method: 'GET',
      url: accountsUrl(ownerBudgetId, cashAccountId),
      headers: authHeaders(ctx.owner!),
    });
    expect(cash.statusCode).toBe(200);
    expect(cash.json<{ archivedAt: string | null }>().archivedAt).toBeNull();

    const repeatArchive = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, zeroAccountId, 'archive'),
      headers: mutationHeaders(ctx.owner!),
    });
    expect(repeatArchive.statusCode).toBe(200);
    expect(repeatArchive.json<{ archivedAt: string | null }>().archivedAt).not.toBeNull();
  });

  it('v2-restore: 200 + audit RESTORED; повтор/неархив — 409; editor — 403; outsider — 404; v1 — 409', async () => {
    const ownerBudgetId = budgetOf('owner');

    // Неархивный счёт
    const restoreActive = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, cashAccountId, 'restore'),
      headers: mutationHeaders(ctx.owner!),
    });
    expect(restoreActive.statusCode).toBe(409);
    expect(restoreActive.json<Record<string, unknown>>().code).toBe('ACCOUNT_NOT_ARCHIVED');

    // Архивный счёт (из предыдущего теста)
    const restored = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, zeroAccountId, 'restore'),
      headers: mutationHeaders(ctx.owner!),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ archivedAt: string | null }>().archivedAt).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: zeroAccountId, entityType: 'account', action: 'RESTORED' },
    });
    expect(audit).not.toBeNull();

    // Повторный restore
    const restoreAgain = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, zeroAccountId, 'restore'),
      headers: mutationHeaders(ctx.owner!),
    });
    expect(restoreAgain.statusCode).toBe(409);
    expect(restoreAgain.json<Record<string, unknown>>().code).toBe('ACCOUNT_NOT_ARCHIVED');

    // Editor — 403
    const editorRestore = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, cashAccountId, 'restore'),
      headers: mutationHeaders(ctx.editor!),
    });
    expect(editorRestore.statusCode).toBe(403);

    // Outsider — 404
    const outsiderRestore = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, zeroAccountId, 'restore'),
      headers: mutationHeaders(ctx.outsider!),
    });
    expect(outsiderRestore.statusCode).toBe(404);

    // v1-бюджет — 409 MODEL_VERSION_MISMATCH
    const legacyRestore = await server.inject({
      method: 'POST',
      url: accountsUrl(budgetOf('legacy'), v1AccountId, 'restore'),
      headers: mutationHeaders(ctx.legacy!),
    });
    expect(legacyRestore.statusCode).toBe(409);
    expect(legacyRestore.json<Record<string, unknown>>().code).toBe('MODEL_VERSION_MISMATCH');
  });

  it('v2: архивный счёт с остатком восстанавливается без zero-check', async () => {
    const ownerBudgetId = budgetOf('owner');
    const fundsAccountId = await createRawAccount(ownerBudgetId, 'Фанды', 0n);

    const archiveFunds = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, fundsAccountId, 'archive'),
      headers: mutationHeaders(ctx.owner!),
    });
    expect(archiveFunds.statusCode).toBe(200);

    // Подкачка кэш-переводом, пока счёт в архиве
    await prisma.transfer.create({
      data: {
        id: randomUUID(),
        budgetId: ownerBudgetId,
        status: 'CONFIRMED',
        mode: 'ACCOUNT_ONLY',
        totalMinor: 50_000n,
        occurredOn: d(-1),
        confirmedAt: new Date(),
        sourceAccountId: cashAccountId,
        destinationAccountId: fundsAccountId,
        createdByUserId: ctx.owner!.userId,
        updatedByUserId: ctx.owner!.userId,
      },
    });

    expect(await accountBalance(ownerBudgetId, fundsAccountId)).toBe(50_000n);

    const restored = await server.inject({
      method: 'POST',
      url: accountsUrl(ownerBudgetId, fundsAccountId, 'restore'),
      headers: mutationHeaders(ctx.owner!),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ archivedAt: string | null }>().archivedAt).toBeNull();

    expect(await accountBalanceAsOf(ownerBudgetId, fundsAccountId)).toBe(50_000n);
    expect(await accountBalanceAsOf(ownerBudgetId, cashAccountId)).toBe(50_000n);
  });

  it('v2-update: рост непокрытой части назначений — 409; снижение — 200', async () => {
    const ownerBudgetId = budgetOf('owner');

    // Снижение startingBalance на 1.00 снижает totalCash и увеличивает unbacked -> 409
    const deficit = await server.inject({
      method: 'PATCH',
      url: accountsUrl(ownerBudgetId, cashAccountId),
      headers: mutationHeaders(ctx.owner!),
      payload: { startingBalance: '-1.00' },
    });
    expect(deficit.statusCode).toBe(409);
    expect(deficit.json<Record<string, unknown>>().code).toBe('ASSIGNMENT_UNBACKED');

    // Состояние не изменилось
    const afterDeficit = await server.inject({
      method: 'GET',
      url: accountsUrl(ownerBudgetId, cashAccountId),
      headers: authHeaders(ctx.owner!),
    });
    expect(afterDeficit.json<{ startingBalanceMinor: string }>().startingBalanceMinor).toBe(
      '100000',
    );

    // Рост startingBalance на 1.00 снижает unbacked -> 200
    const okUpdate = await server.inject({
      method: 'PATCH',
      url: accountsUrl(ownerBudgetId, cashAccountId),
      headers: mutationHeaders(ctx.owner!),
      payload: { startingBalance: '1001.00' },
    });
    expect(okUpdate.statusCode).toBe(200);
    expect(okUpdate.json<{ startingBalanceMinor: string }>().startingBalanceMinor).toBe('100100');
  });

  it('v1-архивация с остатком — 200 (guard только для v2)', async () => {
    const legacy = await server.inject({
      method: 'POST',
      url: accountsUrl(budgetOf('legacy'), v1AccountId, 'archive'),
      headers: mutationHeaders(ctx.legacy!),
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json<{ archivedAt: string | null }>().archivedAt).not.toBeNull();
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function registerFixture(email: string): Promise<FixtureUser> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{
    user: { id: string };
    workspace: { id: string };
    budget: { id: string };
    csrfToken: string;
  }>();
  const setCookieRaw = response.headers['set-cookie'];
  const setCookie = Array.isArray(setCookieRaw) ? setCookieRaw.join('; ') : (setCookieRaw ?? '');
  const match = /harmofin_session=([^;]+)/.exec(setCookie);
  const cookie = match ? decodeURIComponent(match[1]!) : '';
  expect(cookie).not.toHaveLength(0);
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    cookie,
    csrfToken: body.csrfToken,
  };
}

async function createRawAccount(
  budgetId: string,
  name: string,
  startingBalanceMinor: bigint,
): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      name,
      accountType: 'BANK_ACCOUNT',
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor,
      accountingStartDate: d(-90),
    },
  });
  return account.id;
}

async function createEnvelope(budgetId: string, code: string): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Envelope ${code}`,
      envelopeType: 'MANDATORY_EXPENSES',
      startingBalanceMinor: 0n,
      displayOrder: 1,
    },
  });
  return envelope.id;
}

async function cleanupUser(userId: string): Promise<void> {
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
    await prisma.idempotencyRecord.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeMovement.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeAssignment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.incomeAllocation.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transferPart.deleteMany({
      where: { transfer: { budget: { workspaceId } } },
    });
    await prisma.transfer.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transaction.deleteMany({ where: { budget: { workspaceId } } });
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
