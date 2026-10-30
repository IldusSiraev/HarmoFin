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
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const MUTATING = ['post', 'put', 'patch', 'delete'] as const;
const METHODS = ['get', ...MUTATING] as const;
type Method = (typeof METHODS)[number];

type Schema = {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  items?: Schema;
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  discriminator?: { propertyName?: string; mapping?: Record<string, string> };
};
type Operation = {
  tags?: string[];
  security?: Array<Record<string, unknown>>;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: Schema }>;
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
};
type OpenApiDocument = {
  paths: Record<string, Partial<Record<Method, Operation>>>;
  components: { schemas: Record<string, Schema> };
};
type Op = { path: string; method: Method; operation: Operation };

// Явный список v2 путей (индекс roadmap 00 и реализованные стадии 01-05).
const EXPECTED_V2: Array<[Method, string]> = [
  ['get', '/api/v2/budgets/{budgetId}/model'],
  ['patch', '/api/v2/budgets/{budgetId}/model'],
  ['get', '/api/v2/budgets/{budgetId}/dashboard'],
  ['patch', '/api/v2/budgets/{budgetId}/settings'],
  ['post', '/api/v2/budgets/{budgetId}/cycle-change/preview'],
  ['post', '/api/v2/budgets/{budgetId}/cycle-change/confirm'],
  ['get', '/api/v2/budgets/{budgetId}/reference-template/preview'],
  ['post', '/api/v2/budgets/{budgetId}/reference-template/apply'],
  ['post', '/api/v2/budgets/{budgetId}/onboarding/no-mandatory-plans'],
  ['get', '/api/v2/budgets/{budgetId}/envelopes'],
  ['post', '/api/v2/budgets/{budgetId}/envelopes'],
  ['get', '/api/v2/budgets/{budgetId}/envelopes/{envelopeId}'],
  ['patch', '/api/v2/budgets/{budgetId}/envelopes/{envelopeId}'],
  ['post', '/api/v2/budgets/{budgetId}/envelopes/{envelopeId}/archive'],
  ['get', '/api/v2/budgets/{budgetId}/envelopes/{envelopeId}/history'],
  ['get', '/api/v2/budgets/{budgetId}/funding-rules'],
  ['put', '/api/v2/budgets/{budgetId}/funding-rules'],
  ['put', '/api/v2/budgets/{budgetId}/envelopes/{envelopeId}/funding-rule'],
  ['put', '/api/v2/budgets/{budgetId}/envelopes/{envelopeId}/periods/{periodStart}/target'],
  ['post', '/api/v2/budgets/{budgetId}/periods/{periodId}/confirm-target'],
  ['post', '/api/v2/budgets/{budgetId}/periods/{periodId}/reject-target'],
  ['post', '/api/v2/budgets/{budgetId}/assignments'],
  ['patch', '/api/v2/budgets/{budgetId}/assignments/{assignmentId}'],
  ['delete', '/api/v2/budgets/{budgetId}/assignments/{assignmentId}'],
  ['post', '/api/v2/budgets/{budgetId}/movements'],
  ['post', '/api/v2/budgets/{budgetId}/funding/preview'],
  ['post', '/api/v2/budgets/{budgetId}/funding/confirm'],
  ['put', '/api/v2/budgets/{budgetId}/income-category-suggestion'],
  ['get', '/api/v2/budgets/{budgetId}/income-plans'],
  ['post', '/api/v2/budgets/{budgetId}/income-plans'],
  ['patch', '/api/v2/budgets/{budgetId}/income-plans/{planId}'],
  ['get', '/api/v2/budgets/{budgetId}/income-plans/occurrences'],
  ['post', '/api/v2/budgets/{budgetId}/income-plans/occurrences/{occurrenceId}/record'],
  ['get', '/api/v2/budgets/{budgetId}/obligations/plans'],
  ['post', '/api/v2/budgets/{budgetId}/obligations/plans'],
  ['patch', '/api/v2/budgets/{budgetId}/obligations/plans/{planId}'],
  ['get', '/api/v2/budgets/{budgetId}/obligations/occurrences'],
  ['get', '/api/v2/budgets/{budgetId}/plans/calendar'],
  ['post', '/api/v2/budgets/{budgetId}/calendar/events'],
  ['get', '/api/v2/budgets/{budgetId}/calendar/events/{eventId}'],
  ['patch', '/api/v2/budgets/{budgetId}/calendar/events/{eventId}'],
  ['delete', '/api/v2/budgets/{budgetId}/calendar/events/{eventId}'],
  ['post', '/api/v2/budgets/{budgetId}/obligations/one-time-pay'],
  ['post', '/api/v2/budgets/{budgetId}/obligations/{occurrenceId}/pay'],
  ['post', '/api/v2/budgets/{budgetId}/obligations/{occurrenceId}/skip'],
  ['post', '/api/v2/budgets/{budgetId}/obligations/{occurrenceId}/close'],
  ['get', '/api/v2/budgets/{budgetId}/transactions'],
  ['post', '/api/v2/budgets/{budgetId}/transactions'],
  ['get', '/api/v2/budgets/{budgetId}/transactions/{transactionId}'],
  ['patch', '/api/v2/budgets/{budgetId}/transactions/{transactionId}'],
  ['delete', '/api/v2/budgets/{budgetId}/transactions/{transactionId}'],
  ['post', '/api/v2/budgets/{budgetId}/transactions/{transactionId}/restore'],
  ['get', '/api/v2/budgets/{budgetId}/transfers'],
  ['post', '/api/v2/budgets/{budgetId}/transfers'],
  ['get', '/api/v2/budgets/{budgetId}/transfers/{transferId}'],
  ['patch', '/api/v2/budgets/{budgetId}/transfers/{transferId}'],
  ['delete', '/api/v2/budgets/{budgetId}/transfers/{transferId}'],
  ['post', '/api/v2/budgets/{budgetId}/transfers/{transferId}/restore'],
  ['get', '/api/v2/budgets/{budgetId}/journal'],
  ['get', '/api/v2/budgets/{budgetId}/reports/{key}'],
  ['get', '/api/v2/budgets/{budgetId}/exports/transactions.csv'],
  ['get', '/api/v2/budgets/{budgetId}/exports/assignments.csv'],
];

// Мутирующие методы без записи (предпросмотр и подтверждение текущей модели): ключ не нужен.
const PREVIEW_ONLY = new Set([
  'patch /api/v2/budgets/{budgetId}/model',
  'post /api/v2/budgets/{budgetId}/cycle-change/preview',
  'post /api/v2/budgets/{budgetId}/funding/preview',
]);

const PROBLEM_REF = '#/components/schemas/ProblemDetailsResponse';
const REMOVED_V1_PATHS: Array<[Method, string]> = [
  ['get', '/api/v1/budgets/{budgetId}/envelope-reallocations'],
  ['post', '/api/v1/budgets/{budgetId}/envelope-reallocations'],
  ['get', '/api/v1/budgets/{budgetId}/envelope-reallocations/{reallocationId}'],
  ['delete', '/api/v1/budgets/{budgetId}/envelope-reallocations/{reallocationId}'],
  ['get', '/api/v1/budgets/{budgetId}/transactions/{transactionId}/allocations'],
  ['post', '/api/v1/budgets/{budgetId}/transactions/{transactionId}/allocations'],
  ['get', '/api/v1/budgets/{budgetId}/transfers'],
  ['post', '/api/v1/budgets/{budgetId}/transfers'],
  ['get', '/api/v1/budgets/{budgetId}/transactions'],
  ['post', '/api/v1/budgets/{budgetId}/transactions'],
  ['get', '/api/v1/budgets/{budgetId}/transactions/{transactionId}'],
  ['get', '/api/v1/budgets/{budgetId}/plans'],
  ['post', '/api/v1/budgets/{budgetId}/plans'],
  ['get', '/api/v1/budgets/{budgetId}/envelopes'],
  ['post', '/api/v1/budgets/{budgetId}/envelopes'],
  ['get', '/api/v1/budgets/{budgetId}/envelopes/balance-summary'],
  ['post', '/api/v1/budgets/{budgetId}/reference-template'],
  ['patch', '/api/v1/budgets/{budgetId}'],
  ['get', '/api/v1/budgets/{budgetId}/summary'],
  ['get', '/api/v1/budgets/{budgetId}/reports/{reportKey}'],
  ['get', '/api/v1/budgets/{budgetId}/exports/transactions.csv'],
  ['get', '/api/v1/budgets/{budgetId}/cycles/current'],
];
// Чтение и исправление истории модели 1 удалены: бюджеты начинают учёт с чистого листа.
const REMOVED_V2_PATHS: Array<[Method, string]> = [
  ['get', '/api/v2/budgets/{budgetId}/exports/legacy-assignments.csv'],
  ['get', '/api/v2/budgets/{budgetId}/history/legacy-assignments'],
  ['post', '/api/v2/budgets/{budgetId}/history/{transactionId}/correction-preview'],
  ['post', '/api/v2/budgets/{budgetId}/history/{transactionId}/correct'],
];
const REMOVED_V1_PREFIXES = [
  '/api/v1/budgets/{budgetId}/envelope-reallocations',
  '/api/v1/budgets/{budgetId}/income-allocations',
  '/api/v1/budgets/{budgetId}/allocations',
  '/api/v1/budgets/{budgetId}/transfers',
  '/api/v1/budgets/{budgetId}/plans',
  '/api/v1/budgets/{budgetId}/envelopes',
  '/api/v1/budgets/{budgetId}/reference-template',
  '/api/v1/budgets/{budgetId}/summary',
  '/api/v1/budgets/{budgetId}/reports',
  '/api/v1/budgets/{budgetId}/exports',
  '/api/v1/budgets/{budgetId}/cycles',
];

let app: NestFastifyApplication;
let server: FastifyInstance;
let document: OpenApiDocument;
let v2Ops: Op[];
let v1Ops: Op[];
const createdUsers: string[] = [];

type World = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};
let a: World;
let b: World;
let bEnvelopeId: string;
let bPlanId: string;
let bAssignmentId: string;
let bOccurrenceId: string;

function collect(prefix: string): Op[] {
  const out: Op[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith(prefix)) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (operation) out.push({ path, method, operation });
    }
  }
  return out;
}

const label = (op: Op) => `${op.method} ${op.path}`;
const isMutating = (op: Op) => (MUTATING as readonly string[]).includes(op.method);
const refName = (ref: string) => ref.slice('#/components/schemas/'.length);

function visit(schema: Schema | undefined, seen: Set<string>): void {
  if (!schema) return;
  if (schema.$ref) {
    const name = refName(schema.$ref);
    if (seen.has(name)) return;
    seen.add(name);
    visit(document.components.schemas[name], seen);
    return;
  }
  visit(schema.items, seen);
  for (const sub of [...(schema.oneOf ?? []), ...(schema.anyOf ?? []), ...(schema.allOf ?? [])]) {
    visit(sub, seen);
  }
  if (typeof schema.additionalProperties === 'object') visit(schema.additionalProperties, seen);
  for (const property of Object.values(schema.properties ?? {})) visit(property, seen);
}

function reachable(ops: Op[]): Set<string> {
  const seen = new Set<string>();
  for (const { operation } of ops) {
    for (const body of Object.values(operation.requestBody?.content ?? {})) {
      visit(body.schema, seen);
    }
    for (const response of Object.values(operation.responses ?? {})) {
      for (const body of Object.values(response.content ?? {})) visit(body.schema, seen);
    }
    for (const parameter of operation.parameters ?? []) visit(parameter.schema, seen);
  }
  return seen;
}

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
  document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<OpenApiDocument>();
  v2Ops = collect('/api/v2/');
  v1Ops = collect('/api/v1/');

  a = await v2World();
  b = await v2World();
  await createEnvelope(a.budgetId, a.userId, 'A envelope');
  bEnvelopeId = await createEnvelope(b.budgetId, b.userId, 'B envelope', 1_000_000n);
  bAssignmentId = randomUUID();
  await prisma.envelopeAssignment.create({
    data: {
      id: bAssignmentId,
      budgetId: b.budgetId,
      envelopeId: bEnvelopeId,
      type: 'OPENING',
      amountMinor: 500_000n,
      effectiveOn: day('2026-03-01'),
      status: 'CONFIRMED',
      createdByUserId: b.userId,
    },
  });
  bPlanId = randomUUID();
  await prisma.regularPlan.create({
    data: {
      id: bPlanId,
      workspaceId: b.workspaceId,
      budgetId: b.budgetId,
      ownerUserId: b.userId,
      name: 'Чужая аренда',
      planType: 'EXPENSE',
      amountMinor: 5_000_000n,
      anchorOn: day('2026-03-12'),
      startOn: day('2026-03-12'),
      recurrence: 'ONE_TIME',
      envelopeId: bEnvelopeId,
      isActive: true,
      createdByUserId: b.userId,
      updatedByUserId: b.userId,
    },
  });
  bOccurrenceId = randomUUID();
  await prisma.planOccurrence.create({
    data: {
      id: bOccurrenceId,
      workspaceId: b.workspaceId,
      budgetId: b.budgetId,
      planId: bPlanId,
      scheduledOn: day('2026-03-12'),
      planName: 'Чужая аренда',
      planType: 'EXPENSE',
      amountMinor: 5_000_000n,
      envelopeId: bEnvelopeId,
      status: 'DUE',
    },
  });
});

afterAll(async () => {
  for (const userId of createdUsers) await cleanupUser(userId);
  await app.close();
  await prisma.$disconnect();
});

describe('v2 OpenAPI contract (P06)', () => {
  it('публикует v2 и стабильные v1 пути, удалённых v1 путей записи и чтения нет', () => {
    expect(document.paths['/api/v2/budgets/{budgetId}/dashboard']?.get).toBeDefined();
    expect(
      document.paths['/api/v1/budgets/{budgetId}/transactions/{transactionId}/audit']?.get,
    ).toBeDefined();
    expect(document.paths['/api/v1/budgets/{budgetId}']?.get).toBeDefined();
    expect(document.paths['/api/v1/workspaces/{workspaceId}/budgets']?.post).toBeDefined();
    expect(v1Ops.length).toBeGreaterThan(20);
    expect(v2Ops.length).toBeGreaterThan(40);
    for (const [method, path] of REMOVED_V1_PATHS) {
      expect(document.paths[path]?.[method], `${method} ${path}`).toBeUndefined();
    }
    for (const [method, path] of REMOVED_V2_PATHS) {
      expect(document.paths[path]?.[method], `${method} ${path}`).toBeUndefined();
    }
    expect(
      Object.keys(document.paths).filter((path) =>
        path.startsWith('/api/v2/budgets/{budgetId}/history'),
      ),
    ).toEqual([]);
    const leftovers = Object.keys(document.paths).filter((path) =>
      REMOVED_V1_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
    );
    expect(leftovers).toEqual([]);
    const tx = Object.keys(document.paths).filter((path) =>
      path.startsWith('/api/v1/budgets/{budgetId}/transactions'),
    );
    expect(tx).toEqual(['/api/v1/budgets/{budgetId}/transactions/{transactionId}/audit']);
  });

  it('удалённые v1 маршруты отвечают 404', async () => {
    const budgetId = a.budgetId;
    const id = randomUUID();
    const calls: Array<[string, string]> = [
      ['GET', `/api/v1/budgets/${budgetId}/envelope-reallocations`],
      ['POST', `/api/v1/budgets/${budgetId}/envelope-reallocations`],
      ['POST', `/api/v1/budgets/${budgetId}/transactions/${id}/allocations`],
      ['PATCH', `/api/v1/budgets/${budgetId}/allocations/${id}`],
      ['POST', `/api/v1/budgets/${budgetId}/transfers`],
      ['GET', `/api/v1/budgets/${budgetId}/transfers`],
      ['GET', `/api/v1/budgets/${budgetId}/transactions`],
      ['POST', `/api/v1/budgets/${budgetId}/transactions`],
      ['GET', `/api/v1/budgets/${budgetId}/transactions/${id}`],
      ['GET', `/api/v1/budgets/${budgetId}/plans`],
      ['POST', `/api/v1/budgets/${budgetId}/plans`],
      ['GET', `/api/v1/budgets/${budgetId}/envelopes`],
      ['POST', `/api/v1/budgets/${budgetId}/envelopes`],
      ['GET', `/api/v1/budgets/${budgetId}/envelopes/balance-summary`],
      ['POST', `/api/v1/budgets/${budgetId}/reference-template`],
      ['PATCH', `/api/v1/budgets/${budgetId}`],
      ['GET', `/api/v1/budgets/${budgetId}/summary`],
      ['GET', `/api/v1/budgets/${budgetId}/reports/expenses-by-category`],
      ['GET', `/api/v1/budgets/${budgetId}/exports/transactions.csv`],
      ['GET', `/api/v1/budgets/${budgetId}/cycles/current`],
    ];
    for (const [method, url] of calls) {
      const response = await server.inject({
        method: method as 'GET',
        url,
        headers: { origin, 'x-csrf-token': a.csrfToken },
        cookies: { harmofin_session: a.cookie },
        ...(method === 'GET' ? {} : { payload: {} }),
      });
      expect(response.statusCode, `${method} ${url}: ${response.body}`).toBe(404);
    }
  });

  it('все ожидаемые v2 операции опубликованы и нет неучтённых', () => {
    for (const [method, path] of EXPECTED_V2) {
      expect(document.paths[path]?.[method], `${method} ${path}`).toBeDefined();
    }
    const expected = new Set(EXPECTED_V2.map(([method, path]) => `${method} ${path}`));
    const unexpected = v2Ops.map(label).filter((name) => !expected.has(name));
    expect(unexpected, 'v2 операции вне индекса: добавьте их в EXPECTED_V2').toEqual([]);
  });

  it('каждая v2 операция имеет отдельный v2 tag', () => {
    const bad = v2Ops
      .filter(
        (op) => !op.operation.tags?.length || !op.operation.tags.every((t) => /\(v2\)$/.test(t)),
      )
      .map((op) => `${label(op)} tags=${JSON.stringify(op.operation.tags)}`);
    expect(bad).toEqual([]);
    const v1Tags = new Set(v1Ops.flatMap((op) => op.operation.tags ?? []));
    const shared = v2Ops.flatMap((op) => op.operation.tags ?? []).filter((t) => v1Tags.has(t));
    expect(shared).toEqual([]);
  });

  it('cookie-auth security у каждой v2 операции', () => {
    const bad = v2Ops
      .filter((op) => JSON.stringify(op.operation.security) !== JSON.stringify([{ session: [] }]))
      .map(label);
    expect(bad).toEqual([]);
  });

  // Критерий кодов. Все v2 операции budget-scoped (budgetId в пути) под сессией и
  // v2-моделью: 400 (неверный id/ввод), 401 (нет сессии), 403 (роль/CSRF),
  // 404 (чужой/отсутствующий бюджет), 409 (MODEL_VERSION_MISMATCH/состояние) обязательны
  // у всех. 422 обязателен только у мутаций с телом (кроме delete), где доменное правило
  // отклоняет корректный по форме ввод; у GET, delete и операций без тела 422 невозможен.
  it('v2 операции описывают ошибки ProblemDetails', () => {
    const missing: string[] = [];
    for (const op of v2Ops) {
      const required = ['400', '401', '403', '404', '409'];
      if (isMutating(op) && op.operation.requestBody && op.method !== 'delete') {
        required.push('422');
      }
      for (const status of required) {
        const schema = op.operation.responses?.[status]?.content?.['application/json']?.schema;
        if (schema?.$ref !== PROBLEM_REF) missing.push(`${label(op)} ${status}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('у каждой v2 операции есть схема успешного ответа', () => {
    const bad: string[] = [];
    for (const op of v2Ops) {
      const ok = Object.entries(op.operation.responses ?? {}).filter(([code]) =>
        /^2\d\d$/.test(code),
      );
      if (ok.length === 0) {
        bad.push(`${label(op)} без 2xx`);
        continue;
      }
      for (const [code, response] of ok) {
        if (code === '204') continue;
        const content = Object.values(response.content ?? {});
        if (content.length === 0 || content.some((entry) => !entry.schema)) {
          bad.push(`${label(op)} ${code} без схемы`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('схема конверта описывает периоды, а назначения и переносы отвечают собственными схемами', () => {
    const schemas = document.components.schemas;
    expect(schemas['EnvelopePlanResponse']?.properties?.['periods']?.items?.$ref).toBe(
      '#/components/schemas/EnvelopePeriodBalanceResponse',
    );
    expect(Object.keys(schemas['EnvelopePeriodBalanceResponse']?.properties ?? {}).sort()).toEqual(
      [
        'balanceMinor',
        'current',
        'endsOn',
        'fundedMinor',
        'periodId',
        'spentMinor',
        'startsOn',
      ].sort(),
    );

    const responseRef = (method: Method, path: string, code: string) =>
      v2Ops.find((op) => op.method === method && op.path === path)?.operation.responses?.[code]
        ?.content?.['application/json']?.schema?.$ref;
    const base = '/api/v2/budgets/{budgetId}';
    expect(responseRef('post', `${base}/assignments`, '201')).toBe(
      '#/components/schemas/AssignmentResultResponse',
    );
    expect(responseRef('patch', `${base}/assignments/{assignmentId}`, '200')).toBe(
      '#/components/schemas/AssignmentResultResponse',
    );
    expect(responseRef('delete', `${base}/assignments/{assignmentId}`, '200')).toBe(
      '#/components/schemas/AssignmentResultResponse',
    );
    expect(responseRef('post', `${base}/movements`, '201')).toBe(
      '#/components/schemas/MovementResultResponse',
    );
    expect(responseRef('get', `${base}/envelopes`, '200')).toBe(
      '#/components/schemas/EnvelopePlanListResponse',
    );
  });

  it('лента журнала: items — oneOf двух схем с дискриминатором kind и полной картой mapping', () => {
    const schemas = document.components.schemas;
    const journalOp = v2Ops.find(
      (op) => op.method === 'get' && op.path === '/api/v2/budgets/{budgetId}/journal',
    );
    const pageRef =
      journalOp?.operation.responses?.['200']?.content?.['application/json']?.schema?.$ref;
    expect(pageRef).toBe('#/components/schemas/JournalPageResponse');
    const pageSchema = schemas[refName(pageRef!)];
    const itemsSchema = pageSchema?.properties?.['items'];
    const transactionRef = '#/components/schemas/TransactionFeedItemResponse';
    const transferRef = '#/components/schemas/JournalTransferItemResponse';
    expect(itemsSchema?.items?.oneOf?.map((s) => s.$ref)).toEqual([transactionRef, transferRef]);
    expect(itemsSchema?.items?.discriminator?.propertyName).toBe('kind');
    expect(itemsSchema?.items?.discriminator?.mapping).toEqual({
      TRANSACTION: transactionRef,
      TRANSFER: transferRef,
    });
    expect(schemas[refName(transactionRef)]).toBeDefined();
    expect(schemas[refName(transferRef)]).toBeDefined();
  });

  it('мутации v2 требуют Idempotency-Key (кроме предпросмотров) и описывают 403', () => {
    const bad: string[] = [];
    for (const op of v2Ops.filter(isMutating)) {
      const header = op.operation.parameters?.find(
        (p) => p.in === 'header' && p.name.toLowerCase() === 'idempotency-key',
      );
      if (PREVIEW_ONLY.has(label(op))) {
        if (header?.required) bad.push(`${label(op)} предпросмотр требует ключ`);
      } else if (!header?.required) {
        bad.push(`${label(op)} без обязательного Idempotency-Key`);
      }
      if (!op.operation.responses?.['403']) bad.push(`${label(op)} без 403`);
    }
    expect(bad).toEqual([]);
  });

  const concretePath = (path: string, budgetId: string) =>
    path
      .replace('{budgetId}', budgetId)
      .replace('{periodStart}', '2026-03-01')
      .replace('{key}', 'savings-goals')
      .replace(/\{[A-Za-z]+\}/g, () => randomUUID());

  it('любая v2 операция без сессии получает 401', async () => {
    const bad: string[] = [];
    for (const op of v2Ops) {
      const response = await server.inject({
        method: op.method.toUpperCase() as 'GET',
        url: concretePath(op.path, a.budgetId),
        headers: { origin, 'idempotency-key': randomUUID() },
        ...(isMutating(op) ? { payload: {} } : {}),
      });
      if (response.statusCode !== 401) bad.push(`${label(op)} -> ${response.statusCode}`);
    }
    expect(bad).toEqual([]);
  });

  it('мутации v2 без CSRF-токена получают 403 CSRF_INVALID; с валидным токеном CSRF-отказа нет', async () => {
    const bad: string[] = [];
    for (const op of v2Ops.filter(isMutating)) {
      const url = concretePath(op.path, a.budgetId);
      const send = (token?: string) =>
        server.inject({
          method: op.method.toUpperCase() as 'POST',
          url,
          headers: {
            origin,
            'idempotency-key': randomUUID(),
            ...(token ? { 'x-csrf-token': token } : {}),
          },
          cookies: { harmofin_session: a.cookie },
          payload: {},
        });
      const without = await send();
      if (without.statusCode !== 403 || without.json<{ code?: string }>().code !== 'CSRF_INVALID') {
        bad.push(`${label(op)} без токена -> ${without.statusCode} ${without.body.slice(0, 80)}`);
      }
      const wrong = await send('wrong-token');
      if (wrong.statusCode !== 403 || wrong.json<{ code?: string }>().code !== 'CSRF_INVALID') {
        bad.push(`${label(op)} неверный токен -> ${wrong.statusCode}`);
      }
      // Positive control: с валидным токеном запрос доходит дальше guard (204/400/404/409/422...).
      const valid = await send(a.csrfToken);
      const validCode = valid.body ? valid.json<{ code?: string }>().code : undefined;
      if (valid.statusCode === 401 || validCode === 'CSRF_INVALID') {
        bad.push(
          `${label(op)} с валидным токеном -> ${valid.statusCode} ${valid.body.slice(0, 80)}`,
        );
      }
    }
    expect(bad).toEqual([]);
  });

  it('мутации и чтение чужих объектов под путём бюджета A дают 404, данные B не меняются', async () => {
    const send = async (
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      path: string,
      payload?: Record<string, unknown>,
      budget: World = a,
    ) =>
      server.inject({
        method,
        url: `/api/v2/budgets/${budget.budgetId}${path}`,
        headers: {
          origin,
          'x-csrf-token': a.csrfToken,
          'idempotency-key': randomUUID(),
        },
        cookies: { harmofin_session: a.cookie },
        ...(payload === undefined ? {} : { payload }),
      });
    const payBody = {
      accountId: randomUUID(),
      categoryId: randomUUID(),
      amount: '10.00',
      occurredOn: '2026-03-12',
      willPayMore: false,
    };
    const cases: Array<[string, Awaited<ReturnType<typeof send>>]> = [
      ['GET envelope', await send('GET', `/envelopes/${bEnvelopeId}`)],
      [
        'PATCH assignment',
        await send('PATCH', `/assignments/${bAssignmentId}`, { amount: '5.00' }),
      ],
      ['DELETE assignment', await send('DELETE', `/assignments/${bAssignmentId}`)],
      ['POST pay', await send('POST', `/obligations/${bOccurrenceId}/pay`, payBody)],
      ['POST skip', await send('POST', `/obligations/${bOccurrenceId}/skip`, {})],
      ['POST close', await send('POST', `/obligations/${bOccurrenceId}/close`, {})],
      [
        'PATCH obligation plan',
        await send('PATCH', `/obligations/plans/${bPlanId}`, { name: 'x' }),
      ],
      // Сессия A против budgetId B.
      ['foreign PATCH settings', await send('PATCH', '/settings', { name: 'x' }, b)],
      ['foreign POST skip', await send('POST', `/obligations/${bOccurrenceId}/skip`, {}, b)],
      [
        'foreign DELETE assignment',
        await send('DELETE', `/assignments/${bAssignmentId}`, undefined, b),
      ],
    ];
    const bad = cases
      .filter(([, response]) => response.statusCode !== 404)
      .map(
        ([name, response]) => `${name} -> ${response.statusCode} ${response.body.slice(0, 100)}`,
      );
    expect(bad).toEqual([]);
    const assignment = await prisma.envelopeAssignment.findUniqueOrThrow({
      where: { id: bAssignmentId },
    });
    expect(assignment.status).toBe('CONFIRMED');
    expect(assignment.amountMinor).toBe(500_000n);
    expect(
      (await prisma.planOccurrence.findUniqueOrThrow({ where: { id: bOccurrenceId } })).status,
    ).toBe('DUE');
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: b.budgetId } })).name).not.toBe(
      'x',
    );
  });

  it('деньги во внешних v2 схемах только строки', () => {
    // Ключи денег. Не деньги, хотя имя совпадает: доли, счётчики, масштаб и пагинация.
    const moneyKey = /(Minor|amount|total|balance|deficit|available|spent|limit)/i;
    const notMoney = /(Permille|Percent|Count|Scale)$|^limit$/i;
    const bad: string[] = [];
    let checked = 0;
    const isNumeric = (node: Schema, depth = 0): boolean => {
      if (depth > 8) return false;
      const own = node.$ref ? document.components.schemas[refName(node.$ref)] : node;
      if (!own) return false;
      if (own.type === 'number' || own.type === 'integer') return true;
      if (own.type === 'array' && own.items) return isNumeric(own.items, depth + 1);
      return [...(own.allOf ?? []), ...(own.anyOf ?? []), ...(own.oneOf ?? [])].some((sub) =>
        isNumeric(sub, depth + 1),
      );
    };
    const walk = (node: Schema | undefined, path: string, trail: Set<string>): void => {
      if (!node) return;
      if (node.$ref) {
        const name = refName(node.$ref);
        if (trail.has(name)) return;
        walk(document.components.schemas[name], name, new Set(trail).add(name));
        return;
      }
      walk(node.items, `${path}[]`, trail);
      for (const sub of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])]) {
        walk(sub, path, trail);
      }
      if (typeof node.additionalProperties === 'object') {
        walk(node.additionalProperties, `${path}{}`, trail);
      }
      for (const [key, property] of Object.entries(node.properties ?? {})) {
        const here = `${path}.${key}`;
        if (moneyKey.test(key) && !notMoney.test(key)) {
          checked += 1;
          if (isNumeric(property)) bad.push(here);
        }
        walk(property, here, trail);
      }
    };
    for (const op of v2Ops) {
      for (const body of Object.values(op.operation.requestBody?.content ?? {})) {
        walk(body.schema, `${label(op)} request`, new Set());
      }
      for (const [code, response] of Object.entries(op.operation.responses ?? {})) {
        for (const body of Object.values(response.content ?? {})) {
          walk(body.schema, `${label(op)} ${code}`, new Set());
        }
      }
      for (const p of op.operation.parameters ?? []) {
        if (moneyKey.test(p.name) && !notMoney.test(p.name)) {
          checked += 1;
          if (p.schema && isNumeric(p.schema)) bad.push(`${label(op)} param ${p.name}`);
        }
      }
    }
    // Проверка не вакуумная: денежные свойства реально найдены.
    expect(checked).toBeGreaterThan(50);
    expect([...new Set(bad)]).toEqual([]);
  });

  it('в документе нет свойств схем без типа (включая вложенные)', () => {
    const bad: string[] = [];
    const typed = (node: Schema) =>
      Boolean(node.$ref || node.type || node.enum || node.oneOf || node.anyOf || node.allOf);
    const walk = (node: Schema, path: string, depth: number): void => {
      if (depth > 10) return;
      if (node.items) {
        if (!typed(node.items)) bad.push(`${path}[]`);
        walk(node.items, `${path}[]`, depth + 1);
      }
      for (const [key, property] of Object.entries(node.properties ?? {})) {
        if (!typed(property)) bad.push(`${path}.${key}`);
        walk(property, `${path}.${key}`, depth + 1);
      }
      if (typeof node.additionalProperties === 'object') {
        walk(node.additionalProperties, `${path}{}`, depth + 1);
      }
    };
    for (const [name, schema] of Object.entries(document.components.schemas)) walk(schema, name, 0);
    for (const op of [...v1Ops, ...v2Ops]) {
      for (const body of Object.values(op.operation.requestBody?.content ?? {})) {
        if (body.schema && !body.schema.$ref) walk(body.schema, `${label(op)} request`, 0);
      }
      for (const [code, response] of Object.entries(op.operation.responses ?? {})) {
        for (const body of Object.values(response.content ?? {})) {
          if (body.schema && !body.schema.$ref) walk(body.schema, `${label(op)} ${code}`, 0);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('v1 и v2 не делят DTO с конфликтующим смыслом', () => {
    const v1Names = reachable(v1Ops);
    const v2Names = reachable(v2Ops);
    // Общими могут быть только нейтральные контракты ошибок и ссылка на участника семьи
    // (`PersonRefResponse`/`AuthorRefResponse`), которая намеренно живёт в `common/people`
    // и переиспользуется v1 и v2 контроллерами (family access, этап B).
    const allowed = new Set(['ProblemDetailsResponse', 'FieldErrorResponse', 'AuthorRefResponse']);
    const shared = [...v2Names].filter((name) => v1Names.has(name) && !allowed.has(name));
    expect(shared).toEqual([]);
  });

  it('v2 budgetA не видит plan и assignment budgetB', async () => {
    const call = (budget: World, path: string, who: World = budget) =>
      server.inject({
        method: 'GET',
        url: `/api/v2/budgets/${budget.budgetId}${path}`,
        cookies: { harmofin_session: who.cookie },
      });
    const foreignIds = [b.budgetId, bEnvelopeId, bPlanId, bAssignmentId];
    for (const path of [
      '/dashboard?asOf=2026-03-10',
      '/reports/savings-goals',
      '/reports/assignment-movements',
      '/reports/plan-vs-actual',
      '/envelopes',
      '/obligations/plans',
      '/obligations/occurrences',
    ]) {
      const own = await call(a, path);
      expect(own.statusCode, `${path}: ${own.body}`).toBe(200);
      for (const id of foreignIds) expect(own.body, path).not.toContain(id);
      const foreign = await call(b, path, a);
      expect(foreign.statusCode, `foreign ${path}`).toBe(404);
    }
    const sanity = await call(b, '/reports/assignment-movements');
    expect(sanity.body).toContain(bAssignmentId);
  });
});

async function v2World(): Promise<World> {
  const registered = await register(`v2-openapi-${randomUUID()}@harmofin.test`);
  await prisma.budget.update({
    where: { id: registered.budgetId },
    data: {
      planModelVersion: 2,
      planModelActivatedOn: day('2026-01-01'),
      timezone: 'UTC',
      cycleStartDay: 1,
      periodBoundaryOffset: 14,
    },
  });
  await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId: registered.budgetId,
      ownerUserId: registered.userId,
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      startingBalanceMinor: 1_000_000n,
      accountingStartDate: day('2026-01-01'),
    },
  });
  return registered;
}

async function createEnvelope(
  budgetId: string,
  ownerUserId: string,
  name: string,
  targetAmountMinor?: bigint,
): Promise<string> {
  const created = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId,
      name,
      envelopeType: targetAmountMinor === undefined ? 'CURRENT_EXPENSES' : 'SAVINGS_GOAL',
      startingBalanceMinor: 0n,
      displayOrder: 950,
      ...(targetAmountMinor === undefined
        ? { periodSlot: 'FIRST' as const }
        : { targetAmountMinor }),
    },
  });
  return created.id;
}

async function register(email: string): Promise<World> {
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
  createdUsers.push(body.user.id);
  const raw = response.headers['set-cookie'];
  const setCookie = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
  const match = /harmofin_session=([^;]+)/.exec(setCookie);
  expect(match).not.toBeNull();
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
    cookie: decodeURIComponent(match![1]!),
    csrfToken: body.csrfToken,
  };
}

async function cleanupUser(userId: string): Promise<void> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.recoveryToken.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    const where = { budget: { workspaceId } };
    await prisma.auditEvent.deleteMany({ where: { workspaceId } });
    await prisma.idempotencyRecord.deleteMany({ where });
    await prisma.envelopeMovement.deleteMany({ where });
    await prisma.envelopeAssignment.deleteMany({ where });
    await prisma.planPayment.deleteMany({ where });
    await prisma.planOccurrence.deleteMany({ where });
    await prisma.regularPlan.deleteMany({ where });
    await prisma.envelopePeriod.deleteMany({ where });
    await prisma.envelopeFundingRule.deleteMany({ where });
    await prisma.budgetCycleRevision.deleteMany({ where });
    const budgets = await prisma.budget.findMany({ where: { workspaceId }, select: { id: true } });
    await prisma.transferPart.deleteMany({
      where: { budgetId: { in: budgets.map((budget) => budget.id) } },
    });
    await prisma.transfer.deleteMany({ where });
    await prisma.transaction.deleteMany({ where });
    await prisma.account.deleteMany({ where });
    await prisma.category.deleteMany({ where });
    await prisma.envelope.deleteMany({ where });
  }
  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}
