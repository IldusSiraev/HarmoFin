import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import {
  addIsoDays,
  cycleAndPeriodFor,
  todayInTimezone,
} from '../src/cycles/cycle-period.domain.js';
import { CycleRevisionRepository } from '../src/cycles/cycle-revision.repository.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

const names = ['owner', 'stale', 'outsider', 'viewer', 'editor'] as const;
type Name = (typeof names)[number];
const emails = Object.fromEntries(
  names.map((name) => [name, `v2-cycle-${name}-${randomUUID()}@harmofin.test`]),
) as Record<Name, string>;

type RegisteredUser = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};
type Range = { start: string; end: string };
type PreviewBody = { effectiveOn: string; transitionRanges: Range[]; previewHash: string };
type ConfirmBody = {
  effectiveOn: string;
  baselineCreated: boolean;
  transitionRanges: Range[];
  createdPeriods: number;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const ctx: Partial<Record<Name, RegisteredUser>> = {};
const user = (name: Name) => ctx[name]!;

const OLD = { cycleStartDay: 1, periodBoundaryOffset: 14, timezone: 'UTC' };
const NEW_INPUT = { cycleStartDay: 10, periodBoundaryOffset: 14 };
const NEW = { ...NEW_INPUT, timezone: 'UTC' };
const today = todayInTimezone(new Date(), 'UTC');
const iso = (value: Date | null) => value?.toISOString().slice(0, 10);
const dateOf = (value: string) => new Date(`${value}T00:00:00.000Z`);

const state: {
  envelopeFirst?: string;
  envelopeSecond?: string;
  confirmedPeriodId?: string;
  transactionId?: string;
  activatedOn?: string;
  firstConfirmed?: { preview: PreviewBody; body: ConfirmBody; key: string };
} = {};

describe('v2 cycle change preview and confirm (T02)', () => {
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
    for (const name of names) ctx[name] = await register(emails[name]);
    state.activatedOn = addIsoDays(today, -60);
    for (const name of ['owner', 'stale', 'outsider'] as const) {
      await prisma.budget.update({
        where: { id: user(name).budgetId },
        data: {
          planModelVersion: 2,
          planModelActivatedOn: dateOf(state.activatedOn),
          ...OLD,
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
          workspaceId: user('owner').workspaceId,
          userId: user(key).userId,
          role,
        },
      });
    }
    // owner budget: two slot envelopes, a confirmed past period, an unconfirmed current period,
    // and a confirmed transaction that must keep its date.
    const budgetId = user('owner').budgetId;
    const first = await prisma.envelope.create({
      data: envelopeData(budgetId, user('owner').userId, 'Первый', 'FIRST'),
    });
    const second = await prisma.envelope.create({
      data: envelopeData(budgetId, user('owner').userId, 'Второй', 'SECOND'),
    });
    state.envelopeFirst = first.id;
    state.envelopeSecond = second.id;
    const past = cycleAndPeriodFor(OLD, addIsoDays(today, -40)).period;
    const pastEnvelope = past.id === 'FIRST' ? first.id : second.id;
    const confirmed = await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId,
        envelopeId: pastEnvelope,
        startsOn: dateOf(past.start),
        endsOn: dateOf(past.end),
        targetMinor: 1000000n,
        targetStatus: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedByUserId: user('owner').userId,
      },
    });
    state.confirmedPeriodId = confirmed.id;
    const current = cycleAndPeriodFor(OLD, today).period;
    await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId,
        envelopeId: current.id === 'FIRST' ? first.id : second.id,
        startsOn: dateOf(current.start),
        endsOn: dateOf(current.end),
        targetStatus: 'UNSET',
      },
    });
    const account = await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId,
        ownerUserId: user('owner').userId,
        name: 'Основной',
        accountType: 'BANK_CARD',
        startingBalanceMinor: 0n,
        accountingStartDate: dateOf(addIsoDays(today, -60)),
      },
    });
    const category = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId,
        name: `Расход ${randomUUID()}`,
        categoryType: 'EXPENSE',
        displayOrder: 990,
      },
    });
    const transaction = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: 12345n,
        occurredOn: dateOf(addIsoDays(today, -40)),
        accountId: account.id,
        categoryId: category.id,
        envelopeId: first.id,
        confirmedAt: new Date(),
        createdByUserId: user('owner').userId,
        updatedByUserId: user('owner').userId,
      },
    });
    state.transactionId = transaction.id;
  });

  it('preview: считает переход без записи', async () => {
    const budgetId = user('owner').budgetId;
    const before = await snapshot(budgetId);
    const response = await preview('owner', NEW_INPUT);
    expect(response.statusCode).toBe(200);
    const body = response.json<PreviewBody>();
    expect(body.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.effectiveOn > today).toBe(true);
    expect(body.effectiveOn.slice(8)).toBe('10');
    expect(body.transitionRanges.length).toBeGreaterThan(0);
    const ranges = body.transitionRanges;
    expect(ranges.at(-1)!.end).toBe(addIsoDays(body.effectiveOn, -1));
    ranges.forEach((range, index) => {
      expect(range.start <= range.end).toBe(true);
      if (index > 0) expect(range.start).toBe(addIsoDays(ranges[index - 1]!.end, 1));
    });
    expect(await snapshot(budgetId)).toEqual(before);
    expect(await prisma.budgetCycleRevision.count({ where: { budgetId } })).toBe(0);
  });

  it('confirm: baseline + будущая revision, переходный интервал и цель владельца; история цела', async () => {
    const budgetId = user('owner').budgetId;
    const previewBody = (await preview('owner', NEW_INPUT)).json<PreviewBody>();
    const confirmedBefore = await prisma.envelopePeriod.findUniqueOrThrow({
      where: { id: state.confirmedPeriodId! },
    });
    const transactionBefore = await prisma.transaction.findUniqueOrThrow({
      where: { id: state.transactionId! },
    });
    const budgetBefore = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    const key = randomUUID();
    const response = await confirm(
      'owner',
      {
        previewHash: previewBody.previewHash,
        transitionTargets: [
          { periodStart: previewBody.transitionRanges[0]!.start, target: '1500.50' },
        ],
      },
      key,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json<ConfirmBody>();
    state.firstConfirmed = { preview: previewBody, body, key };
    expect(body.effectiveOn).toBe(previewBody.effectiveOn);
    expect(body.baselineCreated).toBe(true);
    expect(body.transitionRanges).toEqual(previewBody.transitionRanges);

    const revisions = await prisma.budgetCycleRevision.findMany({
      where: { budgetId },
      orderBy: { effectiveOn: 'asc' },
    });
    expect(revisions).toHaveLength(2);
    expect(iso(revisions[0]!.effectiveOn)).toBe(state.activatedOn);
    expect(revisions[0]).toMatchObject(OLD);
    expect(iso(revisions[1]!.effectiveOn)).toBe(previewBody.effectiveOn);
    expect(revisions[1]).toMatchObject(NEW);

    // transition interval rows with the owner's target; no overlap with the new revision
    const first = previewBody.transitionRanges[0]!;
    const slot = cycleAndPeriodFor(OLD, first.start).period.id;
    const slotEnvelope = slot === 'FIRST' ? state.envelopeFirst! : state.envelopeSecond!;
    const otherEnvelope = slot === 'FIRST' ? state.envelopeSecond! : state.envelopeFirst!;
    const transitionRow = await prisma.envelopePeriod.findFirstOrThrow({
      where: { budgetId, envelopeId: slotEnvelope, startsOn: dateOf(first.start) },
    });
    expect(iso(transitionRow.endsOn)).toBe(first.end);
    expect(transitionRow.targetMinor).toBe(150050n);
    expect(transitionRow.targetStatus).toBe('CONFIRMED');
    expect(
      await prisma.envelopePeriod.count({
        where: { budgetId, envelopeId: otherEnvelope, startsOn: dateOf(first.start) },
      }),
    ).toBe(0);
    const periods = await prisma.envelopePeriod.findMany({ where: { budgetId } });
    for (const period of periods) {
      const start = iso(period.startsOn)!;
      const end = iso(period.endsOn)!;
      expect(!(start < previewBody.effectiveOn && end >= previewBody.effectiveOn)).toBe(true);
    }

    // history unchanged
    expect(
      await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: state.confirmedPeriodId! } }),
    ).toEqual(confirmedBefore);
    const transactionAfter = await prisma.transaction.findUniqueOrThrow({
      where: { id: state.transactionId! },
    });
    expect(iso(transactionAfter.occurredOn)).toBe(iso(transactionBefore.occurredOn));
    expect(transactionAfter.updatedAt).toEqual(transactionBefore.updatedAt);
    const budgetAfter = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    expect(budgetAfter.cycleStartDay).toBe(budgetBefore.cycleStartDay);
    expect(budgetAfter.periodBoundaryOffset).toBe(budgetBefore.periodBoundaryOffset);

    const audit = await prisma.auditEvent.findMany({
      where: { budgetId, entityType: 'budget_cycle_revision' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(user('owner').userId);
  });

  it('settingsAt: до effectiveOn прежние границы, с effectiveOn новые', async () => {
    const budgetId = user('owner').budgetId;
    const repository = new CycleRevisionRepository();
    const effectiveOn = state.firstConfirmed!.preview.effectiveOn;
    expect(await repository.settingsAt(prisma, budgetId, addIsoDays(effectiveOn, -1))).toEqual(OLD);
    expect(await repository.settingsAt(prisma, budgetId, effectiveOn)).toEqual(NEW);
    expect(await repository.settingsAt(prisma, budgetId, addIsoDays(effectiveOn, 90))).toEqual(NEW);
    expect(
      await repository.settingsAt(prisma, budgetId, addIsoDays(state.activatedOn!, -5)),
    ).toEqual(OLD);
    // a budget without revisions falls back to the Budget fields
    expect(await repository.settingsAt(prisma, user('outsider').budgetId, today)).toEqual(OLD);
    // other budget's revisions never leak
    expect(await repository.settingsAt(prisma, user('stale').budgetId, effectiveOn)).toEqual(OLD);
  });

  it('retry с тем же ключом идемпотентен, новая смена при ожидающей revision даёт 409', async () => {
    const budgetId = user('owner').budgetId;
    const { preview: previewBody, body, key } = state.firstConfirmed!;
    const countBefore = await snapshot(budgetId);
    const retry = await confirm(
      'owner',
      {
        previewHash: previewBody.previewHash,
        transitionTargets: [
          { periodStart: previewBody.transitionRanges[0]!.start, target: '1500.50' },
        ],
      },
      key,
    );
    expect(retry.statusCode).toBe(200);
    expect(retry.json<ConfirmBody>()).toEqual(body);
    expect(await snapshot(budgetId)).toEqual(countBefore);
    expect(await prisma.budgetCycleRevision.count({ where: { budgetId } })).toBe(2);

    const changed = await confirm(
      'owner',
      { previewHash: previewBody.previewHash, transitionTargets: [] },
      key,
    );
    expect(changed.statusCode).toBe(409);
    expect(changed.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');

    const pending = await preview('owner', { cycleStartDay: 5, periodBoundaryOffset: 14 });
    expect(pending.statusCode).toBe(409);
    expect(pending.json<{ code: string }>().code).toBe('CYCLE_CHANGE_PENDING');
  });

  it('устаревший preview: 409 PREVIEW_STALE без записи', async () => {
    const budgetId = user('stale').budgetId;
    const previewBody = (await preview('stale', NEW_INPUT)).json<PreviewBody>();
    const envelope = await prisma.envelope.create({
      data: envelopeData(budgetId, user('stale').userId, 'Первый', 'FIRST'),
    });
    const past = cycleAndPeriodFor(OLD, addIsoDays(today, -40)).period;
    await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId,
        envelopeId: envelope.id,
        startsOn: dateOf(past.start),
        endsOn: dateOf(past.end),
        targetMinor: 500n,
        targetStatus: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedByUserId: user('owner').userId,
      },
    });
    const response = await confirm('stale', {
      previewHash: previewBody.previewHash,
      transitionTargets: [],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('PREVIEW_STALE');
    expect(await prisma.budgetCycleRevision.count({ where: { budgetId } })).toBe(0);
  });

  it('валидация: чужой periodStart, плохая цель, одинаковые настройки, плохой hash', async () => {
    const budgetId = user('stale').budgetId;
    const previewBody = (await preview('stale', NEW_INPUT)).json<PreviewBody>();
    const base = { previewHash: previewBody.previewHash };
    const wrongStart = await confirm('stale', {
      ...base,
      transitionTargets: [{ periodStart: addIsoDays(previewBody.effectiveOn, 40), target: '10' }],
    });
    expect(wrongStart.statusCode).toBe(400);
    const badTarget = await confirm('stale', {
      ...base,
      transitionTargets: [{ periodStart: previewBody.transitionRanges[0]!.start, target: '-5' }],
    });
    expect(badTarget.statusCode).toBe(400);
    const duplicate = await confirm('stale', {
      ...base,
      transitionTargets: [
        { periodStart: previewBody.transitionRanges[0]!.start, target: '1' },
        { periodStart: previewBody.transitionRanges[0]!.start, target: null },
      ],
    });
    expect(duplicate.statusCode).toBe(400);
    expect((await confirm('stale', { previewHash: 'xyz', transitionTargets: [] })).statusCode).toBe(
      400,
    );
    expect(
      (await preview('stale', { cycleStartDay: 29, periodBoundaryOffset: 14 })).statusCode,
    ).toBe(400);
    const same = await preview('stale', { cycleStartDay: 1, periodBoundaryOffset: 14 });
    expect(same.statusCode).toBe(422);
    expect(same.json<{ code: string }>().code).toBe('CYCLE_SETTINGS_UNCHANGED');
    expect(await prisma.budgetCycleRevision.count({ where: { budgetId } })).toBe(0);
  });

  it('доступ: 401, CSRF, VIEWER/EDITOR 403, чужой бюджет 404', async () => {
    const url = `/api/v2/budgets/${user('owner').budgetId}/cycle-change/preview`;
    const unauth = await server.inject({
      method: 'POST',
      url,
      headers: { origin },
      payload: NEW_INPUT,
    });
    expect(unauth.statusCode).toBe(401);
    const noCsrf = await server.inject({
      method: 'POST',
      url,
      headers: authHeaders(user('owner')),
      payload: NEW_INPUT,
    });
    expect(noCsrf.statusCode).toBe(403);
    for (const role of ['viewer', 'editor'] as const) {
      const response = await preview('owner', NEW_INPUT, user(role));
      expect(response.statusCode, role).toBe(403);
      const confirmResponse = await confirm(
        'owner',
        { previewHash: 'a'.repeat(64), transitionTargets: [] },
        randomUUID(),
        user(role),
      );
      expect(confirmResponse.statusCode, role).toBe(403);
    }
    expect((await preview('owner', NEW_INPUT, user('outsider'))).statusCode).toBe(404);
    const foreignConfirm = await confirm(
      'owner',
      { previewHash: 'a'.repeat(64), transitionTargets: [] },
      randomUUID(),
      user('outsider'),
    );
    expect(foreignConfirm.statusCode).toBe(404);
    const noKey = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${user('stale').budgetId}/cycle-change/confirm`,
      headers: { ...authHeaders(user('stale')), 'x-csrf-token': user('stale').csrfToken },
      payload: { previewHash: 'a'.repeat(64), transitionTargets: [] },
    });
    expect(noKey.statusCode).toBe(400);
  });

  it('OpenAPI описывает preview и confirm', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = openApi.json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, { properties?: Record<string, { type?: string }> }> };
    }>();
    for (const route of ['preview', 'confirm']) {
      const operation = document.paths[`/api/v2/budgets/{budgetId}/cycle-change/${route}`]?.post;
      expect(operation, route).toBeDefined();
      for (const code of ['200', '400', '401', '403', '404', '409']) {
        expect(operation!.responses[code], `${route} ${code}`).toBeDefined();
      }
    }
    expect(
      document.components.schemas.CycleChangePreviewResponse?.properties?.previewHash?.type,
    ).toBe('string');
    expect(
      document.components.schemas.CycleChangeConfirmRequest?.properties?.previewHash?.type,
    ).toBe('string');
  });
});

afterAll(async () => {
  for (const name of names) await cleanupUser(ctx[name]?.userId ?? '');
  await app.close();
  await prisma.$disconnect();
});

async function snapshot(budgetId: string) {
  return {
    periods: await prisma.envelopePeriod.count({ where: { budgetId } }),
    revisions: await prisma.budgetCycleRevision.count({ where: { budgetId } }),
    audit: await prisma.auditEvent.count({ where: { budgetId } }),
  };
}

function authHeaders(who: RegisteredUser | undefined): Record<string, string> {
  return { origin, cookie: `harmofin_session=${who?.cookie ?? ''}` };
}

function preview(
  name: Name,
  payload: Record<string, unknown>,
  as: RegisteredUser | undefined = ctx[name],
) {
  return server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${user(name).budgetId}/cycle-change/preview`,
    headers: { ...authHeaders(as), 'x-csrf-token': as?.csrfToken ?? '' },
    payload,
  });
}

function confirm(
  name: Name,
  payload: Record<string, unknown>,
  key: string = randomUUID(),
  as: RegisteredUser | undefined = ctx[name],
) {
  return server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${user(name).budgetId}/cycle-change/confirm`,
    headers: { ...authHeaders(as), 'x-csrf-token': as?.csrfToken ?? '', 'idempotency-key': key },
    payload: { ...NEW_INPUT, ...payload },
  });
}

function envelopeData(
  budgetId: string,
  ownerUserId: string,
  name: string,
  periodSlot: 'FIRST' | 'SECOND',
) {
  return {
    id: randomUUID(),
    budgetId,
    ownerUserId,
    name,
    envelopeType: 'CURRENT_EXPENSES' as const,
    startingBalanceMinor: 0n,
    displayOrder: 950,
    periodSlot,
  };
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
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    await prisma.transaction.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
