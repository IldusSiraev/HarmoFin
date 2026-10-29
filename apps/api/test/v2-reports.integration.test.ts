import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
// UTC calendar helpers for the plan-vs-actual "current cycle" test: world() budgets use timezone
// UTC, cycleStartDay 1, so the current financial cycle is the current calendar month.
const todayUtc = (): string => new Date().toISOString().slice(0, 10);
const firstDayOfMonth = (monthOffset: number): string => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1))
    .toISOString()
    .slice(0, 10);
};
const monthStart = firstDayOfMonth;
const monthEnd = (monthOffset: number): string => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset + 1, 0))
    .toISOString()
    .slice(0, 10);
};

type World = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  accountId: string;
  secondAccountId: string;
  categoryId: string;
  otherCategoryId: string;
  incomeCategoryId: string;
  mainEnvelopeId: string;
  mandatoryEnvelopeId: string;
  goalEnvelopeId: string;
  cookie: string;
};

type Row = Record<string, unknown>;

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUsers: string[] = [];

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

describe('v2 reports (P03)', () => {
  it('цель 10 000 ₽, назначено 8 000 ₽, потрачено 3 000 ₽ => накоплено 5 000 ₽; старый v1 расход не списывается второй раз', async () => {
    const w = await world();
    await assign(w, w.goalEnvelopeId, null, 800_000n, 'OPENING');
    await expense(w, w.goalEnvelopeId, 300_000n, '2026-03-05');
    // Старый подтверждённый v1 расход: виден в деньгах/расходах, но не уменьшает v2 назначение.
    await expense(w, w.goalEnvelopeId, 100_000n, '2026-02-10', { modelVersion: 1 });
    // Не влияют: черновик, отмена, удаление.
    await expense(w, w.goalEnvelopeId, 900_000n, '2026-03-06', { status: 'DRAFT' });
    await expense(w, w.goalEnvelopeId, 900_000n, '2026-03-06', { status: 'CANCELLED' });
    await expense(w, w.goalEnvelopeId, 900_000n, '2026-03-06', { status: 'DELETED' });

    const goals = await rows(w, 'savings-goals');
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      envelopeId: w.goalEnvelopeId,
      currentMinor: '500000',
      targetMinor: '1000000',
      assignedMinor: '800000',
      spentMinor: '300000',
      remainingMinor: '500000',
      progressPermille: 500,
      isReached: false,
    });

    const byCategory = await rows(w, 'expenses-by-category');
    expect(byCategory).toEqual([
      expect.objectContaining({ categoryId: w.categoryId, expenseMinor: '400000' }),
    ]);
    const flow = await rows(w, 'net-cash-flow');
    expect(flow.reduce((sum, row) => sum + BigInt(row.expenseMinor as string), 0n)).toBe(400_000n);
  });

  it('переназначение между конвертами не считается накоплением', async () => {
    const w = await world();
    await assign(w, w.goalEnvelopeId, null, 800_000n, 'OPENING');
    await assign(w, w.mainEnvelopeId, null, 500_000n, 'OPENING');
    await movement(w, w.mainEnvelopeId, w.mandatoryEnvelopeId, 200_000n, '2026-03-02');

    let goals = await rows(w, 'savings-goals');
    expect(goals[0]).toMatchObject({ currentMinor: '800000', assignedMinor: '800000' });

    await movement(w, w.mainEnvelopeId, w.goalEnvelopeId, 100_000n, '2026-03-03');
    goals = await rows(w, 'savings-goals');
    // Деньги в цели есть (остаток), но «назначено» не растёт: это не новое накопление.
    expect(goals[0]).toMatchObject({
      currentMinor: '900000',
      assignedMinor: '800000',
      movedNetMinor: '100000',
    });

    const list = await rows(w, 'assignment-movements');
    const assignments = list.filter((row) => row.kind === 'ASSIGNMENT');
    const movements = list.filter((row) => row.kind === 'MOVEMENT');
    expect(assignments).toHaveLength(2);
    expect(movements).toHaveLength(2);
    expect(assignments.every((row) => row.countsAsAccumulation === true)).toBe(true);
    expect(movements.every((row) => row.countsAsAccumulation === false)).toBe(true);
    expect(movements).toContainEqual(
      expect.objectContaining({
        sourceEnvelopeId: w.mainEnvelopeId,
        destinationEnvelopeId: w.mandatoryEnvelopeId,
        amountMinor: '200000',
        effectiveOn: '2026-03-02',
      }),
    );

    const onlyGoal = await rows(w, 'assignment-movements', `?envelopeId=${w.goalEnvelopeId}`);
    expect(onlyGoal).toHaveLength(2);
    const dated = await rows(w, 'assignment-movements', '?from=2026-03-03&to=2026-03-03');
    expect(dated).toHaveLength(1);
  });

  it('удалённые назначения и движения не попадают в отчёты', async () => {
    const w = await world();
    await assign(w, w.goalEnvelopeId, null, 800_000n, 'OPENING');
    await assign(w, w.goalEnvelopeId, null, 700_000n, 'FREE', 'DELETED');
    await movement(w, w.mainEnvelopeId, w.goalEnvelopeId, 100_000n, '2026-03-03', 'DELETED');
    expect((await rows(w, 'savings-goals'))[0]).toMatchObject({ currentMinor: '800000' });
    expect(await rows(w, 'assignment-movements')).toHaveLength(1);
  });

  it('несколько PlanPayment одной occurrence: план один раз, факт суммируется', async () => {
    const w = await world();
    const { occurrenceId, planId } = await occurrence(w, 5_000_000n, '2026-03-12');
    for (const amount of [1_500_000n, 2_500_000n]) {
      const id = await expense(w, w.mandatoryEnvelopeId, amount, '2026-03-12');
      await payment(w, occurrenceId, id);
    }
    const cancelled = await expense(w, w.mandatoryEnvelopeId, 700_000n, '2026-03-12', {
      status: 'CANCELLED',
    });
    await payment(w, occurrenceId, cancelled);

    const plans = await rows(w, 'plan-vs-actual', '?from=2026-03-01&to=2026-03-31');
    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    expect(plan).toMatchObject({
      planId,
      plannedMinor: '5000000',
      actualMinor: '4000000',
      varianceMinor: '-1000000',
      plannedOccurrenceCount: 1,
      confirmedOccurrenceCount: 1,
    });
  });

  it('expected берётся из snapshot occurrence, а не из текущей суммы плана', async () => {
    const w = await world();
    const { occurrenceId, planId } = await occurrence(w, 5_000_000n, '2026-03-12');
    await prisma.regularPlan.update({ where: { id: planId }, data: { amountMinor: 9_999_999n } });
    const id = await expense(w, w.mandatoryEnvelopeId, 5_000_000n, '2026-03-12');
    await payment(w, occurrenceId, id);
    const plan = (await rows(w, 'plan-vs-actual', '?from=2026-03-01&to=2026-03-31'))[0]!;
    expect(plan).toMatchObject({ plannedMinor: '5000000', actualMinor: '5000000' });
    expect(plan.varianceMinor).toBe('0');
  });

  it('expenses-by-period использует сохранённые границы; смена цикла не меняет историю', async () => {
    const w = await world();
    // Бюджет теперь на новых настройках (с 5-го числа), ревизия A (с 1-го) действовала раньше.
    await prisma.budget.update({
      where: { id: w.budgetId },
      data: { cycleStartDay: 5, periodBoundaryOffset: 14 },
    });
    await revision(w, '2026-01-01', 1, 14);
    await revision(w, '2026-04-01', 5, 14);
    await addPeriod(w, w.mainEnvelopeId, '2026-03-01', '2026-03-14');
    await addPeriod(w, w.mainEnvelopeId, '2026-03-15', '2026-03-31');
    await expense(w, w.mainEnvelopeId, 100_000n, '2026-03-05');
    await expense(w, w.mainEnvelopeId, 200_000n, '2026-03-20');
    await expense(w, w.mainEnvelopeId, 400_000n, '2026-02-10'); // без строки периода: ревизия A
    await expense(w, w.mainEnvelopeId, 800_000n, '2026-04-06'); // после ревизии B

    const periods = await rows(w, 'expenses-by-period');
    expect(periods.map((row) => [row.periodStart, row.periodEnd, row.expenseMinor])).toEqual([
      ['2026-02-01', '2026-02-14', '400000'],
      ['2026-03-01', '2026-03-14', '100000'],
      ['2026-03-15', '2026-03-31', '200000'],
      ['2026-04-05', '2026-04-18', '800000'],
    ]);
    expect(periods.map((row) => row.boundarySource)).toEqual([
      'SETTINGS_AT',
      'STORED',
      'STORED',
      'SETTINGS_AT',
    ]);

    const cycles = await rows(w, 'expenses-by-cycle');
    expect(cycles.map((row) => [row.cycleStart, row.cycleEnd, row.expenseMinor])).toEqual([
      ['2026-02-01', '2026-02-28', '400000'],
      ['2026-03-01', '2026-03-31', '300000'],
      ['2026-04-05', '2026-05-04', '800000'],
    ]);
  });

  it('incomes-by-cycle и net-cash-flow: подтверждённые доходы и расходы по циклам', async () => {
    const w = await world();
    await income(w, 1_000_000n, '2026-03-02');
    await income(w, 500_000n, '2026-03-03', 'DRAFT');
    await expense(w, w.mainEnvelopeId, 300_000n, '2026-03-04');
    const incomes = await rows(w, 'incomes-by-cycle');
    expect(incomes).toEqual([
      expect.objectContaining({ cycleStart: '2026-03-01', incomeMinor: '1000000' }),
    ]);
    const flow = await rows(w, 'net-cash-flow');
    expect(flow).toEqual([
      expect.objectContaining({
        cycleStart: '2026-03-01',
        incomeMinor: '1000000',
        expenseMinor: '300000',
        netCashFlowMinor: '700000',
      }),
    ]);
  });

  it('account-balances: legacy-перевод и прямой перевод между счетами, старый v1 расход', async () => {
    const w = await world();
    await income(w, 500_000n, '2026-03-02');
    await expense(w, w.mainEnvelopeId, 150_000n, '2026-02-10', { modelVersion: 1 });
    await legacyTransfer(w, 100_000n, '2026-03-03');
    await directTransfer(w, 200_000n, '2026-03-04');
    await directTransfer(w, 900_000n, '2026-03-05', 'DRAFT');

    const balances = await rows(w, 'account-balances');
    const byId = new Map(balances.map((row) => [row.accountId as string, row]));
    // 1 000 000 + 500 000 - 150 000 - 100 000 - 200 000
    expect(byId.get(w.accountId)?.balanceMinor).toBe('1050000');
    expect(byId.get(w.secondAccountId)?.balanceMinor).toBe('300000');

    const only = await rows(w, 'account-balances', `?accountId=${w.secondAccountId}`);
    expect(only).toHaveLength(1);
    const early = await rows(w, 'account-balances', '?to=2026-03-02');
    expect(new Map(early.map((row) => [row.accountId, row.balanceMinor])).get(w.accountId)).toBe(
      '1350000',
    );
  });

  it('фильтры: чужие и несуществующие объекты дают 404 до агрегации', async () => {
    const a = await world();
    const b = await world();
    for (const key of ['expenses-by-category', 'savings-goals', 'plan-vs-actual']) {
      for (const query of [
        `?categoryId=${b.categoryId}`,
        `?accountId=${b.accountId}`,
        `?envelopeId=${b.goalEnvelopeId}`,
        `?categoryId=${randomUUID()}`,
      ]) {
        const response = await get(a, key, query);
        expect(response.statusCode, `${key}${query}`).toBe(404);
        expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
      }
    }
    const own = await get(a, 'expenses-by-category', `?categoryId=${a.categoryId}`);
    expect(own.statusCode).toBe(200);
  });

  it('categoryId/accountId/envelopeId/from/to сужают фактические отчёты', async () => {
    const w = await world();
    await expense(w, w.mainEnvelopeId, 100_000n, '2026-03-05');
    await expense(w, w.mainEnvelopeId, 200_000n, '2026-03-06', { categoryId: w.otherCategoryId });
    await expense(w, w.goalEnvelopeId, 400_000n, '2026-03-07', { accountId: w.secondAccountId });
    const byCategory = await rows(w, 'expenses-by-category', `?categoryId=${w.otherCategoryId}`);
    expect(byCategory).toEqual([expect.objectContaining({ expenseMinor: '200000' })]);
    const byAccount = await rows(w, 'expenses-by-category', `?accountId=${w.secondAccountId}`);
    expect(byAccount).toEqual([expect.objectContaining({ expenseMinor: '400000' })]);
    const byEnvelope = await rows(w, 'expenses-by-category', `?envelopeId=${w.mainEnvelopeId}`);
    expect(byEnvelope.reduce((sum, row) => sum + BigInt(row.expenseMinor as string), 0n)).toBe(
      300_000n,
    );
    const dated = await rows(w, 'expenses-by-category', '?from=2026-03-06&to=2026-03-06');
    expect(dated).toEqual([expect.objectContaining({ expenseMinor: '200000' })]);
  });

  it('изоляция бюджетов: данные другого бюджета не попадают в отчёты', async () => {
    const a = await world();
    const b = await world();
    await assign(a, a.goalEnvelopeId, null, 800_000n, 'OPENING');
    await assign(b, b.goalEnvelopeId, null, 111_000n, 'OPENING');
    await expense(b, b.mainEnvelopeId, 777_000n, '2026-03-05');
    expect((await rows(a, 'savings-goals'))[0]).toMatchObject({ currentMinor: '800000' });
    expect(await rows(a, 'expenses-by-category')).toEqual([]);
    expect(await rows(a, 'assignment-movements')).toHaveLength(1);
  });

  it('VIEWER читает; 401, 404 чужой, 409 бюджет v1, 400 неизвестный key и параметры', async () => {
    const w = await world();
    await assign(w, w.goalEnvelopeId, null, 800_000n, 'OPENING');
    const viewer = await addMember(w, 'VIEWER');
    const asViewer = await get(w, 'savings-goals', '', { cookie: viewer.cookie });
    expect(asViewer.statusCode).toBe(200);
    expect(asViewer.json<{ key: string; rows: Row[] }>().rows[0]).toMatchObject({
      currentMinor: '800000',
    });

    expect((await get(w, 'savings-goals', '', { cookie: null })).statusCode).toBe(401);

    const stranger = await world();
    const foreign = await get(w, 'savings-goals', '', { cookie: stranger.cookie });
    expect(foreign.statusCode).toBe(404);

    for (const key of ['envelope-balances', 'savings-reallocation-by-cycle', 'nope']) {
      const response = await get(w, key);
      expect(response.statusCode, key).toBe(400);
    }
    expect((await get(w, 'savings-goals', '?from=2026-03-10&to=2026-03-01')).statusCode).toBe(400);
    expect((await get(w, 'savings-goals', '?categoryId=not-a-uuid')).statusCode).toBe(400);
    expect((await get(w, 'savings-goals', '', { budgetId: 'not-a-uuid' })).statusCode).toBe(400);
  });

  it('OpenAPI описывает GET /api/v2/budgets/{budgetId}/reports/{key}, фильтры и ошибки', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<
        string,
        Record<
          string,
          {
            parameters?: Array<{ name: string; in: string; required?: boolean }>;
            responses: Record<string, unknown>;
          }
        >
      >;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    }>();
    const operation = document.paths['/api/v2/budgets/{budgetId}/reports/{key}']?.get;
    expect(operation).toBeDefined();
    expect(operation!.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'budgetId', in: 'path', required: true }),
        expect.objectContaining({ name: 'key', in: 'path', required: true }),
        expect.objectContaining({ name: 'from', in: 'query' }),
        expect.objectContaining({ name: 'to', in: 'query' }),
        expect.objectContaining({ name: 'categoryId', in: 'query' }),
        expect.objectContaining({ name: 'accountId', in: 'query' }),
        expect.objectContaining({ name: 'envelopeId', in: 'query' }),
      ]),
    );
    for (const status of ['200', '400', '401', '404', '409']) {
      expect(operation!.responses[status]).toBeDefined();
    }
    const names = Object.keys(document.components.schemas).filter((name) =>
      name.startsWith('ReportV2'),
    );
    expect(names.length).toBeGreaterThan(8);
    const text = JSON.stringify(names.map((name) => document.components.schemas[name]));
    expect(text).not.toContain('envelope-balances');
    expect(document.paths['/api/v1/budgets/{budgetId}/reports/{reportKey}']).toBeUndefined();
  });
});

const ALL_KEYS = [
  'account-balances',
  'expenses-by-category',
  'expenses-by-period',
  'expenses-by-cycle',
  'incomes-by-cycle',
  'net-cash-flow',
  'savings-goals',
  'plan-vs-actual',
  'assignment-movements',
  'envelope-limits',
  'period-comparison',
];

const DISALLOWED_FILTERS: Record<string, string[]> = {
  'envelope-limits': ['accountId', 'categoryId'],
  'period-comparison': ['accountId', 'categoryId', 'envelopeId'],
};

describe('v2 reports (P03 review hardening)', () => {
  it('savings-goals: нулевая цель не роняет отчёт; прогресс ограничен 0..1000', async () => {
    const w = await world();
    const zero = await envelope(w, 'SAVINGS_GOAL', 'Нулевая', undefined, 0n);
    const negativeZero = await envelope(w, 'SAVINGS_GOAL', 'Нулевая минус', undefined, 0n);
    await assign(w, zero, null, 100_000n, 'OPENING');
    await expense(w, negativeZero, 50_000n, '2026-03-05');
    await assign(w, w.goalEnvelopeId, null, 200_000n, 'OPENING');
    await expense(w, w.goalEnvelopeId, 500_000n, '2026-03-05'); // перерасход: -300 000
    const reached = await envelope(w, 'SAVINGS_GOAL', 'Достигнута', undefined, 1_000_000n);
    await assign(w, reached, null, 1_500_000n, 'OPENING');

    const response = await get(w, 'savings-goals');
    expect(response.statusCode, response.body).toBe(200);
    const byId = new Map(
      response.json<{ rows: Row[] }>().rows.map((row) => [row.envelopeId as string, row]),
    );
    expect(byId.get(zero)).toMatchObject({
      currentMinor: '100000',
      progressPermille: 1000,
      isReached: true,
      remainingMinor: '0',
    });
    expect(byId.get(negativeZero)).toMatchObject({
      currentMinor: '-50000',
      progressPermille: 0,
      isReached: false,
      remainingMinor: '50000',
    });
    expect(byId.get(w.goalEnvelopeId)).toMatchObject({
      currentMinor: '-300000',
      progressPermille: 0,
      isReached: false,
      remainingMinor: '1300000',
    });
    expect(byId.get(reached)).toMatchObject({
      currentMinor: '1500000',
      progressPermille: 1000,
      isReached: true,
      remainingMinor: '0',
    });
  });

  it('изоляция: данные бюджета B не попадают ни в один отчёт бюджета A', async () => {
    const a = await world();
    const b = await world();
    await assign(a, a.goalEnvelopeId, null, 800_000n, 'OPENING');
    await income(a, 1_000_000n, '2026-03-02');
    await expense(a, a.mainEnvelopeId, 100_000n, '2026-03-05');
    await addPeriod(a, a.mainEnvelopeId, '2026-03-01', '2026-03-14');
    const own = await occurrence(a, 2_000_000n, '2026-03-12');
    await payment(
      a,
      own.occurrenceId,
      await expense(a, a.mandatoryEnvelopeId, 2_000_000n, '2026-03-12'),
    );

    await assign(b, b.goalEnvelopeId, null, 777_777n, 'OPENING');
    await movement(b, b.mainEnvelopeId, b.mandatoryEnvelopeId, 555_555n, '2026-03-02');
    await income(b, 888_888n, '2026-03-02');
    await expense(b, b.mainEnvelopeId, 666_666n, '2026-03-05');
    await addPeriod(b, b.mainEnvelopeId, '2026-02-01', '2026-02-10');
    await expense(b, b.mainEnvelopeId, 444_444n, '2026-02-05');
    await directTransfer(b, 333_333n, '2026-03-04');
    await legacyTransfer(b, 222_222n, '2026-03-03');
    const foreign = await occurrence(b, 999_999n, '2026-03-12');
    await payment(
      b,
      foreign.occurrenceId,
      await expense(b, b.mandatoryEnvelopeId, 123_456n, '2026-03-12'),
    );

    const foreignTokens = [
      b.accountId,
      b.secondAccountId,
      b.categoryId,
      b.otherCategoryId,
      b.incomeCategoryId,
      b.mainEnvelopeId,
      b.mandatoryEnvelopeId,
      b.goalEnvelopeId,
      foreign.planId,
      foreign.occurrenceId,
      '777777',
      '555555',
      '888888',
      '666666',
      '444444',
      '333333',
      '222222',
      '999999',
      '123456',
      '2026-02-01',
    ];
    for (const key of ALL_KEYS) {
      const response = await get(a, key);
      expect(response.statusCode, key).toBe(200);
      for (const token of foreignTokens) {
        expect(response.body.includes(token), `${key} leaks ${token}`).toBe(false);
      }
    }
  });

  it('404 на чужой/несуществующий categoryId, accountId, envelopeId для всех ключей', async () => {
    const a = await world();
    const b = await world();
    for (const key of ALL_KEYS) {
      for (const query of [
        `?categoryId=${b.categoryId}`,
        `?accountId=${b.accountId}`,
        `?envelopeId=${b.mainEnvelopeId}`,
        `?categoryId=${randomUUID()}`,
        `?accountId=${randomUUID()}`,
        `?envelopeId=${randomUUID()}`,
      ]) {
        const filterName = query.slice(1, query.indexOf('='));
        if (DISALLOWED_FILTERS[key]?.includes(filterName)) continue;
        const response = await get(a, key, query);
        expect(response.statusCode, `${key}${query}`).toBe(404);
        expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
      }
    }
  });

  it('plan-vs-actual: без оплат, SKIPPED/CANCELLED, доходный план, from/to', async () => {
    const w = await world();
    const unpaid = await planOccurrence(w, 'Без оплат', 'EXPENSE', 300_000n, '2026-03-10', 'DUE');
    const skipped = await planOccurrence(
      w,
      'Пропущен',
      'EXPENSE',
      100_000n,
      '2026-03-11',
      'SKIPPED',
    );
    await planOccurrence(w, 'Отменён', 'EXPENSE', 900_000n, '2026-03-12', 'CANCELLED');
    const salary = await planOccurrence(w, 'Зарплата', 'INCOME', 5_000_000n, '2026-03-20', 'DUE');
    await prisma.transaction
      .create({
        data: {
          id: randomUUID(),
          budgetId: w.budgetId,
          transactionType: 'INCOME',
          status: 'CONFIRMED',
          accountingModelVersion: 2,
          amountMinor: 5_000_000n,
          occurredOn: day('2026-03-20'),
          confirmedAt: new Date(),
          categoryId: w.incomeCategoryId,
          accountId: w.accountId,
          createdByUserId: w.userId,
          updatedByUserId: w.userId,
        },
      })
      .then((row) => payment(w, salary.occurrenceId, row.id));

    const all = new Map(
      (await rows(w, 'plan-vs-actual', '?from=2026-03-01&to=2026-03-31')).map((row) => [
        row.planId,
        row,
      ]),
    );
    expect(all.size).toBe(3);
    expect(all.get(unpaid.planId)).toMatchObject({
      plannedMinor: '300000',
      actualMinor: '0',
      varianceMinor: '-300000',
      confirmedOccurrenceCount: 0,
    });
    expect(all.get(skipped.planId)).toMatchObject({ plannedMinor: '100000', actualMinor: '0' });
    expect(all.get(salary.planId)).toMatchObject({
      planType: 'INCOME',
      plannedMinor: '5000000',
      actualMinor: '5000000',
      varianceMinor: '0',
      confirmedOccurrenceCount: 1,
    });

    const dated = await rows(w, 'plan-vs-actual', '?from=2026-03-15&to=2026-03-31');
    expect(dated.map((row) => row.planId)).toEqual([salary.planId]);
  });

  it('plan-vs-actual: без from/to считает только текущий финансовый цикл, не все материализованные occurrence', async () => {
    const w = await world();
    const { planId } = await occurrence(w, 1_100_000n, todayUtc());
    await occurrence(w, 1_100_000n, firstDayOfMonth(1), planId);
    await occurrence(w, 1_100_000n, firstDayOfMonth(2), planId);

    const undated = await rows(w, 'plan-vs-actual');
    const row = undated.find((row) => row.planId === planId);
    expect(row).toMatchObject({ plannedOccurrenceCount: 1, plannedMinor: '1100000' });

    const dated = await rows(w, 'plan-vs-actual', `?from=${monthStart(0)}&to=${monthEnd(2)}`);
    const datedRow = dated.find((row) => row.planId === planId);
    expect(datedRow).toMatchObject({ plannedOccurrenceCount: 3, plannedMinor: '3300000' });
  });

  it('account-balances: отменённые/удалённые переводы и операции не влияют, legacy-перевод из нескольких частей', async () => {
    const w = await world();
    for (const status of ['CANCELLED', 'DRAFT'] as const) {
      await expense(w, w.mainEnvelopeId, 900_000n, '2026-03-02', { status });
    }
    await expense(w, w.mainEnvelopeId, 900_000n, '2026-03-02', { status: 'DELETED' });
    for (const status of ['CANCELLED', 'DRAFT'] as const) {
      await prisma.transfer.create({
        data: {
          id: randomUUID(),
          budgetId: w.budgetId,
          status,
          mode: 'ACCOUNT_ONLY',
          totalMinor: 400_000n,
          ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
          occurredOn: day('2026-03-03'),
          sourceAccountId: w.accountId,
          destinationAccountId: w.secondAccountId,
          createdByUserId: w.userId,
          updatedByUserId: w.userId,
        },
      });
    }
    const transferId = randomUUID();
    await prisma.transfer.create({
      data: {
        id: transferId,
        budgetId: w.budgetId,
        status: 'CONFIRMED',
        mode: 'LEGACY_PARTS',
        totalMinor: 150_000n,
        occurredOn: day('2026-03-04'),
        confirmedAt: new Date(),
        createdByUserId: w.userId,
        updatedByUserId: w.userId,
      },
    });
    for (const amountMinor of [100_000n, 50_000n]) {
      await prisma.transferPart.create({
        data: {
          id: randomUUID(),
          transferId,
          budgetId: w.budgetId,
          sourceAccountId: w.accountId,
          destinationAccountId: w.secondAccountId,
          sourceEnvelopeId: w.mainEnvelopeId,
          destinationEnvelopeId: w.mainEnvelopeId,
          amountMinor,
        },
      });
    }
    const byId = new Map(
      (await rows(w, 'account-balances')).map((row) => [row.accountId, row.balanceMinor]),
    );
    expect(byId.get(w.accountId)).toBe('850000');
    expect(byId.get(w.secondAccountId)).toBe('150000');
  });

  it('OpenAPI: обязательные поля строк и денежные поля-строки', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      components: {
        schemas: Record<
          string,
          { required?: string[]; properties?: Record<string, { type?: string }> }
        >;
      };
    }>();
    const expectations: Record<string, { required: string[]; money: string[] }> = {
      ReportV2SavingsGoalRow: {
        required: ['envelopeId', 'currentMinor', 'targetMinor', 'progressPermille', 'isReached'],
        money: ['currentMinor', 'targetMinor', 'assignedMinor', 'movedNetMinor', 'spentMinor'],
      },
      ReportV2PlanVsActualRow: {
        required: ['planId', 'plannedMinor', 'actualMinor', 'varianceMinor'],
        money: ['plannedMinor', 'actualMinor', 'varianceMinor'],
      },
      ReportV2AssignmentMovementRow: {
        required: ['kind', 'id', 'effectiveOn', 'amountMinor', 'countsAsAccumulation'],
        money: ['amountMinor'],
      },
      ReportV2EnvelopeLimitRow: {
        required: ['periodId', 'envelopeId', 'spentMinor', 'overspentMinor', 'isCurrent'],
        money: ['spentMinor', 'overspentMinor'],
      },
      ReportV2PeriodComparisonRow: {
        required: ['asOf', 'periodStart', 'spentMinor', 'deltaMinor', 'previousSameDaySpentMinor'],
        money: ['spentMinor', 'deltaMinor', 'previousSameDaySpentMinor', 'previousTotalSpentMinor'],
      },
    };
    for (const [name, expected] of Object.entries(expectations)) {
      const schema = document.components.schemas[name];
      expect(schema, name).toBeDefined();
      expect(schema!.required ?? []).toEqual(expect.arrayContaining(expected.required));
      for (const field of expected.money) {
        expect(schema!.properties?.[field]?.type, `${name}.${field}`).toBe('string');
      }
    }
  });
});

describe('v2 reports: аналитика', () => {
  it('envelope-limits: лимит, перерасход, без лимита; только конверты на текущие траты и v2-расходы', async () => {
    const w = await world();
    const march = await addLimitPeriod(w, w.mainEnvelopeId, '2026-03-01', '2026-03-14', 1_000_000n);
    const unset = await addLimitPeriod(
      w,
      w.mainEnvelopeId,
      '2026-03-15',
      '2026-03-31',
      null,
      'UNSET',
    );
    await addLimitPeriod(w, w.mandatoryEnvelopeId, '2026-03-01', '2026-03-14', 5_000n);
    await expense(w, w.mainEnvelopeId, 1_200_000n, '2026-03-05');
    await expense(w, w.mainEnvelopeId, 70_000n, '2026-03-20');
    await expense(w, w.mainEnvelopeId, 900_000n, '2026-03-06', { status: 'DRAFT' });
    await expense(w, w.mainEnvelopeId, 900_000n, '2026-03-07', { modelVersion: 1 });

    const list = await rows(w, 'envelope-limits', '?from=2026-03-01&to=2026-03-31');
    expect(list.map((row) => row.periodId)).toEqual([unset, march]);
    expect(list[1]).toMatchObject({
      envelopeId: w.mainEnvelopeId,
      envelopeName: 'Текущий',
      targetMinor: '1000000',
      targetStatus: 'CONFIRMED',
      spentMinor: '1200000',
      remainingMinor: '-200000',
      overspentMinor: '200000',
      spentPermille: 1200,
      isCurrent: false,
    });
    expect(list[0]).toMatchObject({
      targetMinor: null,
      spentMinor: '70000',
      remainingMinor: null,
      spentPermille: null,
    });
  });

  it('envelope-limits: «потрачено» совпадает со страницей конвертов', async () => {
    const w = await world();
    const periodId = await addLimitPeriod(
      w,
      w.mainEnvelopeId,
      '2026-03-01',
      '2026-03-14',
      500_000n,
    );
    await expense(w, w.mainEnvelopeId, 123_400n, '2026-03-05');
    const [limit] = await rows(w, 'envelope-limits', '?from=2026-03-01&to=2026-03-14');
    const envelopes = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${w.budgetId}/envelopes`,
      headers: { origin, cookie: `harmofin_session=${w.cookie}` },
    });
    const main = envelopes
      .json<{
        items: Array<{ id: string; periods?: Array<{ periodId: string; spentMinor: string }> }>;
      }>()
      .items.find((item) => item.id === w.mainEnvelopeId);
    const period = main?.periods?.find((item) => item.periodId === periodId);
    expect(period?.spentMinor).toBe('123400');
    expect(limit?.spentMinor).toBe(period?.spentMinor);
  });

  it('envelope-limits: текущий период отмечен isCurrent, будущие периоды не попадают', async () => {
    const w = await world();
    const today = new Date().toISOString().slice(0, 10);
    const current = await addLimitPeriod(w, w.mainEnvelopeId, today, today, 1n);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await addLimitPeriod(w, w.mainEnvelopeId, tomorrow, tomorrow, 1n);
    const list = await rows(w, 'envelope-limits');
    expect(list.map((row) => [row.periodId, row.isCurrent])).toEqual([[current, true]]);
  });

  it('period-comparison: то же число дней прошлого периода, лимит текущего периода', async () => {
    const w = await world();
    await addLimitPeriod(w, w.mainEnvelopeId, '2026-03-01', '2026-03-14', 0n);
    await addLimitPeriod(w, w.mainEnvelopeId, '2026-03-15', '2026-03-31', 500_000n);
    await expense(w, w.mainEnvelopeId, 100_000n, '2026-03-03');
    await expense(w, w.mainEnvelopeId, 50_000n, '2026-03-10');
    await expense(w, null, 80_000n, '2026-03-16');
    await expense(w, w.mainEnvelopeId, 999n, '2026-03-25');
    await expense(w, w.mainEnvelopeId, 5_000n, '2026-03-17', { status: 'DELETED' });

    const [row] = await rows(w, 'period-comparison', '?to=2026-03-20');
    expect(row).toEqual({
      asOf: '2026-03-20',
      periodStart: '2026-03-15',
      periodEnd: '2026-03-31',
      daysElapsed: 6,
      spentMinor: '80000',
      limitTotalMinor: '500000',
      spentOfLimitPermille: 160,
      previousPeriodStart: '2026-03-01',
      previousPeriodEnd: '2026-03-14',
      previousSameDaySpentMinor: '100000',
      previousTotalSpentMinor: '150000',
      deltaMinor: '-20000',
      deltaBasisPoints: -2000,
    });
  });

  it('period-comparison: пустой прошлый период и нет лимитов', async () => {
    const w = await world();
    await expense(w, w.mainEnvelopeId, 10_000n, '2026-03-16');
    const [row] = await rows(w, 'period-comparison', '?to=2026-03-20');
    expect(row).toMatchObject({
      periodStart: '2026-03-15',
      previousPeriodStart: '2026-03-01',
      previousSameDaySpentMinor: '0',
      deltaBasisPoints: null,
      limitTotalMinor: null,
    });
  });

  it('неприменимые фильтры новых ключей дают 400 VALIDATION_FAILED', async () => {
    const w = await world();
    for (const [key, query] of [
      ['period-comparison', '?from=2026-03-01'],
      ['period-comparison', `?accountId=${w.accountId}`],
      ['period-comparison', `?envelopeId=${w.mainEnvelopeId}`],
      ['envelope-limits', `?categoryId=${w.categoryId}`],
      ['envelope-limits', `?accountId=${w.accountId}`],
    ] as const) {
      const response = await get(w, key, query);
      expect(response.statusCode, `${key}${query}`).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('VIEWER читает envelope-limits и period-comparison', async () => {
    const w = await world();
    await addLimitPeriod(w, w.mainEnvelopeId, '2026-03-01', '2026-03-14', 500_000n);
    const viewer = await addMember(w, 'VIEWER');
    const limits = await get(w, 'envelope-limits', '', { cookie: viewer.cookie });
    expect(limits.statusCode).toBe(200);
    expect(limits.json<{ key: string }>().key).toBe('envelope-limits');
    const comparison = await get(w, 'period-comparison', '', { cookie: viewer.cookie });
    expect(comparison.statusCode).toBe(200);
    expect(comparison.json<{ key: string }>().key).toBe('period-comparison');
  });

  it('period-comparison: границы периодов берутся из настроек, действовавших в датах истории, а не текущих настроек бюджета', async () => {
    const w = await world();
    // Текущие настройки бюджета сменились (c 10-го числа), но март ещё жил под старыми (ревизия A).
    await prisma.budget.update({
      where: { id: w.budgetId },
      data: { cycleStartDay: 10, periodBoundaryOffset: 14 },
    });
    await revision(w, '2026-01-01', 1, 14);
    await expense(w, w.mainEnvelopeId, 100_000n, '2026-03-16');

    const [row] = await rows(w, 'period-comparison', '?to=2026-03-20');
    expect(row).toMatchObject({
      periodStart: '2026-03-15',
      periodEnd: '2026-03-31',
      previousPeriodStart: '2026-03-01',
      previousPeriodEnd: '2026-03-14',
    });
  });

  it('expenses-by-category: доля категории в базисных пунктах', async () => {
    const w = await world();
    await expense(w, null, 300_000n, '2026-03-05');
    await expense(w, null, 100_000n, '2026-03-05', { categoryId: w.otherCategoryId });
    const list = await rows(w, 'expenses-by-category');
    expect(list.map((row) => [row.categoryId, row.shareBasisPoints])).toEqual([
      [w.categoryId, 7500],
      [w.otherCategoryId, 2500],
    ]);
  });
});

async function planOccurrence(
  w: World,
  name: string,
  planType: 'INCOME' | 'EXPENSE',
  amountMinor: bigint,
  scheduledOn: string,
  status: 'DUE' | 'SKIPPED' | 'CANCELLED',
) {
  const planId = randomUUID();
  await prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: w.workspaceId,
      budgetId: w.budgetId,
      ownerUserId: w.userId,
      name,
      planType,
      amountMinor,
      anchorOn: day(scheduledOn),
      startOn: day(scheduledOn),
      recurrence: 'ONE_TIME',
      envelopeId: planType === 'EXPENSE' ? w.mandatoryEnvelopeId : null,
      accountId: planType === 'INCOME' ? w.accountId : null,
      categoryId: planType === 'INCOME' ? w.incomeCategoryId : null,
      isActive: true,
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
  const row = await prisma.planOccurrence.create({
    data: {
      id: randomUUID(),
      workspaceId: w.workspaceId,
      budgetId: w.budgetId,
      planId,
      scheduledOn: day(scheduledOn),
      planName: name,
      planType,
      amountMinor,
      envelopeId: planType === 'EXPENSE' ? w.mandatoryEnvelopeId : null,
      accountId: planType === 'INCOME' ? w.accountId : null,
      categoryId: planType === 'INCOME' ? w.incomeCategoryId : null,
      status,
      ...(status === 'SKIPPED' ? { skippedAt: new Date() } : {}),
      ...(status === 'CANCELLED'
        ? { cancelledAt: new Date(), cancellationReason: 'PLAN_CHANGED' as const }
        : {}),
    },
  });
  return { occurrenceId: row.id, planId };
}

async function get(
  w: World,
  key: string,
  query = '',
  options: { cookie?: string | null; budgetId?: string } = {},
) {
  const cookie = options.cookie === undefined ? w.cookie : options.cookie;
  return server.inject({
    method: 'GET',
    url: `/api/v2/budgets/${options.budgetId ?? w.budgetId}/reports/${key}${query}`,
    headers: cookie ? { origin, cookie: `harmofin_session=${cookie}` } : { origin },
  });
}

async function rows(w: World, key: string, query = ''): Promise<Row[]> {
  const response = await get(w, key, query);
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json<{ key: string; rows: Row[] }>();
  expect(body.key).toBe(key);
  return body.rows;
}

async function world(options: { planModelVersion?: 1 | 2 } = {}): Promise<World> {
  const registered = await register(`v2-rep-${randomUUID()}@harmofin.test`);
  const version = options.planModelVersion ?? 2;
  await prisma.budget.update({
    where: { id: registered.budgetId },
    data: {
      planModelVersion: version,
      planModelActivatedOn: version === 2 ? day('2026-01-01') : null,
      timezone: 'UTC',
      cycleStartDay: 1,
      periodBoundaryOffset: 14,
    },
  });
  const account = (name: string, startingBalanceMinor: bigint) =>
    prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: registered.budgetId,
        ownerUserId: registered.userId,
        name,
        accountType: 'BANK_ACCOUNT',
        startingBalanceMinor,
        accountingStartDate: day('2026-01-01'),
      },
    });
  const category = (name: string, categoryType: 'EXPENSE' | 'INCOME', order: number) =>
    prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: registered.budgetId,
        name,
        categoryType,
        displayOrder: order,
      },
    });
  const first = await account('Основной счёт', 1_000_000n);
  const second = await account('Накопительный счёт', 0n);
  const food = await category('Еда', 'EXPENSE', 900);
  const other = await category('Транспорт', 'EXPENSE', 901);
  const salary = await category('Зарплата', 'INCOME', 902);
  const partial = {
    ...registered,
    accountId: first.id,
    secondAccountId: second.id,
    categoryId: food.id,
    otherCategoryId: other.id,
    incomeCategoryId: salary.id,
    mainEnvelopeId: '',
    mandatoryEnvelopeId: '',
    goalEnvelopeId: '',
  };
  partial.mainEnvelopeId = await envelope(partial, 'CURRENT_EXPENSES', 'Текущий', 'FIRST');
  partial.mandatoryEnvelopeId = await envelope(partial, 'MANDATORY_EXPENSES', 'Обязательные');
  partial.goalEnvelopeId = await envelope(partial, 'SAVINGS_GOAL', 'Отпуск', undefined, 1_000_000n);
  return partial;
}

async function envelope(
  w: { budgetId: string; userId: string },
  envelopeType: 'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'SAVINGS_GOAL',
  name: string,
  periodSlot?: 'FIRST' | 'SECOND',
  targetAmountMinor?: bigint,
): Promise<string> {
  const created = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      ownerUserId: w.userId,
      name,
      envelopeType,
      startingBalanceMinor: 0n,
      displayOrder: 950,
      ...(periodSlot ? { periodSlot } : {}),
      ...(targetAmountMinor !== undefined ? { targetAmountMinor } : {}),
    },
  });
  return created.id;
}

async function addLimitPeriod(
  w: World,
  envelopeId: string,
  start: string,
  end: string,
  targetMinor: bigint | null,
  targetStatus: 'UNSET' | 'DRAFT' | 'CONFIRMED' = 'CONFIRMED',
): Promise<string> {
  const id = randomUUID();
  await prisma.envelopePeriod.create({
    data: {
      id,
      budgetId: w.budgetId,
      envelopeId,
      startsOn: day(start),
      endsOn: day(end),
      targetStatus,
      targetMinor,
      ...(targetStatus === 'CONFIRMED'
        ? { confirmedByUserId: w.userId, confirmedAt: new Date() }
        : {}),
    },
  });
  return id;
}

async function addPeriod(w: World, envelopeId: string, start: string, end: string) {
  await prisma.envelopePeriod.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      envelopeId,
      startsOn: day(start),
      endsOn: day(end),
      targetStatus: 'CONFIRMED',
      targetMinor: 0n,
      confirmedByUserId: w.userId,
      confirmedAt: new Date(),
    },
  });
}

async function revision(w: World, effectiveOn: string, cycleStartDay: number, offset: number) {
  await prisma.budgetCycleRevision.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      effectiveOn: day(effectiveOn),
      cycleStartDay,
      periodBoundaryOffset: offset,
      timezone: 'UTC',
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
}

async function assign(
  w: World,
  envelopeId: string,
  periodId: string | null,
  amountMinor: bigint,
  type: 'OPENING' | 'FREE' | 'INCOME',
  status: 'CONFIRMED' | 'DELETED' = 'CONFIRMED',
) {
  await prisma.envelopeAssignment.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      envelopeId,
      type,
      amountMinor,
      effectiveOn: day('2026-03-01'),
      periodId,
      status,
      createdByUserId: w.userId,
    },
  });
}

async function movement(
  w: World,
  sourceEnvelopeId: string,
  destinationEnvelopeId: string,
  amountMinor: bigint,
  effectiveOn: string,
  status: 'CONFIRMED' | 'DELETED' = 'CONFIRMED',
) {
  await prisma.envelopeMovement.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      sourceEnvelopeId,
      destinationEnvelopeId,
      amountMinor,
      effectiveOn: day(effectiveOn),
      status,
      createdByUserId: w.userId,
    },
  });
}

async function expense(
  w: World,
  envelopeId: string | null,
  amountMinor: bigint,
  occurredOn: string,
  options: {
    status?: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';
    modelVersion?: 1 | 2;
    categoryId?: string;
    accountId?: string;
  } = {},
): Promise<string> {
  const status = options.status ?? 'CONFIRMED';
  const row = await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      transactionType: 'EXPENSE',
      status,
      accountingModelVersion: options.modelVersion ?? 2,
      amountMinor,
      occurredOn: day(occurredOn),
      confirmedAt: status === 'CONFIRMED' ? new Date() : null,
      cancelledAt: status === 'CANCELLED' ? new Date() : null,
      deletedAt: status === 'DELETED' ? new Date() : null,
      preDeleteStatus: status === 'DELETED' ? 'CONFIRMED' : null,
      categoryId: options.categoryId ?? w.categoryId,
      accountId: options.accountId ?? w.accountId,
      envelopeId,
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
  return row.id;
}

async function income(
  w: World,
  amountMinor: bigint,
  occurredOn: string,
  status: 'CONFIRMED' | 'DRAFT' = 'CONFIRMED',
) {
  await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      transactionType: 'INCOME',
      status,
      accountingModelVersion: 2,
      amountMinor,
      occurredOn: day(occurredOn),
      confirmedAt: status === 'CONFIRMED' ? new Date() : null,
      categoryId: w.incomeCategoryId,
      accountId: w.accountId,
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
}

async function legacyTransfer(w: World, amountMinor: bigint, occurredOn: string) {
  const id = randomUUID();
  await prisma.transfer.create({
    data: {
      id,
      budgetId: w.budgetId,
      status: 'CONFIRMED',
      mode: 'LEGACY_PARTS',
      totalMinor: amountMinor,
      occurredOn: day(occurredOn),
      confirmedAt: new Date(),
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
  await prisma.transferPart.create({
    data: {
      id: randomUUID(),
      transferId: id,
      budgetId: w.budgetId,
      sourceAccountId: w.accountId,
      destinationAccountId: w.secondAccountId,
      sourceEnvelopeId: w.mainEnvelopeId,
      destinationEnvelopeId: w.mainEnvelopeId,
      amountMinor,
    },
  });
}

async function directTransfer(
  w: World,
  amountMinor: bigint,
  occurredOn: string,
  status: 'CONFIRMED' | 'DRAFT' = 'CONFIRMED',
) {
  await prisma.transfer.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      status,
      mode: 'ACCOUNT_ONLY',
      totalMinor: amountMinor,
      occurredOn: day(occurredOn),
      confirmedAt: status === 'CONFIRMED' ? new Date() : null,
      sourceAccountId: w.accountId,
      destinationAccountId: w.secondAccountId,
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
}

async function occurrence(
  w: World,
  amountMinor: bigint,
  scheduledOn: string,
  existingPlanId?: string,
) {
  const planId = existingPlanId ?? randomUUID();
  if (!existingPlanId) {
    await prisma.regularPlan.create({
      data: {
        id: planId,
        workspaceId: w.workspaceId,
        budgetId: w.budgetId,
        ownerUserId: w.userId,
        name: 'Аренда',
        planType: 'EXPENSE',
        amountMinor,
        anchorOn: day(scheduledOn),
        startOn: day(scheduledOn),
        recurrence: 'ONE_TIME',
        envelopeId: w.mandatoryEnvelopeId,
        isActive: true,
        createdByUserId: w.userId,
        updatedByUserId: w.userId,
      },
    });
  }
  const row = await prisma.planOccurrence.create({
    data: {
      id: randomUUID(),
      workspaceId: w.workspaceId,
      budgetId: w.budgetId,
      planId,
      scheduledOn: day(scheduledOn),
      planName: 'Аренда',
      planType: 'EXPENSE',
      amountMinor,
      envelopeId: w.mandatoryEnvelopeId,
      status: 'DUE',
    },
  });
  return { occurrenceId: row.id, planId };
}

async function payment(w: World, occurrenceId: string, transactionId: string) {
  await prisma.planPayment.create({
    data: { id: randomUUID(), budgetId: w.budgetId, occurrenceId, transactionId },
  });
}

async function addMember(
  w: World,
  role: 'VIEWER' | 'EDITOR',
): Promise<{ userId: string; cookie: string }> {
  const member = await register(`v2-rep-${randomUUID()}@harmofin.test`);
  await prisma.workspaceMembership.create({
    data: { id: randomUUID(), workspaceId: w.workspaceId, userId: member.userId, role },
  });
  return { userId: member.userId, cookie: member.cookie };
}

async function register(email: string): Promise<{
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
}> {
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
  }>();
  createdUsers.push(body.user.id);
  const raw = response.headers['set-cookie'];
  const setCookie = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  const match = /harmofin_session=([^;]+)/.exec(setCookie);
  expect(match).not.toBeNull();
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    cookie: decodeURIComponent(match![1]!),
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
