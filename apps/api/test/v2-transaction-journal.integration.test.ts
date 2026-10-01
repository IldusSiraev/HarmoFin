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

type User = { userId: string; workspaceId: string; budgetId: string; cookie: string };

const emails = {
  owner: `v2-journal-owner-${randomUUID()}@harmofin.test`,
  editor: `v2-journal-editor-${randomUUID()}@harmofin.test`,
  outsider: `v2-journal-outsider-${randomUUID()}@harmofin.test`,
};
const ctx: Partial<Record<keyof typeof emails, User>> = {};

let app: NestFastifyApplication;
let server: FastifyInstance;

let accountId: string;
let otherAccountId: string;
let incomeCategoryId: string;
let expenseCategoryId: string;
let envelopeId: string;
let outsiderEnvelopeId: string;
let outsiderTransactionId: string;
let outsiderOccurrenceId: string;
let occurrenceV2Id: string;
let occurrenceLegacyId: string;

const ids: Record<string, string> = {};
const fixtureOrder: Array<{ key: string; occurredOn: string; createdAt: number; id: string }> = [];

const get = (user: User | undefined, path: string, budgetId?: string) =>
  server.inject({
    method: 'GET',
    url: `/api/v2/budgets/${budgetId ?? user?.budgetId}/transactions${path}`,
    headers: { origin, cookie: `harmofin_session=${user?.cookie ?? ''}` },
  });

type Row = {
  id: string;
  accountingModelVersion: number;
  status: string;
  amountMinor: string;
  planOccurrenceIds: string[];
  [key: string]: unknown;
};
type Page = { items: Row[]; nextCursor: string | null };

describe('v2 журнал операций (GET /api/v2/budgets/:budgetId/transactions)', () => {
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
    await prisma.budget.updateMany({
      where: { id: { in: [ctx.owner!.budgetId, ctx.outsider!.budgetId] } },
      data: { planModelVersion: 2, planModelActivatedOn: new Date('2026-01-01T00:00:00Z') },
    });
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: ctx.owner!.workspaceId,
        userId: ctx.editor!.userId,
        role: 'EDITOR',
      },
    });
    // The editor's own default workspace must not interfere: they read the owner budget.
    const b = ctx.owner!.budgetId;
    accountId = await createAccount(b);
    otherAccountId = await createAccount(b);
    incomeCategoryId = await createCategory(b, 'INCOME');
    expenseCategoryId = await createCategory(b, 'EXPENSE');
    envelopeId = await createEnvelope(b);
    const ob = ctx.outsider!.budgetId;
    outsiderEnvelopeId = await createEnvelope(ob);
    const outsiderAccountId = await createAccount(ob);
    const outsiderCategoryId = await createCategory(ob, 'EXPENSE');

    const plan = await createPlan(b, ctx.owner!);
    occurrenceV2Id = await createOccurrence(b, plan);
    occurrenceLegacyId = await createOccurrence(b, plan, 26);
    const outsiderPlan = await createPlan(ob, ctx.outsider!);
    outsiderOccurrenceId = await createOccurrence(ob, outsiderPlan);

    // Old model-1 rows (inserted directly) and new model-2 rows in the same budget.
    await insertTx('legacyExpense', {
      version: 1,
      type: 'EXPENSE',
      on: '2026-09-10',
      minute: 1,
      amount: 150_000n,
      envelope: true,
    });
    await insertTx('legacyIncome', {
      version: 1,
      type: 'INCOME',
      on: '2026-09-11',
      minute: 2,
      amount: 9_000_000n,
    });
    await insertTx('freeExpense', {
      version: 2,
      type: 'EXPENSE',
      on: '2026-09-20',
      minute: 3,
      amount: 482_000n,
    });
    await insertTx('payA', {
      version: 2,
      type: 'EXPENSE',
      on: '2026-09-25',
      minute: 4,
      amount: 100_000n,
      account: otherAccountId,
    });
    await insertTx('payB', {
      version: 2,
      type: 'EXPENSE',
      on: '2026-09-25',
      minute: 5,
      amount: 50_000n,
      account: otherAccountId,
    });
    await insertTx('draft', {
      version: 2,
      type: 'EXPENSE',
      on: '2026-09-25',
      minute: 6,
      amount: 1_000n,
      status: 'DRAFT',
    });
    await insertTx('deleted', {
      version: 2,
      type: 'EXPENSE',
      on: '2026-09-22',
      minute: 7,
      amount: 7_000n,
      status: 'DELETED',
    });
    await prisma.planPayment.createMany({
      data: [
        { id: randomUUID(), budgetId: b, occurrenceId: occurrenceV2Id, transactionId: ids.payA! },
        { id: randomUUID(), budgetId: b, occurrenceId: occurrenceV2Id, transactionId: ids.payB! },
      ],
    });
    await prisma.planOccurrence.update({
      where: { id: occurrenceLegacyId },
      data: {
        transactionId: ids.legacyExpense!,
        status: 'COMPLETED',
        completedAt: new Date('2026-09-10T00:00:00Z'),
      },
    });

    const foreign = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: ob,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: 1_000n,
        occurredOn: new Date('2026-09-25T00:00:00Z'),
        accountId: outsiderAccountId,
        categoryId: outsiderCategoryId,
        confirmedAt: new Date(),
        createdByUserId: ctx.outsider!.userId,
        updatedByUserId: ctx.outsider!.userId,
        accountingModelVersion: 2,
      },
    });
    outsiderTransactionId = foreign.id;
    await prisma.planPayment.create({
      data: {
        id: randomUUID(),
        budgetId: ob,
        occurrenceId: outsiderOccurrenceId,
        transactionId: outsiderTransactionId,
      },
    });
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

  const visibleDescending = () =>
    fixtureOrder
      .filter((row) => row.key !== 'deleted')
      .sort(
        (a, b) =>
          b.occurredOn.localeCompare(a.occurredOn) ||
          b.createdAt - a.createdAt ||
          b.id.localeCompare(a.id),
      )
      .map((row) => row.id);

  it('показывает факты обеих моделей по убыванию даты/времени/ID без v1-остатка конверта', async () => {
    const res = await get(ctx.owner, '');
    expect(res.statusCode).toBe(200);
    const body = res.json<Page>();
    expect(body.items.map((row) => row.accountingModelVersion)).toEqual(
      expect.arrayContaining([1, 2]),
    );
    expect(body.items.map((row) => row.id)).toEqual(visibleDescending());
    const legacy = body.items.find((row) => row.id === ids.legacyExpense)!;
    expect(legacy.accountingModelVersion).toBe(1);
    expect(legacy.amountMinor).toBe('150000');
    expect(legacy.planOccurrenceIds).toEqual([occurrenceLegacyId]);
    const free = body.items.find((row) => row.id === ids.freeExpense)!;
    expect(free.accountingModelVersion).toBe(2);
    expect(free.envelopeId).toBeNull();
    expect(free.planOccurrenceIds).toEqual([]);
    for (const row of body.items) {
      expect(row).not.toHaveProperty('envelopeCurrentBalanceMinor');
      expect(typeof row.amountMinor).toBe('string');
    }
    expect(JSON.stringify(body)).not.toContain(outsiderOccurrenceId);
  });

  it('две оплаты одной occurrence видны с одним planOccurrenceIds', async () => {
    const body = (await get(ctx.owner, '')).json<Page>();
    const a = body.items.find((row) => row.id === ids.payA)!;
    const b = body.items.find((row) => row.id === ids.payB)!;
    expect(a.planOccurrenceIds).toEqual([occurrenceV2Id]);
    expect(b.planOccurrenceIds).toEqual([occurrenceV2Id]);
    const earlier = body.items.findIndex((row) => row.id === ids.payB);
    expect(earlier).toBeLessThan(body.items.findIndex((row) => row.id === ids.payA));
  });

  it('пагинация курсором без дублей и пропусков', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(
        ctx.owner,
        `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(res.statusCode).toBe(200);
      const page: Page = res.json<Page>();
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(visibleDescending());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('фильтры accountId, categoryId, envelopeId, status, type, from/to', async () => {
    const byAccount = (await get(ctx.owner, `?accountId=${otherAccountId}`)).json<Page>();
    expect(byAccount.items.map((row) => row.id)).toEqual([ids.payB, ids.payA]);
    const byEnvelope = (await get(ctx.owner, `?envelopeId=${envelopeId}`)).json<Page>();
    expect(byEnvelope.items.map((row) => row.id)).toEqual([ids.legacyExpense]);
    const byCategory = (await get(ctx.owner, `?categoryId=${incomeCategoryId}`)).json<Page>();
    expect(byCategory.items.map((row) => row.id)).toEqual([ids.legacyIncome]);
    const drafts = (await get(ctx.owner, '?status=DRAFT')).json<Page>();
    expect(drafts.items.map((row) => row.id)).toEqual([ids.draft]);
    const incomes = (await get(ctx.owner, '?type=INCOME')).json<Page>();
    expect(incomes.items.map((row) => row.id)).toEqual([ids.legacyIncome]);
    const ranged = (await get(ctx.owner, '?from=2026-09-20&to=2026-09-20')).json<Page>();
    expect(ranged.items.map((row) => row.id)).toEqual([ids.freeExpense]);
    expect((await get(ctx.owner, '?from=2026-09-21&to=2026-09-20')).statusCode).toBe(400);
  });

  it('DELETED виден только OWNER, остальным 403; по умолчанию скрыт', async () => {
    expect((await get(ctx.owner, '')).json<Page>().items.map((r) => r.id)).not.toContain(
      ids.deleted,
    );
    const ownerDeleted = await get(ctx.owner, '?status=DELETED');
    expect(ownerDeleted.statusCode).toBe(200);
    expect(ownerDeleted.json<Page>().items.map((r) => r.id)).toEqual([ids.deleted]);
    const editorDeleted = await get(ctx.editor, '?status=DELETED', ctx.owner!.budgetId);
    expect(editorDeleted.statusCode).toBe(403);
    expect((await get(ctx.editor, `/${ids.deleted}`, ctx.owner!.budgetId)).statusCode).toBe(403);
    expect((await get(ctx.owner, `/${ids.deleted}`)).statusCode).toBe(200);
  });

  it('любой активный участник читает журнал и одну операцию', async () => {
    const list = await get(ctx.editor, '', ctx.owner!.budgetId);
    expect(list.statusCode).toBe(200);
    expect(list.json<Page>().items.map((r) => r.id)).toEqual(visibleDescending());
    const one = await get(ctx.editor, `/${ids.payA}`, ctx.owner!.budgetId);
    expect(one.statusCode).toBe(200);
    expect(one.json<Row>()).toMatchObject({
      id: ids.payA,
      accountingModelVersion: 2,
      amountMinor: '100000',
      planOccurrenceIds: [occurrenceV2Id],
    });
    expect(one.json<Row>()).not.toHaveProperty('envelopeCurrentBalanceMinor');
  });

  it('чужой бюджет и чужие envelope/account/category дают 404, чужая операция 404', async () => {
    expect((await get(ctx.outsider, '', ctx.owner!.budgetId)).statusCode).toBe(404);
    expect((await get(ctx.outsider, `/${ids.payA}`, ctx.owner!.budgetId)).statusCode).toBe(404);
    expect((await get(ctx.owner, `?envelopeId=${outsiderEnvelopeId}`)).statusCode).toBe(404);
    expect((await get(ctx.owner, `?envelopeId=${randomUUID()}`)).statusCode).toBe(404);
    expect((await get(ctx.owner, `?accountId=${randomUUID()}`)).statusCode).toBe(404);
    expect((await get(ctx.owner, `?categoryId=${randomUUID()}`)).statusCode).toBe(404);
    expect((await get(ctx.owner, `/${outsiderTransactionId}`)).statusCode).toBe(404);
    expect((await get(ctx.owner, `/${randomUUID()}`)).statusCode).toBe(404);
    expect((await get(undefined, '', ctx.owner!.budgetId)).statusCode).toBe(401);
  });

  it('некорректные cursor, limit, uuid дают 400', async () => {
    expect((await get(ctx.owner, '?cursor=not-a-cursor')).statusCode).toBe(400);
    expect((await get(ctx.owner, '?limit=0')).statusCode).toBe(400);
    expect((await get(ctx.owner, '?limit=101')).statusCode).toBe(400);
    expect((await get(ctx.owner, '?envelopeId=nope')).statusCode).toBe(400);
    expect((await get(ctx.owner, '/not-a-uuid')).statusCode).toBe(400);
    expect((await get(ctx.owner, '', 'not-a-uuid')).statusCode).toBe(400);
  });

  it('v1 список: бюджеты model 2 и model 1 читаются без v2-полей', async () => {
    const v1 = (user: User) =>
      server.inject({
        method: 'GET',
        url: `/api/v1/budgets/${user.budgetId}/transactions`,
        headers: { origin, cookie: `harmofin_session=${user.cookie}` },
      });
    // v1 reads are not model-gated: a model-2 budget still lists, without v2-only fields.
    const model2 = await v1(ctx.owner!);
    expect(model2.statusCode).toBe(200);
    const model2Items = model2.json<{ items: Array<Record<string, unknown>> }>().items;
    expect(model2Items.length).toBeGreaterThan(0);
    for (const item of model2Items) {
      expect(item).not.toHaveProperty('accountingModelVersion');
      expect(item).not.toHaveProperty('planOccurrenceIds');
    }

    const legacyBudget = ctx.editor!.budgetId;
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: legacyBudget,
        transactionType: 'INCOME',
        status: 'CONFIRMED',
        amountMinor: 1_000n,
        occurredOn: new Date('2026-09-10T00:00:00Z'),
        accountId: await createAccount(legacyBudget),
        categoryId: await createCategory(legacyBudget, 'INCOME'),
        confirmedAt: new Date(),
        createdByUserId: ctx.editor!.userId,
        updatedByUserId: ctx.editor!.userId,
      },
    });
    const ok = await v1(ctx.editor!);
    expect(ok.statusCode).toBe(200);
    const items = ok.json<{ items: Array<Record<string, unknown>> }>().items;
    expect(items.length).toBe(1);
    expect(items[0]).not.toHaveProperty('accountingModelVersion');
    expect(items[0]).not.toHaveProperty('planOccurrenceIds');
  });
});

async function insertTx(
  key: string,
  o: {
    version: 1 | 2;
    type: 'INCOME' | 'EXPENSE';
    on: string;
    minute: number;
    amount: bigint;
    status?: 'CONFIRMED' | 'DRAFT' | 'DELETED';
    account?: string;
    envelope?: boolean;
  },
): Promise<void> {
  const status = o.status ?? 'CONFIRMED';
  const createdAt = new Date(Date.UTC(2026, 8, 30, 10, o.minute));
  const row = await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId: ctx.owner!.budgetId,
      transactionType: o.type,
      status,
      amountMinor: o.amount,
      occurredOn: new Date(`${o.on}T00:00:00Z`),
      accountId: o.account ?? accountId,
      categoryId: o.type === 'INCOME' ? incomeCategoryId : expenseCategoryId,
      envelopeId: o.envelope ? envelopeId : null,
      confirmedAt: status === 'DRAFT' ? null : createdAt,
      ...(status === 'DELETED' ? { deletedAt: createdAt, preDeleteStatus: 'CONFIRMED' } : {}),
      createdAt,
      createdByUserId: ctx.owner!.userId,
      updatedByUserId: ctx.owner!.userId,
      accountingModelVersion: o.version,
    },
  });
  ids[key] = row.id;
  fixtureOrder.push({ key, occurredOn: o.on, createdAt: createdAt.getTime(), id: row.id });
}

async function register(email: string): Promise<User> {
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

async function createAccount(budgetId: string): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Счёт ${randomUUID().slice(0, 8)}`,
      accountType: 'BANK_ACCOUNT',
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: 100_000_000n,
      accountingStartDate: new Date('2026-01-01T00:00:00Z'),
    },
  });
  return account.id;
}

async function createCategory(budgetId: string, categoryType: 'INCOME' | 'EXPENSE') {
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

async function createEnvelope(budgetId: string): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: `Envelope ${randomUUID().slice(0, 8)}`,
      envelopeType: 'CUSTOM',
      startingBalanceMinor: 0n,
      displayOrder: 1,
    },
  });
  return envelope.id;
}

async function createPlan(budgetId: string, user: User): Promise<string> {
  const plan = await prisma.regularPlan.create({
    data: {
      id: randomUUID(),
      workspaceId: user.workspaceId,
      budgetId,
      name: `План ${randomUUID().slice(0, 8)}`,
      planType: 'EXPENSE',
      amountMinor: 150_000n,
      anchorOn: new Date('2026-09-01T00:00:00Z'),
      startOn: new Date('2026-09-01T00:00:00Z'),
      recurrence: 'MONTHLY',
      createdByUserId: user.userId,
      updatedByUserId: user.userId,
    },
  });
  return plan.id;
}

async function createOccurrence(budgetId: string, planId: string, day = 25): Promise<string> {
  const budget = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
  const occurrence = await prisma.planOccurrence.create({
    data: {
      id: randomUUID(),
      workspaceId: budget.workspaceId,
      budgetId,
      planId,
      scheduledOn: new Date(Date.UTC(2026, 8, day)),
      planName: 'План',
      planType: 'EXPENSE',
      amountMinor: 150_000n,
    },
  });
  return occurrence.id;
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
