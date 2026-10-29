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
import { MovementApplicationService } from '../src/envelope-plans/movement.application.service.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const dayMs = 86_400_000;

const d = (delta: number) => new Date(Date.now() + delta * dayMs);

const emails = {
  owner: `v2-move-owner-${randomUUID()}@harmofin.test`,
  outsider: `v2-move-outsider-${randomUUID()}@harmofin.test`,
  viewer: `v2-move-viewer-${randomUUID()}@harmofin.test`,
};

type RegisteredUser = { userId: string; workspaceId: string; budgetId: string };
type Context = Record<keyof typeof emails, RegisteredUser>;

let app: NestFastifyApplication;
let server: FastifyInstance;
let service: MovementApplicationService;
let assignments: AssignmentApplicationService;
const ctx: Partial<Context> = {};

let ownerSavingsEnvelope: string;
let ownerMandatoryEnvelope: string;
let ownerPeriodEnvelope: string;
let periodP1: string;
let periodP2: string;
let outsiderEnvelope: string;
let outsiderPeriod: string;
let firstMovementId: string;

describe('v2 envelope movements: move', () => {
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

    await createAccount(ctx.owner?.budgetId, ctx.owner?.userId, 30_000_000n);
    ownerSavingsEnvelope = await createEnvelope(
      ctx.owner?.budgetId,
      ctx.owner?.userId,
      'SAVINGS_GOAL',
      'Накопление',
    );
    ownerMandatoryEnvelope = await createEnvelope(
      ctx.owner?.budgetId,
      ctx.owner?.userId,
      'MANDATORY_EXPENSES',
      'Обязательные',
    );
    ownerPeriodEnvelope = await createEnvelope(
      ctx.owner?.budgetId,
      ctx.owner?.userId,
      'CUSTOM',
      'Периодный',
    );
    periodP1 = await createPeriod(ctx.owner?.budgetId, ownerPeriodEnvelope, d(-31), d(-1));
    periodP2 = await createPeriod(ctx.owner?.budgetId, ownerPeriodEnvelope, d(0), d(30));

    await createAccount(ctx.outsider?.budgetId, ctx.outsider?.userId, 10_000_000n);
    outsiderEnvelope = await createEnvelope(
      ctx.outsider?.budgetId,
      ctx.outsider?.userId,
      'CUSTOM',
      'Чужой',
    );
    outsiderPeriod = await createPeriod(ctx.outsider?.budgetId, outsiderEnvelope, d(-31), d(-1));

    const prismaService = new PrismaService(databaseUrl);
    service = new MovementApplicationService(
      prismaService,
      new IdempotencyService(),
      new PlanModelPolicy(prismaService),
    );
    assignments = new AssignmentApplicationService(
      prismaService,
      new IdempotencyService(),
      new PlanModelPolicy(prismaService),
    );
  });

  it('перенос между периодами одного конверта: кэш и сумма периодов не меняются', async () => {
    const opened = await assignments!.assignFree(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      {
        envelopeId: ownerPeriodEnvelope!,
        periodId: periodP1!,
        amount: '10000',
        sourceKind: 'OPENING',
      },
      'mv-open-p1',
    );
    expect(opened.status).toBe(201);

    const asOf = new Date();
    const beforeCash = await cashOf(ctx.owner!.budgetId);
    const beforeP1 = await balance(ctx.owner!.budgetId, ownerPeriodEnvelope!, periodP1!, asOf);
    const beforeP2 = await balance(ctx.owner!.budgetId, ownerPeriodEnvelope!, periodP2!, asOf);
    expect(beforeP1.balance).toBe(1_000_000n);
    expect(beforeP2.balance).toBe(0n);

    const result = await service!.move(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      {
        sourceEnvelopeId: ownerPeriodEnvelope!,
        sourcePeriodId: periodP1!,
        destinationEnvelopeId: ownerPeriodEnvelope!,
        destinationPeriodId: periodP2!,
        amount: '10000',
      },
      'mv-p1-p2',
    );
    expect(result.status).toBe(201);
    expect(result.body.movementId).toBeTruthy();
    firstMovementId = result.body.movementId;

    const afterCash = await cashOf(ctx.owner!.budgetId);
    const afterP1 = await balance(ctx.owner!.budgetId, ownerPeriodEnvelope!, periodP1!, asOf);
    const afterP2 = await balance(ctx.owner!.budgetId, ownerPeriodEnvelope!, periodP2!, asOf);
    expect(afterCash).toBe(beforeCash);
    expect(afterP1.balance).toBe(0n);
    expect(afterP2.balance).toBe(1_000_000n);
    expect(afterP1.balance + afterP2.balance).toBe(beforeP1.balance + beforeP2.balance);
  });

  it('накопление→обязательные и конверт→свободные', async () => {
    const openedSavings = await assignments!.assignFree(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { envelopeId: ownerSavingsEnvelope!, amount: '5000', sourceKind: 'FREE' },
      'mv-open-savings',
    );
    expect(openedSavings.status).toBe(201);

    const asOf = new Date();
    const beforeCash = await cashOf(ctx.owner!.budgetId);

    const toMandatory = await service!.move(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      {
        sourceEnvelopeId: ownerSavingsEnvelope!,
        destinationEnvelopeId: ownerMandatoryEnvelope!,
        amount: '3000',
      },
      'mv-sav-mand',
    );
    expect(toMandatory.status).toBe(201);
    expect(await balance(ctx.owner!.budgetId, ownerSavingsEnvelope!, null, asOf)).toMatchObject({
      balance: 200_000n,
    });
    expect(await balance(ctx.owner!.budgetId, ownerMandatoryEnvelope!, null, asOf)).toMatchObject({
      balance: 300_000n,
    });
    expect(await cashOf(ctx.owner!.budgetId)).toBe(beforeCash);

    const replay = await service!.move(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      {
        sourceEnvelopeId: ownerSavingsEnvelope!,
        destinationEnvelopeId: ownerMandatoryEnvelope!,
        amount: '3000',
      },
      'mv-sav-mand',
    );
    expect(replay.status).toBe(201);
    expect(replay.body.movementId).toBe(toMandatory.body.movementId);

    const conflict = await expectError(
      service!.move(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        {
          sourceEnvelopeId: ownerSavingsEnvelope!,
          destinationEnvelopeId: ownerMandatoryEnvelope!,
          amount: '4000',
        },
        'mv-sav-mand',
      ),
    );
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');

    const toFree = await service!.move(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { sourceEnvelopeId: ownerSavingsEnvelope!, destinationEnvelopeId: null, amount: '2000' },
      'mv-sav-free',
    );
    expect(toFree.status).toBe(201);
    expect((await balance(ctx.owner!.budgetId, ownerSavingsEnvelope!, null, asOf)).balance).toBe(
      0n,
    );
  });

  it('перевод сверх остатка, чужой период и самоперенос отклоняются', async () => {
    const over = await expectError(
      service!.move(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        {
          sourceEnvelopeId: ownerSavingsEnvelope!,
          destinationEnvelopeId: ownerMandatoryEnvelope!,
          amount: '1000',
        },
        'mv-over',
      ),
    );
    expect(over.status).toBe(409);
    expect(over.code).toBe('INSUFFICIENT_ENVELOPE_BALANCE');

    const wrongSourcePeriod = await expectError(
      service!.move(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        {
          sourceEnvelopeId: ownerSavingsEnvelope!,
          sourcePeriodId: periodP1!,
          destinationEnvelopeId: ownerMandatoryEnvelope!,
          amount: '100',
        },
        'mv-wrong-source-period',
      ),
    );
    expect(wrongSourcePeriod.status).toBe(404);

    const wrongDestinationPeriod = await expectError(
      service!.move(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        {
          sourceEnvelopeId: ownerMandatoryEnvelope!,
          destinationEnvelopeId: ownerPeriodEnvelope!,
          destinationPeriodId: outsiderPeriod!,
          amount: '100',
        },
        'mv-wrong-dest-period',
      ),
    );
    expect(wrongDestinationPeriod.status).toBe(404);

    const selfMove = await expectError(
      service!.move(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        {
          sourceEnvelopeId: ownerSavingsEnvelope!,
          destinationEnvelopeId: ownerSavingsEnvelope!,
          amount: '100',
        },
        'mv-self',
      ),
    );
    expect(selfMove.status).toBe(400);
    expect(selfMove.code).toBe('VALIDATION_FAILED');
  });

  it('обратное переназначение проходит проверки источника и не удаляет прежнее движение', async () => {
    const movementsBefore = await prisma.envelopeMovement.count({
      where: { budgetId: ctx.owner!.budgetId },
    });

    const result = await service!.move(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      {
        sourceEnvelopeId: ownerMandatoryEnvelope!,
        destinationEnvelopeId: ownerSavingsEnvelope!,
        amount: '3000',
      },
      'mv-mand-sav-reverse',
    );
    expect(result.status).toBe(201);
    expect(result.body.movementId).not.toBe(firstMovementId);

    const movementsAfter = await prisma.envelopeMovement.count({
      where: { budgetId: ctx.owner!.budgetId },
    });
    expect(movementsAfter).toBe(movementsBefore + 1);

    const original = await prisma.envelopeMovement.findUnique({ where: { id: firstMovementId } });
    expect(original?.status).toBe('CONFIRMED');
    expect(original?.amountMinor).toBe(1_000_000n);
  });

  it('чужой конверт → 404, VIEWER → 403', async () => {
    const foreign = await expectError(
      service!.move(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        {
          sourceEnvelopeId: outsiderEnvelope!,
          destinationEnvelopeId: ownerMandatoryEnvelope!,
          amount: '100',
        },
        'mv-foreign',
      ),
    );
    expect(foreign.status).toBe(404);

    const viewerMove = await expectError(
      service!.move(
        ctx.viewer!.userId,
        ctx.owner!.budgetId,
        {
          sourceEnvelopeId: ownerMandatoryEnvelope!,
          destinationEnvelopeId: ownerSavingsEnvelope!,
          amount: '100',
        },
        'mv-viewer',
      ),
    );
    expect(viewerMove.status).toBe(403);
  });
});

afterAll(async () => {
  for (const key of Object.keys(ctx) as Array<keyof Context>) {
    await cleanupUser(ctx[key]?.userId ?? '');
  }
  await app.close();
  await prisma.$disconnect();
});

async function cashOf(budgetId: string): Promise<bigint> {
  const asOf = new Date();
  const [row] = (await prisma.$queryRaw`
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
  `) as unknown as Array<{ cash: string | bigint }>;
  if (!row) throw new Error('Cash row not found.');
  return BigInt(String(row.cash));
}

async function balance(
  budgetId: string,
  envelopeId: string,
  periodId: string | null,
  asOf: Date,
): Promise<{ funded: bigint; spent: bigint; balance: bigint }> {
  return prisma.$transaction((tx) =>
    new AssignmentBalanceRepository().balance(tx, budgetId, envelopeId, periodId, asOf),
  );
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

async function createAccount(
  budgetId: string | undefined,
  ownerUserId: string | undefined,
  startingMinor: bigint,
): Promise<string> {
  if (!budgetId) throw new Error('Budget missing');
  if (!ownerUserId) throw new Error('Owner missing');
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId,
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      startingBalanceMinor: startingMinor,
      accountingStartDate: d(-90),
    },
  });
  return account.id;
}

async function createEnvelope(
  budgetId: string | undefined,
  ownerUserId: string | undefined,
  envelopeType: 'SAVINGS_GOAL' | 'MANDATORY_EXPENSES' | 'CUSTOM',
  name: string,
): Promise<string> {
  if (!budgetId) throw new Error('Budget missing');
  if (!ownerUserId) throw new Error('Owner missing');
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId,
      name,
      envelopeType,
      startingBalanceMinor: 0n,
      displayOrder: 950,
    },
  });
  return envelope.id;
}

async function createPeriod(
  budgetId: string | undefined,
  envelopeId: string,
  startsOn: Date,
  endsOn: Date,
): Promise<string> {
  if (!budgetId) throw new Error('Budget missing');
  const period = await prisma.envelopePeriod.create({
    data: { id: randomUUID(), budgetId, envelopeId, startsOn, endsOn },
  });
  return period.id;
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
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId } });
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
