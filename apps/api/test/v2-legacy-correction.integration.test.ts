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
const dayMs = 86_400_000;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = todayInTimezone(new Date(), 'UTC');
const SETTINGS = { cycleStartDay: 1, periodBoundaryOffset: 14, timezone: 'UTC' };
const PERIOD = cycleAndPeriodFor(SETTINGS, TODAY).period;
const longAgo = todayInTimezone(new Date(Date.now() - 40 * dayMs), 'UTC');

type User = { userId: string; workspaceId: string; budgetId: string; cookie: string; csrf: string };
type World = User & {
  accountId: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
  mainEnvelopeId: string;
  customEnvelopeId: string;
  periodId: string;
  openingId: string;
};
type Operation = {
  responses: Record<string, { description?: string }>;
  requestBody?: unknown;
  parameters?: unknown[];
};
type Res = { statusCode: number; json<T = Record<string, unknown>>(): T };

let app: NestFastifyApplication;
let server: FastifyInstance;
const balances = new FinancialBalanceRepository();
const createdUsers: string[] = [];

const headers = (user: User, key?: string): Record<string, string> => ({
  origin,
  cookie: `harmofin_session=${user.cookie}`,
  'x-csrf-token': user.csrf,
  ...(key ? { 'idempotency-key': key } : {}),
});
const post = (
  w: User,
  txId: string,
  action: 'correction-preview' | 'correct',
  payload: Record<string, unknown>,
  key?: string,
  as: User = w,
): Promise<Res> =>
  server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${w.budgetId}/history/${txId}/${action}`,
    headers: headers(as, key ?? (action === 'correct' ? `k-${randomUUID()}` : undefined)),
    payload,
  }) as unknown as Promise<Res>;
const cash = (w: World) =>
  prisma.$transaction((tx) => balances.accountBalance(tx, w.budgetId, w.accountId));
const summary = async (w: World) =>
  (
    await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${w.budgetId}/dashboard?asOf=${TODAY}`,
      headers: { origin, cookie: `harmofin_session=${w.cookie}` },
    })
  ).json();

describe('исправление старой физической операции после cutover (P02b)', () => {
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

  it('правка старого расхода на +1000 ₽: cash -1000 ₽, safe пересчитан, opening не тронут', async () => {
    const w = await world(600_000n);
    const legacy = await legacyTx(w, 'EXPENSE', 100_000n);
    expect(await cash(w)).toBe(500_000n);
    const before = await summary(w);
    expect(before.spendable).toEqual({ state: 'READY', amountMinor: '500000' });

    const preview = await post(w, legacy, 'correction-preview', { amount: '2000.00' });
    expect(preview.statusCode).toBe(200);
    const body = preview.json();
    expect(body).toMatchObject({
      cashDeltaMinor: '-100000',
      newSafe: { state: 'READY', amountMinor: '400000' },
      linkedAllocations: [],
      allocationResolutionRequired: false,
    });
    expect(body.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof body.explanation === 'string' || body.explanation === null).toBe(true);
    // preview ничего не меняет
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: legacy } })).amountMinor,
    ).toBe(100_000n);
    expect(
      await prisma.auditEvent.count({ where: { budgetId: w.budgetId, entityId: legacy } }),
    ).toBe(0);

    const beforeCash = await cash(w);
    const beforeOpening = (
      await prisma.envelopeAssignment.findUniqueOrThrow({ where: { id: w.openingId } })
    ).amountMinor;
    const done = await post(w, legacy, 'correct', {
      amount: '2000.00',
      previewHash: body.previewHash,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      id: legacy,
      amountMinor: '200000',
      status: 'CONFIRMED',
      cashDeltaMinor: '-100000',
      newSafe: { state: 'READY', amountMinor: '400000' },
    });
    const afterCash = await cash(w);
    expect(afterCash - beforeCash).toBe(-100_000n);
    const afterOpening = (
      await prisma.envelopeAssignment.findUniqueOrThrow({ where: { id: w.openingId } })
    ).amountMinor;
    expect(afterOpening).toBe(beforeOpening);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId: w.budgetId } })).toBe(1);
    const after = await summary(w);
    expect(after.spendable).toEqual({ state: 'READY', amountMinor: '400000' });
    expect(after.currentBalanceMinor).toBe(before.currentBalanceMinor);
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: w.budgetId, entityId: legacy, action: 'LEGACY_CORRECTED' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: w.budgetId, entityId: legacy, action: 'UPDATED' },
      }),
    ).toBe(1);
  });

  it('status DELETED логически удаляет старый факт и возвращает деньги; запись сохраняется', async () => {
    const w = await world(600_000n);
    const legacy = await legacyTx(w, 'EXPENSE', 100_000n);
    const preview = (await post(w, legacy, 'correction-preview', { status: 'DELETED' })).json();
    expect(preview.cashDeltaMinor).toBe('100000');
    const done = await post(w, legacy, 'correct', {
      status: 'DELETED',
      previewHash: preview.previewHash,
    });
    expect(done.statusCode).toBe(200);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: legacy } });
    expect(row.status).toBe('DELETED');
    expect(row.deletedAt).not.toBeNull();
    expect(row.preDeleteStatus).toBe('CONFIRMED');
    expect(await cash(w)).toBe(600_000n);
  });

  it('уменьшение дохода ниже суммы allocations без resolution - 409; CANCEL и DELETE в одной транзакции', async () => {
    const w = await world(600_000n);
    for (const resolution of ['CANCEL', 'DELETE'] as const) {
      const income = await legacyTx(w, 'INCOME', 100_000n);
      const allocation = await legacyAllocation(w, income, 80_000n);
      const preview = (await post(w, income, 'correction-preview', { amount: '500.00' })).json();
      expect(preview.cashDeltaMinor).toBe('-50000');
      expect(preview.allocationResolutionRequired).toBe(true);
      expect(preview.linkedAllocations).toEqual([
        expect.objectContaining({ id: allocation, amountMinor: '80000', status: 'CONFIRMED' }),
      ]);
      const without = await post(w, income, 'correct', {
        amount: '500.00',
        previewHash: preview.previewHash,
      });
      expect(without.statusCode).toBe(409);
      expect(without.json().code).toBe('ALLOCATION_RESOLUTION_REQUIRED');
      expect(
        (await prisma.transaction.findUniqueOrThrow({ where: { id: income } })).amountMinor,
      ).toBe(100_000n);

      const done = await post(w, income, 'correct', {
        amount: '500.00',
        previewHash: preview.previewHash,
        allocationResolution: resolution,
      });
      expect(done.statusCode).toBe(200);
      expect(
        (await prisma.transaction.findUniqueOrThrow({ where: { id: income } })).amountMinor,
      ).toBe(50_000n);
      const row = await prisma.incomeAllocation.findUniqueOrThrow({ where: { id: allocation } });
      expect(row.status).toBe(resolution === 'CANCEL' ? 'CANCELLED' : 'DELETED');
      if (resolution === 'DELETE') expect(row.deletedAt).not.toBeNull();
      const confirmed = await prisma.incomeAllocation.aggregate({
        where: { budgetId: w.budgetId, incomeTransactionId: income, status: 'CONFIRMED' },
        _sum: { amountMinor: true },
      });
      expect(confirmed._sum.amountMinor ?? 0n).toBeLessThanOrEqual(50_000n);
      expect(
        await prisma.auditEvent.count({
          where: {
            budgetId: w.budgetId,
            entityType: 'income_allocation',
            entityId: allocation,
            action: resolution === 'CANCEL' ? 'CANCELLED' : 'DELETED',
          },
        }),
      ).toBe(1);
      expect(
        await prisma.auditEvent.count({
          where: { budgetId: w.budgetId, entityId: income, action: 'LEGACY_CORRECTED' },
        }),
      ).toBe(1);
    }
  });

  it('уменьшение дохода, при котором allocations помещаются, не требует resolution; лишний resolution - 409', async () => {
    const w = await world(600_000n);
    const income = await legacyTx(w, 'INCOME', 100_000n);
    const allocation = await legacyAllocation(w, income, 80_000n);
    const preview = (await post(w, income, 'correction-preview', { amount: '900.00' })).json();
    expect(preview.allocationResolutionRequired).toBe(false);
    expect(preview.linkedAllocations).toHaveLength(1);
    const extra = await post(w, income, 'correct', {
      amount: '900.00',
      previewHash: preview.previewHash,
      allocationResolution: 'CANCEL',
    });
    expect(extra.statusCode).toBe(409);
    expect(extra.json().code).toBe('ALLOCATION_RESOLUTION_NOT_REQUIRED');
    const done = await post(w, income, 'correct', {
      amount: '900.00',
      previewHash: preview.previewHash,
    });
    expect(done.statusCode).toBe(200);
    expect(
      (await prisma.incomeAllocation.findUniqueOrThrow({ where: { id: allocation } })).status,
    ).toBe('CONFIRMED');
  });

  it('устаревший или чужой previewHash - 409 PREVIEW_STALE, ничего не меняется', async () => {
    const w = await world(600_000n);
    const legacy = await legacyTx(w, 'EXPENSE', 100_000n);
    const preview = (await post(w, legacy, 'correction-preview', { amount: '2000.00' })).json();
    await prisma.transaction.update({ where: { id: legacy }, data: { amountMinor: 110_000n } });
    const stale = await post(w, legacy, 'correct', {
      amount: '2000.00',
      previewHash: preview.previewHash,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('PREVIEW_STALE');
    const bogus = await post(w, legacy, 'correct', {
      amount: '2000.00',
      previewHash: 'a'.repeat(64),
    });
    expect(bogus.statusCode).toBe(409);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: legacy } })).amountMinor,
    ).toBe(110_000n);
  });

  it('повтор с тем же ключом возвращает тот же ответ без второго применения; другое тело - конфликт', async () => {
    const w = await world(600_000n);
    const legacy = await legacyTx(w, 'EXPENSE', 100_000n);
    const preview = (await post(w, legacy, 'correction-preview', { amount: '2000.00' })).json();
    const payload = { amount: '2000.00', previewHash: preview.previewHash };
    const first = await post(w, legacy, 'correct', payload, 'idem-1');
    const replay = await post(w, legacy, 'correct', payload, 'idem-1');
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await cash(w)).toBe(400_000n);
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: w.budgetId, entityId: legacy, action: 'LEGACY_CORRECTED' },
      }),
    ).toBe(1);
    const conflict = await post(
      w,
      legacy,
      'correct',
      { amount: '3000.00', previewHash: preview.previewHash },
      'idem-1',
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('IDEMPOTENCY_CONFLICT');
    const missingKey = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${w.budgetId}/history/${legacy}/correct`,
      headers: headers(w),
      payload,
    });
    expect(missingKey.statusCode).toBe(400);
  });

  it('роли и изоляция: EDITOR/VIEWER 403, чужая и несуществующая операция 404, факт модели 2 и бюджет модели 1 - 409', async () => {
    const w = await world(600_000n);
    const legacy = await legacyTx(w, 'EXPENSE', 100_000n);
    for (const role of ['EDITOR', 'VIEWER'] as const) {
      const member = await register();
      await prisma.workspaceMembership.create({
        data: { id: randomUUID(), workspaceId: w.workspaceId, userId: member.userId, role },
      });
      const preview = await post(
        w,
        legacy,
        'correction-preview',
        { amount: '2000.00' },
        'x',
        member,
      );
      expect(preview.statusCode).toBe(403);
      const done = await post(
        w,
        legacy,
        'correct',
        { amount: '2000.00', previewHash: 'a'.repeat(64) },
        undefined,
        member,
      );
      expect(done.statusCode).toBe(403);
    }
    // чужая операция другого бюджета под своим budgetId
    const other = await world(600_000n);
    const foreign = await legacyTx(other, 'EXPENSE', 100_000n);
    for (const id of [foreign, randomUUID()]) {
      expect((await post(w, id, 'correction-preview', { amount: '2000.00' })).statusCode).toBe(404);
      expect(
        (await post(w, id, 'correct', { amount: '2000.00', previewHash: 'a'.repeat(64) }))
          .statusCode,
      ).toBe(404);
    }
    // посторонний пользователь в чужом бюджете
    expect(
      (await post(w, legacy, 'correction-preview', { amount: '2000.00' }, undefined, other))
        .statusCode,
    ).toBe(404);
    // факт модели 2
    const v2 = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: w.budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: 1_000n,
        occurredOn: day(TODAY),
        accountId: w.accountId,
        categoryId: w.expenseCategoryId,
        isPlanned: false,
        confirmedAt: new Date(),
        createdByUserId: w.userId,
        updatedByUserId: w.userId,
        accountingModelVersion: 2,
      },
    });
    const notLegacy = await post(w, v2.id, 'correction-preview', { amount: '2.00' });
    expect(notLegacy.statusCode).toBe(409);
    expect(notLegacy.json().code).toBe('NOT_LEGACY_FACT');
    // бюджет модели 1
    await prisma.budget.update({
      where: { id: other.budgetId },
      data: { planModelVersion: 1, planModelActivatedOn: null },
    });
    const v1 = await post(other, foreign, 'correction-preview', { amount: '2000.00' });
    expect(v1.statusCode).toBe(409);
    expect(v1.json().code).toBe('MODEL_VERSION_MISMATCH');
    // валидация тела
    expect((await post(w, legacy, 'correction-preview', {})).statusCode).toBe(400);
    expect((await post(w, legacy, 'correction-preview', { amount: '0' })).statusCode).toBe(400);
    expect(
      (await post(w, legacy, 'correction-preview', { amount: '1.00', extra: 1 })).statusCode,
    ).toBe(400);
  });

  it('понижение OWNER до EDITOR: повтор того же ключа и тела - 403, а не replay', async () => {
    const w = await world(600_000n);
    const legacy = await legacyTx(w, 'EXPENSE', 100_000n);
    const preview = (await post(w, legacy, 'correction-preview', { amount: '2000.00' })).json();
    const payload = { amount: '2000.00', previewHash: preview.previewHash };
    expect((await post(w, legacy, 'correct', payload, 'demote-1')).statusCode).toBe(200);
    await prisma.workspaceMembership.updateMany({
      where: { workspaceId: w.workspaceId, userId: w.userId },
      data: { role: 'EDITOR' },
    });
    const replay = await post(w, legacy, 'correct', payload, 'demote-1');
    expect(replay.statusCode).toBe(403);
  });

  it('предпросмотр не-OWNER не берёт блокировку бюджета', async () => {
    const w = await world(600_000n);
    const legacy = await legacyTx(w, 'EXPENSE', 100_000n);
    const member = await register();
    await prisma.workspaceMembership.create({
      data: { id: randomUUID(), workspaceId: w.workspaceId, userId: member.userId, role: 'EDITOR' },
    });
    const outcome = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "budgets" WHERE "id" = ${w.budgetId}::uuid FOR UPDATE`;
        return Promise.race([
          post(w, legacy, 'correction-preview', { amount: '2000.00' }, undefined, member),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3_000)),
        ]);
      },
      { timeout: 10_000 },
    );
    expect(outcome).not.toBe('timeout');
    expect((outcome as Res).statusCode).toBe(403);
  });

  /** Доход 1000 ₽ (+ allocation 800 ₽), расходы доводят cash счёта до 200 ₽. */
  async function lowCashSetup(w: World, withAllocation: boolean) {
    const income = await legacyTx(w, 'INCOME', 100_000n);
    const allocation = withAllocation ? await legacyAllocation(w, income, 80_000n) : null;
    await legacyTx(w, 'EXPENSE', 680_000n); // 600k + 100k - 680k = 20k
    return { income, allocation };
  }

  it('INSUFFICIENT_BALANCE: уменьшение и удаление дохода уводят cash < 0 - 409 без изменений; allowNegativeBalance - 200', async () => {
    const w = await world(600_000n);
    const { income } = await lowCashSetup(w, false);
    expect(await cash(w)).toBe(20_000n);
    const audit = () => prisma.auditEvent.count({ where: { budgetId: w.budgetId } });
    const auditBefore = await audit();
    for (const payload of [{ amount: '500.00' }, { status: 'DELETED' }]) {
      const preview = await post(w, income, 'correction-preview', payload);
      expect(preview.statusCode).toBe(409);
      expect(preview.json().code).toBe('INSUFFICIENT_BALANCE');
      const done = await post(w, income, 'correct', { ...payload, previewHash: 'a'.repeat(64) });
      expect(done.statusCode).toBe(409);
      expect(done.json().code).toBe('INSUFFICIENT_BALANCE');
    }
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: income } });
    expect(row.amountMinor).toBe(100_000n);
    expect(row.status).toBe('CONFIRMED');
    expect(await audit()).toBe(auditBefore);
    expect(await cash(w)).toBe(20_000n);

    await prisma.budget.update({ where: { id: w.budgetId }, data: { allowNegativeBalance: true } });
    const preview = (await post(w, income, 'correction-preview', { amount: '500.00' })).json();
    const ok = await post(w, income, 'correct', {
      amount: '500.00',
      previewHash: preview.previewHash,
    });
    expect(ok.statusCode).toBe(200);
    expect(await cash(w)).toBe(-30_000n);
  });

  it('TRANSACTION_NOT_EDITABLE: повторная правка после DELETED, DRAFT и CANCELLED факт', async () => {
    const w = await world(600_000n);
    const legacy = await legacyTx(w, 'EXPENSE', 100_000n);
    const preview = (await post(w, legacy, 'correction-preview', { status: 'DELETED' })).json();
    expect(
      (await post(w, legacy, 'correct', { status: 'DELETED', previewHash: preview.previewHash }))
        .statusCode,
    ).toBe(200);
    const again = await post(w, legacy, 'correction-preview', { amount: '5.00' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('TRANSACTION_NOT_EDITABLE');
    for (const status of ['DRAFT', 'CANCELLED'] as const) {
      const id = await legacyTx(w, 'EXPENSE', 10_000n);
      await prisma.transaction.update({
        where: { id },
        data: {
          status,
          confirmedAt: null,
          ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        },
      });
      for (const action of ['correction-preview', 'correct'] as const) {
        const res = await post(
          w,
          id,
          action,
          action === 'correct'
            ? { amount: '5.00', previewHash: 'a'.repeat(64) }
            : { amount: '5.00' },
        );
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe('TRANSACTION_NOT_EDITABLE');
      }
    }
  });

  it('предпросмотр дохода с allocations ничего не пишет: allocations, audit, idempotency не меняются', async () => {
    const w = await world(600_000n);
    const income = await legacyTx(w, 'INCOME', 100_000n);
    const allocation = await legacyAllocation(w, income, 80_000n);
    const snap = async () => ({
      allocation: await prisma.incomeAllocation.findUniqueOrThrow({ where: { id: allocation } }),
      income: await prisma.transaction.findUniqueOrThrow({ where: { id: income } }),
      audit: await prisma.auditEvent.count({ where: { budgetId: w.budgetId } }),
      idem: await prisma.idempotencyRecord.count({ where: { budgetId: w.budgetId } }),
    });
    const before = await snap();
    for (const payload of [{ amount: '500.00' }, { status: 'DELETED' }]) {
      expect((await post(w, income, 'correction-preview', payload)).statusCode).toBe(200);
    }
    expect(await snap()).toEqual(before);
    expect(before.allocation.status).toBe('CONFIRMED');
    expect(before.allocation.deletedAt).toBeNull();
  });

  it('атомарность correct: падение с allocationResolution не меняет allocations, доход, audit и idempotency', async () => {
    const w = await world(600_000n);
    const { income, allocation } = await lowCashSetup(w, true);
    const snap = async () => ({
      allocation: await prisma.incomeAllocation.findUniqueOrThrow({ where: { id: allocation! } }),
      income: await prisma.transaction.findUniqueOrThrow({ where: { id: income } }),
      audit: await prisma.auditEvent.count({ where: { budgetId: w.budgetId } }),
      idem: await prisma.idempotencyRecord.count({ where: { budgetId: w.budgetId } }),
    });
    const before = await snap();
    const insufficient = await post(w, income, 'correct', {
      amount: '500.00',
      previewHash: 'a'.repeat(64),
      allocationResolution: 'CANCEL',
    });
    expect(insufficient.statusCode).toBe(409);
    expect(insufficient.json().code).toBe('INSUFFICIENT_BALANCE');
    expect(await snap()).toEqual(before);

    // устаревший hash при допустимом балансе
    await prisma.budget.update({ where: { id: w.budgetId }, data: { allowNegativeBalance: true } });
    const preview = (await post(w, income, 'correction-preview', { amount: '500.00' })).json();
    await prisma.incomeAllocation.update({
      where: { id: allocation! },
      data: { amountMinor: 70_000n },
    });
    const mid = await snap();
    const staleRes = await post(w, income, 'correct', {
      amount: '500.00',
      previewHash: preview.previewHash,
      allocationResolution: 'DELETE',
    });
    expect(staleRes.statusCode).toBe(409);
    expect(staleRes.json().code).toBe('PREVIEW_STALE');
    expect(await snap()).toEqual(mid);
  });

  it('409 без resolution оставляет allocations CONFIRMED; та же сумма - 400; allocation другого бюджета не затрагивается', async () => {
    const w = await world(600_000n);
    const other = await world(600_000n);
    const otherIncome = await legacyTx(other, 'INCOME', 100_000n);
    const otherAllocation = await legacyAllocation(other, otherIncome, 80_000n);
    const income = await legacyTx(w, 'INCOME', 100_000n);
    const allocation = await legacyAllocation(w, income, 80_000n);
    const preview = (await post(w, income, 'correction-preview', { amount: '500.00' })).json();
    const missing = await post(w, income, 'correct', {
      amount: '500.00',
      previewHash: preview.previewHash,
    });
    expect(missing.statusCode).toBe(409);
    expect(
      (await prisma.incomeAllocation.findUniqueOrThrow({ where: { id: allocation } })).status,
    ).toBe('CONFIRMED');
    expect((await post(w, income, 'correction-preview', { amount: '1000.00' })).statusCode).toBe(
      400,
    );
    expect(
      (await post(w, income, 'correct', { amount: '1000.00', previewHash: 'a'.repeat(64) }))
        .statusCode,
    ).toBe(400);
    const done = await post(w, income, 'correct', {
      amount: '500.00',
      previewHash: preview.previewHash,
      allocationResolution: 'DELETE',
    });
    expect(done.statusCode).toBe(200);
    expect(
      (await prisma.incomeAllocation.findUniqueOrThrow({ where: { id: otherAllocation } })).status,
    ).toBe('CONFIRMED');
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: otherIncome } })).amountMinor,
    ).toBe(100_000n);
  });

  it('OpenAPI описывает оба POST, Idempotency-Key, ответы и ошибки', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, Operation>>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    }>();
    const preview =
      document.paths['/api/v2/budgets/{budgetId}/history/{transactionId}/correction-preview']?.post;
    const correct =
      document.paths['/api/v2/budgets/{budgetId}/history/{transactionId}/correct']?.post;
    expect(preview).toBeDefined();
    expect(correct).toBeDefined();
    for (const operation of [preview!, correct!]) {
      for (const status of ['200', '400', '401', '403', '404', '409']) {
        expect(operation.responses[status]).toBeDefined();
      }
      expect(operation.requestBody).toBeDefined();
    }
    const text = (operation: Operation, status: string) => operation.responses[status]!.description;
    for (const code of [
      'MODEL_VERSION_MISMATCH',
      'NOT_LEGACY_FACT',
      'TRANSACTION_NOT_EDITABLE',
      'INSUFFICIENT_BALANCE',
    ]) {
      expect(text(preview!, '409')).toContain(code);
      expect(text(correct!, '409')).toContain(code);
    }
    for (const code of [
      'INVALID_TRANSACTION_STATE',
      'PREVIEW_STALE',
      'ALLOCATION_RESOLUTION_REQUIRED',
      'ALLOCATION_RESOLUTION_NOT_REQUIRED',
      'IDEMPOTENCY_CONFLICT',
    ]) {
      expect(text(correct!, '409')).toContain(code);
    }
    expect(text(preview!, '409')).not.toContain('INVALID_TRANSACTION_STATE');
    expect(text(correct!, '400')).toContain('Idempotency-Key');
    for (const operation of [preview!, correct!]) {
      expect(text(operation, '400')).toContain('VALIDATION_FAILED');
      expect(text(operation, '403')).toContain('OWNER');
      expect(text(operation, '404')).toContain('RESOURCE_NOT_FOUND');
    }
    expect(correct!.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', in: 'header' })]),
    );
    expect(
      Object.keys(document.components.schemas.LegacyCorrectionPreviewResponse!.properties!),
    ).toEqual(
      expect.arrayContaining([
        'cashDeltaMinor',
        'newSafe',
        'newFreeToAssignMinor',
        'linkedAllocations',
        'allocationResolutionRequired',
        'previewHash',
        'explanation',
      ]),
    );
    expect(document.components.schemas.LegacyCorrectionBody).toBeDefined();
  });
});

async function register(): Promise<User> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email: `v2-lcorr-${randomUUID()}@harmofin.test`, password },
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

/** Бюджет модели 2 после cutover: текущий период с целью, opening-назначение 5000 ₽. */
async function world(startingBalanceMinor: bigint): Promise<World> {
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
      startingBalanceMinor,
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
  const envelope = (envelopeType: 'CURRENT_EXPENSES' | 'CUSTOM') =>
    prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: b,
        name: `Е ${randomUUID().slice(0, 6)}`,
        envelopeType,
        startingBalanceMinor: 0n,
        displayOrder: 950,
        ...(envelopeType === 'CURRENT_EXPENSES' ? { periodSlot: PERIOD.id } : {}),
      },
    });
  const main = await envelope('CURRENT_EXPENSES');
  const custom = await envelope('CUSTOM');
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
  const opening = await prisma.envelopeAssignment.create({
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
  return {
    ...user,
    accountId: account.id,
    expenseCategoryId: expenseCategory.id,
    incomeCategoryId: incomeCategory.id,
    mainEnvelopeId: main.id,
    customEnvelopeId: custom.id,
    periodId: period.id,
    openingId: opening.id,
  };
}

async function legacyTx(w: World, type: 'INCOME' | 'EXPENSE', amountMinor: bigint) {
  const row = await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      transactionType: type,
      status: 'CONFIRMED',
      amountMinor,
      occurredOn: day(longAgo),
      accountId: w.accountId,
      categoryId: type === 'INCOME' ? w.incomeCategoryId : w.expenseCategoryId,
      envelopeId: type === 'EXPENSE' ? w.customEnvelopeId : null,
      isPlanned: false,
      confirmedAt: new Date(),
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
      accountingModelVersion: 1,
    },
  });
  return row.id;
}

async function legacyAllocation(w: World, incomeId: string, amountMinor: bigint) {
  const row = await prisma.incomeAllocation.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      incomeTransactionId: incomeId,
      status: 'CONFIRMED',
      amountMinor,
      occurredOn: day(longAgo),
      accountId: w.accountId,
      envelopeId: w.customEnvelopeId,
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
  return row.id;
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
