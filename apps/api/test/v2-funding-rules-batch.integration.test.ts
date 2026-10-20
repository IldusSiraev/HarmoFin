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

const emails = {
  owner: `v2-batch-owner-${randomUUID()}@harmofin.test`,
  outsider: `v2-batch-outsider-${randomUUID()}@harmofin.test`,
  viewer: `v2-batch-viewer-${randomUUID()}@harmofin.test`,
  editor: `v2-batch-editor-${randomUUID()}@harmofin.test`,
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
const ctx: Partial<Context> = {};

let currentA: string;
let currentB: string;
let mandatory: string;
let savings: string;
let archived: string;
let outsiderEnvelope: string;
let incomeCategory: string;
let expenseCategory: string;

describe('v2 funding rules batch', () => {
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
    for (const key of ['owner', 'outsider'] as const) {
      await prisma.budget.update({
        where: { id: ctx[key]!.budgetId },
        data: {
          planModelVersion: 2,
          planModelActivatedOn: new Date(Date.now() - 60 * 86_400_000),
          timezone: 'UTC',
          cycleStartDay: 1,
          periodBoundaryOffset: 14,
        },
      });
    }
    for (const [key, role] of [
      ['viewer', 'VIEWER'],
      ['editor', 'EDITOR'],
    ] as const) {
      await prisma.workspaceMembership.create({
        data: {
          id: randomUUID(),
          workspaceId: ctx.owner!.workspaceId,
          userId: ctx[key]!.userId,
          role,
        },
      });
    }

    await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.owner!.budgetId,
        name: 'Основной счёт',
        accountType: 'BANK_ACCOUNT',
        startingBalanceMinor: 30_000_000n,
        accountingStartDate: new Date(Date.now() - 90 * 86_400_000),
      },
    });
    const budgetId = ctx.owner!.budgetId;
    currentA = await createEnvelope(budgetId, 'CURRENT_EXPENSES', 'Еда', 'FIRST');
    currentB = await createEnvelope(budgetId, 'CURRENT_EXPENSES', 'Транспорт', 'SECOND');
    mandatory = await createEnvelope(budgetId, 'MANDATORY_EXPENSES', 'Обязательные');
    savings = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Подушка');
    archived = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Старый');
    await prisma.envelope.update({ where: { id: archived }, data: { archivedAt: new Date() } });
    outsiderEnvelope = await createEnvelope(
      ctx.outsider!.budgetId,
      'CURRENT_EXPENSES',
      'Чужой',
      'FIRST',
    );
    incomeCategory = await createCategory(budgetId, 'INCOME', 'Зарплата');
    expenseCategory = await createCategory(budgetId, 'EXPENSE', 'Продукты');
  });

  it('GET funding-rules: правила своего бюджета в порядке priority, затем envelopeId', async () => {
    const budgetId = ctx.owner!.budgetId;
    await prisma.envelopeFundingRule.createMany({
      data: [
        {
          id: randomUUID(),
          budgetId,
          envelopeId: savings,
          type: 'PERCENT_OF_INCOME',
          priority: 20,
          percentBasisPoints: 1000,
        },
        {
          id: randomUUID(),
          budgetId,
          envelopeId: currentA,
          type: 'FIXED_PER_PERIOD',
          priority: 10,
          fixedMinor: 1_500_000n,
        },
        { id: randomUUID(), budgetId, envelopeId: currentB, type: 'MANUAL', priority: 0 },
      ],
    });
    await prisma.envelopeFundingRule.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        envelopeId: outsiderEnvelope,
        type: 'MANUAL',
        priority: 0,
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/funding-rules`,
      headers: authHeaders(ctx.owner),
    });
    expect(response.statusCode).toBe(200);
    const items = response.json<{ items: Array<Record<string, unknown>> }>().items;
    expect(items.map((item) => item.envelopeId)).toEqual([currentB, currentA, savings]);
    expect(items[1]).toMatchObject({
      type: 'FIXED_PER_PERIOD',
      priority: 10,
      fixedAmountMinor: '1500000',
      percentBasisPoints: null,
    });
    expect(items[2]).toMatchObject({ type: 'PERCENT_OF_INCOME', percentBasisPoints: 1000 });

    const viewer = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/funding-rules`,
      headers: authHeaders(ctx.viewer),
    });
    expect(viewer.statusCode).toBe(200);

    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/funding-rules`,
      headers: authHeaders(ctx.outsider),
    });
    expect(foreign.statusCode).toBe(404);

    const anonymous = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${budgetId}/funding-rules`,
      headers: { origin },
    });
    expect(anonymous.statusCode).toBe(401);

    await prisma.envelopeFundingRule.deleteMany({ where: { budgetId } });
  });

  const off = { enabled: false, sourceCategoryId: null, targetEnvelopeId: null };

  async function rulesOf(budgetId: string) {
    return prisma.envelopeFundingRule.findMany({
      where: { budgetId },
      orderBy: [{ priority: 'asc' }, { envelopeId: 'asc' }],
      select: {
        envelopeId: true,
        type: true,
        priority: true,
        fixedMinor: true,
        percentBasisPoints: true,
      },
    });
  }
  async function ruleAudits(budgetId: string): Promise<number> {
    return prisma.auditEvent.count({ where: { budgetId, entityType: 'envelope_funding_rule' } });
  }

  it('PUT: порядок queue задаёт priority, outside — MANUAL с 0, предложение сохраняется', async () => {
    const budgetId = ctx.owner!.budgetId;
    const response = await putBatch(
      ctx.owner,
      {
        queue: [
          { envelopeId: mandatory, type: 'SUM_OF_PLANS' },
          { envelopeId: currentA, type: 'FIXED_PER_PERIOD', fixedAmount: '15000' },
          { envelopeId: savings, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1000 },
        ],
        outside: [{ envelopeId: currentB, type: 'MANUAL' }],
        incomeSuggestion: {
          enabled: true,
          sourceCategoryId: incomeCategory,
          targetEnvelopeId: savings,
        },
      },
      `batch-${randomUUID()}`,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      items: Array<{ envelopeId: string; priority: number; fixedAmountMinor: string | null }>;
      incomeSuggestion: Record<string, unknown>;
    }>();
    expect(body.items.map((item) => [item.envelopeId, item.priority])).toEqual([
      [currentB, 0],
      [mandatory, 10],
      [currentA, 20],
      [savings, 30],
    ]);
    expect(body.items[2]!.fixedAmountMinor).toBe('1500000');
    expect(body.incomeSuggestion).toEqual({
      enabled: true,
      sourceCategoryId: incomeCategory,
      targetEnvelopeId: savings,
    });
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    expect(budget.incomeAllocationTargetEnvelopeId).toBe(savings);
  });

  it('PUT: неизменённые правила не перезаписываются и не пишут audit; конверты вне тела не трогаются', async () => {
    const budgetId = ctx.owner!.budgetId;
    const before = await ruleAudits(budgetId);
    const suggestionBefore = await prisma.auditEvent.count({
      where: { budgetId, entityType: 'income_category_suggestion' },
    });
    const response = await putBatch(
      ctx.owner,
      {
        queue: [
          { envelopeId: mandatory, type: 'SUM_OF_PLANS' },
          { envelopeId: savings, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1000 },
        ],
        outside: [],
        incomeSuggestion: {
          enabled: true,
          sourceCategoryId: incomeCategory,
          targetEnvelopeId: savings,
        },
      },
      `batch-${randomUUID()}`,
    );
    expect(response.statusCode).toBe(200);
    // mandatory 10 -> 10 (без изменений), savings 30 -> 20 (изменён); currentA и currentB вне тела.
    expect(await ruleAudits(budgetId)).toBe(before + 1);
    expect(
      await prisma.auditEvent.count({
        where: { budgetId, entityType: 'income_category_suggestion' },
      }),
    ).toBe(suggestionBefore);
    const rules = await rulesOf(budgetId);
    expect(rules.find((rule) => rule.envelopeId === currentA)).toMatchObject({
      type: 'FIXED_PER_PERIOD',
      priority: 20,
    });
    expect(rules.find((rule) => rule.envelopeId === currentB)).toMatchObject({
      type: 'MANUAL',
      priority: 0,
    });
  });

  it('PUT: ошибка в одном элементе — не сохранено ничего', async () => {
    const budgetId = ctx.owner!.budgetId;
    const snapshot = await rulesOf(budgetId);
    const audits = await ruleAudits(budgetId);
    const response = await putBatch(
      ctx.owner,
      {
        queue: [
          { envelopeId: savings, type: 'FIXED_PER_PERIOD', fixedAmount: '100' },
          { envelopeId: archived, type: 'PERCENT_OF_INCOME', percentBasisPoints: 500 },
        ],
        outside: [],
        incomeSuggestion: off,
      },
      `batch-${randomUUID()}`,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'ENVELOPE_ARCHIVED',
      fieldErrors: [expect.objectContaining({ field: 'queue.1.envelopeId' })],
    });
    expect(await rulesOf(budgetId)).toEqual(snapshot);
    expect(await ruleAudits(budgetId)).toBe(audits);
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    expect(budget.incomeAllocationRuleEnabled).toBe(true);
  });

  it('PUT: матрица валидации с путями полей', async () => {
    const bad = async (payload: Record<string, unknown>) => {
      const response = await putBatch(ctx.owner, payload, `batch-bad-${randomUUID()}`);
      return {
        status: response.statusCode,
        body: response.json<{ code: string; fieldErrors?: Array<{ field: string }> }>(),
      };
    };
    const fields = (result: { body: { fieldErrors?: Array<{ field: string }> } }) =>
      (result.body.fieldErrors ?? []).map((item) => item.field);

    const manualInQueue = await bad({
      queue: [{ envelopeId: savings, type: 'MANUAL' }],
      outside: [],
      incomeSuggestion: off,
    });
    expect(manualInQueue.status).toBe(400);
    expect(fields(manualInQueue)).toContain('queue.0.type');

    const typedOutside = await bad({
      queue: [],
      outside: [{ envelopeId: savings, type: 'PERCENT_OF_INCOME' }],
      incomeSuggestion: off,
    });
    expect(typedOutside.status).toBe(400);
    expect(fields(typedOutside)).toContain('outside.0.type');

    const duplicate = await bad({
      queue: [{ envelopeId: savings, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1 }],
      outside: [{ envelopeId: savings, type: 'MANUAL' }],
      incomeSuggestion: off,
    });
    expect(duplicate.status).toBe(400);
    expect(fields(duplicate)).toContain('outside.0.envelopeId');

    const missingFixed = await bad({
      queue: [{ envelopeId: savings, type: 'FIXED_PER_PERIOD' }],
      outside: [],
      incomeSuggestion: off,
    });
    expect(fields(missingFixed)).toContain('queue.0.fixedAmount');

    const zeroFixed = await bad({
      queue: [{ envelopeId: savings, type: 'FIXED_PER_PERIOD', fixedAmount: '0' }],
      outside: [],
      incomeSuggestion: off,
    });
    expect(zeroFixed.status).toBe(400);
    expect(fields(zeroFixed)).toContain('queue.0.fixedAmount');

    const extraPercent = await bad({
      queue: [
        { envelopeId: savings, type: 'SUGGESTED_FIXED', fixedAmount: '1', percentBasisPoints: 5 },
      ],
      outside: [],
      incomeSuggestion: off,
    });
    expect(fields(extraPercent)).toContain('queue.0.percentBasisPoints');

    const clientPriority = await bad({
      queue: [
        { envelopeId: savings, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1, priority: 5 },
      ],
      outside: [],
      incomeSuggestion: off,
    });
    expect(clientPriority.status).toBe(400);

    const sumOfPlans = await bad({
      queue: [{ envelopeId: savings, type: 'SUM_OF_PLANS' }],
      outside: [],
      incomeSuggestion: off,
    });
    expect(sumOfPlans.status).toBe(422);
    expect(sumOfPlans.body.code).toBe('FUNDING_RULE_TYPE_NOT_ALLOWED');
    expect(fields(sumOfPlans)).toContain('queue.0.type');

    const foreign = await bad({
      queue: [{ envelopeId: outsiderEnvelope, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1 }],
      outside: [],
      incomeSuggestion: off,
    });
    expect(foreign.status).toBe(404);

    const noSuggestion = await bad({ queue: [], outside: [] });
    expect(fields(noSuggestion)).toContain('incomeSuggestion');

    const enabledWithoutCategory = await bad({
      queue: [],
      outside: [],
      incomeSuggestion: { enabled: true, sourceCategoryId: null, targetEnvelopeId: savings },
    });
    expect(enabledWithoutCategory.status).toBe(400);
    expect(fields(enabledWithoutCategory)).toContain('incomeSuggestion.sourceCategoryId');

    const disabledWithCategory = await bad({
      queue: [],
      outside: [],
      incomeSuggestion: {
        enabled: false,
        sourceCategoryId: incomeCategory,
        targetEnvelopeId: null,
      },
    });
    expect(disabledWithCategory.status).toBe(400);
    expect(fields(disabledWithCategory)).toContain('incomeSuggestion.sourceCategoryId');

    const disabledWithEnvelope = await bad({
      queue: [],
      outside: [],
      incomeSuggestion: { enabled: false, sourceCategoryId: null, targetEnvelopeId: savings },
    });
    expect(disabledWithEnvelope.status).toBe(400);
    expect(fields(disabledWithEnvelope)).toContain('incomeSuggestion.targetEnvelopeId');

    const expenseSource = await bad({
      queue: [],
      outside: [],
      incomeSuggestion: {
        enabled: true,
        sourceCategoryId: expenseCategory,
        targetEnvelopeId: savings,
      },
    });
    expect(expenseSource.status).toBe(422);
    expect(expenseSource.body.code).toBe('CATEGORY_TYPE_MISMATCH');
    expect(fields(expenseSource)).toContain('incomeSuggestion.sourceCategoryId');
  });

  it('PUT: роли, CSRF, ключ идемпотентности, replay и конфликт', async () => {
    const payload = {
      queue: [{ envelopeId: savings, type: 'PERCENT_OF_INCOME', percentBasisPoints: 700 }],
      outside: [],
      incomeSuggestion: off,
    };
    expect((await putBatch(ctx.viewer, payload, `batch-${randomUUID()}`)).statusCode).toBe(403);
    expect((await putBatch(ctx.editor, payload, `batch-${randomUUID()}`)).statusCode).toBe(403);
    expect((await putBatch(ctx.outsider, payload, `batch-${randomUUID()}`)).statusCode).toBe(404);

    const noCsrf = await server.inject({
      method: 'PUT',
      url: `/api/v2/budgets/${ctx.owner!.budgetId}/funding-rules`,
      headers: { ...authHeaders(ctx.owner), 'idempotency-key': `batch-${randomUUID()}` },
      payload,
    });
    expect(noCsrf.statusCode).toBe(403);
    const noKey = await server.inject({
      method: 'PUT',
      url: `/api/v2/budgets/${ctx.owner!.budgetId}/funding-rules`,
      headers: { ...authHeaders(ctx.owner), 'x-csrf-token': ctx.owner!.csrfToken },
      payload,
    });
    expect(noKey.statusCode).toBe(400);

    const budgetId = ctx.owner!.budgetId;
    const key = `batch-replay-${randomUUID()}`;
    const first = await putBatch(ctx.owner, payload, key);
    expect(first.statusCode).toBe(200);
    const audits = await ruleAudits(budgetId);
    const replay = await putBatch(ctx.owner, payload, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await ruleAudits(budgetId)).toBe(audits);

    const conflict = await putBatch(
      ctx.owner,
      {
        ...payload,
        queue: [{ envelopeId: savings, type: 'PERCENT_OF_INCOME', percentBasisPoints: 701 }],
      },
      key,
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('preview распределения идёт в порядке сохранённой очереди', async () => {
    // Period-slot envelopes (currentA/currentB) enter preview only with a current-period row,
    // which SUGGESTED_FIXED never creates; the queue therefore uses the non-period envelopes.
    const budgetId = ctx.owner!.budgetId;
    for (const queueOrder of [
      [savings, mandatory],
      [mandatory, savings],
    ]) {
      const saved = await putBatch(
        ctx.owner,
        {
          queue: queueOrder.map((envelopeId) => ({
            envelopeId,
            type: 'SUGGESTED_FIXED',
            fixedAmount: '100',
          })),
          outside: [
            { envelopeId: currentA, type: 'MANUAL' },
            { envelopeId: currentB, type: 'MANUAL' },
          ],
          incomeSuggestion: off,
        },
        `batch-${randomUUID()}`,
      );
      expect(saved.statusCode).toBe(200);
      const preview = await server.inject({
        method: 'POST',
        url: `/api/v2/budgets/${budgetId}/funding/preview`,
        headers: { ...authHeaders(ctx.owner), 'x-csrf-token': ctx.owner!.csrfToken },
        payload: { sourceKind: 'FREE' },
      });
      expect(preview.statusCode).toBe(200);
      const lines = preview.json<{ lines: Array<{ envelopeId: string; suggestedMinor: string }> }>()
        .lines;
      const order = lines
        .filter((line) => line.suggestedMinor !== '0')
        .map((line) => line.envelopeId);
      expect(order).toEqual(queueOrder);
    }
  });

  it('OpenAPI описывает GET и PUT funding-rules', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<
        string,
        {
          get?: { responses: Record<string, unknown> };
          put?: { responses: Record<string, unknown>; parameters?: unknown[] };
        }
      >;
      components: { schemas: Record<string, unknown> };
    }>();
    const path = document.paths['/api/v2/budgets/{budgetId}/funding-rules'];
    expect(path?.get?.responses['200']).toBeDefined();
    for (const code of ['200', '400', '401', '403', '404', '409', '422']) {
      expect(path?.put?.responses[code], code).toBeDefined();
    }
    expect(JSON.stringify(path?.put?.parameters)).toContain('Idempotency-Key');
    expect(document.components.schemas.PutFundingRulesBatchRequest).toBeDefined();
    expect(document.components.schemas.FundingRulesBatchResponse).toBeDefined();
  });
});

afterAll(async () => {
  for (const key of Object.keys(ctx) as Array<keyof Context>) {
    await cleanupUser(ctx[key]?.userId ?? '');
  }
  await app.close();
  await prisma.$disconnect();
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

async function createCategory(
  budgetId: string,
  categoryType: 'INCOME' | 'EXPENSE',
  name: string,
): Promise<string> {
  const category = await prisma.category.create({
    data: { id: randomUUID(), budgetId, name, categoryType, displayOrder: 0 },
  });
  return category.id;
}

function putBatch(user: RegisteredUser | undefined, payload: unknown, key: string) {
  return server.inject({
    method: 'PUT',
    url: `/api/v2/budgets/${ctx.owner!.budgetId}/funding-rules`,
    headers: mutationHeaders(user, key),
    payload: payload as Record<string, unknown>,
  });
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
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    csrfToken: body.csrfToken,
    cookie,
  };
}

async function createEnvelope(
  budgetId: string,
  envelopeType: 'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'SAVINGS_GOAL',
  name: string,
  periodSlot?: 'FIRST' | 'SECOND',
): Promise<string> {
  const envelope = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      name,
      envelopeType,
      startingBalanceMinor: 0n,
      displayOrder: 950,
      ...(periodSlot ? { periodSlot } : {}),
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
