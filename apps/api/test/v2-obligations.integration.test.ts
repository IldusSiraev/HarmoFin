import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { FinancialBalanceRepository } from '../src/common/finance/financial-balance.repository.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../src/common/plan-model/plan-model.policy.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AssignmentBalanceRepository } from '../src/envelope-plans/assignment-balance.repository.js';
import {
  computeUnpaidMinor,
  ObligationApplicationService,
  type ObligationPayInput,
} from '../src/obligations/obligation.application.service.js';

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
  owner: `v2-ob-owner-${randomUUID()}@harmofin.test`,
  viewer: `v2-ob-viewer-${randomUUID()}@harmofin.test`,
  outsider: `v2-ob-outsider-${randomUUID()}@harmofin.test`,
  legacy: `v2-ob-legacy-${randomUUID()}@harmofin.test`,
};
const ctx: Partial<Record<keyof typeof emails, User>> = {};

let app: NestFastifyApplication;
let server: FastifyInstance;
let service: ObligationApplicationService;
let servicePrisma: PrismaService;
const balances = new FinancialBalanceRepository();
const assignmentBalances = new AssignmentBalanceRepository();

let accountId: string;
let smallAccountId: string;
let expenseCategoryId: string;
let incomeCategoryId: string;
let mandatoryEnvelopeId: string;
let customEnvelopeId: string;
let outsiderAccountId: string;

const today = todayInTimezone(new Date(), 'UTC');
const tomorrow = todayInTimezone(new Date(Date.now() + dayMs), 'UTC');

const owner = () => ctx.owner!;
const cash = (id: string) =>
  prisma.$transaction((tx) => balances.accountBalance(tx, owner().budgetId, id));
const mandatoryBalance = async () =>
  (
    await prisma.$transaction((tx) =>
      assignmentBalances.balance(tx, owner().budgetId, mandatoryEnvelopeId, null, new Date()),
    )
  ).balance;

const input = (over: Partial<ObligationPayInput> = {}): ObligationPayInput => ({
  accountId,
  categoryId: expenseCategoryId,
  amount: '20.00',
  occurredOn: today,
  willPayMore: false,
  ...over,
});
const pay = (occurrenceId: string, key: string, over: Partial<ObligationPayInput> = {}) =>
  service.pay(owner().userId, owner().budgetId, occurrenceId, input(over), key);

function httpHeaders(user: User | undefined, key?: string): Record<string, string> {
  return {
    origin,
    cookie: `harmofin_session=${user?.cookie ?? ''}`,
    'x-csrf-token': user?.csrfToken ?? '',
    ...(key ? { 'idempotency-key': key } : {}),
  };
}
const payBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  accountId,
  categoryId: expenseCategoryId,
  amount: '20.00',
  occurredOn: today,
  willPayMore: false,
  ...over,
});
function act(
  user: User | undefined,
  occurrenceId: string,
  action: 'pay' | 'skip' | 'close',
  key: string,
  payload: Record<string, unknown> = {},
) {
  return server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${owner().budgetId}/obligations/${occurrenceId}/${action}`,
    headers: httpHeaders(user, key),
    payload,
  });
}

async function occurrence(
  amountMinor: bigint,
  over: { envelopeId?: string; planActive?: boolean } = {},
) {
  const planId = randomUUID();
  await prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: owner().workspaceId,
      budgetId: owner().budgetId,
      name: `План ${planId.slice(0, 6)}`,
      planType: 'EXPENSE',
      amountMinor,
      anchorOn: d(-5),
      startOn: d(-5),
      recurrence: 'ONE_TIME',
      envelopeId: mandatoryEnvelopeId,
      isActive: over.planActive ?? true,
      createdByUserId: owner().userId,
      updatedByUserId: owner().userId,
    },
  });
  const id = randomUUID();
  await prisma.planOccurrence.create({
    data: {
      id,
      workspaceId: owner().workspaceId,
      budgetId: owner().budgetId,
      planId,
      scheduledOn: d(-1),
      planName: 'План',
      planType: 'EXPENSE',
      amountMinor,
      envelopeId: over.envelopeId ?? mandatoryEnvelopeId,
      status: 'DUE',
    },
  });
  return id;
}

const status = async (id: string) =>
  (await prisma.planOccurrence.findUniqueOrThrow({ where: { id } })).status;
const payments = (id: string) =>
  prisma.planPayment.count({ where: { budgetId: owner().budgetId, occurrenceId: id } });
const txCount = () => prisma.transaction.count({ where: { budgetId: owner().budgetId } });
const rejects = (promise: Promise<unknown>, statusCode: number, code?: string) =>
  promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (error: { getStatus?: () => number; getResponse?: () => { code?: string } }) => {
      expect(error.getStatus?.()).toBe(statusCode);
      if (code) expect(error.getResponse?.().code).toBe(code);
    },
  );

describe('v2 обязательства: оплата occurrence несколькими операциями', () => {
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
    service = new ObligationApplicationService(
      servicePrisma,
      new IdempotencyService(),
      new PlanModelPolicy(servicePrisma),
    );

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      ctx[key] = await register(emails[key]);
    }
    await prisma.budget.updateMany({
      where: { id: { in: [owner().budgetId, ctx.outsider!.budgetId] } },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });
    await prisma.budget.update({
      where: { id: owner().budgetId },
      data: { allowNegativeBalance: false },
    });
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: owner().workspaceId,
        userId: ctx.viewer!.userId,
        role: 'VIEWER',
      },
    });
    const b = owner().budgetId;
    accountId = await createAccount(b, 100_000_000n);
    smallAccountId = await createAccount(b, 10_000n);
    expenseCategoryId = await createCategory(b, 'EXPENSE');
    incomeCategoryId = await createCategory(b, 'INCOME');
    mandatoryEnvelopeId = await createEnvelope(b, 'MANDATORY_EXPENSES', null);
    customEnvelopeId = await createEnvelope(b, 'CUSTOM', null);
    outsiderAccountId = await createAccount(ctx.outsider!.budgetId, 100_000_000n);
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
    await servicePrisma.$disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  it('plan 3000, оплата 2000 willPayMore=false: кэш и конверт -2000, occurrence завершён', async () => {
    const id = await occurrence(300_000n);
    const cashBefore = await cash(accountId);
    const envBefore = await mandatoryBalance();
    const res = await pay(id, 'p-food', { amount: '2000.00' });
    expect(res.transaction?.amountMinor).toBe('200000');
    expect(res.occurrence).toMatchObject({
      status: 'COMPLETED',
      expectedMinor: '300000',
      paidMinor: '200000',
      unpaidMinor: '0',
    });
    expect(await cash(accountId)).toBe(cashBefore - 200_000n);
    expect(await mandatoryBalance()).toBe(envBefore - 200_000n);
    expect(await status(id)).toBe('COMPLETED');
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: res.transaction!.id } });
    expect(row).toMatchObject({
      accountingModelVersion: 2,
      status: 'CONFIRMED',
      transactionType: 'EXPENSE',
      envelopeId: mandatoryEnvelopeId,
    });
    expect(await payments(id)).toBe(1);
    const planned = await prisma.planOccurrence.findUniqueOrThrow({ where: { id } });
    expect(planned.amountMinor).toBe(300_000n);
    expect(planned.transactionId).toBeNull();
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: owner().budgetId, entityId: id, entityType: 'plan_occurrence' },
      }),
    ).toBe(1);
  });

  it('аренда 40000: 35000 true, затем 5000 false: две операции, одно occurrence, unpaid 5000 -> 0', async () => {
    const id = await occurrence(4_000_000n);
    const cashBefore = await cash(accountId);
    const envBefore = await mandatoryBalance();
    const first = await pay(id, 'p-rent-1', { amount: '35000.00', willPayMore: true });
    expect(first.occurrence).toMatchObject({
      status: 'DUE',
      unpaidMinor: '500000',
      paidMinor: '3500000',
    });
    expect(await cash(accountId)).toBe(cashBefore - 3_500_000n);
    expect(await mandatoryBalance()).toBe(envBefore - 3_500_000n);
    const second = await pay(id, 'p-rent-2', { amount: '5000.00' });
    expect(second.occurrence).toMatchObject({
      status: 'COMPLETED',
      unpaidMinor: '0',
      paidMinor: '4000000',
    });
    expect(await cash(accountId)).toBe(cashBefore - 4_000_000n);
    expect(await mandatoryBalance()).toBe(envBefore - 4_000_000n);
    expect(await payments(id)).toBe(2);
    expect(await status(id)).toBe('COMPLETED');
  });

  it('willPayMore=true закрывает при достижении или превышении ожидаемой суммы', async () => {
    const id = await occurrence(100_000n);
    const res = await pay(id, 'p-over', { amount: '1500.00', willPayMore: true });
    expect(res.occurrence).toMatchObject({
      status: 'COMPLETED',
      paidMinor: '150000',
      unpaidMinor: '0',
    });
  });

  it('дефицит обязательного конверта: предупреждение, а не блок', async () => {
    const id = await occurrence(100_000n);
    const res = await pay(id, 'p-deficit', { amount: '10.00' });
    expect(res.warnings.map((w) => w.code)).toContain('ENVELOPE_BALANCE_INSUFFICIENT');
  });

  it('конверт с достаточным назначением: предупреждения о дефиците нет', async () => {
    const funded = await createEnvelope(owner().budgetId, 'MANDATORY_EXPENSES', null);
    await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: owner().budgetId,
        envelopeId: funded,
        type: 'FREE',
        amountMinor: 1_000_000n,
        effectiveOn: d(-5),
        status: 'CONFIRMED',
      },
    });
    const id = await occurrence(100_000n, { envelopeId: funded });
    const res = await pay(id, 'p-funded', { amount: '100.00' });
    expect(res.warnings).toEqual([]);
    expect(res.occurrence.status).toBe('COMPLETED');
  });

  it('оплата завершённого occurrence - 409 OCCURRENCE_NOT_OPEN', async () => {
    const id = await occurrence(100_000n);
    await pay(id, 'p-done-1');
    await rejects(pay(id, 'p-done-2'), 409, 'OCCURRENCE_NOT_OPEN');
    expect(await payments(id)).toBe(1);
  });

  it('skip без оплат допустим и не создаёт расход; skip после оплаты - 409', async () => {
    const free = await occurrence(100_000n);
    const before = await txCount();
    const skipped = await service.skip(owner().userId, owner().budgetId, free, 'sk-1');
    expect(skipped.occurrence).toMatchObject({ status: 'SKIPPED', unpaidMinor: '0' });
    expect(await txCount()).toBe(before);
    await rejects(
      service.skip(owner().userId, owner().budgetId, free, 'sk-1b'),
      409,
      'OCCURRENCE_NOT_OPEN',
    );

    const paid = await occurrence(100_000n);
    await pay(paid, 'sk-pay', { amount: '10.00', willPayMore: true });
    await rejects(
      service.skip(owner().userId, owner().budgetId, paid, 'sk-2'),
      409,
      'OCCURRENCE_HAS_PAYMENTS',
    );
    expect(await status(paid)).toBe('DUE');
  });

  it('close требует оплату и завершает без нового расхода', async () => {
    const id = await occurrence(100_000n);
    await rejects(
      service.close(owner().userId, owner().budgetId, id, 'cl-0'),
      409,
      'OCCURRENCE_HAS_NO_PAYMENTS',
    );
    await pay(id, 'cl-pay', { amount: '100.00', willPayMore: true });
    const before = await txCount();
    const closed = await service.close(owner().userId, owner().budgetId, id, 'cl-1');
    expect(closed.occurrence).toMatchObject({
      status: 'COMPLETED',
      unpaidMinor: '0',
      paidMinor: '10000',
    });
    expect(await txCount()).toBe(before);
    await rejects(
      service.close(owner().userId, owner().budgetId, id, 'cl-2'),
      409,
      'OCCURRENCE_NOT_OPEN',
    );
  });

  it('идемпотентность: повтор без дубля, другой запрос с тем же ключом - конфликт', async () => {
    const id = await occurrence(100_000n);
    const before = await cash(accountId);
    const a = await pay(id, 'idem', { amount: '5.00', willPayMore: true });
    const b = await pay(id, 'idem', { amount: '5.00', willPayMore: true });
    expect(b.transaction?.id).toBe(a.transaction?.id);
    expect(await payments(id)).toBe(1);
    expect(await cash(accountId)).toBe(before - 500n);
    await rejects(
      pay(id, 'idem', { amount: '6.00', willPayMore: true }),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('VIEWER 403, посторонний 404, v1-бюджет 409, чужой occurrence 404', async () => {
    const id = await occurrence(100_000n);
    await rejects(service.pay(ctx.viewer!.userId, owner().budgetId, id, input(), 'v-1'), 403);
    await rejects(service.skip(ctx.viewer!.userId, owner().budgetId, id, 'v-2'), 403);
    await rejects(service.pay(ctx.outsider!.userId, owner().budgetId, id, input(), 'o-1'), 404);
    await rejects(
      service.pay(ctx.legacy!.userId, ctx.legacy!.budgetId, id, input(), 'l-1'),
      409,
      'MODEL_VERSION_MISMATCH',
    );
    await rejects(
      service.pay(
        ctx.outsider!.userId,
        ctx.outsider!.budgetId,
        id,
        input({ accountId: outsiderAccountId }),
        'o-2',
      ),
      404,
    );
    await rejects(service.close(ctx.outsider!.userId, ctx.outsider!.budgetId, id, 'o-3'), 404);
    expect(await payments(id)).toBe(0);
    expect(await status(id)).toBe('DUE');
  });

  it('валидация и изоляция: чужой счёт, тип категории, будущая дата, не-обязательный конверт, неактивный план', async () => {
    const id = await occurrence(100_000n);
    await rejects(pay(id, 'i-1', { accountId: outsiderAccountId }), 404);
    await rejects(pay(id, 'i-2', { categoryId: incomeCategoryId }), 400);
    await rejects(pay(id, 'i-3', { occurredOn: tomorrow }), 400, 'VALIDATION_FAILED');
    await rejects(pay(id, 'i-4', { amount: '0' }), 400);

    const custom = await occurrence(100_000n, { envelopeId: customEnvelopeId });
    await rejects(pay(custom, 'i-5'), 409, 'OCCURRENCE_NOT_PAYABLE');
    const inactive = await occurrence(100_000n, { planActive: false });
    await rejects(pay(inactive, 'i-6'), 409, 'OCCURRENCE_NOT_PAYABLE');
    expect(await payments(id)).toBe(0);
  });

  it('строгий счёт: нехватка кэша - 409 INSUFFICIENT_BALANCE без записи', async () => {
    const id = await occurrence(100_000n);
    await rejects(
      pay(id, 's-1', { accountId: smallAccountId, amount: '100.01' }),
      409,
      'INSUFFICIENT_BALANCE',
    );
    expect(await payments(id)).toBe(0);
  });

  it('конкурентная двойная оплата: проходит одна, вторая 409', async () => {
    const id = await occurrence(100_000n);
    const before = await cash(accountId);
    const results = await Promise.allSettled([
      pay(id, 'c-1', { amount: '7.00' }),
      pay(id, 'c-2', { amount: '7.00' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.getStatus()).toBe(409);
    expect(rejected.reason.getResponse().code).toBe('OCCURRENCE_NOT_OPEN');
    expect(await payments(id)).toBe(1);
    expect(await cash(accountId)).toBe(before - 700n);
    expect(await status(id)).toBe('COMPLETED');
  });

  it('HTTP pay: 2000 при плане 3000 - actual 200000, expected 300000 не переписан', async () => {
    const id = await occurrence(300_000n);
    const res = await act(owner(), id, 'pay', 'h-pay-1', payBody({ amount: '2000.00' }));
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      transaction: { amountMinor: string; envelopeId: string };
      occurrence: { status: string; expectedMinor: string; paidMinor: string; unpaidMinor: string };
      warnings: unknown[];
    }>();
    expect(body.transaction.amountMinor).toBe('200000');
    expect(body.occurrence).toMatchObject({
      status: 'COMPLETED',
      expectedMinor: '300000',
      paidMinor: '200000',
      unpaidMinor: '0',
    });
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(await payments(id)).toBe(1);
  });

  it('HTTP skip/close: skip после оплаты 409, close без оплаты 409, skip без оплат transaction null', async () => {
    const paid = await occurrence(100_000n);
    await act(owner(), paid, 'pay', 'h-sk-pay', payBody({ amount: '10.00', willPayMore: true }));
    const skip = await act(owner(), paid, 'skip', 'h-sk-1');
    expect(skip.statusCode).toBe(409);
    expect(skip.json<{ code: string }>().code).toBe('OCCURRENCE_HAS_PAYMENTS');

    const closed = await act(owner(), paid, 'close', 'h-cl-1');
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      transaction: null,
      occurrence: { status: 'COMPLETED', paidMinor: '1000', unpaidMinor: '0' },
    });

    const free = await occurrence(100_000n);
    const noPay = await act(owner(), free, 'close', 'h-cl-2');
    expect(noPay.statusCode).toBe(409);
    expect(noPay.json<{ code: string }>().code).toBe('OCCURRENCE_HAS_NO_PAYMENTS');
    const skipped = await act(owner(), free, 'skip', 'h-sk-2');
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json()).toMatchObject({
      transaction: null,
      occurrence: { status: 'SKIPPED', unpaidMinor: '0' },
    });
  });

  it('HTTP: чужой occurrence 404, VIEWER 403, без сессии 401, без CSRF 403', async () => {
    const id = await occurrence(100_000n);
    const foreign = await act(ctx.outsider, id, 'pay', 'h-f-1', payBody());
    expect(foreign.statusCode).toBe(404);
    const unknown = await act(owner(), randomUUID(), 'skip', 'h-f-2');
    expect(unknown.statusCode).toBe(404);
    const viewer = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${owner().budgetId}/obligations/${id}/pay`,
      headers: httpHeaders(ctx.viewer, 'h-v-1'),
      payload: payBody(),
    });
    expect(viewer.statusCode).toBe(403);
    const anon = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${owner().budgetId}/obligations/${id}/pay`,
      headers: { origin, 'idempotency-key': 'h-a-1' },
      payload: payBody(),
    });
    expect(anon.statusCode).toBe(401);
    const noCsrf = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${owner().budgetId}/obligations/${id}/pay`,
      headers: {
        origin,
        cookie: `harmofin_session=${owner().cookie}`,
        'idempotency-key': 'h-c-1',
      },
      payload: payBody(),
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(await payments(id)).toBe(0);
  });

  it('HTTP: валидация тела и обязательный Idempotency-Key', async () => {
    const id = await occurrence(100_000n);
    for (const over of [
      { amount: '0' },
      { amount: '1.234' },
      { amount: 'abc' },
      { accountId: 'not-uuid' },
      { occurredOn: '30.09.2026' },
      { willPayMore: 'yes' },
      { extra: 1 },
    ]) {
      const res = await act(owner(), id, 'pay', `h-val-${JSON.stringify(over)}`, payBody(over));
      expect(res.statusCode).toBe(400);
    }
    const noKey = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${owner().budgetId}/obligations/${id}/pay`,
      headers: httpHeaders(owner()),
      payload: payBody(),
    });
    expect(noKey.statusCode).toBe(400);
    expect(await payments(id)).toBe(0);
  });

  it('HTTP идемпотентность: повтор возвращает тот же результат, другое тело - конфликт', async () => {
    const id = await occurrence(100_000n);
    const before = await cash(accountId);
    const body = payBody({ amount: '5.00', willPayMore: true });
    const a = await act(owner(), id, 'pay', 'h-idem', body);
    const b = await act(owner(), id, 'pay', 'h-idem', body);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json<{ transaction: { id: string } }>().transaction.id).toBe(
      a.json<{ transaction: { id: string } }>().transaction.id,
    );
    expect(await payments(id)).toBe(1);
    expect(await cash(accountId)).toBe(before - 500n);
    const conflict = await act(
      owner(),
      id,
      'pay',
      'h-idem',
      payBody({ amount: '6.00', willPayMore: true }),
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('OpenAPI описывает pay/skip/close: коды, Idempotency-Key, cookie, 409-коды', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const document = res.json<{
      paths: Record<
        string,
        {
          post?: {
            description?: string;
            parameters?: Array<{ name: string; required?: boolean }>;
            responses?: Record<string, unknown>;
            security?: Array<Record<string, unknown>>;
            requestBody?: unknown;
          };
        }
      >;
    }>();
    for (const action of ['pay', 'skip', 'close']) {
      const op =
        document.paths[`/api/v2/budgets/{budgetId}/obligations/{occurrenceId}/${action}`]?.post;
      expect(op, action).toBeDefined();
      for (const code of ['200', '400', '401', '403', '404', '409', '422']) {
        expect(op?.responses?.[code], `${action} ${code}`).toBeDefined();
      }
      expect(op?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        ]),
      );
      expect(op?.security).toEqual([{ session: [] }]);
      for (const code of [
        'OCCURRENCE_NOT_OPEN',
        'OCCURRENCE_NOT_PAYABLE',
        'OCCURRENCE_HAS_PAYMENTS',
        'OCCURRENCE_HAS_NO_PAYMENTS',
        'INSUFFICIENT_BALANCE',
      ]) {
        expect(op?.description ?? '', `${action} ${code}`).toContain(code);
      }
    }
    const payOp = document.paths['/api/v2/budgets/{budgetId}/obligations/{occurrenceId}/pay']?.post;
    expect(payOp?.requestBody).toBeDefined();
    expect(JSON.stringify(res.json())).toContain('ObligationPayBody');
  });

  it('computeUnpaidMinor: max(0, expected - paid) только для открытых', () => {
    expect(computeUnpaidMinor('DUE', 500n, 200n)).toBe(300n);
    expect(computeUnpaidMinor('PENDING', 500n, 900n)).toBe(0n);
    expect(computeUnpaidMinor('COMPLETED', 500n, 0n)).toBe(0n);
    expect(computeUnpaidMinor('SKIPPED', 500n, 0n)).toBe(0n);
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
