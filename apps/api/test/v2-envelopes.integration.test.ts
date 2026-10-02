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
import { forceBudgetV1 } from './helpers/plan-model.js';

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

type RegisteredUser = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};
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
let httpEnvelope: string;
let fundedByHttp: string;
let incomeEnvelope: string;

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

    await createAccount(ctx.owner!.budgetId, 30_000_000n);
    outsiderEnvelope = await createEnvelope(ctx.outsider!.budgetId, 'CUSTOM', 'Чужой');

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

describe('v2 envelopes: HTTP-контракт', () => {
  const budgetUrl = (path: string) => `/api/v2/budgets/${ctx.owner!.budgetId ?? 'missing'}${path}`;

  it('GET список: minor-строки, без физических полей; 401 и чужой бюджет 404', async () => {
    const unauth = await server.inject({
      method: 'GET',
      url: budgetUrl('/envelopes'),
      headers: { origin },
    });
    expect(unauth.statusCode).toBe(401);

    const listed = await server.inject({
      method: 'GET',
      url: budgetUrl('/envelopes'),
      headers: authHeaders(ctx.owner),
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json<{ items: Array<Record<string, unknown>> }>();
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(typeof item.balanceMinor).toBe('string');
      expect(typeof item.fundedMinor).toBe('string');
      expect(typeof item.spentMinor).toBe('string');
      expect('startingBalanceMinor' in item).toBe(false);
      expect('cashMinor' in item).toBe(false);
      expect('transferParts' in item).toBe(false);
    }

    const outsider = await server.inject({
      method: 'GET',
      url: budgetUrl('/envelopes'),
      headers: authHeaders(ctx.outsider),
    });
    expect(outsider.statusCode).toBe(404);
  });

  it('POST конверт: 201, idempotent replay, конфликт ключа, unknown field, CSRF, legacy', async () => {
    const url = budgetUrl('/envelopes');
    const key = `http-env-create-${randomUUID()}`;
    const payload = { name: 'HTTP резерв', envelopeType: 'RESERVE' };

    const created = await server.inject({
      method: 'POST',
      url,
      headers: mutationHeaders(ctx.owner, key),
      payload,
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<Record<string, unknown>>();
    expect(createdBody.name).toBe('HTTP резерв');
    expect(createdBody.envelopeType).toBe('RESERVE');
    expect(createdBody.balanceMinor).toBe('0');
    expect('startingBalanceMinor' in createdBody).toBe(false);
    httpEnvelope = String(createdBody.id);

    const replay = await server.inject({
      method: 'POST',
      url,
      headers: mutationHeaders(ctx.owner, key),
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json<Record<string, unknown>>().id).toBe(httpEnvelope);

    const conflict = await server.inject({
      method: 'POST',
      url,
      headers: mutationHeaders(ctx.owner, key),
      payload: { name: 'Другой конверт', envelopeType: 'CUSTOM' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<Record<string, unknown>>().code).toBe('IDEMPOTENCY_CONFLICT');

    const unknown = await server.inject({
      method: 'POST',
      url,
      headers: mutationHeaders(ctx.owner, `http-env-unknown-${randomUUID()}`),
      payload: { ...payload, wrong: 1 },
    });
    expect(unknown.statusCode).toBe(400);
    const unknownBody = unknown.json<{
      code?: string;
      fieldErrors?: Array<{ field: string }>;
    }>();
    expect(unknownBody.code).toBe('VALIDATION_FAILED');
    expect(unknownBody.fieldErrors?.some((f) => f.field === 'wrong')).toBe(true);

    const noCsrf = await server.inject({
      method: 'POST',
      url,
      headers: { ...authHeaders(ctx.owner), 'idempotency-key': `http-env-nocsrf-${randomUUID()}` },
      payload,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json<Record<string, unknown>>().code).toBe('CSRF_INVALID');

    const noKey = await server.inject({
      method: 'POST',
      url,
      headers: { ...authHeaders(ctx.owner), 'x-csrf-token': ctx.owner?.csrfToken ?? '' },
      payload,
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json<Record<string, unknown>>().code).toBe('VALIDATION_FAILED');

    const legacy = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${ctx.legacy?.budgetId ?? 'missing'}/envelopes`,
      headers: mutationHeaders(ctx.legacy, `http-env-legacy-${randomUUID()}`),
      payload: { name: 'Наследие через HTTP', envelopeType: 'CUSTOM' },
    });
    expect(legacy.statusCode).toBe(409);
    expect(legacy.json<Record<string, unknown>>().code).toBe('MODEL_VERSION_MISMATCH');
  });

  it('PATCH: переименование 200, чужой конверт 404, VIEWER 403, без сессии 401', async () => {
    expect(httpEnvelope).toBeTruthy();
    const url = budgetUrl(`/envelopes/${httpEnvelope}`);

    const renamed = await server.inject({
      method: 'PATCH',
      url,
      headers: mutationHeaders(ctx.owner, `http-env-rename-${randomUUID()}`),
      payload: { name: 'HTTP резерв 2' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<Record<string, unknown>>().name).toBe('HTTP резерв 2');

    const foreign = await server.inject({
      method: 'PATCH',
      url: budgetUrl(`/envelopes/${outsiderEnvelope}`),
      headers: mutationHeaders(ctx.owner, `http-env-rename-foreign-${randomUUID()}`),
      payload: { name: 'Взлом через HTTP' },
    });
    expect(foreign.statusCode).toBe(404);

    const viewer = await server.inject({
      method: 'POST',
      url: budgetUrl('/envelopes'),
      headers: mutationHeaders(ctx.viewer, `http-env-viewer-${randomUUID()}`),
      payload: { name: 'Зрительский конверт', envelopeType: 'CUSTOM' },
    });
    expect(viewer.statusCode).toBe(403);

    const unauth = await server.inject({
      method: 'PATCH',
      url,
      headers: {
        origin,
        'idempotency-key': `http-env-unauth-${randomUUID()}`,
        'x-csrf-token': 'x',
      },
      payload: { name: 'Без сессии' },
    });
    expect(unauth.statusCode).toBe(401);
  });

  it('назначение и архив через HTTP: 100 ₽, архив с остатком 409, перенос в свободные', async () => {
    const created = await server.inject({
      method: 'POST',
      url: budgetUrl('/envelopes'),
      headers: mutationHeaders(ctx.owner, `http-env-fund-${randomUUID()}`),
      payload: { name: 'HTTP фонд', envelopeType: 'CUSTOM' },
    });
    expect(created.statusCode).toBe(201);
    fundedByHttp = String(created.json<Record<string, unknown>>().id);

    const assigned = await server.inject({
      method: 'POST',
      url: budgetUrl('/assignments'),
      headers: mutationHeaders(ctx.owner, `http-assign-1-${randomUUID()}`),
      payload: { envelopeId: fundedByHttp, amount: '100.00', sourceKind: 'FREE' },
    });
    expect(assigned.statusCode).toBe(201);
    const assignedBody = assigned.json<Record<string, unknown>>();
    expect(assignedBody.balanceMinor).toBe('10000');
    expect(assignedBody.freeToAssignMinor).toBe('29989000');

    const blocked = await server.inject({
      method: 'POST',
      url: budgetUrl(`/envelopes/${fundedByHttp}/archive`),
      headers: mutationHeaders(ctx.owner, `http-archive-blocked-${randomUUID()}`),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<Record<string, unknown>>().code).toBe('ENVELOPE_HAS_BALANCE');

    const moved = await server.inject({
      method: 'POST',
      url: budgetUrl('/movements'),
      headers: mutationHeaders(ctx.owner, `http-move-1-${randomUUID()}`),
      payload: { sourceEnvelopeId: fundedByHttp, destinationEnvelopeId: null, amount: '100.00' },
    });
    expect(moved.statusCode).toBe(201);
    const movedBody = moved.json<Record<string, unknown>>();
    expect(movedBody.sourceBalanceMinor).toBe('0');
    expect(movedBody.cashMinor).toBe('30000000');

    const archived = await server.inject({
      method: 'POST',
      url: budgetUrl(`/envelopes/${fundedByHttp}/archive`),
      headers: mutationHeaders(ctx.owner, `http-archive-ok-${randomUUID()}`),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<Record<string, unknown>>().archivedAt).toBeTruthy();

    const again = await server.inject({
      method: 'POST',
      url: budgetUrl(`/envelopes/${fundedByHttp}/archive`),
      headers: mutationHeaders(ctx.owner, `http-archive-again-${randomUUID()}`),
    });
    expect(again.statusCode).toBe(400);
  });

  it('назначение дохода: лимит источника, чужой доход 404, incomeTransactionId только для INCOME', async () => {
    const account = await prisma.account.findFirst({
      where: { budgetId: ctx.owner!.budgetId },
      select: { id: true },
    });
    expect(account?.id).toBeTruthy();

    const categoryId = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.owner!.budgetId,
        name: 'Зарплата',
        categoryType: 'INCOME',
        displayOrder: 0,
      },
    });
    const income = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.owner!.budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        accountingModelVersion: 2,
        amountMinor: 20000n,
        occurredOn: new Date(),
        confirmedAt: new Date(),
        categoryId: categoryId.id,
        accountId: account!.id,
        createdByUserId: ctx.owner!.userId,
        updatedByUserId: ctx.owner!.userId,
      },
    });

    const created = await server.inject({
      method: 'POST',
      url: budgetUrl('/envelopes'),
      headers: mutationHeaders(ctx.owner, `http-env-income-${randomUUID()}`),
      payload: { name: 'HTTP доход', envelopeType: 'SAVINGS_GOAL' },
    });
    expect(created.statusCode).toBe(201);
    incomeEnvelope = String(created.json<Record<string, unknown>>().id);

    const assigned = await server.inject({
      method: 'POST',
      url: budgetUrl('/assignments'),
      headers: mutationHeaders(ctx.owner, `http-assign-income-${randomUUID()}`),
      payload: {
        envelopeId: incomeEnvelope,
        incomeTransactionId: income.id,
        sourceKind: 'INCOME',
        amount: '100.00',
      },
    });
    expect(assigned.statusCode).toBe(201);
    const assignedBody = assigned.json<Record<string, unknown>>();
    expect(assignedBody.balanceMinor).toBe('10000');
    expect(assignedBody.freeToAssignMinor).toBe('30009000');

    const exhausted = await server.inject({
      method: 'POST',
      url: budgetUrl('/assignments'),
      headers: mutationHeaders(ctx.owner, `http-assign-income-2-${randomUUID()}`),
      payload: {
        envelopeId: incomeEnvelope,
        incomeTransactionId: income.id,
        sourceKind: 'INCOME',
        amount: '100.01',
      },
    });
    expect(exhausted.statusCode).toBe(409);
    expect(exhausted.json<Record<string, unknown>>().code).toBe('SOURCE_EXHAUSTED');

    const foreignIncomeAccount = await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        name: 'Счёт чужака',
        accountType: 'BANK_ACCOUNT',
        startingBalanceMinor: 10n,
        accountingStartDate: new Date(Date.now() - 90 * 86_400_000),
      },
    });
    const foreignCategory = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        name: 'Доход чужака',
        categoryType: 'INCOME',
        displayOrder: 0,
      },
    });
    const foreignIncome = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        accountingModelVersion: 2,
        amountMinor: 500n,
        occurredOn: new Date(),
        confirmedAt: new Date(),
        categoryId: foreignCategory.id,
        accountId: foreignIncomeAccount.id,
        createdByUserId: ctx.outsider!.userId,
        updatedByUserId: ctx.outsider!.userId,
      },
    });
    const foreignRejected = await server.inject({
      method: 'POST',
      url: budgetUrl('/assignments'),
      headers: mutationHeaders(ctx.owner, `http-assign-foreign-${randomUUID()}`),
      payload: {
        envelopeId: incomeEnvelope,
        incomeTransactionId: foreignIncome.id,
        sourceKind: 'INCOME',
        amount: '5.00',
      },
    });
    expect(foreignRejected.statusCode).toBe(404);

    const freeWithIncome = await server.inject({
      method: 'POST',
      url: budgetUrl('/assignments'),
      headers: mutationHeaders(ctx.owner, `http-assign-free-income-${randomUUID()}`),
      payload: {
        envelopeId: incomeEnvelope,
        sourceKind: 'FREE',
        incomeTransactionId: income.id,
        amount: '1.00',
      },
    });
    expect(freeWithIncome.statusCode).toBe(400);
    expect(freeWithIncome.json<Record<string, unknown>>().code).toBe('VALIDATION_FAILED');

    const incomeWithoutKind = await server.inject({
      method: 'POST',
      url: budgetUrl('/assignments'),
      headers: mutationHeaders(ctx.owner, `http-assign-nokind-${randomUUID()}`),
      payload: { envelopeId: incomeEnvelope, incomeTransactionId: income.id, amount: '1.00' },
    });
    expect(incomeWithoutKind.statusCode).toBe(400);
  });

  it('L03c: корректировка и отмена назначения через HTTP', async () => {
    const created = await server.inject({
      method: 'POST',
      url: budgetUrl('/envelopes'),
      headers: mutationHeaders(ctx.owner, `http-env-l03c-${randomUUID()}`),
      payload: { name: 'HTTP корректировка', envelopeType: 'CUSTOM' },
    });
    expect(created.statusCode).toBe(201);
    const envelopeId = String(created.json<Record<string, unknown>>().id);

    const assigned = await server.inject({
      method: 'POST',
      url: budgetUrl('/assignments'),
      headers: mutationHeaders(ctx.owner, `http-assign-l03c-${randomUUID()}`),
      payload: { envelopeId, amount: '50.00', sourceKind: 'FREE' },
    });
    expect(assigned.statusCode).toBe(201);
    const assignmentId = String(assigned.json<Record<string, unknown>>().assignmentId);

    const url = budgetUrl(`/assignments/${assignmentId}`);
    const revised = await server.inject({
      method: 'PATCH',
      url,
      headers: mutationHeaders(ctx.owner, `http-revise-${randomUUID()}`),
      payload: { amount: '20.00' },
    });
    expect(revised.statusCode).toBe(200);
    const revisedBody = revised.json<Record<string, unknown>>();
    expect(revisedBody.amountMinor).toBe('2000');
    expect(revisedBody.balanceMinor).toBe('2000');

    const overIncrease = await server.inject({
      method: 'PATCH',
      url,
      headers: mutationHeaders(ctx.owner, `http-revise-over-${randomUUID()}`),
      payload: { amount: '60.00' },
    });
    expect(overIncrease.statusCode).toBe(400);
    expect(overIncrease.json<Record<string, unknown>>().code).toBe('VALIDATION_FAILED');

    const unknown = await server.inject({
      method: 'PATCH',
      url: budgetUrl(`/assignments/${randomUUID()}`),
      headers: mutationHeaders(ctx.owner, `http-revise-unknown-${randomUUID()}`),
      payload: { amount: '1.00' },
    });
    expect(unknown.statusCode).toBe(404);

    const cancelled = await server.inject({
      method: 'DELETE',
      url,
      headers: mutationHeaders(ctx.owner, `http-cancel-${randomUUID()}`),
    });
    expect(cancelled.statusCode).toBe(200);
    const cancelledBody = cancelled.json<Record<string, unknown>>();
    expect(cancelledBody.balanceMinor).toBe('0');

    const again = await server.inject({
      method: 'DELETE',
      url,
      headers: mutationHeaders(ctx.owner, `http-cancel-again-${randomUUID()}`),
      payload: {},
    });
    expect(again.statusCode).toBe(400);
  });

  it('история: назначения и переносы с cursor; расход; фильтр DELETED; 404 и невалидный cursor', async () => {
    const created = await server.inject({
      method: 'POST',
      url: budgetUrl('/envelopes'),
      headers: mutationHeaders(ctx.owner, `http-env-history-${randomUUID()}`),
      payload: { name: 'HTTP история', envelopeType: 'CUSTOM' },
    });
    expect(created.statusCode).toBe(201);
    const envelopeId = String(created.json<Record<string, unknown>>().id);
    const historyUrl = budgetUrl(`/envelopes/${envelopeId}/history`);

    const assigned = await server.inject({
      method: 'POST',
      url: budgetUrl('/assignments'),
      headers: mutationHeaders(ctx.owner, `http-hist-assign-${randomUUID()}`),
      payload: { envelopeId, amount: '10.00', sourceKind: 'FREE' },
    });
    expect(assigned.statusCode).toBe(201);
    const moved = await server.inject({
      method: 'POST',
      url: budgetUrl('/movements'),
      headers: mutationHeaders(ctx.owner, `http-hist-move-${randomUUID()}`),
      payload: { sourceEnvelopeId: envelopeId, destinationEnvelopeId: null, amount: '10.00' },
    });
    expect(moved.statusCode).toBe(201);

    const typeOfItem = (i: Record<string, unknown>) =>
      typeof i.amountMinor === 'string' && typeof i.effectiveOn === 'string';

    const page1 = await server.inject({
      method: 'GET',
      url: `${historyUrl}?limit=1`,
      headers: authHeaders(ctx.owner),
    });
    expect(page1.statusCode).toBe(200);
    const firstPage = page1.json<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>();
    expect(firstPage.items).toHaveLength(1);
    expect(typeOfItem(firstPage.items[0]!)).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const page2 = await server.inject({
      method: 'GET',
      url: `${historyUrl}?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      headers: authHeaders(ctx.owner),
    });
    expect(page2.statusCode).toBe(200);
    const secondPage = page2.json<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor === null).toBe(true);

    const kinds = new Set([firstPage.items[0]!.kind, secondPage.items[0]!.kind]);
    expect(kinds).toEqual(new Set(['MOVEMENT', 'ASSIGNMENT']));
    expect(firstPage.items[0]!.amountMinor).toBe('1000');
    expect(secondPage.items[0]!.amountMinor).toBe('1000');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(String(firstPage.items[0]!.effectiveOn))).toBe(true);

    const account = await prisma.account.findFirst({
      where: { budgetId: ctx.owner!.budgetId },
      select: { id: true },
    });
    const categoryId = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.owner!.budgetId,
        name: 'Транспорт',
        categoryType: 'EXPENSE',
        displayOrder: 0,
      },
    });
    const spentTwoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.owner!.budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        accountingModelVersion: 2,
        amountMinor: 2500n,
        occurredOn: spentTwoDaysAgo,
        confirmedAt: new Date(spentTwoDaysAgo.getTime() + 86_400_000),
        categoryId: categoryId.id,
        accountId: account!.id,
        envelopeId,
        createdByUserId: ctx.owner!.userId,
        updatedByUserId: ctx.owner!.userId,
      },
    });
    const full = await server.inject({
      method: 'GET',
      url: historyUrl,
      headers: authHeaders(ctx.owner),
    });
    expect(full.statusCode).toBe(200);
    const fullBody = full.json<{
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    }>();
    expect(fullBody.items).toHaveLength(3);
    expect(fullBody.items[fullBody.items.length - 1]!.kind).toBe('SPENDING');
    expect(fullBody.items[fullBody.items.length - 1]!.amountMinor).toBe('2500');
    expect(fullBody.nextCursor === null).toBe(true);

    const created2 = await server.inject({
      method: 'POST',
      url: budgetUrl('/envelopes'),
      headers: mutationHeaders(ctx.owner, `http-env-cancel-hist-${randomUUID()}`),
      payload: { name: 'HTTP отмена', envelopeType: 'CUSTOM' },
    });
    expect(created2.statusCode).toBe(201);
    const envelope2Id = String(created2.json<Record<string, unknown>>().id);
    const assigned2 = await server.inject({
      method: 'POST',
      url: budgetUrl('/assignments'),
      headers: mutationHeaders(ctx.owner, `http-hist-assign2-${randomUUID()}`),
      payload: { envelopeId: envelope2Id, amount: '5.00', sourceKind: 'FREE' },
    });
    expect(assigned2.statusCode).toBe(201);
    const assignment2Id = String(assigned2.json<Record<string, unknown>>().assignmentId);
    const cancelled = await server.inject({
      method: 'DELETE',
      url: budgetUrl(`/assignments/${assignment2Id}`),
      headers: mutationHeaders(ctx.owner, `http-hist-cancel-${randomUUID()}`),
    });
    expect(cancelled.statusCode).toBe(200);

    const deleted = await server.inject({
      method: 'GET',
      url: `${budgetUrl(`/envelopes/${envelope2Id}/history`)}?status=DELETED`,
      headers: authHeaders(ctx.owner),
    });
    expect(deleted.statusCode).toBe(200);
    const deletedBody = deleted.json<{ items: Array<Record<string, unknown>> }>();
    expect(deletedBody.items).toHaveLength(1);
    expect(deletedBody.items[0]!.kind).toBe('ASSIGNMENT');

    const defaultAfterCancel = await server.inject({
      method: 'GET',
      url: budgetUrl(`/envelopes/${envelope2Id}/history`),
      headers: authHeaders(ctx.owner),
    });
    expect(defaultAfterCancel.statusCode).toBe(200);
    expect(defaultAfterCancel.json<{ items: Array<unknown> }>().items).toHaveLength(0);

    const badCursor = await server.inject({
      method: 'GET',
      url: `${historyUrl}?cursor=не-баз-шесть`,
      headers: authHeaders(ctx.owner),
    });
    expect(badCursor.statusCode).toBe(400);

    const missing = await server.inject({
      method: 'GET',
      url: budgetUrl(`/envelopes/${randomUUID()}/history`),
      headers: authHeaders(ctx.owner),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('v1 GET не изменился; OpenAPI содержит v2-пути', async () => {
    await createEnvelope(ctx.viewer!.budgetId, 'CUSTOM', 'V1 legacy');
    const v1 = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${ctx.viewer!.budgetId}/envelopes`,
      headers: authHeaders(ctx.viewer),
    });
    expect(v1.statusCode).toBe(200);
    const v1Body = v1.json<Array<Record<string, unknown>>>();
    expect(v1Body.length).toBeGreaterThan(0);
    expect('startingBalanceMinor' in v1Body[0]!).toBe(true);

    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(openApi.statusCode).toBe(200);
    const document = openApi.json<{ paths: Record<string, unknown> }>();
    expect(document.paths['/api/v2/budgets/{budgetId}/envelopes']).toBeDefined();
    expect(document.paths['/api/v2/budgets/{budgetId}/assignments']).toBeDefined();
  });
});

function authHeaders(user: RegisteredUser | undefined): Record<string, string> {
  return { origin, cookie: `harmofin_session=${user?.cookie ?? ''}` };
}

function mutationHeaders(user: RegisteredUser | undefined, key: string): Record<string, string> {
  return {
    ...authHeaders(user),
    'x-csrf-token': user?.csrfToken ?? '',
    'idempotency-key': key,
  };
}

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
  const setCookieRaw = response.headers['set-cookie'];
  const setCookie = Array.isArray(setCookieRaw) ? setCookieRaw.join('; ') : (setCookieRaw ?? '');
  const match = /harmofin_session=([^;]+)/.exec(setCookie);
  const cookie = match ? decodeURIComponent(match[1]!) : '';
  expect(cookie).not.toHaveLength(0);
  await forceBudgetV1(prisma, body.budget.id);
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    csrfToken: body.csrfToken,
    cookie,
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
