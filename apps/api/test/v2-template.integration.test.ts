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

const names = [
  'empty',
  'renamed',
  'archived',
  'collision',
  'outsider',
  'viewer',
  'editor',
  'legacy',
] as const;
type Name = (typeof names)[number];
const emails = Object.fromEntries(
  names.map((name) => [name, `v2-tpl-${name}-${randomUUID()}@harmofin.test`]),
) as Record<Name, string>;

type RegisteredUser = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};
type EnvelopeRow = {
  role: 'FIRST' | 'SECOND' | 'MANDATORY' | 'SAVINGS';
  templateKey: string;
  name: string;
  type: string;
  periodSlot: string | null;
  status: 'EXISTING' | 'MISSING' | 'ARCHIVED' | 'COLLISION';
  matchedBy: 'KEY' | 'NAME' | null;
  existingId: string | null;
  existingName: string | null;
  archivedId: string | null;
  collisionId: string | null;
  suggestedAction: 'CREATE' | 'ADOPT' | 'SKIP';
  requiresConsent: boolean;
  replacementTemplateKey: string | null;
  selectable: boolean;
  suggestedRuleType: string;
  existingRuleType: string | null;
  suggestedTargetMinor: string | null;
};
type CategoryRow = {
  templateKey: string;
  name: string;
  categoryType: string;
  status: 'EXISTING' | 'MISSING' | 'ARCHIVED' | 'COLLISION';
  existingId: string | null;
};
type PreviewBody = {
  cycle: { cycleStartDay: number; periodBoundaryOffset: number };
  categories: CategoryRow[];
  envelopes: EnvelopeRow[];
  previewHash: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const ctx: Partial<Record<Name, RegisteredUser>> = {};
const user = (name: Name) => ctx[name]!;

describe('v2 reference-template preview (R05)', () => {
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
    for (const name of ['empty', 'renamed', 'archived', 'collision', 'outsider'] as const) {
      await prisma.budget.update({
        where: { id: user(name).budgetId },
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
          workspaceId: user('empty').workspaceId,
          userId: user(key).userId,
          role,
        },
      });
    }
  });

  it('пустой бюджет: предлагает FIRST/SECOND/mandatory, без FREE_MONEY и без записи', async () => {
    const budgetId = user('empty').budgetId;
    const before = {
      envelopes: await prisma.envelope.count({ where: { budgetId } }),
      categories: await prisma.category.count({ where: { budgetId } }),
      rules: await prisma.envelopeFundingRule.count({ where: { budgetId } }),
      periods: await prisma.envelopePeriod.count({ where: { budgetId } }),
      audit: await prisma.auditEvent.count({ where: { budgetId } }),
    };
    const response = await preview('empty');
    expect(response.statusCode).toBe(200);
    const body = response.json<PreviewBody>();
    expect(body.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.cycle).toEqual({ cycleStartDay: 1, periodBoundaryOffset: 14 });
    const roles = (role: string) => body.envelopes.filter((row) => row.role === role);
    for (const role of ['FIRST', 'SECOND', 'MANDATORY']) {
      expect(roles(role)).toHaveLength(1);
      expect(roles(role)[0]).toMatchObject({
        status: 'MISSING',
        suggestedAction: 'CREATE',
        existingId: null,
        requiresConsent: false,
        selectable: false,
        suggestedTargetMinor: null,
      });
    }
    expect(roles('FIRST')[0]).toMatchObject({
      type: 'CURRENT_EXPENSES',
      periodSlot: 'FIRST',
      name: 'Первый период',
    });
    expect(roles('SECOND')[0]).toMatchObject({ type: 'CURRENT_EXPENSES', periodSlot: 'SECOND' });
    expect(roles('MANDATORY')[0]).toMatchObject({
      type: 'MANDATORY_EXPENSES',
      periodSlot: null,
    });
    expect(roles('SAVINGS').length).toBeGreaterThan(0);
    for (const row of roles('SAVINGS')) {
      expect(row).toMatchObject({ selectable: true, type: 'SAVINGS_GOAL', status: 'MISSING' });
    }
    expect(body.envelopes.some((row) => row.type === 'FREE_MONEY')).toBe(false);
    expect(new Set(body.envelopes.map((row) => row.templateKey)).size).toBe(body.envelopes.length);
    expect(body.categories.length).toBeGreaterThan(10);
    expect(body.categories.every((row) => row.status === 'MISSING')).toBe(true);

    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(0);
    expect(await prisma.category.count({ where: { budgetId } })).toBe(before.categories);
    expect(await prisma.envelopeFundingRule.count({ where: { budgetId } })).toBe(before.rules);
    expect(await prisma.envelopePeriod.count({ where: { budgetId } })).toBe(before.periods);
    expect(await prisma.auditEvent.count({ where: { budgetId } })).toBe(before.audit);
    expect(before.envelopes).toBe(0);
  });

  it('переименованный ключевой конверт остаётся как есть; совместимый по имени принимается без ключа', async () => {
    const budgetId = user('renamed').budgetId;
    const first = await prisma.envelope.create({
      data: envelopeData(budgetId, 'Утренний', 'CURRENT_EXPENSES', 'FIRST', 'v2-period-first'),
    });
    const mandatory = await prisma.envelope.create({
      data: envelopeData(budgetId, 'обязательные', 'MANDATORY_EXPENSES', null, null),
    });
    await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId,
        name: 'Продукты',
        categoryType: 'EXPENSE',
        templateKey: 'expense-groceries',
        displayOrder: 1,
      },
    });
    const body = (await preview('renamed')).json<PreviewBody>();
    const row = (role: string) => body.envelopes.find((item) => item.role === role)!;
    expect(row('FIRST')).toMatchObject({
      status: 'EXISTING',
      matchedBy: 'KEY',
      existingId: first.id,
      existingName: 'Утренний',
      suggestedAction: 'ADOPT',
      requiresConsent: false,
    });
    expect(row('MANDATORY')).toMatchObject({
      status: 'EXISTING',
      matchedBy: 'NAME',
      existingId: mandatory.id,
      suggestedAction: 'ADOPT',
    });
    expect(row('SECOND').status).toBe('MISSING');
    expect(body.categories.find((item) => item.templateKey === 'expense-groceries')).toMatchObject({
      status: 'EXISTING',
    });
    // "any category created" does not make the template complete.
    expect(body.categories.some((item) => item.status === 'MISSING')).toBe(true);
    const stored = await prisma.envelope.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.name).toBe('Утренний');
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(2);
  });

  it('архивный ключевой конверт: ARCHIVED, замена только CREATE по согласию с детерминированным ключом', async () => {
    const budgetId = user('archived').budgetId;
    const archived = await prisma.envelope.create({
      data: {
        ...envelopeData(budgetId, 'Обязательные', 'MANDATORY_EXPENSES', null, 'v2-mandatory'),
        archivedAt: new Date(),
      },
    });
    const body = (await preview('archived')).json<PreviewBody>();
    const row = body.envelopes.find((item) => item.role === 'MANDATORY')!;
    expect(row).toMatchObject({
      status: 'ARCHIVED',
      archivedId: archived.id,
      existingId: null,
      suggestedAction: 'CREATE',
      requiresConsent: true,
      replacementTemplateKey: `v2-replacement-mandatory-${archived.id}`,
    });
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(1);
  });

  it('то же имя с несовместимым типом: COLLISION, не молчаливое принятие', async () => {
    const budgetId = user('collision').budgetId;
    const clash = await prisma.envelope.create({
      data: envelopeData(budgetId, 'Первый период', 'SAVINGS_GOAL', null, null),
    });
    await prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId,
        name: 'Продукты',
        categoryType: 'INCOME',
        displayOrder: 1,
      },
    });
    const body = (await preview('collision')).json<PreviewBody>();
    const row = body.envelopes.find((item) => item.role === 'FIRST')!;
    expect(row).toMatchObject({
      status: 'COLLISION',
      collisionId: clash.id,
      existingId: null,
      suggestedAction: 'SKIP',
    });
    expect(body.categories.find((item) => item.templateKey === 'expense-groceries')).toMatchObject({
      status: 'COLLISION',
    });
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(1);
  });

  it('previewHash стабилен без изменений и меняется при изменении элемента, правила или настройки', async () => {
    const budgetId = user('empty').budgetId;
    const hash = async () => (await preview('empty')).json<PreviewBody>().previewHash;
    const base = await hash();
    expect(await hash()).toBe(base);

    const category = await prisma.category.create({
      data: { id: randomUUID(), budgetId, name: 'Новая', categoryType: 'EXPENSE', displayOrder: 1 },
    });
    const withCategory = await hash();
    expect(withCategory).not.toBe(base);
    await prisma.category.update({ where: { id: category.id }, data: { name: 'Новая 2' } });
    const renamed = await hash();
    expect(renamed).not.toBe(withCategory);

    const envelope = await prisma.envelope.create({
      data: envelopeData(budgetId, 'Мой', 'CUSTOM', null, null),
    });
    const withEnvelope = await hash();
    expect(withEnvelope).not.toBe(renamed);
    await prisma.envelopeFundingRule.create({
      data: {
        id: randomUUID(),
        budgetId,
        envelopeId: envelope.id,
        type: 'MANUAL',
        priority: 5,
        createdByUserId: user('empty').userId,
        updatedByUserId: user('empty').userId,
      },
    });
    const withRule = await hash();
    expect(withRule).not.toBe(withEnvelope);

    await prisma.budget.update({ where: { id: budgetId }, data: { cycleStartDay: 5 } });
    const withCycle = await hash();
    expect(withCycle).not.toBe(withRule);
    expect((await preview('empty')).json<PreviewBody>().cycle.cycleStartDay).toBe(5);
    await prisma.budget.update({ where: { id: budgetId }, data: { cycleStartDay: 1 } });
    expect(await hash()).toBe(withRule);
  });

  it('изоляция бюджетов: чужие конверты не влияют, чужой бюджет недоступен', async () => {
    await prisma.envelope.create({
      data: envelopeData(
        user('outsider').budgetId,
        'Первый период',
        'CURRENT_EXPENSES',
        'FIRST',
        'v2-period-first',
      ),
    });
    const body = (await preview('archived')).json<PreviewBody>();
    expect(body.envelopes.find((item) => item.role === 'FIRST')!.status).toBe('MISSING');
    const foreign = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${user('outsider').budgetId}/reference-template/preview`,
      headers: authHeaders(user('empty')),
    });
    expect(foreign.statusCode).toBe(404);
    const missing = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${randomUUID()}/reference-template/preview`,
      headers: authHeaders(user('empty')),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('доступ: VIEWER/EDITOR 403 (OWNER-only), без сессии 401, не uuid 400, v1 бюджет 409', async () => {
    expect((await preview('empty', user('viewer'))).statusCode).toBe(403);
    expect((await preview('empty', user('editor'))).statusCode).toBe(403);
    const url = `/api/v2/budgets/${user('empty').budgetId}/reference-template/preview`;
    expect((await server.inject({ method: 'GET', url, headers: { origin } })).statusCode).toBe(401);
    const bad = await server.inject({
      method: 'GET',
      url: '/api/v2/budgets/not-a-uuid/reference-template/preview',
      headers: authHeaders(user('empty')),
    });
    expect(bad.statusCode).toBe(400);
    const legacy = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${user('legacy').budgetId}/reference-template/preview`,
      headers: authHeaders(user('legacy')),
    });
    expect(legacy.statusCode).toBe(409);
    expect(legacy.json<{ code: string }>().code).toBe('MODEL_VERSION_MISMATCH');
  });

  it('OpenAPI описывает GET preview, коды ошибок и cookie-сессию', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = openApi.json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, { properties?: Record<string, { type?: string }> }> };
    }>();
    const operation = document.paths['/api/v2/budgets/{budgetId}/reference-template/preview']?.get;
    expect(operation).toBeDefined();
    for (const code of ['200', '400', '401', '403', '404', '409']) {
      expect(operation!.responses[code], code).toBeDefined();
    }
    expect(JSON.stringify(operation)).toContain('session');
    const schema = document.components.schemas.TemplatePreviewResponse;
    expect(schema?.properties?.previewHash?.type).toBe('string');
  });
});

afterAll(async () => {
  for (const name of names) await cleanupUser(ctx[name]?.userId ?? '');
  await app.close();
  await prisma.$disconnect();
});

function authHeaders(who: RegisteredUser | undefined): Record<string, string> {
  return { origin, cookie: `harmofin_session=${who?.cookie ?? ''}` };
}

function preview(name: Name, as: RegisteredUser | undefined = ctx[name]) {
  return server.inject({
    method: 'GET',
    url: `/api/v2/budgets/${user(name).budgetId}/reference-template/preview`,
    headers: authHeaders(as),
  });
}

function envelopeData(
  budgetId: string,
  name: string,
  envelopeType: 'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'SAVINGS_GOAL' | 'CUSTOM',
  periodSlot: 'FIRST' | 'SECOND' | null,
  templateKey: string | null,
) {
  return {
    id: randomUUID(),
    budgetId,
    name,
    envelopeType,
    startingBalanceMinor: 0n,
    displayOrder: 950,
    periodSlot,
    templateKey,
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
