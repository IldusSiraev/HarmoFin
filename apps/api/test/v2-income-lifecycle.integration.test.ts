import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { FinancialBalanceRepository } from '../src/common/finance/financial-balance.repository.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const dayMs = 86_400_000;
const d = (delta: number) => new Date(Date.now() + delta * dayMs);

type User = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

const emails = {
  owner: `v2-inc-owner-${randomUUID()}@harmofin.test`,
  editor: `v2-inc-editor-${randomUUID()}@harmofin.test`,
  viewer: `v2-inc-viewer-${randomUUID()}@harmofin.test`,
  outsider: `v2-inc-outsider-${randomUUID()}@harmofin.test`,
  tight: `v2-inc-tight-${randomUUID()}@harmofin.test`,
};
const ctx: Partial<Record<keyof typeof emails, User>> = {};

let app: NestFastifyApplication;
let server: FastifyInstance;
const balances = new FinancialBalanceRepository();

let accountId: string;
let expenseCategoryId: string;
let incomeCategoryId: string;
let otherIncomeCategoryId: string;
let envelopeAId: string;
let envelopeBId: string;
let outsiderIncomeId: string;
let tightAccountId: string;
let tightIncomeCategoryId: string;
let tightEnvelopeId: string;
let editorAccountId: string;

const today = todayInTimezone(new Date(), 'UTC');
const yesterday = todayInTimezone(new Date(Date.now() - dayMs), 'UTC');
const owner = () => ctx.owner!;
const tight = () => ctx.tight!;

const cash = (id: string) =>
  prisma.$transaction((tx) => balances.accountBalance(tx, owner().budgetId, id));

function headers(user: User | undefined, key?: string): Record<string, string> {
  return {
    origin,
    cookie: `harmofin_session=${user?.cookie ?? ''}`,
    'x-csrf-token': user?.csrfToken ?? '',
    ...(key ? { 'idempotency-key': key } : {}),
  };
}
type Res = {
  statusCode: number;
  json<T = Record<string, unknown> & { code?: string; assignmentIds?: string[] }>(): T;
};
const call = (
  method: 'PATCH' | 'DELETE' | 'POST',
  user: User | undefined,
  path: string,
  key: string | undefined,
  payload?: Record<string, unknown>,
  budgetUser: User = owner(),
): Promise<Res> =>
  server.inject({
    method,
    url: `/api/v2/budgets/${budgetUser.budgetId}${path}`,
    headers: headers(user, key),
    ...(payload ? { payload } : {}),
  }) as unknown as Promise<Res>;
const budgetOf = (user: User) => (user === tight() ? tight() : owner());
const patch = (id: string, key: string, payload: Record<string, unknown>, user = owner()) =>
  call('PATCH', user, `/transactions/${id}`, key, payload, budgetOf(user));
const del = (id: string, key: string, user = owner()) =>
  call('DELETE', user, `/transactions/${id}`, key, undefined, budgetOf(user));
const restore = (id: string, key: string, user = owner()) =>
  call('POST', user, `/transactions/${id}/restore`, key, {}, budgetOf(user));

async function income(
  amount: string,
  over: Record<string, unknown> = {},
  user: User = owner(),
): Promise<string> {
  const res = await call(
    'POST',
    user,
    '/transactions',
    `mk-${randomUUID()}`,
    {
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      amount,
      occurredOn: today,
      accountId: user === tight() ? tightAccountId : accountId,
      categoryId: user === tight() ? tightIncomeCategoryId : incomeCategoryId,
      ...over,
    },
    user,
  );
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}
async function assignIncome(incomeId: string, envelopeId: string, amount: string): Promise<string> {
  const res = await call('POST', owner(), '/assignments', `as-${randomUUID()}`, {
    sourceKind: 'INCOME',
    incomeTransactionId: incomeId,
    envelopeId,
    amount,
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ assignmentId: string }>().assignmentId;
}
const reviseAssignment = (id: string, amount: string) =>
  call('PATCH', owner(), `/assignments/${id}`, `rv-${randomUUID()}`, { amount });
const cancelAssignment = (id: string) =>
  call('DELETE', owner(), `/assignments/${id}`, `cn-${randomUUID()}`);

const confirmedIncomeAssignmentTotal = async (incomeId: string) =>
  (
    await prisma.envelopeAssignment.aggregate({
      where: { sourceIncomeTransactionId: incomeId, type: 'INCOME', status: 'CONFIRMED' },
      _sum: { amountMinor: true },
    })
  )._sum.amountMinor ?? 0n;
const dbTx = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id } });
const auditCount = (budgetId: string, entityId: string, action: string) =>
  prisma.auditEvent.count({ where: { budgetId, entityId, action: action as never } });

describe('v2 доход: изменение, удаление и восстановление при назначениях', () => {
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
      ctx[key] = await register(emails[key]);
    }
    await prisma.budget.updateMany({
      where: {
        id: { in: [owner().budgetId, ctx.outsider!.budgetId, tight().budgetId] },
      },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });
    await prisma.budget.update({
      where: { id: owner().budgetId },
      data: { allowNegativeBalance: false },
    });
    await prisma.budget.update({
      where: { id: tight().budgetId },
      data: { allowNegativeBalance: true },
    });
    for (const [user, role] of [
      [ctx.editor!, 'EDITOR'],
      [ctx.viewer!, 'VIEWER'],
    ] as const) {
      await prisma.workspaceMembership.create({
        data: { id: randomUUID(), workspaceId: owner().workspaceId, userId: user.userId, role },
      });
    }
    const b = owner().budgetId;
    accountId = await createAccount(b, owner().userId, 0n);
    expenseCategoryId = await createCategory(b, 'EXPENSE');
    incomeCategoryId = await createCategory(b, 'INCOME');
    otherIncomeCategoryId = await createCategory(b, 'INCOME');
    envelopeAId = await createEnvelope(b, owner().userId);
    envelopeBId = await createEnvelope(b, owner().userId);
    editorAccountId = await createAccount(b, ctx.editor!.userId, 0n);
    tightAccountId = await createAccount(tight().budgetId, tight().userId, 0n);
    tightIncomeCategoryId = await createCategory(tight().budgetId, 'INCOME');
    tightEnvelopeId = await createEnvelope(tight().budgetId, tight().userId);

    const outsiderAccount = await createAccount(ctx.outsider!.budgetId, ctx.outsider!.userId, 0n);
    const outsiderCategory = await createCategory(ctx.outsider!.budgetId, 'INCOME');
    const foreign = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amountMinor: 1_000n,
        occurredOn: d(-1),
        accountId: outsiderAccount,
        categoryId: outsiderCategory,
        isPlanned: false,
        confirmedAt: new Date(),
        createdByUserId: ctx.outsider!.userId,
        updatedByUserId: ctx.outsider!.userId,
        accountingModelVersion: 2,
      },
    });
    outsiderIncomeId = foreign.id;
  });

  afterAll(async () => {
    for (const user of [ctx.editor, ctx.viewer]) {
      if (user) {
        await prisma.workspaceMembership.deleteMany({
          where: { userId: user.userId, workspaceId: { not: user.workspaceId } },
        });
      }
    }
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await cleanupUser(ctx[key]?.userId ?? '');
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('доход 106000 с назначениями 40000+66000: нельзя уменьшить до 90000 или удалить, после освобождения можно', async () => {
    const accountStart = await cash(accountId);
    const id = await income('106000.00');
    const a1 = await assignIncome(id, envelopeAId, '40000.00');
    const a2 = await assignIncome(id, envelopeBId, '66000.00');
    expect(await cash(accountId)).toBe(accountStart + 10_600_000n);

    const decrease = await patch(id, 'dec-1', { amount: '90000.00' });
    expect(decrease.statusCode).toBe(409);
    expect(decrease.json().code).toBe('SOURCE_EXHAUSTED');
    expect([...(decrease.json().assignmentIds ?? [])].sort()).toEqual([a1, a2].sort());
    const removal = await del(id, 'del-1');
    expect(removal.statusCode).toBe(409);
    expect(removal.json().code).toBe('SOURCE_EXHAUSTED');
    expect([...(removal.json().assignmentIds ?? [])].sort()).toEqual([a1, a2].sort());
    expect(await confirmedIncomeAssignmentTotal(id)).toBe(10_600_000n);
    expect((await dbTx(id)).amountMinor).toBe(10_600_000n);
    expect((await dbTx(id)).status).toBe('CONFIRMED');
    expect(await cash(accountId)).toBe(accountStart + 10_600_000n);

    expect((await reviseAssignment(a2, '50000.00')).statusCode).toBe(200);
    const decreased = await patch(id, 'dec-2', { amount: '90000.00' });
    expect(decreased.statusCode).toBe(200);
    expect(decreased.json()).toMatchObject({ id, amountMinor: '9000000' });
    expect(await cash(accountId)).toBe(accountStart + 9_000_000n);
    expect(await confirmedIncomeAssignmentTotal(id)).toBe(9_000_000n);
    expect(await auditCount(owner().budgetId, id, 'UPDATED')).toBe(1);

    // delete is still blocked until the assignments are explicitly released
    expect((await del(id, 'del-2')).statusCode).toBe(409);
    expect((await cancelAssignment(a1)).statusCode).toBe(200);
    expect((await cancelAssignment(a2)).statusCode).toBe(200);
    const removed = await del(id, 'del-3');
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ id, status: 'DELETED' });
    expect(await cash(accountId)).toBe(accountStart);
    expect(await auditCount(owner().budgetId, id, 'DELETED')).toBe(1);

    const restored = await restore(id, 'res-1');
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ id, status: 'CONFIRMED' });
    expect(await cash(accountId)).toBe(accountStart + 9_000_000n);
    expect(await confirmedIncomeAssignmentTotal(id)).toBe(0n);
  }, 30_000);

  it('смена категории и даты не меняет существующие назначения', async () => {
    const id = await income('1000.00');
    const a = await assignIncome(id, envelopeAId, '400.00');
    const before = await prisma.envelopeAssignment.findUniqueOrThrow({ where: { id: a } });
    const res = await patch(id, 'cat-1', {
      categoryId: otherIncomeCategoryId,
      occurredOn: yesterday,
      comment: 'правка',
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.envelopeAssignment.findUniqueOrThrow({ where: { id: a } });
    expect(after).toEqual(before);
    expect((await dbTx(id)).categoryId).toBe(otherIncomeCategoryId);
  });

  it('строгий счёт: уменьшение, перенос и удаление дохода, лишающие счёт покрытия расхода, дают INSUFFICIENT_BALANCE', async () => {
    const strict = await createAccount(owner().budgetId, owner().userId, 0n);
    const second = await createAccount(owner().budgetId, owner().userId, 0n);
    const id = await income('500.00', { accountId: strict });
    const spend = await call('POST', owner(), '/transactions', 'strict-exp', {
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amount: '450.00',
      occurredOn: today,
      accountId: strict,
      categoryId: expenseCategoryId,
    });
    expect(spend.statusCode).toBe(201);
    const startCash = await cash(strict);
    for (const res of [
      await patch(id, 'st-1', { amount: '100.00' }),
      await patch(id, 'st-2', { accountId: second }),
      await del(id, 'st-3'),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INSUFFICIENT_BALANCE');
    }
    expect(await cash(strict)).toBe(startCash);
    expect((await patch(id, 'st-4', { amount: '460.00' })).statusCode).toBe(200);
    expect(await cash(strict)).toBe(startCash - 4_000n);
  });

  it('назначения должны оставаться обеспеченными наличными: ASSIGNMENT_UNBACKED при уменьшении и удалении дохода', async () => {
    const id = await income('1000.00', {}, tight());
    const free = await call(
      'POST',
      tight(),
      '/assignments',
      'tight-free',
      { sourceKind: 'FREE', envelopeId: tightEnvelopeId, amount: '800.00' },
      tight(),
    );
    expect(free.statusCode).toBe(201);
    for (const res of [
      await patch(id, 'ub-1', { amount: '500.00' }, tight()),
      await del(id, 'ub-2', tight()),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ASSIGNMENT_UNBACKED');
    }
    expect((await dbTx(id)).amountMinor).toBe(100_000n);
    expect((await patch(id, 'ub-3', { amount: '800.00' }, tight())).statusCode).toBe(200);
  });

  it('идемпотентность: повтор PATCH/DELETE/restore без повторного эффекта, чужая цель с тем же ключом - конфликт', async () => {
    const accountStart = await cash(accountId);
    const a = await income('100.00');
    const b = await income('100.00');
    expect((await patch(a, 'idem-p', { amount: '60.00' })).statusCode).toBe(200);
    expect((await patch(a, 'idem-p', { amount: '60.00' })).statusCode).toBe(200);
    expect(await cash(accountId)).toBe(accountStart + 6_000n + 10_000n);
    const conflict = await patch(b, 'idem-p', { amount: '60.00' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('IDEMPOTENCY_CONFLICT');

    expect((await del(a, 'idem-d')).statusCode).toBe(200);
    expect((await del(a, 'idem-d')).statusCode).toBe(200);
    expect(await cash(accountId)).toBe(accountStart + 10_000n);
    expect((await restore(a, 'idem-r')).statusCode).toBe(200);
    expect((await restore(a, 'idem-r')).statusCode).toBe(200);
    expect(await cash(accountId)).toBe(accountStart + 16_000n);
    const again = await del(b, 'idem-d2');
    expect(again.statusCode).toBe(200);
    expect((await del(b, 'idem-d3')).json().code).toBe('TRANSACTION_ALREADY_DELETED');
  });

  it('restore заново проверяет ссылки и дату: архивный счёт даёт ошибку, запись остаётся DELETED', async () => {
    const acc = await createAccount(owner().budgetId, owner().userId, 0n);
    const id = await income('50.00', { accountId: acc });
    expect((await del(id, 'rr-1')).statusCode).toBe(200);
    await prisma.account.update({ where: { id: acc }, data: { archivedAt: new Date() } });
    const res = await restore(id, 'rr-2');
    expect([404, 422]).toContain(res.statusCode);
    expect((await dbTx(id)).status).toBe('DELETED');
  });

  it('роли и изоляция: только автор правит; VIEWER 403; посторонний и чужой доход 404', async () => {
    const id = await income('10.00');
    expect((await patch(id, 'rl-v1', { comment: 'x' }, ctx.viewer!)).statusCode).toBe(403);
    expect((await del(id, 'rl-v2', ctx.viewer!)).statusCode).toBe(403);
    expect((await restore(id, 'rl-v3', ctx.viewer!)).statusCode).toBe(403);
    const asOutsider = await call(
      'PATCH',
      ctx.outsider!,
      `/transactions/${id}`,
      'rl-o1',
      { comment: 'x' },
      owner(),
    );
    expect(asOutsider.statusCode).toBe(404);
    expect((await patch(outsiderIncomeId, 'rl-f1', { comment: 'x' })).statusCode).toBe(404);
    expect((await del(outsiderIncomeId, 'rl-f2')).statusCode).toBe(404);
    expect((await restore(outsiderIncomeId, 'rl-f3')).statusCode).toBe(404);
    expect((await dbTx(outsiderIncomeId)).status).toBe('CONFIRMED');
    expect((await call('DELETE', owner(), `/transactions/${id}`, undefined)).statusCode).toBe(400);

    // EDITOR is a writer but not this income's author: NOT_OPERATION_AUTHOR, not NOT_FOUND.
    const byForeignEditor = await del(id, 'rl-e1', ctx.editor!);
    expect(byForeignEditor.statusCode).toBe(403);
    expect(byForeignEditor.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });

    const byOwner = await del(id, 'rl-e1b');
    expect(byOwner.statusCode).toBe(200);
    expect((await restore(id, 'rl-e3')).statusCode).toBe(200);

    // The author (EDITOR) edits, deletes and restores their own income (same shared budget).
    const createdByEditor = await call(
      'POST',
      ctx.editor!,
      '/transactions',
      `mk-${randomUUID()}`,
      {
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amount: '10.00',
        occurredOn: today,
        accountId: editorAccountId,
        categoryId: incomeCategoryId,
      },
      owner(),
    );
    expect(createdByEditor.statusCode).toBe(201);
    const editorIncomeId = createdByEditor.json<{ id: string }>().id;
    expect((await del(editorIncomeId, 'rl-e4', ctx.editor!)).statusCode).toBe(200);
    expect((await restore(editorIncomeId, 'rl-e5', ctx.editor!)).statusCode).toBe(200);
  });

  it('OpenAPI описывает SOURCE_EXHAUSTED и assignmentIds в ошибке 409', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<
        string,
        Record<string, { responses?: Record<string, { description?: string }> }>
      >;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    }>();
    const item = document.paths['/api/v2/budgets/{budgetId}/transactions/{transactionId}'];
    for (const operation of [item?.patch, item?.delete]) {
      expect(operation?.responses?.['409']?.description ?? '').toContain('SOURCE_EXHAUSTED');
    }
    expect(document.components.schemas['ProblemDetailsResponse']?.properties).toHaveProperty(
      'assignmentIds',
    );
  });
});

async function register(email: string): Promise<User> {
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
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    cookie: match ? decodeURIComponent(match[1]!) : '',
    csrfToken: body.csrfToken,
  };
}

async function createAccount(
  budgetId: string,
  ownerUserId: string,
  startingBalanceMinor: bigint,
): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId,
      name: `Счёт ${randomUUID().slice(0, 8)}`,
      accountType: 'BANK_ACCOUNT',
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor,
      accountingStartDate: d(-90),
    },
  });
  return account.id;
}

async function createCategory(budgetId: string, categoryType: 'INCOME' | 'EXPENSE') {
  const category = await prisma.category.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Категория ${randomUUID().slice(0, 8)}`,
      categoryType,
      displayOrder: 1,
    },
  });
  return category.id;
}

async function createEnvelope(budgetId: string, ownerUserId: string): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId,
      name: `Envelope ${randomUUID().slice(0, 8)}`,
      envelopeType: 'CUSTOM',
      periodSlot: null,
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
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    await prisma.idempotencyRecord.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeMovement.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeAssignment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.incomeAllocation.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transferPart.deleteMany({ where: { transfer: { budget: { workspaceId } } } });
    await prisma.transfer.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.planPayment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.planOccurrence.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.regularPlan.deleteMany({ where: { budget: { workspaceId } } });
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
