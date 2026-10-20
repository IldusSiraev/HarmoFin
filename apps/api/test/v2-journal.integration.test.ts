import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const dayMs = 86_400_000;
const d = (delta: number) => new Date(Date.now() + delta * dayMs);

type Session = { userId: string; workspaceId: string; budgetId: string; cookie: string };

const emails = {
  owner: `v2-journal-feed-owner-${randomUUID()}@harmofin.test`,
  editor: `v2-journal-feed-editor-${randomUUID()}@harmofin.test`,
  outsider: `v2-journal-feed-outsider-${randomUUID()}@harmofin.test`,
};
const ctx: Partial<Record<keyof typeof emails, Session>> = {};

let app: NestFastifyApplication;
let server: FastifyInstance;

let a: string;
let b: string;
let food: string;
let salary: string;
let env: string;

describe('v2 общая лента журнала (GET /api/v2/budgets/:budgetId/journal)', () => {
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
        userId: ctx.editor!.userId,
        role: 'EDITOR',
      },
    });

    a = await createRawAccount(ctx.owner!.budgetId, 'RUB', 1_000_000n);
    b = await createRawAccount(ctx.owner!.budgetId, 'RUB', 0n);
    food = await createCategory(ctx.owner!.budgetId, 'EXPENSE');
    salary = await createCategory(ctx.owner!.budgetId, 'INCOME');
    env = await createEnvelope(ctx.owner!.budgetId, 'P');
  });

  afterAll(async () => {
    const editor = ctx.editor;
    if (editor) {
      await prisma.workspaceMembership.deleteMany({
        where: { userId: editor.userId, workspaceId: { not: editor.workspaceId } },
      });
    }
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await cleanupUser(ctx[key]?.userId ?? '');
    }
    await app.close();
    await prisma.$disconnect();
  });

  const owner = () => ctx.owner!;
  const editor = () => ctx.editor!;
  const outsider = () => ctx.outsider!;

  function authCookieHeaders(user: Session | undefined): Record<string, string> {
    return { origin, cookie: `harmofin_session=${user?.cookie ?? ''}` };
  }

  async function tx(
    type: 'INCOME' | 'EXPENSE',
    on: string,
    createdAt: string,
    extra: Partial<{
      accountId: string;
      categoryId: string;
      envelopeId: string | null;
      status: 'CONFIRMED' | 'DRAFT' | 'DELETED';
    }> = {},
  ) {
    return prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: owner().budgetId,
        accountingModelVersion: 2,
        transactionType: type,
        status: extra.status ?? 'CONFIRMED',
        amountMinor: 100n,
        currency: 'RUB',
        scale: 2,
        occurredOn: new Date(`${on}T00:00:00Z`),
        accountId: extra.accountId ?? a,
        categoryId: extra.categoryId ?? (type === 'INCOME' ? salary : food),
        envelopeId: extra.envelopeId ?? null,
        createdAt: new Date(createdAt),
        createdByUserId: owner().userId,
        updatedByUserId: owner().userId,
        ...(extra.status === 'DELETED'
          ? { deletedAt: new Date() }
          : (extra.status ?? 'CONFIRMED') === 'CONFIRMED'
            ? { confirmedAt: new Date(createdAt) }
            : {}),
      },
    });
  }

  async function transfer(
    on: string,
    createdAt: string,
    extra: Partial<{ source: string; destination: string; status: 'CONFIRMED' | 'DELETED' }> = {},
  ) {
    return prisma.transfer.create({
      data: {
        id: randomUUID(),
        budgetId: owner().budgetId,
        mode: 'ACCOUNT_ONLY',
        status: extra.status ?? 'CONFIRMED',
        totalMinor: 100n,
        occurredOn: new Date(`${on}T00:00:00Z`),
        sourceAccountId: extra.source ?? a,
        destinationAccountId: extra.destination ?? b,
        createdAt: new Date(createdAt),
        createdByUserId: owner().userId,
        updatedByUserId: owner().userId,
        ...(extra.status === 'DELETED'
          ? { deletedAt: new Date() }
          : { confirmedAt: new Date(createdAt) }),
      },
    });
  }

  async function page(user: Session, query: Record<string, string>) {
    const search = new URLSearchParams(query).toString();
    const response = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${owner().budgetId}/journal${search ? `?${search}` : ''}`,
      headers: authCookieHeaders(user),
    });
    return response;
  }

  async function all(user: Session, query: Record<string, string>) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await page(user, { ...query, limit: '2', ...(cursor ? { cursor } : {}) });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ items: Array<{ id: string; kind: string }>; nextCursor: string | null }>();
      ids.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
    } while (cursor);
    return ids;
  }

  async function reset(): Promise<void> {
    await prisma.transaction.deleteMany({ where: { budgetId: owner().budgetId } });
    await prisma.transfer.deleteMany({ where: { budgetId: owner().budgetId } });
  }

  it('общий порядок и пагинация без потерь и дублей, включая одинаковые дату и время создания', async () => {
    await reset();
    const t1 = await tx('EXPENSE', '2026-10-10', '2026-10-10T10:00:00.000Z');
    const r1 = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
    const t2 = await tx('INCOME', '2026-10-11', '2026-10-11T08:00:00.000Z');
    const r2 = await transfer('2026-10-09', '2026-10-12T08:00:00.000Z');
    const r3 = await transfer('2026-10-11', '2026-10-11T09:00:00.000Z');
    const sameTime = [t1.id, r1.id].sort().reverse();
    expect(await all(owner(), {})).toEqual([r3.id, t2.id, ...sameTime, r2.id]);
  });

  it('пагинация разрезает связанную по дате/времени пару: страница 1 кончается первым, страница 2 начинается вторым', async () => {
    await reset();
    const newest = await transfer('2026-10-12', '2026-10-12T10:00:00.000Z');
    const second = await tx('EXPENSE', '2026-10-11', '2026-10-11T10:00:00.000Z');
    const tiedTx = await tx('EXPENSE', '2026-10-10', '2026-10-10T10:00:00.000Z');
    const tiedTransfer = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
    const [tiedFirst, tiedSecond] = [tiedTx.id, tiedTransfer.id].sort().reverse();

    const page1 = await page(owner(), { limit: '3' });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
    expect(body1.items.map((item) => item.id)).toEqual([newest.id, second.id, tiedFirst]);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await page(owner(), { limit: '3', cursor: body1.nextCursor! });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
    expect(body2.items.map((item) => item.id)).toEqual([tiedSecond]);
    expect(body2.nextCursor).toBeNull();

    // Full sequence across both pages: no loss, no duplicates, tied ids in descending id order.
    expect([...body1.items.map((i) => i.id), ...body2.items.map((i) => i.id)]).toEqual([
      newest.id,
      second.id,
      tiedFirst,
      tiedSecond,
    ]);
  });

  it('элементы имеют kind и форму по спецификации', async () => {
    await reset();
    const r = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
    await tx('EXPENSE', '2026-10-09', '2026-10-09T10:00:00.000Z');
    const body = (await page(owner(), {})).json<{ items: Array<Record<string, unknown>> }>();
    expect(body.items[0]).toEqual({
      kind: 'TRANSFER',
      id: r.id,
      budgetId: owner().budgetId,
      status: 'CONFIRMED',
      amountMinor: '100',
      currency: 'RUB',
      occurredOn: '2026-10-10',
      sourceAccountId: a,
      destinationAccountId: b,
      comment: null,
      createdAt: '2026-10-10T10:00:00.000Z',
      deletedAt: null,
    });
    expect(body.items[1]).toMatchObject({ kind: 'TRANSACTION', transactionType: 'EXPENSE', planOccurrenceIds: [] });
  });

  it('type: TRANSFER — только переводы; INCOME/EXPENSE — без переводов', async () => {
    await reset();
    const r = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
    const e = await tx('EXPENSE', '2026-10-10', '2026-10-10T11:00:00.000Z');
    expect(await all(owner(), { type: 'TRANSFER' })).toEqual([r.id]);
    expect(await all(owner(), { type: 'EXPENSE' })).toEqual([e.id]);
  });

  it('accountId находит перевод по источнику и по назначению', async () => {
    await reset();
    const c = await createRawAccount(owner().budgetId, 'RUB', 0n);
    const out = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z', { source: c, destination: b });
    const inn = await transfer('2026-10-09', '2026-10-09T10:00:00.000Z', { source: a, destination: c });
    await transfer('2026-10-08', '2026-10-08T10:00:00.000Z');
    expect(await all(owner(), { accountId: c })).toEqual([out.id, inn.id]);
  });

  it('categoryId и envelopeId исключают переводы', async () => {
    await reset();
    await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
    const e = await tx('EXPENSE', '2026-10-10', '2026-10-10T11:00:00.000Z', { envelopeId: env });
    expect(await all(owner(), { categoryId: food })).toEqual([e.id]);
    expect(await all(owner(), { envelopeId: env })).toEqual([e.id]);
  });

  it('статусы: по умолчанию без удалённых; DRAFT исключает переводы; DELETED — только владелец', async () => {
    await reset();
    const live = await transfer('2026-10-10', '2026-10-10T10:00:00.000Z');
    const gone = await transfer('2026-10-09', '2026-10-09T10:00:00.000Z', { status: 'DELETED' });
    const draft = await tx('EXPENSE', '2026-10-08', '2026-10-08T10:00:00.000Z', { status: 'DRAFT' });
    expect(await all(owner(), {})).toEqual([live.id, draft.id]);
    expect(await all(owner(), { status: 'DRAFT' })).toEqual([draft.id]);
    expect(await all(owner(), { status: 'DELETED' })).toEqual([gone.id]);
    expect((await page(editor(), { status: 'DELETED' })).statusCode).toBe(403);
  });

  it('from/to по дате операции', async () => {
    await reset();
    await transfer('2026-10-01', '2026-10-01T10:00:00.000Z');
    const mid = await transfer('2026-10-05', '2026-10-05T10:00:00.000Z');
    await tx('EXPENSE', '2026-10-09', '2026-10-09T10:00:00.000Z');
    expect(await all(owner(), { from: '2026-10-02', to: '2026-10-08' })).toEqual([mid.id]);
  });

  it('изоляция: чужой бюджет — 404, чужие ссылки в фильтре — 404, чужие строки не попадают', async () => {
    await reset();
    const foreignAccount = await createRawAccount(outsider().budgetId, 'RUB', 0n);
    expect((await page(outsider(), {})).statusCode).toBe(404);
    expect((await page(owner(), { accountId: foreignAccount })).statusCode).toBe(404);
    await prisma.transfer.create({
      data: {
        id: randomUUID(),
        budgetId: outsider().budgetId,
        mode: 'ACCOUNT_ONLY',
        status: 'CONFIRMED',
        totalMinor: 1n,
        occurredOn: new Date('2026-10-10T00:00:00Z'),
        sourceAccountId: foreignAccount,
        destinationAccountId: await createRawAccount(outsider().budgetId, 'RUB', 0n),
        createdByUserId: outsider().userId,
        updatedByUserId: outsider().userId,
        confirmedAt: new Date('2026-10-10T00:00:00Z'),
      },
    });
    expect(await all(owner(), {})).toEqual([]);
  });

  it('некорректный курсор — 400; лишний параметр — 400', async () => {
    expect((await page(owner(), { cursor: 'garbage' })).statusCode).toBe(400);
    expect((await page(owner(), { sortBy: 'amount' })).statusCode).toBe(400);
  });
});

async function register(email: string): Promise<Session> {
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
  }>();
  const setCookieRaw = response.headers['set-cookie'];
  const setCookie = Array.isArray(setCookieRaw) ? setCookieRaw.join('; ') : (setCookieRaw ?? '');
  const match = /harmofin_session=([^;]+)/.exec(setCookie);
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    cookie: match ? decodeURIComponent(match[1]!) : '',
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

async function createCategory(budgetId: string, categoryType: 'INCOME' | 'EXPENSE'): Promise<string> {
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
    await prisma.planPayment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.planOccurrence.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.regularPlan.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeMovement.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeAssignment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.incomeAllocation.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transferPart.deleteMany({ where: { transfer: { budget: { workspaceId } } } });
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
