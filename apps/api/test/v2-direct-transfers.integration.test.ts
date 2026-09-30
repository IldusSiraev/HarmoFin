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
import { PrismaService } from '../src/database/prisma.service.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { DirectTransferApplicationService } from '../src/v2-transfers/direct-transfer.application.service.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const dayMs = 86_400_000;

const d = (delta: number) => new Date(Date.now() + delta * dayMs);

const emails = {
  owner: `v2-direct-owner-${randomUUID()}@harmofin.test`,
  viewer: `v2-direct-viewer-${randomUUID()}@harmofin.test`,
  outsider: `v2-direct-outsider-${randomUUID()}@harmofin.test`,
  legacy: `v2-direct-legacy-${randomUUID()}@harmofin.test`,
};

type RegisteredUser = { userId: string; workspaceId: string; budgetId: string };
type Context = Record<keyof typeof emails, RegisteredUser>;

let app: NestFastifyApplication;
let server: FastifyInstance;
let service: DirectTransferApplicationService;
const balances = new FinancialBalanceRepository();
const ctx: Partial<Context> = {};
let ownerAccountId: string;
let ownerAccountIdB: string;
let archivedAccountId: string;
let envelopeId: string;
let outsiderAccountId: string;

describe('v2 прямые переводы между счетами без конвертов (ACCOUNT_ONLY)', () => {
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

    // v1-legacy остаётся на planModelVersion=1; остальные бюджеты — v2
    await prisma.budget.update({
      where: { id: ctx.owner!.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });
    await prisma.budget.update({
      where: { id: ctx.outsider!.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });

    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: ctx.owner!.workspaceId,
        userId: ctx.viewer!.userId,
        role: 'VIEWER',
      },
    });

    ownerAccountId = await createRawAccount(ctx.owner!.budgetId, 'RUB', 10_000_000n);
    ownerAccountIdB = await createRawAccount(ctx.owner!.budgetId, 'RUB', 0n);
    archivedAccountId = await createRawAccount(ctx.owner!.budgetId, 'RUB', 0n);
    await prisma.account.update({
      where: { id: archivedAccountId },
      data: { archivedAt: new Date() },
    });
    envelopeId = await createEnvelope(ctx.owner!.budgetId, 'P');
    outsiderAccountId = await createRawAccount(ctx.outsider!.budgetId, 'RUB', 10_000_000n);

    service = new DirectTransferApplicationService(
      new PrismaService(databaseUrl),
      new IdempotencyService(),
      new PlanModelPolicy(new PrismaService(databaseUrl)),
    );
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

  const today = todayInTimezone(new Date(), 'UTC');
  const ownerBudgetId = () => ctx.owner!.budgetId;

  const accountBalance = (accountId: string) =>
    prisma.$transaction((tx) => balances.accountBalance(tx, ctx.owner!.budgetId, accountId));

  it('подтверждает прямой перевод: балансы изменились, кэш бюджета сохранён, конверты не затронуты', async () => {
    const beforeSource = await accountBalance(ownerAccountId);
    const beforeDestination = await accountBalance(ownerAccountIdB);
    expect(beforeSource).toBe(10_000_000n);
    expect(beforeDestination).toBe(0n);

    const view = await service.create(
      ctx.owner!.userId,
      ownerBudgetId(),
      {
        sourceAccountId: ownerAccountId,
        destinationAccountId: ownerAccountIdB,
        amount: '50000',
        occurredOn: today,
      },
      'direct-base',
    );

    expect(view.id).toBeTruthy();
    expect(view.budgetId).toBe(ctx.owner!.budgetId);
    expect(view.status).toBe('CONFIRMED');
    expect(view.mode).toBe('ACCOUNT_ONLY');
    expect(view.totalMinor).toBe('5000000');
    expect(view.sourceAccountId).toBe(ownerAccountId);
    expect(view.destinationAccountId).toBe(ownerAccountIdB);
    expect(view.occurredOn).toBe(today);

    const afterSource = await accountBalance(ownerAccountId);
    const afterDestination = await accountBalance(ownerAccountIdB);
    expect(afterSource).toBe(5_000_000n);
    expect(afterDestination).toBe(5_000_000n);
    expect(afterSource + afterDestination).toBe(beforeSource + beforeDestination);

    expect(await prisma.transferPart.count({ where: { transferId: view.id } })).toBe(0);
    expect(await prisma.envelopeMovement.count({ where: { budgetId: ctx.owner!.budgetId } })).toBe(
      0,
    );
    expect(
      await prisma.envelopeAssignment.count({ where: { budgetId: ctx.owner!.budgetId } }),
    ).toBe(0);
  });

  it('легаси-перевод с частями и прямой перевод учитываются независимо', async () => {
    const beforeSource = await accountBalance(ownerAccountId);
    const beforeDestination = await accountBalance(ownerAccountIdB);

    const legacy = await prisma.transfer.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.owner!.budgetId,
        status: 'CONFIRMED',
        mode: 'LEGACY_PARTS',
        totalMinor: 2_000_000n,
        occurredOn: d(-2),
        confirmedAt: new Date(),
        sourceAccountId: null,
        destinationAccountId: null,
        createdByUserId: ctx.owner!.userId,
        updatedByUserId: ctx.owner!.userId,
      },
    });
    await prisma.transferPart.create({
      data: {
        id: randomUUID(),
        transferId: legacy.id,
        budgetId: ctx.owner!.budgetId,
        sourceAccountId: ownerAccountId,
        destinationAccountId: ownerAccountIdB,
        sourceEnvelopeId: envelopeId,
        destinationEnvelopeId: envelopeId,
        amountMinor: 2_000_000n,
      },
    });

    expect(await accountBalance(ownerAccountId)).toBe(beforeSource - 2_000_000n);
    expect(await accountBalance(ownerAccountIdB)).toBe(beforeDestination + 2_000_000n);
  });

  it('отклоняет перевод между одинаковыми счетами', async () => {
    const before = await prisma.transfer.count({ where: { budgetId: ownerBudgetId() } });
    const error = await expectError(
      service.create(
        ctx.owner!.userId,
        ownerBudgetId(),
        {
          sourceAccountId: ownerAccountId,
          destinationAccountId: ownerAccountId,
          amount: '100',
          occurredOn: today,
        },
        'direct-same-accounts',
      ),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('TRANSFER_ACCOUNTS_MUST_DIFFER');
    expect(await prisma.transfer.count({ where: { budgetId: ownerBudgetId() } })).toBe(before);
  });

  it('не видит счета из других бюджетов', async () => {
    const sourceError = await expectError(
      service.create(
        ctx.owner!.userId,
        ownerBudgetId(),
        {
          sourceAccountId: outsiderAccountId,
          destinationAccountId: ownerAccountId,
          amount: '100',
          occurredOn: today,
        },
        'direct-cross-source',
      ),
    );
    expect(sourceError.status).toBe(404);
    expect(sourceError.code).toBe('RESOURCE_NOT_FOUND');

    const destinationError = await expectError(
      service.create(
        ctx.owner!.userId,
        ownerBudgetId(),
        {
          sourceAccountId: ownerAccountId,
          destinationAccountId: outsiderAccountId,
          amount: '100',
          occurredOn: today,
        },
        'direct-cross-destination',
      ),
    );
    expect(destinationError.status).toBe(404);
    expect(destinationError.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('не позволяет снять больше доступного кэша (строго) и не меняет состояния', async () => {
    const beforeSource = await accountBalance(ownerAccountId);
    const beforeCount = await prisma.transfer.count({
      where: { budgetId: ownerBudgetId(), mode: 'ACCOUNT_ONLY', status: 'CONFIRMED' },
    });
    const error = await expectError(
      service.create(
        ctx.owner!.userId,
        ownerBudgetId(),
        {
          sourceAccountId: ownerAccountId,
          destinationAccountId: ownerAccountIdB,
          amount: '40000',
          occurredOn: today,
        },
        'direct-overshoot',
      ),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await accountBalance(ownerAccountId)).toBe(beforeSource);
    expect(
      await prisma.transfer.count({
        where: { budgetId: ownerBudgetId(), mode: 'ACCOUNT_ONLY', status: 'CONFIRMED' },
      }),
    ).toBe(beforeCount);
  });

  it('повтор того же ключа идемпотентности воспроизводит результат, другой запрос — конфликт', async () => {
    // После T1 (50000) и legacy-перевода (20000) на счете A доступно ровно 30000
    const original = await service.create(
      ctx.owner!.userId,
      ownerBudgetId(),
      {
        sourceAccountId: ownerAccountId,
        destinationAccountId: ownerAccountIdB,
        amount: '30000',
        occurredOn: today,
      },
      'direct-replay',
    );
    const afterSource = await accountBalance(ownerAccountId);
    const afterDestination = await accountBalance(ownerAccountIdB);
    expect(afterSource).toBe(0n);
    expect(afterDestination).toBe(10_000_000n);

    const replayed = await service.create(
      ctx.owner!.userId,
      ownerBudgetId(),
      {
        sourceAccountId: ownerAccountId,
        destinationAccountId: ownerAccountIdB,
        amount: '30000',
        occurredOn: today,
      },
      'direct-replay',
    );
    expect(replayed.id).toBe(original.id);
    expect(replayed.totalMinor).toBe('3000000');
    expect(await accountBalance(ownerAccountId)).toBe(afterSource);
    expect(await accountBalance(ownerAccountIdB)).toBe(afterDestination);
    expect(
      await prisma.transfer.count({
        where: { budgetId: ownerBudgetId(), mode: 'ACCOUNT_ONLY', status: 'CONFIRMED' },
      }),
    ).toBe(2);

    const conflict = await expectError(
      service.create(
        ctx.owner!.userId,
        ownerBudgetId(),
        {
          sourceAccountId: ownerAccountId,
          destinationAccountId: ownerAccountIdB,
          amount: '20000',
          occurredOn: today,
        },
        'direct-replay',
      ),
    );
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await accountBalance(ownerAccountId)).toBe(afterSource);
    expect(await accountBalance(ownerAccountIdB)).toBe(afterDestination);
  });

  it('отклоняет будущую дату без записи', async () => {
    const before = await prisma.transfer.count({ where: { budgetId: ownerBudgetId() } });
    const future = todayInTimezone(new Date(Date.now() + dayMs), 'UTC');
    const error = await expectError(
      service.create(
        ctx.owner!.userId,
        ownerBudgetId(),
        {
          sourceAccountId: ownerAccountId,
          destinationAccountId: ownerAccountIdB,
          amount: '100',
          occurredOn: future,
        },
        'direct-future',
      ),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(await prisma.transfer.count({ where: { budgetId: ownerBudgetId() } })).toBe(before);
  });

  it('DRAFT, CANCELLED и DELETED прямые переводы не влияют на балансы', async () => {
    const beforeSource = await accountBalance(ownerAccountId);
    const beforeDestination = await accountBalance(ownerAccountIdB);

    for (const status of ['DRAFT', 'CANCELLED', 'DELETED'] as const) {
      await prisma.transfer.create({
        data: {
          id: randomUUID(),
          budgetId: ctx.owner!.budgetId,
          status,
          mode: 'ACCOUNT_ONLY',
          totalMinor: 1_000_000n,
          occurredOn: d(-1),
          sourceAccountId: ownerAccountId,
          destinationAccountId: ownerAccountIdB,
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
          deletedAt: status === 'DELETED' ? new Date() : null,
          createdByUserId: ctx.owner!.userId,
          updatedByUserId: ctx.owner!.userId,
        },
      });
    }

    expect(await accountBalance(ownerAccountId)).toBe(beforeSource);
    expect(await accountBalance(ownerAccountIdB)).toBe(beforeDestination);
  });

  it('viewer — 403, чужой бюджет — 404, бюджет v1 — 409', async () => {
    const viewerError = await expectError(
      service.create(
        ctx.viewer!.userId,
        ownerBudgetId(),
        {
          sourceAccountId: ownerAccountId,
          destinationAccountId: ownerAccountIdB,
          amount: '100',
          occurredOn: today,
        },
        'direct-viewer',
      ),
    );
    expect(viewerError.status).toBe(403);
    expect(viewerError.code).toBe('FORBIDDEN');

    const outsiderError = await expectError(
      service.create(
        ctx.outsider!.userId,
        ownerBudgetId(),
        {
          sourceAccountId: ownerAccountId,
          destinationAccountId: ownerAccountIdB,
          amount: '100',
          occurredOn: today,
        },
        'direct-outsider',
      ),
    );
    expect(outsiderError.status).toBe(404);
    expect(outsiderError.code).toBe('RESOURCE_NOT_FOUND');

    const legacyError = await expectError(
      service.create(
        ctx.legacy!.userId,
        ctx.legacy!.budgetId,
        {
          sourceAccountId: ownerAccountId,
          destinationAccountId: ownerAccountIdB,
          amount: '100',
          occurredOn: today,
        },
        'direct-legacy',
      ),
    );
    expect(legacyError.status).toBe(409);
    expect(legacyError.code).toBe('MODEL_VERSION_MISMATCH');
  });

  it('архивный счёт — 400, некорректные суммы — 400', async () => {
    const base = {
      sourceAccountId: ownerAccountId,
      destinationAccountId: ownerAccountIdB,
      amount: '100',
      occurredOn: today,
    };

    const archivedError = await expectError(
      service.create(
        ctx.owner!.userId,
        ownerBudgetId(),
        { ...base, sourceAccountId: archivedAccountId },
        'direct-archived',
      ),
    );
    expect(archivedError.status).toBe(400);
    expect(archivedError.code).toBe('REFERENCE_INVALID');

    for (const amount of ['0', '-5', 'abc']) {
      const amountError = await expectError(
        service.create(ctx.owner!.userId, ownerBudgetId(), { ...base, amount }, 'direct-amount'),
      );
      expect(amountError.status).toBe(400);
      expect(amountError.code).toBe('VALIDATION_FAILED');
    }
  });
});

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
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
  };
}

async function createRawAccount(
  budgetId: string,
  currency: string,
  startingBalanceMinor: bigint,
): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Счёт ${randomUUID().slice(0, 8)}`,
      accountType: 'BANK_ACCOUNT',
      currency,
      scale: 2,
      startingBalanceMinor,
      accountingStartDate: d(-90),
    },
  });
  return account.id;
}

async function createEnvelope(budgetId: string, code: string): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Envelope ${code}`,
      envelopeType: 'MANDATORY_EXPENSES',
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
    await prisma.transferPart.deleteMany({
      where: { transfer: { budget: { workspaceId } } },
    });
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

async function expectError(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    const exception = error as { getStatus?: () => number; getResponse?: () => unknown };
    const response =
      typeof exception.getResponse === 'function' ? exception.getResponse() : undefined;
    const body =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : {};
    return {
      status: typeof exception.getStatus === 'function' ? exception.getStatus() : 0,
      code: typeof body.code === 'string' ? body.code : '',
    };
  }
  throw new Error('Expected error was not thrown');
}
