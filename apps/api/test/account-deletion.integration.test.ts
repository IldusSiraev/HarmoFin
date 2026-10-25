import { createHmac, randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { newBudgetModelData } from '../src/common/plan-model/new-budget-model.js';
import { loadApiConfig } from '../src/config/env.js';
import { purgeUserData } from '../../worker/src/account-purge.js';
import { AccountPurgeHandler } from '../../worker/src/account-purge.handler.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const tokenSecret = 'test-only-secret-with-at-least-32-bytes';
const DAY_MS = 86_400_000;

type Fixture = {
  email: string;
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUserIds: string[] = [];

async function register(prefix: string): Promise<Fixture> {
  const email = `${prefix}-${randomUUID()}@harmofin.test`;
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
  const cookie = decodeURIComponent(/harmofin_session=([^;]+)/.exec(setCookie)?.[1] ?? '');
  createdUserIds.push(body.user.id);
  return {
    email,
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    cookie,
    csrfToken: body.csrfToken,
  };
}

function requestDeletion(fixture: Fixture, body: object, withCsrf = true) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/me/deletion',
    headers: {
      origin,
      cookie: `harmofin_session=${encodeURIComponent(fixture.cookie)}`,
      ...(withCsrf ? { 'x-csrf-token': fixture.csrfToken } : {}),
    },
    payload: body,
  });
}

function digest(raw: string): string {
  return createHmac('sha256', tokenSecret).update(raw).digest('hex');
}

function login(fixture: Fixture) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email: fixture.email, password },
  });
}

describe('account deletion', () => {
  beforeAll(async () => {
    app = await createApiApp(
      loadApiConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: origin,
        AUTH_TOKEN_HASH_SECRET: tokenSecret,
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        MAIL_FROM: 'no-reply@harmofin.test',
        WEB_BASE_URL: origin,
        LOG_LEVEL: 'silent',
        RATE_LIMIT_LOGIN_MAX: '100',
        RATE_LIMIT_RECOVERY_MAX: '100',
      }),
    );
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await prisma.$transaction((tx) => purgeUserData(tx, userId), { timeout: 60_000 });
      await prisma.accountDeletion.deleteMany({ where: { userId } });
      await prisma.userConsent.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('documents the deletion request endpoint in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    }>();
    expect(document.paths['/api/v1/me/deletion']).toMatchObject({
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RequestAccountDeletionRequest' },
            },
          },
        },
        responses: {
          '202': {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AccountDeletionScheduledResponse' },
              },
            },
          },
        },
      },
    });
    expect(document.paths['/api/v1/auth/deletion/cancel']).toMatchObject({
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CancelAccountDeletionRequest' },
            },
          },
        },
        responses: { '204': expect.any(Object) },
      },
    });
    expect(document.components?.schemas).toMatchObject({
      RequestAccountDeletionRequest: expect.any(Object),
      AccountDeletionScheduledResponse: expect.any(Object),
      CancelAccountDeletionRequest: expect.any(Object),
    });
  });

  it('rejects a wrong password with a field error and keeps the account', async () => {
    const fixture = await register('del-wrong');
    const response = await requestDeletion(fixture, { password: 'wrong-password-10' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'CURRENT_PASSWORD_INVALID',
      fieldErrors: [expect.objectContaining({ field: 'password' })],
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe(
      'ACTIVE',
    );
  });

  it('requires CSRF', async () => {
    const fixture = await register('del-csrf');
    const response = await requestDeletion(fixture, { password }, false);

    expect(response.statusCode).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe(
      'ACTIVE',
    );
  });

  it('refuses while an owned workspace has another active member', async () => {
    const owner = await register('del-owner');
    const member = await register('del-member');
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        userId: member.userId,
        role: 'EDITOR',
      },
    });

    const response = await requestDeletion(owner, { password });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'ACCOUNT_DELETION_HAS_MEMBERS',
      detail: 'В вашей семье есть другие участники. Сначала удалите их на странице «Семья».',
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).status).toBe(
      'ACTIVE',
    );
    await prisma.workspaceMembership.deleteMany({
      where: { workspaceId: owner.workspaceId, userId: member.userId },
    });
  });

  it('deleting a member closes their open notifications in the family and notifies the creator', async () => {
    const creator = await register('del-member-creator');
    const member = await register('del-member-leaver');
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        userId: member.userId,
        role: 'EDITOR',
      },
    });
    await prisma.notification.create({
      data: {
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        budgetId: creator.budgetId,
        userId: member.userId,
        notificationType: 'PLAN_UPCOMING',
        title: 'Скоро платёж',
        body: 'Подписка через 3 дня',
        notificationKey: `member-open-${randomUUID()}`,
      },
    });

    const response = await requestDeletion(member, { password });

    expect(response.statusCode).toBe(202);
    expect(
      await prisma.notification.count({
        where: { userId: member.userId, workspaceId: creator.workspaceId, resolvedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: { userId: creator.userId, notificationType: 'MEMBER_LEFT' },
      }),
    ).toBe(1);

    await prisma.workspaceMembership.deleteMany({
      where: { workspaceId: creator.workspaceId, userId: member.userId },
    });
  });

  it('restoring a member account skips reactivating a family membership that is now full', async () => {
    const creator = await register('del-restore-limit-creator');
    const member = await register('del-restore-limit-member');
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        userId: member.userId,
        role: 'EDITOR',
      },
    });

    const rawToken = `restore-limit-${randomUUID()}`;
    await deleteWithKnownToken(member, rawToken);

    // Fill the family to the member limit (1 creator + 9 others = 10) while the member is gone.
    const fillerIds: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      const filler = await register(`del-restore-limit-filler-${i}`);
      fillerIds.push(filler.userId);
      await prisma.workspaceMembership.create({
        data: {
          id: randomUUID(),
          workspaceId: creator.workspaceId,
          userId: filler.userId,
          role: 'EDITOR',
        },
      });
    }

    expect((await cancel(rawToken)).statusCode).toBe(204);

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: member.userId } })).status,
    ).toBe('ACTIVE');
    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id: member.workspaceId } })).status,
    ).toBe('ACTIVE');
    expect(
      await prisma.workspaceMembership.count({
        where: { workspaceId: creator.workspaceId, userId: member.userId, isActive: true },
      }),
    ).toBe(0);

    await prisma.workspaceMembership.deleteMany({
      where: { workspaceId: creator.workspaceId, userId: { in: [member.userId, ...fillerIds] } },
    });
  });

  it('closes access at once and schedules the purge in 30 days', async () => {
    const fixture = await register('del-ok');
    const before = Date.now();
    const response = await requestDeletion(fixture, { password });

    expect(response.statusCode).toBe(202);
    const purgeAfter = new Date(response.json<{ purgeAfter: string }>().purgeAfter).getTime();
    expect(purgeAfter).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(purgeAfter).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);
    expect(String(response.headers['set-cookie'])).toMatch(/harmofin_session=;/);

    const me = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `harmofin_session=${encodeURIComponent(fixture.cookie)}` },
    });
    expect(me.statusCode).toBe(401);
    expect((await login(fixture)).statusCode).toBe(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
    expect(user.status).toBe('PENDING_DELETION');
    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id: fixture.workspaceId } })).status,
    ).toBe('ARCHIVED');
    expect(
      (await prisma.budget.findUniqueOrThrow({ where: { id: fixture.budgetId } })).status,
    ).toBe('ARCHIVED');
    expect(await prisma.session.count({ where: { userId: fixture.userId, revokedAt: null } })).toBe(
      0,
    );
    expect(
      await prisma.session.count({
        where: { userId: fixture.userId, revokedReason: 'ACCOUNT_DELETED' },
      }),
    ).toBeGreaterThan(0);
    const deletion = await prisma.accountDeletion.findFirstOrThrow({
      where: { userId: fixture.userId },
    });
    expect(deletion).toMatchObject({
      archivedWorkspaceIds: [fixture.workspaceId],
      archivedBudgetIds: [fixture.budgetId],
      restoredAt: null,
      purgedAt: null,
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { actorUserId: fixture.userId, action: 'ACCOUNT_DELETION_REQUESTED' },
    });
    expect(JSON.stringify(audit.newValues)).not.toContain(fixture.email);
  });

  async function deleteWithKnownToken(fixture: Fixture, rawToken: string) {
    expect((await requestDeletion(fixture, { password })).statusCode).toBe(202);
    await prisma.accountDeletion.updateMany({
      where: { userId: fixture.userId, restoredAt: null, purgedAt: null },
      data: { restoreTokenHash: digest(rawToken) },
    });
  }

  function cancel(token: string) {
    return server.inject({
      method: 'POST',
      url: '/api/v1/auth/deletion/cancel',
      headers: { origin },
      payload: { token },
    });
  }

  it('restores access by a valid token exactly once', async () => {
    const fixture = await register('del-restore');
    const rawToken = `restore-${randomUUID()}`;
    await deleteWithKnownToken(fixture, rawToken);

    expect((await cancel(rawToken)).statusCode).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe(
      'ACTIVE',
    );
    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id: fixture.workspaceId } })).status,
    ).toBe('ACTIVE');
    expect(
      (await prisma.budget.findUniqueOrThrow({ where: { id: fixture.budgetId } })).status,
    ).toBe('ACTIVE');
    expect((await login(fixture)).statusCode).toBe(201);

    const reused = await cancel(rawToken);
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ code: 'ACCOUNT_RESTORE_TOKEN_INVALID' });
  });

  it('rejects an unknown token and an expired one', async () => {
    expect((await cancel(`unknown-${randomUUID()}`)).statusCode).toBe(422);

    const fixture = await register('del-expired');
    const rawToken = `expired-${randomUUID()}`;
    await deleteWithKnownToken(fixture, rawToken);
    await prisma.accountDeletion.updateMany({
      where: { userId: fixture.userId },
      data: { purgeAfter: new Date(Date.now() - 1_000) },
    });

    expect((await cancel(rawToken)).statusCode).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe(
      'PENDING_DELETION',
    );
  });

  it('does not reactivate a budget that was archived before the request', async () => {
    const fixture = await register('del-prearchived');
    const oldBudgetId = randomUUID();
    await prisma.budget.create({
      data: {
        id: oldBudgetId,
        workspaceId: fixture.workspaceId,
        name: 'Старый бюджет',
        status: 'ARCHIVED',
        ...newBudgetModelData(),
      },
    });
    const rawToken = `pre-${randomUUID()}`;
    await deleteWithKnownToken(fixture, rawToken);

    expect((await cancel(rawToken)).statusCode).toBe(204);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: oldBudgetId } })).status).toBe(
      'ARCHIVED',
    );
    expect(
      (await prisma.budget.findUniqueOrThrow({ where: { id: fixture.budgetId } })).status,
    ).toBe('ACTIVE');
  });

  async function makeDue(userId: string) {
    await prisma.accountDeletion.updateMany({
      where: { userId, restoredAt: null, purgedAt: null },
      data: { purgeAfter: new Date(Date.now() - 1_000) },
    });
  }

  function mutationHeaders(fixture: Fixture, idempotencyKey: string) {
    return {
      origin,
      cookie: `harmofin_session=${encodeURIComponent(fixture.cookie)}`,
      'x-csrf-token': fixture.csrfToken,
      'idempotency-key': idempotencyKey,
    };
  }

  function postTransaction(
    fixture: Fixture,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${fixture.budgetId}/transactions`,
      headers: mutationHeaders(fixture, idempotencyKey),
      payload,
    });
  }

  function postTransfer(
    fixture: Fixture,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${fixture.budgetId}/transfers`,
      headers: mutationHeaders(fixture, idempotencyKey),
      payload,
    });
  }

  /**
   * Seeds one row in every budget-scoped financial table via the real API where practical
   * (transactions and a direct transfer, both with an Idempotency-Key header) and via Prisma
   * for entities with no simple single-call API path (regular plan/occurrence/payment, envelope
   * period/assignment/movement/funding-rule/reallocation, income allocation, budget cycle
   * revision, notification) — see Task 5 fix-round report for the rationale.
   */
  async function seedFinancialData(fixture: Fixture) {
    const today = new Date().toISOString().slice(0, 10);
    const account = await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        name: 'Карта',
        accountType: 'BANK_ACCOUNT',
        currency: 'RUB',
        scale: 2,
        startingBalanceMinor: 100_000n,
        accountingStartDate: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    const otherAccount = await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        name: 'Наличные',
        accountType: 'CASH',
        currency: 'RUB',
        scale: 2,
        startingBalanceMinor: 50_000n,
        accountingStartDate: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    const incomeCategory = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        name: 'Зарплата',
        categoryType: 'INCOME',
        displayOrder: 1,
      },
    });
    const expenseCategory = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        name: 'Продукты',
        categoryType: 'EXPENSE',
        displayOrder: 1,
      },
    });
    await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        name: 'Супермаркеты',
        categoryType: 'EXPENSE',
        displayOrder: 1,
        parentId: expenseCategory.id,
      },
    });
    const envelope = await prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        name: 'Текущие расходы',
        envelopeType: 'CURRENT_EXPENSES',
        periodSlot: 'FIRST',
        startingBalanceMinor: 0n,
        displayOrder: 1,
      },
    });
    const otherEnvelope = await prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        name: 'Свободный конверт',
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 0n,
        displayOrder: 2,
      },
    });

    const incomeResponse = await postTransaction(fixture, 'seed-income', {
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      amount: '1000.00',
      occurredOn: today,
      accountId: account.id,
      categoryId: incomeCategory.id,
    });
    expect(incomeResponse.statusCode).toBe(201);
    const incomeTransactionId = incomeResponse.json<{ id: string }>().id;

    const expenseResponse = await postTransaction(fixture, 'seed-expense', {
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amount: '100.00',
      occurredOn: today,
      accountId: account.id,
      categoryId: expenseCategory.id,
    });
    expect(expenseResponse.statusCode).toBe(201);
    const expenseTransactionId = expenseResponse.json<{ id: string }>().id;

    const transferResponse = await postTransfer(fixture, 'seed-transfer', {
      sourceAccountId: account.id,
      destinationAccountId: otherAccount.id,
      amount: '5',
      occurredOn: today,
      comment: 'Перенос на наличные',
    });
    expect(transferResponse.statusCode).toBe(201);

    const period = await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        envelopeId: envelope.id,
        startsOn: new Date(Date.now() - 10 * DAY_MS),
        endsOn: new Date(Date.now() + 10 * DAY_MS),
        targetStatus: 'CONFIRMED',
        targetMinor: 50_000n,
        confirmedByUserId: fixture.userId,
        confirmedAt: new Date(),
      },
    });
    await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        envelopeId: envelope.id,
        type: 'FREE',
        amountMinor: 30_000n,
        effectiveOn: new Date(),
        periodId: period.id,
        status: 'CONFIRMED',
      },
    });
    await prisma.envelopeMovement.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        sourceEnvelopeId: otherEnvelope.id,
        destinationEnvelopeId: envelope.id,
        destinationPeriodId: period.id,
        amountMinor: 1_000n,
        effectiveOn: new Date(),
        status: 'CONFIRMED',
      },
    });
    await prisma.envelopeFundingRule.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        envelopeId: envelope.id,
        type: 'FIXED_PER_PERIOD',
        fixedMinor: 20_000n,
      },
    });
    await prisma.envelopeReallocation.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        sourceEnvelopeId: otherEnvelope.id,
        destinationEnvelopeId: envelope.id,
        amountMinor: 500n,
        occurredOn: new Date(),
        createdByUserId: fixture.userId,
        updatedByUserId: fixture.userId,
      },
    });
    await prisma.incomeAllocation.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        incomeTransactionId,
        amountMinor: 200n,
        occurredOn: new Date(),
        accountId: account.id,
        envelopeId: envelope.id,
        createdByUserId: fixture.userId,
        updatedByUserId: fixture.userId,
      },
    });
    const plan = await prisma.regularPlan.create({
      data: {
        id: randomUUID(),
        workspaceId: fixture.workspaceId,
        budgetId: fixture.budgetId,
        name: 'Подписка',
        planType: 'EXPENSE',
        amountMinor: 10_000n,
        anchorOn: new Date(),
        startOn: new Date(),
        recurrence: 'MONTHLY',
        accountId: account.id,
        categoryId: expenseCategory.id,
        createdByUserId: fixture.userId,
        updatedByUserId: fixture.userId,
      },
    });
    const occurrence = await prisma.planOccurrence.create({
      data: {
        id: randomUUID(),
        workspaceId: fixture.workspaceId,
        budgetId: fixture.budgetId,
        planId: plan.id,
        scheduledOn: new Date(),
        planName: plan.name,
        planType: 'EXPENSE',
        amountMinor: 10_000n,
        status: 'COMPLETED',
        transactionId: expenseTransactionId,
        completedAt: new Date(),
      },
    });
    await prisma.planPayment.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        occurrenceId: occurrence.id,
        transactionId: expenseTransactionId,
      },
    });
    await prisma.budgetCycleRevision.create({
      data: {
        id: randomUUID(),
        budgetId: fixture.budgetId,
        effectiveOn: new Date(),
        cycleStartDay: 1,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
      },
    });
    await prisma.notification.create({
      data: {
        id: randomUUID(),
        workspaceId: fixture.workspaceId,
        budgetId: fixture.budgetId,
        userId: fixture.userId,
        notificationType: 'PLAN_UPCOMING',
        title: 'Скоро платёж',
        body: 'Подписка через 3 дня',
        notificationKey: `seed-${randomUUID()}`,
      },
    });
  }

  function invitationData(
    workspaceId: string,
    invitedByUserId: string,
    email: string,
    extra: Partial<{
      status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
      acceptedByUserId: string;
      acceptedAt: Date;
    }> = {},
  ) {
    return {
      id: randomUUID(),
      workspaceId,
      email,
      role: 'EDITOR' as const,
      tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId,
      ...extra,
    };
  }

  it('purges invitations of a deleted owner workspace across several statuses', async () => {
    const owner = await register('del-invites-owner');
    await prisma.workspaceInvitation.create({
      data: invitationData(owner.workspaceId, owner.userId, 'pending@harmofin.test'),
    });
    await prisma.workspaceInvitation.create({
      data: invitationData(owner.workspaceId, owner.userId, 'revoked@harmofin.test', {
        status: 'REVOKED',
      }),
    });
    await prisma.workspaceInvitation.create({
      data: invitationData(owner.workspaceId, owner.userId, 'expired@harmofin.test', {
        status: 'EXPIRED',
      }),
    });

    expect((await requestDeletion(owner, { password })).statusCode).toBe(202);
    await makeDue(owner.userId);
    await new AccountPurgeHandler(prisma).execute(new Date());

    expect(
      await prisma.workspaceInvitation.count({ where: { workspaceId: owner.workspaceId } }),
    ).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).status).toBe(
      'DELETED',
    );
  });

  it('retains and anonymizes an invitation accepted into another owner workspace by a deleted member', async () => {
    const otherOwner = await register('del-invites-other-owner');
    const member = await register('del-invites-member');
    const invitation = await prisma.workspaceInvitation.create({
      data: invitationData(otherOwner.workspaceId, otherOwner.userId, member.email, {
        status: 'ACCEPTED',
        acceptedByUserId: member.userId,
        acceptedAt: new Date(),
      }),
    });
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: otherOwner.workspaceId,
        userId: member.userId,
        role: 'EDITOR',
      },
    });

    expect((await requestDeletion(member, { password })).statusCode).toBe(202);
    await makeDue(member.userId);
    await new AccountPurgeHandler(prisma).execute(new Date());

    const stored = await prisma.workspaceInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(stored.email).toBe(`deleted-${member.userId}@invalid`);
    expect(stored.acceptedByUserId).toBe(member.userId);
    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id: otherOwner.workspaceId } })).status,
    ).toBe('ACTIVE');
    await prisma.workspaceMembership.deleteMany({
      where: { workspaceId: otherOwner.workspaceId, userId: member.userId },
    });
    await prisma.workspaceInvitation.deleteMany({ where: { id: invitation.id } });
  });

  it('purges every row of the owned scope and anonymizes the user, leaving others intact', async () => {
    const target = await register('del-purge');
    const bystander = await register('del-bystander');
    await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: bystander.budgetId,
        name: 'Продукты',
        categoryType: 'EXPENSE',
        displayOrder: 1,
      },
    });
    // Account-scoped audit event (no workspace/budget), the shape a password-recovery request
    // writes. Seeded directly: the CI integration job has no SMTP server for the real endpoint.
    // Must be purged for the target, but a bystander's own unscoped event must survive.
    for (const userId of [target.userId, bystander.userId]) {
      await prisma.auditEvent.create({
        data: {
          id: randomUUID(),
          actorUserId: userId,
          entityType: 'auth',
          entityId: userId,
          action: 'RECOVERY_REQUESTED',
          source: 'API',
        },
      });
    }

    await seedFinancialData(target);
    await prisma.userConsent.create({
      data: {
        id: randomUUID(),
        userId: target.userId,
        document: 'PD_CONSENT',
        version: '2026-10-18',
        acceptedAt: new Date(),
      },
    });
    expect((await requestDeletion(target, { password })).statusCode).toBe(202);
    await makeDue(target.userId);

    await new AccountPurgeHandler(prisma).execute(new Date());

    expect(await prisma.userConsent.count({ where: { userId: target.userId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { actorUserId: target.userId } })).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { actorUserId: bystander.userId, workspaceId: null, budgetId: null },
      }),
    ).toBeGreaterThan(0);

    expect(await prisma.budget.count({ where: { workspaceId: target.workspaceId } })).toBe(0);
    expect(await prisma.workspace.count({ where: { id: target.workspaceId } })).toBe(0);
    expect(await prisma.account.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.category.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.envelope.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.transaction.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.transfer.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.transferPart.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.envelopePeriod.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.envelopeMovement.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.envelopeFundingRule.count({ where: { budgetId: target.budgetId } })).toBe(
      0,
    );
    expect(await prisma.envelopeReallocation.count({ where: { budgetId: target.budgetId } })).toBe(
      0,
    );
    expect(await prisma.incomeAllocation.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.regularPlan.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.planOccurrence.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.planPayment.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.budgetCycleRevision.count({ where: { budgetId: target.budgetId } })).toBe(
      0,
    );
    expect(await prisma.notification.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: target.userId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { actorUserId: target.userId } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(user).toMatchObject({
      email: `deleted-${target.userId}@invalid`,
      passwordHash: '',
      displayName: null,
      status: 'DELETED',
    });
    expect(
      (await prisma.accountDeletion.findFirstOrThrow({ where: { userId: target.userId } }))
        .purgedAt,
    ).not.toBeNull();

    expect(await prisma.budget.count({ where: { id: bystander.budgetId, status: 'ACTIVE' } })).toBe(
      1,
    );
    expect(
      await prisma.category.count({ where: { budgetId: bystander.budgetId } }),
    ).toBeGreaterThan(0);
    const bystanderUser = await prisma.user.findUniqueOrThrow({ where: { id: bystander.userId } });
    expect(bystanderUser).toMatchObject({ email: bystander.email, status: 'ACTIVE' });
    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id: bystander.workspaceId } })).status,
    ).toBe('ACTIVE');
    expect(
      await prisma.session.count({ where: { userId: bystander.userId, revokedAt: null } }),
    ).toBeGreaterThan(0);

    // A second execute over the already-purged target does not throw and leaves it unchanged.
    await expect(new AccountPurgeHandler(prisma).execute(new Date())).resolves.toBeUndefined();
    const userAfterSecondRun = await prisma.user.findUniqueOrThrow({
      where: { id: target.userId },
    });
    expect(userAfterSecondRun).toMatchObject({
      email: `deleted-${target.userId}@invalid`,
      passwordHash: '',
      displayName: null,
      status: 'DELETED',
    });
  });

  it('skips restored and not yet due requests, leaves a restored user intact, and is safe to re-run', async () => {
    const restored = await register('del-skip-restored');
    const rawToken = `skip-${randomUUID()}`;
    await deleteWithKnownToken(restored, rawToken);
    await makeDue(restored.userId);
    // A restore after the deadline is rejected, so restore first, then make the row due.
    await prisma.accountDeletion.updateMany({
      where: { userId: restored.userId },
      data: { restoredAt: new Date() },
    });
    await prisma.user.update({ where: { id: restored.userId }, data: { status: 'ACTIVE' } });

    const pending = await register('del-skip-pending');
    expect((await requestDeletion(pending, { password })).statusCode).toBe(202);

    const handler = new AccountPurgeHandler(prisma);
    await handler.execute(new Date());
    await handler.execute(new Date());

    expect(await prisma.budget.count({ where: { id: restored.budgetId } })).toBe(1);
    expect(await prisma.budget.count({ where: { id: pending.budgetId } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pending.userId } })).status).toBe(
      'PENDING_DELETION',
    );
    const restoredDeletion = await prisma.accountDeletion.findFirstOrThrow({
      where: { userId: restored.userId },
    });
    expect(restoredDeletion.purgedAt).toBeNull();
    const restoredUser = await prisma.user.findUniqueOrThrow({ where: { id: restored.userId } });
    expect(restoredUser.status).toBe('ACTIVE');
    expect(restoredUser.email).toBe(restored.email);
    expect(await prisma.session.count({ where: { userId: restored.userId } })).toBeGreaterThan(0);
    expect(await prisma.workspace.count({ where: { id: restored.workspaceId } })).toBe(1);

    // A second execute on an already-purged / already-skipped set does not throw.
    await expect(handler.execute(new Date())).resolves.toBeUndefined();
  });

  /**
   * Polls pg_stat_activity until another backend is waiting on a row lock for the given table.
   * A `SELECT ... FOR UPDATE` block shows up as `wait_event_type = 'Lock'` with the blocked
   * query text, not as a row in pg_locks (that contention is a tuple/transactionid wait).
   */
  async function waitForBlockedLockOn(tableName: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE ${`%${tableName}%`}`;
      if ((rows[0]?.count ?? 0n) > 0n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for a blocked lock on ${tableName}`);
  }

  it('blocks a concurrent purge while the deletion row is locked by a restore, and does not purge once restored', async () => {
    const racer = await register('del-race');
    const rawToken = `race-${randomUUID()}`;
    await deleteWithKnownToken(racer, rawToken);
    await makeDue(racer.userId);
    const deletion = await prisma.accountDeletion.findFirstOrThrow({
      where: { userId: racer.userId },
    });

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holderDone!: () => void;
    const holderFinished = new Promise<void>((resolve) => {
      holderDone = resolve;
    });
    let lockAcquired!: () => void;
    const holderLocked = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });

    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "account_deletions" WHERE "id" = ${deletion.id}::uuid FOR UPDATE`;
      lockAcquired();
      await held; // keep the row locked until the racing purgeOne has had a chance to block
      await tx.accountDeletion.update({
        where: { id: deletion.id },
        data: { restoredAt: new Date() },
      });
      await tx.user.update({ where: { id: racer.userId }, data: { status: 'ACTIVE' } });
      holderDone();
    });

    // Start the purge only once the restore holds the row; otherwise the purge can win the
    // lock first and the poll below would see the holder blocked instead of the purge.
    await holderLocked;
    const handler = new AccountPurgeHandler(prisma);
    const racingPurge = handler.purgeOne(deletion.id, new Date());

    // Poll pg_stat_activity instead of a fixed sleep, so this isn't a timing guess under load.
    await waitForBlockedLockOn('account_deletions');
    release();
    await holderFinished;
    await holder;

    expect(await racingPurge).toBe(false);
    expect(await prisma.budget.count({ where: { id: racer.budgetId } })).toBe(1);
    const racerUser = await prisma.user.findUniqueOrThrow({ where: { id: racer.userId } });
    expect(racerUser.status).toBe('ACTIVE');
    const racerDeletion = await prisma.accountDeletion.findUniqueOrThrow({
      where: { id: deletion.id },
    });
    expect(racerDeletion.purgedAt).toBeNull();
    expect(racerDeletion.restoredAt).not.toBeNull();
  });
});
