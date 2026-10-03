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
  'applyClean',
  'applySkip',
  'applyOther',
  'applyParallel',
  'applyWrongType',
  'applyArchived',
  'applyCycle',
  'applyHistory',
  'slotOtherName',
  'slotSameName',
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

describe('v2 reference-template preview and apply (R05, R06)', () => {
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
    for (const name of [
      'empty',
      'renamed',
      'archived',
      'collision',
      'outsider',
      'applyClean',
      'applySkip',
      'applyOther',
      'applyParallel',
      'applyWrongType',
      'applyArchived',
      'applyCycle',
      'applyHistory',
      'slotOtherName',
      'slotSameName',
    ] as const) {
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

  it('доступ: VIEWER/EDITOR 403 (OWNER-only), без сессии 401, не uuid 400', async () => {
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
  });

  it('apply без конфликтов: категории, 2 периода, обязательные, правила; без денег и FREE_MONEY', async () => {
    const who = 'applyClean';
    const budgetId = user(who).budgetId;
    const auditBefore = await prisma.auditEvent.count({ where: { budgetId } });
    const body = await previewOf(who);
    const response = await apply(who, {
      ...defaultApply(body),
      periods: [
        { role: 'FIRST', action: 'CREATE', target: null },
        { role: 'SECOND', action: 'CREATE', target: '12000.50' },
      ],
      savings: [{ name: 'Автомобиль', requestedContribution: '5000' }],
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<ApplyBody>();
    expect(result.isComplete).toBe(true);
    expect(result.created.envelopes.map((row) => row.role).sort()).toEqual([
      'FIRST',
      'MANDATORY',
      'SAVINGS',
      'SECOND',
    ]);
    expect(await prisma.category.count({ where: { budgetId } })).toBe(body.categories.length);
    const envelopes = await prisma.envelope.findMany({ where: { budgetId } });
    expect(envelopes).toHaveLength(4);
    expect(envelopes.every((row) => row.startingBalanceMinor === 0n)).toBe(true);
    expect(envelopes.some((row) => row.name === 'Отпуск')).toBe(false);
    expect(await prisma.envelope.count({ where: { budgetId, envelopeType: 'FREE_MONEY' } })).toBe(
      0,
    );
    const ruleOf = async (key: string) => {
      const envelope = envelopes.find((row) => row.templateKey === key)!;
      return prisma.envelopeFundingRule.findFirstOrThrow({
        where: { budgetId, envelopeId: envelope.id },
      });
    };
    expect(await ruleOf('v2-period-first')).toMatchObject({ type: 'MANUAL', priority: 20 });
    expect(await ruleOf('v2-period-second')).toMatchObject({
      type: 'FIXED_PER_PERIOD',
      fixedMinor: 1_200_050n,
      priority: 30,
    });
    expect(await ruleOf('v2-mandatory')).toMatchObject({ type: 'SUM_OF_PLANS', priority: 10 });
    expect(await ruleOf('v2-savings-car')).toMatchObject({
      type: 'SUGGESTED_FIXED',
      fixedMinor: 500_000n,
    });
    expect(await prisma.envelopeFundingRule.count({ where: { budgetId } })).toBe(4);
    expect(await prisma.envelopePeriod.count({ where: { budgetId } })).toBe(0);
    expect(await prisma.account.count({ where: { budgetId } })).toBe(0);
    expect(await prisma.transaction.count({ where: { budgetId } })).toBe(0);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId } })).toBe(0);
    expect(await prisma.envelopeMovement.count({ where: { budgetId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { budgetId } })).toBe(auditBefore + 1);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { budgetId, entityType: 'reference_template' },
    });
    expect(JSON.stringify(audit.newValues)).not.toContain('12000');
  });

  it('тот же ключ возвращает тот же результат; другой ключ добавляет только недостающее', async () => {
    const who = 'applyClean';
    const budgetId = user(who).budgetId;
    const body = await previewOf(who);
    const first = await apply(who, { ...defaultApply(body), savings: [] }, 'same-key-1');
    expect(first.statusCode).toBe(200);
    const replay = await apply(who, { ...defaultApply(body), savings: [] }, 'same-key-1');
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(4);
    const auditCount = await prisma.auditEvent.count({
      where: { budgetId, entityType: 'reference_template' },
    });

    const fresh = await previewOf(who);
    const other = await apply(
      who,
      { ...defaultApply(fresh), savings: [{ name: 'Отпуск' }] },
      'other-key-1',
    );
    expect(other.statusCode).toBe(200);
    const created = other.json<ApplyBody>().created;
    expect(created.categories).toHaveLength(0);
    expect(created.envelopes.map((row) => row.name)).toEqual(['Отпуск']);
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(5);
    expect(await prisma.envelopeFundingRule.count({ where: { budgetId } })).toBe(5);
    expect(
      await prisma.auditEvent.count({ where: { budgetId, entityType: 'reference_template' } }),
    ).toBe(auditCount + 1);
  });

  it('принятый конверт без правила получает правило; существующие правило, приоритет, цель и имя не меняются', async () => {
    const who = 'applyOther';
    const budgetId = user(who).budgetId;
    const first = await prisma.envelope.create({
      data: envelopeData(budgetId, 'Утренний', 'CURRENT_EXPENSES', 'FIRST', 'v2-period-first'),
    });
    await prisma.envelopeFundingRule.create({
      data: {
        id: randomUUID(),
        budgetId,
        envelopeId: first.id,
        type: 'MANUAL',
        priority: 77,
        createdByUserId: user(who).userId,
        updatedByUserId: user(who).userId,
      },
    });
    const period = await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId,
        envelopeId: first.id,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-01-14T00:00:00.000Z'),
        targetMinor: 100_000n,
        targetStatus: 'DRAFT',
      },
    });
    const mandatory = await prisma.envelope.create({
      data: envelopeData(budgetId, 'Обязательные', 'MANDATORY_EXPENSES', null, null),
    });
    const body = await previewOf(who);
    const response = await apply(who, {
      ...defaultApply(body),
      periods: [
        { role: 'FIRST', action: 'ADOPT', target: '999' },
        { role: 'SECOND', action: 'CREATE', target: null },
      ],
    });
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json<ApplyBody>()
        .adopted.map((row) => row.id)
        .sort(),
    ).toEqual([first.id, mandatory.id].sort());
    const rules = await prisma.envelopeFundingRule.findMany({
      where: { budgetId, envelopeId: first.id },
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ type: 'MANUAL', priority: 77, fixedMinor: null });
    const added = await prisma.envelopeFundingRule.findMany({
      where: { budgetId, envelopeId: mandatory.id },
    });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: 'SUM_OF_PLANS', priority: 10 });
    const storedPeriod = await prisma.envelopePeriod.findUniqueOrThrow({
      where: { id: period.id },
    });
    expect(storedPeriod).toMatchObject({ targetMinor: 100_000n, targetStatus: 'DRAFT' });
    expect((await prisma.envelope.findUniqueOrThrow({ where: { id: first.id } })).name).toBe(
      'Утренний',
    );
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(3);

    // A different key with a fresh preview adds nothing and still keeps the set target.
    const again = await apply(who, defaultApply(await previewOf(who)), 'other-key-2');
    expect(again.statusCode).toBe(200);
    expect(again.json<ApplyBody>().created.envelopes).toHaveLength(0);
    expect(await prisma.envelopeFundingRule.count({ where: { budgetId } })).toBe(3);
    expect(
      (await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: period.id } })).targetMinor,
    ).toBe(100_000n);
  });

  it('конфликт с SKIP не создаёт дубль и оставляет шаг незавершённым; коллизия требует новое имя или SKIP', async () => {
    const who = 'applySkip';
    const budgetId = user(who).budgetId;
    const clash = await prisma.envelope.create({
      data: envelopeData(budgetId, 'Первый период', 'SAVINGS_GOAL', null, null),
    });
    const body = await previewOf(who);
    const base = defaultApply(body);
    const withFirst = (period: Record<string, unknown>) => ({
      ...base,
      periods: [period, { role: 'SECOND', action: 'CREATE', target: null }],
    });
    const noName = await apply(who, withFirst({ role: 'FIRST', action: 'CREATE' }));
    expect(noName.statusCode).toBe(422);
    const sameName = await apply(
      who,
      withFirst({ role: 'FIRST', action: 'CREATE', name: ' первый период ' }),
    );
    expect(sameName.statusCode).toBe(422);
    const adopt = await apply(who, withFirst({ role: 'FIRST', action: 'ADOPT' }));
    expect(adopt.statusCode).toBe(422);
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(1);

    const skipped = await apply(who, withFirst({ role: 'FIRST', action: 'SKIP' }));
    expect(skipped.statusCode).toBe(200);
    const result = skipped.json<ApplyBody>();
    expect(result.isComplete).toBe(false);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ kind: 'ENVELOPE', role: 'FIRST', reason: 'COLLISION' }),
    );
    expect(await prisma.envelope.count({ where: { budgetId, name: 'Первый период' } })).toBe(1);
    expect(
      (await prisma.envelope.findUniqueOrThrow({ where: { id: clash.id } })).envelopeType,
    ).toBe('SAVINGS_GOAL');
    expect(await prisma.envelope.count({ where: { budgetId, periodSlot: 'FIRST' } })).toBe(0);
  });

  it('слот периода занят активным конвертом без ключа с другим именем: COLLISION, apply не падает 500', async () => {
    // Регрессия бага C05: мигрированный v1-конверт CURRENT_EXPENSES в слоте FIRST без template_key
    // показывался как MISSING/CREATE, а apply падал 500 на envelopes_active_period_slot_key.
    const who = 'slotOtherName';
    const budgetId = user(who).budgetId;
    const holder = await prisma.envelope.create({
      data: envelopeData(budgetId, 'Текущие 10-24', 'CURRENT_EXPENSES', 'FIRST', null),
    });
    const body = await previewOf(who);
    expect(body.envelopes.find((item) => item.role === 'FIRST')).toMatchObject({
      status: 'COLLISION',
      collisionId: holder.id,
      existingId: null,
      suggestedAction: 'SKIP',
    });
    const base = defaultApply(body);
    const withFirst = (period: Record<string, unknown>) => ({
      ...base,
      periods: [period, { role: 'SECOND', action: 'CREATE' }],
    });
    for (const period of [
      { role: 'FIRST', action: 'CREATE' },
      { role: 'FIRST', action: 'CREATE', name: 'Утренний' },
      { role: 'FIRST', action: 'ADOPT' },
    ]) {
      const rejected = await apply(who, withFirst(period));
      expect(rejected.statusCode).toBe(422);
    }
    expect(await prisma.envelope.count({ where: { budgetId, periodSlot: 'FIRST' } })).toBe(1);

    const skipped = await apply(who, withFirst({ role: 'FIRST', action: 'SKIP' }));
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json<ApplyBody>().skipped).toContainEqual(
      expect.objectContaining({ kind: 'ENVELOPE', role: 'FIRST', reason: 'COLLISION' }),
    );
    const stored = await prisma.envelope.findUniqueOrThrow({ where: { id: holder.id } });
    expect(stored).toMatchObject({ name: 'Текущие 10-24', templateKey: null, archivedAt: null });
    expect(await prisma.envelope.count({ where: { budgetId, periodSlot: 'FIRST' } })).toBe(1);
  });

  it('слот периода занят конвертом без ключа с тем же именем: ADOPT, apply принимает без дубля', async () => {
    const who = 'slotSameName';
    const budgetId = user(who).budgetId;
    const holder = await prisma.envelope.create({
      data: envelopeData(budgetId, 'Первый период', 'CURRENT_EXPENSES', 'FIRST', null),
    });
    const body = await previewOf(who);
    expect(body.envelopes.find((item) => item.role === 'FIRST')).toMatchObject({
      status: 'EXISTING',
      matchedBy: 'NAME',
      existingId: holder.id,
      suggestedAction: 'ADOPT',
    });
    const response = await apply(who, defaultApply(body));
    expect(response.statusCode).toBe(200);
    expect(response.json<ApplyBody>().adopted).toContainEqual(
      expect.objectContaining({ id: holder.id, role: 'FIRST' }),
    );
    expect(await prisma.envelope.count({ where: { budgetId, periodSlot: 'FIRST' } })).toBe(1);
  });

  it('коллизия типа: CREATE с новым именем создаёт период с базовым ключом', async () => {
    const who = 'applyWrongType';
    const budgetId = user(who).budgetId;
    await prisma.envelope.create({
      data: envelopeData(budgetId, 'Первый период', 'SAVINGS_GOAL', null, null),
    });
    const body = await previewOf(who);
    const response = await apply(who, {
      ...defaultApply(body),
      periods: [
        { role: 'FIRST', action: 'CREATE', name: 'Утренний' },
        { role: 'SECOND', action: 'CREATE' },
      ],
    });
    expect(response.statusCode).toBe(200);
    const created = await prisma.envelope.findFirstOrThrow({
      where: { budgetId, periodSlot: 'FIRST' },
    });
    expect(created).toMatchObject({ name: 'Утренний', templateKey: 'v2-period-first' });
  });

  it('архивный ключевой конверт заменяется только явным CREATE с детерминированным ключом', async () => {
    const who = 'applyArchived';
    const budgetId = user(who).budgetId;
    const archived = await prisma.envelope.create({
      data: {
        ...envelopeData(budgetId, 'Обязательные', 'MANDATORY_EXPENSES', null, 'v2-mandatory'),
        archivedAt: new Date(),
      },
    });
    const body = await previewOf(who);
    const adopt = await apply(who, { ...defaultApply(body), mandatory: { action: 'ADOPT' } });
    expect(adopt.statusCode).toBe(422);
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(1);
    const response = await apply(who, { ...defaultApply(body), mandatory: { action: 'CREATE' } });
    expect(response.statusCode).toBe(200);
    const replacement = await prisma.envelope.findFirstOrThrow({
      where: { budgetId, archivedAt: null, envelopeType: 'MANDATORY_EXPENSES' },
    });
    expect(replacement.templateKey).toBe(`v2-replacement-mandatory-${archived.id}`);
    expect(
      (await prisma.envelope.findUniqueOrThrow({ where: { id: archived.id } })).archivedAt,
    ).not.toBeNull();
  });

  it('параллельные apply не создают дублей: один применяется, второй 409 PREVIEW_STALE', async () => {
    const who = 'applyParallel';
    const budgetId = user(who).budgetId;
    const body = await previewOf(who);
    const payload = defaultApply(body);
    const results = await Promise.all([apply(who, payload, 'par-1'), apply(who, payload, 'par-2')]);
    expect(results.map((item) => item.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((item) => item.statusCode === 409)!.json<{ code: string }>().code).toBe(
      'PREVIEW_STALE',
    );
    expect(await prisma.envelope.count({ where: { budgetId } })).toBe(3);
    expect(await prisma.envelopeFundingRule.count({ where: { budgetId } })).toBe(3);
    const keys = (await prisma.envelope.findMany({ where: { budgetId } })).map(
      (row) => row.templateKey,
    );
    expect(new Set(keys).size).toBe(3);
  });

  it('смена цикла: на чистом бюджете перестраивает черновики, при истории 409 без записи', async () => {
    const who = 'applyCycle';
    const budgetId = user(who).budgetId;
    const actor = user(who).userId;
    const first = await prisma.envelope.create({
      data: envelopeData(budgetId, 'Первый период', 'CURRENT_EXPENSES', 'FIRST', 'v2-period-first'),
    });
    const second = await prisma.envelope.create({
      data: envelopeData(
        budgetId,
        'Второй период',
        'CURRENT_EXPENSES',
        'SECOND',
        'v2-period-second',
      ),
    });
    for (const envelope of [first, second]) {
      await prisma.envelopeFundingRule.create({
        data: {
          id: randomUUID(),
          budgetId,
          envelopeId: envelope.id,
          type: 'FIXED_PER_PERIOD',
          priority: 20,
          fixedMinor: 10_000n,
          createdByUserId: actor,
          updatedByUserId: actor,
        },
      });
    }
    const stale = await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId,
        envelopeId: first.id,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-01-14T00:00:00.000Z'),
        targetMinor: 10_000n,
        targetStatus: 'DRAFT',
      },
    });
    const body = await previewOf(who);
    const response = await apply(who, {
      ...defaultApply(body),
      cycle: { startDay: 5, boundaryOffset: 10 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<ApplyBody>().cycle).toMatchObject({
      cycleStartDay: 5,
      periodBoundaryOffset: 10,
      changed: true,
      resetPeriods: 1,
    });
    const stored = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    expect([stored.cycleStartDay, stored.periodBoundaryOffset]).toEqual([5, 10]);
    expect(await prisma.envelopePeriod.findUnique({ where: { id: stale.id } })).toBeNull();
    const rebuilt = await prisma.envelopePeriod.findMany({ where: { budgetId } });
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]).toMatchObject({ targetStatus: 'DRAFT', targetMinor: 10_000n });

    const history = 'applyHistory';
    const historyBudget = user(history).budgetId;
    const envelope = await prisma.envelope.create({
      data: envelopeData(historyBudget, 'Мой', 'CUSTOM', null, null),
    });
    await prisma.envelopePeriod.create({
      data: {
        id: randomUUID(),
        budgetId: historyBudget,
        envelopeId: envelope.id,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-01-14T00:00:00.000Z'),
        targetMinor: 5_000n,
        targetStatus: 'CONFIRMED',
        confirmedByUserId: user(history).userId,
        confirmedAt: new Date(),
      },
    });
    const blocked = await apply(history, {
      ...defaultApply(await previewOf(history)),
      cycle: { startDay: 7, boundaryOffset: 12 },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ code: string }>().code).toBe('CYCLE_CHANGE_REQUIRES_FLOW');
    const unchanged = await prisma.budget.findUniqueOrThrow({ where: { id: historyBudget } });
    expect([unchanged.cycleStartDay, unchanged.periodBoundaryOffset]).toEqual([1, 14]);
    expect(await prisma.envelope.count({ where: { budgetId: historyBudget } })).toBe(1);
    // The same cycle on a budget with history is not a change.
    const same = await apply(history, {
      ...defaultApply(await previewOf(history)),
      cycle: { startDay: 1, boundaryOffset: 14 },
    });
    expect(same.statusCode).toBe(200);
  });

  it('apply: устаревший hash 409, EDITOR/VIEWER 403, CSRF, ключ, валидация', async () => {
    const body = await previewOf('empty');
    const payload = defaultApply(body);
    const stale = await apply('empty', { ...payload, previewHash: 'a'.repeat(64) });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe('PREVIEW_STALE');
    expect((await apply('empty', payload, undefined, user('viewer'))).statusCode).toBe(403);
    expect((await apply('empty', payload, undefined, user('editor'))).statusCode).toBe(403);
    const url = `/api/v2/budgets/${user('empty').budgetId}/reference-template/apply`;
    const noCsrf = await server.inject({
      method: 'POST',
      url,
      headers: { ...authHeaders(user('empty')), 'idempotency-key': randomUUID() },
      payload,
    });
    expect(noCsrf.statusCode).toBe(403);
    const noKey = await server.inject({
      method: 'POST',
      url,
      headers: { ...authHeaders(user('empty')), 'x-csrf-token': user('empty').csrfToken },
      payload,
    });
    expect(noKey.statusCode).toBe(400);
    const onlyOne = await apply('empty', {
      ...payload,
      periods: [{ role: 'FIRST', action: 'CREATE' }],
    });
    expect(onlyOne.statusCode).toBe(400);
    const twoFirst = await apply('empty', {
      ...payload,
      periods: [
        { role: 'FIRST', action: 'CREATE' },
        { role: 'FIRST', action: 'CREATE' },
      ],
    });
    expect(twoFirst.statusCode).toBe(400);
    const unauth = await server.inject({ method: 'POST', url, headers: { origin }, payload });
    expect(unauth.statusCode).toBe(401);
    expect(await prisma.envelope.count({ where: { budgetId: user('empty').budgetId } })).toBe(1);
  });

  it('OpenAPI описывает POST apply: коды, cookie, CSRF и Idempotency-Key', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = openApi.json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, { properties?: Record<string, { type?: string }> }> };
    }>();
    const operation = document.paths['/api/v2/budgets/{budgetId}/reference-template/apply']?.post;
    expect(operation).toBeDefined();
    for (const code of ['200', '400', '401', '403', '404', '409', '422']) {
      expect(operation!.responses[code], code).toBeDefined();
    }
    const text = JSON.stringify(operation);
    expect(text).toContain('session');
    expect(text).toContain('Idempotency-Key');
    expect(document.components.schemas.TemplateApplyRequest?.properties?.previewHash?.type).toBe(
      'string',
    );
    expect(document.components.schemas.TemplateApplyResponse?.properties?.isComplete?.type).toBe(
      'boolean',
    );
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

type ApplyBody = {
  created: {
    categories: Array<{ id: string; templateKey: string; name: string }>;
    envelopes: Array<{ id: string; role: string; templateKey: string; name: string }>;
  };
  adopted: Array<{ id: string; role: string; name: string }>;
  skipped: Array<{ kind: string; role: string | null; templateKey: string; reason: string }>;
  cycle: {
    cycleStartDay: number;
    periodBoundaryOffset: number;
    changed: boolean;
    resetPeriods: number;
  };
  isComplete: boolean;
  previewHash: string;
};

async function previewOf(name: Name): Promise<PreviewBody> {
  return (await preview(name)).json<PreviewBody>();
}

function defaultApply(body: PreviewBody) {
  const action = (role: string) => {
    const row = body.envelopes.find((item) => item.role === role)!;
    return row.status === 'COLLISION' ? 'SKIP' : row.suggestedAction;
  };
  return {
    previewHash: body.previewHash,
    periods: [
      { role: 'FIRST', action: action('FIRST') },
      { role: 'SECOND', action: action('SECOND') },
    ] as Array<Record<string, unknown>>,
    mandatory: { action: action('MANDATORY') } as Record<string, unknown>,
    savings: [] as Array<Record<string, unknown>>,
  };
}

function apply(
  name: Name,
  payload: Record<string, unknown>,
  key: string | undefined = undefined,
  as: RegisteredUser | undefined = ctx[name],
) {
  return server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${user(name).budgetId}/reference-template/apply`,
    headers: {
      ...authHeaders(as),
      'x-csrf-token': as?.csrfToken ?? '',
      'idempotency-key': key ?? randomUUID(),
    },
    payload,
  });
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
