import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { cycleAndPeriodFor, todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { PlanModelPolicy } from '../src/common/plan-model/plan-model.policy.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DashboardV2ApplicationService } from '../src/v2-dashboard/dashboard-v2.application.service.js';
import { DashboardV2Repository } from '../src/v2-dashboard/dashboard-v2.repository.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

// Fixed calculation date: cycle starts on the 1st, the second period starts on the 15th.
const ASOF = '2026-03-10';
const PERIOD = { start: '2026-03-01', end: '2026-03-14' };
const NEXT_PERIOD_START = '2026-03-15';
const TODAY = todayInTimezone(new Date(), 'UTC');
const TODAY_SLOT = cycleAndPeriodFor(
  { cycleStartDay: 1, periodBoundaryOffset: 14, timezone: 'UTC' },
  TODAY,
).period.id;

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
let service: DashboardV2ApplicationService;
const createdUsers: string[] = [];

describe('v2 dashboard summary (P01)', () => {
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
    service = new DashboardV2ApplicationService(servicePrisma, new PlanModelPolicy(servicePrisma));
  });

  it('пример §8: cash 100k, остаток периода 65k, обязательные 35k, due 45k => 55k, нехватка 10k', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 3_500_000n);
    await occurrence(w, 4_500_000n, '2026-03-12');

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.spendable).toEqual({ state: 'READY', amountMinor: '5500000' });
    expect(summary.currentBalanceMinor).toBe('6500000');
    expect(summary.cashMinor).toBe('10000000');
    expect(summary.mandatoryBalanceMinor).toBe('3500000');
    expect(summary.mandatoryDueMinor).toBe('4500000');
    expect(summary.mandatoryGapMinor).toBe('1000000');
    expect(summary.otherProtectedMinor).toBe('0');
    expect(summary.freeToAssignMinor).toBe('0');
    expect(summary.unbackedMinor).toBe('0');
    expect(summary.period).toMatchObject(PERIOD);
    expect(summary.cycle).toEqual({ start: '2026-03-01', end: '2026-03-31' });
    expect(summary.asOf).toBe(ASOF);
    expect(summary.suggestedTarget).toBeNull();
    expect(summary.upcoming).toEqual([
      { occurrenceId: expect.any(String), scheduledOn: '2026-03-12', unpaidMinor: '4500000' },
    ]);
  });

  it('protectedMinor, прогресс цели накоплений и конверт без цели', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      1_000_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 1_000_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 3_500_000n);
    const goal = await envelope(w, 'SAVINGS_GOAL', 'Автомобиль', undefined, 2_000_000n);
    const plain = await envelope(w, 'SAVINGS_GOAL', 'Подушка');
    await assign(w, goal, null, 300_000n);
    await assign(w, plain, null, 200_000n);

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.protectedMinor).toBe('4000000');
    const byId = new Map(summary.envelopes.map((row) => [row.id, row]));
    expect(byId.get(goal)?.progress).toEqual({
      kind: 'GOAL',
      valueMinor: '300000',
      maxMinor: '2000000',
      shortfallMinor: null,
    });
    expect(byId.get(plain)?.progress).toBeNull();
    // No mandatory payments in the horizon: no coverage bar.
    expect(byId.get(w.mandatoryEnvelopeId)?.progress).toBeNull();
  });

  it('protectedMinor не уменьшается отрицательным остатком обязательного конверта', async () => {
    const w = await world(10_000_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 1_000_000n);
    await expense(w, w.mandatoryEnvelopeId, 1_500_000n, '2026-03-05');
    const savings = await envelope(w, 'SAVINGS_GOAL', 'Подушка');
    await assign(w, savings, null, 400_000n);

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.mandatoryBalanceMinor).toBe('-500000');
    expect(summary.protectedMinor).toBe('400000');
  });

  it('покрытие платежа считается из остатка его конверта, чужой бюджет не влияет', async () => {
    const w = await world(10_000_000n);
    const second = await envelope(w, 'MANDATORY_EXPENSES', 'Ипотека');
    await assign(w, w.mandatoryEnvelopeId, null, 600_000n);
    await occurrence(w, 300_000n, '2026-03-11', { envelopeId: second });
    await occurrence(w, 300_000n, '2026-03-12');
    const other = await world(10_000_000n);
    await occurrence(other, 900_000n, '2026-03-11');

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.nearestObligations.map((item) => [item.coverage, item.shortfallMinor])).toEqual([
      ['UNCOVERED', '300000'],
      ['COVERED', '0'],
    ]);
  });

  it('UX-22: статистика периода, ближайшие обязательства и конверты считает сервер', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 3_500_000n);
    await occurrence(w, 4_500_000n, '2026-03-12');
    await occurrence(w, 1_000_000n, '2026-03-20'); // beyond the protection horizon, within display range
    await occurrence(w, 100_000n, '2026-03-11');
    await occurrence(w, 200_000n, '2026-03-13');
    await occurrence(w, 300_000n, '2026-03-14'); // 5th by date: cut off by the limit of 3
    await occurrence(w, 900_000n, '2027-01-01'); // far beyond 60 days: never shown

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    // ASOF 2026-03-10, period ends 03-14: 5 days left including today, nothing spent yet.
    expect(summary.periodStats).toEqual({
      spentMinor: '0',
      availableMinor: '6500000',
      daysLeft: 5,
      averagePerDayMinor: (BigInt(summary.spendable.amountMinor!) / 5n).toString(),
    });
    expect(summary.nearestObligations).toEqual([
      {
        occurrenceId: expect.any(String),
        name: 'План',
        scheduledOn: '2026-03-11',
        unpaidMinor: '100000',
        coverage: 'COVERED',
        shortfallMinor: '0',
      },
      {
        occurrenceId: expect.any(String),
        name: 'План',
        scheduledOn: '2026-03-12',
        unpaidMinor: '4500000',
        coverage: 'PARTIAL',
        shortfallMinor: '1100000',
      },
      {
        occurrenceId: expect.any(String),
        name: 'План',
        scheduledOn: '2026-03-13',
        unpaidMinor: '200000',
        coverage: 'UNCOVERED',
        shortfallMinor: '200000',
      },
    ]);
    const byId = new Map(summary.envelopes.map((row) => [row.id, row]));
    expect(byId.get(w.mainEnvelopeId)?.progress).toEqual({
      kind: 'SPENT',
      valueMinor: '0',
      maxMinor: '6500000',
      shortfallMinor: null,
    });
    // Horizon ends 2026-03-31: 100k + 4.5M + 200k + 300k + 1M = 6.1M due, 3.5M held.
    expect(byId.get(w.mandatoryEnvelopeId)?.progress).toEqual({
      kind: 'COVERED',
      valueMinor: '3500000',
      maxMinor: '6100000',
      shortfallMinor: '2600000',
    });
    // The internal envelope column of upcoming rows never leaks into the response.
    expect(Object.keys(summary.upcoming[0]!).sort()).toEqual([
      'occurrenceId',
      'scheduledOn',
      'unpaidMinor',
    ]);
    expect(summary.envelopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: w.mainEnvelopeId,
          name: 'Текущий',
          envelopeType: 'CURRENT_EXPENSES',
          periodSlot: 'FIRST',
          balanceMinor: '6500000',
        }),
        expect.objectContaining({
          id: w.mandatoryEnvelopeId,
          name: 'Обязательные',
          envelopeType: 'MANDATORY_EXPENSES',
          periodSlot: null,
          balanceMinor: '3500000',
        }),
      ]),
    );
    expect(summary.envelopesTotalMinor).toBe('10000000');
  });

  it('UX-22: потрачено уменьшает остаток, но «было доступно» остаётся; без настройки периода статистики нет', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    await expense(w, w.mainEnvelopeId, 348_297n, '2026-03-05');
    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.periodStats).toMatchObject({
      spentMinor: '348297',
      availableMinor: '6500000',
      daysLeft: 5,
    });

    const empty = await world(10_000_000n);
    const unset = await service.summary(empty.userId, empty.budgetId, ASOF);
    expect(unset.periodStats).toBeNull();
  });

  it('UX-22: просроченный первым, частичная оплата даёт остаток, удалённая оплата и полностью оплаченный учтены верно', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 3_500_000n);
    const pay = async (occurrenceId: string, amount: bigint, status: 'CONFIRMED' | 'DELETED') => {
      const transactionId = await expense(w, w.mandatoryEnvelopeId, amount, '2026-03-02', status);
      await prisma.planPayment.create({
        data: { id: randomUUID(), budgetId: w.budgetId, occurrenceId, transactionId },
      });
    };
    await occurrence(w, 300_000n, '2026-03-05'); // overdue: before asOf, still listed first
    await pay(await occurrence(w, 1_000_000n, '2026-03-11'), 400_000n, 'CONFIRMED'); // partial
    await pay(await occurrence(w, 200_000n, '2026-03-12'), 200_000n, 'DELETED'); // deleted payment
    await pay(await occurrence(w, 100_000n, '2026-03-13'), 100_000n, 'CONFIRMED'); // fully paid

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.nearestObligations.map((item) => [item.scheduledOn, item.unpaidMinor])).toEqual([
      ['2026-03-05', '300000'],
      ['2026-03-11', '600000'],
      ['2026-03-12', '200000'],
    ]);
  });

  it('UX-22: архивный конверт с деньгами в списке, пустой архивный нет; последний день периода и нулевое «можно потратить»', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    const archivedWithMoney = await envelope(w, 'SAVINGS_GOAL', 'Старая цель');
    const archivedEmpty = await envelope(w, 'SAVINGS_GOAL', 'Пустая цель');
    await assign(w, archivedWithMoney, null, 50_000n);
    await prisma.envelope.updateMany({
      where: { id: { in: [archivedWithMoney, archivedEmpty] } },
      data: { archivedAt: new Date() },
    });

    // Period confirmed but nothing assigned: spendable is a real zero, not "set up the limit".
    const summary = await service.summary(w.userId, w.budgetId, PERIOD.end);
    expect(summary.spendable).toEqual({ state: 'READY', amountMinor: '0' });
    expect(summary.periodStats).toMatchObject({ daysLeft: 1, averagePerDayMinor: '0' });
    const ids = summary.envelopes.map((item) => item.id);
    expect(ids).toContain(archivedWithMoney);
    expect(ids).not.toContain(archivedEmpty);
    expect(summary.envelopesTotalMinor).toBe('50000');
    expect(period).toBeDefined();
  });

  it('назначенное накопление 20k уменьшает cash cap, ещё не назначенный желательный взнос 20k не влияет', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 3_500_000n);
    await occurrence(w, 4_500_000n, '2026-03-12');
    const savings = await envelope(w, 'SAVINGS_GOAL', 'Накопление');
    await prisma.envelopeFundingRule.create({
      data: {
        id: randomUUID(),
        budgetId: w.budgetId,
        envelopeId: savings,
        type: 'SUGGESTED_FIXED',
        priority: 30,
        fixedMinor: 2_000_000n,
        createdByUserId: w.userId,
        updatedByUserId: w.userId,
      },
    });

    const withoutAssignment = await service.summary(w.userId, w.budgetId, ASOF);
    expect(withoutAssignment.spendable.amountMinor).toBe('5500000');
    expect(withoutAssignment.otherProtectedMinor).toBe('0');

    await assign(w, savings, null, 2_000_000n);
    const assigned = await service.summary(w.userId, w.budgetId, ASOF);
    // cash 100k - protected 45k - savings 20k = 35k
    expect(assigned.spendable).toEqual({ state: 'READY', amountMinor: '3500000' });
    expect(assigned.otherProtectedMinor).toBe('2000000');
    expect(assigned.currentBalanceMinor).toBe('6500000');
    // positive assignments 65+35+20 = 120k > cash 100k
    expect(assigned.unbackedMinor).toBe('2000000');
    expect(assigned.freeToAssignMinor).toBe('0');
  });

  it('отрицательный остаток прошлого периода не увеличивает свободные деньги', async () => {
    const w = await world(13_500_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 3_500_000n);
    const before = await service.summary(w.userId, w.budgetId, ASOF);
    // cash 135k - assigned 100k
    expect(before.freeToAssignMinor).toBe('3500000');

    // Past period of the same envelope closes at -5k: 5k spent, nothing funded.
    await addPeriod(w, w.mainEnvelopeId, '2026-02-15', '2026-02-28', 'CONFIRMED', 0n);
    await expense(w, w.mainEnvelopeId, 500_000n, '2026-02-20');
    const after = await service.summary(w.userId, w.budgetId, ASOF);
    // cash dropped by the real 5k expense; the -5k row is not counted as negative protected money
    expect(after.cashMinor).toBe('13000000');
    expect(after.freeToAssignMinor).toBe('3000000');
    expect(after.otherProtectedMinor).toBe('0');
    expect(after.unbackedMinor).toBe('0');
    expect(after.spendable).toEqual({ state: 'READY', amountMinor: '6500000' });
  });

  it('просроченный платёж защищает «Можно потратить», платёж следующего периода — прогноз и не вычитается', async () => {
    const w = await world(8_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    const lastDay = '2026-03-14';
    const overdue = await occurrence(w, 500_000n, '2026-02-28');
    const nextPeriodDue = await occurrence(w, 3_000_000n, NEXT_PERIOD_START);
    await occurrence(w, 9_900_000n, '2026-04-02'); // beyond the next period: not protected
    await occurrence(w, 5_000_000n, NEXT_PERIOD_START, { planType: 'INCOME' }); // expected income

    const summary = await service.summary(w.userId, w.budgetId, lastDay);
    expect(summary.period).toMatchObject(PERIOD);
    expect(summary.mandatoryDueMinor).toBe('3500000');
    // cash 80k - due current 0.5k = 7.5k > period balance 6.5k; the next-period 3k is forecast only
    expect(summary.spendable).toEqual({ state: 'READY', amountMinor: '6500000' });
    expect(summary.mandatoryGapMinor).toBe('500000');
    expect(summary.mandatoryDueCurrentMinor).toBe('500000');
    expect(summary.mandatoryDueNextMinor).toBe('3000000');
    expect(summary.mandatoryGapCurrentMinor).toBe('500000');
    expect(summary.mandatoryGapNextMinor).toBe('3000000');
    expect(summary.cashMinor).toBe('8000000');
    expect(summary.upcoming).toEqual([
      { occurrenceId: overdue, scheduledOn: '2026-02-28', unpaidMinor: '500000' },
      { occurrenceId: nextPeriodDue, scheduledOn: NEXT_PERIOD_START, unpaidMinor: '3000000' },
    ]);
  });

  it('предупреждение MANDATORY_GAP: INFO, когда нехватка только в следующем периоде', async () => {
    const w = await world(5_000_000n);
    await occurrence(w, 2_000_000n, '2026-03-20');

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.mandatoryDueMinor).toBe('2000000');
    expect(summary.mandatoryDueCurrentMinor).toBe('0');
    expect(summary.mandatoryDueNextMinor).toBe('2000000');
    expect(summary.mandatoryGapMinor).toBe('0');
    expect(summary.mandatoryGapCurrentMinor).toBe('0');
    expect(summary.mandatoryGapNextMinor).toBe('2000000');
    expect(summary.warnings).toContainEqual(
      expect.objectContaining({
        kind: 'COVERAGE',
        code: 'MANDATORY_GAP',
        level: 'INFO',
        amountMinor: '2000000',
      }),
    );
  });

  it('регрессия §8: 45 500 на счетах, 31 615 к оплате, 46 000 следующий => можно потратить 13 885', async () => {
    // Живые числа владельца: на счетах 45 500, баланс «Обязательных» 31 615, к оплате по
    // текущему горизонту (просроченные + текущий) 31 615, следующий период 46 000 (итого 77 615).
    // «Можно потратить» = 45 500 − max(31 615, 31 615) = 13 885; остаток главного периода 13 885
    // не превышает защиту, поэтому лимитом является cash после защиты. Остальные назначения — 0.
    // Разложение нехватки (mandatorySliceGaps): totalGap = 77 615 − 31 615 = 46 000;
    // currentGap = max(0, 31 615 − 31 615) = 0; nextGap = 46 000 — только предупреждение INFO.
    const w = await world(4_550_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      1_388_500n,
    );
    await assign(w, w.mainEnvelopeId, period, 1_388_500n);
    await assign(w, w.mandatoryEnvelopeId, null, 3_161_500n);
    await occurrence(w, 1_161_500n, '2026-02-28'); // просроченный: входит в текущий горизонт
    await occurrence(w, 2_000_000n, '2026-03-12'); // текущий период
    await occurrence(w, 4_600_000n, NEXT_PERIOD_START); // следующий период: прогноз, в защиту не входит

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.spendable).toEqual({ state: 'READY', amountMinor: '1388500' });
    expect(summary.cashMinor).toBe('4550000');
    expect(summary.mandatoryBalanceMinor).toBe('3161500');
    expect(summary.mandatoryDueMinor).toBe('7761500');
    expect(summary.mandatoryDueCurrentMinor).toBe('3161500');
    expect(summary.mandatoryDueNextMinor).toBe('4600000');
    expect(summary.mandatoryGapMinor).toBe('0');
    expect(summary.mandatoryGapCurrentMinor).toBe('0');
    expect(summary.mandatoryGapNextMinor).toBe('4600000');
    expect(summary.otherProtectedMinor).toBe('0');
    expect(summary.freeToAssignMinor).toBe('0');
    expect(summary.unbackedMinor).toBe('0');
    expect(summary.warnings).toContainEqual(
      expect.objectContaining({
        kind: 'COVERAGE',
        code: 'MANDATORY_GAP',
        level: 'INFO',
        amountMinor: '4600000',
      }),
    );
  });

  it('учитываются только CONFIRMED: черновик, отмена, удаление и удалённое назначение не влияют', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    const base = await service.summary(w.userId, w.budgetId, ASOF);
    for (const status of ['DRAFT', 'CANCELLED', 'DELETED'] as const) {
      await expense(w, w.mainEnvelopeId, 1_000_000n, '2026-03-05', status);
    }
    await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: w.budgetId,
        envelopeId: w.mainEnvelopeId,
        type: 'FREE',
        amountMinor: 9_000_000n,
        effectiveOn: day('2026-03-05'),
        periodId: period,
        status: 'DELETED',
        createdByUserId: w.userId,
      },
    });
    const same = await service.summary(w.userId, w.budgetId, ASOF);
    expect(same).toEqual(base);
    // future-dated confirmed expense is not part of the as-of day
    await expense(w, w.mainEnvelopeId, 1_000_000n, '2026-03-11');
    expect(await service.summary(w.userId, w.budgetId, ASOF)).toEqual(base);
  });

  it('OWNER в текущем периоде: UNSET создаётся ровно одной строкой, повтор идемпотентен, без аудита подтверждения', async () => {
    const w = await currentWorld(10_000_000n);
    const before = await auditCounts(w.budgetId);
    const first = await service.summary(w.userId, w.budgetId, TODAY);
    expect(first.spendable).toEqual({ state: 'NEEDS_PERIOD_SETUP', amountMinor: null });
    expect(first.suggestedTarget).toBeNull();
    expect(first.cashMinor).toBe('10000000');

    const rows = await prisma.envelopePeriod.findMany({ where: { budgetId: w.budgetId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      envelopeId: w.mainEnvelopeId,
      targetStatus: 'UNSET',
      targetMinor: null,
      confirmedAt: null,
    });
    expect(first.period.periodId).toBe(rows[0]!.id);

    expect(await service.summary(w.userId, w.budgetId, TODAY)).toEqual(first);
    expect(await prisma.envelopePeriod.count({ where: { budgetId: w.budgetId } })).toBe(1);
    const after = await auditCounts(w.budgetId);
    expect(after.nonPeriod).toBe(before.nonPeriod);
    expect(after.confirmed).toBe(0);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId: w.budgetId } })).toBe(0);
  });

  it('EDITOR в текущем периоде тоже создаёт структурную строку; DRAFT с funded=0 даёт suggestedTarget', async () => {
    const w = await currentWorld(10_000_000n);
    await prisma.envelopeFundingRule.create({
      data: {
        id: randomUUID(),
        budgetId: w.budgetId,
        envelopeId: w.mainEnvelopeId,
        type: 'FIXED_PER_PERIOD',
        priority: 10,
        fixedMinor: 6_500_000n,
        createdByUserId: w.userId,
        updatedByUserId: w.userId,
      },
    });
    const editor = (await addMember(w, 'EDITOR')).userId;
    const summary = await service.summary(editor, w.budgetId, TODAY);
    expect(summary.spendable).toEqual({ state: 'NEEDS_PERIOD_SETUP', amountMinor: null });
    expect(summary.suggestedTarget).toBe('6500000');
    const row = await prisma.envelopePeriod.findFirstOrThrow({ where: { budgetId: w.budgetId } });
    expect(row).toMatchObject({
      targetStatus: 'DRAFT',
      targetMinor: 6_500_000n,
      confirmedAt: null,
    });
    expect(summary.period.periodId).toBe(row.id);
    expect(await service.summary(editor, w.budgetId, TODAY)).toEqual(summary);
    expect(await prisma.envelopePeriod.count({ where: { budgetId: w.budgetId } })).toBe(1);
  });

  it('VIEWER ничего не создаёт: нет envelope_period и audit, NEEDS_PERIOD_SETUP с periodId null', async () => {
    const w = await currentWorld(10_000_000n);
    const viewer = (await addMember(w, 'VIEWER')).userId;
    const before = await writeCounts(w.budgetId);
    const summary = await service.summary(viewer, w.budgetId, TODAY);
    expect(summary.spendable).toEqual({ state: 'NEEDS_PERIOD_SETUP', amountMinor: null });
    expect(summary.period.periodId).toBeNull();
    expect(summary.cashMinor).toBe('10000000');
    expect(await writeCounts(w.budgetId)).toEqual(before);
  });

  it('прошлая и будущая asOf даже для OWNER ничего не создают', async () => {
    const w = await currentWorld(10_000_000n);
    const before = await writeCounts(w.budgetId);
    for (const asOf of ['2020-01-05', '2099-01-05']) {
      const summary = await service.summary(w.userId, w.budgetId, asOf);
      expect(summary.spendable).toEqual({ state: 'NEEDS_PERIOD_SETUP', amountMinor: null });
      expect(summary.period.periodId).toBeNull();
      expect(summary.asOf).toBe(asOf);
      expect(summary.cycle.start <= asOf && asOf <= summary.cycle.end).toBe(true);
    }
    expect(await writeCounts(w.budgetId)).toEqual(before);
  });

  it('без asOf дата расчёта — сегодня бюджета, цикл содержит сегодня и период', async () => {
    const w = await currentWorld(10_000_000n);
    const summary = await service.summary(w.userId, w.budgetId);
    expect(summary.asOf).toBe(TODAY);
    expect(summary.cycle.start <= summary.period.start).toBe(true);
    expect(summary.period.end <= summary.cycle.end).toBe(true);
    expect(summary.cycle.start <= TODAY && TODAY <= summary.cycle.end).toBe(true);
  });

  it('писатель, удерживающий FOR UPDATE бюджета, не блокирует чтение VIEWER', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    const viewer = (await addMember(w, 'VIEWER')).userId;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const writer = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "budgets" WHERE "id" = ${w.budgetId}::uuid FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 20_000 },
    );
    await holding;
    try {
      const result = await Promise.race([
        service.summary(viewer, w.budgetId, ASOF),
        new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 4_000)),
      ]);
      expect(result).not.toBe('blocked');
      expect(result).toMatchObject({ currentBalanceMinor: '6500000' });
    } finally {
      release();
      await writer;
    }
  });

  it('ручное назначение без CONFIRMED цели: READY и остаток по §8', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(w, w.mainEnvelopeId, PERIOD.start, PERIOD.end, 'UNSET', null);
    await assign(w, w.mainEnvelopeId, period, 4_000_000n);
    const unset = await service.summary(w.userId, w.budgetId, ASOF);
    expect(unset.spendable).toEqual({ state: 'READY', amountMinor: '4000000' });
    expect(unset.suggestedTarget).toBeNull();

    await prisma.envelopePeriod.update({
      where: { id: period },
      data: { targetStatus: 'DRAFT', targetMinor: 6_500_000n },
    });
    const draft = await service.summary(w.userId, w.budgetId, ASOF);
    expect(draft.spendable).toEqual({ state: 'READY', amountMinor: '4000000' });
  });

  it('отрицательный остаток периода даёт 0 и READY; нехватка реальных денег не даёт отрицательного числа', async () => {
    const w = await world(1_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      100_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 100_000n);
    await expense(w, w.mainEnvelopeId, 300_000n, '2026-03-05');
    const overspent = await service.summary(w.userId, w.budgetId, ASOF);
    expect(overspent.currentBalanceMinor).toBe('-200000');
    expect(overspent.spendable).toEqual({ state: 'READY', amountMinor: '0' });

    await assign(w, w.mandatoryEnvelopeId, null, 5_000_000n);
    const short = await service.summary(w.userId, w.budgetId, ASOF);
    expect(short.spendable.amountMinor).toBe('0');
    expect(short.unbackedMinor).toBe('4300000');
  });

  it('изоляция: чужой бюджет 404, v1 бюджет 409, VIEWER читает, данные других бюджетов не попадают', async () => {
    const a = await world(10_000_000n);
    const b = await world(99_000_000n);
    const periodA = await addPeriod(
      a,
      a.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(a, a.mainEnvelopeId, periodA, 6_500_000n);
    const periodB = await addPeriod(b, b.mainEnvelopeId, PERIOD.start, PERIOD.end, 'CONFIRMED', 1n);
    await assign(b, b.mainEnvelopeId, periodB, 90_000_000n);
    await occurrence(b, 80_000_000n, '2026-03-12');

    const own = await service.summary(a.userId, a.budgetId, ASOF);
    expect(own.cashMinor).toBe('10000000');
    expect(own.currentBalanceMinor).toBe('6500000');
    expect(own.mandatoryDueMinor).toBe('0');
    expect(own.upcoming).toEqual([]);

    await expect(service.summary(b.userId, a.budgetId, ASOF)).rejects.toMatchObject({
      status: 404,
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    await expect(service.summary(a.userId, randomUUID(), ASOF)).rejects.toMatchObject({
      status: 404,
    });

    const viewer = await world(0n);
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: a.workspaceId,
        userId: viewer.userId,
        role: 'VIEWER',
      },
    });
    expect(await service.summary(viewer.userId, a.budgetId, ASOF)).toEqual(own);
  });

  it('некорректная дата asOf отклоняется до чтения', async () => {
    const w = await world(0n);
    await expect(service.summary(w.userId, w.budgetId, '2026-02-30')).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.summary(w.userId, w.budgetId, 'tomorrow')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('RepeatableRead: правка во время чтения не даёт смешанного снимка (cash старый, расходы новые)', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    const expenseId = await expense(w, w.mainEnvelopeId, 1_000_000n, '2026-03-05');
    const baseline = await service.summary(w.userId, w.budgetId, ASOF);
    expect(baseline.currentBalanceMinor).toBe('5500000');
    expect(baseline.cashMinor).toBe('9000000');

    class RacingRepository extends DashboardV2Repository {
      override async cash(...args: Parameters<DashboardV2Repository['cash']>) {
        const value = await super.cash(...args);
        // Another connection commits a change to the same confirmed expense after cash was read.
        await prisma.transaction.update({
          where: { id: expenseId },
          data: { amountMinor: 3_000_000n },
        });
        return value;
      }
    }
    const racing = new DashboardV2ApplicationService(
      servicePrisma,
      new PlanModelPolicy(servicePrisma),
      new RacingRepository(servicePrisma),
    );
    const snapshot = await racing.summary(w.userId, w.budgetId, ASOF);
    expect(snapshot).toEqual(baseline);

    const fresh = await service.summary(w.userId, w.budgetId, ASOF);
    expect(fresh.cashMinor).toBe('7000000');
    expect(fresh.currentBalanceMinor).toBe('3500000');
  });
});

type DashboardBody = {
  planModelVersion: number;
  period: { periodId: string | null; start: string; end: string };
  spendable: { state: string; amountMinor: string | null };
  suggestedTarget: string | null;
  dueMayBeIncomplete: boolean;
  mandatoryDueCurrentMinor: string;
  mandatoryDueNextMinor: string;
  mandatoryGapCurrentMinor: string;
  mandatoryGapNextMinor: string;
  accounts: Array<{ id: string; name: string; balanceMinor: string }>;
  protectedAssignments: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  onboarding: Record<string, boolean>;
};

async function getDashboard(
  w: World,
  query = `?asOf=${ASOF}`,
  options: { cookie?: string | null; budgetId?: string } = {},
) {
  const cookie = options.cookie === undefined ? w.cookie : options.cookie;
  return server.inject({
    method: 'GET',
    url: `/api/v2/budgets/${options.budgetId ?? w.budgetId}/dashboard${query}`,
    headers: cookie ? { origin, cookie: `harmofin_session=${cookie}` } : { origin },
  });
}

describe('v2 dashboard HTTP contract (P02)', () => {
  it('один счёт с начальным балансом без дохода: подсказка назначить, без ложного нуля', async () => {
    const w = await world(5_000_000n);
    const response = await getDashboard(w);
    expect(response.statusCode).toBe(200);
    const body = response.json<DashboardBody>();
    expect(body.planModelVersion).toBe(2);
    expect(body.onboarding.needsOpeningAssignment).toBe(true);
    expect(body.spendable.state).toBe('NEEDS_PERIOD_SETUP');
    expect(body.spendable.amountMinor).toBeNull();
    expect(body.accounts).toEqual([
      { id: w.accountId, name: 'Основной счёт', balanceMinor: '5000000' },
    ]);
    expect(body.period).toMatchObject({ ...PERIOD, periodId: null });
    expect(body.dueMayBeIncomplete).toBe(true);

    await assign(w, w.mandatoryEnvelopeId, null, 1_000_000n);
    const after = (await getDashboard(w)).json<DashboardBody>();
    expect(after.onboarding.needsOpeningAssignment).toBe(false);
  });

  it('тело не содержит полей v1 и имеет заданный набор флагов онбординга', async () => {
    const w = await world(5_000_000n);
    const response = await getDashboard(w);
    for (const forbidden of [
      'previousPeriodLeftover',
      'unassignedStartingBalanceMinor',
      'hasEnvelopeStartingBalances',
      'hasAllocatedIncome',
      'periodLimit',
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
    const body = response.json<DashboardBody>();
    expect(Object.keys(body.onboarding).sort()).toEqual([
      'categoriesSeeded',
      'hasAccounts',
      'hasMandatoryPlans',
      'mandatoryPlansDeclined',
      'needsOpeningAssignment',
      'needsPeriodSetup',
    ]);
    expect(body.onboarding.needsPeriodSetup).toBe(true);
    expect(body.onboarding.hasAccounts).toBe(true);
  });

  it('mandatoryPlansDeclined отражает отказ от обязательных платежей', async () => {
    const w = await world(5_000_000n);
    const before = (await getDashboard(w)).json<DashboardBody>();
    expect(before.onboarding.mandatoryPlansDeclined).toBe(false);

    await prisma.budget.update({
      where: { id: w.budgetId },
      data: { onboardingNoMandatoryPlansAt: new Date() },
    });
    const after = (await getDashboard(w)).json<DashboardBody>();
    expect(after.onboarding.mandatoryPlansDeclined).toBe(true);
    expect(after.onboarding.hasMandatoryPlans).toBe(false);
  });

  it('предупреждение об ограничении: текстовый статус, сумма и действие (нехватка на обязательства)', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      6_500_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 6_500_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 3_500_000n);
    await occurrence(w, 4_500_000n, '2026-03-12');
    const body = (await getDashboard(w)).json<DashboardBody>();
    expect(body.spendable).toEqual({ state: 'READY', amountMinor: '5500000' });
    expect(body.period.periodId).toBe(period);
    expect(body.mandatoryDueCurrentMinor).toBe('4500000');
    expect(body.mandatoryDueNextMinor).toBe('0');
    expect(body.mandatoryGapCurrentMinor).toBe('1000000');
    expect(body.mandatoryGapNextMinor).toBe('0');
    expect(body.warnings).toContainEqual(
      expect.objectContaining({
        kind: 'COVERAGE',
        code: 'MANDATORY_GAP',
        level: 'ALERT',
        amountMinor: '1000000',
        message: expect.stringContaining('Не хватает на обязательные платежи'),
        actionPath: expect.stringMatching(/^\/app\//),
      }),
    );
    expect(body.protectedAssignments).toContainEqual(
      expect.objectContaining({
        envelopeId: w.mandatoryEnvelopeId,
        envelopeName: 'Обязательные',
        envelopeType: 'MANDATORY_EXPENSES',
        balanceMinor: '3500000',
      }),
    );
  });

  it('нехватка реальных денег: отдельное предупреждение, а не отрицательное число', async () => {
    const w = await world(1_000_000n);
    const period = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      100_000n,
    );
    await assign(w, w.mainEnvelopeId, period, 100_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 5_000_000n);
    const body = (await getDashboard(w)).json<DashboardBody>();
    expect(body.spendable.amountMinor).toBe('0');
    expect(body.warnings).toContainEqual(
      expect.objectContaining({
        kind: 'COVERAGE',
        code: 'CASH_SHORTFALL',
        amountMinor: '4100000',
        message: expect.stringContaining('Не хватает денег на счетах'),
        actionPath: expect.stringMatching(/^\/app\//),
      }),
    );
  });

  it('PERIOD_LEFTOVER и PERIOD_DEFICIT ссылаются на конверт и период; periodId текущего периода отдан', async () => {
    const w = await world(10_000_000n);
    const current = await addPeriod(
      w,
      w.mainEnvelopeId,
      PERIOD.start,
      PERIOD.end,
      'CONFIRMED',
      1_000_000n,
    );
    await assign(w, w.mainEnvelopeId, current, 1_000_000n);
    const leftover = await addPeriod(
      w,
      w.mainEnvelopeId,
      '2026-02-01',
      '2026-02-14',
      'UNSET',
      null,
    );
    await assign(w, w.mainEnvelopeId, leftover, 300_000n);
    const deficit = await addPeriod(w, w.mainEnvelopeId, '2026-02-15', '2026-02-28', 'UNSET', null);
    await expense(w, w.mainEnvelopeId, 200_000n, '2026-02-20');

    const body = (await getDashboard(w)).json<DashboardBody>();
    expect(body.period.periodId).toBe(current);
    expect(body.warnings).toContainEqual({
      kind: 'PERIOD',
      code: 'PERIOD_LEFTOVER',
      envelopeId: w.mainEnvelopeId,
      periodId: leftover,
      balanceMinor: '300000',
      amountMinor: '300000',
      message: expect.any(String),
      actionPath: expect.stringContaining(leftover),
    });
    expect(body.warnings).toContainEqual({
      kind: 'PERIOD',
      code: 'PERIOD_DEFICIT',
      envelopeId: w.mainEnvelopeId,
      periodId: deficit,
      balanceMinor: '-200000',
      amountMinor: '200000',
      message: expect.any(String),
      actionPath: expect.stringContaining(deficit),
    });
    expect(body.protectedAssignments).toContainEqual(
      expect.objectContaining({ periodId: leftover, balanceMinor: '300000' }),
    );
    expect(body.protectedAssignments.some((item) => item.periodId === deficit)).toBe(false);
    expect(body.warnings.some((item) => item.periodId === current)).toBe(false);
  });

  it('dueMayBeIncomplete: VIEWER и прошлая дата true, OWNER в текущем периоде по умолчанию false', async () => {
    const w = await currentWorld(10_000_000n);
    const viewer = await addMember(w, 'VIEWER');
    const asViewer = await getDashboard(w, `?asOf=${TODAY}`, { cookie: viewer.cookie });
    expect(asViewer.statusCode).toBe(200);
    expect(asViewer.json<DashboardBody>().dueMayBeIncomplete).toBe(true);

    const past = (await getDashboard(w, '?asOf=2020-01-05')).json<DashboardBody>();
    expect(past.dueMayBeIncomplete).toBe(true);

    const byDefault = await getDashboard(w, '');
    expect(byDefault.statusCode).toBe(200);
    const body = byDefault.json<DashboardBody>();
    expect(body.dueMayBeIncomplete).toBe(false);
    expect(body.period.start <= TODAY && TODAY <= body.period.end).toBe(true);
    expect(body.period.periodId).not.toBeNull();
  });

  it('ошибки: 400 asOf/budgetId, 401, 404 чужой, 409 v1', async () => {
    const a = await world(1_000_000n);
    const b = await world(1_000_000n);
    for (const query of ['?asOf=2026-02-30', '?asOf=tomorrow']) {
      const response = await getDashboard(a, query);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    const badId = await getDashboard(a, `?asOf=${ASOF}`, { budgetId: 'not-a-uuid' });
    expect(badId.statusCode).toBe(400);
    expect((await getDashboard(a, `?asOf=${ASOF}`, { cookie: null })).statusCode).toBe(401);
    const foreign = await getDashboard(b, `?asOf=${ASOF}`, { budgetId: a.budgetId });
    expect(foreign.statusCode).toBe(404);
  });

  it('OpenAPI описывает GET, параметры, ответ и ошибки; схемы без полей v1', async () => {
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
    const operation = document.paths['/api/v2/budgets/{budgetId}/dashboard']?.get;
    expect(operation).toBeDefined();
    expect(operation!.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'budgetId', in: 'path', required: true }),
        expect.objectContaining({ name: 'asOf', in: 'query' }),
      ]),
    );
    for (const status of ['200', '400', '401', '404', '409']) {
      expect(operation!.responses[status]).toBeDefined();
    }
    const schema = document.components.schemas.DashboardV2Response;
    expect(schema).toBeDefined();
    expect(Object.keys(schema!.properties ?? {})).toEqual(
      expect.arrayContaining([
        'planModelVersion',
        'period',
        'cycle',
        'asOf',
        'nearestObligations',
        'periodStats',
        'envelopes',
        'envelopesTotalMinor',
        'spendable',
        'suggestedTarget',
        'accounts',
        'protectedAssignments',
        'warnings',
        'onboarding',
        'dueMayBeIncomplete',
        'protectedMinor',
      ]),
    );
    expect(
      Object.keys(
        document.components.schemas.DashboardV2NearestObligationResponse!.properties ?? {},
      ),
    ).toEqual(expect.arrayContaining(['coverage', 'shortfallMinor']));
    expect(
      Object.keys(document.components.schemas.DashboardV2EnvelopeResponse!.properties ?? {}),
    ).toContain('progress');
    expect(document.components.schemas.DashboardV2EnvelopeProgressResponse).toBeDefined();
    const names = Object.keys(document.components.schemas).filter((name) =>
      name.startsWith('DashboardV2'),
    );
    expect(names.length).toBeGreaterThan(4);
    const text = JSON.stringify(names.map((name) => document.components.schemas[name]));
    expect(text).not.toContain('previousPeriodLeftover');
    expect(text).not.toContain('unassignedStartingBalanceMinor');
    expect(text).not.toContain('hasEnvelopeStartingBalances');
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
  options: { planModelVersion?: 1 | 2; mainSlot?: 'FIRST' | 'SECOND' } = {},
): Promise<World> {
  const registered = await register(`v2-dash-${randomUUID()}@harmofin.test`);
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
  partial.mainEnvelopeId = await envelope(
    partial,
    'CURRENT_EXPENSES',
    'Текущий',
    options.mainSlot ?? 'FIRST',
  );
  partial.mandatoryEnvelopeId = await envelope(partial, 'MANDATORY_EXPENSES', 'Обязательные');
  return partial;
}

async function envelope(
  w: World,
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

async function addPeriod(
  w: World,
  envelopeId: string,
  start: string,
  end: string,
  targetStatus: 'UNSET' | 'DRAFT' | 'CONFIRMED',
  targetMinor: bigint | null,
): Promise<string> {
  const row = await prisma.envelopePeriod.create({
    data: {
      id: randomUUID(),
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
  return row.id;
}

async function assign(
  w: World,
  envelopeId: string,
  periodId: string | null,
  amountMinor: bigint,
): Promise<void> {
  await prisma.envelopeAssignment.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      envelopeId,
      type: 'OPENING',
      amountMinor,
      effectiveOn: day('2026-03-01'),
      periodId,
      status: 'CONFIRMED',
      createdByUserId: w.userId,
    },
  });
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

async function occurrence(
  w: World,
  amountMinor: bigint,
  scheduledOn: string,
  options: { planType?: 'EXPENSE' | 'INCOME'; envelopeId?: string } = {},
): Promise<string> {
  const planType = options.planType ?? 'EXPENSE';
  const envelopeId = planType === 'EXPENSE' ? (options.envelopeId ?? w.mandatoryEnvelopeId) : null;
  const planId = randomUUID();
  await prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: w.workspaceId,
      budgetId: w.budgetId,
      ownerUserId: w.userId,
      name: `План ${planId.slice(0, 6)}`,
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
      planName: 'План',
      planType,
      amountMinor,
      envelopeId,
      status: 'DUE',
    },
  });
  return row.id;
}

function currentWorld(startingBalanceMinor: bigint): Promise<World> {
  return world(startingBalanceMinor, { mainSlot: TODAY_SLOT });
}

async function addMember(
  w: World,
  role: 'VIEWER' | 'EDITOR',
): Promise<{ userId: string; cookie: string }> {
  const member = await register(`v2-dash-${randomUUID()}@harmofin.test`);
  await prisma.workspaceMembership.create({
    data: { id: randomUUID(), workspaceId: w.workspaceId, userId: member.userId, role },
  });
  return { userId: member.userId, cookie: member.cookie };
}

async function writeCounts(budgetId: string) {
  return {
    periods: await prisma.envelopePeriod.count({ where: { budgetId } }),
    audit: await prisma.auditEvent.count({ where: { budgetId } }),
    occurrences: await prisma.planOccurrence.count({ where: { budgetId } }),
  };
}

async function auditCounts(budgetId: string) {
  return {
    nonPeriod: await prisma.auditEvent.count({
      where: { budgetId, entityType: { not: 'envelope_period' } },
    }),
    confirmed: await prisma.auditEvent.count({
      where: { budgetId, entityType: 'envelope_period', action: { not: 'CREATED' } },
    }),
  };
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
