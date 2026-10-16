# Порядок шагов «Начало работы» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переставить шаги мастера «Начало работы» (счета → обязательные платежи → лимит → назначить деньги), дать отказаться от обязательных платежей с сохранением на сервере и не открывать окно распределения после создания счёта во время первичной настройки.

**Architecture:** API: additive-колонка `budgets.onboarding_no_mandatory_plans_at`, идемпотентный `POST /api/v2/budgets/:budgetId/onboarding/no-mandatory-plans` в модуле `v2-dashboard` и поле `onboarding.mandatoryPlansDeclined` в дашборде. Web: `OnboardingChecklist.vue` меняет порядок, условие шага 3 и предупреждение шага 5; `accounts.vue` перед авто-окном читает `onboarding.needsOpeningAssignment` с сервера.

**Tech Stack:** NestJS/Fastify, Prisma, PostgreSQL 18, Vitest (unit + integration через `server.inject`), Nuxt 4/Vue 3.5, `@vue/test-utils`, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-16-onboarding-step-order-design.md](../specs/2026-10-16-onboarding-step-order-design.md)

## Global Constraints

- UI-тексты на русском, идентификаторы кода, API и БД — на английском.
- Миграция только additive: `ALTER TABLE "budgets" ADD COLUMN ... TIMESTAMPTZ(3)` nullable, без default, без переписывания строк.
- Маршрут: только `OWNER` (`RolePolicy.canManage`); бюджет через `PlanModelPolicy.requireModel(userId, budgetId, 2)`; CSRF (`CsrfGuard`); обязательный `Idempotency-Key` (`IdempotencyService`, операция `DECLINE_MANDATORY_PLANS`).
- Audit: `entityType: 'budget_onboarding'`, `entityId: budgetId`, `action: 'MANDATORY_PLANS_DECLINED'`, `source: 'API'`, `newValues: { declinedAt }`; пишется только когда колонка реально изменилась.
- Контроллер только переводит HTTP; Prisma только в repository.
- Браузер не вычисляет деньги и статусы: только серверные поля `onboarding`.
- Локально Playwright не запускать; E2E правится и проверяется в CI.
- Не коммитить, не пушить без явного разрешения владельца. Шаги «Commit» ниже выполняются только после такого разрешения; без него — остановиться после проверки задачи.
- Не трогать `identity/logo_description.png`. Не создавать worktree.
- `pnpm db:migrate:dev` — только локальная БД разработки.

## File Structure

- Create `prisma/migrations/20261016000100_budget_onboarding_no_mandatory_plans/migration.sql` — колонка.
- Modify `prisma/schema.prisma` — поле `onboardingNoMandatoryPlansAt` в `Budget`.
- Create `apps/api/src/v2-dashboard/onboarding-v2.repository.ts` — условное обновление, роль, audit.
- Create `apps/api/src/v2-dashboard/onboarding-v2.application.service.ts` — доступ, идемпотентность, транзакция.
- Create `apps/api/src/v2-dashboard/onboarding-v2.controller.ts` — HTTP + OpenAPI.
- Modify `apps/api/src/v2-dashboard/dashboard-v2.module.ts` — регистрация.
- Modify `apps/api/src/v2-dashboard/dashboard-v2.repository.ts`, `dashboard-v2.application.service.ts`, `dashboard-v2.dto.ts` — поле `mandatoryPlansDeclined`.
- Create `apps/api/test/v2-onboarding.integration.test.ts` — маршрут.
- Modify `apps/api/test/v2-dashboard.integration.test.ts`, `apps/api/test/v2-openapi.integration.test.ts`.
- Modify `openapi.json` — регенерация.
- Modify `apps/web/app/composables/useEnvelopePlanV2.ts` — тип + `declineMandatoryPlans`.
- Modify `apps/web/app/components/dashboard/OnboardingChecklist.vue` + `.test.ts`.
- Modify `apps/web/app/pages/app/accounts.vue` + `accounts.test.ts`.
- Modify web-фикстуры `apps/web/app/components/dashboard/AvailableBudgetCard.test.ts`, `apps/web/app/pages/app/index.test.ts`.
- Modify E2E `e2e/envelope-v2-onboarding.spec.ts`, `e2e/envelope-v2-payments.spec.ts`, `e2e/envelope-v2-period.spec.ts`, `e2e/reference-data.spec.ts`, `e2e/reference-lists.spec.ts`.

---

### Task 1: Колонка и поле `mandatoryPlansDeclined` в дашборде

**Files:**
- Create: `prisma/migrations/20261016000100_budget_onboarding_no_mandatory_plans/migration.sql`
- Modify: `prisma/schema.prisma` (model `Budget`, после `planModelActivatedOn`)
- Modify: `apps/api/src/v2-dashboard/dashboard-v2.repository.ts` (рядом с `hasMandatoryPlans`)
- Modify: `apps/api/src/v2-dashboard/dashboard-v2.application.service.ts:87-93`, `:509-515`
- Modify: `apps/api/src/v2-dashboard/dashboard-v2.dto.ts:120-138`
- Test: `apps/api/test/v2-dashboard.integration.test.ts`

**Interfaces:**
- Produces: Prisma-поле `Budget.onboardingNoMandatoryPlansAt: Date | null`; `DashboardV2Repository.mandatoryPlansDeclined(tx, budgetId, workspaceId): Promise<boolean>`; `DashboardV2Summary['onboarding'].mandatoryPlansDeclined: boolean`; JSON-поле `onboarding.mandatoryPlansDeclined`.

- [ ] **Step 1: Write the failing test**

В `apps/api/test/v2-dashboard.integration.test.ts`, в тесте «тело не содержит полей v1 и имеет заданный набор флагов онбординга», заменить ожидаемый список ключей:

```ts
    expect(Object.keys(body.onboarding).sort()).toEqual([
      'categoriesSeeded',
      'hasAccounts',
      'hasMandatoryPlans',
      'mandatoryPlansDeclined',
      'needsOpeningAssignment',
      'needsPeriodSetup',
    ]);
```

И сразу после этого теста в `describe('v2 dashboard HTTP contract (P02)')` добавить:

```ts
  it('mandatoryPlansDeclined отражает отказ от обязательных платежей', async () => {
    const w = await world(5_000_000n);
    const before = (await getDashboard(w)).json<DashboardBody>();
    expect(before.onboarding.mandatoryPlansDeclined).toBe(false);

    await prisma.budget.update({
      where: { id: w.budgetId },
      data: { onboardingNoMandatoryPlansAt: new Date() },
    });
    const after = (await getDashboard(w)).json<DashboardBody>();
    expect(after.onboarding.mandatoryPlansDeclined).toBe(true);
    expect(after.onboarding.hasMandatoryPlans).toBe(false);
  });
```

- [ ] **Step 2: Add the column and migrate local DB**

`prisma/schema.prisma`, model `Budget`, после строки `planModelActivatedOn`:

```prisma
  onboardingNoMandatoryPlansAt     DateTime?    @map("onboarding_no_mandatory_plans_at") @db.Timestamptz(3)
```

`prisma/migrations/20261016000100_budget_onboarding_no_mandatory_plans/migration.sql`:

```sql
-- Onboarding: the owner stated the budget has no mandatory payments.
-- Additive and nullable: existing rows stay NULL, old code ignores the column.
ALTER TABLE "budgets" ADD COLUMN "onboarding_no_mandatory_plans_at" TIMESTAMPTZ(3);
```

Run: `pnpm db:generate` и `pnpm db:migrate` (применяет миграцию к локальной БД из `.env`; не `db:migrate:dev`, чтобы Prisma не создала вторую миграцию).
Expected: миграция применена, клиент сгенерирован.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api test:integration -- v2-dashboard`
Expected: FAIL — в списке ключей нет `mandatoryPlansDeclined`.

- [ ] **Step 4: Implement**

`dashboard-v2.repository.ts`, после `hasMandatoryPlans`:

```ts
  /** True once the owner stated in onboarding that the budget has no mandatory payments. */
  async mandatoryPlansDeclined(
    tx: Prisma.TransactionClient,
    budgetId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const found = await tx.budget.findFirst({
      where: { id: budgetId, workspaceId, onboardingNoMandatoryPlansAt: { not: null } },
      select: { id: true },
    });
    return found !== null;
  }
```

`dashboard-v2.application.service.ts`, тип `onboarding` в `DashboardV2Summary`:

```ts
  onboarding: {
    categoriesSeeded: boolean;
    hasAccounts: boolean;
    needsOpeningAssignment: boolean;
    needsPeriodSetup: boolean;
    hasMandatoryPlans: boolean;
    mandatoryPlansDeclined: boolean;
  };
```

Там же, в объекте `onboarding` возврата `compute()`:

```ts
      onboarding: {
        categoriesSeeded: envelopes.length > 0 || (await repo.hasCategories(tx, budgetId)),
        hasAccounts: accounts.length > 0,
        needsOpeningAssignment: cash > 0n && !hasAssignments,
        needsPeriodSetup: needsSetup,
        hasMandatoryPlans: await repo.hasMandatoryPlans(tx, budgetId, mandatoryIds),
        mandatoryPlansDeclined: await repo.mandatoryPlansDeclined(tx, budgetId, workspaceId),
      },
```

`dashboard-v2.dto.ts`, в конец `DashboardV2OnboardingResponse`:

```ts
  @ApiProperty({
    type: Boolean,
    description: 'Владелец указал в онбординге, что обязательных платежей нет.',
  })
  mandatoryPlansDeclined!: boolean;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/api test:integration -- v2-dashboard`
Expected: PASS.
Run: `pnpm --filter @harmofin/api typecheck`.
Expected: без ошибок.

- [ ] **Step 6: Commit (только с разрешения владельца)**

```bash
git add prisma/schema.prisma prisma/migrations/20261016000100_budget_onboarding_no_mandatory_plans apps/api/src/v2-dashboard apps/api/test/v2-dashboard.integration.test.ts
git commit -m "feat(api): флаг отказа от обязательных платежей в онбординге дашборда"
```

---

### Task 2: Маршрут `POST /onboarding/no-mandatory-plans`

**Files:**
- Create: `apps/api/src/v2-dashboard/onboarding-v2.repository.ts`
- Create: `apps/api/src/v2-dashboard/onboarding-v2.application.service.ts`
- Create: `apps/api/src/v2-dashboard/onboarding-v2.controller.ts`
- Modify: `apps/api/src/v2-dashboard/dashboard-v2.module.ts`
- Create: `apps/api/test/v2-onboarding.integration.test.ts`
- Modify: `apps/api/test/v2-openapi.integration.test.ts:48` (`EXPECTED_V2`)
- Modify: `openapi.json`

**Interfaces:**
- Consumes: `Budget.onboardingNoMandatoryPlansAt` (Task 1); `dashboard.onboarding.mandatoryPlansDeclined` (Task 1).
- Produces: `POST /api/v2/budgets/{budgetId}/onboarding/no-mandatory-plans` → `204`, заголовки `x-csrf-token`, `Idempotency-Key`; `OnboardingV2ApplicationService.declineMandatoryPlans(userId: string, budgetId: string, idempotencyKey: string, requestId?: string): Promise<void>`.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/v2-onboarding.integration.test.ts`:

```ts
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

type User = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  csrfToken: string;
  cookie: string;
};

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUsers: string[] = [];

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
});

afterAll(async () => {
  for (const userId of createdUsers) await cleanupUser(userId);
  await app.close();
  await prisma.$disconnect();
});

describe('v2 onboarding: no mandatory plans', () => {
  it('OWNER: 204, колонка задана, одно audit-событие, дашборд видит флаг', async () => {
    const owner = await register('owner');
    const key = randomUUID();

    const first = await decline(owner, owner.budgetId, key);
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');

    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    expect(budget.onboardingNoMandatoryPlansAt).toBeInstanceOf(Date);
    const audit = await prisma.auditEvent.findMany({
      where: { budgetId: owner.budgetId, entityType: 'budget_onboarding' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: owner.budgetId,
      action: 'MANDATORY_PLANS_DECLINED',
      source: 'API',
      actorUserId: owner.userId,
    });

    const dashboard = await server.inject({
      method: 'GET',
      url: `/api/v2/budgets/${owner.budgetId}/dashboard`,
      headers: authHeaders(owner),
    });
    expect(dashboard.statusCode).toBe(200);
    expect(
      dashboard.json<{ onboarding: { mandatoryPlansDeclined: boolean } }>().onboarding
        .mandatoryPlansDeclined,
    ).toBe(true);
  });

  it('повтор тем же и другим ключом: 204, момент не меняется, второго audit нет', async () => {
    const owner = await register('repeat');
    const key = randomUUID();
    expect((await decline(owner, owner.budgetId, key)).statusCode).toBe(204);
    const stored = (await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } }))
      .onboardingNoMandatoryPlansAt;

    expect((await decline(owner, owner.budgetId, key)).statusCode).toBe(204);
    expect((await decline(owner, owner.budgetId, randomUUID())).statusCode).toBe(204);

    const after = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    expect(after.onboardingNoMandatoryPlansAt?.toISOString()).toBe(stored?.toISOString());
    expect(
      await prisma.auditEvent.count({
        where: { budgetId: owner.budgetId, entityType: 'budget_onboarding' },
      }),
    ).toBe(1);
  });

  it('EDITOR и VIEWER: 403 без записи', async () => {
    const owner = await register('roles-owner');
    for (const role of ['EDITOR', 'VIEWER'] as const) {
      const member = await register(`roles-${role.toLowerCase()}`);
      await prisma.workspaceMembership.create({
        data: { id: randomUUID(), workspaceId: owner.workspaceId, userId: member.userId, role },
      });
      const response = await decline(member, owner.budgetId, randomUUID());
      expect(response.statusCode, role).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
    }
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    expect(budget.onboardingNoMandatoryPlansAt).toBeNull();
  });

  it('чужой бюджет: 404, бюджет B не меняется', async () => {
    const a = await register('isolation-a');
    const b = await register('isolation-b');
    const response = await decline(a, b.budgetId, randomUUID());
    expect(response.statusCode).toBe(404);
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: b.budgetId } });
    expect(budget.onboardingNoMandatoryPlansAt).toBeNull();
  });

  it('бюджет v1: 409 MODEL_VERSION_MISMATCH', async () => {
    const owner = await register('v1');
    await prisma.budget.update({
      where: { id: owner.budgetId },
      data: { planModelVersion: 1, planModelActivatedOn: null },
    });
    const response = await decline(owner, owner.budgetId, randomUUID());
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('MODEL_VERSION_MISMATCH');
  });

  it('без сессии 401, без CSRF 403, без ключа 400', async () => {
    const owner = await register('guards');
    const url = `/api/v2/budgets/${owner.budgetId}/onboarding/no-mandatory-plans`;
    const noSession = await server.inject({ method: 'POST', url, headers: { origin } });
    expect(noSession.statusCode).toBe(401);
    const noCsrf = await server.inject({
      method: 'POST',
      url,
      headers: { ...authHeaders(owner), 'idempotency-key': randomUUID() },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json<{ code: string }>().code).toBe('CSRF_INVALID');
    const noKey = await server.inject({
      method: 'POST',
      url,
      headers: { ...authHeaders(owner), 'x-csrf-token': owner.csrfToken },
    });
    expect(noKey.statusCode).toBe(400);
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: owner.budgetId } });
    expect(budget.onboardingNoMandatoryPlansAt).toBeNull();
  });

  it('OpenAPI описывает маршрут: 204, ошибки, cookie, Idempotency-Key', async () => {
    const openApi = await server.inject({ method: 'GET', url: '/openapi.json' });
    const document = openApi.json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    }>();
    const operation =
      document.paths['/api/v2/budgets/{budgetId}/onboarding/no-mandatory-plans']?.post;
    expect(operation).toBeDefined();
    for (const code of ['204', '400', '401', '403', '404', '409']) {
      expect(operation!.responses[code], code).toBeDefined();
    }
    const text = JSON.stringify(operation);
    expect(text).toContain('session');
    expect(text).toContain('Idempotency-Key');
  });
});

function authHeaders(who: User): Record<string, string> {
  return { origin, cookie: `harmofin_session=${who.cookie}` };
}

function decline(as: User, budgetId: string, key: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v2/budgets/${budgetId}/onboarding/no-mandatory-plans`,
    headers: { ...authHeaders(as), 'x-csrf-token': as.csrfToken, 'idempotency-key': key },
  });
}

async function register(label: string): Promise<User> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email: `v2-onb-${label}-${randomUUID()}@harmofin.test`, password },
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
    csrfToken: body.csrfToken,
    cookie: decodeURIComponent(match![1]!),
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
    await prisma.envelopePeriod.deleteMany({ where });
    await prisma.envelopeFundingRule.deleteMany({ where });
    await prisma.budgetCycleRevision.deleteMany({ where });
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
```

Примечание: регистрация создаёт бюджет модели 2 с заданным `planModelActivatedOn` (`apps/api/src/common/plan-model/new-budget-model.ts`), поэтому `requireModel(…, 2)` проходит без доработки фикстуры. Тест v1 ставит `planModelVersion: 1` и `planModelActivatedOn: null`, что допускает CHECK `budgets_plan_model_v2_activated_on_check`.

В `apps/api/test/v2-openapi.integration.test.ts`, в `EXPECTED_V2` после строки `['post', '/api/v2/budgets/{budgetId}/reference-template/apply'],` добавить:

```ts
  ['post', '/api/v2/budgets/{budgetId}/onboarding/no-mandatory-plans'],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/api test:integration -- v2-onboarding v2-openapi`
Expected: FAIL — маршрут отвечает 404, в OpenAPI нет пути.

- [ ] **Step 3: Implement repository**

`apps/api/src/v2-dashboard/onboarding-v2.repository.ts`:

```ts
import type { Prisma, WorkspaceMembershipRole } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export class OnboardingV2Repository {
  async memberRole(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRole | null> {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  /** Sets the flag only while it is unset; true when this call changed the row. */
  async declineMandatoryPlans(
    tx: Prisma.TransactionClient,
    budgetId: string,
    workspaceId: string,
    declinedAt: Date,
  ): Promise<boolean> {
    const updated = await tx.budget.updateMany({
      where: { id: budgetId, workspaceId, onboardingNoMandatoryPlansAt: null },
      data: { onboardingNoMandatoryPlansAt: declinedAt },
    });
    return updated.count === 1;
  }

  async recordDeclined(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      actorUserId: string;
      requestId: string | undefined;
      declinedAt: Date;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'budget_onboarding',
        entityId: params.budgetId,
        action: 'MANDATORY_PLANS_DECLINED',
        source: 'API',
        requestId: params.requestId ?? null,
        newValues: { declinedAt: params.declinedAt.toISOString() },
      },
    });
  }
}
```

- [ ] **Step 4: Implement application service**

`apps/api/src/v2-dashboard/onboarding-v2.application.service.ts`:

```ts
import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { forbidden } from '../common/reference-data/reference-data.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { OnboardingV2Repository } from './onboarding-v2.repository.js';

const DECLINE_MANDATORY_PLANS_OPERATION = 'DECLINE_MANDATORY_PLANS';
const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

@Injectable()
export class OnboardingV2ApplicationService {
  private readonly rolePolicy = new RolePolicy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly idempotency: IdempotencyService,
    private readonly repository: OnboardingV2Repository,
  ) {}

  /** Records once that the budget has no mandatory payments. Moves no money. */
  async declineMandatoryPlans(
    userId: string,
    budgetId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<void> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ budgetId }))
      .digest('hex');

    await this.prisma.$transaction(
      (tx) =>
        this.idempotency.execute(
          tx,
          {
            budgetId,
            actorUserId: userId,
            key: idempotencyKey,
            operation: DECLINE_MANDATORY_PLANS_OPERATION,
            requestHash,
          },
          async () => {
            const role = await this.repository.memberRole(tx, model.workspaceId, userId);
            if (!role || !this.rolePolicy.canManage(role)) throw forbidden();
            const declinedAt = new Date();
            const changed = await this.repository.declineMandatoryPlans(
              tx,
              budgetId,
              model.workspaceId,
              declinedAt,
            );
            if (changed) {
              await this.repository.recordDeclined(tx, {
                budgetId,
                workspaceId: model.workspaceId,
                actorUserId: userId,
                requestId,
                declinedAt,
              });
            }
            return { status: 204, body: {} };
          },
        ),
      TX_OPTIONS,
    );
  }
}
```

- [ ] **Step 5: Implement controller**

`apps/api/src/v2-dashboard/onboarding-v2.controller.ts`:

```ts
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { uuidParamSchema } from '../cycles/cycle-revision.schemas.js';
import { OnboardingV2ApplicationService } from './onboarding-v2.application.service.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 128 },
} as const;

@ApiTags('onboarding (v2)')
@Controller({ path: 'budgets/:budgetId/onboarding', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class OnboardingV2Controller {
  constructor(
    @Inject(OnboardingV2ApplicationService)
    private readonly service: OnboardingV2ApplicationService,
  ) {}

  @Post('no-mandatory-plans')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Онбординг: обязательных платежей нет',
    description:
      'Отмечает один раз, что в бюджете нет обязательных платежей: шаг «Обязательные платежи» чек-листа считается выполненным (dashboard.onboarding.mandatoryPlansDeclined=true). Денег не двигает, планов не создаёт и не удаляет. Повтор и вызов после уже сделанной отметки — 204 без изменений и без второго audit. Только OWNER. Коды: 400 VALIDATION_FAILED, 401, 403 FORBIDDEN|CSRF_INVALID, 404 RESOURCE_NOT_FOUND, 409 IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiNoContentResponse({ description: 'Отметка сохранена или уже была сохранена.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse, description: 'VALIDATION_FAILED.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({
    status: 403,
    type: ProblemDetailsResponse,
    description: 'FORBIDDEN: не OWNER; CSRF_INVALID.',
  })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsResponse,
    description: 'RESOURCE_NOT_FOUND: бюджет не найден или чужой.',
  })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsResponse,
    description: 'IDEMPOTENCY_CONFLICT, MODEL_VERSION_MISMATCH.',
  })
  async declineMandatoryPlans(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    await this.service.declineMandatoryPlans(context.userId, budgetId, validKey(key), request.id);
  }
}

function validKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 128 || !/^[\x20-\x7e]+$/.test(key)) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Некорректный ключ идемпотентности.',
      fieldErrors: [
        { field: 'Idempotency-Key', message: 'Укажите корректный ключ.', code: 'invalid' },
      ],
    });
  }
  return key;
}
```

`validKey` повторяет `apps/api/src/envelope-plans/envelope-plan.controller.ts:499`; общего хелпера в `common` нет, выносить его в рамках этой задачи не нужно.

- [ ] **Step 6: Register in module**

`apps/api/src/v2-dashboard/dashboard-v2.module.ts`:

```ts
import { DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { DashboardV2Controller } from './dashboard-v2.controller.js';
import { DashboardV2ApplicationService } from './dashboard-v2.application.service.js';
import { DashboardV2Repository } from './dashboard-v2.repository.js';
import { OnboardingV2ApplicationService } from './onboarding-v2.application.service.js';
import { OnboardingV2Controller } from './onboarding-v2.controller.js';
import { OnboardingV2Repository } from './onboarding-v2.repository.js';

@Module({})
export class DashboardV2Module {
  static register(): DynamicModule {
    return {
      module: DashboardV2Module,
      controllers: [DashboardV2Controller, OnboardingV2Controller],
      providers: [
        {
          provide: DashboardV2ApplicationService,
          useFactory: (prisma: PrismaService) =>
            new DashboardV2ApplicationService(
              prisma,
              new PlanModelPolicy(prisma),
              new DashboardV2Repository(prisma),
            ),
          inject: [PrismaService],
        },
        {
          provide: OnboardingV2ApplicationService,
          useFactory: (prisma: PrismaService) =>
            new OnboardingV2ApplicationService(
              prisma,
              new PlanModelPolicy(prisma),
              new IdempotencyService(),
              new OnboardingV2Repository(),
            ),
          inject: [PrismaService],
        },
      ],
      exports: [DashboardV2ApplicationService],
    };
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/api test:integration -- v2-onboarding v2-openapi v2-dashboard`
Expected: PASS. Общие проверки `v2-openapi` перебирают все v2-операции и проходят для нового маршрута: ProblemDetails 400/401/403/404/409, обязательный `Idempotency-Key`, 401 без сессии, 403 `CSRF_INVALID`, отдельный v2 tag `onboarding (v2)`, cookie-auth.

- [ ] **Step 8: Regenerate OpenAPI and check contract**

Run: `node scripts/openapi/generate.mjs`
Run: `git show main:openapi.json > openapi.base.json` и `node scripts/openapi/check.mjs openapi.json openapi.base.json`, затем удалить `openapi.base.json`.
Expected: `OpenAPI contract check passed.`; в `git diff openapi.json` только новый путь, тег и поле `mandatoryPlansDeclined`.

- [ ] **Step 9: Lint and typecheck**

Run: `pnpm lint` и `pnpm typecheck`
Expected: без ошибок.

- [ ] **Step 10: Commit (только с разрешения владельца)**

```bash
git add apps/api/src/v2-dashboard apps/api/test/v2-onboarding.integration.test.ts apps/api/test/v2-openapi.integration.test.ts openapi.json
git commit -m "feat(api): POST onboarding/no-mandatory-plans для шага обязательных платежей"
```

---

### Task 3: Чек-лист — порядок шагов и «У меня их нет»

**Files:**
- Modify: `apps/web/app/composables/useEnvelopePlanV2.ts:250-256` (тип), блок `return` (метод)
- Modify: `apps/web/app/components/dashboard/OnboardingChecklist.vue`
- Test: `apps/web/app/components/dashboard/OnboardingChecklist.test.ts`
- Modify fixtures: `apps/web/app/components/dashboard/AvailableBudgetCard.test.ts:42-48`, `apps/web/app/pages/app/index.test.ts:141-147`

**Interfaces:**
- Consumes: `onboarding.mandatoryPlansDeclined` (Task 1); `POST .../onboarding/no-mandatory-plans` (Task 2).
- Produces: `useEnvelopePlanV2().declineMandatoryPlans(budgetId: string, idempotencyKey: string): Promise<void>`; шаги с `data-step` в порядке `categoriesSeeded`, `hasAccounts`, `hasMandatoryPlans`, `periodSetup`, `openingAssignment`; кнопка `data-testid="onboarding-mandatory-decline"`, ссылка `data-testid="onboarding-mandatory-add"`, ошибка `data-testid="onboarding-mandatory-error"`.

- [ ] **Step 1: Write the failing tests**

В `OnboardingChecklist.test.ts`:

1. В `mocks.v2` добавить `declineMandatoryPlans: vi.fn(),`.
2. В `v2Onboarding` добавить `mandatoryPlansDeclined: false,`. Во всех inline-объектах `dashboard({...})` этого файла с полным набором флагов добавить `mandatoryPlansDeclined: false` (иначе typecheck).
3. Добавить в `describe('OnboardingChecklist')`:

```ts
  it('orders the steps: accounts, mandatory payments, period plan, then money', async () => {
    const { wrapper } = mountChecklist();
    await flushPromises();

    expect(
      wrapper.findAll('[data-testid="onboarding-step"]').map((row) => row.attributes('data-step')),
    ).toEqual([
      'categoriesSeeded',
      'hasAccounts',
      'hasMandatoryPlans',
      'periodSetup',
      'openingAssignment',
    ]);
  });

  describe('mandatory payments step', () => {
    const mandatoryRow = (wrapper: ReturnType<typeof mountChecklist>['wrapper']) =>
      wrapper.get('[data-step="hasMandatoryPlans"]');

    it('offers to add a payment or to state there are none', async () => {
      const { wrapper } = mountChecklist();
      await flushPromises();

      const row = mandatoryRow(wrapper);
      expect(row.get('[data-testid="onboarding-mandatory-add"]').attributes('href')).toBe(
        '/app/plans',
      );
      expect(row.get('[data-testid="onboarding-mandatory-decline"]').text()).toBe(
        'У меня их нет',
      );
    });

    it('counts the step done when the owner declined mandatory payments', async () => {
      mocks.v2.getDashboard.mockResolvedValue(
        dashboard({ ...v2Onboarding, mandatoryPlansDeclined: true }),
      );
      const { wrapper } = mountChecklist();
      await flushPromises();

      const row = mandatoryRow(wrapper);
      expect(row.find('[data-testid="onboarding-step-done"]').exists()).toBe(true);
      expect(row.text()).toContain('Обязательных платежей нет.');
      expect(row.find('[data-testid="onboarding-mandatory-decline"]').exists()).toBe(false);
    });

    it('declines on click, rereads the status and announces it', async () => {
      mocks.v2.declineMandatoryPlans.mockResolvedValue(undefined);
      const { wrapper } = mountChecklist();
      await flushPromises();
      mocks.v2.getDashboard.mockResolvedValue(
        dashboard({ ...v2Onboarding, mandatoryPlansDeclined: true }),
      );

      await mandatoryRow(wrapper).get('[data-testid="onboarding-mandatory-decline"]').trigger('click');
      await flushPromises();

      expect(mocks.v2.declineMandatoryPlans).toHaveBeenCalledWith('budget-1', expect.any(String));
      expect(mocks.v2.getDashboard).toHaveBeenCalledTimes(2);
      expect(wrapper.get('[data-testid="onboarding-notice"]').text()).toBe(
        'Шаг «Обязательные платежи» пропущен.',
      );
      expect(mandatoryRow(wrapper).find('[data-testid="onboarding-step-done"]').exists()).toBe(
        true,
      );
    });

    it('shows the error, keeps the step open and reuses the key on retry', async () => {
      mocks.v2.declineMandatoryPlans.mockRejectedValueOnce(new Error('network'));
      const { wrapper } = mountChecklist();
      await flushPromises();

      const button = () =>
        mandatoryRow(wrapper).get('[data-testid="onboarding-mandatory-decline"]');
      await button().trigger('click');
      await flushPromises();

      expect(mandatoryRow(wrapper).get('[data-testid="onboarding-mandatory-error"]').text()).toContain(
        'Не удалось',
      );
      expect(mandatoryRow(wrapper).find('[data-testid="onboarding-step-done"]').exists()).toBe(
        false,
      );

      mocks.v2.declineMandatoryPlans.mockResolvedValueOnce(undefined);
      await button().trigger('click');
      await flushPromises();
      const [first, second] = mocks.v2.declineMandatoryPlans.mock.calls;
      expect(second![1]).toBe(first![1]);
    });

    it('sends a single request for a double click while pending', async () => {
      let resolve: () => void = () => {};
      mocks.v2.declineMandatoryPlans.mockReturnValue(
        new Promise<void>((done) => {
          resolve = done;
        }),
      );
      const { wrapper } = mountChecklist();
      await flushPromises();

      const button = mandatoryRow(wrapper).get('[data-testid="onboarding-mandatory-decline"]');
      await button.trigger('click');
      await button.trigger('click');
      resolve();
      await flushPromises();

      expect(mocks.v2.declineMandatoryPlans).toHaveBeenCalledTimes(1);
    });
  });

  it('warns on the money step until mandatory payments are settled', async () => {
    const { wrapper } = mountChecklist();
    await flushPromises();
    const warning = 'Сначала добавьте обязательные платежи — иначе на них ничего не будет отложено.';
    expect(wrapper.get('[data-step="openingAssignment"]').text()).toContain(warning);

    mocks.v2.getDashboard.mockResolvedValue(
      dashboard({ ...v2Onboarding, hasMandatoryPlans: true }),
    );
    useFundingEntry().markConfirmed();
    await flushPromises();
    expect(wrapper.get('[data-step="openingAssignment"]').text()).not.toContain(warning);
  });
```

`useFundingEntry().markConfirmed()` увеличивает `confirmedCount`, на который чек-лист перечитывает статус.

В `AvailableBudgetCard.test.ts` и `index.test.ts` добавить `mandatoryPlansDeclined: false,` в объект `onboarding` фикстуры.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- OnboardingChecklist`
Expected: FAIL — порядок другой, кнопки «У меня их нет» нет.

- [ ] **Step 3: Add the API call and type**

`useEnvelopePlanV2.ts`, тип `onboarding`:

```ts
  onboarding: {
    categoriesSeeded: boolean;
    hasAccounts: boolean;
    needsOpeningAssignment: boolean;
    needsPeriodSetup: boolean;
    hasMandatoryPlans: boolean;
    mandatoryPlansDeclined: boolean;
  };
```

В объекте `return` рядом с `rejectPeriodTarget`:

```ts
    declineMandatoryPlans: (budgetId: string, idempotencyKey: string) =>
      postKeyed<void>(`${base(budgetId)}/onboarding/no-mandatory-plans`, {}, idempotencyKey),
```

- [ ] **Step 4: Implement the checklist changes**

`OnboardingChecklist.vue`, `<script setup>`:

1. Тип действия:

```ts
type StepAction = 'template' | 'assign' | 'target' | 'mandatory' | 'link';
```

2. Заменить `steps` целиком:

```ts
const MONEY_STEP_WARNING =
  'Сначала добавьте обязательные платежи — иначе на них ничего не будет отложено.';

function mandatoryStep(status: V2Onboarding): Step {
  const done = status.hasMandatoryPlans || status.mandatoryPlansDeclined;
  return {
    key: 'hasMandatoryPlans',
    title: 'Обязательные платежи',
    description:
      status.mandatoryPlansDeclined && !status.hasMandatoryPlans
        ? 'Обязательных платежей нет. Если появятся, добавьте их в «Планах».'
        : 'Добавьте регулярные обязательные платежи: аренду, коммунальные услуги, кредиты. Из них складывается сумма, которую нужно отложить в «Обязательные».',
    href: '/app/plans',
    linkLabel: 'Перейти',
    action: done ? 'link' : 'mandatory',
    done,
  };
}

const steps = computed<Step[]>(() => {
  const status = v2Status.value;
  if (!status) return [];
  const mandatory = mandatoryStep(status);
  const assignDone = status.hasAccounts && !status.needsOpeningAssignment;
  const assignBase =
    'Распределите деньги со счетов по конвертам или оставьте свободными: это можно сделать позже.';
  return [
    {
      key: 'categoriesSeeded',
      title: 'Базовые категории и конверты',
      description:
        'Посмотрите, что создастся, и подтвердите. Целевые суммы и накопления необязательны.',
      href: '/app/settings',
      linkLabel: 'Перейти',
      action: 'template',
      done: status.categoriesSeeded,
    },
    {
      key: 'hasAccounts',
      title: 'Счета',
      description: 'Добавьте счета, на которых реально лежат деньги, с их текущим остатком.',
      href: '/app/accounts',
      linkLabel: 'Перейти',
      action: 'link',
      done: status.hasAccounts,
    },
    mandatory,
    periodStep(status),
    {
      key: 'openingAssignment',
      title: 'Назначить имеющиеся деньги',
      description:
        !assignDone && !mandatory.done ? `${assignBase} ${MONEY_STEP_WARNING}` : assignBase,
      href: '/app/accounts',
      linkLabel: 'Перейти',
      action: 'assign',
      done: assignDone,
    },
  ];
});
```

3. Действие отказа (после `decideTarget`):

```ts
// One Idempotency-Key per decline attempt: a retry after a failure reuses it.
let declineKey: string | null = null;
const declinePending = ref(false);
const declineError = ref('');

async function declineMandatoryPlans(): Promise<void> {
  if (declinePending.value) return;
  declinePending.value = true;
  declineError.value = '';
  try {
    declineKey ??= crypto.randomUUID();
    await v2.declineMandatoryPlans(props.budgetId, declineKey);
    declineKey = null;
    decisionNotice.value = 'Шаг «Обязательные платежи» пропущен.';
    await loadV2Status();
  } catch (error) {
    declineError.value = v2ErrorMessage(
      error,
      'Не удалось сохранить. Попробуйте ещё раз.',
    );
  } finally {
    declinePending.value = false;
  }
}
```

`<template>`: внутри `<span class="onboarding-checklist__body">`, после блока `<template v-if="step.action === 'target' && proposal">…</template>`, добавить:

```vue
            <span
              v-if="step.action === 'mandatory' && declineError"
              class="onboarding-checklist__error"
              role="alert"
              data-testid="onboarding-mandatory-error"
            >
              <AlertTriangle :size="14" aria-hidden="true" />
              {{ declineError }}
            </span>
```

После блока `<div v-if="step.action === 'target'" …>…</div>` добавить ветку (до `v-else-if="step.action === 'template'"`):

```vue
          <div v-else-if="step.action === 'mandatory'" class="onboarding-checklist__actions">
            <UiButton
              variant="tertiary"
              size="sm"
              :to="step.href"
              data-testid="onboarding-mandatory-add"
            >
              Добавить платёж
            </UiButton>
            <UiButton
              variant="secondary"
              size="sm"
              :loading="declinePending"
              data-testid="onboarding-mandatory-decline"
              @click="declineMandatoryPlans"
            >
              У меня их нет
            </UiButton>
          </div>
```

Класс `onboarding-checklist__actions` уже есть в стилях (используется для плана периода), новые стили не нужны.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/web test -- OnboardingChecklist AvailableBudgetCard index`
Expected: PASS, в том числе старые тесты («only hasAccounts is done» — 1 выполненный шаг, «marks the assignment step done» — 3).

Run: `pnpm typecheck` и `pnpm lint`
Expected: без ошибок.

- [ ] **Step 6: Commit (только с разрешения владельца)**

```bash
git add apps/web/app/composables/useEnvelopePlanV2.ts apps/web/app/components/dashboard apps/web/app/pages/app/index.test.ts
git commit -m "feat(web): новый порядок шагов онбординга и «У меня их нет» для обязательных платежей"
```

---

### Task 4: Страница «Счета» — без авто-окна при первичной настройке

**Files:**
- Modify: `apps/web/app/pages/app/accounts.vue:31`, `:52`, `:230-237`
- Test: `apps/web/app/pages/app/accounts.test.ts`

**Interfaces:**
- Consumes: `useEnvelopePlanV2().getDashboard(budgetId)` → `{ onboarding: { needsOpeningAssignment: boolean } }`.
- Produces: поведение страницы; данные-атрибуты не добавляются.

- [ ] **Step 1: Write the failing tests**

В `accounts.test.ts`:

1. В `vi.hoisted` добавить `v2: { getDashboard: vi.fn() },`.
2. После существующих `vi.mock`:

```ts
vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
```

3. В `beforeEach` добавить по умолчанию «первичная настройка позади»:

```ts
    mocks.v2.getDashboard.mockResolvedValue({ onboarding: { needsOpeningAssignment: false } });
```

4. Существующий тест «offers the optional opening assignment…» переименовать в `'offers the opening assignment once money has been assigned before'` и добавить в его конец:

```ts
    expect(mocks.v2.getDashboard).toHaveBeenCalledWith('budget-id');
```

5. Добавить:

```ts
  it('does not open the assignment during the initial setup and points to the checklist', async () => {
    useFundingEntry().dismiss();
    mocks.v2.getDashboard.mockResolvedValue({ onboarding: { needsOpeningAssignment: true } });

    await createWithBalance('1000');

    expect(useFundingEntry().request.value).toBeNull();
    const toast = useToast().toasts.value.at(-1);
    expect(toast?.title).toBe('Счёт создан');
    expect(toast?.description).toBe(
      'Распределить деньги по конвертам можно на шаге «Назначить имеющиеся деньги» на главной.',
    );
  });

  it('does not open the assignment when the onboarding status cannot be read', async () => {
    useFundingEntry().dismiss();
    mocks.v2.getDashboard.mockRejectedValue(new Error('network'));

    await createWithBalance('1000');

    expect(useFundingEntry().request.value).toBeNull();
    expect(useToast().toasts.value.at(-1)?.title).toBe('Счёт создан');
  });
```

6. В тесте «offers nothing for a zero starting balance» добавить в конец:

```ts
    expect(mocks.v2.getDashboard).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- pages/app/accounts`
Expected: FAIL — окно открывается при `needsOpeningAssignment: true`, `getDashboard` не вызывается.

- [ ] **Step 3: Implement**

`accounts.vue`, импорт рядом с `useFundingEntry`:

```ts
import { useEnvelopePlanV2 } from '../../composables/useEnvelopePlanV2.js';
```

После `const funding = useFundingEntry();`:

```ts
const v2 = useEnvelopePlanV2();
```

Новая функция рядом с `hasPositiveAmount`:

```ts
// The opening assignment opens right away only once the initial setup is over:
// before the first assignment the checklist leads to it after the mandatory
// payments and the period plan. The server decides; a failed read never opens it.
async function initialSetupPending(budgetId: string): Promise<boolean> {
  try {
    return (await v2.getDashboard(budgetId)).onboarding.needsOpeningAssignment;
  } catch {
    return true;
  }
}
```

Заменить блок после `await loadAccounts();` в ветке создания:

```ts
      await api.createAccount(id, input);
      await loadAccounts();
      statusMessage.value = 'Счёт создан.';
      // Envelope Plan v2.2: initial money may be assigned, but only if the user
      // wants to; the account and its balance are already saved either way.
      const offerAssignment =
        hasPositiveAmount(input.startingBalance) && !(await initialSetupPending(id));
      push({
        tone: 'success',
        title: 'Счёт создан',
        ...(hasPositiveAmount(input.startingBalance) && !offerAssignment
          ? {
              description:
                'Распределить деньги по конвертам можно на шаге «Назначить имеющиеся деньги» на главной.',
            }
          : {}),
      });
      if (offerAssignment) funding.offer({ sourceKind: 'OPENING' });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/web test -- pages/app/accounts`
Expected: PASS (включая «announces a created account through a toast» с остатком `0,00`).

Run: `pnpm typecheck` и `pnpm lint`
Expected: без ошибок.

- [ ] **Step 5: Commit (только с разрешения владельца)**

```bash
git add apps/web/app/pages/app/accounts.vue apps/web/app/pages/app/accounts.test.ts
git commit -m "feat(web): не открывать распределение после создания счёта до конца онбординга"
```

---

### Task 5: E2E под новый порядок (проверяет CI)

**Files:**
- Modify: `e2e/envelope-v2-onboarding.spec.ts:174-190`
- Modify: `e2e/envelope-v2-payments.spec.ts:110-115`
- Modify: `e2e/envelope-v2-period.spec.ts:109-114`
- Modify: `e2e/reference-data.spec.ts:16-22`, `:113-123`
- Modify: `e2e/reference-lists.spec.ts:40-53`

**Interfaces:**
- Consumes: поведение Tasks 3–4; `data-step`, `data-testid="onboarding-mandatory-decline"`.

Во всех этих сценариях первый счёт создаётся в свежем бюджете без назначений, поэтому окно «Назначить деньги» больше не открывается, а `POST /funding/preview` не уходит. Ожидание этого ответа повиснет — его нужно убрать.

- [ ] **Step 1: `envelope-v2-onboarding.spec.ts`**

Заменить шаг 7 (от комментария `// 7. Account with opening money…` до `await expect(offer).toBeHidden();`):

```ts
      // 7. Account with opening money, no income: no assignment dialog during the
      // initial setup; the toast points to the checklist step instead.
      await createAccount(page, 'Основная карта', OPENING_TYPED);
      await expect(page.getByTestId('toast-stack')).toContainText(
        'Распределить деньги по конвертам можно на шаге «Назначить имеющиеся деньги» на главной.',
      );
      await expect(page.getByRole('dialog', { name: 'Назначить деньги' })).toHaveCount(0);
```

После `await page.goto('/app');` в том же тесте (перед ожиданием `onboarding-assign-money`) добавить проверку порядка и отказа:

```ts
      await expect(page.getByTestId('onboarding-step')).toHaveCount(5);
      expect(
        await page
          .getByTestId('onboarding-step')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-step'))),
      ).toEqual(['categoriesSeeded', 'hasAccounts', 'hasMandatoryPlans', 'periodSetup', 'openingAssignment']);
      await page.getByTestId('onboarding-mandatory-decline').click();
      await expect(
        page.locator('[data-step="hasMandatoryPlans"] [data-testid="onboarding-step-done"]'),
      ).toBeVisible();
```

Проверки `postponed.*` (cash, freeToAssign, `needsOpeningAssignment === true`) оставить без изменений.

- [ ] **Step 2: `envelope-v2-payments.spec.ts`**

Заменить:

```ts
  // 1. Account with opening money: the offer is postponed with Escape.
  await createAccount(page, 'Основная карта', OPENING_TYPED);
  const openingOffer = page.getByRole('dialog', { name: 'Назначить деньги' });
  await expect(openingOffer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(openingOffer).toBeHidden();
```

на:

```ts
  // 1. Account with opening money: no assignment dialog before the first assignment.
  await createAccount(page, 'Основная карта', OPENING_TYPED);
  await expect(page.getByTestId('toast-stack')).toContainText('Счёт создан');
  await expect(page.getByRole('dialog', { name: 'Назначить деньги' })).toHaveCount(0);
```

- [ ] **Step 3: `envelope-v2-period.spec.ts`**

Заменить:

```ts
        // Account with 100 000; the opening offer is postponed.
        await createAccount(page, 'Основная карта', '100 000,00');
        const offer = page.getByRole('dialog', { name: 'Назначить деньги' });
        await expect(offer).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(offer).toBeHidden();
```

на:

```ts
        // Account with 100 000; no assignment dialog before the first assignment.
        await createAccount(page, 'Основная карта', '100 000,00');
        await expect(page.getByTestId('toast-stack')).toContainText('Счёт создан');
        await expect(page.getByRole('dialog', { name: 'Назначить деньги' })).toHaveCount(0);
```

- [ ] **Step 4: `reference-data.spec.ts`**

Заменить строки 16–22:

```ts
  // A positive opening balance makes the app offer "Назначить деньги" (a drawer).
  const fundingPreview = page.waitForResponse(
    (response) =>
      response.url().includes('/funding/preview') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await dismissFundingOffer(page, fundingPreview);
```

на:

```ts
  // Before the first assignment no "Назначить деньги" dialog opens after saving.
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByTestId('toast-stack')).toContainText('Счёт создан');
  await expect(page.getByRole('dialog', { name: 'Назначить деньги' })).toHaveCount(0);
```

Удалить функцию `dismissFundingOffer` (строки 113–123 с комментарием над ней), если других вызовов нет (`grep -n dismissFundingOffer e2e/reference-data.spec.ts` после правки должен быть пуст).

- [ ] **Step 5: `reference-lists.spec.ts`**

Заменить строки 40–53 (от комментария `// A positive opening balance…` до закрывающей `}` блока `if`):

```ts
  // Before the first assignment no "Назначить деньги" dialog opens after saving.
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByRole('dialog', { name: 'Назначить деньги' })).toHaveCount(0);
```

Строку `await expect(page.getByTestId('account-card-select').first()).toBeVisible();` после блока оставить.

- [ ] **Step 6: Static checks (без запуска Playwright)**

Run: `pnpm format:check`
Run: `grep -rnE "funding/preview|funding-later|dismissFundingOffer" e2e/envelope-v2-onboarding.spec.ts e2e/envelope-v2-payments.spec.ts e2e/envelope-v2-period.spec.ts e2e/reference-data.spec.ts e2e/reference-lists.spec.ts`
Expected: форматирование в порядке; grep ничего не находит. `pnpm lint` рекурсивно не охватывает `e2e/`, поэтому типы спеков проверит CI. Запуск E2E — в CI после пуша, по решению владельца.

- [ ] **Step 7: Commit (только с разрешения владельца)**

```bash
git add e2e/envelope-v2-onboarding.spec.ts e2e/envelope-v2-payments.spec.ts e2e/envelope-v2-period.spec.ts e2e/reference-data.spec.ts e2e/reference-lists.spec.ts
git commit -m "test(e2e): онбординг без авто-окна распределения после первого счёта"
```

---

### Task 6: Финальная проверка и ревью

- [ ] **Step 1: Full named checks**

Run: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`
Expected: все зелёные. Падение в несвязанной области — сообщить владельцу, не чинить в этой задаче.

- [ ] **Step 2: Inspect diff**

Run: `git status` и `git diff --stat`
Expected: только файлы из «File Structure» плюс спека и план; `identity/logo_description.png` не затронут.

- [ ] **Step 3: Reviews**

По матрице маршрутизации: API review (маршрут, DTO, `openapi.json`), Security review (OWNER, budget isolation, CSRF, audit без чувствительных данных), Backend review (миграция, транзакция, идемпотентность), UI/UX review (чек-лист, кнопки, `role="alert"`/`role="status"`, фокус, тексты), QA review (покрытие), final review. Financial review не нужен: денег маршрут не двигает и формулы не меняются.

- [ ] **Step 4: Report to owner and stop**

Краткий итог: что сделано, результаты проверок, что ждёт CI (E2E), коммиты не сделаны без разрешения.
