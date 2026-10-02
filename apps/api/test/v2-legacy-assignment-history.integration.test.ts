import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { FinancialBalanceRepository } from '../src/common/finance/financial-balance.repository.js';
import { cycleAndPeriodFor, todayInTimezone } from '../src/cycles/cycle-period.domain.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = todayInTimezone(new Date(), 'UTC');
const SETTINGS = { cycleStartDay: 1, periodBoundaryOffset: 14, timezone: 'UTC' };
const PERIOD = cycleAndPeriodFor(SETTINGS, TODAY).period;

type User = { userId: string; workspaceId: string; budgetId: string; cookie: string; csrf: string };
type World = User & {
  accountId: string;
  incomeCategoryId: string;
  expenseCategoryId: string;
  mainEnvelopeId: string;
  customEnvelopeId: string;
  archivedEnvelopeId: string;
  incomeId: string;
  expenseId: string;
  ids: { allocations: string[]; reallocations: string[]; starts: string[] };
};
type Item = {
  sourceKind: 'LEGACY_ALLOCATION' | 'LEGACY_REALLOCATION' | 'LEGACY_ENVELOPE_START';
  id: string;
  occurredOn: string;
  amountMinor: string;
  status: string;
  isDeleted: boolean;
  isEnvelopeArchived: boolean;
  envelopeId: string | null;
  sourceEnvelopeId: string | null;
  destinationEnvelopeId: string | null;
  incomeTransactionId: string | null;
  categoryId: string | null;
  accountId: string | null;
};
type Page = { items: Item[]; nextCursor: string | null; hasMore: boolean };
type Operation = {
  responses: Record<string, { description?: string; content?: Record<string, unknown> }>;
  parameters?: Array<{ name: string; in: string }>;
};
type Res = { statusCode: number; json<T = Record<string, unknown>>(): T };

let app: NestFastifyApplication;
let server: FastifyInstance;
const balances = new FinancialBalanceRepository();
const createdUsers: string[] = [];

const get = (w: User, query = '', as: User = w): Promise<Res> =>
  server.inject({
    method: 'GET',
    url: `/api/v2/budgets/${w.budgetId}/history/legacy-assignments${query}`,
    headers: { origin, cookie: `harmofin_session=${as.cookie}` },
  }) as unknown as Promise<Res>;
const summary = async (w: World) =>
  (
    await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${w.budgetId}/dashboard?asOf=${TODAY}`,
      headers: { origin, cookie: `harmofin_session=${w.cookie}` },
    })
  ).json();
const cash = (w: World) =>
  prisma.$transaction((tx) => balances.accountBalance(tx, w.budgetId, w.accountId));
async function allPages(w: User, limit: number): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const res = await get(w, `?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
    expect(res.statusCode).toBe(200);
    const page = res.json<Page>();
    expect(page.items.length).toBeLessThanOrEqual(limit);
    items.push(...page.items);
    if (!page.hasMore) {
      expect(page.nextCursor).toBeNull();
      return items;
    }
    expect(page.nextCursor).toEqual(expect.any(String));
    cursor = page.nextCursor;
  }
  throw new Error('pagination did not terminate');
}

describe('архивный список назначений v1 в модели 2 (P03b)', () => {
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

  it('allocation, reallocation и старт конверта видны с sourceKind, статусами и пометками', async () => {
    const w = await world();
    const res = await get(w);
    expect(res.statusCode).toBe(200);
    const page = res.json<Page>();
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.sourceKind)).toEqual(
      expect.arrayContaining(['LEGACY_ALLOCATION', 'LEGACY_REALLOCATION', 'LEGACY_ENVELOPE_START']),
    );
    expect(page.items).toHaveLength(7);
    const byId = new Map(page.items.map((item) => [item.id, item]));

    const [confirmed, cancelled, deleted] = w.ids.allocations.map((id) => byId.get(id)!);
    expect(confirmed).toMatchObject({
      sourceKind: 'LEGACY_ALLOCATION',
      occurredOn: '2025-12-01',
      amountMinor: '80000',
      status: 'CONFIRMED',
      isDeleted: false,
      isEnvelopeArchived: false,
      envelopeId: w.customEnvelopeId,
      incomeTransactionId: w.incomeId,
      categoryId: w.incomeCategoryId,
      accountId: w.accountId,
      sourceEnvelopeId: null,
      destinationEnvelopeId: null,
    });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', isDeleted: false });
    expect(deleted).toMatchObject({ status: 'DELETED', isDeleted: true });

    const [reConfirmed, reDeleted] = w.ids.reallocations.map((id) => byId.get(id)!);
    expect(reConfirmed).toMatchObject({
      sourceKind: 'LEGACY_REALLOCATION',
      amountMinor: '5000',
      status: 'CONFIRMED',
      isDeleted: false,
      envelopeId: null,
      sourceEnvelopeId: w.customEnvelopeId,
      destinationEnvelopeId: w.mainEnvelopeId,
      incomeTransactionId: null,
      categoryId: null,
      accountId: null,
    });
    expect(reDeleted).toMatchObject({ status: 'DELETED', isDeleted: true });

    const [startActive, startArchived] = w.ids.starts.map((id) => byId.get(id)!);
    expect(startActive).toMatchObject({
      sourceKind: 'LEGACY_ENVELOPE_START',
      id: w.customEnvelopeId,
      amountMinor: '10000',
      occurredOn: '2025-11-30',
      isEnvelopeArchived: false,
      envelopeId: w.customEnvelopeId,
    });
    expect(startArchived).toMatchObject({
      id: w.archivedEnvelopeId,
      amountMinor: '2500',
      isEnvelopeArchived: true,
      envelopeId: w.archivedEnvelopeId,
    });
    // Конверт с нулевым стартом не порождает строку.
    expect(byId.has(w.mainEnvelopeId)).toBe(false);
    for (const item of page.items) expect(typeof item.amountMinor).toBe('string');
  });

  it('чтение истории не меняет v2-остаток, сводку и назначения', async () => {
    const w = await world();
    const beforeV2Balance = { summary: await summary(w), cash: await cash(w) };
    const assignments = await prisma.envelopeAssignment.count({ where: { budgetId: w.budgetId } });
    expect((await get(w)).statusCode).toBe(200);
    const afterV2Balance = { summary: await summary(w), cash: await cash(w) };
    expect(afterV2Balance).toEqual(beforeV2Balance);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId: w.budgetId } })).toBe(
      assignments,
    );
  });

  it('пагинация и курсор: объединение страниц равно полному списку, без дублей, порядок стабилен', async () => {
    const w = await world();
    const full = await allPages(w, 100);
    expect(full).toHaveLength(7);
    for (const limit of [1, 2, 3]) {
      const paged = await allPages(w, limit);
      expect(paged.map((item) => `${item.sourceKind}:${item.id}`)).toEqual(
        full.map((item) => `${item.sourceKind}:${item.id}`),
      );
    }
    const keys = full.map((item) => `${item.sourceKind}:${item.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    const sorted = [...full].sort(
      (a, b) =>
        a.occurredOn.localeCompare(b.occurredOn) ||
        a.sourceKind.localeCompare(b.sourceKind) ||
        a.id.localeCompare(b.id),
    );
    expect(full.map((item) => item.id)).toEqual(sorted.map((item) => item.id));
    const first = (await get(w, '?limit=2')).json<Page>();
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const defaultPage = (await get(w)).json<Page>();
    expect(defaultPage.items).toHaveLength(7);
  });

  it('cursor другого бюджета и мусор дают 400; строки другого бюджета не читаются', async () => {
    const a = await world();
    const b = await world();
    const pageB = (await get(b, '?limit=1')).json<Page>();
    expect(pageB.nextCursor).toEqual(expect.any(String));
    const foreign = await get(a, `?cursor=${pageB.nextCursor}`);
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().code).toBe('VALIDATION_FAILED');
    for (const garbage of [
      'garbage',
      'a'.repeat(300),
      Buffer.from('[1,2,3]').toString('base64url'),
      Buffer.from(
        JSON.stringify([a.budgetId, 'not-a-date', 'LEGACY_ALLOCATION', randomUUID()]),
      ).toString('base64url'),
      Buffer.from(JSON.stringify([a.budgetId, '2025-12-01', 'BOGUS', randomUUID()])).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify([a.budgetId, '2025-12-01', 'LEGACY_ALLOCATION', 'x'])).toString(
        'base64url',
      ),
    ]) {
      expect((await get(a, `?cursor=${encodeURIComponent(garbage)}`)).statusCode).toBe(400);
    }
    for (const bad of ['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'foo=1']) {
      expect((await get(a, `?${bad}`)).statusCode).toBe(400);
    }
    const idsB = new Set([...b.ids.allocations, ...b.ids.reallocations, ...b.ids.starts]);
    const itemsA = await allPages(a, 2);
    expect(itemsA.some((item) => idsB.has(item.id))).toBe(false);
    const own = (await get(a, '?limit=1')).json<Page>();
    expect((await get(a, `?cursor=${own.nextCursor}`)).statusCode).toBe(200);
  });

  it('401 без сессии, 403 не владельцу, 404 чужой бюджет, 409 модель v1', async () => {
    const w = await world();
    const anon = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${w.budgetId}/history/legacy-assignments`,
      headers: { origin },
    });
    expect(anon.statusCode).toBe(401);

    for (const role of ['EDITOR', 'VIEWER'] as const) {
      const member = await register();
      await prisma.workspaceMembership.create({
        data: { id: randomUUID(), workspaceId: w.workspaceId, userId: member.userId, role },
      });
      const denied = await get(w, '', member);
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe('FORBIDDEN');
    }

    const outsider = await register();
    expect((await get(w, '', outsider)).statusCode).toBe(404);
    expect(
      (
        (await server.inject({
          method: 'GET',
          url: `/api/v2/budgets/${randomUUID()}/history/legacy-assignments`,
          headers: { origin, cookie: `harmofin_session=${w.cookie}` },
        })) as unknown as Res
      ).statusCode,
    ).toBe(404);

    const v1 = await register();
    const mismatch = await get(v1);
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().code).toBe('MODEL_VERSION_MISMATCH');
  });

  it('маршрут не конфликтует с POST /history/:transactionId/...; записывающих методов нет', async () => {
    const w = await world();
    const preview = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${w.budgetId}/history/${w.expenseId}/correction-preview`,
      headers: {
        origin,
        cookie: `harmofin_session=${w.cookie}`,
        'x-csrf-token': w.csrf,
      },
      payload: { amount: '20.00' },
    });
    expect(preview.statusCode).toBe(200);
    expect((await get(w)).statusCode).toBe(200);
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      const res = await server.inject({
        method,
        url: `/api/v2/budgets/${w.budgetId}/history/legacy-assignments`,
        headers: { origin, cookie: `harmofin_session=${w.cookie}`, 'x-csrf-token': w.csrf },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('OpenAPI описывает только GET, ответы и ProblemDetails', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, Operation>>;
      components: { schemas: Record<string, { properties?: Record<string, { type?: string }> }> };
    }>();
    const path = document.paths['/api/v2/budgets/{budgetId}/history/legacy-assignments']!;
    expect(path.get).toBeDefined();
    for (const method of ['post', 'patch', 'put', 'delete']) expect(path[method]).toBeUndefined();
    for (const status of ['200', '400', '401', '403', '404', '409']) {
      expect(path.get!.responses[status]).toBeDefined();
    }
    expect(path.get!.parameters!.map((p) => p.name)).toEqual(
      expect.arrayContaining(['budgetId', 'limit', 'cursor']),
    );
    expect(path.get!.responses['409']!.description).toContain('MODEL_VERSION_MISMATCH');
    expect(path.get!.responses['403']!.description).toContain('OWNER');
    const item = document.components.schemas.LegacyAssignmentHistoryItemResponse!;
    expect(Object.keys(item.properties!)).toEqual(
      expect.arrayContaining(['sourceKind', 'id', 'occurredOn', 'amountMinor', 'status']),
    );
    expect(item.properties!.amountMinor!.type).toBe('string');
    const list = document.components.schemas.LegacyAssignmentHistoryResponse!;
    expect(Object.keys(list.properties!)).toEqual(
      expect.arrayContaining(['items', 'nextCursor', 'hasMore']),
    );
  });
});

async function register(): Promise<User> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email: `v2-lhist-${randomUUID()}@harmofin.test`, password },
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
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    cookie: match ? decodeURIComponent(match[1]!) : '',
    csrf: body.csrfToken,
  };
}

/** Бюджет модели 2 с v1-историей: 3 allocation, 2 reallocation, 2 старта конвертов. */
async function world(): Promise<World> {
  const user = await register();
  await prisma.budget.update({
    where: { id: user.budgetId },
    data: {
      planModelVersion: 2,
      planModelActivatedOn: day('2026-01-01'),
      allowNegativeBalance: false,
      ...SETTINGS,
    },
  });
  const b = user.budgetId;
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId: b,
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      startingBalanceMinor: 600_000n,
      accountingStartDate: day('2026-01-01'),
    },
  });
  const category = (categoryType: 'INCOME' | 'EXPENSE') =>
    prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: b,
        name: `К ${randomUUID().slice(0, 6)}`,
        categoryType,
        displayOrder: 900,
      },
    });
  const expenseCategory = await category('EXPENSE');
  const incomeCategory = await category('INCOME');
  const envelope = (
    envelopeType: 'CURRENT_EXPENSES' | 'CUSTOM',
    extra: { startingBalanceMinor?: bigint; archivedAt?: Date; createdAt?: Date } = {},
  ) =>
    prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: b,
        name: `Е ${randomUUID().slice(0, 6)}`,
        envelopeType,
        startingBalanceMinor: extra.startingBalanceMinor ?? 0n,
        displayOrder: 950,
        ...(extra.archivedAt ? { archivedAt: extra.archivedAt } : {}),
        ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
        ...(envelopeType === 'CURRENT_EXPENSES' ? { periodSlot: PERIOD.id } : {}),
      },
    });
  const main = await envelope('CURRENT_EXPENSES');
  const custom = await envelope('CUSTOM', {
    startingBalanceMinor: 10_000n,
    createdAt: new Date('2025-11-30T10:00:00.000Z'),
  });
  const archived = await envelope('CUSTOM', {
    startingBalanceMinor: 2_500n,
    createdAt: new Date('2025-11-30T11:00:00.000Z'),
    archivedAt: new Date('2025-12-10T00:00:00.000Z'),
  });
  const period = await prisma.envelopePeriod.create({
    data: {
      id: randomUUID(),
      budgetId: b,
      envelopeId: main.id,
      startsOn: day(PERIOD.start),
      endsOn: day(PERIOD.end),
      targetStatus: 'CONFIRMED',
      targetMinor: 500_000n,
      confirmedByUserId: user.userId,
      confirmedAt: new Date(),
    },
  });
  await prisma.envelopeAssignment.create({
    data: {
      id: randomUUID(),
      budgetId: b,
      envelopeId: main.id,
      type: 'OPENING',
      amountMinor: 500_000n,
      effectiveOn: day(PERIOD.start),
      periodId: period.id,
      status: 'CONFIRMED',
    },
  });
  const tx = (type: 'INCOME' | 'EXPENSE') =>
    prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: b,
        transactionType: type,
        status: 'CONFIRMED',
        amountMinor: 100_000n,
        occurredOn: day('2025-12-01'),
        accountId: account.id,
        categoryId: type === 'INCOME' ? incomeCategory.id : expenseCategory.id,
        envelopeId: type === 'EXPENSE' ? custom.id : null,
        isPlanned: false,
        confirmedAt: new Date(),
        createdByUserId: user.userId,
        updatedByUserId: user.userId,
        accountingModelVersion: 1,
      },
    });
  const income = await tx('INCOME');
  const expense = await tx('EXPENSE');
  const allocation = async (
    status: 'CONFIRMED' | 'CANCELLED' | 'DELETED',
    occurredOn: string,
    amountMinor: bigint,
  ) =>
    (
      await prisma.incomeAllocation.create({
        data: {
          id: randomUUID(),
          budgetId: b,
          incomeTransactionId: income.id,
          status,
          amountMinor,
          occurredOn: day(occurredOn),
          accountId: account.id,
          envelopeId: custom.id,
          createdByUserId: user.userId,
          updatedByUserId: user.userId,
          ...(status === 'DELETED' ? { deletedAt: new Date(), preDeleteStatus: 'CONFIRMED' } : {}),
        },
      })
    ).id;
  const reallocation = async (
    status: 'CONFIRMED' | 'DELETED',
    occurredOn: string,
    amountMinor: bigint,
  ) =>
    (
      await prisma.envelopeReallocation.create({
        data: {
          id: randomUUID(),
          budgetId: b,
          status,
          sourceEnvelopeId: custom.id,
          destinationEnvelopeId: main.id,
          amountMinor,
          occurredOn: day(occurredOn),
          createdByUserId: user.userId,
          updatedByUserId: user.userId,
          ...(status === 'DELETED' ? { deletedAt: new Date() } : {}),
        },
      })
    ).id;
  // Одна дата у allocation и reallocation проверяет tie-break по sourceKind.
  const allocations = [
    await allocation('CONFIRMED', '2025-12-01', 80_000n),
    await allocation('CANCELLED', '2025-12-01', 1_000n),
    await allocation('DELETED', '2025-12-02', 2_000n),
  ];
  const reallocations = [
    await reallocation('CONFIRMED', '2025-12-01', 5_000n),
    await reallocation('DELETED', '2025-12-03', 700n),
  ];
  return {
    ...user,
    accountId: account.id,
    incomeCategoryId: incomeCategory.id,
    expenseCategoryId: expenseCategory.id,
    mainEnvelopeId: main.id,
    customEnvelopeId: custom.id,
    archivedEnvelopeId: archived.id,
    incomeId: income.id,
    expenseId: expense.id,
    ids: { allocations, reallocations, starts: [custom.id, archived.id] },
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
