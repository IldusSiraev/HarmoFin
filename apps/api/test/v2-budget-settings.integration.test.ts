import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { addIsoDays, todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { forceBudgetV1 } from './helpers/plan-model.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

const names = ['owner', 'fact', 'target', 'outsider', 'viewer', 'editor', 'legacy'] as const;
type Name = (typeof names)[number];
const emails = Object.fromEntries(
  names.map((name) => [name, `v2-settings-${name}-${randomUUID()}@harmofin.test`]),
) as Record<Name, string>;

type RegisteredUser = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};
type SettingsBody = {
  id: string;
  name: string;
  timezone: string;
  allowNegativeAccountBalance: boolean;
  cycleStartDay: number;
  periodBoundaryOffset: number;
  planModelVersion: number;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const ctx: Partial<Record<Name, RegisteredUser>> = {};
const user = (name: Name) => ctx[name]!;

const today = todayInTimezone(new Date(), 'UTC');
const dateOf = (value: string) => new Date(`${value}T00:00:00.000Z`);
const state: { accountId?: string; envelopeId?: string } = {};

describe('v2 budget settings (T02b)', () => {
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
    for (const name of ['owner', 'fact', 'target', 'outsider'] as const) {
      await prisma.budget.update({
        where: { id: user(name).budgetId },
        data: {
          planModelVersion: 2,
          planModelActivatedOn: dateOf(addIsoDays(today, -60)),
          timezone: 'UTC',
          cycleStartDay: 1,
          periodBoundaryOffset: 14,
          allowNegativeBalance: true,
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

    // owner: what a single dashboard view leaves behind (UNSET + DRAFT periods) and cash.
    const ownerBudget = user('owner').budgetId;
    state.accountId = (await prisma.account.create({ data: accountData(ownerBudget, 123456n) })).id;
    const envelope = await prisma.envelope.create({
      data: { ...envelopeData(ownerBudget, 'Первый', 'FIRST'), startingBalanceMinor: -5000n },
    });
    state.envelopeId = envelope.id;
    for (const [index, status] of (['UNSET', 'DRAFT'] as const).entries()) {
      const start = addIsoDays(today, index * 20);
      await prisma.envelopePeriod.create({
        data: {
          id: randomUUID(),
          budgetId: ownerBudget,
          envelopeId: envelope.id,
          startsOn: dateOf(start),
          endsOn: dateOf(addIsoDays(start, 9)),
          targetStatus: status,
          ...(status === 'DRAFT' ? { targetMinor: 100000n } : {}),
        },
      });
    }

    // fact: a CONFIRMED transaction fixes the calendar.
    const factBudget = user('fact').budgetId;
    const factAccount = await prisma.account.create({ data: accountData(factBudget, 0n) });
    const category = await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId: factBudget,
        name: `Расход ${randomUUID()}`,
        categoryType: 'EXPENSE',
        displayOrder: 990,
      },
    });
    const factEnvelope = await prisma.envelope.create({
      data: envelopeData(factBudget, 'Первый', 'FIRST'),
    });
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        budgetId: factBudget,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: 12345n,
        occurredOn: dateOf(addIsoDays(today, -5)),
        accountId: factAccount.id,
        categoryId: category.id,
        envelopeId: factEnvelope.id,
        confirmedAt: new Date(),
        createdByUserId: user('fact').userId,
        updatedByUserId: user('fact').userId,
      },
    });

    // target: a CONFIRMED period target fixes the calendar; an UNSET row must survive too.
    const targetBudget = user('target').budgetId;
    const targetEnvelope = await prisma.envelope.create({
      data: envelopeData(targetBudget, 'Первый', 'FIRST'),
    });
    await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId: targetBudget,
        envelopeId: targetEnvelope.id,
        startsOn: dateOf(addIsoDays(today, -40)),
        endsOn: dateOf(addIsoDays(today, -31)),
        targetMinor: 1000000n,
        targetStatus: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedByUserId: user('target').userId,
      },
    });
    await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId: targetBudget,
        envelopeId: targetEnvelope.id,
        startsOn: dateOf(today),
        endsOn: dateOf(addIsoDays(today, 9)),
        targetStatus: 'UNSET',
      },
    });
  });

  afterAll(async () => {
    for (const name of names) await cleanupUser(ctx[name]?.userId ?? '');
    await prisma.$disconnect();
    await app?.close();
  });

  it('403: VIEWER и EDITOR не меняют настройки', async () => {
    const budgetId = user('owner').budgetId;
    for (const name of ['viewer', 'editor'] as const) {
      const response = await patch('owner', { name: 'Чужое имя' }, randomUUID(), ctx[name]);
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
    }
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })).name).not.toBe(
      'Чужое имя',
    );
  });

  it('404: чужой бюджет; 409 MODEL_VERSION_MISMATCH для v1; 401 без сессии', async () => {
    expect((await patch('owner', { name: 'X' }, randomUUID(), ctx.outsider)).statusCode).toBe(404);
    const legacy = await patch('legacy', { name: 'X' });
    expect(legacy.statusCode).toBe(409);
    expect(legacy.json<{ code: string }>().code).toBe('MODEL_VERSION_MISMATCH');
    const anonymous = await server.inject({
      method: 'PATCH',
      url: `/api/v2/budgets/${user('owner').budgetId}/settings`,
      headers: { origin },
      payload: { name: 'X' },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('400/403: пустое тело, неизвестное поле, неверная зона, нет ключа, нет CSRF', async () => {
    for (const payload of [{}, { cycleStartDay: 5 }, { timezone: 'Mars/Phobos' }, { name: '  ' }]) {
      expect((await patch('owner', payload)).statusCode).toBe(400);
    }
    const noKey = await server.inject({
      method: 'PATCH',
      url: `/api/v2/budgets/${user('owner').budgetId}/settings`,
      headers: { ...authHeaders(user('owner')), 'x-csrf-token': user('owner').csrfToken },
      payload: { name: 'X' },
    });
    expect(noKey.statusCode).toBe(400);
    const noCsrf = await server.inject({
      method: 'PATCH',
      url: `/api/v2/budgets/${user('owner').budgetId}/settings`,
      headers: { ...authHeaders(user('owner')), 'idempotency-key': randomUUID() },
      payload: { name: 'X' },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('имя и allowNegativeAccountBalance меняются без перепланирования; конверт в минусе цел', async () => {
    const budgetId = user('owner').budgetId;
    const periodsBefore = await prisma.envelopePeriod.findMany({
      where: { budgetId },
      orderBy: { id: 'asc' },
    });
    const response = await patch('owner', {
      name: 'Новое имя',
      allowNegativeAccountBalance: false,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<SettingsBody>()).toMatchObject({
      id: budgetId,
      name: 'Новое имя',
      allowNegativeAccountBalance: false,
      timezone: 'UTC',
      planModelVersion: 2,
    });
    const periodsAfter = await prisma.envelopePeriod.findMany({
      where: { budgetId },
      orderBy: { id: 'asc' },
    });
    expect(periodsAfter).toEqual(periodsBefore);
    const envelope = await prisma.envelope.findUniqueOrThrow({ where: { id: state.envelopeId! } });
    expect(envelope.startingBalanceMinor).toBe(-5000n);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { budgetId, entityType: 'budget', action: 'UPDATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.newValues).toMatchObject({
      name: 'Новое имя',
      allowNegativeAccountBalance: false,
    });
    expect(audit.oldValues).toMatchObject({ allowNegativeAccountBalance: true });
  });

  it('timezone: только UNSET/DRAFT периоды — смена проходит, cash цел', async () => {
    const budgetId = user('owner').budgetId;
    const response = await patch('owner', { timezone: 'Asia/Yekaterinburg' });
    expect(response.statusCode).toBe(200);
    expect(response.json<SettingsBody>().timezone).toBe('Asia/Yekaterinburg');
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    expect(budget.timezone).toBe('Asia/Yekaterinburg');
    expect(budget.cycleStartDay).toBe(1);
    expect(await prisma.envelopePeriod.count({ where: { budgetId } })).toBe(0);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: state.accountId! } });
    expect(account.startingBalanceMinor).toBe(123456n);
  });

  it('replay с тем же ключом идемпотентен, другой запрос с ключом — 409', async () => {
    const budgetId = user('owner').budgetId;
    const key = randomUUID();
    const first = await patch('owner', { name: 'Повтор' }, key);
    const second = await patch('owner', { name: 'Повтор' }, key);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    const countAudits = () =>
      prisma.auditEvent.count({ where: { budgetId, entityType: 'budget', action: 'UPDATED' } });
    const audits = await countAudits();
    const conflicting = await patch('owner', { name: 'Другое' }, key);
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await countAudits()).toBe(audits);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })).name).toBe(
      'Повтор',
    );
  });

  it('подтверждённый факт блокирует смену timezone: 409, ничего не меняется', async () => {
    const budgetId = user('fact').budgetId;
    const before = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    const response = await patch('fact', { timezone: 'Asia/Tokyo', name: 'Не должно' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('TIMEZONE_CHANGE_REQUIRES_RECONCILIATION');
    const after = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    expect(after.timezone).toBe(before.timezone);
    expect(after.name).toBe(before.name);
  });

  it('CONFIRMED цель блокирует смену timezone: периоды прежние', async () => {
    const budgetId = user('target').budgetId;
    const before = await prisma.envelopePeriod.findMany({
      where: { budgetId },
      orderBy: { id: 'asc' },
    });
    const response = await patch('target', { timezone: 'Asia/Tokyo' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('TIMEZONE_CHANGE_REQUIRES_RECONCILIATION');
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })).timezone).toBe(
      'UTC',
    );
    expect(
      await prisma.envelopePeriod.findMany({ where: { budgetId }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
  });

  it('при заблокированной зоне имя меняется, если timezone совпадает с текущей', async () => {
    const response = await patch('fact', { name: 'Имя без зоны', timezone: 'UTC' });
    expect(response.statusCode).toBe(200);
    expect(response.json<SettingsBody>().name).toBe('Имя без зоны');
  });

  it('OpenAPI: PATCH settings описывает 200/400/401/403/404/409 и Idempotency-Key', async () => {
    const response = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    const spec = response.json<{
      paths: Record<
        string,
        Record<string, { responses: Record<string, unknown>; parameters?: Array<{ name: string }> }>
      >;
    }>();
    const operation = spec.paths['/api/v2/budgets/{budgetId}/settings']?.patch;
    expect(operation).toBeDefined();
    for (const code of ['200', '400', '401', '403', '404', '409']) {
      expect(operation!.responses[code]).toBeDefined();
    }
    expect(operation!.parameters?.some((parameter) => parameter.name === 'Idempotency-Key')).toBe(
      true,
    );
  });
});

function authHeaders(who: RegisteredUser | undefined): Record<string, string> {
  return { origin, cookie: `harmofin_session=${who?.cookie ?? ''}` };
}

function patch(
  name: Name,
  payload: Record<string, unknown>,
  key: string = randomUUID(),
  as: RegisteredUser | undefined = ctx[name],
) {
  return server.inject({
    method: 'PATCH',
    url: `/api/v2/budgets/${user(name).budgetId}/settings`,
    headers: { ...authHeaders(as), 'x-csrf-token': as?.csrfToken ?? '', 'idempotency-key': key },
    payload,
  });
}

function accountData(budgetId: string, startingBalanceMinor: bigint) {
  return {
    id: randomUUID(),
    budgetId,
    name: 'Основной',
    accountType: 'BANK_CARD' as const,
    startingBalanceMinor,
    accountingStartDate: dateOf(addIsoDays(today, -60)),
  };
}

function envelopeData(budgetId: string, name: string, periodSlot: 'FIRST' | 'SECOND') {
  return {
    id: randomUUID(),
    budgetId,
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
  await forceBudgetV1(prisma, body.budget.id);
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
