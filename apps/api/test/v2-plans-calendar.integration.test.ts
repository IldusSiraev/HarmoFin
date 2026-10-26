import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { PlanModelPolicy } from '../src/common/plan-model/plan-model.policy.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PlansCalendarApplicationService } from '../src/plans-calendar/plans-calendar.application.service.js';
import { PlansCalendarRepository } from '../src/plans-calendar/plans-calendar.repository.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

type World = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  accountId: string;
  categoryId: string;
  incomeCategoryId: string;
  mainEnvelopeId: string;
  mandatoryEnvelopeId: string;
  cookie: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let servicePrisma: PrismaService;
const createdUsers: string[] = [];

async function getCalendar(
  w: World,
  query = '?month=2026-09',
  options: { cookie?: string | null; budgetId?: string } = {},
) {
  const cookie = options.cookie === undefined ? w.cookie : options.cookie;
  return server.inject({
    method: 'GET',
    url: `/api/v2/budgets/${options.budgetId ?? w.budgetId}/plans/calendar${query}`,
    headers: cookie ? { origin, cookie: `harmofin_session=${cookie}` } : { origin },
  });
}

type CalendarBody = {
  month: string;
  today: string;
  days: Array<{ date: string; incomeMinor: string; expenseMinor: string; dot: string | null }>;
  items: Array<{
    kind: string;
    occurrenceId: string;
    scheduledOn: string;
    status: string;
    expectedMinor: string;
    paidMinor: string;
    overdue: boolean;
    factOn: string | null;
    factMinor: string | null;
    factTransactionIds: string[];
  }>;
  overdue: Array<{ occurrenceId: string; scheduledOn: string }>;
  overdueCount: number;
  totals: {
    plannedIncomeMinor: string;
    plannedExpenseMinor: string;
    balanceMinor: string;
    activePlanCount: number;
  };
};

const monthShift = (months: number) => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
  return d.toISOString().slice(0, 7);
};
const dayOf = (body: CalendarBody, date: string) => body.days.find((d) => d.date === date);

describe('v2 plans calendar (GET /api/v2/budgets/:id/plans/calendar)', () => {
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
    servicePrisma = new PrismaService(databaseUrl);
  });

  it('факты по дням: доходы и расходы суммируются на день', async () => {
    const w = await world(10_000_000n);
    await expense(w, w.mainEnvelopeId, 600_000n, '2026-09-05');
    await expense(w, w.mainEnvelopeId, 100_000n, '2026-09-05');
    await income(w, 4_300_000n, '2026-09-05');
    const response = await getCalendar(w);
    expect(response.statusCode).toBe(200);
    const body = response.json<CalendarBody>();
    expect(body.month).toBe('2026-09');
    expect(body.days.map((d) => d.date)).toEqual(['2026-09-05']);
    expect(dayOf(body, '2026-09-05')).toMatchObject({
      incomeMinor: '4300000',
      expenseMinor: '700000',
    });
  });

  it('только CONFIRMED и только запрошенный месяц', async () => {
    const w = await world(10_000_000n);
    for (const status of ['DRAFT', 'CANCELLED', 'DELETED'] as const) {
      await expense(w, w.mainEnvelopeId, 1_000_000n, '2026-09-07', status);
      await income(w, 2_000_000n, '2026-09-07', status);
    }
    await expense(w, w.mainEnvelopeId, 500_000n, '2026-08-31');
    await income(w, 800_000n, '2026-10-01');
    const body = (await getCalendar(w)).json<CalendarBody>();
    expect(body.days).toEqual([]);
  });

  it('планы и итоги месяца: CANCELLED и SKIPPED не входят в суммы', async () => {
    const w = await world(10_000_000n);
    await occurrence(w, 300_000n, '2026-09-10', { status: 'DUE' });
    await occurrence(w, 4_000_000n, '2026-09-11', { status: 'COMPLETED' });
    await occurrence(w, 777n, '2026-09-12', { status: 'SKIPPED' });
    await occurrence(w, 10_000_000n, '2026-09-25', { planType: 'INCOME', status: 'PENDING' });
    await occurrence(w, 999n, '2026-09-26', { planType: 'INCOME', status: 'CANCELLED' });
    const body = (await getCalendar(w)).json<CalendarBody>();
    expect(body.totals).toEqual({
      plannedIncomeMinor: '10000000',
      plannedExpenseMinor: '4300000',
      balanceMinor: '5700000',
      activePlanCount: 5,
    });
    expect(body.items).toHaveLength(5);
  });

  it('выполненный план показывается один раз — в день операции, которая его закрыла', async () => {
    const w = await world(10_000_000n);
    // Paid a day early, a day late, and in the previous month for a plan of this month.
    const early = await occurrence(w, 1_000_000n, '2026-09-25', { status: 'COMPLETED' });
    const earlyTx = await expense(w, w.mandatoryEnvelopeId, 1_000_000n, '2026-09-24');
    await payment(w, early, earlyTx);
    const late = await occurrence(w, 600_000n, '2026-09-24', { status: 'COMPLETED' });
    const lateA = await expense(w, w.mandatoryEnvelopeId, 200_000n, '2026-09-24');
    const lateB = await expense(w, w.mandatoryEnvelopeId, 400_000n, '2026-09-25');
    await payment(w, late, lateA);
    await payment(w, late, lateB);
    const cancelledTx = await expense(w, w.mandatoryEnvelopeId, 1n, '2026-09-26', 'CANCELLED');
    await payment(w, late, cancelledTx);
    const incomeTx = await income(w, 9_000_000n, '2026-09-10');
    const received = await occurrence(w, 10_000_000n, '2026-09-11', {
      planType: 'INCOME',
      status: 'COMPLETED',
      transactionId: incomeTx,
    });
    const nextMonth = await occurrence(w, 300_000n, '2026-10-01', { status: 'COMPLETED' });
    const nextMonthTx = await expense(w, w.mandatoryEnvelopeId, 300_000n, '2026-09-30');
    await payment(w, nextMonth, nextMonthTx);
    const bare = await occurrence(w, 100_000n, '2026-09-12', { status: 'COMPLETED' });

    const body = (await getCalendar(w)).json<CalendarBody>();
    const byId = Object.fromEntries(body.items.map((item) => [item.occurrenceId, item]));
    expect(byId[early]).toMatchObject({
      scheduledOn: '2026-09-25',
      factOn: '2026-09-24',
      factMinor: '1000000',
      factTransactionIds: [earlyTx],
    });
    expect(byId[late]).toMatchObject({ factOn: '2026-09-25', factMinor: '600000' });
    expect([...byId[late]!.factTransactionIds].sort()).toEqual([lateA, lateB].sort());
    expect(byId[received]).toMatchObject({
      kind: 'INCOME_PLAN',
      factOn: '2026-09-10',
      factMinor: '9000000',
      factTransactionIds: [incomeTx],
    });
    expect(byId[nextMonth]).toMatchObject({
      scheduledOn: '2026-10-01',
      status: 'COMPLETED',
      factOn: '2026-09-30',
      paidMinor: '300000',
      factTransactionIds: [nextMonthTx],
    });
    expect(byId[bare]).toMatchObject({ factOn: null, factMinor: null, factTransactionIds: [] });
    // Totals keep the plans scheduled in this month only; day sums are facts only.
    expect(body.totals.plannedExpenseMinor).toBe('1700000');
    expect(dayOf(body, '2026-09-24')!.expenseMinor).toBe('1200000');

    const october = (await getCalendar(w, '?month=2026-10')).json<CalendarBody>();
    expect(october.items.map((item) => item.occurrenceId)).toEqual([nextMonth]);
    expect(october.items[0]).toMatchObject({ factOn: '2026-09-30' });
  });

  it('просрочка: открытый платёж прошлого месяца виден независимо от месяца запроса', async () => {
    const w = await world(10_000_000n);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const lateId = await occurrence(w, 500_000n, yesterday);
    await occurrence(w, 600_000n, today);
    const body = (await getCalendar(w, `?month=${monthShift(-3)}`)).json<CalendarBody>();
    expect(body.today).toBe(todayInTimezone(new Date(), 'UTC'));
    expect(body.overdueCount).toBe(1);
    expect(body.overdue.map((o) => o.occurrenceId)).toEqual([lateId]);
    expect(body.overdue[0]!.scheduledOn).toBe(yesterday);
    expect(body.items).toEqual([]);
  });

  it('точки: overdue, upcoming; плановый доход не бывает просроченным', async () => {
    const w = await world(10_000_000n);
    const prevMonth = monthShift(-2);
    const nextMonth = monthShift(2);
    await occurrence(w, 100_000n, `${prevMonth}-10`, { status: 'DUE' });
    await occurrence(w, 100_000n, `${nextMonth}-10`, { status: 'PENDING' });
    await occurrence(w, 100_000n, `${prevMonth}-11`, { planType: 'INCOME', status: 'PENDING' });
    const prev = (await getCalendar(w, `?month=${prevMonth}`)).json<CalendarBody>();
    expect(dayOf(prev, `${prevMonth}-10`)!.dot).toBe('overdue');
    expect(dayOf(prev, `${prevMonth}-11`)!.dot).toBe('upcoming');
    expect(dayOf(prev, `${prevMonth}-12`)).toBeUndefined();
    const next = (await getCalendar(w, `?month=${nextMonth}`)).json<CalendarBody>();
    expect(dayOf(next, `${nextMonth}-10`)!.dot).toBe('upcoming');
  });

  it.each([
    { timezone: 'Europe/Moscow', today: '2026-09-25', overdueIds: ['d24'] },
    { timezone: 'UTC', today: '2026-09-24', overdueIds: [] },
  ])(
    'граница суток в часовом поясе бюджета $timezone: today $today',
    async ({ timezone, today, overdueIds }) => {
      const w = await world(1_000_000n, { timezone });
      const d24 = await occurrence(w, 100_000n, '2026-09-24');
      await occurrence(w, 200_000n, '2026-09-25');
      const service = new PlansCalendarApplicationService(
        servicePrisma,
        new PlanModelPolicy(servicePrisma),
        new PlansCalendarRepository(),
        () => new Date('2026-09-24T22:30:00.000Z'),
      );
      const body = (await service.calendar(w.userId, w.budgetId, {
        month: '2026-09',
      })) as unknown as CalendarBody;
      expect(body.today).toBe(today);
      expect(body.overdueCount).toBe(overdueIds.length);
      expect(body.overdue.map((o) => o.occurrenceId)).toEqual(overdueIds.map(() => d24));
      const flags = Object.fromEntries(body.items.map((i) => [i.scheduledOn, i.overdue]));
      expect(flags).toEqual({ '2026-09-24': overdueIds.length === 1, '2026-09-25': false });
    },
  );

  it('изоляция бюджетов: чужие данные не видны, чужой бюджет 404, без cookie 401', async () => {
    const a = await world(1_000_000n);
    const b = await world(1_000_000n);
    await expense(b, b.mainEnvelopeId, 900_000n, '2026-09-05');
    await income(b, 700_000n, '2026-09-05');
    await occurrence(b, 123_000n, '2026-09-10');
    await occurrence(b, 5_000n, '2020-01-10');
    const own = (await getCalendar(a)).json<CalendarBody>();
    expect(own.days).toEqual([]);
    expect(own.items).toEqual([]);
    expect(own.overdueCount).toBe(0);
    expect(own.totals).toEqual({
      plannedIncomeMinor: '0',
      plannedExpenseMinor: '0',
      balanceMinor: '0',
      activePlanCount: 0,
    });
    const foreign = await getCalendar(a, '?month=2026-09', { budgetId: b.budgetId });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect((await getCalendar(a, '?month=2026-09', { cookie: null })).statusCode).toBe(401);
  });

  it('VIEWER читает календарь', async () => {
    const w = await world(1_000_000n);
    const viewer = await addMember(w, 'VIEWER');
    const response = await getCalendar(w, '?month=2026-09', { cookie: viewer.cookie });
    expect(response.statusCode).toBe(200);
  });

  it('бюджет на модели v1: 409 MODEL_VERSION_MISMATCH', async () => {
    const w = await world(0n, { planModelVersion: 1 });
    const response = await getCalendar(w);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'MODEL_VERSION_MISMATCH' });
  });

  it('валидация month и лишних параметров: 400 VALIDATION_FAILED', async () => {
    const w = await world(0n);
    for (const query of [
      '?month=2026-13',
      '?month=abc',
      '?month=1999-12',
      '',
      '?month=2026-09&x=1',
    ]) {
      const response = await getCalendar(w, query);
      expect(response.statusCode, query).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('только чтение: occurrences, audit и транзакции не меняются', async () => {
    const w = await world(1_000_000n);
    await occurrence(w, 100_000n, '2026-09-10');
    await expense(w, w.mainEnvelopeId, 50_000n, '2026-09-05');
    const counts = async () => [
      await prisma.planOccurrence.count({ where: { budgetId: w.budgetId } }),
      await prisma.auditEvent.count({ where: { budgetId: w.budgetId } }),
      await prisma.transaction.count({ where: { budgetId: w.budgetId } }),
    ];
    const before = await counts();
    expect((await getCalendar(w)).statusCode).toBe(200);
    expect(await counts()).toEqual(before);
  });
});

afterAll(async () => {
  for (const userId of createdUsers) await cleanupUser(userId);
  await servicePrisma.$disconnect();
  await app.close();
  await prisma.$disconnect();
});

async function world(
  startingBalanceMinor: bigint,
  options: { planModelVersion?: 1 | 2; timezone?: string } = {},
): Promise<World> {
  const registered = await register(`v2-cal-${randomUUID()}@harmofin.test`);
  const version = options.planModelVersion ?? 2;
  await prisma.budget.update({
    where: { id: registered.budgetId },
    data: {
      planModelVersion: version,
      planModelActivatedOn: version === 2 ? day('2026-01-01') : null,
      timezone: options.timezone ?? 'UTC',
      cycleStartDay: 1,
      periodBoundaryOffset: 14,
    },
  });
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId: registered.budgetId,
      ownerUserId: registered.userId,
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      startingBalanceMinor,
      accountingStartDate: day('2026-01-01'),
    },
  });
  const category = await prisma.category.create({
    data: {
      id: randomUUID(),
      budgetId: registered.budgetId,
      name: 'Еда',
      categoryType: 'EXPENSE',
      displayOrder: 900,
    },
  });
  const incomeCategory = await prisma.category.create({
    data: {
      id: randomUUID(),
      budgetId: registered.budgetId,
      name: 'Зарплата',
      categoryType: 'INCOME',
      displayOrder: 901,
    },
  });
  const partial = {
    ...registered,
    accountId: account.id,
    categoryId: category.id,
    incomeCategoryId: incomeCategory.id,
    mainEnvelopeId: '',
    mandatoryEnvelopeId: '',
  };
  partial.mainEnvelopeId = await envelope(partial, 'CURRENT_EXPENSES', 'Текущий', 'FIRST');
  partial.mandatoryEnvelopeId = await envelope(partial, 'MANDATORY_EXPENSES', 'Обязательные');
  return partial;
}

async function envelope(
  w: World,
  envelopeType: 'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'SAVINGS_GOAL',
  name: string,
  periodSlot?: 'FIRST' | 'SECOND',
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
    },
  });
  return created.id;
}

async function expense(
  w: World,
  envelopeId: string,
  amountMinor: bigint,
  occurredOn: string,
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED' = 'CONFIRMED',
): Promise<string> {
  const row = await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      transactionType: 'EXPENSE',
      status,
      accountingModelVersion: 2,
      amountMinor,
      occurredOn: day(occurredOn),
      confirmedAt: status === 'CONFIRMED' ? new Date() : null,
      cancelledAt: status === 'CANCELLED' ? new Date() : null,
      deletedAt: status === 'DELETED' ? new Date() : null,
      preDeleteStatus: status === 'DELETED' ? 'CONFIRMED' : null,
      categoryId: w.categoryId,
      accountId: w.accountId,
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
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED' = 'CONFIRMED',
): Promise<string> {
  const row = await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      transactionType: 'INCOME',
      status,
      accountingModelVersion: 2,
      amountMinor,
      occurredOn: day(occurredOn),
      confirmedAt: status === 'CONFIRMED' ? new Date() : null,
      cancelledAt: status === 'CANCELLED' ? new Date() : null,
      deletedAt: status === 'DELETED' ? new Date() : null,
      preDeleteStatus: status === 'DELETED' ? 'CONFIRMED' : null,
      categoryId: w.incomeCategoryId,
      accountId: w.accountId,
      envelopeId: null,
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
  return row.id;
}

async function occurrence(
  w: World,
  amountMinor: bigint,
  scheduledOn: string,
  options: {
    planType?: 'EXPENSE' | 'INCOME';
    status?: 'PENDING' | 'DUE' | 'SKIPPED' | 'COMPLETED' | 'CANCELLED';
    planName?: string;
    transactionId?: string;
  } = {},
): Promise<string> {
  const planType = options.planType ?? 'EXPENSE';
  const envelopeId = planType === 'EXPENSE' ? w.mandatoryEnvelopeId : null;
  const planId = randomUUID();
  await prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: w.workspaceId,
      budgetId: w.budgetId,
      ownerUserId: w.userId,
      name: options.planName ?? `План ${planId.slice(0, 6)}`,
      planType,
      amountMinor,
      anchorOn: day(scheduledOn),
      startOn: day(scheduledOn),
      recurrence: 'ONE_TIME',
      envelopeId,
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
      planName: options.planName ?? 'План',
      planType,
      amountMinor,
      envelopeId,
      status: options.status ?? 'DUE',
      transactionId: options.transactionId ?? null,
      ...(options.status === 'SKIPPED' ? { skippedAt: new Date() } : {}),
      ...(options.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      ...(options.status === 'CANCELLED'
        ? { cancelledAt: new Date(), cancellationReason: 'PLAN_CHANGED' }
        : {}),
    },
  });
  return row.id;
}

async function payment(w: World, occurrenceId: string, transactionId: string): Promise<void> {
  await prisma.planPayment.create({
    data: { id: randomUUID(), budgetId: w.budgetId, occurrenceId, transactionId },
  });
}

async function addMember(
  w: World,
  role: 'VIEWER' | 'EDITOR',
): Promise<{ userId: string; cookie: string }> {
  const member = await register(`v2-cal-${randomUUID()}@harmofin.test`);
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
