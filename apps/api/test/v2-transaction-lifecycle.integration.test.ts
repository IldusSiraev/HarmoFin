import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { FinancialBalanceRepository } from '../src/common/finance/financial-balance.repository.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { AssignmentBalanceRepository } from '../src/envelope-plans/assignment-balance.repository.js';

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
  owner: `v2-lc-owner-${randomUUID()}@harmofin.test`,
  editor: `v2-lc-editor-${randomUUID()}@harmofin.test`,
  viewer: `v2-lc-viewer-${randomUUID()}@harmofin.test`,
  outsider: `v2-lc-outsider-${randomUUID()}@harmofin.test`,
};
const ctx: Partial<Record<keyof typeof emails, User>> = {};

let app: NestFastifyApplication;
let server: FastifyInstance;
const balances = new FinancialBalanceRepository();
const assignmentBalances = new AssignmentBalanceRepository();

let accountId: string;
let smallAccountId: string;
let otherAccountId: string;
let editorAccountId: string;
let expenseCategoryId: string;
let incomeCategoryId: string;
let mandatoryEnvelopeId: string;
let customEnvelopeId: string;
let outsiderTransactionId: string;

const today = todayInTimezone(new Date(), 'UTC');
const tomorrow = todayInTimezone(new Date(Date.now() + dayMs), 'UTC');
const owner = () => ctx.owner!;
const base = (user: User = owner()) => `/api/v2/budgets/${user.budgetId}`;

const cash = (id: string) =>
  prisma.$transaction((tx) => balances.accountBalance(tx, owner().budgetId, id));
const envelopeBalance = async (envelopeId: string) =>
  (
    await prisma.$transaction((tx) =>
      assignmentBalances.balance(tx, owner().budgetId, envelopeId, null, new Date()),
    )
  ).balance;

function headers(user: User | undefined, key?: string): Record<string, string> {
  return {
    origin,
    cookie: `harmofin_session=${user?.cookie ?? ''}`,
    'x-csrf-token': user?.csrfToken ?? '',
    ...(key ? { 'idempotency-key': key } : {}),
  };
}
type Res = { statusCode: number; json<T = Record<string, unknown> & { code?: string }>(): T };
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
    url: `${base(budgetUser)}${path}`,
    headers: headers(user, key),
    ...(payload ? { payload } : {}),
  }) as unknown as Promise<Res>;
const patch = (id: string, key: string, payload: Record<string, unknown>, user = owner()) =>
  call('PATCH', user, `/transactions/${id}`, key, payload);
const del = (id: string, key: string, user = owner()) =>
  call('DELETE', user, `/transactions/${id}`, key);
const restore = (id: string, key: string, user = owner()) =>
  call('POST', user, `/transactions/${id}/restore`, key, {});

async function expense(
  amount: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; accountBalanceMinor: string }> {
  const res = await call('POST', owner(), '/transactions', `mk-${randomUUID()}`, {
    transactionType: 'EXPENSE',
    status: 'CONFIRMED',
    amount,
    occurredOn: today,
    accountId,
    categoryId: expenseCategoryId,
    envelopeId: customEnvelopeId,
    ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function occurrence(amountMinor: bigint): Promise<string> {
  const planId = randomUUID();
  await prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: owner().workspaceId,
      budgetId: owner().budgetId,
      ownerUserId: owner().userId,
      name: `План ${planId.slice(0, 6)}`,
      planType: 'EXPENSE',
      amountMinor,
      anchorOn: d(-5),
      startOn: d(-5),
      recurrence: 'ONE_TIME',
      envelopeId: mandatoryEnvelopeId,
      isActive: true,
      createdByUserId: owner().userId,
      updatedByUserId: owner().userId,
    },
  });
  const id = randomUUID();
  await prisma.planOccurrence.create({
    data: {
      id,
      workspaceId: owner().workspaceId,
      budgetId: owner().budgetId,
      planId,
      scheduledOn: d(-1),
      planName: 'План',
      planType: 'EXPENSE',
      amountMinor,
      envelopeId: mandatoryEnvelopeId,
      status: 'DUE',
    },
  });
  return id;
}
async function payOccurrence(
  occurrenceId: string,
  amount: string,
  willPayMore: boolean,
): Promise<string> {
  const res = await call(
    'POST',
    owner(),
    `/obligations/${occurrenceId}/pay`,
    `pay-${randomUUID()}`,
    {
      accountId,
      categoryId: expenseCategoryId,
      amount,
      occurredOn: today,
      willPayMore,
    },
  );
  expect(res.statusCode).toBeLessThan(300);
  return res.json<{ transaction: { id: string } }>().transaction.id;
}
const occStatus = async (id: string) =>
  (await prisma.planOccurrence.findUniqueOrThrow({ where: { id } })).status;
const dbTx = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id } });

describe('v2 расход: изменение, удаление и восстановление', () => {
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
      where: { id: { in: [owner().budgetId, ctx.outsider!.budgetId] } },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });
    await prisma.budget.update({
      where: { id: owner().budgetId },
      data: { allowNegativeBalance: false },
    });
    for (const [user, role] of [
      [ctx.editor!, 'EDITOR'],
      [ctx.viewer!, 'VIEWER'],
    ] as const) {
      await prisma.workspaceMembership.create({
        data: {
          id: randomUUID(),
          workspaceId: owner().workspaceId,
          userId: user.userId,
          role,
        },
      });
    }
    const b = owner().budgetId;
    accountId = await createAccount(b, owner().userId, 100_000_000n);
    smallAccountId = await createAccount(b, owner().userId, 10_000n);
    otherAccountId = await createAccount(b, owner().userId, 100_000_000n);
    editorAccountId = await createAccount(b, ctx.editor!.userId, 100_000_000n);
    expenseCategoryId = await createCategory(b, 'EXPENSE');
    incomeCategoryId = await createCategory(b, 'INCOME');
    mandatoryEnvelopeId = await createEnvelope(b, owner().userId, 'MANDATORY_EXPENSES');
    customEnvelopeId = await createEnvelope(b, owner().userId, 'CUSTOM');
    await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: b,
        envelopeId: customEnvelopeId,
        type: 'FREE',
        amountMinor: 50_000_000n,
        effectiveOn: d(-30),
        status: 'CONFIRMED',
        createdByUserId: owner().userId,
      },
    });
    const outsiderAccount = await createAccount(
      ctx.outsider!.budgetId,
      ctx.outsider!.userId,
      100_000_000n,
    );
    const outsiderCategory = await createCategory(ctx.outsider!.budgetId, 'EXPENSE');
    const foreign = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        transactionType: 'EXPENSE',
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
    outsiderTransactionId = foreign.id;
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

  it('удаление возвращает сумму счёту и назначению; повторное восстановление снова вычитает', async () => {
    const expenseMinor = 12_000n;
    const created = await expense('120.00');
    const beforeDelete = {
      accountCash: await cash(accountId),
      assignmentBalance: await envelopeBalance(customEnvelopeId),
    };
    const deleted = await del(created.id, 'del-1');
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ id: created.id, status: 'DELETED' });
    const afterDelete = {
      accountCash: await cash(accountId),
      assignmentBalance: await envelopeBalance(customEnvelopeId),
    };
    expect(afterDelete.assignmentBalance).toBe(beforeDelete.assignmentBalance + expenseMinor);
    expect(afterDelete.accountCash).toBe(beforeDelete.accountCash + expenseMinor);
    const row = await dbTx(created.id);
    expect(row.status).toBe('DELETED');
    expect(row.deletedAt).not.toBeNull();
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: owner().budgetId, entityId: created.id, action: 'DELETED' },
      }),
    ).toBe(1);

    const restored = await restore(created.id, 'res-1');
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ id: created.id, status: 'CONFIRMED' });
    expect(await cash(accountId)).toBe(beforeDelete.accountCash);
    expect(await envelopeBalance(customEnvelopeId)).toBe(beforeDelete.assignmentBalance);
    expect((await dbTx(created.id)).deletedAt).toBeNull();
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: owner().budgetId, entityId: created.id, action: 'RESTORED' },
      }),
    ).toBe(1);
  });

  it('restore заново проверяет остаток счёта: 409 INSUFFICIENT_BALANCE, запись остаётся DELETED', async () => {
    const first = await expense('80.00', { accountId: smallAccountId });
    expect((await del(first.id, 'cap-del')).statusCode).toBe(200);
    await expense('60.00', { accountId: smallAccountId });
    const cashBefore = await cash(smallAccountId);
    const res = await restore(first.id, 'cap-res');
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INSUFFICIENT_BALANCE');
    expect((await dbTx(first.id)).status).toBe('DELETED');
    expect(await cash(smallAccountId)).toBe(cashBefore);
  });

  it('restore: архивная категория отвергается, запись остаётся DELETED', async () => {
    const category = await createCategory(owner().budgetId, 'EXPENSE');
    const created = await expense('10.00', { categoryId: category });
    expect((await del(created.id, 'arc-del')).statusCode).toBe(200);
    await prisma.category.update({ where: { id: category }, data: { archivedAt: new Date() } });
    const res = await restore(created.id, 'arc-res');
    expect(res.statusCode).toBe(404);
    expect((await dbTx(created.id)).status).toBe('DELETED');
  });

  it('единственная связанная оплата удалена: occurrence переоткрыт, возврат конверта, restore возвращает COMPLETED', async () => {
    const occId = await occurrence(10_000n);
    const envBefore = await envelopeBalance(mandatoryEnvelopeId);
    const cashBefore = await cash(accountId);
    const txId = await payOccurrence(occId, '100.00', false);
    expect(await occStatus(occId)).toBe('COMPLETED');

    const deleted = await del(txId, 'lnk-del');
    expect(deleted.statusCode).toBe(200);
    expect(await occStatus(occId)).toBe('DUE');
    const reopened = await prisma.planOccurrence.findUniqueOrThrow({ where: { id: occId } });
    expect(reopened.completedAt).toBeNull();
    expect(await cash(accountId)).toBe(cashBefore);
    expect(await envelopeBalance(mandatoryEnvelopeId)).toBe(envBefore);
    expect(await prisma.planPayment.count({ where: { occurrenceId: occId } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: owner().budgetId, entityId: occId, entityType: 'plan_occurrence' },
      }),
    ).toBe(2);

    const restored = await restore(txId, 'lnk-res');
    expect(restored.statusCode).toBe(200);
    expect(await prisma.planPayment.count({ where: { occurrenceId: occId } })).toBe(1);
    expect(await occStatus(occId)).toBe('COMPLETED');
    expect(await cash(accountId)).toBe(cashBefore - 10_000n);
    expect(await envelopeBalance(mandatoryEnvelopeId)).toBe(envBefore - 10_000n);
  });

  it('удалена одна из двух оплат: оставшаяся действует, статус остаётся; недобор после restore не закрывает', async () => {
    const occId = await occurrence(100_000n);
    const first = await payOccurrence(occId, '400.00', true);
    const second = await payOccurrence(occId, '600.00', true);
    expect(await occStatus(occId)).toBe('COMPLETED');
    expect((await del(second, 'two-del')).statusCode).toBe(200);
    expect(await occStatus(occId)).toBe('COMPLETED');
    expect((await del(first, 'two-del-2')).statusCode).toBe(200);
    expect(await occStatus(occId)).toBe('DUE');
    expect((await restore(first, 'two-res')).statusCode).toBe(200);
    expect(await occStatus(occId)).toBe('DUE');
    expect(await prisma.planPayment.count({ where: { occurrenceId: occId } })).toBe(2);
  });

  it('restore связанной оплаты у пропущенного occurrence - 409 OCCURRENCE_NOT_OPEN', async () => {
    const occId = await occurrence(10_000n);
    const txId = await payOccurrence(occId, '100.00', false);
    expect((await del(txId, 'sk-del')).statusCode).toBe(200);
    const skip = await call('POST', owner(), `/obligations/${occId}/skip`, 'sk-skip', {});
    expect(skip.statusCode).toBe(200);
    const res = await restore(txId, 'sk-res');
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OCCURRENCE_NOT_OPEN');
    expect((await dbTx(txId)).status).toBe('DELETED');
  });

  it('PATCH суммы меняет счёт и конверт один раз; повтор с тем же ключом не двоит', async () => {
    const created = await expense('50.00');
    const cashBefore = await cash(accountId);
    const envBefore = await envelopeBalance(customEnvelopeId);
    const res = await patch(created.id, 'pa-1', { amount: '70.00', comment: 'правка' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ amountMinor: '7000', comment: 'правка' });
    expect(await cash(accountId)).toBe(cashBefore - 2_000n);
    expect(await envelopeBalance(customEnvelopeId)).toBe(envBefore - 2_000n);
    const replay = await patch(created.id, 'pa-1', { amount: '70.00', comment: 'правка' });
    expect(replay.statusCode).toBe(200);
    expect(await cash(accountId)).toBe(cashBefore - 2_000n);
    const conflict = await patch(created.id, 'pa-1', { amount: '71.00', comment: 'правка' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: owner().budgetId, entityId: created.id, action: 'UPDATED' },
      }),
    ).toBe(1);
  });

  it('PATCH: смена счёта переносит движение денег; недостаток на новом счёте 409; будущая дата 400', async () => {
    const created = await expense('50.00');
    const aBefore = await cash(accountId);
    const bBefore = await cash(otherAccountId);
    expect((await patch(created.id, 'mv-1', { accountId: otherAccountId })).statusCode).toBe(200);
    expect(await cash(accountId)).toBe(aBefore + 5_000n);
    expect(await cash(otherAccountId)).toBe(bBefore - 5_000n);
    const tooMuch = await patch(created.id, 'mv-2', { amount: '9999999.00' });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().code).toBe('INSUFFICIENT_BALANCE');
    const future = await patch(created.id, 'mv-3', { occurredOn: tomorrow });
    expect(future.statusCode).toBe(400);
    expect(await cash(otherAccountId)).toBe(bBefore - 5_000n);
  });

  it('PATCH: обязательный конверт нельзя покинуть и нельзя выбрать для обычного расхода', async () => {
    const occId = await occurrence(10_000n);
    const linked = await payOccurrence(occId, '100.00', true);
    const away = await patch(linked, 'man-1', { envelopeId: customEnvelopeId });
    expect(away.statusCode).toBe(409);
    expect(away.json().code).toBe('MANDATORY_PAYMENT_REQUIRED');
    const clear = await patch(linked, 'man-2', { envelopeId: null });
    expect(clear.statusCode).toBe(409);
    expect(clear.json().code).toBe('MANDATORY_PAYMENT_REQUIRED');

    const ordinary = await expense('10.00');
    const into = await patch(ordinary.id, 'man-3', { envelopeId: mandatoryEnvelopeId });
    expect(into.statusCode).toBe(409);
    expect(into.json().code).toBe('MANDATORY_PAYMENT_REQUIRED');
    expect((await dbTx(ordinary.id)).envelopeId).toBe(customEnvelopeId);

    const amountOnly = await patch(linked, 'man-4', { amount: '90.00' });
    expect(amountOnly.statusCode).toBe(200);
    expect((await dbTx(linked)).envelopeId).toBe(mandatoryEnvelopeId);
  });

  it('PATCH единственной связанной оплаты не оставляет COMPLETED без факта (сумма остаётся фактом)', async () => {
    const occId = await occurrence(10_000n);
    const linked = await payOccurrence(occId, '100.00', false);
    expect((await patch(linked, 'lp-1', { amount: '30.00' })).statusCode).toBe(200);
    expect(await occStatus(occId)).toBe('COMPLETED');
    expect(await prisma.planPayment.count({ where: { occurrenceId: occId } })).toBe(1);
  });

  it('доход без назначений изменяется и удаляется (полный сценарий - v2-income-lifecycle)', async () => {
    const income = await call('POST', owner(), '/transactions', 'inc-mk', {
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      amount: '10.00',
      occurredOn: today,
      accountId,
      categoryId: incomeCategoryId,
    });
    expect(income.statusCode).toBe(201);
    const id = income.json<{ id: string }>().id;
    expect((await patch(id, 'inc-1', { amount: '5.00' })).statusCode).toBe(200);
    expect((await del(id, 'inc-2')).statusCode).toBe(200);
  });

  it('идемпотентность DELETE/restore: повтор без повторного эффекта, другая цель с тем же ключом - конфликт', async () => {
    const a = await expense('10.00');
    const b = await expense('10.00');
    const cashStart = await cash(accountId);
    expect((await del(a.id, 'idem-d')).statusCode).toBe(200);
    expect((await del(a.id, 'idem-d')).statusCode).toBe(200);
    expect(await cash(accountId)).toBe(cashStart + 1_000n);
    const conflict = await del(b.id, 'idem-d');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await restore(a.id, 'idem-r')).statusCode).toBe(200);
    expect((await restore(a.id, 'idem-r')).statusCode).toBe(200);
    expect(await cash(accountId)).toBe(cashStart);
    const again = await del(a.id, 'idem-d2');
    expect(again.statusCode).toBe(200);
    const twice = await del(a.id, 'idem-d3');
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe('TRANSACTION_ALREADY_DELETED');
    const notDeleted = await restore(b.id, 'idem-r2');
    expect(notDeleted.statusCode).toBe(409);
    expect(notDeleted.json().code).toBe('TRANSACTION_NOT_DELETED');
  });

  it('роли и изоляция: EDITOR может, VIEWER 403, посторонний 404, чужая операция 404, нет ключа 400', async () => {
    const created = await expense('10.00');
    expect((await patch(created.id, 'rl-v1', { comment: 'x' }, ctx.viewer!)).statusCode).toBe(403);
    expect((await del(created.id, 'rl-v2', ctx.viewer!)).statusCode).toBe(403);
    expect((await restore(created.id, 'rl-v3', ctx.viewer!)).statusCode).toBe(403);
    expect((await patch(created.id, 'rl-o1', { comment: 'x' }, ctx.outsider!)).statusCode).toBe(
      404,
    );
    expect((await patch(outsiderTransactionId, 'rl-f1', { comment: 'x' })).statusCode).toBe(404);
    expect((await del(outsiderTransactionId, 'rl-f2')).statusCode).toBe(404);
    expect((await restore(outsiderTransactionId, 'rl-f3')).statusCode).toBe(404);
    expect((await dbTx(outsiderTransactionId)).status).toBe('CONFIRMED');
    const noKey = await call('DELETE', owner(), `/transactions/${created.id}`, undefined);
    expect(noKey.statusCode).toBe(400);

    // EDITOR is a writer but not this expense's author (owner is): NOT_OPERATION_AUTHOR.
    const byForeignEditor = await del(created.id, 'rl-e1', ctx.editor!);
    expect(byForeignEditor.statusCode).toBe(403);
    expect(byForeignEditor.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });
    expect((await dbTx(created.id)).status).toBe('CONFIRMED');

    // The author (EDITOR) edits, deletes and restores their own expense.
    const ownExpense = await call('POST', ctx.editor!, '/transactions', `mk-${randomUUID()}`, {
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amount: '10.00',
      occurredOn: today,
      accountId: editorAccountId,
      categoryId: expenseCategoryId,
      envelopeId: null,
    });
    expect(ownExpense.statusCode).toBe(201);
    const ownId = ownExpense.json<{ id: string }>().id;
    expect((await del(ownId, 'rl-e2', ctx.editor!)).statusCode).toBe(200);
    expect((await restore(ownId, 'rl-e3', ctx.editor!)).statusCode).toBe(200);
    expect((await dbTx(ownId)).status).toBe('CONFIRMED');
  });

  it('OpenAPI описывает PATCH, DELETE и restore: коды, Idempotency-Key, cookie', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<
        string,
        Record<
          string,
          {
            parameters?: Array<{ name: string; required?: boolean }>;
            responses?: Record<string, unknown>;
            security?: Array<Record<string, unknown>>;
          }
        >
      >;
    }>();
    const item = document.paths['/api/v2/budgets/{budgetId}/transactions/{transactionId}'];
    const restoreOp =
      document.paths['/api/v2/budgets/{budgetId}/transactions/{transactionId}/restore']?.post;
    for (const operation of [item?.patch, item?.delete, restoreOp]) {
      expect(operation).toBeDefined();
      for (const status of ['200', '400', '401', '403', '404', '409']) {
        expect(operation?.responses?.[status]).toBeDefined();
      }
      expect(operation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        ]),
      );
      expect(operation?.security).toEqual([{ session: [] }]);
    }
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

async function createEnvelope(
  budgetId: string,
  ownerUserId: string,
  envelopeType: 'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'CUSTOM',
): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId,
      name: `Envelope ${randomUUID().slice(0, 8)}`,
      envelopeType,
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
