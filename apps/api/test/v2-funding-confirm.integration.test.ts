import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../src/common/plan-model/plan-model.policy.js';
import { cycleAndPeriodFor, todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AssignmentRepository } from '../src/envelope-plans/assignment.repository.js';
import { AssignmentApplicationService } from '../src/envelope-plans/assignment.application.service.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = todayInTimezone(new Date(), 'UTC');
const current = cycleAndPeriodFor(
  { cycleStartDay: 1, periodBoundaryOffset: 14, timezone: 'UTC' },
  today,
).period;

const emails = {
  owner: `v2-conf-owner-${randomUUID()}@harmofin.test`,
  outsider: `v2-conf-outsider-${randomUUID()}@harmofin.test`,
  viewer: `v2-conf-viewer-${randomUUID()}@harmofin.test`,
  editor: `v2-conf-editor-${randomUUID()}@harmofin.test`,
};

type RegisteredUser = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};
type PreviewBody = {
  periodTargetDrafts: Array<{ periodId: string; targetMinor: string }>;
  lines: Array<{ envelopeId: string; periodId: string | null; suggestedMinor: string }>;
  previewHash: string;
};
type ConfirmBody = {
  assignedMinor: string;
  sourceRemainingMinor: string;
  confirmedPeriodIds: string[];
  assignments: Array<{
    id: string;
    envelopeId: string;
    periodId: string | null;
    amountMinor: string;
  }>;
};
type Line = { envelopeId: string; periodId?: string; amount: string };

let app: NestFastifyApplication;
let server: FastifyInstance;
let servicePrisma: PrismaService;
let assignments: AssignmentApplicationService;
const ctx: Partial<Record<keyof typeof emails, RegisteredUser>> = {};
const owner = () => ctx.owner!;

let accountId: string;
let salaryCategory: string;
let expenseCategory: string;
let currentEnvelope: string;
let savingsEnvelope: string;
let repairEnvelope: string;
let outsiderEnvelope: string;
let outsiderPeriod: string;
let outsiderIncome: string;
let periodId: string;

describe('v2 funding confirm (R04)', () => {
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
    servicePrisma = new PrismaService(databaseUrl);
    assignments = new AssignmentApplicationService(
      servicePrisma,
      new IdempotencyService(),
      new PlanModelPolicy(servicePrisma),
    );

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
          workspaceId: owner().workspaceId,
          userId: ctx[key]!.userId,
          role,
        },
      });
    }

    const budgetId = owner().budgetId;
    accountId = await createAccount(budgetId, 30_000_000n);
    const outsiderAccount = await createAccount(ctx.outsider!.budgetId, 1_000_000n);
    salaryCategory = await createCategory(budgetId, 'Зарплата', 'INCOME');
    expenseCategory = await createCategory(budgetId, 'Еда', 'EXPENSE');
    const outsiderCategory = await createCategory(ctx.outsider!.budgetId, 'Доход', 'INCOME');
    currentEnvelope = await createEnvelope(budgetId, 'CURRENT_EXPENSES', 'Текущий', current.id);
    savingsEnvelope = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Накопление');
    repairEnvelope = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Ремонт');
    outsiderEnvelope = await createEnvelope(
      ctx.outsider!.budgetId,
      'CURRENT_EXPENSES',
      'Чужой',
      current.id,
    );
    await createRule(currentEnvelope, 'FIXED_PER_PERIOD', 10, 6_500_000n);
    await createRule(savingsEnvelope, 'SUGGESTED_FIXED', 30, 500_000n);
    outsiderIncome = await createIncome(
      ctx.outsider!.budgetId,
      outsiderAccount,
      outsiderCategory,
      500_000n,
    );
    const outsiderRow = await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        envelopeId: outsiderEnvelope,
        startsOn: day(current.start),
        endsOn: day(current.end),
        targetStatus: 'UNSET',
      },
    });
    outsiderPeriod = outsiderRow.id;
    // First preview materializes the DRAFT target of the current period.
    const first = await preview({ sourceKind: 'FREE' });
    periodId = first.periodTargetDrafts[0]!.periodId;
  });

  it('confirm строк из preview + цель периода: атомарно, балансы растут, cash не меняется', async () => {
    const budgetId = owner().budgetId;
    const income = await createIncome(budgetId, accountId, salaryCategory, 8_000_000n);
    const lines: Line[] = [
      { envelopeId: currentEnvelope, periodId, amount: '65000.00' },
      { envelopeId: savingsEnvelope, amount: '5000.00' },
    ];
    const previewBody = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      overrides: lines,
      confirmPeriodTargets: [periodId],
    });
    const before = await snapshot();
    const response = await confirm({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      previewHash: previewBody.previewHash,
      confirmPeriodTargets: [periodId],
      lines,
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ConfirmBody>();
    expect(body.assignedMinor).toBe('7000000');
    expect(body.sourceRemainingMinor).toBe('1000000');
    expect(body.confirmedPeriodIds).toEqual([periodId]);
    expect(body.assignments).toHaveLength(2);
    expect(body.assignments.map((item) => item.amountMinor).sort()).toEqual(['500000', '6500000']);

    const period = await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: periodId } });
    expect(period.targetStatus).toBe('CONFIRMED');
    const after = await snapshot();
    expect(after.assignments).toBe(before.assignments + 2);
    expect(after.cash).toBe(before.cash);
    expect(after.auditAssignments).toBe(before.auditAssignments + 2);
    expect(after.auditPeriods).toBe(before.auditPeriods + 1);
    const confirmedSum = await prisma.envelopeAssignment.aggregate({
      where: { budgetId, sourceIncomeTransactionId: income, status: 'CONFIRMED' },
      _sum: { amountMinor: true },
    });
    expect(confirmedSum._sum.amountMinor).toBe(7_000_000n);
  });

  it('сбой ПОСЛЕ confirmDrafts и первого назначения откатывает всё (атомарность)', async () => {
    const budgetId = owner().budgetId;
    await resetDraft();
    const income = await createIncome(budgetId, accountId, salaryCategory, 8_000_000n);
    const lines: Line[] = [
      { envelopeId: currentEnvelope, periodId, amount: '100.00' },
      { envelopeId: savingsEnvelope, amount: '200.00' },
    ];
    const previewBody = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      overrides: lines,
      confirmPeriodTargets: [periodId],
    });
    const before = await snapshot();
    const original = AssignmentRepository.prototype.createAssignment;
    let calls = 0;
    const spy = vi
      .spyOn(AssignmentRepository.prototype, 'createAssignment')
      .mockImplementation(async function (this: AssignmentRepository, ...args) {
        calls += 1;
        if (calls === 2) throw new Error('injected failure');
        return original.apply(this, args);
      });
    try {
      const response = await confirm({
        sourceKind: 'INCOME',
        incomeTransactionId: income,
        previewHash: previewBody.previewHash,
        confirmPeriodTargets: [periodId],
        lines,
      });
      expect(response.statusCode).toBe(500);
      expect(calls).toBe(2);
    } finally {
      spy.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
    const period = await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: periodId } });
    expect(period.targetStatus).toBe('DRAFT');
    expect(period.confirmedAt).toBeNull();
    expect(
      await prisma.envelopeAssignment.count({ where: { sourceIncomeTransactionId: income } }),
    ).toBe(0);
  });

  it('предпроверка источника (до записи): превышение дохода — SOURCE_EXHAUSTED, ничего не записано', async () => {
    const budgetId = owner().budgetId;
    await resetDraft();
    const income = await createIncome(budgetId, accountId, salaryCategory, 8_000_000n);
    const lines: Line[] = [
      { envelopeId: currentEnvelope, periodId, amount: '65000.00' },
      { envelopeId: savingsEnvelope, amount: '20000.00' },
    ];
    const previewBody = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      overrides: lines,
      confirmPeriodTargets: [periodId],
    });
    const before = await snapshot();
    const response = await confirm({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      previewHash: previewBody.previewHash,
      confirmPeriodTargets: [periodId],
      lines,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('SOURCE_EXHAUSTED');
    expect(await snapshot()).toEqual(before);
    const period = await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: periodId } });
    expect(period.targetStatus).toBe('DRAFT');
  });

  it('повтор с тем же ключом возвращает тот же результат без дублей; другое тело — конфликт', async () => {
    const income = await createIncome(owner().budgetId, accountId, salaryCategory, 1_000_000n);
    const lines: Line[] = [{ envelopeId: repairEnvelope, amount: '1000.00' }];
    const previewBody = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      overrides: lines,
      confirmPeriodTargets: [],
    });
    const payload = {
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      previewHash: previewBody.previewHash,
      confirmPeriodTargets: [],
      lines,
    };
    const key = `rep-${randomUUID()}`;
    const first = await confirm(payload, { key });
    expect(first.statusCode).toBe(200);
    const mid = await snapshot();
    const second = await confirm(payload, { key });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await snapshot()).toEqual(mid);
    const conflict = await confirm(
      { ...payload, lines: [{ envelopeId: repairEnvelope, amount: '999.00' }] },
      { key },
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await confirm(payload, { key: '' })).statusCode).toBe(400);
  });

  it('изменение расхода/правила/цели/дохода/разбивки после preview даёт 409 PREVIEW_STALE без записи', async () => {
    const budgetId = owner().budgetId;
    await resetDraft();
    const income = await createIncome(budgetId, accountId, salaryCategory, 5_000_000n);
    await assignments.assignIncome(
      owner().userId,
      budgetId,
      { incomeTransactionId: income, envelopeId: repairEnvelope, amount: '1000' },
      `st-${randomUUID()}`,
    );
    const lines: Line[] = [{ envelopeId: savingsEnvelope, amount: '500.00' }];
    const mutators: Array<[string, () => Promise<unknown>]> = [
      [
        'expense',
        () =>
          prisma.transaction.create({
            data: {
              id: randomUUID(),
              budgetId,
              transactionType: 'EXPENSE',
              status: 'CONFIRMED',
              accountingModelVersion: 2,
              amountMinor: 100_000n,
              occurredOn: day(today),
              confirmedAt: new Date(),
              categoryId: expenseCategory,
              accountId,
              envelopeId: repairEnvelope,
              createdByUserId: owner().userId,
              updatedByUserId: owner().userId,
            },
          }),
      ],
      [
        'rule',
        () =>
          prisma.envelopeFundingRule.updateMany({
            where: { budgetId, envelopeId: savingsEnvelope },
            data: { fixedMinor: 600_000n },
          }),
      ],
      [
        'target',
        () =>
          prisma.envelopePeriod.update({
            where: { id: periodId },
            data: { targetMinor: 6_400_000n },
          }),
      ],
      [
        'income-split',
        async () => {
          const row = await prisma.envelopeAssignment.findFirstOrThrow({
            where: { budgetId, sourceIncomeTransactionId: income, envelopeId: repairEnvelope },
          });
          await prisma.envelopeAssignment.update({
            where: { id: row.id },
            data: { envelopeId: savingsEnvelope },
          });
        },
      ],
      [
        'income-amount',
        () =>
          prisma.transaction.update({ where: { id: income }, data: { amountMinor: 4_900_000n } }),
      ],
    ];
    for (const [name, mutate] of mutators) {
      const previewBody = await preview({
        sourceKind: 'INCOME',
        incomeTransactionId: income,
        overrides: lines,
        confirmPeriodTargets: [periodId],
      });
      await mutate();
      const before = await snapshot();
      const response = await confirm({
        sourceKind: 'INCOME',
        incomeTransactionId: income,
        previewHash: previewBody.previewHash,
        confirmPeriodTargets: [periodId],
        lines,
      });
      expect(response.statusCode, name).toBe(409);
      expect(response.json<{ code: string }>().code, name).toBe('PREVIEW_STALE');
      expect(await snapshot(), name).toEqual(before);
      expect(
        (await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: periodId } })).targetStatus,
      ).toBe('DRAFT');
    }
  });

  it('два параллельных confirm с разными ключами на один доход: один отказ, Σ<=доход', async () => {
    const budgetId = owner().budgetId;
    const income = await createIncome(budgetId, accountId, salaryCategory, 3_000_000n);
    const lines: Line[] = [{ envelopeId: repairEnvelope, amount: '20000.00' }];
    const previewBody = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      overrides: lines,
      confirmPeriodTargets: [],
    });
    const payload = {
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      previewHash: previewBody.previewHash,
      confirmPeriodTargets: [],
      lines,
    };
    const results = await Promise.all([confirm(payload), confirm(payload)]);
    const codes = results.map((item) => item.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    expect(results.find((item) => item.statusCode === 409)!.json<{ code: string }>().code).toBe(
      'PREVIEW_STALE',
    );
    const sum = await prisma.envelopeAssignment.aggregate({
      where: { budgetId, sourceIncomeTransactionId: income, status: 'CONFIRMED', type: 'INCOME' },
      _sum: { amountMinor: true },
    });
    expect(sum._sum.amountMinor).toBe(2_000_000n);
  });

  it('ручная сумма не равна suggested: принимается; FREE источник создаёт FREE-назначение', async () => {
    const budgetId = owner().budgetId;
    const income = await createIncome(budgetId, accountId, salaryCategory, 3_000_000n);
    const lines: Line[] = [{ envelopeId: savingsEnvelope, amount: '1234.56' }];
    const previewBody = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      overrides: lines,
      confirmPeriodTargets: [],
    });
    const response = await confirm({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      previewHash: previewBody.previewHash,
      confirmPeriodTargets: [],
      lines,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ConfirmBody>().assignedMinor).toBe('123456');

    const freeLines: Line[] = [{ envelopeId: repairEnvelope, amount: '10.00' }];
    const freePreview = await preview({
      sourceKind: 'FREE',
      overrides: freeLines,
      confirmPeriodTargets: [],
    });
    const free = await confirm({
      sourceKind: 'FREE',
      previewHash: freePreview.previewHash,
      confirmPeriodTargets: [],
      lines: freeLines,
    });
    expect(free.statusCode, free.body).toBe(200);
    const row = await prisma.envelopeAssignment.findUniqueOrThrow({
      where: { id: free.json<ConfirmBody>().assignments[0]!.id },
    });
    expect(row).toMatchObject({
      type: 'FREE',
      sourceIncomeTransactionId: null,
      amountMinor: 1000n,
    });
  });

  it('пустые lines: только подтверждение цели; оба пустых — без записи', async () => {
    const budgetId = owner().budgetId;
    await resetDraft();
    const targetsOnly = await preview({
      sourceKind: 'FREE',
      confirmPeriodTargets: [periodId],
    });
    const before = await snapshot();
    const response = await confirm({
      sourceKind: 'FREE',
      previewHash: targetsOnly.previewHash,
      confirmPeriodTargets: [periodId],
      lines: [],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ConfirmBody>()).toMatchObject({
      assignedMinor: '0',
      confirmedPeriodIds: [periodId],
      assignments: [],
    });
    const after = await snapshot();
    expect(after.assignments).toBe(before.assignments);
    expect(after.auditPeriods).toBe(before.auditPeriods + 1);

    const noop = await snapshot();
    const empty = await confirm({
      sourceKind: 'FREE',
      previewHash: 'a'.repeat(64),
      confirmPeriodTargets: [],
      lines: [],
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json<ConfirmBody>()).toEqual({
      assignedMinor: '0',
      sourceRemainingMinor: '0',
      confirmedPeriodIds: [],
      assignments: [],
    });
    expect(await snapshot()).toEqual(noop);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId } })).toBe(noop.assignments);
  });

  it('чужой конверт/период/цель 404, архивный 422, дубль 400, ноль 400', async () => {
    const income = await createIncome(owner().budgetId, accountId, salaryCategory, 1_000_000n);
    const base = {
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      previewHash: 'a'.repeat(64),
      confirmPeriodTargets: [] as string[],
    };
    const before = await snapshot();
    expect(
      (await confirm({ ...base, lines: [{ envelopeId: outsiderEnvelope, amount: '1.00' }] }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await confirm({
          ...base,
          lines: [{ envelopeId: currentEnvelope, periodId: outsiderPeriod, amount: '1.00' }],
        })
      ).statusCode,
    ).toBe(404);
    const foreignTarget = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      confirmPeriodTargets: [outsiderPeriod],
    });
    expect(
      (
        await confirm({
          ...base,
          previewHash: foreignTarget.previewHash,
          confirmPeriodTargets: [outsiderPeriod],
          lines: [],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await confirm({
          ...base,
          incomeTransactionId: outsiderIncome,
          lines: [{ envelopeId: repairEnvelope, amount: '1.00' }],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await confirm({ ...base, lines: [{ envelopeId: repairEnvelope, amount: '0' }] })).statusCode,
    ).toBe(400);
    expect(
      (
        await confirm({
          ...base,
          lines: [
            { envelopeId: repairEnvelope, amount: '1.00' },
            { envelopeId: repairEnvelope, amount: '2.00' },
          ],
        })
      ).statusCode,
    ).toBe(400);
    const archived = await createEnvelope(owner().budgetId, 'SAVINGS_GOAL', 'Архив');
    await prisma.envelope.update({ where: { id: archived }, data: { archivedAt: new Date() } });
    const archivedResponse = await confirm({
      ...base,
      lines: [{ envelopeId: archived, amount: '1.00' }],
    });
    expect(archivedResponse.statusCode).toBe(422);
    expect(archivedResponse.json<{ code: string }>().code).toBe('ENVELOPE_ARCHIVED');
    expect(await snapshot()).toEqual(before);
  });

  it('доступ: VIEWER/EDITOR 403, посторонний 404, 401, CSRF, uuid 400', async () => {
    const income = await createIncome(owner().budgetId, accountId, salaryCategory, 1_000_000n);
    const payload = {
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      previewHash: 'a'.repeat(64),
      confirmPeriodTargets: [],
      lines: [{ envelopeId: repairEnvelope, amount: '1.00' }],
    };
    const before = await snapshot();
    for (const user of [ctx.viewer, ctx.editor]) {
      expect((await confirm(payload, { user })).statusCode).toBe(403);
    }
    expect((await confirm(payload, { user: ctx.outsider })).statusCode).toBe(404);
    const url = `/api/v2/budgets/${owner().budgetId}/funding/confirm`;
    expect(
      (await server.inject({ method: 'POST', url, headers: { origin }, payload })).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: 'POST',
          url,
          headers: { ...authHeaders(owner()), 'idempotency-key': randomUUID() },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect((await confirm(payload, { budgetId: 'not-a-uuid' })).statusCode).toBe(400);
    for (const bad of [
      { ...payload, incomeTransactionId: 'nope' },
      { ...payload, sourceKind: 'FREE' },
      { ...payload, confirmPeriodTargets: ['nope'] },
      { ...payload, previewHash: 'short' },
      { ...payload, lines: [{ envelopeId: 'nope', amount: '1' }] },
      { ...payload, extra: 1 },
    ]) {
      expect((await confirm(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('OpenAPI описывает confirm', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = openApi.json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, { properties?: Record<string, { type?: string }> }> };
    }>();
    const operation = document.paths['/api/v2/budgets/{budgetId}/funding/confirm']?.post;
    expect(operation).toBeDefined();
    for (const code of ['200', '400', '401', '403', '404', '409', '422']) {
      expect(operation!.responses[code], code).toBeDefined();
    }
    expect(JSON.stringify(operation)).toContain('Idempotency-Key');
    expect(JSON.stringify(operation)).toContain('session');
    expect(JSON.stringify(operation!.responses['409'])).toContain('PREVIEW_STALE');
    expect(JSON.stringify(operation)).toContain('VALIDATION_FAILED');
    expect(JSON.stringify(operation)).toContain('FORBIDDEN');
    const schemas = document.components.schemas;
    expect(schemas.FundingConfirmResponse?.properties?.assignedMinor?.type).toBe('string');
    expect(schemas.FundingConfirmRequest?.properties?.previewHash?.type).toBe('string');
  });
});

afterAll(async () => {
  for (const key of Object.keys(ctx) as Array<keyof typeof emails>) {
    await cleanupUser(ctx[key]?.userId ?? '');
  }
  await servicePrisma.$disconnect();
  await app.close();
  await prisma.$disconnect();
});

async function snapshot() {
  const budgetId = owner().budgetId;
  const cash = await prisma.transaction.aggregate({
    where: { budgetId, status: 'CONFIRMED', deletedAt: null },
    _sum: { amountMinor: true },
  });
  return {
    assignments: await prisma.envelopeAssignment.count({ where: { budgetId } }),
    cash: cash._sum.amountMinor,
    confirmedPeriods: await prisma.envelopePeriod.count({
      where: { budgetId, targetStatus: 'CONFIRMED' },
    }),
    auditAssignments: await prisma.auditEvent.count({
      where: { budgetId, entityType: 'envelope-assignment' },
    }),
    auditPeriods: await prisma.auditEvent.count({
      where: { budgetId, entityType: 'envelope_period' },
    }),
    audit: await prisma.auditEvent.count({ where: { budgetId } }),
    idempotency: await prisma.idempotencyRecord.count({ where: { budgetId } }),
  };
}

async function resetDraft(): Promise<void> {
  await prisma.envelopePeriod.update({
    where: { id: periodId },
    data: {
      targetMinor: 6_500_000n,
      targetStatus: 'DRAFT',
      confirmedByUserId: null,
      confirmedAt: null,
    },
  });
}

function authHeaders(user: RegisteredUser | undefined): Record<string, string> {
  return { origin, cookie: `harmofin_session=${user?.cookie ?? ''}` };
}

function mutationHeaders(user: RegisteredUser | undefined): Record<string, string> {
  return { ...authHeaders(user), 'x-csrf-token': user?.csrfToken ?? '' };
}

async function preview(payload: Record<string, unknown>): Promise<PreviewBody> {
  const response = await server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${owner().budgetId}/funding/preview`,
    headers: mutationHeaders(ctx.owner),
    payload,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<PreviewBody>();
}

function confirm(
  payload: Record<string, unknown>,
  options: { user?: RegisteredUser | undefined; key?: string; budgetId?: string } = {},
) {
  const user = options.user ?? ctx.owner;
  return server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${options.budgetId ?? owner().budgetId}/funding/confirm`,
    headers: { ...mutationHeaders(user), 'idempotency-key': options.key ?? `cf-${randomUUID()}` },
    payload,
  });
}

async function createAccount(budgetId: string, startingBalanceMinor: bigint): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      startingBalanceMinor,
      accountingStartDate: new Date(Date.now() - 90 * 86_400_000),
    },
  });
  return account.id;
}

async function createCategory(
  budgetId: string,
  name: string,
  categoryType: 'INCOME' | 'EXPENSE',
): Promise<string> {
  const category = await prisma.category.create({
    data: { id: randomUUID(), budgetId, name, categoryType, displayOrder: 900 },
  });
  return category.id;
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

async function createRule(
  envelopeId: string,
  type: 'FIXED_PER_PERIOD' | 'SUGGESTED_FIXED',
  priority: number,
  fixedMinor: bigint,
): Promise<void> {
  await prisma.envelopeFundingRule.create({
    data: {
      id: randomUUID(),
      budgetId: owner().budgetId,
      envelopeId,
      type,
      priority,
      fixedMinor,
      createdByUserId: owner().userId,
      updatedByUserId: owner().userId,
    },
  });
}

async function createIncome(
  budgetId: string,
  account: string,
  categoryId: string,
  amountMinor: bigint,
): Promise<string> {
  const row = await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId,
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      accountingModelVersion: 2,
      amountMinor,
      occurredOn: day(today),
      confirmedAt: new Date(),
      categoryId,
      accountId: account,
      createdByUserId: ctx.owner!.userId,
      updatedByUserId: ctx.owner!.userId,
    },
  });
  return row.id;
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
    await prisma.planPayment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.planOccurrence.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.regularPlan.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.incomeAllocation.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transferPart.deleteMany({ where: { transfer: { budget: { workspaceId } } } });
    await prisma.transfer.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transaction.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.updateMany({
      where: { workspaceId },
      data: { incomeAllocationSourceCategoryId: null, incomeAllocationTargetEnvelopeId: null },
    });
    await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
