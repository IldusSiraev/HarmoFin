import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { PlanOccurrenceHandler } from '../../worker/src/plan-occurrence.handler.js';
import { forceBudgetV1 } from './helpers/plan-model.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;
let incomeCategoryId: string;
let expenseCategoryId: string;
let mandatoryEnvelopeId: string;
let accountId: string;

function planPath(planId?: string) {
  const path = `/api/v1/budgets/${owner.budgetId}/plans`;
  return planId ? `${path}/${planId}` : path;
}

function mutationHeaders(key: string) {
  return { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key };
}

function incomePlanPayload() {
  return {
    name: 'Зарплата',
    planType: 'INCOME',
    amount: '1000.00',
    anchorOn: '2026-09-10',
    startOn: '2026-09-10',
    recurrence: 'MONTHLY',
    accountId,
    categoryId: incomeCategoryId,
    comment: 'Плановый доход',
  };
}

describe('regular plans API', () => {
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
    owner = await register(`plans-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`plans-foreign-${randomUUID()}@harmofin.test`);
    const ids = await createReferences(owner);
    incomeCategoryId = ids.incomeCategoryId;
    expenseCategoryId = ids.expenseCategoryId;
    mandatoryEnvelopeId = ids.mandatoryEnvelopeId;
    accountId = ids.accountId;
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('creates and returns a plan with a canonical integer amount', async () => {
    const response = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-income-plan'),
      cookies: { harmofin_session: owner.cookie },
      payload: incomePlanPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'Зарплата',
      planType: 'INCOME',
      amountMinor: '100000',
      recurrence: 'MONTHLY',
      categoryId: incomeCategoryId,
    });
  });

  it('requires a one-time plan anchor to match its start date', async () => {
    const invalidCreate = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-invalid-one-time-plan'),
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Разовый платёж',
        planType: 'EXPENSE',
        amount: '1000.00',
        anchorOn: '2099-01-10',
        startOn: '2099-01-11',
        recurrence: 'ONE_TIME',
        categoryId: expenseCategoryId,
        envelopeId: mandatoryEnvelopeId,
      },
    });
    const validCreate = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-valid-one-time-plan'),
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Разовый платёж для изменения',
        planType: 'EXPENSE',
        amount: '1000.00',
        anchorOn: '2099-01-10',
        startOn: '2099-01-10',
        recurrence: 'ONE_TIME',
        categoryId: expenseCategoryId,
        envelopeId: mandatoryEnvelopeId,
      },
    });
    const invalidUpdate = await server.inject({
      method: 'PATCH',
      url: planPath(validCreate.json<{ id: string }>().id),
      headers: mutationHeaders('update-invalid-one-time-plan'),
      cookies: { harmofin_session: owner.cookie },
      payload: { anchorOn: '2099-01-11' },
    });

    expect(invalidCreate.statusCode).toBe(400);
    expect(invalidUpdate.statusCode).toBe(400);
    expect(invalidCreate.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(invalidUpdate.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects switching an existing plan to one-time without aligning its anchor', async () => {
    const create = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-monthly-plan-for-recurrence-switch'),
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Подписка',
        planType: 'EXPENSE',
        amount: '500.00',
        anchorOn: '2026-09-05',
        startOn: '2026-09-01',
        recurrence: 'MONTHLY',
        categoryId: expenseCategoryId,
        envelopeId: mandatoryEnvelopeId,
      },
    });
    const planId = create.json<{ id: string }>().id;

    const invalidUpdate = await server.inject({
      method: 'PATCH',
      url: planPath(planId),
      headers: mutationHeaders('update-recurrence-to-one-time-without-anchor'),
      cookies: { harmofin_session: owner.cookie },
      payload: { recurrence: 'ONE_TIME' },
    });

    expect(invalidUpdate.statusCode).toBe(400);
    expect(invalidUpdate.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('updates plan and cancels only future pending occurrences', async () => {
    const create = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-plan-with-occurrences'),
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Ипотека',
        planType: 'EXPENSE',
        amount: '36000.00',
        anchorOn: '2026-09-26',
        startOn: '2026-09-26',
        recurrence: 'MONTHLY',
        categoryId: expenseCategoryId,
        envelopeId: mandatoryEnvelopeId,
      },
    });
    const planId = create.json<{ id: string }>().id;
    const oldOccurrence = await createOccurrence(planId, '2000-01-01');
    const futureOccurrence = await createOccurrence(planId, '2099-01-01');

    const update = await server.inject({
      method: 'PATCH',
      url: planPath(planId),
      headers: mutationHeaders('update-plan-with-occurrences'),
      cookies: { harmofin_session: owner.cookie },
      payload: { amount: '37000.00' },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ amountMinor: '3700000' });
    await expect(
      prisma.planOccurrence.findUniqueOrThrow({ where: { id: oldOccurrence.id } }),
    ).resolves.toMatchObject({ status: 'PENDING', cancelledAt: null });
    await expect(
      prisma.planOccurrence.findUniqueOrThrow({ where: { id: futureOccurrence.id } }),
    ).resolves.toMatchObject({ status: 'CANCELLED', cancellationReason: 'PLAN_CHANGED' });
  });

  it('materializes a replacement snapshot after a plan change', async () => {
    const create = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-plan-for-replacement'),
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Страховка',
        planType: 'EXPENSE',
        amount: '1000.00',
        anchorOn: '2099-01-15',
        startOn: '2099-01-15',
        recurrence: 'ONE_TIME',
        categoryId: expenseCategoryId,
        envelopeId: mandatoryEnvelopeId,
      },
    });
    const planId = create.json<{ id: string }>().id;
    const cancelled = await createOccurrence(planId, '2099-01-15');

    const update = await server.inject({
      method: 'PATCH',
      url: planPath(planId),
      headers: mutationHeaders('change-plan-for-replacement'),
      cookies: { harmofin_session: owner.cookie },
      payload: { amount: '2000.00' },
    });
    await new PlanOccurrenceHandler(prisma).execute(
      new Date('2098-11-16T12:00:00.000Z'),
      owner.budgetId,
    );

    expect(update.statusCode).toBe(200);
    await expect(
      prisma.planOccurrence.findMany({
        where: { planId, scheduledOn: new Date('2099-01-15T00:00:00.000Z') },
        select: { id: true, status: true, amountMinor: true, cancellationReason: true },
        orderBy: { createdAt: 'asc' },
      }),
    ).resolves.toEqual([
      {
        id: cancelled.id,
        status: 'CANCELLED',
        amountMinor: 100_000n,
        cancellationReason: 'PLAN_CHANGED',
      },
      {
        id: expect.any(String),
        status: 'PENDING',
        amountMinor: 200_000n,
        cancellationReason: null,
      },
    ]);
  });

  it('disables and logically deletes plans while cancelling future occurrences', async () => {
    const disabledCreate = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-plan-to-disable'),
      cookies: { harmofin_session: owner.cookie },
      payload: incomePlanPayload(),
    });
    const disabledPlanId = disabledCreate.json<{ id: string }>().id;
    const disabledOccurrence = await createOccurrence(disabledPlanId, '2099-02-01');
    const disable = await server.inject({
      method: 'PATCH',
      url: planPath(disabledPlanId),
      headers: mutationHeaders('disable-plan'),
      cookies: { harmofin_session: owner.cookie },
      payload: { isActive: false },
    });

    expect(disable.statusCode).toBe(200);
    expect(disable.json()).toMatchObject({ isActive: false });
    await expect(
      prisma.planOccurrence.findUniqueOrThrow({ where: { id: disabledOccurrence.id } }),
    ).resolves.toMatchObject({ status: 'CANCELLED', cancellationReason: 'PLAN_DISABLED' });

    const deletedCreate = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-plan-to-delete'),
      cookies: { harmofin_session: owner.cookie },
      payload: incomePlanPayload(),
    });
    const deletedPlanId = deletedCreate.json<{ id: string }>().id;
    const deletedOccurrence = await createOccurrence(deletedPlanId, '2099-03-01');
    const remove = await server.inject({
      method: 'DELETE',
      url: planPath(deletedPlanId),
      headers: mutationHeaders('delete-plan'),
      cookies: { harmofin_session: owner.cookie },
    });

    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toMatchObject({ isActive: false, deletedAt: expect.any(String) });
    await expect(
      prisma.planOccurrence.findUniqueOrThrow({ where: { id: deletedOccurrence.id } }),
    ).resolves.toMatchObject({ status: 'CANCELLED', cancellationReason: 'PLAN_DELETED' });
  });

  it('skips due occurrence without creating a financial transaction', async () => {
    const create = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-plan-to-skip'),
      cookies: { harmofin_session: owner.cookie },
      payload: incomePlanPayload(),
    });
    const planId = create.json<{ id: string }>().id;
    const occurrence = await createOccurrence(planId, '2026-09-10', 'DUE');

    const response = await server.inject({
      method: 'POST',
      url: `${planPath()}/occurrences/${occurrence.id}/skip`,
      headers: mutationHeaders('skip-occurrence'),
      cookies: { harmofin_session: owner.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: occurrence.id, status: 'SKIPPED' });
    expect(await prisma.transaction.count({ where: { budgetId: owner.budgetId } })).toBe(0);
    await expect(
      prisma.auditEvent.findFirstOrThrow({
        where: { entityType: 'plan_occurrence', entityId: occurrence.id, action: 'SKIPPED' },
      }),
    ).resolves.toMatchObject({ budgetId: owner.budgetId });
  });

  it('creates one linked draft transaction per occurrence', async () => {
    const create = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('create-plan-for-draft'),
      cookies: { harmofin_session: owner.cookie },
      payload: incomePlanPayload(),
    });
    const planId = create.json<{ id: string }>().id;
    const occurrence = await createOccurrence(planId, '2026-09-10', 'DUE');

    const first = await server.inject({
      method: 'POST',
      url: `${planPath()}/occurrences/${occurrence.id}/create-draft`,
      headers: mutationHeaders('create-occurrence-draft'),
      cookies: { harmofin_session: owner.cookie },
    });
    const replay = await server.inject({
      method: 'POST',
      url: `${planPath()}/occurrences/${occurrence.id}/create-draft`,
      headers: mutationHeaders('create-occurrence-draft'),
      cookies: { harmofin_session: owner.cookie },
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({ status: 'DRAFT', transactionType: 'INCOME' });
    expect(await prisma.transaction.count({ where: { budgetId: owner.budgetId } })).toBe(1);
    await expect(
      prisma.planOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } }),
    ).resolves.toMatchObject({
      transactionId: first.json<{ id: string }>().id,
      status: 'DUE',
    });
  });

  it('rejects references that do not match plan type or active state', async () => {
    const typeMismatch = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('plan-reference-type-mismatch'),
      cookies: { harmofin_session: owner.cookie },
      payload: {
        ...incomePlanPayload(),
        planType: 'EXPENSE',
        envelopeId: mandatoryEnvelopeId,
      },
    });
    const savingsMismatch = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('plan-savings-envelope-mismatch'),
      cookies: { harmofin_session: owner.cookie },
      payload: {
        name: 'Ремонт',
        planType: 'SAVINGS',
        amount: '500.00',
        anchorOn: '2026-09-10',
        startOn: '2026-09-10',
        recurrence: 'MONTHLY',
        categoryId: expenseCategoryId,
        envelopeId: mandatoryEnvelopeId,
      },
    });
    await prisma.account.update({ where: { id: accountId }, data: { archivedAt: new Date() } });
    const archivedAccount = await server.inject({
      method: 'POST',
      url: planPath(),
      headers: mutationHeaders('plan-archived-account'),
      cookies: { harmofin_session: owner.cookie },
      payload: incomePlanPayload(),
    });
    await prisma.account.update({ where: { id: accountId }, data: { archivedAt: null } });

    expect(typeMismatch.statusCode).toBe(422);
    expect(savingsMismatch.statusCode).toBe(422);
    expect(archivedAccount.statusCode).toBe(422);
  });

  it('allows editor mutations but reserves deletion for owner', async () => {
    const membershipId = randomUUID();
    await prisma.workspaceMembership.create({
      data: {
        id: membershipId,
        workspaceId: owner.workspaceId,
        userId: foreign.userId,
        role: 'EDITOR',
      },
    });
    const editorCreate = await server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${owner.budgetId}/plans`,
      headers: {
        origin,
        'x-csrf-token': foreign.csrfToken,
        'idempotency-key': 'editor-create-plan',
      },
      cookies: { harmofin_session: foreign.cookie },
      payload: incomePlanPayload(),
    });
    const planId = editorCreate.json<{ id: string }>().id;
    const editorDelete = await server.inject({
      method: 'DELETE',
      url: `/api/v1/budgets/${owner.budgetId}/plans/${planId}`,
      headers: {
        origin,
        'x-csrf-token': foreign.csrfToken,
        'idempotency-key': 'editor-delete-plan',
      },
      cookies: { harmofin_session: foreign.cookie },
    });

    await prisma.workspaceMembership.delete({ where: { id: membershipId } });
    expect(editorCreate.statusCode).toBe(201);
    expect(editorDelete.statusCode).toBe(403);
  });

  it('hides foreign budget plans', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/plans`,
      cookies: { harmofin_session: foreign.cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  async function createReferences(session: Session) {
    const incomeCategoryId = randomUUID();
    const expenseCategoryId = randomUUID();
    const mandatoryEnvelopeId = randomUUID();
    const accountId = randomUUID();
    await prisma.account.create({
      data: {
        id: accountId,
        budgetId: session.budgetId,
        name: 'Счёт планов',
        accountType: 'CASH',
        startingBalanceMinor: 0n,
        accountingStartDate: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    await prisma.category.createMany({
      data: [
        {
          id: incomeCategoryId,
          budgetId: session.budgetId,
          name: 'Доход планов',
          categoryType: 'INCOME',
          displayOrder: 0,
        },
        {
          id: expenseCategoryId,
          budgetId: session.budgetId,
          name: 'Расход планов',
          categoryType: 'EXPENSE',
          displayOrder: 1,
        },
      ],
    });
    await prisma.envelope.create({
      data: {
        id: mandatoryEnvelopeId,
        budgetId: session.budgetId,
        name: 'Обязательные планы',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: 0n,
        displayOrder: 0,
      },
    });
    return { incomeCategoryId, expenseCategoryId, mandatoryEnvelopeId, accountId };
  }

  async function createOccurrence(
    planId: string,
    scheduledOn: string,
    status: 'PENDING' | 'DUE' = 'PENDING',
  ) {
    const plan = await prisma.regularPlan.findUniqueOrThrow({ where: { id: planId } });
    return prisma.planOccurrence.create({
      data: {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        budgetId: owner.budgetId,
        planId,
        scheduledOn: new Date(`${scheduledOn}T00:00:00.000Z`),
        planName: plan.name,
        planType: plan.planType,
        amountMinor: plan.amountMinor,
        accountId: plan.accountId,
        categoryId: plan.categoryId,
        envelopeId: plan.envelopeId,
        comment: plan.comment,
        status,
      },
    });
  }

  async function register(email: string): Promise<Session> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    const body = response.json<{
      user: { id: string };
      workspace: { id: string };
      budget: { id: string };
      csrfToken: string;
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error('Missing session cookie');
    await forceBudgetV1(prisma, body.budget.id);
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
      csrfToken: body.csrfToken,
      cookie,
    };
  }

  async function cleanup(session: Session) {
    const budgetIds = (
      await prisma.budget.findMany({
        where: { workspaceId: session.workspaceId },
        select: { id: true },
      })
    ).map((budget) => budget.id);
    await prisma.auditEvent.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.notification.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.planOccurrence.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.regularPlan.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.incomeAllocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transaction.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.account.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.category.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.envelope.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.budget.deleteMany({ where: { id: { in: budgetIds } } });
    await prisma.workspace.deleteMany({ where: { id: session.workspaceId } });
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    await prisma.user.deleteMany({ where: { id: session.userId } });
  }
});
