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
import { AssignmentApplicationService } from '../src/envelope-plans/assignment.application.service.js';
import { EnvelopePlanApplicationService } from '../src/envelope-plans/envelope-plan.application.service.js';
import { createEnvelopeSchema } from '../src/envelope-plans/envelope-plan.schemas.js';
import { MovementApplicationService } from '../src/envelope-plans/movement.application.service.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

const emails = {
  owner: `v2-env-owner-${randomUUID()}@harmofin.test`,
  outsider: `v2-env-outsider-${randomUUID()}@harmofin.test`,
  viewer: `v2-env-viewer-${randomUUID()}@harmofin.test`,
  legacy: `v2-env-legacy-${randomUUID()}@harmofin.test`,
};

type RegisteredUser = { userId: string; workspaceId: string; budgetId: string };
type Context = Record<keyof typeof emails, RegisteredUser>;

let app: NestFastifyApplication;
let server: FastifyInstance;
let service: EnvelopePlanApplicationService;
let movements: MovementApplicationService;
let assignments: AssignmentApplicationService;
const ctx: Partial<Context> = {};

let outsiderEnvelope: string;
let firstMandatory: string;
let firstPeriod: string;
let fundedEnvelope: string;
let emptyEnvelope: string;

describe('v2 envelopes: create, read, safe archive', () => {
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
    }
    for (const key of ['owner', 'outsider'] as const) {
      await prisma.budget.update({
        where: { id: ctx[key]!.budgetId },
        data: { planModelVersion: 2, planModelActivatedOn: new Date(), timezone: 'UTC' },
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

    await createAccount(ctx.owner?.budgetId, 30_000_000n);
    outsiderEnvelope = await createEnvelope(ctx.outsider?.budgetId, 'CUSTOM', 'Чужой');

    const prismaService = new PrismaService(databaseUrl);
    service = new EnvelopePlanApplicationService(
      prismaService,
      new IdempotencyService(),
      new PlanModelPolicy(prismaService),
    );
    movements = new MovementApplicationService(
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

  it('создание собственного накопления без счёта: баланс 0, без физических полей', async () => {
    const created = await service!.create(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { name: 'Накопление', envelopeType: 'SAVINGS_GOAL', targetAmountMinor: '50000' },
      'env-create-savings',
    );
    expect(created.status).toBe(201);
    expect(created.body.balanceMinor).toBe('0');
    expect(created.body.fundedMinor).toBe('0');
    expect(created.body.spentMinor).toBe('0');
    expect(created.body.targetAmountMinor).toBe('50000');
    expect('startingBalanceMinor' in created.body).toBe(false);
    expect('cashMinor' in created.body).toBe(false);

    const replay = await service!.create(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { name: 'Накопление', envelopeType: 'SAVINGS_GOAL', targetAmountMinor: '50000' },
      'env-create-savings',
    );
    expect(replay.body.id).toBe(created.body.id);

    const conflict = await expectError(
      service!.create(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        { name: 'Другое накопление', envelopeType: 'SAVINGS_GOAL' },
        'env-create-savings',
      ),
    );
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');

    const listed = await service!.list(ctx.owner!.userId, ctx.owner!.budgetId);
    expect(listed.status).toBe(200);
    const item = listed.body.items.find((e) => e.id === created.body.id);
    expect(item?.balanceMinor).toBe('0');

    const fetched = await service!.get(ctx.owner!.userId, ctx.owner!.budgetId, created.body.id);
    expect(fetched.status).toBe(200);
    expect(fetched.body.balanceMinor).toBe('0');
  });

  it('уникальность роли обязательного и области действия периода', async () => {
    const mandatory = await service!.create(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { name: 'Обязательные', envelopeType: 'MANDATORY_EXPENSES' },
      'env-create-mandatory',
    );
    expect(mandatory.status).toBe(201);
    firstMandatory = mandatory.body.id;

    const secondMandatory = await expectError(
      service!.create(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        { name: 'Обязательные 2', envelopeType: 'MANDATORY_EXPENSES' },
        'env-create-mandatory-2',
      ),
    );
    expect(secondMandatory.status).toBe(409);
    expect(secondMandatory.code).toBe('MANDATORY_ENVELOPE_EXISTS');

    const current = await service!.create(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { name: 'Платежи', envelopeType: 'CURRENT_EXPENSES', periodSlot: 'FIRST' },
      'env-create-current-first',
    );
    expect(current.status).toBe(201);
    firstPeriod = current.body.id;

    const secondSlot = await expectError(
      service!.create(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        { name: 'Платежи 2', envelopeType: 'CURRENT_EXPENSES', periodSlot: 'FIRST' },
        'env-create-current-second',
      ),
    );
    expect(secondSlot.status).toBe(409);
    expect(secondSlot.code).toBe('PERIOD_SLOT_ALREADY_ASSIGNED');

    const slotOnNonCurrent = await expectError(
      service!.create(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        { name: 'Плюс', envelopeType: 'CUSTOM', periodSlot: 'FIRST' },
        'env-create-custom-slot',
      ),
    );
    expect(slotOnNonCurrent.status).toBe(400);

    const currentWithoutSlot = await expectError(
      service!.create(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        { name: 'Платежи без слота', envelopeType: 'CURRENT_EXPENSES' },
        'env-create-current-noslot',
      ),
    );
    expect(currentWithoutSlot.status).toBe(400);

    expect(() =>
      createEnvelopeSchema.parse({ name: 'Свободные', envelopeType: 'FREE_MONEY' }),
    ).toThrow();
  });

  it('архив с балансом отклоняется; после переноса в свободные проходит', async () => {
    const funded = await service!.create(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { name: 'Фундированный', envelopeType: 'CUSTOM' },
      'env-create-funded',
    );
    fundedEnvelope = funded.body.id;

    const assigned = await assignments!.assignFree(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { envelopeId: fundedEnvelope, amount: '100', sourceKind: 'FREE' },
      'env-fund-100',
    );
    expect(assigned.status).toBe(201);

    const blocked = await expectError(
      service!.archive(ctx.owner!.userId, ctx.owner!.budgetId, fundedEnvelope, 'env-archive-1'),
    );
    expect(blocked.status).toBe(409);
    expect(blocked.code).toBe('ENVELOPE_HAS_BALANCE');

    const moved = await movements!.move(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { sourceEnvelopeId: fundedEnvelope, destinationEnvelopeId: null, amount: '100' },
      'env-move-to-free',
    );
    expect(moved.status).toBe(201);

    const archived = await service!.archive(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      fundedEnvelope,
      'env-archive-2',
    );
    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).toBeTruthy();

    const fetched = await service!.get(ctx.owner!.userId, ctx.owner!.budgetId, fundedEnvelope);
    expect(fetched.body.archivedAt).toBeTruthy();
    expect(fetched.body.balanceMinor).toBe('0');

    const listed = await service!.list(ctx.owner!.userId, ctx.owner!.budgetId);
    expect(listed.body.items.some((e) => e.id === fundedEnvelope)).toBe(false);

    const again = await expectError(
      service!.archive(ctx.owner!.userId, ctx.owner!.budgetId, fundedEnvelope, 'env-archive-3'),
    );
    expect(again.status).toBe(400);
  });

  it('чужой конверт 404, VIEWER 403, бюджет v1 не принимает v2-действия', async () => {
    const foreign = await expectError(
      service!.get(ctx.owner!.userId, ctx.owner!.budgetId, outsiderEnvelope),
    );
    expect(foreign.status).toBe(404);

    const foreignUpdate = await expectError(
      service!.update(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        outsiderEnvelope,
        { name: 'Взлом' },
        'env-update-foreign',
      ),
    );
    expect(foreignUpdate.status).toBe(404);

    const viewerCreate = await expectError(
      service!.create(
        ctx.viewer!.userId,
        ctx.owner!.budgetId,
        { name: 'Зрительское', envelopeType: 'CUSTOM' },
        'env-create-viewer',
      ),
    );
    expect(viewerCreate.status).toBe(403);

    const viewerArchive = await expectError(
      service!.archive(
        ctx.viewer!.userId,
        ctx.owner!.budgetId,
        firstMandatory!,
        'env-archive-viewer',
      ),
    );
    expect(viewerArchive.status).toBe(403);

    const legacy = await expectError(
      service!.create(
        ctx.legacy!.userId,
        ctx.legacy!.budgetId,
        { name: 'Наследие', envelopeType: 'CUSTOM' },
        'env-create-legacy',
      ),
    );
    expect(legacy.status).toBe(409);
    expect(legacy.code).toBe('MODEL_VERSION_MISMATCH');
  });

  it('изменение области действия отклоняется при истории назначений', async () => {
    const empty = await service!.create(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { name: 'Пустой', envelopeType: 'CUSTOM' },
      'env-create-empty',
    );
    emptyEnvelope = empty.body.id;

    const renamed = await service!.update(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      emptyEnvelope,
      { name: 'Пустой 2' },
      'env-rename-empty',
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Пустой 2');

    const slotOnCustom = await expectError(
      service!.update(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        emptyEnvelope,
        { periodSlot: 'SECOND' },
        'env-slot-custom',
      ),
    );
    expect(slotOnCustom.status).toBe(400);

    const assigned = await assignments!.assignFree(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      { envelopeId: firstPeriod!, amount: '10', sourceKind: 'FREE' },
      'env-fund-current',
    );
    expect(assigned.status).toBe(201);

    const slotChange = await expectError(
      service!.update(
        ctx.owner!.userId,
        ctx.owner!.budgetId,
        firstPeriod!,
        { periodSlot: 'SECOND' },
        'env-slot-change',
      ),
    );
    expect(slotChange.status).toBe(400);
    expect(slotChange.code).toBe('VALIDATION_FAILED');

    const renamedPeriod = await service!.update(
      ctx.owner!.userId,
      ctx.owner!.budgetId,
      firstPeriod!,
      { name: 'Платежи 2' },
      'env-rename-period',
    );
    expect(renamedPeriod.status).toBe(200);
    expect(renamedPeriod.body.name).toBe('Платежи 2');
  });
});

afterAll(async () => {
  for (const key of Object.keys(ctx) as Array<keyof Context>) {
    await cleanupUser(ctx[key]?.userId ?? '');
  }
  await app.close();
  await prisma.$disconnect();
});

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
      accountingStartDate: new Date(Date.now() - 90 * 86_400_000),
    },
  });
  return account.id;
}

async function createEnvelope(
  budgetId: string | undefined,
  envelopeType: 'CUSTOM',
  name: string,
): Promise<string> {
  if (!budgetId) throw new Error('Budget missing');
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name,
      envelopeType,
      startingBalanceMinor: 0n,
      displayOrder: 950,
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
