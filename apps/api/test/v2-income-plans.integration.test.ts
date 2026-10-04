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
const balances = new FinancialBalanceRepository();
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const dayMs = 86_400_000;
const d = (delta: number) => new Date(Date.now() + delta * dayMs);
const iso = (delta: number) => todayInTimezone(d(delta), 'UTC');

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
};
const ctx: Partial<Record<keyof typeof emails, User>> = {};
const owner = () => ctx.owner!;

let app: NestFastifyApplication;
let server: FastifyInstance;
let accountId: string;
let incomeCategoryId: string;
let otherIncomeCategoryId: string;
let expenseCategoryId: string;
let outsiderIncomeCategoryId: string;

function headers(user: User | undefined, key?: string): Record<string, string> {
  return {
    origin,
    cookie: `harmofin_session=${user?.cookie ?? ''}`,
    'x-csrf-token': user?.csrfToken ?? '',
    ...(key ? { 'idempotency-key': key } : {}),
  };
}
const base = (budgetId = owner().budgetId) => `/api/v2/budgets/${budgetId}/income-plans`;
const on = (user: User): User => ({ ...user, budgetId: owner().budgetId });
const post = (
  user: User | undefined,
  payload: Record<string, unknown>,
  key: string = randomUUID(),
) =>
  server.inject({
    method: 'POST',
    url: base(user?.budgetId),
    headers: headers(user, key),
    payload,
  });
const patch = (
  user: User | undefined,
  planId: string,
  payload: Record<string, unknown>,
  key: string = randomUUID(),
) =>
  server.inject({
    method: 'PATCH',
    url: `${base(user?.budgetId)}/${planId}`,
    headers: headers(user, key),
    payload,
  });
const get = (user: User | undefined, path = '') =>
  server.inject({ method: 'GET', url: `${base(user?.budgetId)}${path}`, headers: headers(user) });
const record = (
  user: User | undefined,
  occurrenceId: string,
  payload: Record<string, unknown>,
  key: string = randomUUID(),
) =>
  server.inject({
    method: 'POST',
    url: `${base(user?.budgetId)}/occurrences/${occurrenceId}/record`,
    headers: headers(user, key),
    payload,
  });
const planBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: `Доход ${randomUUID().slice(0, 6)}`,
  amount: '100000.00',
  scheduledOn: iso(1),
  categoryId: incomeCategoryId,
  recurrence: 'MONTHLY',
  ...over,
});
const recordBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  accountId,
  amount: '87000.00',
  occurredOn: iso(0),
  ...over,
});
const cash = (id = accountId) =>
  prisma.$transaction((tx) => balances.accountBalance(tx, owner().budgetId, id));
const occ = (id: string) => prisma.planOccurrence.findUniqueOrThrow({ where: { id } });
const incomeCount = () =>
  prisma.transaction.count({
    where: { budgetId: owner().budgetId, transactionType: 'INCOME', accountingModelVersion: 2 },
  });
const assignmentCount = () =>
  prisma.envelopeAssignment.count({ where: { budgetId: owner().budgetId } });
async function createPlan(over: Record<string, unknown> = {}) {
  const res = await post(owner(), planBody(over));
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string; occurrenceId: string | null; occurrencesCreated: number }>();
}

describe('v2 планы доходов: прогноз без фиктивных денег', () => {
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
    await prisma.envelope.updateMany({
      where: { budgetId: { in: [owner().budgetId, ctx.outsider!.budgetId] } },
      data: { archivedAt: new Date() },
    });
    for (const role of ['editor', 'viewer'] as const) {
      await prisma.workspaceMembership.create({
        data: {
          id: randomUUID(),
          workspaceId: owner().workspaceId,
          userId: ctx[role]!.userId,
          role: role === 'editor' ? 'EDITOR' : 'VIEWER',
        },
      });
    }
    const b = owner().budgetId;
    accountId = (
      await prisma.account.create({
        data: {
          id: randomUUID(),
          budgetId: b,
          name: 'Счёт',
          accountType: 'BANK_ACCOUNT',
          currency: 'RUB',
          scale: 2,
          startingBalanceMinor: 100_000_000n,
          accountingStartDate: d(-90),
        },
      })
    ).id;
    incomeCategoryId = await createCategory(b, 'INCOME');
    otherIncomeCategoryId = await createCategory(b, 'INCOME');
    expenseCategoryId = await createCategory(b, 'EXPENSE');
    outsiderIncomeCategoryId = await createCategory(ctx.outsider!.budgetId, 'INCOME');
  });

  afterAll(async () => {
    for (const u of [ctx.editor, ctx.viewer]) {
      if (u) {
        await prisma.workspaceMembership.deleteMany({
          where: { userId: u.userId, workspaceId: { not: u.workspaceId } },
        });
      }
    }
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await cleanupUser(ctx[key]?.userId ?? '');
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('прогноз 100000 завтра виден среди будущих occurrences, но не меняет деньги и не создаёт операций', async () => {
    const cashBefore = await cash();
    const res = await post(owner(), planBody({ name: 'Зарплата', scheduledOn: iso(1) }));
    expect(res.statusCode).toBe(201);
    const created = res.json<{
      id: string;
      planType: string;
      amountMinor: string;
      categoryId: string;
      occurrenceId: string;
    }>();
    expect(created).toMatchObject({
      planType: 'INCOME',
      amountMinor: '10000000',
      categoryId: incomeCategoryId,
    });
    const list = await get(owner(), `/occurrences?planId=${created.id}`);
    expect(list.statusCode).toBe(200);
    const items = list.json<{
      items: Array<{
        id: string;
        scheduledOn: string;
        status: string;
        expectedMinor: string;
        transactionId: string | null;
      }>;
    }>().items;
    expect(items[0]).toMatchObject({
      id: created.occurrenceId,
      scheduledOn: iso(1),
      status: 'PENDING',
      expectedMinor: '10000000',
      transactionId: null,
    });
    expect(await incomeCount()).toBe(0);
    expect(await assignmentCount()).toBe(0);
    expect(await cash()).toBe(cashBefore);
    expect(
      await prisma.planOccurrence.count({
        where: { budgetId: owner().budgetId, planType: 'INCOME' },
      }),
    ).toBeGreaterThan(0);
  });

  it('«Записать доход» завтрашнего прогноза фактическими 87000 создаёт один факт и закрывает occurrence', async () => {
    const created = await createPlan({ scheduledOn: iso(1), name: 'Зарплата факт' });
    const occurrenceId = created.occurrenceId!;
    const cashBefore = await cash();
    const res = await record(owner(), occurrenceId, recordBody());
    expect(res.statusCode).toBe(201);
    const out = res.json<{
      occurrence: { id: string; status: string; transactionId: string };
      transaction: { id: string; amountMinor: string; categoryId: string; transactionType: string };
    }>();
    expect(out.occurrence).toMatchObject({ id: occurrenceId, status: 'COMPLETED' });
    expect(out.transaction).toMatchObject({
      amountMinor: '8700000',
      categoryId: incomeCategoryId,
      transactionType: 'INCOME',
    });
    expect(out.occurrence.transactionId).toBe(out.transaction.id);
    const row = await occ(occurrenceId);
    expect(row.status).toBe('COMPLETED');
    expect(row.transactionId).toBe(out.transaction.id);
    expect(row.completedAt).not.toBeNull();
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: out.transaction.id } });
    expect(tx).toMatchObject({
      status: 'CONFIRMED',
      transactionType: 'INCOME',
      accountingModelVersion: 2,
      amountMinor: 8_700_000n,
      envelopeId: null,
      accountId,
    });
    expect(await incomeCount()).toBe(1);
    expect(await assignmentCount()).toBe(0);
    expect(await cash()).toBe(cashBefore + 8_700_000n);
    for (const [entityType, entityId] of [
      ['transaction', out.transaction.id],
      ['plan_occurrence', occurrenceId],
    ] as const) {
      expect(
        await prisma.auditEvent.count({
          where: { budgetId: owner().budgetId, entityType, entityId },
        }),
        entityType,
      ).toBeGreaterThanOrEqual(1);
    }
    const listed = await get(owner(), `/occurrences?planId=${created.id}`);
    expect(listed.json<{ items: Array<{ transactionId: string }> }>().items[0]!.transactionId).toBe(
      out.transaction.id,
    );
  });

  it('повторная запись с другим ключом даёт 409 и не создаёт второй доход; тот же ключ повторяет ответ', async () => {
    const created = await createPlan({ scheduledOn: iso(0), name: 'Повтор' });
    const before = await incomeCount();
    const key = `rec-${randomUUID()}`;
    const first = await record(owner(), created.occurrenceId!, recordBody(), key);
    expect(first.statusCode).toBe(201);
    const replay = await record(owner(), created.occurrenceId!, recordBody(), key);
    expect(replay.statusCode).toBe(201);
    expect(replay.json<{ transaction: { id: string } }>().transaction.id).toBe(
      first.json<{ transaction: { id: string } }>().transaction.id,
    );
    const second = await record(owner(), created.occurrenceId!, recordBody());
    expect(second.statusCode).toBe(409);
    expect(second.json<{ code: string }>().code).toBe('OCCURRENCE_NOT_OPEN');
    const conflict = await record(
      owner(),
      created.occurrenceId!,
      recordBody({ amount: '1.00' }),
      key,
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await incomeCount()).toBe(before + 1);
  });

  it('параллельные записи одного occurrence с разными ключами: ровно один успех', async () => {
    const created = await createPlan({ scheduledOn: iso(0), name: 'Гонка' });
    const before = await incomeCount();
    const results = await Promise.all(
      [1, 2, 3].map(() => record(owner(), created.occurrenceId!, recordBody({ amount: '10.00' }))),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    expect(await incomeCount()).toBe(before + 1);
  });

  it('категория факта: по умолчанию категория плана, можно другую доходную; чужая 404, расходная 400', async () => {
    const created = await createPlan({ scheduledOn: iso(0) });
    const bad = [
      [{ categoryId: outsiderIncomeCategoryId }, 404],
      [{ categoryId: expenseCategoryId }, 400],
      [{ categoryId: randomUUID() }, 404],
      [{ accountId: randomUUID() }, 404],
      [{ occurredOn: iso(3) }, 400],
      [{ amount: '0' }, 400],
      [{ amount: '1.234' }, 400],
      [{ extra: 1 }, 400],
    ] as const;
    const before = await incomeCount();
    for (const [over, status] of bad) {
      const res = await record(owner(), created.occurrenceId!, recordBody(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(status);
    }
    expect(await incomeCount()).toBe(before);
    expect((await occ(created.occurrenceId!)).status).not.toBe('COMPLETED');
    expect((await occ(created.occurrenceId!)).transactionId).toBeNull();

    const ok = await record(
      owner(),
      created.occurrenceId!,
      recordBody({ categoryId: otherIncomeCategoryId }),
    );
    expect(ok.statusCode).toBe(201);
    expect(ok.json<{ transaction: { categoryId: string } }>().transaction.categoryId).toBe(
      otherIncomeCategoryId,
    );
  });

  it('создание плана: чужая категория 404, расходная категория 400, архивная категория 404', async () => {
    expect(
      (await post(owner(), planBody({ categoryId: outsiderIncomeCategoryId }))).statusCode,
    ).toBe(404);
    expect((await post(owner(), planBody({ categoryId: expenseCategoryId }))).statusCode).toBe(400);
    const archived = await createCategory(owner().budgetId, 'INCOME');
    await prisma.category.update({ where: { id: archived }, data: { archivedAt: new Date() } });
    expect((await post(owner(), planBody({ categoryId: archived }))).statusCode).toBe(404);
  });

  it('recurrence: ONE_TIME, MONTHLY, EVERY_N_MONTHS, YEARLY принимаются; невалидные 400', async () => {
    for (const over of [
      { recurrence: 'ONE_TIME' },
      { recurrence: 'MONTHLY' },
      { recurrence: 'EVERY_N_MONTHS', intervalMonths: 3 },
      { recurrence: 'YEARLY' },
    ]) {
      const res = await post(owner(), planBody(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(201);
      expect(res.json<{ recurrence: string }>().recurrence).toBe(over.recurrence);
    }
    for (const over of [
      { recurrence: 'ONE_TIME', intervalMonths: 3 },
      { recurrence: 'EVERY_N_MONTHS' },
      { recurrence: 'WEEKLY' },
      { amount: '0' },
      { amount: '1.234' },
      { envelopeId: randomUUID() },
    ]) {
      expect((await post(owner(), planBody(over))).statusCode, JSON.stringify(over)).toBe(400);
    }
  });

  it('ежемесячный план материализует occurrences текущего и следующего периода без worker', async () => {
    const created = await createPlan({ scheduledOn: iso(-3), recurrence: 'MONTHLY' });
    expect(created.occurrencesCreated).toBeGreaterThanOrEqual(1);
    expect((await occ(created.occurrenceId!)).status).toBe('DUE');
    expect(
      await prisma.transaction.count({
        where: { budgetId: owner().budgetId, transactionType: 'INCOME' },
      }),
    ).toBe(await incomeCount());
  });

  it('ежемесячный доход с датой через 45 дней (дальше следующего периода): occurrence виден сразу, без worker', async () => {
    const created = await createPlan({ scheduledOn: iso(45), recurrence: 'MONTHLY' });
    expect(created.occurrenceId).not.toBeNull();
    expect((await occ(created.occurrenceId!)).status).toBe('PENDING');
  });

  it('SAVINGS планы материализатор не трогает', async () => {
    const savings = randomUUID();
    await prisma.regularPlan.create({
      data: {
        id: savings,
        workspaceId: owner().workspaceId,
        budgetId: owner().budgetId,
        name: 'Накопления',
        planType: 'SAVINGS',
        amountMinor: 100_000n,
        anchorOn: new Date(`${iso(1)}T00:00:00Z`),
        startOn: new Date(`${iso(1)}T00:00:00Z`),
        recurrence: 'MONTHLY',
        categoryId: incomeCategoryId,
        createdByUserId: owner().userId,
        updatedByUserId: owner().userId,
      },
    });
    await createPlan({ scheduledOn: iso(1) });
    expect(await prisma.planOccurrence.count({ where: { planId: savings } })).toBe(0);
    const listed = await get(owner(), '');
    expect(listed.json<{ items: Array<{ id: string }> }>().items.map((p) => p.id)).not.toContain(
      savings,
    );
  });

  it('PATCH: сумма меняет будущие, архивирование отключает будущие, проведённый факт остаётся', async () => {
    const created = await createPlan({ scheduledOn: iso(1), amount: '100000.00' });
    const res = await patch(owner(), created.id, { amount: '90000.00', name: 'Новое имя' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ amountMinor: string; name: string }>()).toMatchObject({
      amountMinor: '9000000',
      name: 'Новое имя',
    });
    expect((await occ(created.occurrenceId!)).amountMinor).toBe(9_000_000n);
    const archived = await patch(owner(), created.id, { status: 'ARCHIVED' });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<{ status: string }>().status).toBe('ARCHIVED');
    expect((await occ(created.occurrenceId!)).status).toBe('CANCELLED');
    const blocked = await record(owner(), created.occurrenceId!, recordBody());
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ code: string }>().code).toBe('OCCURRENCE_NOT_OPEN');
    const restored = await patch(owner(), created.id, { status: 'ACTIVE' });
    expect(restored.statusCode).toBe(200);
    expect((await occ(created.occurrenceId!)).status).toBe('PENDING');

    const done = await createPlan({ scheduledOn: iso(0) });
    expect((await record(owner(), done.occurrenceId!, recordBody())).statusCode).toBe(201);
    expect(
      (await patch(owner(), done.id, { amount: '1.00', applyToCurrentOpen: true })).statusCode,
    ).toBe(200);
    expect((await occ(done.occurrenceId!)).status).toBe('COMPLETED');
    expect((await occ(done.occurrenceId!)).amountMinor).toBe(10_000_000n);
    expect((await patch(owner(), done.id, {})).statusCode).toBe(400);
  });

  it('PATCH расходного плана через income-plans: 404; доходные планы не видны в obligations', async () => {
    const expensePlan = randomUUID();
    await prisma.regularPlan.create({
      data: {
        id: expensePlan,
        workspaceId: owner().workspaceId,
        budgetId: owner().budgetId,
        name: 'Расход',
        planType: 'EXPENSE',
        amountMinor: 100n,
        anchorOn: new Date(`${iso(1)}T00:00:00Z`),
        startOn: new Date(`${iso(1)}T00:00:00Z`),
        recurrence: 'MONTHLY',
        createdByUserId: owner().userId,
        updatedByUserId: owner().userId,
      },
    });
    expect((await patch(owner(), expensePlan, { name: 'X' })).statusCode).toBe(404);
    const income = await createPlan();
    const obligations = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${owner().budgetId}/obligations/plans?status=all`,
      headers: headers(owner()),
    });
    expect(
      obligations.json<{ items: Array<{ id: string }> }>().items.map((p) => p.id),
    ).not.toContain(income.id);
  });

  it('роли: создание и PATCH только OWNER, record OWNER и EDITOR, VIEWER читает', async () => {
    const created = await createPlan({ scheduledOn: iso(0) });
    for (const user of [ctx.editor!, ctx.viewer!]) {
      expect((await post(on(user), planBody())).statusCode).toBe(403);
      expect((await patch(on(user), created.id, { name: 'X' })).statusCode).toBe(403);
    }
    expect((await get(on(ctx.viewer!))).statusCode).toBe(200);
    expect((await get(on(ctx.viewer!), '/occurrences')).statusCode).toBe(200);
    const before = await incomeCount();
    expect((await record(on(ctx.viewer!), created.occurrenceId!, recordBody())).statusCode).toBe(
      403,
    );
    expect(await incomeCount()).toBe(before);
    expect((await record(on(ctx.editor!), created.occurrenceId!, recordBody())).statusCode).toBe(
      201,
    );
  });

  it('401, 400 UUID, CSRF, ключ и изоляция бюджетов', async () => {
    const created = await createPlan({ scheduledOn: iso(0) });
    expect(
      (await server.inject({ method: 'GET', url: base(), headers: { origin } })).statusCode,
    ).toBe(401);
    expect((await patch(owner(), 'not-a-uuid', { name: 'X' })).statusCode).toBe(400);
    expect((await record(owner(), 'not-a-uuid', recordBody())).statusCode).toBe(400);
    const badCsrf = await server.inject({
      method: 'POST',
      url: base(),
      headers: { ...headers(owner(), randomUUID()), 'x-csrf-token': 'bad' },
      payload: planBody(),
    });
    expect(badCsrf.statusCode).toBe(403);
    const noKey = await server.inject({
      method: 'POST',
      url: base(),
      headers: headers(owner()),
      payload: planBody(),
    });
    expect(noKey.statusCode).toBe(400);
    const noKeyRecord = await server.inject({
      method: 'POST',
      url: `${base()}/occurrences/${created.occurrenceId}/record`,
      headers: headers(owner()),
      payload: recordBody(),
    });
    expect(noKeyRecord.statusCode).toBe(400);

    const outsiderOnOwner = await server.inject({
      method: 'POST',
      url: `${base(owner().budgetId)}/occurrences/${created.occurrenceId}/record`,
      headers: headers(ctx.outsider, randomUUID()),
      payload: recordBody(),
    });
    expect(outsiderOnOwner.statusCode).toBe(404);
    // Own budget, foreign occurrence id: not found, nothing recorded.
    const outsiderAccount = (
      await prisma.account.create({
        data: {
          id: randomUUID(),
          budgetId: ctx.outsider!.budgetId,
          name: 'Свой',
          accountType: 'BANK_ACCOUNT',
          currency: 'RUB',
          scale: 2,
          startingBalanceMinor: 100_000n,
          accountingStartDate: d(-90),
        },
      })
    ).id;
    const foreignOcc = await record(
      ctx.outsider,
      created.occurrenceId!,
      recordBody({ accountId: outsiderAccount }),
    );
    expect(foreignOcc.statusCode).toBe(404);
    expect((await occ(created.occurrenceId!)).status).not.toBe('COMPLETED');
    expect((await patch(ctx.outsider, created.id, { name: 'Взлом' })).statusCode).toBe(404);
    expect((await get(ctx.outsider)).json<{ items: unknown[] }>().items).toHaveLength(0);
    const foreignAccount = await record(
      owner(),
      created.occurrenceId!,
      recordBody({ accountId: outsiderAccount }),
    );
    expect(foreignAccount.statusCode).toBe(404);
  });

  it('идемпотентность создания плана и аудит', async () => {
    const key = `inc-plan-${randomUUID()}`;
    const payload = planBody({ name: 'Идемпотентный доход' });
    const first = await post(owner(), payload, key);
    const replay = await post(owner(), payload, key);
    expect(first.statusCode).toBe(201);
    expect(replay.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(
      await prisma.regularPlan.count({
        where: { budgetId: owner().budgetId, name: 'Идемпотентный доход' },
      }),
    ).toBe(1);
    const conflict = await post(owner(), { ...payload, amount: '1.00' }, key);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      await prisma.auditEvent.count({
        where: {
          entityId: first.json<{ id: string }>().id,
          entityType: 'regular_plan',
          action: 'CREATED',
        },
      }),
    ).toBe(1);
  });

  it('OpenAPI описывает income-plans', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = res.json<{
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
    const prefix = '/api/v2/budgets/{budgetId}/income-plans';
    const ops: Array<[string, string, string]> = [
      [prefix, 'get', '200'],
      [prefix, 'post', '201'],
      [`${prefix}/{planId}`, 'patch', '200'],
      [`${prefix}/occurrences`, 'get', '200'],
      [`${prefix}/occurrences/{occurrenceId}/record`, 'post', '201'],
    ];
    for (const [path, method, success] of ops) {
      const op = document.paths[path]?.[method];
      expect(op, `${method} ${path}`).toBeDefined();
      for (const code of [success, '400', '401', '403', '404', '409', '422']) {
        expect(op?.responses?.[code], `${method} ${path} ${code}`).toBeDefined();
      }
      expect(op?.security).toEqual([{ session: [] }]);
      if (method !== 'get') {
        expect(op?.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'Idempotency-Key', required: true }),
          ]),
        );
      }
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

async function createCategory(
  budgetId: string,
  categoryType: 'INCOME' | 'EXPENSE',
): Promise<string> {
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
