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

    ownerAccountId = await createRawAccount(
      ctx.owner!.budgetId,
      ctx.owner!.userId,
      'RUB',
      10_000_000n,
    );
    ownerAccountIdB = await createRawAccount(ctx.owner!.budgetId, ctx.owner!.userId, 'RUB', 0n);
    archivedAccountId = await createRawAccount(ctx.owner!.budgetId, ctx.owner!.userId, 'RUB', 0n);
    await prisma.account.update({
      where: { id: archivedAccountId },
      data: { archivedAt: new Date() },
    });
    envelopeId = await createEnvelope(ctx.owner!.budgetId, ctx.owner!.userId, 'P');
    outsiderAccountId = await createRawAccount(
      ctx.outsider!.budgetId,
      ctx.outsider!.userId,
      'RUB',
      10_000_000n,
    );

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

  it('viewer — 403, чужой бюджет — 404', async () => {
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

describe('v2 прямого перевод — HTTP-контракт', () => {
  const fixtureEmails = {
    fixtureOwner: `v2-direct-http-owner-${randomUUID()}@harmofin.test`,
    fixtureViewer: `v2-direct-http-viewer-${randomUUID()}@harmofin.test`,
    fixtureOutsider: `v2-direct-http-outsider-${randomUUID()}@harmofin.test`,
    fixturePager: `v2-direct-http-pager-${randomUUID()}@harmofin.test`,
  };

  type FixtureUser = {
    userId: string;
    workspaceId: string;
    budgetId: string;
    cookie: string;
    csrfToken: string;
  };
  const fCtx: Partial<Record<keyof typeof fixtureEmails, FixtureUser>> = {};

  const dayMs = 86_400_000;
  const f = (delta: number) => new Date(Date.now() + delta * dayMs);

  let fixtureSrcAccount: string;
  let fixtureDestAccount: string;
  let fixtureEnvelope: string;
  let fixtureEnvelopeB: string;
  let fixtureLegacyTransferId: string;
  let pagerSrcAccount: string;
  let pagerDestAccount: string;
  const fixtureSrcMinor = 100n;

  type TransferItem = {
    id: string;
    budgetId: string;
    status: string;
    mode: 'ACCOUNT_ONLY';
    totalMinor: string;
    comment: string | null;
    occurredOn: string;
    sourceAccountId: string | null;
    destinationAccountId: string | null;
  };

  type ListResponse = { items: TransferItem[]; nextCursor: string | null };

  function authCookieHeaders(user: FixtureUser | undefined): Record<string, string> {
    return { origin, cookie: `harmofin_session=${user?.cookie ?? ''}` };
  }

  function mutationHeaders(
    user: FixtureUser | undefined,
    idempotencyKey: string,
  ): Record<string, string> {
    return {
      ...authCookieHeaders(user),
      'x-csrf-token': user?.csrfToken ?? '',
      'idempotency-key': idempotencyKey,
    };
  }

  function transferUrl(id?: string): string {
    const base = `/api/v2/budgets/${fixtureOwnerBudgetId()}/transfers`;
    return id ? `${base}/${id}` : base;
  }

  // Отдельный бюджет-«пагинатор»: в нём ровно 3 transfer (создаются в #8),
  // чтобы union-asserts не пересекались с переводами owner-бюджета.
  function pagerTransferUrl(id?: string): string {
    const base = `/api/v2/budgets/${fCtx.fixturePager!.budgetId}/transfers`;
    return id ? `${base}/${id}` : base;
  }

  function fixtureOwnerBudgetId(): string {
    return fCtx.fixtureOwner!.budgetId;
  }

  async function registerFixture(email: string): Promise<FixtureUser> {
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
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
      cookie,
      csrfToken: body.csrfToken,
    };
  }

  const accountBalance = (accountId: string) =>
    prisma.$transaction((tx) =>
      balances.accountBalance(tx, fCtx.fixtureOwner!.budgetId, accountId),
    );

  beforeAll(async () => {
    for (const key of Object.keys(fixtureEmails) as Array<keyof typeof fixtureEmails>) {
      fCtx[key] = await registerFixture(fixtureEmails[key]);
    }
    await prisma.budget.updateMany({
      where: {
        id: {
          in: [
            fCtx.fixtureOwner!.budgetId,
            fCtx.fixtureOutsider!.budgetId,
            fCtx.fixturePager!.budgetId,
          ],
        },
      },
      data: { planModelVersion: 2, planModelActivatedOn: f(-60), timezone: 'UTC' },
    });
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: fCtx.fixtureOwner!.workspaceId,
        userId: fCtx.fixtureViewer!.userId,
        role: 'VIEWER',
      },
    });

    fixtureSrcAccount = await createRawAccount(
      fCtx.fixtureOwner!.budgetId,
      fCtx.fixtureOwner!.userId,
      'RUB',
      10_000_000n,
    );
    fixtureDestAccount = await createRawAccount(
      fCtx.fixtureOwner!.budgetId,
      fCtx.fixtureOwner!.userId,
      'RUB',
      0n,
    );
    pagerSrcAccount = await createRawAccount(
      fCtx.fixturePager!.budgetId,
      fCtx.fixturePager!.userId,
      'RUB',
      10_000_000n,
    );
    pagerDestAccount = await createRawAccount(
      fCtx.fixturePager!.budgetId,
      fCtx.fixturePager!.userId,
      'RUB',
      0n,
    );

    const fixtureDate = f(-7);
    fixtureLegacyTransferId = randomUUID();
    await prisma.transfer.create({
      data: {
        id: fixtureLegacyTransferId,
        budgetId: fCtx.fixtureOwner!.budgetId,
        status: 'CONFIRMED',
        mode: 'LEGACY_PARTS',
        totalMinor: fixtureSrcMinor,
        occurredOn: fixtureDate,
        confirmedAt: new Date(),
        sourceAccountId: null,
        destinationAccountId: null,
        createdByUserId: fCtx.fixtureOwner!.userId,
        updatedByUserId: fCtx.fixtureOwner!.userId,
      },
    });
    fixtureEnvelope = await createEnvelope(
      fCtx.fixtureOwner!.budgetId,
      fCtx.fixtureOwner!.userId,
      'H-SRC',
    );
    fixtureEnvelopeB = await createEnvelope(
      fCtx.fixtureOwner!.budgetId,
      fCtx.fixtureOwner!.userId,
      'H-DST',
    );

    await prisma.transferPart.create({
      data: {
        id: randomUUID(),
        transferId: fixtureLegacyTransferId,
        budgetId: fCtx.fixtureOwner!.budgetId,
        sourceAccountId: fixtureSrcAccount,
        destinationAccountId: fixtureDestAccount,
        sourceEnvelopeId: fixtureEnvelope,
        destinationEnvelopeId: fixtureEnvelopeB,
        amountMinor: 40n,
      },
    });
    await prisma.transferPart.create({
      data: {
        id: randomUUID(),
        transferId: fixtureLegacyTransferId,
        budgetId: fCtx.fixtureOwner!.budgetId,
        sourceAccountId: fixtureSrcAccount,
        destinationAccountId: fixtureDestAccount,
        sourceEnvelopeId: fixtureEnvelope,
        destinationEnvelopeId: fixtureEnvelopeB,
        amountMinor: 60n,
      },
    });
  });

  afterAll(async () => {
    const viewer = fCtx.fixtureViewer;
    if (viewer) {
      await prisma.workspaceMembership.deleteMany({
        where: { userId: viewer.userId, workspaceId: { not: viewer.workspaceId } },
      });
    }
    for (const key of Object.keys(fixtureEmails) as Array<keyof typeof fixtureEmails>) {
      await cleanupUser(fCtx[key]?.userId ?? '');
    }
  });

  it('#1 POST создаёт ACCOUNT_ONLY прямого перевода: статус 201, comment записан, балансы сдвинулись', async () => {
    const beforeSrc = await accountBalance(fixtureSrcAccount);
    const beforeDst = await accountBalance(fixtureDestAccount);

    const res = await server.inject({
      method: 'POST',
      url: transferUrl(),
      headers: mutationHeaders(fCtx.fixtureOwner, 'http-ct'),
      payload: {
        sourceAccountId: fixtureSrcAccount,
        destinationAccountId: fixtureDestAccount,
        amount: '5',
        occurredOn: todayInTimezone(new Date(), 'UTC'),
        comment: 'HTTP test comment',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body.mode).toBe('ACCOUNT_ONLY');
    expect(body.comment).toBe('HTTP test comment');
    expect(typeof body.totalMinor).toBe('string');

    expect(body.sourceAccountId).toBe(fixtureSrcAccount);
    expect(body.destinationAccountId).toBe(fixtureDestAccount);

    expect(await accountBalance(fixtureSrcAccount)).toBe(beforeSrc - 500n);
    expect(await accountBalance(fixtureDestAccount)).toBe(beforeDst + 500n);

    expect(
      await prisma.transfer.count({
        where: { budgetId: fixtureOwnerBudgetId(), mode: 'ACCOUNT_ONLY' },
      }),
    ).toBeGreaterThan(0);
  });

  it('#2 replay того же ключа — 201 тот же id (1 ACCOUNT_ONLY запись для этой пары)', async () => {
    const res1 = await server.inject({
      method: 'POST',
      url: transferUrl(),
      headers: mutationHeaders(fCtx.fixtureOwner, 'http-ct'),
      payload: {
        sourceAccountId: fixtureSrcAccount,
        destinationAccountId: fixtureDestAccount,
        amount: '5',
        occurredOn: todayInTimezone(new Date(), 'UTC'),
        comment: 'HTTP test comment',
      },
    });
    res1.json(); // parse

    const res2 = await server.inject({
      method: 'POST',
      url: transferUrl(),
      headers: mutationHeaders(fCtx.fixtureOwner, 'http-ct'),
      payload: {
        sourceAccountId: fixtureSrcAccount,
        destinationAccountId: fixtureDestAccount,
        amount: '5',
        occurredOn: todayInTimezone(new Date(), 'UTC'),
        comment: 'HTTP test comment',
      },
    });
    expect(res2.statusCode).toBe(201);
    const b2 = res2.json<Record<string, unknown>>();
    const b1 = res1.json<Record<string, unknown>>();
    expect(b2.id).toBe(b1.id);
  });

  it('#3 POST без Idempotency-Key → 400', async () => {
    const res = await server.inject({
      method: 'POST',
      url: transferUrl(),
      headers: {
        ...authCookieHeaders(fCtx.fixtureOwner),
        'x-csrf-token': fCtx.fixtureOwner?.csrfToken ?? '',
      },
      payload: {
        sourceAccountId: fixtureSrcAccount,
        destinationAccountId: fixtureDestAccount,
        amount: '5',
        occurredOn: todayInTimezone(new Date(), 'UTC'),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('#4 POST viewer → 403', async () => {
    const res = await server.inject({
      method: 'POST',
      url: transferUrl(),
      headers: mutationHeaders(fCtx.fixtureViewer, 'http-viewer'),
      payload: {
        sourceAccountId: fixtureSrcAccount,
        destinationAccountId: fixtureDestAccount,
        amount: '5',
        occurredOn: todayInTimezone(new Date(), 'UTC'),
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('#5 POST outsider budgetId → 404', async () => {
    const outsiderAccountId = await createRawAccount(
      fCtx.fixtureOutsider!.budgetId,
      fCtx.fixtureOutsider!.userId,
      'RUB',
      10_000_000n,
    );
    const res = await server.inject({
      method: 'POST',
      url: transferUrl(),
      headers: mutationHeaders(fCtx.fixtureOwner, 'http-outsider'),
      payload: {
        sourceAccountId: outsiderAccountId,
        destinationAccountId: fixtureSrcAccount,
        amount: '5',
        occurredOn: todayInTimezone(new Date(), 'UTC'),
      },
    });
    expect(res.statusCode).toBe(404);
    await prisma.account.deleteMany({ where: { id: outsiderAccountId } });
  });

  it('#7 GET list → 200 только ACCOUNT_ONLY, остаточный LEGACY_PARTS перевод не отдаётся', async () => {
    const res = await server.inject({
      method: 'GET',
      url: transferUrl(),
      headers: authCookieHeaders(fCtx.fixtureOwner),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ListResponse>();

    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.mode).toBe('ACCOUNT_ONLY');
      expect(typeof item.sourceAccountId).toBe('string');
      expect(typeof item.totalMinor).toBe('string');
      expect(item).not.toHaveProperty('parts');
    }
    expect(body.items.some((item) => item.id === fixtureLegacyTransferId)).toBe(false);
  });

  it('#8a GET list ?limit=2: page1 = 2, page2 = остаток, nextCursor → null; union = ровно 3 id', async () => {
    const pagerHeaders = authCookieHeaders(fCtx.fixturePager);

    // Ровно 3 transfer в бюджете пагинатора, occurredOn desc: A (f(-1)) → B (f(-2)) → C (f(-3))
    const postIds: string[] = [];
    for (const [index, delta] of [-1, -2, -3].entries()) {
      const post = await server.inject({
        method: 'POST',
        url: pagerTransferUrl(),
        headers: mutationHeaders(fCtx.fixturePager, `pager-transfer-${index}`),
        payload: {
          sourceAccountId: pagerSrcAccount,
          destinationAccountId: pagerDestAccount,
          amount: '5',
          occurredOn: f(delta).toISOString().slice(0, 10),
        },
      });
      expect(post.statusCode).toBe(201);
      postIds.push(post.json<{ id: string }>().id);
    }
    const idA = postIds[0]!;
    const idB = postIds[1]!;
    const idC = postIds[2]!;

    const res1 = await server.inject({
      method: 'GET',
      url: `${pagerTransferUrl()}?limit=2`,
      headers: pagerHeaders,
    });
    expect(res1.statusCode).toBe(200);
    const b1 = res1.json<ListResponse>();
    expect(b1.items.map((i) => i.id)).toEqual([idA, idB]);
    expect(b1.nextCursor).not.toBeNull();

    const res2 = await server.inject({
      method: 'GET',
      url: `${pagerTransferUrl()}?limit=2&cursor=${b1.nextCursor}`,
      headers: pagerHeaders,
    });
    expect(res2.statusCode).toBe(200);
    const b2 = res2.json<ListResponse>();
    expect(b2.items.map((i) => i.id)).toEqual([idC]);
    expect(b2.nextCursor).toBeNull();

    // Полнота: union всех страниц = ровно все 3 id (no dup, no gap: и B, и C возвращены)
    const union = [...b1.items, ...b2.items].map((i) => i.id);
    expect(union).toHaveLength(3);
    expect(new Set(union)).toEqual(new Set([idA, idB, idC]));
  });

  it('#8b GET list ?limit=1: 3 страницы (2-я/3-я через cursor); union = ровно 3 id', async () => {
    const pagerHeaders = authCookieHeaders(fCtx.fixturePager);

    const p1 = await server.inject({
      method: 'GET',
      url: `${pagerTransferUrl()}?limit=1`,
      headers: pagerHeaders,
    });
    expect(p1.statusCode).toBe(200);
    const pb1 = p1.json<ListResponse>();
    expect(pb1.items.map((i) => i.id)).toHaveLength(1);
    expect(pb1.nextCursor).not.toBeNull();

    const p2 = await server.inject({
      method: 'GET',
      url: `${pagerTransferUrl()}?limit=1&cursor=${pb1.nextCursor}`,
      headers: pagerHeaders,
    });
    expect(p2.statusCode).toBe(200);
    const pb2 = p2.json<ListResponse>();
    expect(pb2.items.map((i) => i.id)).toHaveLength(1);
    expect(pb2.nextCursor).not.toBeNull();
    expect(pb2.items[0]!.id).not.toEqual(pb1.items[0]!.id);

    const p3 = await server.inject({
      method: 'GET',
      url: `${pagerTransferUrl()}?limit=1&cursor=${pb2.nextCursor}`,
      headers: pagerHeaders,
    });
    expect(p3.statusCode).toBe(200);
    const pb3 = p3.json<ListResponse>();
    expect(pb3.items.map((i) => i.id)).toHaveLength(1);
    expect(pb3.items[0]!.id).not.toEqual(pb2.items[0]!.id);

    // Полнота: 3 страницы без дублей покрывают ровно все 3 transfer
    const union = [...pb1.items, ...pb2.items, ...pb3.items].map((i) => i.id);
    expect(union).toHaveLength(3);
    expect(new Set(union)).toEqual(new Set(union));
    expect(
      (
        await prisma.transfer.findMany({
          where: { budgetId: fCtx.fixturePager!.budgetId, deletedAt: null },
          select: { id: true },
        })
      )
        .map((t) => t.id)
        .sort(),
    ).toEqual([...union].sort());
  });

  it('#9 GET detail: ACCOUNT_ONLY без parts, LEGACY_PARTS и randomUUID → 404', async () => {
    const listRes = await server.inject({
      method: 'GET',
      url: transferUrl(),
      headers: authCookieHeaders(fCtx.fixtureOwner),
    });
    const listBody = listRes.json<ListResponse>();

    const acItem = listBody.items[0];
    expect(acItem).toBeDefined();
    const accountOnly = await server.inject({
      method: 'GET',
      url: transferUrl(acItem!.id),
      headers: authCookieHeaders(fCtx.fixtureOwner),
    });
    expect(accountOnly.statusCode).toBe(200);
    expect(accountOnly.json<TransferItem>()).not.toHaveProperty('parts');

    for (const id of [fixtureLegacyTransferId, randomUUID()]) {
      const missing = await server.inject({
        method: 'GET',
        url: transferUrl(id),
        headers: authCookieHeaders(fCtx.fixtureOwner),
      });
      expect(missing.statusCode).toBe(404);
    }
  });

  it('#10 OpenAPI: 200, v2-пути, POST-коды, required Idempotency-Key, cookie-авторизация', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(openApi.statusCode).toBe(200);
    const document = openApi.json<{
      paths: Record<
        string,
        Partial<
          Record<
            'get' | 'post',
            {
              parameters?: Array<{ name: string; required?: boolean }>;
              responses?: Record<string, unknown>;
              security?: Array<Record<string, unknown>>;
            }
          >
        >
      >;
      components: {
        securitySchemes: Record<string, { type?: string; in?: string; name?: string }>;
      };
    }>();

    const collection = '/api/v2/budgets/{budgetId}/transfers';
    const item = '/api/v2/budgets/{budgetId}/transfers/{transferId}';

    expect(document.paths[collection]?.get).toBeDefined();
    expect(document.paths[collection]?.post).toBeDefined();
    expect(document.paths[item]?.get).toBeDefined();
    // Не-uuid в query/param — 400: прописанный в OpenAPI у обоих GET
    expect(document.paths[collection]?.get?.responses?.['400']).toBeDefined();
    expect(document.paths[item]?.get?.responses?.['400']).toBeDefined();

    const post = document.paths[collection]?.post;
    for (const status of ['201', '400', '401', '403', '404', '409', '422']) {
      expect(post?.responses?.[status]).toBeDefined();
    }
    expect(post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
      ]),
    );
    expect(document.components.securitySchemes.session).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: 'harmofin_session',
    });
    expect(post?.security).toEqual([{ session: [] }]);
  });

  it('#11 GET list ?limit=1&cursor=not-a-uuid → 400 (не PrismaClientValidationError → 500)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `${pagerTransferUrl()}?limit=1&cursor=not-a-uuid`,
      headers: authCookieHeaders(fCtx.fixturePager),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<Record<string, unknown>>();
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  it('#12 GET list ?cursor=<валидный uuid, но такого transfer нет> → 200, не падает', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `${pagerTransferUrl()}?cursor=${randomUUID()}`,
      headers: authCookieHeaders(fCtx.fixturePager),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ListResponse>();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.nextCursor === 'string' || body.nextCursor === null).toBe(true);
  });

  it('#13 GET detail: transferId не-uuid → 400 (не 500)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: pagerTransferUrl('not-a-uuid'),
      headers: authCookieHeaders(fCtx.fixturePager),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<Record<string, unknown>>();
    expect(body.code).toBe('VALIDATION_FAILED');
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
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
  ownerUserId: string,
  currency: string,
  startingBalanceMinor: bigint,
): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId,
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

async function createEnvelope(
  budgetId: string,
  ownerUserId: string,
  code: string,
): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId,
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
