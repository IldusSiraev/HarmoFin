import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../src/common/plan-model/plan-model.policy.js';
import {
  addIsoDays,
  cycleAndPeriodFor,
  todayInTimezone,
} from '../src/cycles/cycle-period.domain.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AssignmentApplicationService } from '../src/envelope-plans/assignment.application.service.js';
import { PeriodTargetApplicationService } from '../src/envelope-plans/period-target.application.service.js';

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
const otherSlot = current.id === 'FIRST' ? 'SECOND' : 'FIRST';

const emails = {
  owner: `v2-prev-owner-${randomUUID()}@harmofin.test`,
  outsider: `v2-prev-outsider-${randomUUID()}@harmofin.test`,
  viewer: `v2-prev-viewer-${randomUUID()}@harmofin.test`,
  editor: `v2-prev-editor-${randomUUID()}@harmofin.test`,
};

type RegisteredUser = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};
type PreviewBody = {
  sourceAvailableMinor: string;
  periodTargetDrafts: Array<{
    periodId: string;
    targetMinor: string;
    selectedForConfirmation: boolean;
  }>;
  lines: Array<{
    envelopeId: string;
    periodId: string | null;
    lineId: string | null;
    suggestedMinor: string;
  }>;
  remainingMinor: string;
  mandatoryGapMinor: string;
  previewHash: string;
  errors: Array<{ code: string; detail: string }>;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
let servicePrisma: PrismaService;
let assignments: AssignmentApplicationService;
let periodTargets: PeriodTargetApplicationService;
const ctx: Partial<Record<keyof typeof emails, RegisteredUser>> = {};
const owner = () => ctx.owner!;

let accountId: string;
let salaryCategory: string;
let sideCategory: string;
let expenseCategory: string;
let currentEnvelope: string;
let otherSlotEnvelope: string;
let mandatoryEnvelope: string;
let savingsEnvelope: string;
let repairEnvelope: string;
let outsiderIncome: string;
let income1: string;
let income2: string;
let income3: string;

describe('v2 funding preview (R03b)', () => {
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
    periodTargets = new PeriodTargetApplicationService(
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
    sideCategory = await createCategory(budgetId, 'Шабашка', 'INCOME');
    expenseCategory = await createCategory(budgetId, 'Еда', 'EXPENSE');
    const outsiderCategory = await createCategory(ctx.outsider!.budgetId, 'Доход', 'INCOME');
    currentEnvelope = await createEnvelope(budgetId, 'CURRENT_EXPENSES', 'Текущий', current.id);
    otherSlotEnvelope = await createEnvelope(budgetId, 'CURRENT_EXPENSES', 'Другой', otherSlot);
    mandatoryEnvelope = await createEnvelope(budgetId, 'MANDATORY_EXPENSES', 'Обязательные');
    savingsEnvelope = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Накопление');
    repairEnvelope = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Ремонт');
    await createRule(mandatoryEnvelope, 'SUM_OF_PLANS', 1);
    await createRule(currentEnvelope, 'FIXED_PER_PERIOD', 10, 6_500_000n);
    await createRule(otherSlotEnvelope, 'FIXED_PER_PERIOD', 20, 5_500_000n);
    await createRule(savingsEnvelope, 'SUGGESTED_FIXED', 30, 500_000n);

    income1 = await createIncome(budgetId, accountId, salaryCategory, 8_000_000n);
    income2 = await createIncome(budgetId, accountId, salaryCategory, 3_000_000n);
    income3 = await createIncome(budgetId, accountId, sideCategory, 1_200_000n);
    outsiderIncome = await createIncome(
      ctx.outsider!.budgetId,
      outsiderAccount,
      outsiderCategory,
      500_000n,
    );
    await createMandatoryOccurrence(4_000_000n);
  });

  it('доход 80000, цель периода 65000 DRAFT: выбрана по умолчанию, условные строки 40000+40000', async () => {
    const response = await preview({ sourceKind: 'INCOME', incomeTransactionId: income1 });
    expect(response.statusCode).toBe(200);
    const body = response.json<PreviewBody>();
    expect(body.sourceAvailableMinor).toBe('8000000');
    expect(body.periodTargetDrafts).toEqual([
      {
        periodId: expect.any(String),
        targetMinor: '6500000',
        selectedForConfirmation: true,
      },
    ]);
    const periodId = body.periodTargetDrafts[0]!.periodId;
    expect(body.lines).toEqual([
      {
        envelopeId: mandatoryEnvelope,
        periodId: null,
        lineId: `${mandatoryEnvelope}||MANDATORY_CURRENT`,
        suggestedMinor: '4000000',
      },
      { envelopeId: currentEnvelope, periodId, lineId: null, suggestedMinor: '4000000' },
    ]);
    expect(body.remainingMinor).toBe('0');
    expect(body.mandatoryGapMinor).toBe('4000000');
    expect(body.previewHash).toMatch(/^[0-9a-f]{64}$/);
    const total = body.lines.reduce((sum, line) => sum + BigInt(line.suggestedMinor), 0n);
    expect(total).toBeLessThanOrEqual(8_000_000n);

    const row = await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: periodId } });
    expect(row).toMatchObject({ targetMinor: 6_500_000n, targetStatus: 'DRAFT' });
  });

  it('без выбора подтверждения периода строки текущему нет, хеш меняется', async () => {
    const selected = (
      await preview({ sourceKind: 'INCOME', incomeTransactionId: income1 })
    ).json<PreviewBody>();
    const response = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income1,
      confirmPeriodTargets: [],
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<PreviewBody>();
    expect(body.periodTargetDrafts).toEqual([
      expect.objectContaining({ targetMinor: '6500000', selectedForConfirmation: false }),
    ]);
    expect(body.lines).toEqual([
      {
        envelopeId: mandatoryEnvelope,
        periodId: null,
        lineId: `${mandatoryEnvelope}||MANDATORY_CURRENT`,
        suggestedMinor: '4000000',
      },
      { envelopeId: savingsEnvelope, periodId: null, lineId: null, suggestedMinor: '500000' },
    ]);
    expect(body.lines.some((line) => line.envelopeId === currentEnvelope)).toBe(false);
    expect(body.remainingMinor).toBe('3500000');
    expect(body.previewHash).not.toBe(selected.previewHash);
  });

  it('preview ничего не пишет кроме структурных строк периода; повтор идемпотентен', async () => {
    const budgetId = owner().budgetId;
    const snapshot = async () => ({
      assignments: await prisma.envelopeAssignment.count({ where: { budgetId } }),
      movements: await prisma.envelopeMovement.count({ where: { budgetId } }),
      periods: await prisma.envelopePeriod.count({ where: { budgetId } }),
      auditNonPeriod: await prisma.auditEvent.count({
        where: { budgetId, entityType: { not: 'envelope_period' } },
      }),
      auditPeriod: await prisma.auditEvent.count({
        where: { budgetId, entityType: 'envelope_period' },
      }),
      confirmed: await prisma.envelopePeriod.count({
        where: { budgetId, targetStatus: 'CONFIRMED' },
      }),
    });
    const before = await snapshot();
    for (let index = 0; index < 2; index += 1) {
      expect(
        (await preview({ sourceKind: 'INCOME', incomeTransactionId: income1 })).statusCode,
      ).toBe(200);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('после подтверждения первого дохода второй предлагает только gap; расход не переносится; хеш чувствителен к состоянию', async () => {
    const budgetId = owner().budgetId;
    const first = (
      await preview({ sourceKind: 'INCOME', incomeTransactionId: income1 })
    ).json<PreviewBody>();
    const periodId = first.periodTargetDrafts[0]!.periodId;
    await assignments.assignIncome(
      owner().userId,
      budgetId,
      { incomeTransactionId: income1, envelopeId: mandatoryEnvelope, amount: '40000' },
      `a-m-${randomUUID()}`,
    );
    await assignments.assignIncome(
      owner().userId,
      budgetId,
      { incomeTransactionId: income1, envelopeId: currentEnvelope, periodId, amount: '40000' },
      `a-c-${randomUUID()}`,
    );
    await periodTargets.confirmTarget(owner().userId, budgetId, periodId, `ct-${randomUUID()}`);

    const exhausted = (
      await preview({ sourceKind: 'INCOME', incomeTransactionId: income1 })
    ).json<PreviewBody>();
    expect(exhausted.sourceAvailableMinor).toBe('0');
    expect(exhausted.lines).toEqual([]);

    const second = (
      await preview({ sourceKind: 'INCOME', incomeTransactionId: income2 })
    ).json<PreviewBody>();
    expect(second.periodTargetDrafts).toEqual([]);
    expect(second.sourceAvailableMinor).toBe('3000000');
    expect(second.lines).toEqual([
      { envelopeId: currentEnvelope, periodId, lineId: null, suggestedMinor: '2500000' },
      { envelopeId: savingsEnvelope, periodId: null, lineId: null, suggestedMinor: '500000' },
    ]);
    expect(second.remainingMinor).toBe('0');
    expect(second.mandatoryGapMinor).toBe('0');

    const again = (
      await preview({ sourceKind: 'INCOME', incomeTransactionId: income2 })
    ).json<PreviewBody>();
    expect(again.previewHash).toBe(second.previewHash);

    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        accountingModelVersion: 2,
        amountMinor: 2_000_000n,
        occurredOn: day(today),
        confirmedAt: new Date(),
        categoryId: expenseCategory,
        accountId,
        envelopeId: currentEnvelope,
        createdByUserId: owner().userId,
        updatedByUserId: owner().userId,
      },
    });
    const afterExpense = (
      await preview({ sourceKind: 'INCOME', incomeTransactionId: income2 })
    ).json<PreviewBody>();
    expect(afterExpense.lines).toEqual(second.lines);
    expect(afterExpense.previewHash).not.toBe(second.previewHash);
  });

  it('процентное правило считается от суммы дохода за вычетом уже назначенного из него', async () => {
    await prisma.envelopeFundingRule.updateMany({
      where: { budgetId: owner().budgetId, envelopeId: savingsEnvelope },
      data: { type: 'PERCENT_OF_INCOME', fixedMinor: null, percentBasisPoints: 3000 },
    });
    const body = (
      await preview({ sourceKind: 'INCOME', incomeTransactionId: income2 })
    ).json<PreviewBody>();
    expect(body.errors).toEqual([]);
    expect(body.lines).toEqual([
      expect.objectContaining({
        envelopeId: currentEnvelope,
        lineId: null,
        suggestedMinor: '2500000',
      }),
      { envelopeId: savingsEnvelope, periodId: null, lineId: null, suggestedMinor: '500000' },
    ]);
  });

  it('категорийное правило Шабашка->Ремонт: одна строка, mandatory gap виден, без дубля', async () => {
    const budgetId = owner().budgetId;
    await createMandatoryOccurrence(3_000_000n);
    const put = await putSuggestion(owner(), {
      enabled: true,
      sourceCategoryId: sideCategory,
      targetEnvelopeId: repairEnvelope,
    });
    expect(put.statusCode).toBe(200);
    const assignmentsBefore = await prisma.envelopeAssignment.count({ where: { budgetId } });

    const body = (
      await preview({ sourceKind: 'INCOME', incomeTransactionId: income3 })
    ).json<PreviewBody>();
    expect(body.lines).toEqual([
      {
        envelopeId: repairEnvelope,
        periodId: null,
        lineId: null,
        suggestedMinor: '1200000',
      },
    ]);
    expect(body.mandatoryGapMinor).toBe('3000000');
    expect(body.remainingMinor).toBe('0');

    const other = (
      await preview({ sourceKind: 'INCOME', incomeTransactionId: income2 })
    ).json<PreviewBody>();
    expect(other.lines.some((line) => line.envelopeId === repairEnvelope)).toBe(false);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId } })).toBe(assignmentsBefore);
  });

  it('пользовательские overrides пересчитывают остаток и ошибки на сервере', async () => {
    const adjusted = (
      await preview({
        sourceKind: 'INCOME',
        incomeTransactionId: income3,
        overrides: [
          { envelopeId: repairEnvelope, amount: '7000' },
          { envelopeId: mandatoryEnvelope, amount: '5000' },
        ],
      })
    ).json<PreviewBody>();
    expect(adjusted.lines).toEqual([
      { envelopeId: repairEnvelope, periodId: null, lineId: null, suggestedMinor: '700000' },
      {
        envelopeId: mandatoryEnvelope,
        periodId: null,
        lineId: `${mandatoryEnvelope}||MANDATORY_CURRENT`,
        suggestedMinor: '500000',
      },
    ]);
    expect(adjusted.remainingMinor).toBe('0');
    expect(adjusted.errors).toEqual([]);

    const partial = (
      await preview({
        sourceKind: 'INCOME',
        incomeTransactionId: income3,
        overrides: [{ envelopeId: repairEnvelope, amount: '2000' }],
      })
    ).json<PreviewBody>();
    expect(partial.lines).toEqual([
      { envelopeId: repairEnvelope, periodId: null, lineId: null, suggestedMinor: '200000' },
    ]);
    expect(partial.remainingMinor).toBe('1000000');

    const over = (
      await preview({
        sourceKind: 'INCOME',
        incomeTransactionId: income3,
        overrides: [{ envelopeId: repairEnvelope, amount: '20000' }],
      })
    ).json<PreviewBody>();
    expect(over.errors.map((error) => error.code)).toContain('OVERRIDES_EXCEED_SOURCE');
    expect(over.remainingMinor).toBe('0');

    const hashA = adjusted.previewHash;
    const hashB = (
      await preview({
        sourceKind: 'INCOME',
        incomeTransactionId: income3,
        overrides: [
          { envelopeId: repairEnvelope, amount: '7001' },
          { envelopeId: mandatoryEnvelope, amount: '5000' },
        ],
      })
    ).json<PreviewBody>().previewHash;
    expect(hashB).not.toBe(hashA);

    const periodForeignEnvelope = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income3,
      overrides: [{ envelopeId: randomUUID(), amount: '1' }],
    });
    expect(periodForeignEnvelope.statusCode).toBe(404);
    const noPeriodForPeriodEnvelope = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income3,
      overrides: [{ envelopeId: currentEnvelope, amount: '1' }],
    });
    expect(noPeriodForPeriodEnvelope.statusCode).toBe(422);
    const negative = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income3,
      overrides: [{ envelopeId: repairEnvelope, amount: '-1' }],
    });
    expect(negative.statusCode).toBe(400);
  });

  it('override с тем же lineId дважды — 400 VALIDATION_FAILED', async () => {
    const response = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income3,
      overrides: [
        { envelopeId: repairEnvelope, amount: '7000', lineId: 'same-line-id' },
        { envelopeId: repairEnvelope, amount: '1000', lineId: 'same-line-id' },
      ],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'Строка конверта указана дважды.',
    });
  });

  it('override с lineId без совпадения: строка добавляется досозданной, id не возвращается', async () => {
    const response = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income3,
      overrides: [
        {
          envelopeId: savingsEnvelope,
          amount: '1500',
          lineId: 'preview-test-custom-line-id',
        },
      ],
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<PreviewBody>();
    expect(body.lines).toEqual([
      { envelopeId: repairEnvelope, periodId: null, lineId: null, suggestedMinor: '1200000' },
      { envelopeId: savingsEnvelope, periodId: null, lineId: null, suggestedMinor: '150000' },
    ]);
    expect(body.remainingMinor).toBe('0');
    expect(body.errors).toEqual([
      {
        code: 'OVERRIDES_EXCEED_SOURCE',
        detail: 'Сумма распределений больше, чем доступно в источнике.',
      },
    ]);
  });

  it('обязательные: два слайса — текущая строка по приоритету, следующая после строки периода', async () => {
    const created = await createMandatoryOccurrence(2_000_000n, day(addIsoDays(current.end, 1)));
    try {
      const base = (await preview({ sourceKind: 'FREE' })).json<PreviewBody>();
      expect(base.sourceAvailableMinor).toBe('34200000');
      expect(base.lines).toEqual([
        {
          envelopeId: mandatoryEnvelope,
          periodId: null,
          lineId: `${mandatoryEnvelope}||MANDATORY_CURRENT`,
          suggestedMinor: '3000000',
        },
        {
          envelopeId: currentEnvelope,
          periodId: expect.any(String),
          lineId: null,
          suggestedMinor: '2500000',
        },
        {
          envelopeId: mandatoryEnvelope,
          periodId: null,
          lineId: `${mandatoryEnvelope}||MANDATORY_NEXT`,
          suggestedMinor: '2000000',
        },
      ]);
      expect(base.remainingMinor).toBe('26700000');
      expect(base.mandatoryGapMinor).toBe('5000000');
      expect(base.errors).toEqual([]);

      const legacy = (
        await preview({
          sourceKind: 'FREE',
          overrides: [{ envelopeId: mandatoryEnvelope, amount: '7000' }],
        })
      ).json<PreviewBody>();
      expect(legacy.lines).toEqual([
        {
          envelopeId: mandatoryEnvelope,
          periodId: null,
          lineId: `${mandatoryEnvelope}||MANDATORY_CURRENT`,
          suggestedMinor: '700000',
        },
        {
          envelopeId: currentEnvelope,
          periodId: expect.any(String),
          lineId: null,
          suggestedMinor: '2500000',
        },
        {
          envelopeId: mandatoryEnvelope,
          periodId: null,
          lineId: `${mandatoryEnvelope}||MANDATORY_NEXT`,
          suggestedMinor: '2000000',
        },
      ]);
      expect(legacy.remainingMinor).toBe('29000000');

      const byLineId = (
        await preview({
          sourceKind: 'FREE',
          overrides: [
            {
              envelopeId: mandatoryEnvelope,
              amount: '1200',
              lineId: `${mandatoryEnvelope}||MANDATORY_NEXT`,
            },
          ],
        })
      ).json<PreviewBody>();
      expect(byLineId.lines).toEqual([
        {
          envelopeId: mandatoryEnvelope,
          periodId: null,
          lineId: `${mandatoryEnvelope}||MANDATORY_CURRENT`,
          suggestedMinor: '3000000',
        },
        {
          envelopeId: currentEnvelope,
          periodId: expect.any(String),
          lineId: null,
          suggestedMinor: '2500000',
        },
        {
          envelopeId: mandatoryEnvelope,
          periodId: null,
          lineId: `${mandatoryEnvelope}||MANDATORY_NEXT`,
          suggestedMinor: '120000',
        },
      ]);
      expect(byLineId.remainingMinor).toBe('28580000');
    } finally {
      await prisma.planOccurrence.deleteMany({ where: { id: created.occurrenceId } });
      await prisma.regularPlan.deleteMany({ where: { id: created.planId } });
    }
  });

  it('FREE и OPENING: свободные деньги; OPENING после операций отклоняется', async () => {
    const free = await preview({ sourceKind: 'FREE' });
    expect(free.statusCode).toBe(200);
    expect(BigInt(free.json<PreviewBody>().sourceAvailableMinor)).toBeGreaterThan(0n);
    const opening = await preview({ sourceKind: 'OPENING' });
    expect(opening.statusCode).toBe(422);
    expect(opening.json<{ code: string }>().code).toBe('OPENING_NOT_AVAILABLE');
  });

  it('доступ: чужой доход 404, VIEWER/EDITOR 403, посторонний 404, 401, CSRF, uuid 400', async () => {
    expect(
      (await preview({ sourceKind: 'INCOME', incomeTransactionId: outsiderIncome })).statusCode,
    ).toBe(404);
    expect(
      (await preview({ sourceKind: 'INCOME', incomeTransactionId: randomUUID() })).statusCode,
    ).toBe(404);
    for (const user of [ctx.viewer, ctx.editor]) {
      expect(
        (await preview({ sourceKind: 'INCOME', incomeTransactionId: income1 }, user)).statusCode,
      ).toBe(403);
    }
    expect(
      (await preview({ sourceKind: 'INCOME', incomeTransactionId: income1 }, ctx.outsider))
        .statusCode,
    ).toBe(404);
    const url = `/api/v2/budgets/${owner().budgetId}/funding/preview`;
    const payload = { sourceKind: 'FREE' };
    expect(
      (await server.inject({ method: 'POST', url, headers: { origin }, payload })).statusCode,
    ).toBe(401);
    const noCsrf = await server.inject({
      method: 'POST',
      url,
      headers: authHeaders(owner()),
      payload,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/v2/budgets/not-a-uuid/funding/preview',
          headers: mutationHeaders(owner()),
          payload,
        })
      ).statusCode,
    ).toBe(400);
    for (const bad of [
      { sourceKind: 'INCOME', incomeTransactionId: 'not-a-uuid' },
      { sourceKind: 'INCOME' },
      { sourceKind: 'FREE', incomeTransactionId: income1 },
      { sourceKind: 'WHAT' },
      { sourceKind: 'FREE', confirmPeriodTargets: ['not-a-uuid'] },
      { sourceKind: 'FREE', extra: 1 },
    ]) {
      const response = await preview(bad);
      expect(response.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('хеш чувствителен к разбивке назначений дохода по конвертам', async () => {
    const budgetId = owner().budgetId;
    const hashOf = async (incomeId: string) =>
      (await preview({ sourceKind: 'INCOME', incomeTransactionId: incomeId })).json<PreviewBody>()
        .previewHash;
    await assignments.assignIncome(
      owner().userId,
      budgetId,
      { incomeTransactionId: income2, envelopeId: repairEnvelope, amount: '1000' },
      `sw-i-${randomUUID()}`,
    );
    await assignments.assignFree(
      owner().userId,
      budgetId,
      { envelopeId: savingsEnvelope, amount: '1000', sourceKind: 'FREE' },
      `sw-f-${randomUUID()}`,
    );
    const before = await hashOf(income2);
    expect(await hashOf(income2)).toBe(before);
    const fromIncome = await prisma.envelopeAssignment.findFirstOrThrow({
      where: { budgetId, sourceIncomeTransactionId: income2, envelopeId: repairEnvelope },
    });
    const free = await prisma.envelopeAssignment.findFirstOrThrow({
      where: { budgetId, type: 'FREE', envelopeId: savingsEnvelope },
    });
    await prisma.envelopeAssignment.update({
      where: { id: fromIncome.id },
      data: { envelopeId: savingsEnvelope },
    });
    await prisma.envelopeAssignment.update({
      where: { id: free.id },
      data: { envelopeId: repairEnvelope },
    });
    expect(await hashOf(income2)).not.toBe(before);
  });

  it('хеш чувствителен к метаданным конвертов и строке периода цели категорийного правила', async () => {
    const budgetId = owner().budgetId;
    const hashOf = async (incomeId: string) =>
      (await preview({ sourceKind: 'INCOME', incomeTransactionId: incomeId })).json<PreviewBody>()
        .previewHash;
    const spare = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Запасной');
    const base = await hashOf(income1);
    expect(await hashOf(income1)).toBe(base);
    await prisma.envelope.update({ where: { id: spare }, data: { archivedAt: new Date() } });
    const archived = await hashOf(income1);
    expect(archived).not.toBe(base);
    await prisma.envelope.update({ where: { id: spare }, data: { envelopeType: 'RESERVE' } });
    expect(await hashOf(income1)).not.toBe(archived);

    await prisma.budget.update({
      where: { id: budgetId },
      data: {
        incomeAllocationRuleEnabled: true,
        incomeAllocationSourceCategoryId: sideCategory,
        incomeAllocationTargetEnvelopeId: otherSlotEnvelope,
      },
    });
    const withTarget = await hashOf(income3);
    expect(await hashOf(income3)).toBe(withTarget);
    await prisma.envelopePeriod.updateMany({
      where: { budgetId, envelopeId: otherSlotEnvelope },
      data: { targetMinor: 5_400_000n },
    });
    expect(await hashOf(income3)).not.toBe(withTarget);
  });

  it('OpenAPI описывает preview и PUT income-category-suggestion', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = openApi.json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, { properties?: Record<string, { type?: string }> }> };
    }>();
    const operation = document.paths['/api/v2/budgets/{budgetId}/funding/preview']?.post;
    expect(operation).toBeDefined();
    for (const code of ['200', '400', '401', '403', '404', '409', '422']) {
      expect(operation!.responses[code], code).toBeDefined();
    }
    const put = document.paths['/api/v2/budgets/{budgetId}/income-category-suggestion']?.put;
    expect(put).toBeDefined();
    for (const code of ['200', '400', '401', '403', '404', '409', '422']) {
      expect(put!.responses[code], code).toBeDefined();
    }
    expect(JSON.stringify(put)).toContain('Idempotency-Key');
    expect(JSON.stringify(put)).toContain('session');
    const schemas = document.components.schemas;
    expect(schemas.FundingPreviewResponse?.properties?.sourceAvailableMinor?.type).toBe('string');
    expect(schemas.FundingPreviewResponse?.properties?.previewHash?.type).toBe('string');
    expect(schemas.IncomeCategorySuggestionResponse?.properties?.enabled?.type).toBe('boolean');
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

function authHeaders(user: RegisteredUser | undefined): Record<string, string> {
  return { origin, cookie: `harmofin_session=${user?.cookie ?? ''}` };
}

function mutationHeaders(user: RegisteredUser | undefined): Record<string, string> {
  return { ...authHeaders(user), 'x-csrf-token': user?.csrfToken ?? '' };
}

function preview(payload: Record<string, unknown>, user: RegisteredUser | undefined = ctx.owner) {
  return server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${owner().budgetId}/funding/preview`,
    headers: mutationHeaders(user),
    payload,
  });
}

function putSuggestion(user: RegisteredUser | undefined, payload: Record<string, unknown>) {
  return server.inject({
    method: 'PUT',
    url: `/api/v2/budgets/${owner().budgetId}/income-category-suggestion`,
    headers: { ...mutationHeaders(user), 'idempotency-key': `sugg-${randomUUID()}` },
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
  type: 'SUM_OF_PLANS' | 'FIXED_PER_PERIOD' | 'SUGGESTED_FIXED',
  priority: number,
  fixedMinor: bigint | null = null,
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

async function createMandatoryOccurrence(
  amountMinor: bigint,
  scheduledOn: Date = day(today),
): Promise<{ planId: string; occurrenceId: string }> {
  const planId = randomUUID();
  const occurrenceId = randomUUID();
  const user = owner();
  await prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: user.workspaceId,
      budgetId: user.budgetId,
      name: `План ${planId.slice(0, 6)}`,
      planType: 'EXPENSE',
      amountMinor,
      anchorOn: scheduledOn,
      startOn: scheduledOn,
      recurrence: 'ONE_TIME',
      envelopeId: mandatoryEnvelope,
      isActive: true,
      createdByUserId: user.userId,
      updatedByUserId: user.userId,
    },
  });
  await prisma.planOccurrence.create({
    data: {
      id: occurrenceId,
      workspaceId: user.workspaceId,
      budgetId: user.budgetId,
      planId,
      scheduledOn,
      planName: 'План',
      planType: 'EXPENSE',
      amountMinor,
      envelopeId: mandatoryEnvelope,
      status: 'DUE',
    },
  });
  return { planId, occurrenceId };
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
