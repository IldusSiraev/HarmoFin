import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
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
const FORMULA = '=cmd|calc';

type User = { userId: string; workspaceId: string; budgetId: string; cookie: string };
type World = User & {
  accountId: string;
  incomeCategoryId: string;
  expenseCategoryId: string;
  mainEnvelopeId: string;
  goalEnvelopeId: string;
  v1IncomeId: string;
  v1ExpenseId: string;
  v2ExpenseId: string;
  assignmentId: string;
  movementId: string;
};
type Res = {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
  json<T = Record<string, unknown>>(): T;
};
type Operation = {
  responses: Record<string, { description?: string; content?: Record<string, unknown> }>;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUsers: string[] = [];

const get = (w: User, file: string, as: User = w): Promise<Res> =>
  server.inject({
    method: 'GET',
    url: `/api/v2/budgets/${w.budgetId}/exports/${file}`,
    headers: { origin, cookie: `harmofin_session=${as.cookie}` },
  }) as unknown as Promise<Res>;
const BOM = String.fromCharCode(0xfeff);
const rows = (csv: string) => csv.replace(BOM, '').trimEnd().split('\r\n');

describe('экспорт CSV модели 2 (P04)', () => {
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

  it('transactions.csv: v1 доход/расход и v2 расход, статусы, назначение, без баланса конверта', async () => {
    const w = await world();
    const res = await get(w, 'transactions.csv');
    expect(res.statusCode).toBe(200);
    const csv = res.body;
    expect(csv).toContain('Назначение');
    expect(csv).not.toContain('Баланс конверта');
    expect(csv).not.toContain('Физический');
    const lines = rows(csv);
    const header = lines[0]!.split(';');
    expect(header).toEqual(
      expect.arrayContaining(['ID', 'Модель', 'Дата', 'Тип', 'Статус', 'Сумма (коп.)', 'Счёт']),
    );
    expect(header).toEqual(expect.arrayContaining(['Категория', 'Назначение']));
    const byId = (id: string) => lines.find((line) => line.startsWith(id))!;
    const income = byId(w.v1IncomeId).split(';');
    expect(income).toEqual(expect.arrayContaining(['1', 'INCOME', 'CONFIRMED', '100000']));
    expect(byId(w.v1ExpenseId)).toContain('EXPENSE');
    const v2 = byId(w.v2ExpenseId).split(';');
    expect(v2).toEqual(expect.arrayContaining(['2', 'EXPENSE', 'CONFIRMED', '30000']));
    expect(v2).toContain('Цель экспорта');
    expect(byId(w.v2ExpenseId)).toContain('Основной счёт');
    // назначение v2 (ledger) здесь не появляется, только факты
    expect(csv).not.toContain(w.assignmentId);
    expect(csv).not.toContain(w.movementId);
  });

  it('transactions.csv: DRAFT, CANCELLED и удалённые видны со своим статусом', async () => {
    const w = await world();
    const mk = (status: 'DRAFT' | 'CANCELLED' | 'DELETED', extra = {}) =>
      prisma.transaction.create({
        data: {
          id: randomUUID(),
          budgetId: w.budgetId,
          transactionType: 'EXPENSE',
          status,
          accountingModelVersion: 2,
          amountMinor: 111n,
          occurredOn: day('2026-03-05'),
          accountId: w.accountId,
          categoryId: w.expenseCategoryId,
          createdByUserId: w.userId,
          updatedByUserId: w.userId,
          ...extra,
        },
      });
    const draft = await mk('DRAFT');
    const cancelled = await mk('CANCELLED', { cancelledAt: new Date() });
    const deleted = await mk('DELETED', { deletedAt: new Date(), preDeleteStatus: 'CONFIRMED' });
    const lines = rows((await get(w, 'transactions.csv')).body);
    const find = (id: string) => lines.find((line) => line.startsWith(id))!;
    expect(find(draft.id)).toContain('DRAFT');
    expect(find(cancelled.id)).toContain('CANCELLED');
    expect(find(deleted.id)).toContain('DELETED');
  });

  it('assignments.csv: только подтверждённые назначения и движения v2, отдельные колонки', async () => {
    const w = await world();
    const res = await get(w, 'assignments.csv');
    expect(res.statusCode).toBe(200);
    const csv = res.body;
    expect(csv).not.toContain('Баланс конверта');
    const lines = rows(csv);
    const header = lines[0]!.split(';');
    expect(header).toEqual(
      expect.arrayContaining([
        'Вид источника',
        'Период с',
        'Период по',
        'Сумма (коп.)',
        'Статус',
        'Тип распределения',
        'Конверт',
      ]),
    );
    const assignment = lines.find((line) => line.startsWith(w.assignmentId))!.split(';');
    expect(assignment).toEqual(
      expect.arrayContaining(['ASSIGNMENT', 'OPENING', 'CONFIRMED', '500000', PERIOD.start]),
    );
    const movement = lines.find((line) => line.startsWith(w.movementId))!.split(';');
    expect(movement).toEqual(expect.arrayContaining(['MOVEMENT', 'CONFIRMED', '20000']));
    expect(movement).toContain('Цель экспорта');
    // удалённые v2-движения и все v1-строки не попадают
    expect(csv).not.toContain('99999');
    expect(csv).not.toContain('77777');
    expect(csv).not.toContain(w.v1IncomeId);
    expect(csv).not.toContain(w.v2ExpenseId);
    expect(lines).toHaveLength(3);
  });

  it('чтение не меняет данные и не затрагивает аудит', async () => {
    const w = await world();
    const count = async () => ({
      assignments: await prisma.envelopeAssignment.count({ where: { budgetId: w.budgetId } }),
      transactions: await prisma.transaction.count({ where: { budgetId: w.budgetId } }),
      audit: await prisma.auditEvent.count({ where: { workspaceId: w.workspaceId } }),
    });
    const before = await count();
    for (const file of ['transactions.csv', 'assignments.csv']) {
      expect((await get(w, file)).statusCode).toBe(200);
    }
    expect(await count()).toEqual(before);
  });

  it('значение ячейки с формулой экранируется во всех файлах', async () => {
    const w = await world();
    await prisma.transaction.update({
      where: { id: w.v2ExpenseId },
      data: { comment: FORMULA, merchantName: '@evil', sourceDescription: '+1' },
    });
    await prisma.envelope.update({ where: { id: w.goalEnvelopeId }, data: { name: FORMULA } });
    await prisma.envelope.update({ where: { id: w.mainEnvelopeId }, data: { name: '=src' } });
    await prisma.category.update({ where: { id: w.expenseCategoryId }, data: { name: '=cat' } });
    const transactions = (await get(w, 'transactions.csv')).body;
    expect(transactions).toContain(`;'${FORMULA};`);
    expect(transactions).toContain("'@evil");
    expect(transactions).toContain(";'=cat;");
    expect(transactions).toContain(";'+1;");
    expect(transactions).not.toMatch(/;[=+@]/);
    const assignments = (await get(w, 'assignments.csv')).body;
    const movementLine = rows(assignments).find((line) => line.startsWith(w.movementId))!;
    expect(movementLine).toContain(`;'=src;`);
    expect(movementLine).toContain(`;'${FORMULA};`);
    expect(assignments).not.toMatch(/;[=+@]/);
    await prisma.account.update({ where: { id: w.accountId }, data: { name: '-SUM(1)' } });
    expect((await get(w, 'transactions.csv')).body).toContain("'-SUM(1)");
  });

  it('content-type text/csv; charset=utf-8, attachment, BOM', async () => {
    const w = await world();
    for (const [file, name] of [
      ['transactions.csv', 'harmofin-transactions-v2.csv'],
      ['assignments.csv', 'harmofin-assignments-v2.csv'],
    ] as const) {
      const res = await get(w, file);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${name}"`);
      expect(res.body.startsWith(BOM)).toBe(true);
    }
  });

  it('лимит 10000 строк: 10000 проходит, 10001 даёт 422 EXPORT_LIMIT_EXCEEDED', async () => {
    const w = await world({ facts: false });
    const bulk = (count: number) =>
      prisma.transaction.createMany({
        data: Array.from({ length: count }, () => ({
          id: randomUUID(),
          budgetId: w.budgetId,
          transactionType: 'EXPENSE' as const,
          status: 'CONFIRMED' as const,
          accountingModelVersion: 2,
          amountMinor: 1n,
          occurredOn: day('2026-03-05'),
          accountId: w.accountId,
          categoryId: w.expenseCategoryId,
          confirmedAt: new Date(),
          createdByUserId: w.userId,
          updatedByUserId: w.userId,
        })),
      });
    await bulk(10_000);
    const ok = await get(w, 'transactions.csv');
    expect(ok.statusCode).toBe(200);
    expect(rows(ok.body)).toHaveLength(10_001);
    await bulk(1);
    const over = await get(w, 'transactions.csv');
    expect(over.statusCode).toBe(422);
    expect(over.json()).toMatchObject({ code: 'EXPORT_LIMIT_EXCEEDED' });
  }, 60_000);

  it('401 без сессии, 403 не владельцу, 404 чужой бюджет', async () => {
    const w = await world();
    const files = ['transactions.csv', 'assignments.csv'];
    for (const file of files) {
      const anon = await server.inject({
        method: 'GET',
        url: `/api/v2/budgets/${w.budgetId}/exports/${file}`,
        headers: { origin },
      });
      expect(anon.statusCode).toBe(401);
    }
    for (const role of ['EDITOR', 'VIEWER'] as const) {
      const member = await register();
      await prisma.workspaceMembership.create({
        data: { id: randomUUID(), workspaceId: w.workspaceId, userId: member.userId, role },
      });
      for (const file of files) {
        const denied = await get(w, file, member);
        expect(denied.statusCode).toBe(403);
        expect(denied.json().code).toBe('FORBIDDEN');
      }
    }
    const outsider = await register();
    for (const file of files) {
      expect((await get(w, file, outsider)).statusCode).toBe(404);
      const unknown = await server.inject({
        method: 'GET',
        url: `/api/v2/budgets/${randomUUID()}/exports/${file}`,
        headers: { origin, cookie: `harmofin_session=${w.cookie}` },
      });
      expect(unknown.statusCode).toBe(404);
    }
  });

  it('не отдаёт строки другого бюджета', async () => {
    const a = await world();
    const b = await world();
    const marker = randomUUID().slice(0, 8);
    await prisma.account.update({ where: { id: b.accountId }, data: { name: `Счёт-${marker}` } });
    await prisma.envelope.update({
      where: { id: b.goalEnvelopeId },
      data: { name: `Цель-${marker}` },
    });
    await prisma.category.update({
      where: { id: b.expenseCategoryId },
      data: { name: `Кат-${marker}` },
    });
    for (const file of ['transactions.csv', 'assignments.csv']) {
      const csv = (await get(a, file)).body;
      for (const id of [b.v1IncomeId, b.v2ExpenseId, b.assignmentId]) {
        expect(csv).not.toContain(id);
      }
      expect(csv).not.toContain(marker);
      expect((await get(b, file)).body).toContain(marker);
    }
  });

  it('OpenAPI описывает два GET с text/csv и ошибками', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, Operation>>;
    }>();
    const filenames: Record<string, string> = {
      'transactions.csv': 'harmofin-transactions-v2.csv',
      'assignments.csv': 'harmofin-assignments-v2.csv',
    };
    const descriptions: Record<string, string> = {
      'transactions.csv': 'транзакции',
      'assignments.csv': 'назначения и движения модели 2',
    };
    for (const file of ['transactions.csv', 'assignments.csv']) {
      const path = document.paths[`/api/v2/budgets/{budgetId}/exports/${file}`]!;
      expect(path.get).toBeDefined();
      for (const method of ['post', 'patch', 'put', 'delete']) expect(path[method]).toBeUndefined();
      const ok = path.get!.responses['200']! as {
        description?: string;
        content?: Record<string, unknown>;
        headers?: Record<string, { schema?: { type?: string } }>;
      };
      expect(ok.content!['text/csv']).toBeDefined();
      expect(ok.description).toContain('UTF-8');
      expect(ok.description).toContain('BOM');
      expect(ok.description).toContain(filenames[file]);
      expect(ok.headers!['Content-Disposition']!.schema!.type).toBe('string');
      expect(JSON.stringify(ok.headers)).toContain(filenames[file]);
      expect(ok.description).toContain(descriptions[file]);
      for (const status of ['400', '401', '403', '404', '409', '422']) {
        expect(path.get!.responses[status]).toBeDefined();
      }
      expect(path.get!.responses['409']!.description).toContain('MODEL_VERSION_MISMATCH');
      expect(path.get!.responses['422']!.description).toContain('EXPORT_LIMIT_EXCEEDED');
    }
  });
});

async function register(): Promise<User> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email: `v2-export-${randomUUID()}@harmofin.test`, password },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{
    user: { id: string };
    workspace: { id: string };
    budget: { id: string };
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
  };
}

/** Бюджет модели 2 с v1-историей и v2-фактами. */
async function world(options: { facts?: boolean } = {}): Promise<World> {
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
  const category = (categoryType: 'INCOME' | 'EXPENSE', name: string) =>
    prisma.category.create({
      data: { id: randomUUID(), budgetId: b, name, categoryType, displayOrder: 900 },
    });
  const expenseCategory = await category('EXPENSE', 'Продукты');
  const incomeCategory = await category('INCOME', 'Зарплата');
  const envelope = (
    envelopeType: 'CURRENT_EXPENSES' | 'CUSTOM',
    name: string,
    startingBalanceMinor = 0n,
  ) =>
    prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: b,
        name,
        envelopeType,
        startingBalanceMinor,
        displayOrder: 950,
        ...(startingBalanceMinor ? { createdAt: new Date('2025-11-30T10:00:00.000Z') } : {}),
        ...(envelopeType === 'CURRENT_EXPENSES' ? { periodSlot: PERIOD.id } : {}),
      },
    });
  const main = await envelope('CURRENT_EXPENSES', 'Текущие расходы');
  const goal = await envelope('CUSTOM', 'Цель экспорта', 10_000n);
  const base = {
    ...user,
    accountId: account.id,
    incomeCategoryId: incomeCategory.id,
    expenseCategoryId: expenseCategory.id,
    mainEnvelopeId: main.id,
    goalEnvelopeId: goal.id,
  };
  if (options.facts === false) {
    return {
      ...base,
      v1IncomeId: '',
      v1ExpenseId: '',
      v2ExpenseId: '',
      assignmentId: '',
      movementId: '',
    };
  }
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
  const assignment = await prisma.envelopeAssignment.create({
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
  const movement = (status: 'CONFIRMED' | 'DELETED', amountMinor: bigint) =>
    prisma.envelopeMovement.create({
      data: {
        id: randomUUID(),
        budgetId: b,
        sourceEnvelopeId: main.id,
        sourcePeriodId: period.id,
        destinationEnvelopeId: goal.id,
        amountMinor,
        effectiveOn: day('2026-03-03'),
        status,
      },
    });
  await prisma.envelopeAssignment.create({
    data: {
      id: randomUUID(),
      budgetId: b,
      envelopeId: main.id,
      type: 'FREE',
      amountMinor: 77_777n,
      effectiveOn: day(PERIOD.start),
      periodId: period.id,
      status: 'DELETED',
    },
  });
  const confirmedMovement = await movement('CONFIRMED', 20_000n);
  await movement('DELETED', 99_999n);
  const tx = (
    type: 'INCOME' | 'EXPENSE',
    version: 1 | 2,
    amountMinor: bigint,
    envelopeId: string | null,
  ) =>
    prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: b,
        transactionType: type,
        status: 'CONFIRMED',
        accountingModelVersion: version,
        amountMinor,
        occurredOn: day(version === 1 ? '2025-12-01' : '2026-03-04'),
        accountId: account.id,
        categoryId: type === 'INCOME' ? incomeCategory.id : expenseCategory.id,
        envelopeId,
        confirmedAt: new Date(),
        createdByUserId: user.userId,
        updatedByUserId: user.userId,
      },
    });
  const v1Income = await tx('INCOME', 1, 100_000n, null);
  const v1Expense = await tx('EXPENSE', 1, 25_000n, goal.id);
  const v2Expense = await tx('EXPENSE', 2, 30_000n, goal.id);
  return {
    ...base,
    v1IncomeId: v1Income.id,
    v1ExpenseId: v1Expense.id,
    v2ExpenseId: v2Expense.id,
    assignmentId: assignment.id,
    movementId: confirmedMovement.id,
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
