import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../src/common/plan-model/plan-model.policy.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AssignmentBalanceRepository } from '../src/envelope-plans/assignment-balance.repository.js';
import { PlanOccurrenceRepository } from '../src/plans/plan-occurrence.repository.js';
import { RegularPlanRepository } from '../src/plans/regular-plan.repository.js';
import { V2OccurrenceMaterializer } from '../src/plans/v2-occurrence-materializer.js';
import { ObligationApplicationService } from '../src/obligations/obligation.application.service.js';
import { MandatoryDueRepository } from '../src/obligations/mandatory-due.repository.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const dayMs = 86_400_000;
const d = (delta: number) => new Date(Date.now() + dayMs * delta);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

type User = { userId: string; workspaceId: string; budgetId: string };
const emails = {
  owner: `v2-md-owner-${randomUUID()}@harmofin.test`,
  other: `v2-md-other-${randomUUID()}@harmofin.test`,
};
const ctx: Partial<Record<keyof typeof emails, User>> = {};
const owner = () => ctx.owner!;
const today = todayInTimezone(new Date(), 'UTC');

let app: NestFastifyApplication;
let servicePrisma: PrismaService;
let service: ObligationApplicationService;
let repo: MandatoryDueRepository;
const assignmentBalances = new AssignmentBalanceRepository();
let accountId: string;
let expenseCategoryId: string;
let mandatoryEnvelopeId: string;
let customEnvelopeId: string;
let otherEnvelopeId: string;

const due = (asOf: string, currentEnd: string, nextEnd: string, budgetId = owner().budgetId) =>
  prisma.$transaction((tx) => repo.mandatoryDue(tx, budgetId, asOf, currentEnd, nextEnd));
const planTotal = (from: string, to: string, budgetId = owner().budgetId) =>
  prisma.$transaction((tx) => repo.mandatoryPlanTotal(tx, budgetId, from, to));

async function occurrence(
  scheduledOn: string,
  amountMinor: bigint,
  over: {
    status?: 'PENDING' | 'DUE' | 'SKIPPED' | 'COMPLETED' | 'CANCELLED';
    planType?: 'EXPENSE' | 'INCOME';
    user?: User;
    envelopeId?: string | null;
  } = {},
) {
  const user = over.user ?? owner();
  const envelopeId =
    over.envelopeId === undefined
      ? user === owner()
        ? mandatoryEnvelopeId
        : otherEnvelopeId
      : over.envelopeId;
  const planId = randomUUID();
  await prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: user.workspaceId,
      budgetId: user.budgetId,
      name: `План ${planId.slice(0, 6)}`,
      planType: over.planType ?? 'EXPENSE',
      amountMinor,
      anchorOn: day(scheduledOn),
      startOn: day(scheduledOn),
      recurrence: 'ONE_TIME',
      envelopeId,
      isActive: true,
      createdByUserId: user.userId,
      updatedByUserId: user.userId,
    },
  });
  const id = randomUUID();
  const status = over.status ?? 'DUE';
  await prisma.planOccurrence.create({
    data: {
      id,
      workspaceId: user.workspaceId,
      budgetId: user.budgetId,
      planId,
      scheduledOn: day(scheduledOn),
      planName: 'План',
      planType: over.planType ?? 'EXPENSE',
      amountMinor,
      envelopeId,
      status,
      ...(status === 'SKIPPED' ? { skippedAt: new Date() } : {}),
      ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      ...(status === 'CANCELLED'
        ? { cancelledAt: new Date(), cancellationReason: 'PLAN_CHANGED' as const }
        : {}),
    },
  });
  return id;
}

const pay = (occurrenceId: string, key: string, amount: string, willPayMore: boolean) =>
  service.pay(
    owner().userId,
    owner().budgetId,
    occurrenceId,
    { accountId, categoryId: expenseCategoryId, amount, occurredOn: today, willPayMore },
    key,
  );

describe('v2 потребность обязательных (R02)', () => {
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
    const server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
    servicePrisma = new PrismaService(databaseUrl);
    service = new ObligationApplicationService(
      servicePrisma,
      new IdempotencyService(),
      new PlanModelPolicy(servicePrisma),
    );
    const plans = new RegularPlanRepository(servicePrisma);
    repo = new MandatoryDueRepository(
      plans,
      new V2OccurrenceMaterializer(plans, new PlanOccurrenceRepository()),
    );
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin },
        payload: { email: emails[key], password },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<{
        user: { id: string };
        workspace: { id: string };
        budget: { id: string };
      }>();
      ctx[key] = {
        userId: body.user.id,
        workspaceId: body.workspace.id,
        budgetId: body.budget.id,
      };
    }
    await prisma.budget.updateMany({
      where: { id: { in: [owner().budgetId, ctx.other!.budgetId] } },
      data: { planModelVersion: 2, planModelActivatedOn: day('2026-01-01'), timezone: 'UTC' },
    });
    accountId = (
      await prisma.account.create({
        data: {
          id: randomUUID(),
          budgetId: owner().budgetId,
          name: 'Счёт',
          accountType: 'BANK_ACCOUNT',
          currency: 'RUB',
          scale: 2,
          startingBalanceMinor: 1_000_000_000n,
          accountingStartDate: d(-90),
        },
      })
    ).id;
    expenseCategoryId = (
      await prisma.category.create({
        data: {
          id: randomUUID(),
          budgetId: owner().budgetId,
          name: 'Расход',
          categoryType: 'EXPENSE',
          displayOrder: 1,
        },
      })
    ).id;
    const envelope = (budgetId: string, envelopeType: 'MANDATORY_EXPENSES' | 'CUSTOM') =>
      prisma.envelope
        .create({
          data: {
            id: randomUUID(),
            budgetId,
            name: `Envelope ${randomUUID().slice(0, 8)}`,
            envelopeType,
            startingBalanceMinor: 0n,
            displayOrder: 1,
          },
        })
        .then((row) => row.id);
    mandatoryEnvelopeId = await envelope(owner().budgetId, 'MANDATORY_EXPENSES');
    customEnvelopeId = await envelope(owner().budgetId, 'CUSTOM');
    otherEnvelopeId = await envelope(ctx.other!.budgetId, 'MANDATORY_EXPENSES');
  });

  beforeEach(async () => {
    const budgetId = { in: [owner().budgetId, ctx.other!.budgetId] };
    await prisma.planPayment.deleteMany({ where: { budgetId } });
    await prisma.planOccurrence.deleteMany({ where: { budgetId } });
    await prisma.regularPlan.deleteMany({ where: { budgetId } });
  });

  afterAll(async () => {
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await cleanupUser(ctx[key]?.userId ?? '');
    }
    await servicePrisma.$disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  it('аренда 40000 просрочена, оплачено 35000 (willPayMore) + завтра 40000 => 45000 даже после границы', async () => {
    const rent = await occurrence('2026-09-10', 4_000_000n);
    await occurrence('2026-10-02', 4_000_000n);
    const first = await pay(rent, 'md-rent', '35000.00', true);
    expect(first.occurrence).toMatchObject({ status: 'DUE', unpaidMinor: '500000' });
    expect((await due('2026-09-24', '2026-10-09', '2026-10-09')).totalMinor).toBe(4_500_000n);
  });

  it('садик 3000, финальная оплата 2000 (willPayMore=false): due 0, баланс обязательных хранит 1000', async () => {
    const envelopeBalance = async () =>
      (
        await prisma.$transaction((tx) =>
          assignmentBalances.balance(tx, owner().budgetId, mandatoryEnvelopeId, null, new Date()),
        )
      ).balance;
    const before = await envelopeBalance();
    await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: owner().budgetId,
        envelopeId: mandatoryEnvelopeId,
        type: 'FREE',
        amountMinor: 300_000n,
        effectiveOn: d(-5),
        status: 'CONFIRMED',
      },
    });
    const id = await occurrence('2026-09-20', 300_000n);
    const res = await pay(id, 'md-daycare', '2000.00', false);
    expect(res.occurrence.status).toBe('COMPLETED');
    expect((await due('2026-09-24', '2026-10-09', '2026-10-09')).totalMinor).toBe(0n);
    expect(await envelopeBalance()).toBe(before + 100_000n);
  });

  it('включает только PENDING|DUE расходные обязательные до границы; доход, пропущенные, отменённые и дальние не входят', async () => {
    await occurrence('2026-10-05', 100_000n, { status: 'PENDING' });
    await occurrence('2026-10-09', 200_000n);
    await occurrence('2026-10-10', 900_000n, { status: 'PENDING' });
    await occurrence('2026-10-03', 800_000n, { planType: 'INCOME', envelopeId: null });
    await occurrence('2026-10-03', 700_000n, { status: 'SKIPPED' });
    await occurrence('2026-10-03', 600_000n, { status: 'COMPLETED' });
    await occurrence('2026-10-03', 500_000n, { status: 'CANCELLED' });
    await occurrence('2026-10-03', 400_000n, { envelopeId: customEnvelopeId });
    expect((await due('2026-09-24', '2026-10-09', '2026-10-09')).totalMinor).toBe(300_000n);
  });

  it('отменённая или удалённая операция оплаты не уменьшает потребность', async () => {
    const id = await occurrence('2026-10-02', 1_000_000n);
    await pay(id, 'md-cancelled', '3000.00', true);
    await pay(id, 'md-deleted', '2000.00', true);
    expect((await due('2026-10-01', '2026-10-09', '2026-10-09')).totalMinor).toBe(500_000n);
    const links = await prisma.planPayment.findMany({
      where: { budgetId: owner().budgetId, occurrenceId: id },
      include: { transaction: true },
      orderBy: { transaction: { amountMinor: 'asc' } },
    });
    await prisma.transaction.update({
      where: { id: links[0]!.transactionId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    expect((await due('2026-10-01', '2026-10-09', '2026-10-09')).totalMinor).toBe(700_000n);
    await prisma.transaction.update({
      where: { id: links[1]!.transactionId },
      data: { status: 'DELETED', deletedAt: new Date(), preDeleteStatus: 'CONFIRMED' },
    });
    expect((await due('2026-10-01', '2026-10-09', '2026-10-09')).totalMinor).toBe(1_000_000n);
  });

  it('переплата одного occurrence не уменьшает потребность других', async () => {
    const a = await occurrence('2026-10-02', 100_000n);
    await occurrence('2026-10-03', 200_000n);
    await pay(a, 'md-over', '1500.00', true);
    expect((await due('2026-10-01', '2026-10-09', '2026-10-09')).totalMinor).toBe(200_000n);
  });

  it('материализует новый период под вызовом без worker', async () => {
    const planId = randomUUID();
    await prisma.regularPlan.create({
      data: {
        id: planId,
        workspaceId: owner().workspaceId,
        budgetId: owner().budgetId,
        name: 'Ежемесячный',
        planType: 'EXPENSE',
        amountMinor: 4_000_000n,
        anchorOn: day('2026-10-05'),
        startOn: day('2026-10-05'),
        recurrence: 'MONTHLY',
        envelopeId: mandatoryEnvelopeId,
        isActive: true,
        createdByUserId: owner().userId,
        updatedByUserId: owner().userId,
      },
    });
    expect((await due('2026-10-01', '2026-10-09', '2026-10-09')).totalMinor).toBe(4_000_000n);
    expect((await due('2026-10-01', '2026-10-09', '2026-10-09')).totalMinor).toBe(4_000_000n);
    expect(await prisma.planOccurrence.count({ where: { planId } })).toBe(1);
    await prisma.regularPlan.update({ where: { id: planId }, data: { isActive: false } });
  });

  it('mandatoryPlanTotal включает оплаченный план периода и не удваивает повторы за горизонтом', async () => {
    const paid = await occurrence('2026-10-02', 300_000n);
    await pay(paid, 'md-total', '3000.00', false);
    await occurrence('2026-10-05', 100_000n, { status: 'PENDING' });
    await occurrence('2026-10-06', 50_000n, { status: 'SKIPPED' });
    await occurrence('2026-10-07', 40_000n, { status: 'CANCELLED' });
    await occurrence('2026-10-08', 30_000n, { planType: 'INCOME', envelopeId: null });
    await occurrence('2026-10-09', 20_000n, { envelopeId: customEnvelopeId });
    await occurrence('2026-09-30', 10_000n);
    await occurrence('2026-10-16', 700_000n, { status: 'PENDING' });
    expect(await planTotal('2026-10-01', '2026-10-15')).toBe(400_000n);
    expect(await planTotal('2026-10-01', '2026-10-31')).toBe(1_100_000n);
  });

  it('изолирует бюджеты', async () => {
    await occurrence('2026-09-01', 777_000n, { user: ctx.other! });
    await occurrence('2026-10-02', 100_000n);
    expect((await due('2026-10-01', '2026-10-09', '2026-10-09')).totalMinor).toBe(100_000n);
    expect(
      (await due('2026-10-01', '2026-10-09', '2026-10-09', ctx.other!.budgetId)).totalMinor,
    ).toBe(777_000n);
    expect(await planTotal('2026-10-01', '2026-10-31', ctx.other!.budgetId)).toBe(0n);
  });

  it('отклоняет невалидные даты', async () => {
    await expect(due('2026-10-01; DROP', '2026-10-09', '2026-10-09')).rejects.toThrow();
    await expect(planTotal('2026-10-01', '10/31/2026')).rejects.toThrow();
  });

  it('разбивает потребность на слайсы: просроченный и текущий период — текущий, следующий — отдельный, вне горизонта не входит', async () => {
    await occurrence('2026-09-20', 200_000n); // просроченные — текущий слайс
    await occurrence('2026-10-05', 100_000n, { status: 'PENDING' }); // текущий период
    await occurrence('2026-10-14', 300_000n); // граница текущего периода включительно
    await occurrence('2026-10-15', 500_000n); // следующий период
    await occurrence('2026-10-31', 100_000n); // конец горизонта включительно
    await occurrence('2026-11-01', 999_900n); // вне горизонта — не входит
    const slices = await due('2026-10-01', '2026-10-14', '2026-10-31');
    expect(slices).toEqual({
      totalMinor: 1_200_000n,
      currentSliceMinor: 600_000n,
      nextSliceMinor: 600_000n,
    });
  });
});

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
    await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
