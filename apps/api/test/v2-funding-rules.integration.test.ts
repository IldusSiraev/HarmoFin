import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { AssignmentBalanceRepository } from '../src/envelope-plans/assignment-balance.repository.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../src/common/plan-model/plan-model.policy.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { FundingRuleRepository } from '../src/envelope-plans/funding-rule.repository.js';
import { IncomeCategorySuggestionApplicationService } from '../src/funding/income-category-suggestion.application.service.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

const emails = {
  owner: `v2-rules-owner-${randomUUID()}@harmofin.test`,
  outsider: `v2-rules-outsider-${randomUUID()}@harmofin.test`,
  viewer: `v2-rules-viewer-${randomUUID()}@harmofin.test`,
  editor: `v2-rules-editor-${randomUUID()}@harmofin.test`,
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

let firstEnvelope: string;
let secondEnvelope: string;
let mandatoryEnvelope: string;
let savingsEnvelope: string;
let outsiderEnvelope: string;

const FIRST_START = '2026-09-01';
const FIRST_END = '2026-09-14';
const SECOND_START = '2026-09-15';
const SECOND_END = '2026-09-30';
const NEXT_FIRST_START = '2026-10-01';
const NEXT_FIRST_END = '2026-10-14';

const repository = new FundingRuleRepository();
const suggestionService = new IncomeCategorySuggestionApplicationService(
  new PrismaService(databaseUrl),
  new IdempotencyService(),
  new PlanModelPolicy(new PrismaService(databaseUrl)),
);

describe('v2 funding rules and period target snapshots', () => {
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
    firstEnvelope = await createEnvelope(budgetId, 'CURRENT_EXPENSES', 'Первый период', 'FIRST');
    secondEnvelope = await createEnvelope(budgetId, 'CURRENT_EXPENSES', 'Второй период', 'SECOND');
    mandatoryEnvelope = await createEnvelope(budgetId, 'MANDATORY_EXPENSES', 'Обязательные');
    savingsEnvelope = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Накопление');
    outsiderEnvelope = await createEnvelope(
      ctx.outsider!.budgetId,
      'CURRENT_EXPENSES',
      'Чужой',
      'FIRST',
    );
  });

  it('PUT funding-rule: upsert одного правила, replay не дублирует, minor-строки', async () => {
    const key = `rule-first-${randomUUID()}`;
    const payload = { type: 'FIXED_PER_PERIOD', priority: 10, fixedAmount: '65000' };
    const saved = await putRule(ctx.owner, firstEnvelope, payload, key);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      envelopeId: firstEnvelope,
      type: 'FIXED_PER_PERIOD',
      priority: 10,
      fixedAmountMinor: '6500000',
      percentBasisPoints: null,
    });
    const replay = await putRule(ctx.owner, firstEnvelope, payload, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ id: string }>().id).toBe(saved.json<{ id: string }>().id);
    expect(await ruleCount(firstEnvelope)).toBe(1);

    const conflict = await putRule(ctx.owner, firstEnvelope, { ...payload, priority: 11 }, key);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');

    const second = await putRule(
      ctx.owner,
      secondEnvelope,
      { type: 'FIXED_PER_PERIOD', priority: 20, fixedAmount: '55000.50' },
      `rule-second-${randomUUID()}`,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json<{ fixedAmountMinor: string }>().fixedAmountMinor).toBe('5500050');

    const upsert = await putRule(
      ctx.owner,
      mandatoryEnvelope,
      { type: 'MANUAL', priority: 1 },
      `rule-mand-${randomUUID()}`,
    );
    expect(upsert.statusCode).toBe(200);
    const upsert2 = await putRule(
      ctx.owner,
      mandatoryEnvelope,
      { type: 'SUM_OF_PLANS', priority: 2 },
      `rule-mand2-${randomUUID()}`,
    );
    expect(upsert2.statusCode).toBe(200);
    expect(upsert2.json<{ id: string }>().id).toBe(upsert.json<{ id: string }>().id);
    expect(await ruleCount(mandatoryEnvelope)).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: ctx.owner!.budgetId, entityType: 'envelope_funding_rule' },
      }),
    ).toBe(4);
  });

  it('матрица валидации правила', async () => {
    const bad = async (payload: Record<string, unknown>, envelopeId = savingsEnvelope) =>
      putRule(ctx.owner, envelopeId, payload, `rule-bad-${randomUUID()}`);

    expect((await bad({ type: 'MANUAL', priority: 1, fixedAmount: '1' })).statusCode).toBe(400);
    expect((await bad({ type: 'MANUAL', priority: 1, percentBasisPoints: 10 })).statusCode).toBe(
      400,
    );
    expect((await bad({ type: 'FIXED_PER_PERIOD', priority: 1 })).statusCode).toBe(400);
    expect((await bad({ type: 'SUGGESTED_FIXED', priority: 1 })).statusCode).toBe(400);
    expect(
      (await bad({ type: 'FIXED_PER_PERIOD', priority: 1, fixedAmount: '-5' })).statusCode,
    ).toBe(400);
    expect(
      (await bad({ type: 'FIXED_PER_PERIOD', priority: 1, fixedAmount: '0' })).statusCode,
    ).toBe(400);
    expect(
      (await bad({ type: 'FIXED_PER_PERIOD', priority: 1, fixedAmount: '1.234' })).statusCode,
    ).toBe(400);
    expect(
      (
        await bad({
          type: 'PERCENT_OF_INCOME',
          priority: 1,
          fixedAmount: '1',
          percentBasisPoints: 5,
        })
      ).statusCode,
    ).toBe(400);
    expect((await bad({ type: 'PERCENT_OF_INCOME', priority: 1 })).statusCode).toBe(400);
    expect(
      (await bad({ type: 'PERCENT_OF_INCOME', priority: 1, percentBasisPoints: 10001 })).statusCode,
    ).toBe(400);
    expect(
      (await bad({ type: 'PERCENT_OF_INCOME', priority: 1, percentBasisPoints: -1 })).statusCode,
    ).toBe(400);
    expect(
      (await bad({ type: 'PERCENT_OF_INCOME', priority: 1, percentBasisPoints: 1.5 })).statusCode,
    ).toBe(400);
    expect((await bad({ type: 'MANUAL', priority: 1.5 })).statusCode).toBe(400);
    expect((await bad({ type: 'MANUAL' })).statusCode).toBe(400);
    expect((await bad({ type: 'UNKNOWN', priority: 1 })).statusCode).toBe(400);
    expect((await bad({ type: 'MANUAL', priority: 1, extra: true })).statusCode).toBe(400);

    const notMandatory = await bad({ type: 'SUM_OF_PLANS', priority: 1 });
    expect(notMandatory.statusCode).toBe(422);

    const percent = await bad({ type: 'PERCENT_OF_INCOME', priority: 3, percentBasisPoints: 3000 });
    expect(percent.statusCode).toBe(200);
    expect(percent.json()).toMatchObject({ percentBasisPoints: 3000, fixedAmountMinor: null });
    const zero = await bad({ type: 'PERCENT_OF_INCOME', priority: 3, percentBasisPoints: 0 });
    expect(zero.statusCode).toBe(200);
    const max = await bad({ type: 'PERCENT_OF_INCOME', priority: 3, percentBasisPoints: 10000 });
    expect(max.statusCode).toBe(200);
    expect(await ruleCount(savingsEnvelope)).toBe(1);
  });

  it('FIRST draft 65000, SECOND другой; смена правила не переписывает открытый период', async () => {
    const budgetId = ctx.owner!.budgetId;
    const first = await openPeriod(budgetId, firstEnvelope, FIRST_START, FIRST_END);
    expect(first).toMatchObject({ targetMinor: 6_500_000n, targetStatus: 'DRAFT', created: true });
    const second = await openPeriod(budgetId, secondEnvelope, SECOND_START, SECOND_END);
    expect(second).toMatchObject({ targetMinor: 5_500_050n, targetStatus: 'DRAFT' });
    expect(second.targetMinor).not.toBe(first.targetMinor);

    const mandatory = await openPeriod(budgetId, mandatoryEnvelope, FIRST_START, FIRST_END);
    expect(mandatory).toMatchObject({ targetMinor: null, targetStatus: 'UNSET' });

    const changed = await putRule(
      ctx.owner,
      firstEnvelope,
      { type: 'FIXED_PER_PERIOD', priority: 10, fixedAmount: '70000' },
      `rule-first-change-${randomUUID()}`,
    );
    expect(changed.statusCode).toBe(200);

    const again = await openPeriod(budgetId, firstEnvelope, FIRST_START, FIRST_END);
    expect(again).toMatchObject({
      id: first.id,
      targetMinor: first.targetMinor,
      targetStatus: 'DRAFT',
      created: false,
    });
    const next = await openPeriod(budgetId, firstEnvelope, NEXT_FIRST_START, NEXT_FIRST_END);
    expect(next).toMatchObject({ targetMinor: 7_000_000n, targetStatus: 'DRAFT', created: true });
    expect(
      await prisma.envelopePeriod.count({ where: { budgetId, envelopeId: firstEnvelope } }),
    ).toBe(2);
  });

  it('PUT target подтверждает CONFIRMED с audit, не трогает funded/cash/assignments', async () => {
    const budgetId = ctx.owner!.budgetId;
    const period = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId, envelopeId: firstEnvelope, startsOn: new Date(FIRST_START) },
    });
    expect(period.targetStatus).toBe('DRAFT');
    const asOf = new Date();
    const cashBefore = await cashOf(budgetId);
    const balanceBefore = await balanceOf(budgetId, firstEnvelope, period.id, asOf);
    const assignmentsBefore = await prisma.envelopeAssignment.count({ where: { budgetId } });
    const auditBefore = await auditCount(budgetId, period.id, 'UPDATED');

    const key = `target-first-${randomUUID()}`;
    const response = await putTarget(
      ctx.owner,
      firstEnvelope,
      FIRST_START,
      { target: '65000' },
      key,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      periodId: period.id,
      envelopeId: firstEnvelope,
      periodStart: FIRST_START,
      periodEnd: FIRST_END,
      targetMinor: '6500000',
      targetStatus: 'CONFIRMED',
    });
    const stored = await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(stored).toMatchObject({
      targetMinor: 6_500_000n,
      targetStatus: 'CONFIRMED',
      confirmedByUserId: ctx.owner!.userId,
    });
    expect(stored.confirmedAt).not.toBeNull();

    expect(await cashOf(budgetId)).toBe(cashBefore);
    expect(await balanceOf(budgetId, firstEnvelope, period.id, asOf)).toEqual(balanceBefore);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId } })).toBe(assignmentsBefore);
    expect(await auditCount(budgetId, period.id, 'UPDATED')).toBe(auditBefore + 1);

    const replay = await putTarget(ctx.owner, firstEnvelope, FIRST_START, { target: '65000' }, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ periodId: string }>().periodId).toBe(period.id);
    expect(await auditCount(budgetId, period.id, 'UPDATED')).toBe(auditBefore + 1);

    const mismatch = await putTarget(ctx.owner, firstEnvelope, FIRST_START, { target: '1' }, key);
    expect(mismatch.statusCode).toBe(409);

    const other = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId, envelopeId: firstEnvelope, startsOn: new Date(NEXT_FIRST_START) },
    });
    expect(other.targetStatus).toBe('DRAFT');
  });

  it('PUT target создаёт ещё не открытый период и очищает target в UNSET', async () => {
    const budgetId = ctx.owner!.budgetId;
    const created = await putTarget(
      ctx.owner,
      secondEnvelope,
      '2026-11-15',
      { target: '12345.67' },
      `target-new-${randomUUID()}`,
    );
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      targetMinor: '1234567',
      targetStatus: 'CONFIRMED',
      periodStart: '2026-11-15',
      periodEnd: '2026-11-30',
    });
    const cleared = await putTarget(
      ctx.owner,
      secondEnvelope,
      '2026-11-15',
      { target: null },
      `target-clear-${randomUUID()}`,
    );
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ targetMinor: null, targetStatus: 'UNSET' });
    const row = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId, envelopeId: secondEnvelope, startsOn: new Date('2026-11-15') },
    });
    expect(row).toMatchObject({ targetMinor: null, targetStatus: 'UNSET', confirmedAt: null });

    const missing = await putTarget(
      ctx.owner,
      secondEnvelope,
      '2026-12-15',
      {},
      `target-missing-${randomUUID()}`,
    );
    expect(missing.statusCode).toBe(400);
    const negative = await putTarget(
      ctx.owner,
      secondEnvelope,
      '2026-12-15',
      { target: '-1' },
      `target-neg-${randomUUID()}`,
    );
    expect(negative.statusCode).toBe(400);
  });

  it('даты периода валидируются по настройкам бюджета и ревизиям, не по слоту', async () => {
    const put = (envelopeId: string, start: string) =>
      putTarget(ctx.owner, envelopeId, start, { target: '1' }, `target-date-${randomUUID()}`);
    expect((await put(firstEnvelope, '2026-09-02')).statusCode).toBe(400);
    expect((await put(firstEnvelope, '2026-02-30')).statusCode).toBe(400);
    expect((await put(firstEnvelope, 'not-a-date')).statusCode).toBe(400);
    expect((await put(firstEnvelope, SECOND_START)).statusCode).toBe(400);
    expect((await put(mandatoryEnvelope, FIRST_START)).statusCode).toBe(400);

    await prisma.budgetCycleRevision.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.owner!.budgetId,
        effectiveOn: new Date('2027-01-01'),
        cycleStartDay: 5,
        periodBoundaryOffset: 10,
        timezone: 'UTC',
      },
    });
    expect((await put(firstEnvelope, '2027-01-05')).statusCode).toBe(200);
    expect((await put(firstEnvelope, '2027-01-01')).statusCode).toBe(400);
    const revised = await prisma.envelopePeriod.findFirstOrThrow({
      where: {
        budgetId: ctx.owner!.budgetId,
        envelopeId: firstEnvelope,
        startsOn: new Date('2027-01-05'),
      },
    });
    expect(revised.endsOn.toISOString().slice(0, 10)).toBe('2027-01-14');
  });

  it('confirm-target: DRAFT -> CONFIRMED без движения денег, replay и второй ключ без второго audit', async () => {
    const budgetId = ctx.owner!.budgetId;
    const period = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId, envelopeId: firstEnvelope, startsOn: new Date(NEXT_FIRST_START) },
    });
    expect(period).toMatchObject({ targetMinor: 7_000_000n, targetStatus: 'DRAFT' });
    const asOf = new Date();
    const cashBefore = await cashOf(budgetId);
    const balanceBefore = await balanceOf(budgetId, firstEnvelope, period.id, asOf);
    const assignmentsBefore = await prisma.envelopeAssignment.count({ where: { budgetId } });
    const auditBefore = await auditCount(budgetId, period.id, 'UPDATED');

    const key = `confirm-${randomUUID()}`;
    const response = await postTarget(ctx.owner, 'confirm-target', period.id, key);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      periodId: period.id,
      envelopeId: firstEnvelope,
      periodStart: NEXT_FIRST_START,
      periodEnd: NEXT_FIRST_END,
      targetMinor: '7000000',
      targetStatus: 'CONFIRMED',
      suggestedTargetMinor: null,
      confirmedTargetMinor: '7000000',
    });
    const stored = await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(stored).toMatchObject({
      targetMinor: 7_000_000n,
      targetStatus: 'CONFIRMED',
      confirmedByUserId: ctx.owner!.userId,
    });
    expect(stored.confirmedAt).not.toBeNull();
    expect(await cashOf(budgetId)).toBe(cashBefore);
    expect(await balanceOf(budgetId, firstEnvelope, period.id, asOf)).toEqual(balanceBefore);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId } })).toBe(assignmentsBefore);
    expect(await auditCount(budgetId, period.id, 'UPDATED')).toBe(auditBefore + 1);

    const replay = await postTarget(ctx.owner, 'confirm-target', period.id, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ targetStatus: string }>().targetStatus).toBe('CONFIRMED');
    const second = await postTarget(
      ctx.owner,
      'confirm-target',
      period.id,
      `confirm-${randomUUID()}`,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json<{ targetStatus: string }>().targetStatus).toBe('CONFIRMED');
    expect(await auditCount(budgetId, period.id, 'UPDATED')).toBe(auditBefore + 1);

    const rejectConfirmed = await postTarget(
      ctx.owner,
      'reject-target',
      period.id,
      `reject-${randomUUID()}`,
    );
    expect(rejectConfirmed.statusCode).toBe(409);
    expect(
      (await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: period.id } })).targetStatus,
    ).toBe('CONFIRMED');
  });

  it('reject-target: DRAFT -> UNSET/null, правило для следующих периодов не меняется', async () => {
    const budgetId = ctx.owner!.budgetId;
    const period = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId, envelopeId: secondEnvelope, startsOn: new Date(SECOND_START) },
    });
    expect(period.targetStatus).toBe('DRAFT');
    const ruleBefore = await prisma.envelopeFundingRule.findFirstOrThrow({
      where: { budgetId, envelopeId: secondEnvelope },
    });
    const auditBefore = await auditCount(budgetId, period.id, 'UPDATED');

    const key = `reject-${randomUUID()}`;
    const response = await postTarget(ctx.owner, 'reject-target', period.id, key);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      periodId: period.id,
      targetMinor: null,
      targetStatus: 'UNSET',
      suggestedTargetMinor: null,
      confirmedTargetMinor: null,
      confirmedAt: null,
    });
    expect(
      await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: period.id } }),
    ).toMatchObject({ targetMinor: null, targetStatus: 'UNSET', confirmedAt: null });
    const ruleAfter = await prisma.envelopeFundingRule.findFirstOrThrow({
      where: { budgetId, envelopeId: secondEnvelope },
    });
    expect(ruleAfter).toMatchObject({
      id: ruleBefore.id,
      type: ruleBefore.type,
      fixedMinor: ruleBefore.fixedMinor,
    });
    const nextOpened = await openPeriod(budgetId, secondEnvelope, '2026-12-15', '2026-12-31');
    expect(nextOpened).toMatchObject({ targetMinor: 5_500_050n, targetStatus: 'DRAFT' });
    expect(await auditCount(budgetId, period.id, 'UPDATED')).toBe(auditBefore + 1);

    const replay = await postTarget(ctx.owner, 'reject-target', period.id, key);
    expect(replay.statusCode).toBe(200);
    expect(await auditCount(budgetId, period.id, 'UPDATED')).toBe(auditBefore + 1);

    const confirmUnset = await postTarget(
      ctx.owner,
      'confirm-target',
      period.id,
      `confirm-unset-${randomUUID()}`,
    );
    expect(confirmUnset.statusCode).toBe(409);
  });

  it('confirm/reject-target: DRAFT виден как suggested, чужой/неизвестный период 404, роли и CSRF', async () => {
    const budgetId = ctx.owner!.budgetId;
    const draft = await openPeriod(budgetId, secondEnvelope, '2026-10-15', '2026-10-31');
    expect(draft.targetStatus).toBe('DRAFT');
    const foreign = await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        envelopeId: outsiderEnvelope,
        startsOn: new Date(FIRST_START),
        endsOn: new Date(FIRST_END),
        targetMinor: 100n,
        targetStatus: 'DRAFT',
      },
    });
    for (const action of ['confirm-target', 'reject-target'] as const) {
      expect(
        (await postTarget(ctx.owner, action, foreign.id, `f-${randomUUID()}`)).statusCode,
      ).toBe(404);
      expect(
        (await postTarget(ctx.owner, action, randomUUID(), `n-${randomUUID()}`)).statusCode,
      ).toBe(404);
      expect(
        (await postTarget(ctx.outsider, action, draft.id, `o-${randomUUID()}`)).statusCode,
      ).toBe(404);
      for (const user of [ctx.viewer, ctx.editor]) {
        expect((await postTarget(user, action, draft.id, `r-${randomUUID()}`)).statusCode).toBe(
          403,
        );
      }
      const url = `/api/v2/budgets/${budgetId}/periods/${draft.id}/${action}`;
      const unauth = await server.inject({
        method: 'POST',
        url,
        headers: { origin, 'x-csrf-token': 'x', 'idempotency-key': `u-${randomUUID()}` },
      });
      expect(unauth.statusCode).toBe(401);
      const noCsrf = await server.inject({
        method: 'POST',
        url,
        headers: { ...authHeaders(ctx.owner), 'idempotency-key': `c-${randomUUID()}` },
      });
      expect(noCsrf.statusCode).toBe(403);
      const noKey = await server.inject({
        method: 'POST',
        url,
        headers: { ...authHeaders(ctx.owner), 'x-csrf-token': ctx.owner!.csrfToken },
      });
      expect(noKey.statusCode).toBe(400);
    }
    expect(
      (await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: draft.id } })).targetStatus,
    ).toBe('DRAFT');
    expect(
      (await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: foreign.id } })).targetStatus,
    ).toBe('DRAFT');
  });

  it('невалидный uuid в пути -> 400 VALIDATION_FAILED, не 500', async () => {
    for (const action of ['confirm-target', 'reject-target'] as const) {
      const response = await postTarget(ctx.owner, action, 'not-a-uuid', `bad-${randomUUID()}`);
      expect(response.statusCode, action).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
    }
    const budgetId = ctx.owner!.budgetId;
    const rule = await putRule(
      ctx.owner,
      'not-a-uuid',
      { type: 'MANUAL', priority: 1 },
      `bad-${randomUUID()}`,
    );
    expect(rule.statusCode).toBe(400);
    const target = await putTarget(
      ctx.owner,
      'not-a-uuid',
      FIRST_START,
      { target: '1' },
      `bad-${randomUUID()}`,
    );
    expect(target.statusCode).toBe(400);
    const badStart = await putTarget(
      ctx.owner,
      firstEnvelope,
      "x'; --",
      { target: '1' },
      `bad-${randomUUID()}`,
    );
    expect(badStart.statusCode).toBe(400);
    expect(budgetId).toBeTruthy();
  });

  it('confirmDrafts(tx): некорректный id игнорируется и не обрывает транзакцию', async () => {
    const result = await prisma.$transaction((tx) =>
      repository.confirmDrafts(tx, ctx.owner!.budgetId, ['not-a-uuid', ''], ctx.owner!.userId),
    );
    expect(result).toEqual([]);
  });

  it('confirmDrafts(tx): подтверждает только DRAFT своего бюджета, audit на каждый', async () => {
    const budgetId = ctx.owner!.budgetId;
    const draft = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId, envelopeId: secondEnvelope, startsOn: new Date('2026-10-15') },
    });
    const dec = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId, envelopeId: secondEnvelope, startsOn: new Date('2026-12-15') },
    });
    const foreign = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId: ctx.outsider!.budgetId, envelopeId: outsiderEnvelope },
    });
    const confirmed = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId, envelopeId: firstEnvelope, startsOn: new Date(NEXT_FIRST_START) },
    });
    const auditBefore = await auditCount(budgetId, draft.id, 'UPDATED');
    const result = await prisma.$transaction((tx) =>
      repository.confirmDrafts(
        tx,
        budgetId,
        [draft.id, dec.id, foreign.id, confirmed.id, randomUUID(), draft.id],
        ctx.owner!.userId,
      ),
    );
    expect([...result].sort()).toEqual([dec.id, draft.id].sort());
    expect(
      (await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: draft.id } })).targetStatus,
    ).toBe('CONFIRMED');
    expect(
      (await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: foreign.id } })).targetStatus,
    ).toBe('DRAFT');
    expect(await auditCount(budgetId, draft.id, 'UPDATED')).toBe(auditBefore + 1);
    expect(
      await prisma.$transaction((tx) =>
        repository.confirmDrafts(tx, budgetId, [draft.id], ctx.owner!.userId),
      ),
    ).toEqual([]);
    expect(
      await prisma.$transaction((tx) =>
        repository.confirmDrafts(tx, budgetId, [], ctx.owner!.userId),
      ),
    ).toEqual([]);
  });

  it('чужой envelope 404, VIEWER/EDITOR 403, 401, CSRF и Idempotency-Key', async () => {
    const budgetPrefix = `/api/v2/budgets/${ctx.owner!.budgetId}`;
    expect(
      (
        await putRule(
          ctx.owner,
          outsiderEnvelope,
          { type: 'MANUAL', priority: 1 },
          `rule-foreign-${randomUUID()}`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await putTarget(
          ctx.owner,
          outsiderEnvelope,
          FIRST_START,
          { target: '1' },
          `target-foreign-${randomUUID()}`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await putTarget(
          ctx.outsider,
          firstEnvelope,
          FIRST_START,
          { target: '1' },
          `target-outsider-${randomUUID()}`,
        )
      ).statusCode,
    ).toBe(404);

    for (const user of [ctx.viewer, ctx.editor]) {
      expect(
        (
          await putRule(
            user,
            firstEnvelope,
            { type: 'MANUAL', priority: 1 },
            `rule-role-${randomUUID()}`,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await putTarget(
            user,
            firstEnvelope,
            FIRST_START,
            { target: '1' },
            `target-role-${randomUUID()}`,
          )
        ).statusCode,
      ).toBe(403);
    }

    const ruleUrl = `${budgetPrefix}/envelopes/${firstEnvelope}/funding-rule`;
    const targetUrl = `${budgetPrefix}/envelopes/${firstEnvelope}/periods/${FIRST_START}/target`;
    for (const [url, payload] of [
      [ruleUrl, { type: 'MANUAL', priority: 1 }],
      [targetUrl, { target: '1' }],
    ] as const) {
      const unauth = await server.inject({
        method: 'PUT',
        url,
        headers: { origin, 'x-csrf-token': 'x', 'idempotency-key': `u-${randomUUID()}` },
        payload,
      });
      expect(unauth.statusCode).toBe(401);
      const noCsrf = await server.inject({
        method: 'PUT',
        url,
        headers: { ...authHeaders(ctx.owner), 'idempotency-key': `c-${randomUUID()}` },
        payload,
      });
      expect(noCsrf.statusCode).toBe(403);
      expect(noCsrf.json<{ code: string }>().code).toBe('CSRF_INVALID');
      const noKey = await server.inject({
        method: 'PUT',
        url,
        headers: { ...authHeaders(ctx.owner), 'x-csrf-token': ctx.owner!.csrfToken },
        payload,
      });
      expect(noKey.statusCode).toBe(400);
    }
    expect(await ruleCount(firstEnvelope)).toBe(1);
  });

  describe('income-category suggestion setting (service, no HTTP)', () => {
    const settingOf = (budgetId: string) =>
      prisma.budget.findUniqueOrThrow({
        where: { id: budgetId },
        select: {
          incomeAllocationRuleEnabled: true,
          incomeAllocationSourceCategoryId: true,
          incomeAllocationTargetEnvelopeId: true,
        },
      });
    const suggestionAudit = (budgetId: string) =>
      prisma.auditEvent.count({
        where: { budgetId, entityType: 'income_category_suggestion' },
      });
    const put = (
      user: RegisteredUser | undefined,
      budgetId: string | undefined,
      body: { enabled: boolean; sourceCategoryId: string | null; targetEnvelopeId: string | null },
      key = `sugg-${randomUUID()}`,
    ) => suggestionService.put(user!.userId, budgetId!, body, key);
    const makeCategory = (
      budgetId: string,
      name: string,
      categoryType: 'INCOME' | 'EXPENSE',
      archived = false,
    ) =>
      prisma.category.create({
        data: {
          id: randomUUID(),
          budgetId,
          name,
          categoryType,
          displayOrder: 900,
          ...(archived ? { archivedAt: new Date() } : {}),
        },
      });

    it('владелец задаёт Шабашка->Ремонт; доход 12000 не создаёт assignment; replay без второго audit', async () => {
      const budgetId = ctx.owner!.budgetId;
      const category = await makeCategory(budgetId, 'Шабашка', 'INCOME');
      const repair = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Ремонт');
      const account = await prisma.account.findFirstOrThrow({ where: { budgetId } });
      const assignmentsBefore = await prisma.envelopeAssignment.count({ where: { budgetId } });
      const auditBefore = await suggestionAudit(budgetId);

      const key = `sugg-ok-${randomUUID()}`;
      const body = { enabled: true, sourceCategoryId: category.id, targetEnvelopeId: repair };
      const saved = await put(ctx.owner, budgetId, body, key);
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual(body);
      expect(await settingOf(budgetId)).toEqual({
        incomeAllocationRuleEnabled: true,
        incomeAllocationSourceCategoryId: category.id,
        incomeAllocationTargetEnvelopeId: repair,
      });
      expect(await suggestionAudit(budgetId)).toBe(auditBefore + 1);

      await prisma.transaction.create({
        data: {
          id: randomUUID(),
          budgetId,
          transactionType: 'INCOME',
          status: 'CONFIRMED',
          accountingModelVersion: 2,
          amountMinor: 1_200_000n,
          occurredOn: new Date('2026-09-20'),
          confirmedAt: new Date('2026-09-20T10:00:00Z'),
          categoryId: category.id,
          accountId: account.id,
          createdByUserId: ctx.owner!.userId,
          updatedByUserId: ctx.owner!.userId,
        },
      });
      expect(await prisma.envelopeAssignment.count({ where: { budgetId } })).toBe(
        assignmentsBefore,
      );
      expect(await prisma.incomeAllocation.count({ where: { budgetId } })).toBe(0);

      const replay = await put(ctx.owner, budgetId, body, key);
      expect(replay).toEqual(saved);
      expect(await suggestionAudit(budgetId)).toBe(auditBefore + 1);

      const conflict = await put(ctx.owner, budgetId, { ...body, enabled: false }, key).catch(
        (error: { getStatus(): number; getResponse(): { code: string } }) => error,
      );
      expect(conflict).toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });

      const cleared = await put(ctx.owner, budgetId, {
        enabled: false,
        sourceCategoryId: null,
        targetEnvelopeId: null,
      });
      expect(cleared.body).toEqual({
        enabled: false,
        sourceCategoryId: null,
        targetEnvelopeId: null,
      });
      expect(await settingOf(budgetId)).toEqual({
        incomeAllocationRuleEnabled: false,
        incomeAllocationSourceCategoryId: null,
        incomeAllocationTargetEnvelopeId: null,
      });
      expect(await suggestionAudit(budgetId)).toBe(auditBefore + 2);
    });

    it('валидация: чужое 404, архив/тип 422, enabled требует обе ссылки, 400', async () => {
      const budgetId = ctx.owner!.budgetId;
      const income = await makeCategory(budgetId, 'Подработка', 'INCOME');
      const archivedIncome = await makeCategory(budgetId, 'Старый доход', 'INCOME', true);
      const expense = await makeCategory(budgetId, 'Еда', 'EXPENSE');
      const foreignCategory = await makeCategory(ctx.outsider!.budgetId, 'Чужой доход', 'INCOME');
      const archivedEnvelope = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'Архивный');
      await prisma.envelope.update({
        where: { id: archivedEnvelope },
        data: { archivedAt: new Date() },
      });
      const before = await settingOf(budgetId);
      const auditBefore = await suggestionAudit(budgetId);
      const status = async (
        sourceCategoryId: string | null,
        targetEnvelopeId: string | null,
        enabled = true,
      ): Promise<number> => {
        try {
          await put(ctx.owner, budgetId, { enabled, sourceCategoryId, targetEnvelopeId });
          return 200;
        } catch (error) {
          return (error as { getStatus(): number }).getStatus();
        }
      };
      expect(await status(foreignCategory.id, savingsEnvelope)).toBe(404);
      expect(await status(randomUUID(), savingsEnvelope)).toBe(404);
      expect(await status(income.id, outsiderEnvelope)).toBe(404);
      expect(await status(archivedIncome.id, savingsEnvelope)).toBe(422);
      expect(await status(expense.id, savingsEnvelope)).toBe(422);
      expect(await status(income.id, archivedEnvelope)).toBe(422);
      expect(await status(income.id, null)).toBe(400);
      expect(await status(null, savingsEnvelope)).toBe(400);
      expect(await status(null, null)).toBe(400);
      expect(await settingOf(budgetId)).toEqual(before);
      expect(await suggestionAudit(budgetId)).toBe(auditBefore);
    });

    it('VIEWER/EDITOR 403, не участник 404 и не тронут', async () => {
      const budgetId = ctx.owner!.budgetId;
      const income = await makeCategory(budgetId, 'Премия', 'INCOME');
      const before = await settingOf(budgetId);
      const body = {
        enabled: true,
        sourceCategoryId: income.id,
        targetEnvelopeId: savingsEnvelope,
      };
      for (const user of [ctx.viewer, ctx.editor]) {
        await expect(put(user, budgetId, body)).rejects.toMatchObject({ status: 403 });
      }
      await expect(put(ctx.outsider, budgetId, body)).rejects.toMatchObject({ status: 404 });
      expect(await settingOf(budgetId)).toEqual(before);
    });
  });

  it('HTTP PUT income-category-suggestion: replay безопасен, роли, 404/422, 400, CSRF, ключ', async () => {
    const budgetId = ctx.owner!.budgetId;
    const url = `/api/v2/budgets/${budgetId}/income-category-suggestion`;
    const category = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId,
        name: 'HTTP доход',
        categoryType: 'INCOME',
        displayOrder: 901,
      },
    });
    const expense = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId,
        name: 'HTTP расход',
        categoryType: 'EXPENSE',
        displayOrder: 902,
      },
    });
    const foreign = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: ctx.outsider!.budgetId,
        name: 'HTTP чужой',
        categoryType: 'INCOME',
        displayOrder: 903,
      },
    });
    const archivedEnvelope = await createEnvelope(budgetId, 'SAVINGS_GOAL', 'HTTP архив');
    await prisma.envelope.update({
      where: { id: archivedEnvelope },
      data: { archivedAt: new Date() },
    });
    const send = (
      user: RegisteredUser | undefined,
      payload: Record<string, unknown>,
      key = `http-sugg-${randomUUID()}`,
    ) => server.inject({ method: 'PUT', url, headers: mutationHeaders(user, key), payload });
    const auditCountNow = () =>
      prisma.auditEvent.count({ where: { budgetId, entityType: 'income_category_suggestion' } });
    const body = {
      enabled: true,
      sourceCategoryId: category.id,
      targetEnvelopeId: savingsEnvelope,
    };
    const auditBefore = await auditCountNow();

    const key = `http-sugg-ok-${randomUUID()}`;
    const saved = await send(ctx.owner, body, key);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual(body);
    const replay = await send(ctx.owner, body, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(body);
    expect(await auditCountNow()).toBe(auditBefore + 1);
    const conflict = await send(ctx.owner, { ...body, enabled: false }, key);
    expect(conflict.statusCode).toBe(409);

    for (const user of [ctx.viewer, ctx.editor]) {
      expect((await send(user, body)).statusCode).toBe(403);
    }
    expect((await send(ctx.outsider, body)).statusCode).toBe(404);
    expect((await send(ctx.owner, { ...body, sourceCategoryId: foreign.id })).statusCode).toBe(404);
    expect((await send(ctx.owner, { ...body, sourceCategoryId: expense.id })).statusCode).toBe(422);
    expect(
      (await send(ctx.owner, { ...body, targetEnvelopeId: archivedEnvelope })).statusCode,
    ).toBe(422);
    expect((await send(ctx.owner, { ...body, targetEnvelopeId: null })).statusCode).toBe(400);
    expect((await send(ctx.owner, { ...body, sourceCategoryId: 'not-a-uuid' })).statusCode).toBe(
      400,
    );
    expect((await send(ctx.owner, { enabled: true })).statusCode).toBe(400);
    expect((await send(ctx.owner, { ...body, extra: 1 })).statusCode).toBe(400);

    const unauth = await server.inject({
      method: 'PUT',
      url,
      headers: { origin, 'x-csrf-token': 'x', 'idempotency-key': `u-${randomUUID()}` },
      payload: body,
    });
    expect(unauth.statusCode).toBe(401);
    const noCsrf = await server.inject({
      method: 'PUT',
      url,
      headers: { ...authHeaders(ctx.owner), 'idempotency-key': `c-${randomUUID()}` },
      payload: body,
    });
    expect(noCsrf.statusCode).toBe(403);
    const noKey = await server.inject({
      method: 'PUT',
      url,
      headers: { ...authHeaders(ctx.owner), 'x-csrf-token': ctx.owner!.csrfToken },
      payload: body,
    });
    expect(noKey.statusCode).toBe(400);
    const badBudget = await server.inject({
      method: 'PUT',
      url: '/api/v2/budgets/not-a-uuid/income-category-suggestion',
      headers: mutationHeaders(ctx.owner, `bb-${randomUUID()}`),
      payload: body,
    });
    expect(badBudget.statusCode).toBe(400);
    expect(await auditCountNow()).toBe(auditBefore + 1);
    await send(ctx.owner, { enabled: false, sourceCategoryId: null, targetEnvelopeId: null });
  });

  it('OpenAPI описывает оба маршрута, v1 не затронут', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(openApi.statusCode).toBe(200);
    const document = openApi.json<{
      paths: Record<
        string,
        { put?: { responses: Record<string, unknown>; parameters?: unknown[] } }
      >;
      components: { schemas: Record<string, { properties?: Record<string, { type?: string }> }> };
    }>();
    for (const path of [
      '/api/v2/budgets/{budgetId}/envelopes/{envelopeId}/funding-rule',
      '/api/v2/budgets/{budgetId}/envelopes/{envelopeId}/periods/{periodStart}/target',
    ]) {
      const operation = document.paths[path]?.put;
      expect(operation, path).toBeDefined();
      for (const code of ['200', '400', '401', '403', '404', '409', '422']) {
        expect(operation!.responses[code], `${path} ${code}`).toBeDefined();
      }
      expect(JSON.stringify(operation!.parameters)).toContain('Idempotency-Key');
    }
    for (const action of ['confirm-target', 'reject-target']) {
      const path = `/api/v2/budgets/{budgetId}/periods/{periodId}/${action}`;
      const operation = (
        document.paths[path] as unknown as {
          post?: { responses: Record<string, unknown>; parameters?: unknown[] };
        }
      )?.post;
      expect(operation, path).toBeDefined();
      for (const code of ['200', '400', '401', '403', '404', '409']) {
        expect(operation!.responses[code], `${path} ${code}`).toBeDefined();
      }
      expect(JSON.stringify(operation!.parameters)).toContain('Idempotency-Key');
    }
    const schemas = document.components.schemas;
    expect(schemas.PeriodTargetResponse?.properties?.suggestedTargetMinor?.type).toBe('string');
    expect(schemas.PeriodTargetResponse?.properties?.confirmedTargetMinor?.type).toBe('string');
    expect(schemas.FundingRuleResponse?.properties?.type?.type).toBe('string');
    expect(schemas.PeriodTargetResponse?.properties?.targetStatus?.type).toBe('string');
    expect(Object.keys(document.paths).some((path) => path.startsWith('/api/v1/'))).toBe(true);
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

function putRule(
  user: RegisteredUser | undefined,
  envelopeId: string,
  payload: Record<string, unknown>,
  key: string,
) {
  return server.inject({
    method: 'PUT',
    url: `/api/v2/budgets/${ctx.owner!.budgetId}/envelopes/${envelopeId}/funding-rule`,
    headers: mutationHeaders(user, key),
    payload,
  });
}

function putTarget(
  user: RegisteredUser | undefined,
  envelopeId: string,
  periodStart: string,
  payload: Record<string, unknown>,
  key: string,
) {
  return server.inject({
    method: 'PUT',
    url: `/api/v2/budgets/${ctx.owner!.budgetId}/envelopes/${envelopeId}/periods/${periodStart}/target`,
    headers: mutationHeaders(user, key),
    payload,
  });
}

function postTarget(
  user: RegisteredUser | undefined,
  action: 'confirm-target' | 'reject-target',
  periodId: string,
  key: string,
) {
  return server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${ctx.owner!.budgetId}/periods/${periodId}/${action}`,
    headers: mutationHeaders(user, key),
  });
}

async function ruleCount(envelopeId: string): Promise<number> {
  return prisma.envelopeFundingRule.count({
    where: { budgetId: ctx.owner!.budgetId, envelopeId },
  });
}

async function auditCount(budgetId: string, entityId: string, action: string): Promise<number> {
  return prisma.auditEvent.count({
    where: { budgetId, entityType: 'envelope_period', entityId, action },
  });
}

async function openPeriod(budgetId: string, envelopeId: string, start: string, end: string) {
  return prisma.$transaction((tx) =>
    repository.getOrCreatePeriod(tx, budgetId, envelopeId, start, end, {
      workspaceId: ctx.owner!.workspaceId,
      userId: ctx.owner!.userId,
    }),
  );
}

async function balanceOf(budgetId: string, envelopeId: string, periodId: string, asOf: Date) {
  return prisma.$transaction((tx) =>
    new AssignmentBalanceRepository().balance(tx, budgetId, envelopeId, periodId, asOf),
  );
}

async function cashOf(budgetId: string): Promise<bigint> {
  const [row] = (await prisma.$queryRaw`
    SELECT (
      SELECT COALESCE(SUM(a."starting_balance_minor"), 0)
      FROM "accounts" a WHERE a."budget_id" = ${budgetId}::uuid
    ) AS cash
  `) as unknown as Array<{ cash: string | bigint }>;
  return BigInt(String(row!.cash));
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
