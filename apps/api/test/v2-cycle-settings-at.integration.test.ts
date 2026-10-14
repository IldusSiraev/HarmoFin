import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import {
  addIsoDays,
  cycleAndPeriodFor,
  todayInTimezone,
  type CycleSettings,
} from '../src/cycles/cycle-period.domain.js';
import { cycleAndPeriodAt } from '../src/cycles/cycle-settings-at.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

const names = ['spend', 'spendAfter', 'bound', 'plans', 'plain', 'legacy'] as const;
type Name = (typeof names)[number];
const emails = Object.fromEntries(
  names.map((name) => [name, `v2-settings-at-${name}-${randomUUID()}@harmofin.test`]),
) as Record<Name, string>;

type RegisteredUser = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const ctx: Partial<Record<Name, RegisteredUser>> = {};
const user = (name: Name) => ctx[name]!;

/** Cycle and period at a date under the settings in force then (the removed v1 cycles route used the same domain call). */
async function cycleAt(name: Name, date: string) {
  const budget = await prisma.budget.findUniqueOrThrow({
    where: { id: user(name).budgetId },
    select: { cycleStartDay: true, periodBoundaryOffset: true, timezone: true },
  });
  return prisma.$transaction((tx) => cycleAndPeriodAt(tx, user(name).budgetId, date, budget));
}

const OLD: CycleSettings = { cycleStartDay: 1, periodBoundaryOffset: 14, timezone: 'UTC' };
const today = todayInTimezone(new Date(), 'UTC');
const dateOf = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);

function addMonthsIso(value: string, months: number): string {
  const base = dateOf(value);
  return iso(
    new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate())),
  );
}

const state: {
  accountId: Partial<Record<Name, string>>;
  expenseCategoryId: Partial<Record<Name, string>>;
  incomeCategoryId?: string;
  planExpenseCategoryId?: string;
  planNew?: CycleSettings;
  planEffectiveOn?: string;
  planStart?: string;
  spendEffectiveOn?: string;
} = { accountId: {}, expenseCategoryId: {} };

const RAW: CycleSettings = { cycleStartDay: 10, periodBoundaryOffset: 14, timezone: 'UTC' };
const SPEND_NEW: CycleSettings = { cycleStartDay: 10, periodBoundaryOffset: 14, timezone: 'UTC' };

describe('v2: границы периода по версионной настройке settingsAt (T02c)', () => {
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
    for (const name of names) ctx[name] = await register(emails[name]);
    const activatedOn = addIsoDays(today, -90);
    for (const name of names) {
      if (name === 'legacy') {
        // v1 budget without revisions: cycle fields come straight from Budget.
        await prisma.budget.update({ where: { id: user(name).budgetId }, data: { ...RAW } });
        continue;
      }
      const { budgetId } = user(name);
      if (name === 'plain') {
        // v2 budget without revisions: fallback to Budget fields.
        await prisma.budget.update({
          where: { id: budgetId },
          data: { planModelVersion: 2, planModelActivatedOn: dateOf(activatedOn), ...RAW },
        });
        await prisma.envelope.updateMany({ where: { budgetId }, data: { archivedAt: new Date() } });
        continue;
      }
      await prisma.budget.update({
        where: { id: budgetId },
        data: { planModelVersion: 2, planModelActivatedOn: dateOf(activatedOn), ...OLD },
      });
      await prisma.envelope.updateMany({ where: { budgetId }, data: { archivedAt: new Date() } });
      await prisma.budgetCycleRevision.create({
        data: revisionData(budgetId, user(name).userId, activatedOn, OLD),
      });
    }

    // spend budgets: revision already in force in the past (day 10 within ~30 days back).
    // One budget per date: a budget keeps a single envelope per period slot, and a period that
    // already covers the date would be reused as is.
    let effective = addIsoDays(today, -30);
    while (!effective.endsWith('-10')) effective = addIsoDays(effective, 1);
    state.spendEffectiveOn = effective;
    for (const name of ['spend', 'spendAfter', 'bound', 'plain'] as const) {
      const spend = user(name);
      if (name !== 'plain') {
        await prisma.budgetCycleRevision.create({
          data: revisionData(spend.budgetId, spend.userId, effective, SPEND_NEW),
        });
      }
      state.accountId[name] = (
        await prisma.account.create({
          data: {
            id: randomUUID(),
            budgetId: spend.budgetId,
            name: 'Основной',
            accountType: 'BANK_CARD',
            startingBalanceMinor: 100_000_000n,
            accountingStartDate: dateOf(activatedOn),
          },
        })
      ).id;
      state.expenseCategoryId[name] = await createCategory(spend.budgetId, 'EXPENSE');
    }

    // plans budget: a future revision starting at the next OLD period; pick new settings
    // for which the materialization horizon visibly changes the monthly occurrence set.
    const plans = user('plans');
    const oldCurrent = cycleAndPeriodFor(OLD, today).period;
    const nextStart = addIsoDays(oldCurrent.end, 1);
    const oldTo = cycleAndPeriodFor(OLD, nextStart).period.end;
    let start = today;
    while (Number(start.slice(8)) > 28) start = addIsoDays(start, 1);
    state.planStart = start;
    const monthly = (to: string) => {
      let count = 0;
      while (addMonthsIso(start, count) <= to) count += 1;
      return count;
    };
    outer: for (let day = 1; day <= 28; day += 1) {
      for (let offset = 1; offset <= 27; offset += 1) {
        const candidate: CycleSettings = {
          cycleStartDay: day,
          periodBoundaryOffset: offset,
          timezone: 'UTC',
        };
        const newTo = cycleAndPeriodFor(candidate, nextStart).period.end;
        if (monthly(newTo) !== monthly(oldTo)) {
          state.planNew = candidate;
          break outer;
        }
      }
    }
    expect(state.planNew, 'нужны настройки, меняющие горизонт').toBeDefined();
    state.planEffectiveOn = nextStart;
    await prisma.budgetCycleRevision.create({
      data: revisionData(plans.budgetId, plans.userId, nextStart, state.planNew!),
    });
    await prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: plans.budgetId,
        name: 'Обязательные',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: 0n,
        displayOrder: 1,
      },
    });
    state.planExpenseCategoryId = await createCategory(plans.budgetId, 'EXPENSE');
    state.incomeCategoryId = await createCategory(plans.budgetId, 'INCOME');
  });

  afterAll(async () => {
    for (const name of names) await cleanupUser(ctx[name]?.userId ?? '');
    await app.close();
    await prisma.$disconnect();
  });

  it('расход v2 до effectiveOn получает период по старым границам, после — по новым', async () => {
    const effectiveOn = state.spendEffectiveOn!;
    for (const [name, occurredOn, settings] of [
      ['spend', addIsoDays(effectiveOn, -3), OLD],
      ['spendAfter', addIsoDays(effectiveOn, 3), SPEND_NEW],
    ] as const) {
      const full = cycleAndPeriodFor(settings, occurredOn).period;
      // the old tail is cut at effectiveOn - 1 (T01)
      const expected = settings === OLD ? { ...full, end: addIsoDays(effectiveOn, -1) } : full;
      const other = cycleAndPeriodFor(settings === OLD ? SPEND_NEW : OLD, occurredOn).period;
      expect(expected.start, 'границы старых и новых настроек различаются').not.toBe(other.start);
      const envelopeId = await createSlotEnvelope(user(name).budgetId, expected.id);
      const response = await server.inject({
        method: 'POST',
        url: `/api/v2/budgets/${user(name).budgetId}/transactions`,
        headers: headers(name, randomUUID()),
        payload: {
          transactionType: 'EXPENSE',
          status: 'CONFIRMED',
          amount: '100.00',
          occurredOn,
          accountId: state.accountId[name],
          categoryId: state.expenseCategoryId[name],
          envelopeId,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      const period = await prisma.envelopePeriod.findFirst({
        where: { budgetId: user(name).budgetId, envelopeId },
      });
      expect(period).not.toBeNull();
      expect({ start: iso(period!.startsOn), end: iso(period!.endsOn) }).toEqual({
        start: expected.start,
        end: expected.end,
      });
    }
  });

  it('граница: effectiveOn-1 — старая настройка и усечённый период, effectiveOn — новая', async () => {
    const effectiveOn = state.spendEffectiveOn!;
    const before = addIsoDays(effectiveOn, -1);
    const oldFull = cycleAndPeriodFor(OLD, before).period;
    expect(oldFull.end >= effectiveOn, 'старый период пересекает effectiveOn').toBe(true);
    const newFirst = cycleAndPeriodFor(SPEND_NEW, effectiveOn).period;
    expect(oldFull.id).toBe('FIRST');
    expect(newFirst.id).toBe('FIRST');
    const envelopeId = await createSlotEnvelope(user('bound').budgetId, 'FIRST');
    const periods: Array<{ start: string; end: string }> = [];
    for (const occurredOn of [before, effectiveOn]) {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v2/budgets/${user('bound').budgetId}/transactions`,
        headers: headers('bound', randomUUID()),
        payload: {
          transactionType: 'EXPENSE',
          status: 'CONFIRMED',
          amount: '100.00',
          occurredOn,
          accountId: state.accountId.bound,
          categoryId: state.expenseCategoryId.bound,
          envelopeId,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      const rows = await prisma.envelopePeriod.findMany({
        where: {
          budgetId: user('bound').budgetId,
          envelopeId,
          startsOn: { lte: dateOf(occurredOn) },
          endsOn: { gte: dateOf(occurredOn) },
        },
      });
      expect(rows).toHaveLength(1);
      periods.push({ start: iso(rows[0]!.startsOn), end: iso(rows[0]!.endsOn) });
    }
    expect(periods[0]).toEqual({ start: oldFull.start, end: before });
    expect(periods[1]).toEqual({ start: newFirst.start, end: newFirst.end });
  });

  it('cycle at date: старый период усечён до effectiveOn-1, с effectiveOn новые границы', async () => {
    const effectiveOn = state.spendEffectiveOn!;
    const before = addIsoDays(effectiveOn, -1);
    const oldFull = cycleAndPeriodFor(OLD, before);
    const newFull = cycleAndPeriodFor(SPEND_NEW, effectiveOn);
    const at = (date: string) => cycleAt('bound', date);
    const crossing = await at(addIsoDays(effectiveOn, -5));
    expect(crossing.period).toMatchObject({ start: oldFull.period.start, end: before });
    expect(crossing.cycle).toEqual({ start: oldFull.cycle.start, end: before });
    expect(crossing.daysUntilNextBoundary).toBe(5);
    const last = await at(before);
    expect(last.period.end).toBe(before);
    expect(last.daysUntilNextBoundary).toBe(1);
    const first = await at(effectiveOn);
    expect(first.period).toMatchObject({ start: newFull.period.start, end: newFull.period.end });
    expect(first.cycle).toEqual(newFull.cycle);
  });

  it('без ревизий (v1 и v2): границы берутся из полей Budget, ничего не усечено', async () => {
    const date = addIsoDays(today, -5);
    const expected = cycleAndPeriodFor(RAW, date);
    for (const name of ['legacy', 'plain'] as const) {
      expect(await cycleAt(name, date), name).toEqual(expected);
    }
    const period = expected.period;
    const envelopeId = await createSlotEnvelope(user('plain').budgetId, period.id);
    const response = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${user('plain').budgetId}/transactions`,
      headers: headers('plain', randomUUID()),
      payload: {
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amount: '100.00',
        occurredOn: date,
        accountId: state.accountId.plain,
        categoryId: state.expenseCategoryId.plain,
        envelopeId,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const row = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId: user('plain').budgetId, envelopeId },
    });
    expect({ start: iso(row.startsOn), end: iso(row.endsOn) }).toEqual({
      start: period.start,
      end: period.end,
    });
  });

  it('план обязательств без будущей ревизии: горизонт по полям Budget', async () => {
    const plain = user('plain');
    await prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: plain.budgetId,
        name: 'Обязательные',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: 0n,
        displayOrder: 1,
      },
    });
    const categoryId = await createCategory(plain.budgetId, 'EXPENSE');
    const response = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${plain.budgetId}/obligations/plans`,
      headers: headers('plain', randomUUID()),
      payload: {
        name: 'Подписка',
        amount: '300.00',
        scheduledOn: state.planStart,
        categoryId,
        recurrence: 'MONTHLY',
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const current = cycleAndPeriodFor(RAW, today).period;
    const nextPeriodEnd = cycleAndPeriodFor(RAW, addIsoDays(current.end, 1)).period.end;
    // Creation materializes up to the later of the next period end and today + 60 (worker horizon).
    const to = nextPeriodEnd >= addIsoDays(today, 60) ? nextPeriodEnd : addIsoDays(today, 60);
    const dates: string[] = [];
    for (let k = 0; addMonthsIso(state.planStart!, k) <= to; k += 1) {
      dates.push(addMonthsIso(state.planStart!, k));
    }
    expect(await occurrenceDates(plain.budgetId, response.json<{ id: string }>().id)).toEqual(
      dates,
    );
  });

  it('план обязательств: горизонт материализации считается по настройке даты следующего периода', async () => {
    const plans = user('plans');
    const response = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${plans.budgetId}/obligations/plans`,
      headers: headers('plans', randomUUID()),
      payload: {
        name: 'Подписка',
        amount: '300.00',
        scheduledOn: state.planStart,
        categoryId: state.planExpenseCategoryId,
        recurrence: 'MONTHLY',
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const planId = response.json<{ id: string }>().id;
    expect(await occurrenceDates(plans.budgetId, planId)).toEqual(expectedMonthly());
  });

  it('план доходов: горизонт материализации считается по настройке даты следующего периода', async () => {
    const plans = user('plans');
    const response = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${plans.budgetId}/income-plans`,
      headers: headers('plans', randomUUID()),
      payload: {
        name: 'Зарплата',
        amount: '1000.00',
        scheduledOn: state.planStart,
        categoryId: state.incomeCategoryId,
        recurrence: 'MONTHLY',
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const planId = response.json<{ id: string }>().id;
    expect(await occurrenceDates(plans.budgetId, planId)).toEqual(expectedMonthly());
  });
});

function expectedMonthly(): string[] {
  const current = cycleAndPeriodFor(OLD, today).period;
  const nextStart = addIsoDays(current.end, 1);
  expect(nextStart).toBe(state.planEffectiveOn);
  const to = cycleAndPeriodFor(state.planNew!, nextStart).period.end;
  const dates: string[] = [];
  for (let k = 0; addMonthsIso(state.planStart!, k) <= to; k += 1) {
    dates.push(addMonthsIso(state.planStart!, k));
  }
  return dates;
}

async function occurrenceDates(budgetId: string, planId: string): Promise<string[]> {
  const rows = await prisma.planOccurrence.findMany({
    where: { budgetId, planId },
    orderBy: { scheduledOn: 'asc' },
    select: { scheduledOn: true },
  });
  return rows.map((row) => iso(row.scheduledOn));
}

function revisionData(budgetId: string, userId: string, effectiveOn: string, s: CycleSettings) {
  return {
    id: randomUUID(),
    budgetId,
    effectiveOn: dateOf(effectiveOn),
    cycleStartDay: s.cycleStartDay,
    periodBoundaryOffset: s.periodBoundaryOffset,
    timezone: s.timezone,
    createdByUserId: userId,
    updatedByUserId: userId,
  };
}

function headers(name: Name, key?: string): Record<string, string> {
  return {
    origin,
    cookie: `harmofin_session=${user(name).cookie}`,
    'x-csrf-token': user(name).csrfToken,
    ...(key ? { 'idempotency-key': key } : {}),
  };
}

async function createSlotEnvelope(budgetId: string, slot: 'FIRST' | 'SECOND') {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Слот ${slot} ${randomUUID().slice(0, 6)}`,
      envelopeType: 'CURRENT_EXPENSES',
      startingBalanceMinor: 0n,
      displayOrder: 950,
      periodSlot: slot,
    },
  });
  return envelope.id;
}

async function createCategory(budgetId: string, categoryType: 'INCOME' | 'EXPENSE') {
  const category = await prisma.category.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Категория ${randomUUID().slice(0, 8)}`,
      categoryType,
      displayOrder: 990,
    },
  });
  return category.id;
}

async function register(email: string): Promise<RegisteredUser> {
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
  const cookie = match ? decodeURIComponent(match[1]!) : '';
  expect(cookie).not.toHaveLength(0);
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    csrfToken: body.csrfToken,
    cookie,
  };
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
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.planPayment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.planOccurrence.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.regularPlan.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transaction.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
