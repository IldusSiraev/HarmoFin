import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { assertDisposableDatabase } from './helpers/disposable-db.js';

// Тест-граница legacy. Таблицы эпохи модели 1 (transfer_parts, income_allocations,
// envelope_reallocations) и колонка envelopes.starting_balance_minor остаются в схеме до contract-миграции,
// после budget-reset они пусты. Ни один v2-путь не должен писать в них (см. docs/runbooks/legacy-schema.md).
const databaseUrl = assertDisposableDatabase(
  process.env.DATABASE_URL ??
    'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test',
);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = todayInTimezone(new Date(), 'UTC');

const START = 1_000_000n;

type Res = { statusCode: number; body: string; json<T = Record<string, unknown>>(): T };
type World = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
  accountId: string;
  secondAccountId: string;
  salaryId: string;
  foodId: string;
  savingsId: string;
  savingsTwoId: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUsers: string[] = [];

const readAs = (w: World, url: string) =>
  server.inject({
    method: 'GET',
    url,
    headers: { origin, cookie: `harmofin_session=${w.cookie}` },
  }) as unknown as Promise<Res>;
const writeAs = (w: World, method: 'POST', url: string, payload: unknown) =>
  server.inject({
    method,
    url,
    headers: {
      origin,
      cookie: `harmofin_session=${w.cookie}`,
      'x-csrf-token': w.csrfToken,
      'idempotency-key': randomUUID(),
    },
    payload: payload as Record<string, unknown>,
  }) as unknown as Promise<Res>;

async function legacyCounts(w: World) {
  const where = { budgetId: w.budgetId };
  return {
    transferParts: await prisma.transferPart.count({ where }),
    legacyAllocations: await prisma.incomeAllocation.count({ where }),
    legacyReallocations: await prisma.envelopeReallocation.count({ where }),
    freeMoneyEnvelopes: await prisma.envelope.count({
      where: { ...where, envelopeType: 'FREE_MONEY' },
    }),
    legacyTransfers: await prisma.transfer.count({ where: { ...where, mode: 'LEGACY_PARTS' } }),
  };
}

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
  for (const userId of createdUsers) await cleanupUser(userId);
  await app.close();
  await prisma.$disconnect();
});

describe('v2: граница legacy-таблиц (C05)', () => {
  it('v2 действия (расход, доход, прямой перевод, шаблон, funding, assignment, movement) не пишут в legacy таблицы', async () => {
    const w = await world();
    const empty = {
      transferParts: 0,
      legacyAllocations: 0,
      legacyReallocations: 0,
      freeMoneyEnvelopes: 0,
      legacyTransfers: 0,
    };
    // После budget-reset legacy-таблицы пусты.
    expect(await legacyCounts(w)).toEqual(empty);
    const base = `/api/v2/budgets/${w.budgetId}`;

    const expense = await writeAs(w, 'POST', `${base}/transactions`, {
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amount: '100.00',
      occurredOn: today,
      accountId: w.accountId,
      categoryId: w.foodId,
    });
    expect(expense.statusCode, expense.body).toBe(201);

    const income = await writeAs(w, 'POST', `${base}/transactions`, {
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      amount: '3000.00',
      occurredOn: today,
      accountId: w.accountId,
      categoryId: w.salaryId,
    });
    expect(income.statusCode, income.body).toBe(201);
    const incomeId = income.json<{ id: string }>().id;

    const transfer = await writeAs(w, 'POST', `${base}/transfers`, {
      sourceAccountId: w.accountId,
      destinationAccountId: w.secondAccountId,
      amount: '500.00',
      occurredOn: today,
    });
    expect(transfer.statusCode, transfer.body).toBe(201);
    expect(transfer.json<{ mode: string }>().mode).toBe('ACCOUNT_ONLY');

    // Шаблон: preview + apply.
    const templatePreview = await readAs(w, `${base}/reference-template/preview`);
    expect(templatePreview.statusCode, templatePreview.body).toBe(200);
    const tpl = templatePreview.json<{
      previewHash: string;
      envelopes: Array<{ role: string; status: string; suggestedAction: string }>;
    }>();
    expect(tpl.envelopes.some((row) => (row as { type?: string }).type === 'FREE_MONEY')).toBe(
      false,
    );
    const action = (role: string) => {
      const row = tpl.envelopes.find((item) => item.role === role)!;
      return row.status === 'COLLISION' ? 'SKIP' : row.suggestedAction;
    };
    const applied = await writeAs(w, 'POST', `${base}/reference-template/apply`, {
      previewHash: tpl.previewHash,
      periods: [
        { role: 'FIRST', action: action('FIRST') },
        { role: 'SECOND', action: action('SECOND') },
      ],
      mandatory: { action: action('MANDATORY') },
      savings: [],
    });
    expect(applied.statusCode, applied.body).toBe(200);

    // Funding preview + confirm по подтверждённому v2 доходу.
    const lines = [{ envelopeId: w.savingsId, amount: '1000.00' }];
    const fundingPreview = await writeAs(w, 'POST', `${base}/funding/preview`, {
      sourceKind: 'INCOME',
      incomeTransactionId: incomeId,
      overrides: lines,
      confirmPeriodTargets: [],
    });
    expect(fundingPreview.statusCode, fundingPreview.body).toBe(200);
    const funding = await writeAs(w, 'POST', `${base}/funding/confirm`, {
      sourceKind: 'INCOME',
      incomeTransactionId: incomeId,
      previewHash: fundingPreview.json<{ previewHash: string }>().previewHash,
      confirmPeriodTargets: [],
      lines,
    });
    expect(funding.statusCode, funding.body).toBe(200);

    // Свободное назначение и движение между конвертами.
    const assignment = await writeAs(w, 'POST', `${base}/assignments`, {
      envelopeId: w.savingsTwoId,
      amount: '200.00',
      sourceKind: 'FREE',
    });
    expect(assignment.statusCode, assignment.body).toBe(201);
    const movement = await writeAs(w, 'POST', `${base}/movements`, {
      sourceEnvelopeId: w.savingsId,
      destinationEnvelopeId: w.savingsTwoId,
      amount: '50.00',
    });
    expect(movement.statusCode, movement.body).toBe(201);

    // Эти ассерции упадут, если любой v2 путь начнёт писать в legacy таблицы
    // или создавать конверт FREE_MONEY.
    expect(await legacyCounts(w)).toEqual(empty);
    // Новые движения реально записаны в v2-таблицы (тест не вырожден).
    expect(
      await prisma.envelopeAssignment.count({ where: { budgetId: w.budgetId } }),
    ).toBeGreaterThan(0);
    expect(await prisma.envelopeMovement.count({ where: { budgetId: w.budgetId } })).toBe(1);
    expect(
      await prisma.transfer.count({ where: { budgetId: w.budgetId, mode: 'ACCOUNT_ONLY' } }),
    ).toBe(1);
    // Новые конверты (шаблон, v2) не получают физический starting_balance.
    const newEnvelopes = await prisma.envelope.findMany({ where: { budgetId: w.budgetId } });
    expect(newEnvelopes.length).toBeGreaterThan(0);
    expect(newEnvelopes.every((row) => row.startingBalanceMinor === 0n)).toBe(true);
  });
});

async function world(): Promise<World> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email: `v2-bound-${randomUUID()}@harmofin.test`, password },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{
    user: { id: string };
    workspace: { id: string };
    budget: { id: string };
    csrfToken: string;
  }>();
  createdUsers.push(body.user.id);
  const raw = response.headers['set-cookie'];
  const setCookie = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  const match = /harmofin_session=([^;]+)/.exec(setCookie);
  expect(match).not.toBeNull();
  const userId = body.user.id;
  const budgetId = body.budget.id;
  await prisma.budget.update({
    where: { id: budgetId },
    data: {
      planModelVersion: 2,
      planModelActivatedOn: day('2026-03-01'),
      timezone: 'UTC',
      cycleStartDay: 1,
      periodBoundaryOffset: 14,
    },
  });
  const account = (name: string, startingBalanceMinor: bigint) =>
    prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId,
        ownerUserId: userId,
        name,
        accountType: 'BANK_ACCOUNT',
        startingBalanceMinor,
        accountingStartDate: day('2026-01-01'),
      },
    });
  const category = (name: string, categoryType: 'EXPENSE' | 'INCOME', order: number) =>
    prisma.category.create({
      data: { id: randomUUID(), budgetId, name, categoryType, displayOrder: order },
    });
  const envelope = (
    name: string,
    envelopeType: 'CURRENT_EXPENSES' | 'SAVINGS_GOAL',
    startingBalanceMinor: bigint,
    order: number,
    periodSlot: 'FIRST' | null,
  ) =>
    prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId,
        ownerUserId: userId,
        name,
        envelopeType,
        startingBalanceMinor,
        displayOrder: order,
        periodSlot,
      },
    });
  const main = await account('Основной счёт', START);
  const second = await account('Накопительный счёт', 0n);
  const food = await category('Еда', 'EXPENSE', 900);
  const salary = await category('Зарплата', 'INCOME', 901);
  const savings = await envelope('Накопление А', 'SAVINGS_GOAL', 0n, 951, null);
  const savingsTwo = await envelope('Накопление Б', 'SAVINGS_GOAL', 0n, 952, null);
  return {
    userId,
    workspaceId: body.workspace.id,
    budgetId,
    cookie: decodeURIComponent(match![1]!),
    csrfToken: body.csrfToken,
    accountId: main.id,
    secondAccountId: second.id,
    salaryId: salary.id,
    foodId: food.id,
    savingsId: savings.id,
    savingsTwoId: savingsTwo.id,
  };
}

async function cleanupUser(userId: string): Promise<void> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.recoveryToken.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    const where = { budget: { workspaceId } };
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    await prisma.idempotencyRecord.deleteMany({ where });
    await prisma.incomeAllocation.deleteMany({ where });
    await prisma.envelopeReallocation.deleteMany({ where });
    await prisma.envelopeMovement.deleteMany({ where });
    await prisma.envelopeAssignment.deleteMany({ where });
    await prisma.planPayment.deleteMany({ where });
    await prisma.planOccurrence.deleteMany({ where });
    await prisma.regularPlan.deleteMany({ where });
    await prisma.envelopePeriod.deleteMany({ where });
    await prisma.envelopeFundingRule.deleteMany({ where });
    await prisma.budgetCycleRevision.deleteMany({ where });
    const budgets = await prisma.budget.findMany({ where: { workspaceId }, select: { id: true } });
    await prisma.transferPart.deleteMany({
      where: { budgetId: { in: budgets.map((budget) => budget.id) } },
    });
    await prisma.transfer.deleteMany({ where });
    await prisma.transaction.deleteMany({ where });
    await prisma.account.deleteMany({ where });
    await prisma.category.deleteMany({ where });
    await prisma.envelope.deleteMany({ where });
  }
  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
