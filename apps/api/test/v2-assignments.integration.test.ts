import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../src/common/plan-model/plan-model.policy.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AssignmentBalanceRepository } from '../src/envelope-plans/assignment-balance.repository.js';
import { AssignmentApplicationService } from '../src/envelope-plans/assignment.application.service.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const dayMs = 86_400_000;

const d = (delta: number) => new Date(Date.now() + delta * dayMs);

const emails = {
  owner: `v2-assign-owner-${randomUUID()}@harmofin.test`,
  outsider: `v2-assign-outsider-${randomUUID()}@harmofin.test`,
  viewer: `v2-assign-viewer-${randomUUID()}@harmofin.test`,
  openingAfter: `v2-assign-opening-after-${randomUUID()}@harmofin.test`,
  coverage: `v2-assign-coverage-${randomUUID()}@harmofin.test`,
  spendAfter: `v2-assign-spend-after-${randomUUID()}@harmofin.test`,
  decimals: `v2-assign-decimals-${randomUUID()}@harmofin.test`,
};

type RegisteredUser = { userId: string; workspaceId: string; budgetId: string };
type Context = Record<keyof typeof emails, RegisteredUser>;

let app: NestFastifyApplication;
let server: FastifyInstance;
let service: AssignmentApplicationService;
const balances = new AssignmentBalanceRepository();
const ctx: Partial<Context> = {};

describe('v2 envelope assignments: assignFree', () => {
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
      const registered = await register(emails[key]);
      ctx[key] = registered;
      await prisma.budget.update({
        where: { id: registered.budgetId },
        data: {
          planModelVersion: 2,
          planModelActivatedOn: d(-60),
          timezone: 'UTC',
        },
      });
    }

    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: ctx.owner!.workspaceId,
        userId: ctx.viewer!.userId,
        role: 'VIEWER',
      },
    });

    await createAccount(ctx.owner?.budgetId, 10_000_000n);
    ownerEnvelopeA = await createEnvelope(ctx.owner?.budgetId, 'A');
    ownerEnvelopeB = await createEnvelope(ctx.owner?.budgetId, 'B');
    ownerEnvelopeC = await createEnvelope(ctx.owner?.budgetId, 'C');

    const outsiderBudgetId = ctx.outsider?.budgetId;
    outsiderAccountId = await createAccount(outsiderBudgetId, 10_000_000n);
    outsiderCategoryId = await createCategory(outsiderBudgetId, 'Расходы', 'EXPENSE');
    outsiderEnvelopeH = await createEnvelope(outsiderBudgetId, 'H');
    outsiderEnvelopeG = await createEnvelope(outsiderBudgetId, 'G');

    const openingAfterBudgetId = ctx.openingAfter?.budgetId;
    openingAfterAccountId = await createAccount(openingAfterBudgetId, 10_000_000n);
    openingAfterCategoryId = await createCategory(openingAfterBudgetId, 'Расходы', 'EXPENSE');
    openingAfterEnvelopeK = await createEnvelope(openingAfterBudgetId, 'K');
    openingAfterEnvelopeL = await createEnvelope(openingAfterBudgetId, 'L');

    const coverageBudgetId = ctx.coverage?.budgetId;
    coverageAccountId = await createAccount(coverageBudgetId, 10_000_000n);
    coverageCategoryId = await createCategory(coverageBudgetId, 'Расходы', 'EXPENSE');
    coverageEnvelopeD = await createEnvelope(coverageBudgetId, 'D');

    const spendAfterBudgetId = ctx.spendAfter?.budgetId;
    spendAfterAccountId = await createAccount(spendAfterBudgetId, 10_000_000n);
    spendAfterCategoryId = await createCategory(spendAfterBudgetId, 'Расходы', 'EXPENSE');
    spendAfterEnvelopeJ = await createEnvelope(spendAfterBudgetId, 'J');

    const decimalsBudgetId = ctx.decimals?.budgetId;
    await createAccount(decimalsBudgetId, 10_000_000n);
    await createCategory(decimalsBudgetId, 'Расходы', 'EXPENSE');
    decimalsEnvelopeP = await createEnvelope(decimalsBudgetId, 'P');

    service = new AssignmentApplicationService(
      new PrismaService(databaseUrl),
      new IdempotencyService(),
      new PlanModelPolicy(new PrismaService(databaseUrl)),
    );
  });

  afterAll(async () => {
    const viewer = ctx.viewer;
    if (viewer) {
      await prisma.workspaceMembership.deleteMany({
        where: {
          userId: viewer.userId,
          workspaceId: { not: viewer.workspaceId },
        },
      });
    }
    for (const key of Object.keys(ctx) as Array<keyof Context>) {
      await cleanupUser(ctx[key]?.userId ?? '');
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('назначает OPENING до первой операции и считает freeToAssign', async () => {
    const result = await service!.assignFree(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { envelopeId: ownerEnvelopeA!, amount: '60000', sourceKind: 'OPENING' },
      'key-opening-a',
    );
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      amountMinor: '6000000',
      fundedMinor: '6000000',
      spentMinor: '0',
      balanceMinor: '6000000',
      freeToAssignMinor: '4000000',
    });
    expect(result.body.assignmentId).toBeTruthy();
  });

  it('ограничивает назначения суммой наличных: превышение → 409 ASSIGNMENT_UNBACKED', async () => {
    const result = await service!.assignFree(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { envelopeId: ownerEnvelopeB!, amount: '40000', sourceKind: 'FREE' },
      'key-free-b',
    );
    expect(result.status).toBe(201);
    expect(result.body.freeToAssignMinor).toBe('0');

    await expectError(service!.assignFree(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { envelopeId: ownerEnvelopeC!, amount: '0.01', sourceKind: 'FREE' },
      'key-free-c',
    ));
  });

  it('идемпотентный повтор возвращает тот же результат и не дублирует назначение', async () => {
    const replayed = await service!.assignFree(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { envelopeId: ownerEnvelopeA!, amount: '60000', sourceKind: 'OPENING' },
      'key-opening-a',
    );
    expect(replayed.status).toBe(201);
    const first = await prisma.envelopeAssignment.findFirst({
      where: { budgetId: ctx.owner!.budgetId, envelopeId: ownerEnvelopeA! },
    });
    expect(replayed.body.assignmentId).toBe(first?.id);
    expect(replayed.body.freeToAssignMinor).toBe('4000000');
    expect(
      await prisma.envelopeAssignment.count({ where: { budgetId: ctx.owner!.budgetId } }),
    ).toBe(2);
  });

  it('одинаковый ключ с другим payload → 409 IDEMPOTENCY_CONFLICT', async () => {
    const error = await expectError(service!.assignFree(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { envelopeId: ownerEnvelopeA!, amount: '1000', sourceKind: 'OPENING' },
      'key-opening-a',
    ));
    expect(error.status).toBe(409);
    expect(error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('чужой бюджет → 404', async () => {
    const error = await expectError(service!.assignFree(
      ctx.outsider!.userId,
      ctx.owner!.budgetId,
      { envelopeId: ownerEnvelopeA!, amount: '100', sourceKind: 'FREE' },
      'key-outside',
    ));
    expect(error.status).toBe(404);
  });

  it('VIEWER → 403', async () => {
    const error = await expectError(service!.assignFree(
      ctx.viewer!.userId,
      ctx.owner!.budgetId,
      { envelopeId: ownerEnvelopeA!, amount: '100', sourceKind: 'FREE' },
      'key-viewer',
    ));
    expect(error.status).toBe(403);
  });

  it('OPENING после первой подтверждённой операции запрещён, FREE допустим', async () => {
    await createExpense(
      ctx.openingAfter!.budgetId,
      openingAfterAccountId!,
      openingAfterEnvelopeK!,
      openingAfterCategoryId!,
      ctx.openingAfter!.userId,
      1_000n,
      d(-5),
    );
    const openingError = await expectError(service!.assignFree(
      ctx.openingAfter!.userId,
      ctx.openingAfter!.budgetId,
      { envelopeId: openingAfterEnvelopeL!, amount: '10', sourceKind: 'OPENING' },
      'key-opening-after',
    ));
    expect(openingError.status).toBe(400);
    expect(openingError.code).toBe('VALIDATION_FAILED');

    const result = await service!.assignFree(
      ctx.openingAfter!.userId,
      ctx.openingAfter!.budgetId,
      { envelopeId: openingAfterEnvelopeL!, amount: '10', sourceKind: 'FREE' },
      'key-free-after',
    );
    expect(result.status).toBe(201);
    expect(result.body.freeToAssignMinor).toBe('9998000');
  });

  it('назначение покрывает отрицательный баланс без роста защищённых сумм', async () => {
    const budgetId = ctx.coverage!.budgetId;
    await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId,
        envelopeId: coverageEnvelopeD!,
        type: 'OPENING',
        amountMinor: 1_000_000n,
        effectiveOn: d(-10),
      },
    });
    await createExpense(
      budgetId,
      coverageAccountId!,
      coverageEnvelopeD!,
      coverageCategoryId!,
      ctx.coverage!.userId,
      2_000_000n,
      d(-10),
    );

    const result = await service!.assignFree(
      ctx.coverage!.userId,
      budgetId,
      { envelopeId: coverageEnvelopeD!, amount: '10000', sourceKind: 'FREE' },
      'key-coverage',
    );
    expect(result.status).toBe(201);
    expect(result.body.balanceMinor).toBe('0');
    expect(result.body.freeToAssignMinor).toBe('8000000');

    await expect(
      prisma.$transaction((tx) => balances.balance(tx, budgetId, coverageEnvelopeD!, null, new Date())),
    ).resolves.toEqual({ funded: 2_000_000n, spent: 2_000_000n, balance: 0n });
    expect(await cashOf(budgetId)).toBe(8_000_000n);
  });

  it('расход уменьшает кэш, назначение сверх доступных → 409', async () => {
    const budgetId = ctx.outsider!.budgetId;
    await createExpense(
      budgetId,
      outsiderAccountId!,
      outsiderEnvelopeH!,
      outsiderCategoryId!,
      ctx.outsider!.userId,
      5_000_000n,
      d(-3),
    );
    const error = await expectError(service!.assignFree(
      ctx.outsider!.userId,
      budgetId,
      { envelopeId: outsiderEnvelopeG!, amount: '60000', sourceKind: 'FREE' },
      'key-overspend',
    ));
    expect(error.status).toBe(409);
    expect(error.code).toBe('ASSIGNMENT_UNBACKED');
    expect(await prisma.envelopeAssignment.count({ where: { budgetId } })).toBe(0);
  });

  it('назначение первым, затем расход: факты сосуществуют, кэш пересчитывается', async () => {
    const budgetId = ctx.spendAfter!.budgetId;
    const result = await service!.assignFree(
      ctx.spendAfter!.userId,
      budgetId,
      { envelopeId: spendAfterEnvelopeJ!, amount: '70000', sourceKind: 'FREE' },
      'key-spent-after',
    );
    expect(result.status).toBe(201);
    expect(result.body.freeToAssignMinor).toBe('3000000');

    await createExpense(
      budgetId,
      spendAfterAccountId!,
      spendAfterEnvelopeJ!,
      spendAfterCategoryId!,
      ctx.spendAfter!.userId,
      7_000_000n,
      d(-2),
    );
    expect(await prisma.envelopeAssignment.count({ where: { budgetId } })).toBe(1);
    expect(
      await prisma.transaction.count({
        where: { budgetId, envelopeId: spendAfterEnvelopeJ!, status: 'CONFIRMED' },
      }),
    ).toBe(1);
    await expect(
      prisma.$transaction((tx) => balances.balance(tx, budgetId, spendAfterEnvelopeJ!, null, new Date())),
    ).resolves.toEqual({ funded: 7_000_000n, spent: 7_000_000n, balance: 0n });
    expect(await cashOf(budgetId)).toBe(3_000_000n);
  });

  it('decimal string парсится; невалидные суммы → 400', async () => {
    const budgetId = ctx.decimals!.budgetId;
    const parsed = await service!.assignFree(
      ctx.decimals!.userId,
      budgetId,
      { envelopeId: decimalsEnvelopeP!, amount: '60000.5', sourceKind: 'FREE' },
      'key-decimals-parsed',
    );
    expect(parsed.status).toBe(201);
    expect(parsed.body.amountMinor).toBe('6000050');

    for (const amount of ['abc', '-5', '0']) {
      const error = await expectError(service!.assignFree(
        ctx.decimals!.userId,
        budgetId,
        { envelopeId: decimalsEnvelopeP!, amount, sourceKind: 'FREE' },
        `key-decimals-${amount}`,
      ));
      expect(error.status).toBe(400);
    }
  });
});

let ownerEnvelopeA: string;
let ownerEnvelopeB: string;
let ownerEnvelopeC: string;
let outsiderCategoryId: string;
let outsiderEnvelopeH: string;
let outsiderEnvelopeG: string;
let outsiderAccountId: string;
let openingAfterCategoryId: string;
let openingAfterEnvelopeK: string;
let openingAfterEnvelopeL: string;
let openingAfterAccountId: string;
let coverageCategoryId: string;
let coverageEnvelopeD: string;
let coverageAccountId: string;
let spendAfterCategoryId: string;
let spendAfterEnvelopeJ: string;
let spendAfterAccountId: string;
let decimalsEnvelopeP: string;

async function cashOf(budgetId: string): Promise<bigint> {
  const asOf = new Date();
  const [row] = await prisma.$queryRaw`
    SELECT (
      SELECT COALESCE(SUM(a."starting_balance_minor"), 0)
      FROM "accounts" a WHERE a."budget_id" = ${budgetId}::uuid
    )
    + (
      SELECT COALESCE(SUM(t."amount_minor"), 0)
      FROM "transactions" t
      WHERE t."budget_id" = ${budgetId}::uuid
        AND t."status" = 'CONFIRMED'
        AND t."deleted_at" IS NULL
        AND t."transaction_type" = 'INCOME'
        AND t."occurred_on" <= ${asOf}
    )
    - (
      SELECT COALESCE(SUM(e."amount_minor"), 0)
      FROM "transactions" e
      WHERE e."budget_id" = ${budgetId}::uuid
        AND e."status" = 'CONFIRMED'
        AND e."deleted_at" IS NULL
        AND e."transaction_type" = 'EXPENSE'
        AND e."occurred_on" <= ${asOf}
    ) AS cash
  ` as unknown as Array<{ cash: string | bigint }>;
  if (!row) throw new Error('Cash row not found.');
  return BigInt(String(row.cash));
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

async function createAccount(budgetId: string | undefined, startingMinor: bigint): Promise<string> {
  if (!budgetId) throw new Error('Budget missing');
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      startingBalanceMinor: startingMinor,
      accountingStartDate: d(-90),
    },
  });
  return account.id;
}

async function createCategory(
  budgetId: string | undefined,
  name: string,
  categoryType: 'INCOME' | 'EXPENSE',
): Promise<string> {
  if (!budgetId) throw new Error('Budget missing');
  const category = await prisma.category.create({
    data: { id: randomUUID(), budgetId, name, categoryType, displayOrder: 0 },
  });
  return category.id;
}

async function createEnvelope(budgetId: string | undefined, suffix: string): Promise<string> {
  if (!budgetId) throw new Error('Budget missing');
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Конверт ${suffix}`,
      envelopeType: 'CUSTOM',
      startingBalanceMinor: 0n,
      displayOrder: 950,
    },
  });
  return envelope.id;
}

async function createExpense(
  budgetId: string | undefined,
  accountId: string,
  envelopeId: string,
  categoryId: string,
  actorUserId: string,
  amountMinor: bigint,
  occurredOn: Date,
): Promise<void> {
  if (!budgetId) throw new Error('Budget missing');
  await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId,
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      accountingModelVersion: 2,
      amountMinor,
      occurredOn,
      confirmedAt: new Date(occurredOn.getTime() + dayMs),
      envelopeId,
      categoryId,
      accountId,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    },
  });
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
