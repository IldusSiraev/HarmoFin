import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
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
  owner: `v2-op-owner-${randomUUID()}@harmofin.test`,
  editor: `v2-op-editor-${randomUUID()}@harmofin.test`,
  viewer: `v2-op-viewer-${randomUUID()}@harmofin.test`,
  outsider: `v2-op-outsider-${randomUUID()}@harmofin.test`,
};
const ctx: Partial<Record<keyof typeof emails, User>> = {};
const owner = () => ctx.owner!;

let app: NestFastifyApplication;
let server: FastifyInstance;
let accountId: string;
let expenseCategoryId: string;
let outsiderCategoryId: string;
let mandatoryEnvelopeId: string;

function headers(user: User | undefined, key?: string): Record<string, string> {
  return {
    origin,
    cookie: `harmofin_session=${user?.cookie ?? ''}`,
    'x-csrf-token': user?.csrfToken ?? '',
    ...(key ? { 'idempotency-key': key } : {}),
  };
}
const base = (budgetId = owner().budgetId) => `/api/v2/budgets/${budgetId}/obligations`;
/** Members other than the owner act on the owner's budget. */
const on = (user: User): User => ({ ...user, budgetId: owner().budgetId });
const post = (
  user: User | undefined,
  payload: Record<string, unknown>,
  key: string = randomUUID(),
) =>
  server.inject({
    method: 'POST',
    url: `${base(user?.budgetId)}/plans`,
    headers: headers(user, key),
    payload,
  });
const patch = (
  user: User | undefined,
  planId: string,
  payload: Record<string, unknown>,
  key: string = randomUUID(),
  budgetId = user?.budgetId,
) =>
  server.inject({
    method: 'PATCH',
    url: `${base(budgetId)}/plans/${planId}`,
    headers: headers(user, key),
    payload,
  });
const get = (user: User | undefined, path: string) =>
  server.inject({ method: 'GET', url: `${base(user?.budgetId)}/${path}`, headers: headers(user) });
const planBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: `План ${randomUUID().slice(0, 6)}`,
  amount: '3000.00',
  scheduledOn: iso(1),
  categoryId: expenseCategoryId,
  recurrence: 'MONTHLY',
  ...over,
});
const countOccurrence = (planId: string, scheduledOn: string) =>
  prisma.planOccurrence.count({
    where: {
      budgetId: owner().budgetId,
      planId,
      scheduledOn: new Date(`${scheduledOn}T00:00:00Z`),
    },
  });
async function seedOccurrence(
  planId: string,
  delta: number,
  status: 'PENDING' | 'DUE' | 'COMPLETED',
  amountMinor = 300_000n,
) {
  const id = randomUUID();
  await prisma.planOccurrence.create({
    data: {
      id,
      workspaceId: owner().workspaceId,
      budgetId: owner().budgetId,
      planId,
      scheduledOn: new Date(`${iso(delta)}T00:00:00Z`),
      planName: 'seed',
      planType: 'EXPENSE',
      amountMinor,
      envelopeId: mandatoryEnvelopeId,
      status,
      ...(status === 'COMPLETED' ? { completedAt: d(-1) } : {}),
    },
  });
  return id;
}
const occ = (id: string) => prisma.planOccurrence.findUniqueOrThrow({ where: { id } });

describe('v2 обязательства: управление планами', () => {
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
    expenseCategoryId = await createCategory(b);
    outsiderCategoryId = await createCategory(ctx.outsider!.budgetId);
    mandatoryEnvelopeId = (
      await prisma.envelope.create({
        data: {
          id: randomUUID(),
          budgetId: b,
          name: 'Обязательные',
          envelopeType: 'MANDATORY_EXPENSES',
          startingBalanceMinor: 0n,
          displayOrder: 1,
        },
      })
    ).id;
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

  it('разовая аренда 40000: occurrence создан без worker и оплачивается через O04', async () => {
    const scheduledOn = iso(2);
    const res = await post(
      owner(),
      planBody({ name: 'Аренда', amount: '40000.00', scheduledOn, recurrence: 'ONE_TIME' }),
    );
    expect(res.statusCode).toBe(201);
    const created = res.json<{
      id: string;
      planType: string;
      amountMinor: string;
      envelopeId: string;
      occurrenceId: string;
    }>();
    expect(created.planType).toBe('EXPENSE');
    expect(created.amountMinor).toBe('4000000');
    expect(created.envelopeId).toBe(mandatoryEnvelopeId);
    expect(await countOccurrence(created.id, scheduledOn)).toBe(1);
    const row = await occ(created.occurrenceId);
    expect(row.planId).toBe(created.id);
    expect(row.amountMinor).toBe(4_000_000n);

    const paid = await server.inject({
      method: 'POST',
      url: `${base()}/${created.occurrenceId}/pay`,
      headers: headers(owner(), randomUUID()),
      payload: {
        accountId,
        categoryId: expenseCategoryId,
        amount: '40000.00',
        occurredOn: iso(0),
        willPayMore: false,
      },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json<{ occurrence: { status: string } }>().occurrence.status).toBe('COMPLETED');
  });

  it('ежемесячный детсад 3000: occurrence на дату старта появляется без worker', async () => {
    const scheduledOn = iso(1);
    const res = await post(owner(), planBody({ name: 'Детсад', scheduledOn }));
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; occurrenceId: string }>();
    expect(await countOccurrence(created.id, scheduledOn)).toBe(1);
    expect((await occ(created.occurrenceId)).status).toBe('PENDING');
    const list = await get(owner(), `occurrences?planId=${created.id}`);
    expect(list.statusCode).toBe(200);
    const items = list.json<{
      items: Array<{ id: string; expectedMinor: string; unpaidMinor: string }>;
    }>().items;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]).toMatchObject({ expectedMinor: '300000', unpaidMinor: '300000' });
    const plans = await get(owner(), 'plans');
    expect(plans.statusCode).toBe(200);
    expect(plans.json<{ items: Array<{ id: string }> }>().items.map((p) => p.id)).toContain(
      created.id,
    );
  });

  it('PATCH суммы: будущие меняются, текущая открытая только по подтверждению, оплаченная не переписывается', async () => {
    const created = (
      await post(owner(), planBody({ scheduledOn: iso(-3), amount: '3000.00' }))
    ).json<{ id: string; occurrenceId: string }>();
    const current = created.occurrenceId;
    expect((await occ(current)).status).toBe('DUE');
    const future = await seedOccurrence(created.id, 20, 'PENDING');
    const paidPast = await seedOccurrence(created.id, -40, 'COMPLETED');

    const first = await patch(owner(), created.id, { amount: '3500.00' });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ amountMinor: string }>().amountMinor).toBe('350000');
    expect((await occ(future)).amountMinor).toBe(350_000n);
    expect((await occ(current)).amountMinor).toBe(300_000n);
    expect((await occ(paidPast)).amountMinor).toBe(300_000n);

    const second = await patch(owner(), created.id, {
      amount: '4000.00',
      applyToCurrentOpen: true,
    });
    expect(second.statusCode).toBe(200);
    expect((await occ(current)).amountMinor).toBe(400_000n);
    expect((await occ(future)).amountMinor).toBe(400_000n);
    expect((await occ(paidPast)).amountMinor).toBe(300_000n);
    expect((await occ(paidPast)).status).toBe('COMPLETED');
    const audit = await prisma.auditEvent.count({
      where: { budgetId: owner().budgetId, entityId: current, action: 'EXPECTED_UPDATED' },
    });
    expect(audit).toBe(1);
  });

  it('applyToCurrentOpen без новой суммы отклонён, имя обновляет будущие occurrences', async () => {
    const created = (await post(owner(), planBody({ scheduledOn: iso(-2) }))).json<{
      id: string;
    }>();
    const future = await seedOccurrence(created.id, 15, 'PENDING');
    expect((await patch(owner(), created.id, { applyToCurrentOpen: true })).statusCode).toBe(400);
    expect((await patch(owner(), created.id, {})).statusCode).toBe(400);
    const renamed = await patch(owner(), created.id, { name: 'Новое имя' });
    expect(renamed.statusCode).toBe(200);
    expect((await occ(future)).planName).toBe('Новое имя');
    expect(
      await prisma.auditEvent.count({
        where: {
          budgetId: owner().budgetId,
          entityType: 'regular_plan',
          entityId: created.id,
          action: 'OCCURRENCES_RENAMED',
        },
      }),
    ).toBe(1);
  });

  it('архивирование отключает только будущие неоплаченные, история остаётся', async () => {
    const created = (await post(owner(), planBody({ scheduledOn: iso(-2) }))).json<{
      id: string;
      occurrenceId: string;
    }>();
    const due = created.occurrenceId;
    const future = await seedOccurrence(created.id, 25, 'PENDING');
    const done = await seedOccurrence(created.id, -45, 'COMPLETED');
    const before = await prisma.planOccurrence.count({ where: { planId: created.id } });

    const res = await patch(owner(), created.id, { status: 'ARCHIVED' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('ARCHIVED');
    expect((await occ(future)).status).toBe('CANCELLED');
    expect((await occ(due)).status).toBe('DUE');
    expect((await occ(done)).status).toBe('COMPLETED');
    expect(await prisma.planOccurrence.count({ where: { planId: created.id } })).toBe(before);
    const plan = await prisma.regularPlan.findUniqueOrThrow({ where: { id: created.id } });
    expect(plan.isActive).toBe(false);
    expect(plan.deletedAt).toBeNull();
  });

  it('реактивация возвращает отключённые будущие occurrences, история и оплаченные не меняются', async () => {
    const created = (await post(owner(), planBody({ scheduledOn: iso(-2) }))).json<{
      id: string;
      occurrenceId: string;
    }>();
    const due = created.occurrenceId;
    const future = await seedOccurrence(created.id, 25, 'PENDING');
    const done = await seedOccurrence(created.id, -45, 'COMPLETED');
    expect((await patch(owner(), created.id, { status: 'ARCHIVED' })).statusCode).toBe(200);
    expect((await occ(future)).status).toBe('CANCELLED');
    const total = await prisma.planOccurrence.count({ where: { planId: created.id } });

    const res = await patch(owner(), created.id, { status: 'ACTIVE' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('ACTIVE');
    const restored = await occ(future);
    expect(restored.status).toBe('PENDING');
    expect(restored.cancelledAt).toBeNull();
    expect(restored.cancellationReason).toBeNull();
    expect((await occ(due)).status).toBe('DUE');
    expect((await occ(done)).status).toBe('COMPLETED');
    expect(await prisma.planOccurrence.count({ where: { planId: created.id } })).toBe(total);
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: owner().budgetId, entityId: future, action: 'RESTORED' },
      }),
    ).toBe(1);
  });

  it('401 без сессии, неверный UUID в пути даёт 400', async () => {
    const anon = await server.inject({
      method: 'GET',
      url: `${base()}/plans`,
      headers: { origin },
    });
    expect(anon.statusCode).toBe(401);
    const badPlan = await patch(owner(), 'not-a-uuid', { name: 'X' });
    expect(badPlan.statusCode).toBe(400);
    const badBudget = await server.inject({
      method: 'GET',
      url: '/api/v2/budgets/not-a-uuid/obligations/plans',
      headers: headers(owner()),
    });
    expect(badBudget.statusCode).toBe(400);
  });

  it('роли: EDITOR и VIEWER не управляют планами, VIEWER читает; CSRF и ключ обязательны', async () => {
    const created = (await post(owner(), planBody())).json<{ id: string }>();
    for (const user of [ctx.editor!, ctx.viewer!]) {
      expect((await post(on(user), planBody())).statusCode).toBe(403);
      expect((await patch(on(user), created.id, { name: 'X' })).statusCode).toBe(403);
    }
    expect((await get(on(ctx.viewer!), 'plans')).statusCode).toBe(200);
    expect((await get(on(ctx.viewer!), 'occurrences')).statusCode).toBe(200);
    const badCsrf = await server.inject({
      method: 'POST',
      url: `${base()}/plans`,
      headers: { ...headers(owner(), randomUUID()), 'x-csrf-token': 'bad' },
      payload: planBody(),
    });
    expect(badCsrf.statusCode).toBe(403);
    const noKey = await server.inject({
      method: 'POST',
      url: `${base()}/plans`,
      headers: headers(owner()),
      payload: planBody(),
    });
    expect(noKey.statusCode).toBe(400);
  });

  it('чужой бюджет, категория и план: 404; нет mandatory конверта: 409', async () => {
    const foreignCategory = await post(owner(), planBody({ categoryId: outsiderCategoryId }));
    expect(foreignCategory.statusCode).toBe(404);
    const outsiderOnOwner = await server.inject({
      method: 'POST',
      url: `${base(owner().budgetId)}/plans`,
      headers: headers(ctx.outsider, randomUUID()),
      payload: planBody(),
    });
    expect(outsiderOnOwner.statusCode).toBe(404);
    const ownPlan = (await post(owner(), planBody())).json<{ id: string }>();
    const foreignPlan = await patch(ctx.outsider, ownPlan.id, { name: 'Взлом' });
    expect(foreignPlan.statusCode).toBe(404);
    const noEnvelope = await post(ctx.outsider, planBody({ categoryId: outsiderCategoryId }));
    expect(noEnvelope.statusCode).toBe(409);
    expect(noEnvelope.json<{ code: string }>().code).toBe('MANDATORY_ENVELOPE_REQUIRED');
    expect((await get(ctx.outsider, 'plans')).json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it('валидация: ONE_TIME с интервалом, неверная сумма, неизвестные поля', async () => {
    const bad = (over: Record<string, unknown>) => post(owner(), planBody(over));
    expect((await bad({ recurrence: 'ONE_TIME', intervalMonths: 3 })).statusCode).toBe(400);
    expect((await bad({ recurrence: 'EVERY_N_MONTHS' })).statusCode).toBe(400);
    expect((await bad({ amount: '0' })).statusCode).toBe(400);
    expect((await bad({ amount: '1.234' })).statusCode).toBe(400);
    expect((await bad({ envelopeId: randomUUID() })).statusCode).toBe(400);
    const every = await bad({ recurrence: 'EVERY_N_MONTHS', intervalMonths: 3 });
    expect(every.statusCode).toBe(201);
  });

  it('идемпотентность: повтор возвращает тот же план, другой body даёт конфликт', async () => {
    const key = `plan-idem-${randomUUID()}`;
    const payload = planBody({ name: 'Идемпотентный' });
    const first = await post(owner(), payload, key);
    const replay = await post(owner(), payload, key);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(
      await prisma.regularPlan.count({
        where: { budgetId: owner().budgetId, name: 'Идемпотентный' },
      }),
    ).toBe(1);
    const conflict = await post(owner(), { ...payload, amount: '1.00' }, key);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');

    const planId = first.json<{ id: string }>().id;
    const patchKey = `patch-idem-${randomUUID()}`;
    const a = await patch(owner(), planId, { name: 'Переименован' }, patchKey);
    const b = await patch(owner(), planId, { name: 'Переименован' }, patchKey);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(
      await prisma.auditEvent.count({
        where: { entityId: planId, entityType: 'regular_plan', action: 'UPDATED' },
      }),
    ).toBe(1);
    const patchConflict = await patch(owner(), planId, { name: 'Другое' }, patchKey);
    expect(patchConflict.statusCode).toBe(409);
    expect(patchConflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('аудит создания плана и OpenAPI', async () => {
    const created = (await post(owner(), planBody())).json<{ id: string }>();
    expect(
      await prisma.auditEvent.count({
        where: { entityId: created.id, entityType: 'regular_plan', action: 'CREATED' },
      }),
    ).toBe(1);
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
    const prefix = '/api/v2/budgets/{budgetId}/obligations';
    const ops: Array<[string, string, string]> = [
      [`${prefix}/plans`, 'get', '200'],
      [`${prefix}/plans`, 'post', '201'],
      [`${prefix}/plans/{planId}`, 'patch', '200'],
      [`${prefix}/occurrences`, 'get', '200'],
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

async function createCategory(budgetId: string): Promise<string> {
  const category = await prisma.category.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Категория ${randomUUID().slice(0, 8)}`,
      categoryType: 'EXPENSE',
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
