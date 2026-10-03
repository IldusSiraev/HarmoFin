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
  owner: `v2-tx-owner-${randomUUID()}@harmofin.test`,
  viewer: `v2-tx-viewer-${randomUUID()}@harmofin.test`,
  outsider: `v2-tx-outsider-${randomUUID()}@harmofin.test`,
};
const ctx: Partial<Record<keyof typeof emails, User>> = {};

let app: NestFastifyApplication;
let server: FastifyInstance;
const balances = new FinancialBalanceRepository();
const assignmentBalances = new AssignmentBalanceRepository();

let accountId: string;
let smallAccountId: string;
let incomeCategoryId: string;
let expenseCategoryId: string;
let periodEnvelopeId: string;
let periodEnvelopeNoPeriodId: string;
let customEnvelopeId: string;
let mandatoryEnvelopeId: string;
let outsiderAccountId: string;
let outsiderEnvelopeId: string;
let outsiderCategoryId: string;
let periodId: string;

const today = todayInTimezone(new Date(), 'UTC');
const tomorrow = todayInTimezone(new Date(Date.now() + dayMs), 'UTC');

function headers(user: User | undefined, key?: string): Record<string, string> {
  return {
    origin,
    cookie: `harmofin_session=${user?.cookie ?? ''}`,
    'x-csrf-token': user?.csrfToken ?? '',
    ...(key ? { 'idempotency-key': key } : {}),
  };
}

const url = (budgetId?: string) =>
  `/api/v2/budgets/${budgetId ?? ctx.owner!.budgetId}/transactions`;

function post(
  user: User | undefined,
  key: string,
  payload: Record<string, unknown>,
  budgetId?: string,
) {
  return server.inject({
    method: 'POST',
    url: url(budgetId ?? user?.budgetId),
    headers: headers(user, key),
    payload,
  });
}

const cash = (id: string) =>
  prisma.$transaction((tx) => balances.accountBalance(tx, ctx.owner!.budgetId, id));

const assignmentBalance = (envelopeId: string, pid: string | null) =>
  prisma.$transaction((tx) =>
    assignmentBalances.balance(tx, ctx.owner!.budgetId, envelopeId, pid, new Date()),
  );

const expense = (over: Record<string, unknown> = {}) => ({
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amount: '4820.00',
  occurredOn: today,
  accountId,
  categoryId: expenseCategoryId,
  ...over,
});

describe('v2 доход и обычный расход (POST /api/v2/budgets/:budgetId/transactions)', () => {
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
      where: { id: { in: [ctx.owner!.budgetId, ctx.outsider!.budgetId] } },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });
    await prisma.budget.update({
      where: { id: ctx.owner!.budgetId },
      data: { allowNegativeBalance: false },
    });
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: ctx.owner!.workspaceId,
        userId: ctx.viewer!.userId,
        role: 'VIEWER',
      },
    });

    const b = ctx.owner!.budgetId;
    accountId = await createAccount(b, 100_000_000n);
    smallAccountId = await createAccount(b, 10_000n);
    incomeCategoryId = await createCategory(b, 'INCOME');
    expenseCategoryId = await createCategory(b, 'EXPENSE');
    periodEnvelopeId = await createEnvelope(b, 'CURRENT_EXPENSES', 'FIRST');
    periodEnvelopeNoPeriodId = await createEnvelope(b, 'CURRENT_EXPENSES', 'SECOND');
    customEnvelopeId = await createEnvelope(b, 'CUSTOM', null);
    mandatoryEnvelopeId = await createEnvelope(b, 'MANDATORY_EXPENSES', null);

    // Concrete period covering today with a confirmed assignment of 10 000.00.
    periodId = randomUUID();
    await prisma.envelopePeriod.create({
      data: {
        id: periodId,
        budgetId: b,
        envelopeId: periodEnvelopeId,
        startsOn: d(-10),
        endsOn: d(10),
        targetStatus: 'UNSET',
      },
    });
    await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: b,
        envelopeId: periodEnvelopeId,
        type: 'FREE',
        amountMinor: 1_000_000n,
        effectiveOn: d(-5),
        periodId,
        status: 'CONFIRMED',
      },
    });

    outsiderAccountId = await createAccount(ctx.outsider!.budgetId, 100_000_000n);
    outsiderEnvelopeId = await createEnvelope(ctx.outsider!.budgetId, 'CUSTOM', null);
    outsiderCategoryId = await createCategory(ctx.outsider!.budgetId, 'EXPENSE');
  });

  afterAll(async () => {
    const viewer = ctx.viewer;
    if (viewer) {
      await prisma.workspaceMembership.deleteMany({
        where: { userId: viewer.userId, workspaceId: { not: viewer.workspaceId } },
      });
    }
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await cleanupUser(ctx[key]?.userId ?? '');
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('доход увеличивает счёт, помечен model 2 и не создаёт назначений', async () => {
    const before = await cash(accountId);
    const res = await post(ctx.owner, 'inc-1', {
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      amount: '1000.00',
      occurredOn: today,
      accountId,
      categoryId: incomeCategoryId,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body.amountMinor).toBe('100000');
    expect(body.envelopeId).toBeNull();
    expect(body.accountBalanceMinor).toBe((before + 100_000n).toString());
    expect(await cash(accountId)).toBe(before + 100_000n);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: body.id as string } });
    expect(row.accountingModelVersion).toBe(2);
    expect(row.status).toBe('CONFIRMED');
    expect(row.confirmedAt).not.toBeNull();
    expect(
      await prisma.envelopeAssignment.count({ where: { sourceIncomeTransactionId: row.id } }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { entityType: 'transaction', entityId: row.id, budgetId: ctx.owner!.budgetId },
      }),
    ).toBe(1);
  });

  it('расход без конверта снижает только кэш', async () => {
    const before = await cash(accountId);
    const res = await post(ctx.owner, 'exp-free', expense());
    expect(res.statusCode).toBe(201);
    const body = res.json<{ envelopeId: string | null; warnings: unknown[] }>();
    expect(body.envelopeId).toBeNull();
    expect(body.warnings).toEqual([]);
    expect(await cash(accountId)).toBe(before - 482_000n);
  });

  it('расход периодного конверта снижает кэш и назначение выбранного периода', async () => {
    const beforeCash = await cash(accountId);
    const beforeAssignment = await assignmentBalance(periodEnvelopeId, periodId);
    expect(beforeAssignment.balance).toBe(1_000_000n);
    const res = await post(ctx.owner, 'exp-period', expense({ envelopeId: periodEnvelopeId }));
    expect(res.statusCode).toBe(201);
    expect(res.json<{ warnings: unknown[] }>().warnings).toEqual([]);
    expect(await cash(accountId)).toBe(beforeCash - 482_000n);
    expect((await assignmentBalance(periodEnvelopeId, periodId)).balance).toBe(518_000n);
    expect(
      await prisma.envelopePeriod.count({
        where: { budgetId: ctx.owner!.budgetId, envelopeId: periodEnvelopeId },
      }),
    ).toBe(1);
  });

  it('создаёт конкретный период (target=null, UNSET) по циклу, если периода нет', async () => {
    const res = await post(
      ctx.owner,
      'exp-newperiod',
      expense({ envelopeId: periodEnvelopeNoPeriodId, amount: '10.00' }),
    );
    expect(res.statusCode).toBe(201);
    const periods = await prisma.envelopePeriod.findMany({
      where: { budgetId: ctx.owner!.budgetId, envelopeId: periodEnvelopeNoPeriodId },
    });
    expect(periods).toHaveLength(1);
    const period = periods[0]!;
    expect(period.targetMinor).toBeNull();
    expect(period.targetStatus).toBe('UNSET');
    expect(period.startsOn.getTime()).toBeLessThanOrEqual(new Date(`${today}T00:00:00Z`).getTime());
    expect(period.endsOn.getTime()).toBeGreaterThanOrEqual(
      new Date(`${today}T00:00:00Z`).getTime(),
    );
    // Повтор с другим ключом не плодит периоды.
    const again = await post(
      ctx.owner,
      'exp-newperiod-2',
      expense({ envelopeId: periodEnvelopeNoPeriodId, amount: '11.00' }),
    );
    expect(again.statusCode).toBe(201);
    expect(
      await prisma.envelopePeriod.count({
        where: { budgetId: ctx.owner!.budgetId, envelopeId: periodEnvelopeNoPeriodId },
      }),
    ).toBe(1);
  });

  it('обязательный конверт через generic POST — 409 MANDATORY_PAYMENT_REQUIRED без записи', async () => {
    const before = await prisma.transaction.count({ where: { budgetId: ctx.owner!.budgetId } });
    const res = await post(
      ctx.owner,
      'exp-mandatory',
      expense({ envelopeId: mandatoryEnvelopeId }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('MANDATORY_PAYMENT_REQUIRED');
    expect(await prisma.transaction.count({ where: { budgetId: ctx.owner!.budgetId } })).toBe(
      before,
    );
  });

  it('недостаток назначения конверта не блокирует расход: предупреждение', async () => {
    const before = await cash(accountId);
    const res = await post(
      ctx.owner,
      'exp-deficit',
      expense({ envelopeId: customEnvelopeId, amount: '300.00' }),
    );
    expect(res.statusCode).toBe(201);
    const body = res.json<{ warnings: Array<{ code: string }> }>();
    expect(body.warnings.map((w) => w.code)).toContain('ENVELOPE_BALANCE_INSUFFICIENT');
    expect(await cash(accountId)).toBe(before - 30_000n);
  });

  it('строгий счёт: нехватка кэша счёта — 409 INSUFFICIENT_BALANCE, DRAFT не проверяется', async () => {
    const before = await cash(smallAccountId);
    const res = await post(
      ctx.owner,
      'exp-strict',
      expense({ accountId: smallAccountId, amount: '100.01' }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('INSUFFICIENT_BALANCE');
    expect(await cash(smallAccountId)).toBe(before);

    const draft = await post(
      ctx.owner,
      'exp-strict-draft',
      expense({ accountId: smallAccountId, amount: '100.01', status: 'DRAFT' }),
    );
    expect(draft.statusCode).toBe(201);
    expect(await cash(smallAccountId)).toBe(before);
  });

  it('будущая дата: CONFIRMED отклонён, DRAFT разрешён и не влияет на кэш', async () => {
    const before = await cash(accountId);
    const rejected = await post(ctx.owner, 'exp-future', expense({ occurredOn: tomorrow }));
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json<{ code: string }>().code).toBe('VALIDATION_FAILED');

    const draft = await post(
      ctx.owner,
      'exp-future-draft',
      expense({ occurredOn: tomorrow, status: 'DRAFT' }),
    );
    expect(draft.statusCode).toBe(201);
    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: draft.json<{ id: string }>().id },
    });
    expect(row.status).toBe('DRAFT');
    expect(row.confirmedAt).toBeNull();
    expect(await cash(accountId)).toBe(before);
  });

  it('идемпотентность: повтор — тот же результат без дубля, другой запрос — 409 IDEMPOTENCY_CONFLICT', async () => {
    const before = await cash(accountId);
    const first = await post(ctx.owner, 'exp-replay', expense({ amount: '1.00' }));
    const second = await post(ctx.owner, 'exp-replay', expense({ amount: '1.00' }));
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(await cash(accountId)).toBe(before - 100n);

    const conflict = await post(ctx.owner, 'exp-replay', expense({ amount: '2.00' }));
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await cash(accountId)).toBe(before - 100n);
  });

  it('VIEWER — 403, посторонний — 404', async () => {
    const viewer = await post(ctx.viewer, 'v-1', expense(), ctx.owner!.budgetId);
    expect(viewer.statusCode).toBe(403);

    const outsider = await post(ctx.outsider, 'o-1', expense(), ctx.owner!.budgetId);
    expect(outsider.statusCode).toBe(404);
  });

  it('изоляция бюджетов: чужие счёт, категория и конверт — 404, без записи', async () => {
    const before = await prisma.transaction.count({ where: { budgetId: ctx.owner!.budgetId } });
    for (const [key, over] of [
      ['iso-account', { accountId: outsiderAccountId }],
      ['iso-category', { categoryId: outsiderCategoryId }],
      ['iso-envelope', { envelopeId: outsiderEnvelopeId }],
    ] as const) {
      const res = await post(ctx.owner, key, expense(over));
      expect(res.statusCode).toBe(404);
    }
    expect(await prisma.transaction.count({ where: { budgetId: ctx.owner!.budgetId } })).toBe(
      before,
    );
  });

  it('валидация: тип категории, конверт у дохода, сумма, без Idempotency-Key', async () => {
    const wrongCategory = await post(
      ctx.owner,
      'val-cat',
      expense({ categoryId: incomeCategoryId }),
    );
    expect(wrongCategory.statusCode).toBe(400);

    const incomeEnvelope = await post(
      ctx.owner,
      'val-inc-env',
      expense({
        transactionType: 'INCOME',
        categoryId: incomeCategoryId,
        envelopeId: customEnvelopeId,
      }),
    );
    expect(incomeEnvelope.statusCode).toBe(400);

    for (const amount of ['0', '-5', 'abc', '1.234']) {
      const res = await post(ctx.owner, `val-amt-${amount}`, expense({ amount }));
      expect(res.statusCode).toBe(400);
    }

    const noKey = await server.inject({
      method: 'POST',
      url: url(),
      headers: headers(ctx.owner),
      payload: expense(),
    });
    expect(noKey.statusCode).toBe(400);
  });

  it('OpenAPI описывает POST v2 transactions: коды, Idempotency-Key, cookie', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(openApi.statusCode).toBe(200);
    const document = openApi.json<{
      paths: Record<
        string,
        {
          post?: {
            parameters?: Array<{ name: string; required?: boolean }>;
            responses?: Record<string, unknown>;
            security?: Array<Record<string, unknown>>;
          };
        }
      >;
    }>();
    const post = document.paths['/api/v2/budgets/{budgetId}/transactions']?.post;
    expect(post).toBeDefined();
    for (const status of ['201', '400', '401', '403', '404', '409', '422']) {
      expect(post?.responses?.[status]).toBeDefined();
    }
    expect(post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
      ]),
    );
    expect(post?.security).toEqual([{ session: [] }]);
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

async function createAccount(budgetId: string, startingBalanceMinor: bigint): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
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
  envelopeType: 'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'CUSTOM',
  periodSlot: 'FIRST' | 'SECOND' | null,
): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Envelope ${randomUUID().slice(0, 8)}`,
      envelopeType,
      periodSlot,
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
    await prisma.transferPart.deleteMany({ where: { transfer: { budget: { workspaceId } } } });
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
