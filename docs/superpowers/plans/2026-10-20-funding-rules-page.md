# Страница «Правила пополнения» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Отдельная страница `/app/envelopes/rules`, где очередь распределения дохода видна и меняется перетаскиванием и кнопками, правило каждого конверта задаётся в его карточке, всё сохраняется одной кнопкой; текущее правило видно в деталях конверта.

**Architecture:** API — два новых эндпоинта в `EnvelopePlanController` (`GET`/`PUT /api/v2/budgets/:budgetId/funding-rules`) поверх нового `FundingRulesBatchApplicationService`; пакетное сохранение правил и «предложения для дохода» идёт одной транзакцией под `lockBudget` с идемпотентностью и audit только реальных изменений. Web — чистая модель состояния редактора (`rules-editor-state.ts`), composable перетаскивания на pointer events (`useSortableList.ts`), компоненты `FundingRuleCard`/`FundingRulesEditor`, страница `pages/app/envelopes/rules.vue`; блок цели периода выносится из удаляемого `RuleSettingsSheet` в `PeriodTargetDialog`.

**Tech Stack:** NestJS/Fastify, Prisma, PostgreSQL 18, Zod 4, Vitest (unit + integration), Nuxt 4 / Vue 3.5, `@vue/test-utils`, happy-dom, `@lucide/vue`, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-20-funding-rules-page-design.md](../specs/2026-10-20-funding-rules-page-design.md)

## Global Constraints

- Деньги — только строки и `bigint`, без `number` для сумм. В API: `fixedAmount` — десятичная строка рублей на вход, `fixedAmountMinor` — строка минорных единиц на выход.
- `priority` присваивает сервер: `queue[i]` → `(i + 1) * 10`; `outside` (только `MANUAL`) → `0`. Клиент `priority` в пакетный PUT не передаёт.
- Каждый запрос к данным фильтрует `budget_id` в самом запросе.
- Пакетный PUT: одна транзакция, `lockBudget`, `Idempotency-Key`, только OWNER (`RolePolicy.canManage`), `CsrfGuard`; любая ошибка — ничего не сохранено.
- Неизменённое правило/предложение не перезаписывается и не получает audit.
- Одиночные `PUT envelopes/:envelopeId/funding-rule` и `PUT income-category-suggestion` не меняются; `/api/v1` не трогается; миграций БД нет.
- Тексты интерфейса — русский; имена в коде — английские.
- Новых npm-зависимостей нет.
- Local Playwright не запускать; E2E-сценарий выполняется в CI.
- Не коммитить без явного разрешения владельца: шаг «Commit» выполняется только после его «да» (правило репозитория).
- Не трогать `identity/logo_description.png`.

## Уточнения относительно спеки

1. Ошибки 404 «конверт/категория не из этого бюджета» остаются без `fieldErrors` (как во всех соседних эндпоинтах, чтобы не раскрывать чужие id). `fieldErrors` с путём есть у 400 (форма) и у 422 (`ENVELOPE_ARCHIVED`, `FUNDING_RULE_TYPE_NOT_ALLOWED`, `CATEGORY_ARCHIVED`, `CATEGORY_TYPE_MISMATCH`).
2. При выключенном предложении клиент передаёт выбранные id как есть (или `null`), чтобы выключение не стирало выбор. Сервер это уже допускает.
3. Тексты подсказок к типам правил берутся из текущих `TYPE_HINTS` в `RuleSettingsSheet.vue` и переезжают в `funding-rule-text.ts`.

## Файлы

API:
- Modify `apps/api/src/envelope-plans/envelope-plan.schemas.ts` — `putFundingRulesBatchSchema`, общий `refineRuleFields`.
- Modify `apps/api/src/envelope-plans/funding-rule.repository.ts` — `listRules`, `toRuleBody`, `sameRule`.
- Modify `apps/api/src/envelope-plans/envelope-plan.repository.ts` — `findManyByIds`.
- Modify `apps/api/src/funding/income-category-suggestion.repository.ts` — `find`.
- Modify `apps/api/src/funding/income-category-suggestion.application.service.ts` — вынести `assertSuggestionReferences`.
- Create `apps/api/src/envelope-plans/funding-rules-batch.application.service.ts`.
- Modify `apps/api/src/envelope-plans/envelope-plan.dto.ts`, `envelope-plan.controller.ts`, `envelope-plan.module.ts`.
- Create `apps/api/test/v2-funding-rules-batch.integration.test.ts`.
- Modify `openapi.json` (перегенерация).

Web:
- Modify `apps/web/app/composables/useEnvelopePlanV2.ts` — типы и методы `listFundingRules`, `saveFundingRules`.
- Create `apps/web/app/components/funding-rules/funding-rule-text.ts` (+ `.test.ts`).
- Create `apps/web/app/components/funding-rules/rules-editor-state.ts` (+ `.test.ts`).
- Create `apps/web/app/composables/useSortableList.ts` (+ `.test.ts`).
- Create `apps/web/app/components/funding-rules/FundingRuleCard.vue`, `FundingRulesEditor.vue` (+ `FundingRulesEditor.test.ts`).
- Move `apps/web/app/pages/app/envelopes.vue` → `apps/web/app/pages/app/envelopes/index.vue`, `envelopes.v2.test.ts` → `envelopes/index.v2.test.ts`.
- Create `apps/web/app/pages/app/envelopes/rules.vue` (+ `rules.test.ts`).
- Create `apps/web/app/components/envelopes/PeriodTargetDialog.vue` (+ `.test.ts`).
- Modify `apps/web/app/components/envelopes/EnvelopePlanDialog.vue`, `EnvelopesPlanView.vue`.
- Create `apps/web/app/components/envelopes/EnvelopesPlanView.target.test.ts`.
- Delete `apps/web/app/components/funding/RuleSettingsSheet.vue`, `RuleSettingsSheet.test.ts`, `apps/web/app/components/envelopes/EnvelopesPlanView.rules.test.ts`.

E2E:
- Create `e2e/envelope-v2-funding-rules.spec.ts`.

## Как запускать проверки

- API unit/type: `pnpm --filter @harmofin/api typecheck`, `pnpm --filter @harmofin/api lint`.
- API integration (нужны `pnpm infra:up` и применённые миграции тестовой БД, как для остальных `v2-*` тестов): `pnpm --filter @harmofin/api test:integration -- test/v2-funding-rules-batch.integration.test.ts`.
- Web: `pnpm --filter @harmofin/web test -- <path>`, `pnpm --filter @harmofin/web typecheck`, `pnpm --filter @harmofin/web lint`.
- OpenAPI: `node scripts/openapi/generate.mjs` (пишет `openapi.json` в корень).

---

### Task 1: API — чтение правил `GET funding-rules`

**Files:**
- Modify: `apps/api/src/envelope-plans/funding-rule.repository.ts`
- Create: `apps/api/src/envelope-plans/funding-rules-batch.application.service.ts`
- Modify: `apps/api/src/envelope-plans/envelope-plan.dto.ts`
- Modify: `apps/api/src/envelope-plans/envelope-plan.controller.ts`
- Modify: `apps/api/src/envelope-plans/envelope-plan.module.ts`
- Create: `apps/api/test/v2-funding-rules-batch.integration.test.ts`

**Interfaces:**
- Produces: `FundingRuleRepository.listRules(tx, budgetId): Promise<FundingRuleRecord[]>`; `toRuleBody(rule: FundingRuleRecord): FundingRuleBody` (экспорт из `funding-rule.repository.ts`); `FundingRulesBatchApplicationService.list(userId, budgetId): Promise<{ status: number; body: { items: FundingRuleBody[] } }>`; DTO `FundingRuleListResponse`; маршрут `GET /api/v2/budgets/{budgetId}/funding-rules`.

- [ ] **Step 1: Создать тестовый файл с окружением и тестом GET**

Создать `apps/api/test/v2-funding-rules-batch.integration.test.ts`. Окружение копируется из `apps/api/test/v2-funding-rules.integration.test.ts` (строки 1–135 и 1069–1252) с такими отличиями: префикс email `v2-batch-`, без импортов `AssignmentBalanceRepository`, `IncomeCategorySuggestionApplicationService` и без функций `putRule`, `putTarget`, `postTarget`, `auditCount`, `openPeriod`, `balanceOf`, `cashOf`.

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
    // ← скопировать тело beforeAll из v2-funding-rules.integration.test.ts строки 66–122
    //   (createApiApp, register, planModelVersion 2 для owner и outsider, VIEWER/EDITOR, account).
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
        { id: randomUUID(), budgetId, envelopeId: savings, type: 'PERCENT_OF_INCOME', priority: 20, percentBasisPoints: 1000 },
        { id: randomUUID(), budgetId, envelopeId: currentA, type: 'FIXED_PER_PERIOD', priority: 10, fixedMinor: 1_500_000n },
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
});

// ← afterAll, authHeaders, mutationHeaders, register, createEnvelope, cleanupUser
//   скопировать без изменений из v2-funding-rules.integration.test.ts (строки 1069–1086, 1168–1252).

async function createCategory(
  budgetId: string,
  categoryType: 'INCOME' | 'EXPENSE',
  name: string,
): Promise<string> {
  const category = await prisma.category.create({
    data: { id: randomUUID(), budgetId, name, categoryType },
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
```

Если `prisma.category.create` требует ещё обязательных полей, взять их набор из `apps/api/test/reference-data.integration.test.ts` (поиск `category.create`).

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-rules-batch.integration.test.ts`
Expected: FAIL, `GET .../funding-rules` возвращает 404 (маршрута нет).

- [ ] **Step 3: Репозиторий — `listRules` и `toRuleBody`**

В `apps/api/src/envelope-plans/funding-rule.repository.ts` добавить импорт `formatMinorUnits` и экспорт тела ответа (перенос типа из `period-target.application.service.ts`, чтобы оба сервиса пользовались одним):

```ts
import { formatMinorUnits } from '../common/money/minor-units.js';

export type FundingRuleBody = {
  id: string;
  envelopeId: string;
  type: string;
  priority: number;
  fixedAmountMinor: string | null;
  percentBasisPoints: number | null;
};

export function toRuleBody(rule: FundingRuleRecord): FundingRuleBody {
  return {
    id: rule.id,
    envelopeId: rule.envelopeId,
    type: rule.type,
    priority: rule.priority,
    fixedAmountMinor: rule.fixedMinor === null ? null : formatMinorUnits(rule.fixedMinor),
    percentBasisPoints: rule.percentBasisPoints,
  };
}
```

В класс `FundingRuleRepository` добавить:

```ts
  /** All saved rules of the budget in the preview order: priority, then envelope id. */
  async listRules(tx: Prisma.TransactionClient, budgetId: string): Promise<FundingRuleRecord[]> {
    return tx.envelopeFundingRule.findMany({
      where: { budgetId },
      select: RULE_SELECT,
      orderBy: [{ priority: 'asc' }, { envelopeId: 'asc' }],
    });
  }
```

В `period-target.application.service.ts` удалить локальный `export type FundingRuleBody = {...}`, импортировать `type FundingRuleBody, toRuleBody` из `./funding-rule.repository.js` и заменить литерал тела в `putFundingRule` на `body: toRuleBody(rule)`. Проверить, что больше никто не импортирует `FundingRuleBody` из `period-target.application.service.js`: `grep -rn "FundingRuleBody" apps/api/src` — при наличии поменять путь импорта.

- [ ] **Step 4: Сервис `FundingRulesBatchApplicationService.list`**

Создать `apps/api/src/envelope-plans/funding-rules-batch.application.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { type FundingRuleBody, FundingRuleRepository, toRuleBody } from './funding-rule.repository.js';

/**
 * Funding rules of a whole budget: one read of the queue and one atomic save of the queue
 * order, every envelope rule and the income-category suggestion. Rules are settings: saving
 * them never moves money, never touches assignments, balances or confirmed period targets.
 */
@Injectable()
export class FundingRulesBatchApplicationService {
  private readonly rules = new FundingRuleRepository();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
  ): Promise<{ status: number; body: { items: FundingRuleBody[] } }> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      const rules = await this.rules.listRules(tx, budgetId);
      return { status: 200, body: { items: rules.map(toRuleBody) } };
    });
  }
}
```

`requireModel` уже проверяет активное членство в рабочем пространстве бюджета (чужой бюджет → 404).

- [ ] **Step 5: DTO, маршрут, модуль**

В `envelope-plan.dto.ts` после класса `FundingRuleResponse` добавить:

```ts
export class FundingRuleListResponse {
  @ApiProperty({ type: [FundingRuleResponse] })
  items!: FundingRuleResponse[];
}
```

В `envelope-plan.controller.ts`: импортировать `FundingRuleListResponse` и `FundingRulesBatchApplicationService`, добавить в конструктор

```ts
    @Inject(FundingRulesBatchApplicationService)
    private readonly fundingRules: FundingRulesBatchApplicationService,
```

и маршрут перед `@Put('envelopes/:envelopeId/funding-rule')`:

```ts
  @Get('funding-rules')
  @ApiOkResponse({ type: FundingRuleListResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async listFundingRules(@Param('budgetId') budgetId: string, @Req() request: AuthenticatedRequest) {
    return (await this.fundingRules.list(contextOf(request).userId, budgetId)).body;
  }
```

В `envelope-plan.module.ts` импортировать сервис и добавить провайдер после `PeriodTargetApplicationService`:

```ts
        {
          provide: FundingRulesBatchApplicationService,
          useFactory: (prisma: PrismaService) =>
            new FundingRulesBatchApplicationService(
              prisma,
              new IdempotencyService(),
              new PlanModelPolicy(prisma),
            ),
          inject: [PrismaService],
        },
```

- [ ] **Step 6: Запустить тест и убедиться, что он проходит**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-rules-batch.integration.test.ts`
Expected: PASS.
Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-rules.integration.test.ts`
Expected: PASS (перенос `FundingRuleBody` не изменил ответ одиночного PUT).
Run: `pnpm --filter @harmofin/api typecheck`
Expected: без ошибок.

- [ ] **Step 7: Commit (после «да» владельца)**

```bash
git add apps/api/src/envelope-plans apps/api/test/v2-funding-rules-batch.integration.test.ts
git commit -m "feat(api): чтение правил пополнения бюджета"
```

---

### Task 2: API — пакетное сохранение `PUT funding-rules`

**Files:**
- Modify: `apps/api/src/envelope-plans/envelope-plan.schemas.ts`
- Modify: `apps/api/src/envelope-plans/funding-rule.repository.ts`
- Modify: `apps/api/src/envelope-plans/envelope-plan.repository.ts`
- Modify: `apps/api/src/funding/income-category-suggestion.repository.ts`
- Modify: `apps/api/src/funding/income-category-suggestion.application.service.ts`
- Modify: `apps/api/src/envelope-plans/funding-rules-batch.application.service.ts`
- Modify: `apps/api/src/envelope-plans/envelope-plan.dto.ts`
- Modify: `apps/api/src/envelope-plans/envelope-plan.controller.ts`
- Modify: `apps/api/test/v2-funding-rules-batch.integration.test.ts`
- Modify: `openapi.json`

**Interfaces:**
- Consumes: `listRules`, `toRuleBody`, `FundingRulesBatchApplicationService` из Task 1.
- Produces: `putFundingRulesBatchSchema`, `PutFundingRulesBatchInput`; `FundingRulesBatchApplicationService.putBatch(userId, budgetId, input, idempotencyKey, requestId?)` → `{ status: 200, body: { items: FundingRuleBody[]; incomeSuggestion: IncomeCategorySuggestionRecord } }`; маршрут `PUT /api/v2/budgets/{budgetId}/funding-rules`; DTO `PutFundingRulesBatchRequest`, `FundingRulesBatchResponse`.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `describe('v2 funding rules batch')` после теста GET:

```ts
  const off = { enabled: false, sourceCategoryId: null, targetEnvelopeId: null };

  async function rulesOf(budgetId: string) {
    return prisma.envelopeFundingRule.findMany({
      where: { budgetId },
      orderBy: [{ priority: 'asc' }, { envelopeId: 'asc' }],
      select: { envelopeId: true, type: true, priority: true, fixedMinor: true, percentBasisPoints: true },
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
        incomeSuggestion: { enabled: true, sourceCategoryId: incomeCategory, targetEnvelopeId: savings },
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
        incomeSuggestion: { enabled: true, sourceCategoryId: incomeCategory, targetEnvelopeId: savings },
      },
      `batch-${randomUUID()}`,
    );
    expect(response.statusCode).toBe(200);
    // mandatory 10 -> 10 (без изменений), savings 30 -> 20 (изменён); currentA и currentB вне тела.
    expect(await ruleAudits(budgetId)).toBe(before + 1);
    expect(
      await prisma.auditEvent.count({ where: { budgetId, entityType: 'income_category_suggestion' } }),
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
      return { status: response.statusCode, body: response.json<{ code: string; fieldErrors?: Array<{ field: string }> }>() };
    };
    const fields = (result: { body: { fieldErrors?: Array<{ field: string }> } }) =>
      (result.body.fieldErrors ?? []).map((item) => item.field);

    const manualInQueue = await bad({ queue: [{ envelopeId: savings, type: 'MANUAL' }], outside: [], incomeSuggestion: off });
    expect(manualInQueue.status).toBe(400);
    expect(fields(manualInQueue)).toContain('queue.0.type');

    const typedOutside = await bad({ queue: [], outside: [{ envelopeId: savings, type: 'PERCENT_OF_INCOME' }], incomeSuggestion: off });
    expect(typedOutside.status).toBe(400);
    expect(fields(typedOutside)).toContain('outside.0.type');

    const duplicate = await bad({
      queue: [{ envelopeId: savings, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1 }],
      outside: [{ envelopeId: savings, type: 'MANUAL' }],
      incomeSuggestion: off,
    });
    expect(duplicate.status).toBe(400);
    expect(fields(duplicate)).toContain('outside.0.envelopeId');

    const missingFixed = await bad({ queue: [{ envelopeId: savings, type: 'FIXED_PER_PERIOD' }], outside: [], incomeSuggestion: off });
    expect(fields(missingFixed)).toContain('queue.0.fixedAmount');

    const zeroFixed = await bad({ queue: [{ envelopeId: savings, type: 'FIXED_PER_PERIOD', fixedAmount: '0' }], outside: [], incomeSuggestion: off });
    expect(zeroFixed.status).toBe(400);
    expect(fields(zeroFixed)).toContain('queue.0.fixedAmount');

    const extraPercent = await bad({ queue: [{ envelopeId: savings, type: 'SUGGESTED_FIXED', fixedAmount: '1', percentBasisPoints: 5 }], outside: [], incomeSuggestion: off });
    expect(fields(extraPercent)).toContain('queue.0.percentBasisPoints');

    const clientPriority = await bad({ queue: [{ envelopeId: savings, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1, priority: 5 }], outside: [], incomeSuggestion: off });
    expect(clientPriority.status).toBe(400);

    const sumOfPlans = await bad({ queue: [{ envelopeId: savings, type: 'SUM_OF_PLANS' }], outside: [], incomeSuggestion: off });
    expect(sumOfPlans.status).toBe(422);
    expect(sumOfPlans.body.code).toBe('FUNDING_RULE_TYPE_NOT_ALLOWED');
    expect(fields(sumOfPlans)).toContain('queue.0.type');

    const foreign = await bad({ queue: [{ envelopeId: outsiderEnvelope, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1 }], outside: [], incomeSuggestion: off });
    expect(foreign.status).toBe(404);

    const noSuggestion = await bad({ queue: [], outside: [] });
    expect(fields(noSuggestion)).toContain('incomeSuggestion');

    const enabledWithoutCategory = await bad({ queue: [], outside: [], incomeSuggestion: { enabled: true, sourceCategoryId: null, targetEnvelopeId: savings } });
    expect(enabledWithoutCategory.status).toBe(400);
    expect(fields(enabledWithoutCategory)).toContain('incomeSuggestion.sourceCategoryId');

    const expenseSource = await bad({ queue: [], outside: [], incomeSuggestion: { enabled: true, sourceCategoryId: expenseCategory, targetEnvelopeId: savings } });
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
      { ...payload, queue: [{ envelopeId: savings, type: 'PERCENT_OF_INCOME', percentBasisPoints: 701 }] },
      key,
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('preview распределения идёт в порядке сохранённой очереди', async () => {
    const budgetId = ctx.owner!.budgetId;
    const saved = await putBatch(
      ctx.owner,
      {
        queue: [
          { envelopeId: savings, type: 'SUGGESTED_FIXED', fixedAmount: '100' },
          { envelopeId: currentA, type: 'SUGGESTED_FIXED', fixedAmount: '100' },
        ],
        outside: [
          { envelopeId: mandatory, type: 'MANUAL' },
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
      payload: { sourceKind: 'FREE', amount: '150' },
    });
    expect(preview.statusCode).toBe(200);
    const lines = preview.json<{ lines: Array<{ envelopeId: string; suggestedMinor: string }> }>().lines;
    const order = lines.filter((line) => line.suggestedMinor !== '0').map((line) => line.envelopeId);
    expect(order).toEqual([savings, currentA]);
  });

  it('OpenAPI описывает GET и PUT funding-rules', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, { get?: { responses: Record<string, unknown> }; put?: { responses: Record<string, unknown>; parameters?: unknown[] } }>;
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
```

Перед тем как писать тест preview, свериться с запросом и ответом `POST funding/preview` в `apps/api/src/funding/funding.schemas.ts` (`fundingPreviewSchema`) и `apps/api/test/v2-funding-preview.integration.test.ts`: имена полей тела (`sourceKind`, `amount`) и строк ответа (`lines[].envelopeId`, поле предложенной суммы) взять оттуда, если они отличаются от написанных выше. Если preview по `FREE` требует свободных денег, в `beforeAll` уже создан счёт с `startingBalanceMinor: 30_000_000n`.

- [ ] **Step 2: Запустить и убедиться, что новые тесты падают**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-rules-batch.integration.test.ts`
Expected: FAIL — PUT возвращает 404 (маршрута нет); тест GET проходит.

- [ ] **Step 3: Схема**

В `envelope-plan.schemas.ts` вынести тело `superRefine` из `putFundingRuleSchema` в функцию и использовать её в обеих схемах:

```ts
type RuleFields = {
  type: (typeof fundingRuleTypes)[number];
  fixedAmount?: string | undefined;
  percentBasisPoints?: number | undefined;
};

function refineRuleFields(value: RuleFields, ctx: z.RefinementCtx): void {
  // ← перенести без изменений четыре проверки из текущего superRefine putFundingRuleSchema
}

export const putFundingRuleSchema = z
  .object({
    type: z.enum(fundingRuleTypes),
    priority: z.number().int().min(0).max(1_000_000),
    fixedAmount: decimalAmount.optional(),
    percentBasisPoints: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .superRefine(refineRuleFields);

const queueRuleSchema = z
  .object({
    envelopeId: uuid,
    type: z.enum(fundingRuleTypes),
    fixedAmount: decimalAmount.optional(),
    percentBasisPoints: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'MANUAL') {
      ctx.addIssue({
        code: 'custom',
        path: ['type'],
        message: 'Правило «Вручную» передаётся в outside, не в очереди.',
      });
    }
    refineRuleFields(value, ctx);
  });

const outsideRuleSchema = z.object({ envelopeId: uuid, type: z.literal('MANUAL') }).strict();

export const putFundingRulesBatchSchema = z
  .object({
    queue: z.array(queueRuleSchema).max(200),
    outside: z.array(outsideRuleSchema).max(200),
    incomeSuggestion: z
      .object({
        enabled: z.boolean(),
        sourceCategoryId: uuid.nullable(),
        targetEnvelopeId: uuid.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const list of ['queue', 'outside'] as const) {
      value[list].forEach((item, index) => {
        if (seen.has(item.envelopeId)) {
          ctx.addIssue({
            code: 'custom',
            path: [list, index, 'envelopeId'],
            message: 'Конверт указан больше одного раза.',
          });
        }
        seen.add(item.envelopeId);
      });
    }
  });

export type PutFundingRulesBatchInput = z.output<typeof putFundingRulesBatchSchema>;
```

`uuid` объявлен выше в файле (`const uuid = z.string().uuid();`) — переместить объявление `fundingRuleTypes` и новых схем ниже него, если порядок мешает.

- [ ] **Step 4: Репозитории**

В `funding-rule.repository.ts` добавить в класс:

```ts
  /** True when a saved rule already has exactly this type, priority and amounts. */
  static same(
    rule: FundingRuleRecord | undefined,
    next: Pick<FundingRuleRecord, 'type' | 'priority' | 'fixedMinor' | 'percentBasisPoints'>,
  ): boolean {
    return (
      rule !== undefined &&
      rule.type === next.type &&
      rule.priority === next.priority &&
      rule.fixedMinor === next.fixedMinor &&
      rule.percentBasisPoints === next.percentBasisPoints
    );
  }
```

В `envelope-plan.repository.ts` в класс `EnvelopePlanRepository`:

```ts
  /** Envelopes of the budget among `ids`; ids of other budgets are simply absent. */
  async findManyByIds(
    tx: Prisma.TransactionClient,
    budgetId: string,
    ids: string[],
  ): Promise<Array<{ id: string; envelopeType: EnvelopeType; archivedAt: Date | null }>> {
    if (ids.length === 0) return [];
    return tx.envelope.findMany({
      where: { budgetId, id: { in: ids } },
      select: { id: true, envelopeType: true, archivedAt: true },
    });
  }
```

В `income-category-suggestion.repository.ts` в класс:

```ts
  async find(
    tx: Prisma.TransactionClient,
    budgetId: string,
    workspaceId: string,
  ): Promise<IncomeCategorySuggestionRecord> {
    const row = await tx.budget.findFirstOrThrow({
      where: { id: budgetId, workspaceId },
      select: SETTING_SELECT,
    });
    return toRecord(row);
  }
```

- [ ] **Step 5: Общая проверка ссылок предложения**

В `income-category-suggestion.application.service.ts` вынести блок проверки категории и конверта (текущие строки внутри `execute`, от `if (input.sourceCategoryId !== null)` до конца проверки конверта) в экспортируемую функцию и вызвать её из `put`:

```ts
export async function assertSuggestionReferences(
  tx: Prisma.TransactionClient,
  repository: IncomeCategorySuggestionRepository,
  budgetId: string,
  input: PutIncomeCategorySuggestionInput,
  fieldPrefix?: string,
): Promise<void> {
  const field = (name: string) => (fieldPrefix ? `${fieldPrefix}.${name}` : undefined);
  if (input.sourceCategoryId !== null) {
    const category = await repository.findCategory(tx, budgetId, input.sourceCategoryId);
    if (!category) throw resourceNotFound();
    if (category.archivedAt) {
      throw unprocessable('CATEGORY_ARCHIVED', 'Категория архивирована.', field('sourceCategoryId'));
    }
    if (category.categoryType !== 'INCOME') {
      throw unprocessable('CATEGORY_TYPE_MISMATCH', 'Нужна категория дохода.', field('sourceCategoryId'));
    }
  }
  if (input.targetEnvelopeId !== null) {
    const envelope = await repository.findEnvelope(tx, budgetId, input.targetEnvelopeId);
    if (!envelope) throw resourceNotFound();
    if (envelope.archivedAt) {
      throw unprocessable('ENVELOPE_ARCHIVED', 'Конверт архивирован.', field('targetEnvelopeId'));
    }
  }
}
```

и расширить `unprocessable`:

```ts
function unprocessable(code: string, detail: string, field?: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code,
    detail,
    ...(field ? { fieldErrors: [{ field, message: detail, code: 'invalid' }] } : {}),
  });
}
```

Добавить `import type { Prisma } from '@prisma/client';`. Одиночный эндпоинт вызывает функцию без `fieldPrefix` — его ответы не меняются.

- [ ] **Step 6: Сервис `putBatch`**

В `funding-rules-batch.application.service.ts` дописать:

```ts
import { createHash } from 'node:crypto';

import type { FundingRuleType, Prisma } from '@prisma/client';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';

import { parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { assertSuggestionReferences } from '../funding/income-category-suggestion.application.service.js';
import {
  type IncomeCategorySuggestionRecord,
  IncomeCategorySuggestionRepository,
} from '../funding/income-category-suggestion.repository.js';
import { EnvelopePlanRepository } from './envelope-plan.repository.js';
import type { PutFundingRulesBatchInput } from './envelope-plan.schemas.js';

const PUT_FUNDING_RULES_BATCH_OPERATION = 'PUT_FUNDING_RULES_BATCH';
const RUB_SCALE = 2;

type DesiredRule = {
  path: string;
  envelopeId: string;
  type: FundingRuleType;
  priority: number;
  fixedMinor: bigint | null;
  percentBasisPoints: number | null;
};

function validationFailed(detail: string, field: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail,
    fieldErrors: [{ field, message: detail, code: 'invalid' }],
  });
}

function unprocessable(code: string, detail: string, field: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code,
    detail,
    fieldErrors: [{ field, message: detail, code: 'invalid' }],
  });
}

function desiredRules(input: PutFundingRulesBatchInput): DesiredRule[] {
  const queue = input.queue.map((item, index): DesiredRule => {
    const path = `queue.${index}`;
    let fixedMinor: bigint | null = null;
    if (item.fixedAmount !== undefined) {
      try {
        // Malformed text ('1.234') throws a 400 without a field path; give it one.
        fixedMinor = parseDecimalToMinorUnits(item.fixedAmount, RUB_SCALE, false);
      } catch {
        throw validationFailed('Некорректный денежный формат.', `${path}.fixedAmount`);
      }
      if (fixedMinor <= 0n) {
        throw validationFailed('Сумма должна быть положительной.', `${path}.fixedAmount`);
      }
    }
    return {
      path,
      envelopeId: item.envelopeId,
      type: item.type,
      priority: (index + 1) * 10,
      fixedMinor,
      percentBasisPoints: item.percentBasisPoints ?? null,
    };
  });
  const outside = input.outside.map(
    (item, index): DesiredRule => ({
      path: `outside.${index}`,
      envelopeId: item.envelopeId,
      type: 'MANUAL',
      priority: 0,
      fixedMinor: null,
      percentBasisPoints: null,
    }),
  );
  return [...queue, ...outside];
}
```

В класс добавить поля и методы:

```ts
  private readonly envelopes = new EnvelopePlanRepository();
  private readonly suggestions = new IncomeCategorySuggestionRepository();
  private readonly rolePolicy = new RolePolicy();

  async putBatch(
    userId: string,
    budgetId: string,
    input: PutFundingRulesBatchInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{
    status: number;
    body: { items: FundingRuleBody[]; incomeSuggestion: IncomeCategorySuggestionRecord };
  }> {
    const desired = desiredRules(input);
    const suggestion = input.incomeSuggestion;
    if (suggestion.enabled && suggestion.sourceCategoryId === null) {
      throw validationFailed(
        'Для включённого предложения нужна категория дохода.',
        'incomeSuggestion.sourceCategoryId',
      );
    }
    if (suggestion.enabled && suggestion.targetEnvelopeId === null) {
      throw validationFailed(
        'Для включённого предложения нужен конверт.',
        'incomeSuggestion.targetEnvelopeId',
      );
    }
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          rules: desired.map((rule) => ({
            envelopeId: rule.envelopeId,
            type: rule.type,
            priority: rule.priority,
            fixedMinor: rule.fixedMinor?.toString() ?? null,
            percentBasisPoints: rule.percentBasisPoints,
          })),
          incomeSuggestion: suggestion,
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.envelopes.lockBudget(tx, budgetId);
      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: PUT_FUNDING_RULES_BATCH_OPERATION,
          requestHash,
        },
        async () => {
          await this.requireManageRole(tx, model.workspaceId, userId);
          await this.assertEnvelopes(tx, budgetId, desired);
          await assertSuggestionReferences(tx, this.suggestions, budgetId, suggestion, 'incomeSuggestion');

          const existing = new Map(
            (await this.rules.listRules(tx, budgetId)).map((rule) => [rule.envelopeId, rule]),
          );
          for (const rule of desired) {
            if (FundingRuleRepository.same(existing.get(rule.envelopeId), rule)) continue;
            await this.rules.saveRule(tx, {
              budgetId,
              workspaceId: model.workspaceId,
              actorUserId: userId,
              envelopeId: rule.envelopeId,
              type: rule.type,
              priority: rule.priority,
              fixedMinor: rule.fixedMinor,
              percentBasisPoints: rule.percentBasisPoints,
              requestId,
            });
          }

          const current = await this.suggestions.find(tx, budgetId, model.workspaceId);
          const unchanged =
            current.enabled === suggestion.enabled &&
            current.sourceCategoryId === suggestion.sourceCategoryId &&
            current.targetEnvelopeId === suggestion.targetEnvelopeId;
          const savedSuggestion = unchanged
            ? current
            : await this.suggestions.save(tx, {
                budgetId,
                workspaceId: model.workspaceId,
                actorUserId: userId,
                enabled: suggestion.enabled,
                sourceCategoryId: suggestion.sourceCategoryId,
                targetEnvelopeId: suggestion.targetEnvelopeId,
                requestId,
              });

          const items = (await this.rules.listRules(tx, budgetId)).map(toRuleBody);
          return { status: 200, body: { items, incomeSuggestion: savedSuggestion } };
        },
      );
    });
  }

  private async assertEnvelopes(
    tx: Prisma.TransactionClient,
    budgetId: string,
    desired: DesiredRule[],
  ): Promise<void> {
    const found = new Map(
      (
        await this.envelopes.findManyByIds(
          tx,
          budgetId,
          desired.map((rule) => rule.envelopeId),
        )
      ).map((envelope) => [envelope.id, envelope]),
    );
    for (const rule of desired) {
      const envelope = found.get(rule.envelopeId);
      if (!envelope) throw resourceNotFound();
      if (envelope.archivedAt) {
        throw unprocessable('ENVELOPE_ARCHIVED', 'Конверт архивирован.', `${rule.path}.envelopeId`);
      }
      if (rule.type === 'SUM_OF_PLANS' && envelope.envelopeType !== 'MANDATORY_EXPENSES') {
        throw unprocessable(
          'FUNDING_RULE_TYPE_NOT_ALLOWED',
          'Правило SUM_OF_PLANS допустимо только для конверта «Обязательные».',
          `${rule.path}.type`,
        );
      }
    }
  }

  private async requireManageRole(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    if (!membership || !this.rolePolicy.canManage(membership.role)) throw forbidden();
  }
```

Порядок проверок такой же, как в одиночном PUT: сначала роль (403), потом объекты (404/422).

- [ ] **Step 7: DTO и маршрут**

В `envelope-plan.dto.ts`:

```ts
const RULE_TYPES = ['MANUAL', 'SUM_OF_PLANS', 'FIXED_PER_PERIOD', 'SUGGESTED_FIXED', 'PERCENT_OF_INCOME'];

export class FundingRulesBatchQueueItem {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  envelopeId!: string;

  @ApiProperty({ type: String, enum: RULE_TYPES.filter((type) => type !== 'MANUAL'), example: 'PERCENT_OF_INCOME' })
  type!: string;

  @ApiProperty({ type: String, required: false, example: '15000.00', description: 'Только FIXED_PER_PERIOD и SUGGESTED_FIXED; обязателен для них.' })
  fixedAmount?: string;

  @ApiProperty({ type: Number, required: false, example: 1000, minimum: 0, maximum: 10000, description: 'Только PERCENT_OF_INCOME; обязателен для него.' })
  percentBasisPoints?: number;
}

export class FundingRulesBatchOutsideItem {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000002' })
  envelopeId!: string;

  @ApiProperty({ type: String, enum: ['MANUAL'], example: 'MANUAL' })
  type!: string;
}

export class IncomeSuggestionState {
  @ApiProperty({ type: Boolean, example: false })
  enabled!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  sourceCategoryId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  targetEnvelopeId!: string | null;
}

export class PutFundingRulesBatchRequest {
  @ApiProperty({
    type: [FundingRulesBatchQueueItem],
    description: 'Очередь распределения: порядок массива = порядок. priority присваивает сервер: (индекс + 1) * 10.',
  })
  queue!: FundingRulesBatchQueueItem[];

  @ApiProperty({ type: [FundingRulesBatchOutsideItem], description: 'Конверты вне очереди (MANUAL, priority 0).' })
  outside!: FundingRulesBatchOutsideItem[];

  @ApiProperty({ type: IncomeSuggestionState })
  incomeSuggestion!: IncomeSuggestionState;
}

export class FundingRulesBatchResponse {
  @ApiProperty({ type: [FundingRuleResponse] })
  items!: FundingRuleResponse[];

  @ApiProperty({ type: IncomeSuggestionState })
  incomeSuggestion!: IncomeSuggestionState;
}
```

В `envelope-plan.controller.ts` (импортировать новые DTO, `putFundingRulesBatchSchema`, `PutFundingRulesBatchInput`) после `listFundingRules`:

```ts
  @Put('funding-rules')
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Сохранить очередь и правила пополнения конвертов',
    description:
      'Одна транзакция: правила конвертов, порядок очереди и предложение «категория дохода → конверт». Конверты вне тела не меняются. Распределения, остатки и цели периодов не меняются. Только OWNER; повтор с тем же Idempotency-Key возвращает тот же ответ.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: PutFundingRulesBatchRequest })
  @ApiOkResponse({ type: FundingRulesBatchResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async putFundingRules(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(putFundingRulesBatchSchema)) input: PutFundingRulesBatchInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return (
      await this.fundingRules.putBatch(
        contextOf(request).userId,
        budgetId,
        input,
        validKey(key),
        request.id,
      )
    ).body;
  }
```

Если `ApiOperation` не импортирован в контроллере — добавить в импорт из `@nestjs/swagger`.

- [ ] **Step 8: Запустить тесты**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-rules-batch.integration.test.ts test/v2-funding-rules.integration.test.ts`
Expected: PASS.
Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Expected: без ошибок.

- [ ] **Step 9: Перегенерировать OpenAPI**

Run: `node scripts/openapi/generate.mjs`
Expected: в `git diff --stat openapi.json` только добавления путей `/api/v2/budgets/{budgetId}/funding-rules` и схем `FundingRuleListResponse`, `PutFundingRulesBatchRequest`, `FundingRulesBatchQueueItem`, `FundingRulesBatchOutsideItem`, `IncomeSuggestionState`, `FundingRulesBatchResponse`. Затем `node --test scripts/openapi/*.test.mjs` — PASS.

- [ ] **Step 10: Commit (после «да» владельца)**

```bash
git add apps/api/src openapi.json apps/api/test/v2-funding-rules-batch.integration.test.ts
git commit -m "feat(api): пакетное сохранение очереди и правил пополнения"
```

---

### Task 3: Web — клиент API и тексты правил

**Files:**
- Modify: `apps/web/app/composables/useEnvelopePlanV2.ts`
- Modify: `apps/web/app/composables/useEnvelopePlanV2.test.ts`
- Create: `apps/web/app/components/funding-rules/funding-rule-text.ts`
- Create: `apps/web/app/components/funding-rules/funding-rule-text.test.ts`

**Interfaces:**
- Consumes: API из Task 1–2.
- Produces:
  - типы `FundingRuleListResponse { items: FundingRuleResponse[] }`, `IncomeSuggestionState { enabled: boolean; sourceCategoryId: string | null; targetEnvelopeId: string | null }`, `FundingRulesBatchQueueItem`, `PutFundingRulesBatchRequest`, `FundingRulesBatchResponse`;
  - методы `listFundingRules(budgetId)`, `saveFundingRules(budgetId, input, idempotencyKey)`;
  - из `funding-rule-text.ts`: `RULE_TYPE_LABELS`, `RULE_TYPE_HINTS`, `QUEUE_HINT`, `OUTSIDE_HINT`, `SUGGESTION_HINT`, `ruleTypeOptions(envelopeType: string): FundingRuleType[]`, `basisPointsToPercent(value: number): string`, `percentToBasisPoints(text: string): number | null`, `describeRule(envelopeId: string, rules: FundingRuleResponse[] | null): string | null`.

- [ ] **Step 1: Падающие тесты**

В `useEnvelopePlanV2.test.ts` найти существующий тест `updateFundingRule` (поиск `funding-rule`) и рядом добавить по тому же образцу (тот же мок `api.request`):

```ts
  it('listFundingRules и saveFundingRules вызывают v2 funding-rules', async () => {
    const v2 = useEnvelopePlanV2();
    await v2.listFundingRules('budget-1');
    expect(request).toHaveBeenLastCalledWith('/api/v2/budgets/budget-1/funding-rules');
    const body = {
      queue: [{ envelopeId: 'e1', type: 'PERCENT_OF_INCOME' as const, percentBasisPoints: 1000 }],
      outside: [],
      incomeSuggestion: { enabled: false, sourceCategoryId: null, targetEnvelopeId: null },
    };
    await v2.saveFundingRules('budget-1', body, 'key-1');
    expect(request).toHaveBeenLastCalledWith('/api/v2/budgets/budget-1/funding-rules', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': 'key-1' },
    });
  });
```

(имя мок-функции `request` и форму базового пути сверить с соседним тестом `updateFundingRule` в этом файле и подставить те же.)

Создать `funding-rule-text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  basisPointsToPercent,
  describeRule,
  percentToBasisPoints,
  ruleTypeOptions,
} from './funding-rule-text.js';

const rule = (envelopeId: string, type: string, extra: Record<string, unknown> = {}) => ({
  id: `r-${envelopeId}`,
  envelopeId,
  type: type as never,
  priority: 0,
  fixedAmountMinor: null,
  percentBasisPoints: null,
  ...extra,
});

describe('funding-rule-text', () => {
  it('переводит проценты и базисные пункты строками', () => {
    expect(basisPointsToPercent(1000)).toBe('10');
    expect(basisPointsToPercent(1250)).toBe('12.5');
    expect(basisPointsToPercent(5)).toBe('0.05');
    expect(percentToBasisPoints('12,5')).toBe(1250);
    expect(percentToBasisPoints('100')).toBe(10_000);
    expect(percentToBasisPoints('100.01')).toBeNull();
    expect(percentToBasisPoints('abc')).toBeNull();
  });

  it('SUM_OF_PLANS доступен только обязательному конверту', () => {
    expect(ruleTypeOptions('MANDATORY_EXPENSES')).toContain('SUM_OF_PLANS');
    expect(ruleTypeOptions('SAVINGS_GOAL')).not.toContain('SUM_OF_PLANS');
    expect(ruleTypeOptions('SAVINGS_GOAL')[0]).toBe('MANUAL');
  });

  it('описывает правило и номер в очереди', () => {
    const rules = [
      rule('m', 'MANUAL'),
      rule('a', 'SUM_OF_PLANS', { priority: 10 }),
      rule('b', 'PERCENT_OF_INCOME', { priority: 20, percentBasisPoints: 1000 }),
      rule('c', 'FIXED_PER_PERIOD', { priority: 30, fixedAmountMinor: '1500000' }),
    ];
    expect(describeRule('b', rules)).toBe('Процент от дохода, 10 % · №2 в очереди');
    expect(describeRule('a', rules)).toBe('Сумма планов обязательных · №1 в очереди');
    expect(describeRule('c', rules)).toMatch(/^Фиксированная цель на период, 15\s000,00\s₽ · №3 в очереди$/);
    expect(describeRule('m', rules)).toBe('Вручную');
    expect(describeRule('x', rules)).toBe('Правило не задано');
    expect(describeRule('b', null)).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter @harmofin/web test -- app/components/funding-rules/funding-rule-text.test.ts app/composables/useEnvelopePlanV2.test.ts`
Expected: FAIL — модуля `funding-rule-text.js` нет, `listFundingRules` не функция.

- [ ] **Step 3: Типы и методы клиента**

В `useEnvelopePlanV2.ts` после `FundingRuleResponse`:

```ts
export interface FundingRuleListResponse {
  items: FundingRuleResponse[];
}

export interface IncomeSuggestionState {
  enabled: boolean;
  sourceCategoryId: string | null;
  targetEnvelopeId: string | null;
}

export interface FundingRulesBatchQueueItem {
  envelopeId: string;
  type: Exclude<FundingRuleType, 'MANUAL'>;
  /** Decimal rubles; only FIXED_PER_PERIOD and SUGGESTED_FIXED. */
  fixedAmount?: string;
  /** Integer 0..10000; only PERCENT_OF_INCOME. */
  percentBasisPoints?: number;
}

export interface PutFundingRulesBatchRequest {
  /** Order of the array is the distribution order; the server assigns priorities. */
  queue: FundingRulesBatchQueueItem[];
  outside: Array<{ envelopeId: string; type: 'MANUAL' }>;
  incomeSuggestion: IncomeSuggestionState;
}

export interface FundingRulesBatchResponse {
  items: FundingRuleResponse[];
  incomeSuggestion: IncomeSuggestionState;
}
```

В возвращаемый объект рядом с `updateFundingRule`:

```ts
    listFundingRules: (budgetId: string) =>
      get<FundingRuleListResponse>(`${base(budgetId)}/funding-rules`),
    saveFundingRules: (
      budgetId: string,
      input: PutFundingRulesBatchRequest,
      idempotencyKey: string,
    ) =>
      putKeyed<FundingRulesBatchResponse>(`${base(budgetId)}/funding-rules`, input, idempotencyKey),
```

- [ ] **Step 4: `funding-rule-text.ts`**

```ts
import type { FundingRuleResponse, FundingRuleType } from '../../composables/useEnvelopePlanV2.js';
import { formatMoneyText } from '../envelopes/envelope-plan-kind.js';

export const RULE_TYPE_LABELS: Record<FundingRuleType, string> = {
  MANUAL: 'Вручную',
  SUM_OF_PLANS: 'Сумма планов обязательных',
  FIXED_PER_PERIOD: 'Фиксированная цель на период',
  SUGGESTED_FIXED: 'Предлагаемая сумма',
  PERCENT_OF_INCOME: 'Процент от дохода',
};

export const RULE_TYPE_HINTS: Record<FundingRuleType, string> = {
  MANUAL: 'Сумма предлагается только вручную при распределении.',
  SUM_OF_PLANS: 'Потребность считает сервер по планам обязательных платежей.',
  FIXED_PER_PERIOD:
    'Цель периода: подтверждается отдельно, пока не подтверждена — это предложение.',
  SUGGESTED_FIXED: 'Это предложение, не обязательный взнос.',
  PERCENT_OF_INCOME: 'Доля от поступившего дохода, которую предложит сервер.',
};

export const QUEUE_HINT =
  'Доход распределяется сверху вниз: сначала первый конверт, потом следующий, пока хватает денег.';
export const OUTSIDE_HINT =
  'Для этих конвертов сервер не предлагает сумму — их пополняете вручную при распределении.';
export const SUGGESTION_HINT =
  'Когда приходит доход этой категории, сервер предложит направить его в выбранный конверт. Деньги не распределяются сами — распределение вы подтверждаете отдельно.';

const ALL_TYPES: FundingRuleType[] = [
  'MANUAL',
  'SUM_OF_PLANS',
  'FIXED_PER_PERIOD',
  'SUGGESTED_FIXED',
  'PERCENT_OF_INCOME',
];

/** The server allows SUM_OF_PLANS only for the mandatory envelope. */
export function ruleTypeOptions(envelopeType: string): FundingRuleType[] {
  return envelopeType === 'MANDATORY_EXPENSES'
    ? ALL_TYPES
    : ALL_TYPES.filter((type) => type !== 'SUM_OF_PLANS');
}

const PERCENT_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

// Basis points <-> percent text, as integer/string conversion of the input only.
export function basisPointsToPercent(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = String(value % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${whole}.${fraction}`;
}

export function percentToBasisPoints(text: string): number | null {
  const match = PERCENT_PATTERN.exec(text.trim());
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return basisPoints <= 10_000 ? basisPoints : null;
}

/**
 * Read-only summary of an envelope's rule. `rules` must be in the server order
 * (priority, then envelope id); the queue number counts only non-MANUAL rules.
 * Returns null when the rules could not be loaded.
 */
export function describeRule(
  envelopeId: string,
  rules: FundingRuleResponse[] | null,
): string | null {
  if (rules === null) return null;
  const rule = rules.find((item) => item.envelopeId === envelopeId);
  if (!rule) return 'Правило не задано';
  if (rule.type === 'MANUAL') return RULE_TYPE_LABELS.MANUAL;
  let text = RULE_TYPE_LABELS[rule.type];
  if (rule.fixedAmountMinor !== null) text += `, ${formatMoneyText(rule.fixedAmountMinor)}`;
  if (rule.percentBasisPoints !== null) {
    text += `, ${basisPointsToPercent(rule.percentBasisPoints)} %`;
  }
  const position = rules
    .filter((item) => item.type !== 'MANUAL')
    .findIndex((item) => item.envelopeId === envelopeId);
  return `${text} · №${position + 1} в очереди`;
}
```

- [ ] **Step 5: Тесты проходят**

Run: `pnpm --filter @harmofin/web test -- app/components/funding-rules/funding-rule-text.test.ts app/composables/useEnvelopePlanV2.test.ts`
Expected: PASS. Если формат суммы `formatMoneyText` отличается пробелом (обычный/неразрывный), регулярное выражение `\s` его покрывает; если меняется символ валюты, поправить ожидание по фактическому выводу `formatMoneyText('1500000')`.

- [ ] **Step 6: Commit (после «да» владельца)**

```bash
git add apps/web/app/composables/useEnvelopePlanV2.ts apps/web/app/composables/useEnvelopePlanV2.test.ts apps/web/app/components/funding-rules
git commit -m "feat(web): клиент и тексты правил пополнения"
```

---

### Task 4: Web — модель состояния редактора

**Files:**
- Create: `apps/web/app/components/funding-rules/rules-editor-state.ts`
- Create: `apps/web/app/components/funding-rules/rules-editor-state.test.ts`

**Interfaces:**
- Consumes: типы из Task 3, `toDecimalText` из `components/envelopes/envelope-plan-kind.ts`, `basisPointsToPercent`, `percentToBasisPoints`.
- Produces:

```ts
export type RuleField = 'type' | 'fixedAmount' | 'percentBasisPoints';
export interface RuleCard { envelopeId: string; name: string; envelopeType: string; type: FundingRuleType | ''; fixed: string; percent: string }
export interface SuggestionDraft { enabled: boolean; sourceCategoryId: string; targetEnvelopeId: string }
export interface EditorState { queue: RuleCard[]; outside: RuleCard[]; suggestion: SuggestionDraft }
export type CardErrors = Record<string, Partial<Record<RuleField, string>>>;
export type SuggestionErrors = Partial<Record<'sourceCategoryId' | 'targetEnvelopeId', string>>;
export function buildState(envelopes: EnvelopeInput[], rules: FundingRuleResponse[], suggestion: IncomeSuggestionState): EditorState;
export function setType(state: EditorState, envelopeId: string, type: FundingRuleType | ''): EditorState;
export function updateCard(state: EditorState, envelopeId: string, patch: Partial<Pick<RuleCard, 'fixed' | 'percent'>>): EditorState;
export function move(state: EditorState, from: number, to: number): EditorState;
export function snapshotOf(state: EditorState): string;
export function buildRequest(state: EditorState): { body: PutFundingRulesBatchRequest | null; cardErrors: CardErrors; suggestionErrors: SuggestionErrors };
export function mapServerErrors(body: PutFundingRulesBatchRequest, fieldErrors: Array<{ field: string }>): { cardErrors: CardErrors; suggestionErrors: SuggestionErrors; matched: boolean };
export const FIELD_TEXT: Record<RuleField, string>;
```

- [ ] **Step 1: Падающие тесты**

```ts
import { describe, expect, it } from 'vitest';

import {
  FIELD_TEXT,
  buildRequest,
  buildState,
  mapServerErrors,
  move,
  setType,
  snapshotOf,
  updateCard,
} from './rules-editor-state.js';

const envelopes = [
  { id: 'a', name: 'Еда', envelopeType: 'CURRENT_EXPENSES', archivedAt: null },
  { id: 'b', name: 'Подушка', envelopeType: 'SAVINGS_GOAL', archivedAt: null },
  { id: 'c', name: 'Аптека', envelopeType: 'CUSTOM', archivedAt: null },
  { id: 'm', name: 'Обязательные', envelopeType: 'MANDATORY_EXPENSES', archivedAt: null },
  { id: 'z', name: 'Архив', envelopeType: 'CUSTOM', archivedAt: '2026-01-01T00:00:00Z' },
];
const rules = [
  { id: 'r0', envelopeId: 'c', type: 'MANUAL' as const, priority: 0, fixedAmountMinor: null, percentBasisPoints: null },
  { id: 'r1', envelopeId: 'm', type: 'SUM_OF_PLANS' as const, priority: 10, fixedAmountMinor: null, percentBasisPoints: null },
  { id: 'r2', envelopeId: 'a', type: 'FIXED_PER_PERIOD' as const, priority: 20, fixedAmountMinor: '1500000', percentBasisPoints: null },
  { id: 'r3', envelopeId: 'z', type: 'PERCENT_OF_INCOME' as const, priority: 30, fixedAmountMinor: null, percentBasisPoints: 100 },
];
const suggestion = { enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' };

const initial = () => buildState(envelopes, rules, suggestion);
const ids = (cards: Array<{ envelopeId: string }>) => cards.map((card) => card.envelopeId);

describe('rules-editor-state', () => {
  it('строит очередь из не-MANUAL правил активных конвертов, остальное — вне очереди по имени', () => {
    const state = initial();
    expect(ids(state.queue)).toEqual(['m', 'a']);
    expect(ids(state.outside)).toEqual(['c', 'b']);
    expect(state.queue[1]).toMatchObject({ type: 'FIXED_PER_PERIOD', fixed: '15000.00' });
    expect(state.outside.find((card) => card.envelopeId === 'b')?.type).toBe('');
    expect(state.suggestion).toEqual({ enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' });
  });

  it('тип определяет зону', () => {
    let state = setType(initial(), 'b', 'PERCENT_OF_INCOME');
    expect(ids(state.queue)).toEqual(['m', 'a', 'b']);
    expect(ids(state.outside)).toEqual(['c']);
    state = setType(state, 'm', 'MANUAL');
    expect(ids(state.queue)).toEqual(['a', 'b']);
    expect(ids(state.outside)).toEqual(['c', 'm']);
    state = setType(state, 'a', 'SUGGESTED_FIXED');
    expect(ids(state.queue)).toEqual(['a', 'b']);
  });

  it('move переставляет только внутри очереди и ограничивает индекс', () => {
    const state = setType(initial(), 'b', 'PERCENT_OF_INCOME');
    expect(ids(move(state, 0, 2).queue)).toEqual(['a', 'b', 'm']);
    expect(ids(move(state, 2, 0).queue)).toEqual(['b', 'm', 'a']);
    expect(move(state, 0, -1)).toBe(state);
    expect(move(state, 2, 3)).toBe(state);
  });

  it('snapshot меняется только при изменении', () => {
    const base = snapshotOf(initial());
    expect(snapshotOf(initial())).toBe(base);
    expect(snapshotOf(updateCard(initial(), 'a', { fixed: '1' }))).not.toBe(base);
  });

  it('buildRequest: тело по типам, конверты без типа не передаются', () => {
    let state = setType(initial(), 'b', 'PERCENT_OF_INCOME');
    state = updateCard(state, 'b', { percent: '12,5' });
    state = updateCard(state, 'a', { fixed: '15000,5' });
    const result = buildRequest(state);
    expect(result.body).toEqual({
      queue: [
        { envelopeId: 'm', type: 'SUM_OF_PLANS' },
        { envelopeId: 'a', type: 'FIXED_PER_PERIOD', fixedAmount: '15000.5' },
        { envelopeId: 'b', type: 'PERCENT_OF_INCOME', percentBasisPoints: 1250 },
      ],
      outside: [{ envelopeId: 'c', type: 'MANUAL' }],
      incomeSuggestion: { enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' },
    });
  });

  it('buildRequest: ошибки формы у карточки и у предложения', () => {
    let state = updateCard(initial(), 'a', { fixed: '0' });
    state = { ...state, suggestion: { enabled: true, sourceCategoryId: '', targetEnvelopeId: 'b' } };
    const result = buildRequest(state);
    expect(result.body).toBeNull();
    expect(result.cardErrors).toEqual({ a: { fixedAmount: FIELD_TEXT.fixedAmount } });
    expect(result.suggestionErrors.sourceCategoryId).toBeDefined();
  });

  it('buildRequest: выключенное предложение сохраняет выбор, пустое — null', () => {
    const state = { ...initial(), suggestion: { enabled: false, sourceCategoryId: 'cat', targetEnvelopeId: '' } };
    expect(buildRequest(state).body?.incomeSuggestion).toEqual({
      enabled: false,
      sourceCategoryId: 'cat',
      targetEnvelopeId: null,
    });
  });

  it('mapServerErrors сопоставляет путь с конвертом отправленного тела', () => {
    const body = buildRequest(initial()).body!;
    const mapped = mapServerErrors(body, [
      { field: 'queue.1.fixedAmount' },
      { field: 'queue.0.envelopeId' },
      { field: 'outside.0.type' },
      { field: 'incomeSuggestion.targetEnvelopeId' },
    ]);
    expect(mapped.matched).toBe(true);
    expect(mapped.cardErrors).toEqual({
      a: { fixedAmount: FIELD_TEXT.fixedAmount },
      m: { type: FIELD_TEXT.type },
      c: { type: FIELD_TEXT.type },
    });
    expect(mapped.suggestionErrors.targetEnvelopeId).toBeDefined();
    expect(mapServerErrors(body, [{ field: 'something' }]).matched).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @harmofin/web test -- app/components/funding-rules/rules-editor-state.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализация**

```ts
import type {
  EnvelopePlanDto,
  FundingRuleResponse,
  FundingRuleType,
  FundingRulesBatchQueueItem,
  IncomeSuggestionState,
  PutFundingRulesBatchRequest,
} from '../../composables/useEnvelopePlanV2.js';
import { toDecimalText } from '../envelopes/envelope-plan-kind.js';
import { basisPointsToPercent, percentToBasisPoints } from './funding-rule-text.js';

// Editing model of the funding rules page. Pure functions over plain data: the
// page keeps one EditorState, every change returns a new one. The browser only
// checks input shape; the server owns every rule and answers with field errors.

export type RuleField = 'type' | 'fixedAmount' | 'percentBasisPoints';

export interface RuleCard {
  envelopeId: string;
  name: string;
  envelopeType: string;
  /** '' — the envelope has no saved rule and none is chosen yet. */
  type: FundingRuleType | '';
  /** Decimal rubles as typed. */
  fixed: string;
  /** Percent as typed. */
  percent: string;
}

export interface SuggestionDraft {
  enabled: boolean;
  /** '' — not chosen. */
  sourceCategoryId: string;
  targetEnvelopeId: string;
}

export interface EditorState {
  queue: RuleCard[];
  outside: RuleCard[];
  suggestion: SuggestionDraft;
}

export type CardErrors = Record<string, Partial<Record<RuleField, string>>>;
export type SuggestionErrors = Partial<Record<'sourceCategoryId' | 'targetEnvelopeId', string>>;

type EnvelopeInput = Pick<EnvelopePlanDto, 'id' | 'name' | 'envelopeType' | 'archivedAt'>;

export const FIELD_TEXT: Record<RuleField, string> = {
  type: 'Проверьте тип правила для этого конверта.',
  fixedAmount: 'Укажите сумму больше нуля, не более двух знаков после запятой.',
  percentBasisPoints: 'Проценты: введите значение от 0 до 100, не более двух знаков после запятой.',
};
const SUGGESTION_TEXT = {
  sourceCategoryId: 'Выберите категорию дохода.',
  targetEnvelopeId: 'Выберите конверт.',
} as const;

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const ZERO_AMOUNT = /^0+(?:[.,]0+)?$/;

const byName = (left: RuleCard, right: RuleCard) => left.name.localeCompare(right.name, 'ru');
const isQueued = (type: FundingRuleType | '') => type !== '' && type !== 'MANUAL';
const hasFixed = (type: FundingRuleType | '') =>
  type === 'FIXED_PER_PERIOD' || type === 'SUGGESTED_FIXED';

export function buildState(
  envelopes: EnvelopeInput[],
  rules: FundingRuleResponse[],
  suggestion: IncomeSuggestionState,
): EditorState {
  const active = envelopes.filter((envelope) => envelope.archivedAt === null);
  const ruleOf = new Map(rules.map((rule) => [rule.envelopeId, rule]));
  const card = (envelope: EnvelopeInput): RuleCard => {
    const rule = ruleOf.get(envelope.id);
    return {
      envelopeId: envelope.id,
      name: envelope.name,
      envelopeType: envelope.envelopeType,
      type: rule?.type ?? '',
      fixed: rule?.fixedAmountMinor ? toDecimalText(rule.fixedAmountMinor) : '',
      percent: rule?.percentBasisPoints == null ? '' : basisPointsToPercent(rule.percentBasisPoints),
    };
  };
  const activeById = new Map(active.map((envelope) => [envelope.id, envelope]));
  // Server order (priority, then envelope id) is the queue order.
  const queue = rules
    .filter((rule) => rule.type !== 'MANUAL' && activeById.has(rule.envelopeId))
    .map((rule) => card(activeById.get(rule.envelopeId)!));
  const queued = new Set(queue.map((item) => item.envelopeId));
  const outside = active
    .filter((envelope) => !queued.has(envelope.id))
    .map(card)
    .sort(byName);
  return {
    queue,
    outside,
    suggestion: {
      enabled: suggestion.enabled,
      sourceCategoryId: suggestion.sourceCategoryId ?? '',
      targetEnvelopeId: suggestion.targetEnvelopeId ?? '',
    },
  };
}

export function setType(
  state: EditorState,
  envelopeId: string,
  type: FundingRuleType | '',
): EditorState {
  const inQueue = state.queue.find((item) => item.envelopeId === envelopeId);
  const current = inQueue ?? state.outside.find((item) => item.envelopeId === envelopeId);
  if (!current) return state;
  const next: RuleCard = { ...current, type };
  if (!isQueued(type)) {
    return {
      ...state,
      queue: state.queue.filter((item) => item.envelopeId !== envelopeId),
      outside: [...state.outside.filter((item) => item.envelopeId !== envelopeId), next].sort(byName),
    };
  }
  if (inQueue) {
    return {
      ...state,
      queue: state.queue.map((item) => (item.envelopeId === envelopeId ? next : item)),
    };
  }
  return {
    ...state,
    queue: [...state.queue, next],
    outside: state.outside.filter((item) => item.envelopeId !== envelopeId),
  };
}

export function updateCard(
  state: EditorState,
  envelopeId: string,
  patch: Partial<Pick<RuleCard, 'fixed' | 'percent'>>,
): EditorState {
  const apply = (item: RuleCard) => (item.envelopeId === envelopeId ? { ...item, ...patch } : item);
  return { ...state, queue: state.queue.map(apply), outside: state.outside.map(apply) };
}

export function move(state: EditorState, from: number, to: number): EditorState {
  const last = state.queue.length - 1;
  if (from === to || from < 0 || from > last || to < 0 || to > last) return state;
  const queue = [...state.queue];
  const [item] = queue.splice(from, 1);
  queue.splice(to, 0, item!);
  return { ...state, queue };
}

export function snapshotOf(state: EditorState): string {
  return JSON.stringify(state);
}

export function buildRequest(state: EditorState): {
  body: PutFundingRulesBatchRequest | null;
  cardErrors: CardErrors;
  suggestionErrors: SuggestionErrors;
} {
  const cardErrors: CardErrors = {};
  const queue: FundingRulesBatchQueueItem[] = [];
  for (const card of state.queue) {
    const item = { envelopeId: card.envelopeId, type: card.type } as FundingRulesBatchQueueItem;
    if (hasFixed(card.type)) {
      const text = card.fixed.trim();
      if (AMOUNT_PATTERN.test(text) && !ZERO_AMOUNT.test(text)) {
        item.fixedAmount = text.replace(',', '.');
      } else {
        cardErrors[card.envelopeId] = { fixedAmount: FIELD_TEXT.fixedAmount };
      }
    }
    if (card.type === 'PERCENT_OF_INCOME') {
      const basisPoints = percentToBasisPoints(card.percent);
      if (basisPoints === null) {
        cardErrors[card.envelopeId] = { percentBasisPoints: FIELD_TEXT.percentBasisPoints };
      } else {
        item.percentBasisPoints = basisPoints;
      }
    }
    queue.push(item);
  }
  const outside = state.outside
    .filter((card) => card.type === 'MANUAL')
    .map((card) => ({ envelopeId: card.envelopeId, type: 'MANUAL' as const }));

  const { suggestion } = state;
  const suggestionErrors: SuggestionErrors = {};
  if (suggestion.enabled && suggestion.sourceCategoryId === '') {
    suggestionErrors.sourceCategoryId = SUGGESTION_TEXT.sourceCategoryId;
  }
  if (suggestion.enabled && suggestion.targetEnvelopeId === '') {
    suggestionErrors.targetEnvelopeId = SUGGESTION_TEXT.targetEnvelopeId;
  }

  const invalid =
    Object.keys(cardErrors).length > 0 || Object.keys(suggestionErrors).length > 0;
  return {
    body: invalid
      ? null
      : {
          queue,
          outside,
          incomeSuggestion: {
            enabled: suggestion.enabled,
            sourceCategoryId: suggestion.sourceCategoryId || null,
            targetEnvelopeId: suggestion.targetEnvelopeId || null,
          },
        },
    cardErrors,
    suggestionErrors,
  };
}

const RULE_PATH = /^(queue|outside)\.(\d+)\.(envelopeId|type|fixedAmount|percentBasisPoints)$/;
const SUGGESTION_PATH = /^incomeSuggestion\.(sourceCategoryId|targetEnvelopeId)$/;

export function mapServerErrors(
  body: PutFundingRulesBatchRequest,
  fieldErrors: Array<{ field: string }>,
): { cardErrors: CardErrors; suggestionErrors: SuggestionErrors; matched: boolean } {
  const cardErrors: CardErrors = {};
  const suggestionErrors: SuggestionErrors = {};
  let matched = false;
  for (const { field } of fieldErrors) {
    const rule = RULE_PATH.exec(field);
    if (rule) {
      const item = body[rule[1] as 'queue' | 'outside'][Number(rule[2])];
      if (!item) continue;
      const key: RuleField = rule[3] === 'envelopeId' ? 'type' : (rule[3] as RuleField);
      cardErrors[item.envelopeId] = { ...cardErrors[item.envelopeId], [key]: FIELD_TEXT[key] };
      matched = true;
      continue;
    }
    const suggestion = SUGGESTION_PATH.exec(field);
    if (suggestion) {
      const key = suggestion[1] as 'sourceCategoryId' | 'targetEnvelopeId';
      suggestionErrors[key] = SUGGESTION_TEXT[key];
      matched = true;
    }
  }
  return { cardErrors, suggestionErrors, matched };
}
```

- [ ] **Step 4: Тесты проходят**

Run: `pnpm --filter @harmofin/web test -- app/components/funding-rules/rules-editor-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (после «да» владельца)**

```bash
git add apps/web/app/components/funding-rules/rules-editor-state.ts apps/web/app/components/funding-rules/rules-editor-state.test.ts
git commit -m "feat(web): модель состояния редактора правил пополнения"
```

---

### Task 5: Web — composable перетаскивания `useSortableList`

**Files:**
- Create: `apps/web/app/composables/useSortableList.ts`
- Create: `apps/web/app/composables/useSortableList.test.ts`

**Interfaces:**
- Produces:

```ts
export function useSortableList(options: {
  container: Ref<HTMLElement | null>;
  itemSelector: string;
  onMove: (from: number, to: number) => void;
  onDrop?: (index: number) => void;
}): { draggingIndex: Ref<number | null>; startDrag: (event: PointerEvent, index: number) => void };
```

Поведение: `startDrag` вызывается из `pointerdown` на ручке. Пока кнопка нажата, на каждом `pointermove` новый индекс = число НЕперетаскиваемых элементов, середина которых выше `clientY`; если он отличается — `onMove(current, next)` и `draggingIndex = next` (живая перестановка). На `pointerup`/`pointercancel` — `onDrop(draggingIndex)` и сброс. У края окна (48px) — `window.scrollBy(0, ±12)`.

- [ ] **Step 1: Падающий тест**

```ts
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import { useSortableList } from './useSortableList.js';

afterEach(() => vi.restoreAllMocks());

function harness(onMove = vi.fn(), onDrop = vi.fn()) {
  const component = defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null);
      const sortable = useSortableList({ container, itemSelector: '[data-item]', onMove, onDrop });
      return () =>
        h(
          'ol',
          { ref: container },
          [0, 1, 2].map((index) =>
            h('li', { 'data-item': '', 'data-index': index }, [
              h('span', {
                'data-handle': index,
                onPointerdown: (event: PointerEvent) => sortable.startDrag(event, index),
              }),
            ]),
          ),
        );
    },
  });
  const wrapper = mount(component, { attachTo: document.body });
  // Items 40px high at 0, 40, 80: midpoints 20, 60, 100.
  wrapper.findAll('[data-item]').forEach((item, index) => {
    vi.spyOn(item.element, 'getBoundingClientRect').mockReturnValue({
      top: index * 40,
      height: 40,
      bottom: index * 40 + 40,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: index * 40,
      toJSON: () => ({}),
    });
  });
  return { wrapper, onMove, onDrop };
}

const pointer = (type: string, clientY: number) =>
  new MouseEvent(type, { clientY, button: 0, bubbles: true, cancelable: true });

describe('useSortableList', () => {
  it('переставляет при движении ниже середины соседа и сообщает итоговый индекс', async () => {
    const { wrapper, onMove, onDrop } = harness();
    wrapper.find('[data-handle="0"]').element.dispatchEvent(pointer('pointerdown', 20));
    window.dispatchEvent(pointer('pointermove', 70));
    expect(onMove).toHaveBeenLastCalledWith(0, 1);
    window.dispatchEvent(pointer('pointermove', 110));
    expect(onMove).toHaveBeenLastCalledWith(1, 2);
    window.dispatchEvent(pointer('pointerup', 110));
    expect(onDrop).toHaveBeenCalledWith(2);
    window.dispatchEvent(pointer('pointermove', 0));
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it('не реагирует на правую кнопку', () => {
    const { wrapper, onMove } = harness();
    wrapper
      .find('[data-handle="0"]')
      .element.dispatchEvent(new MouseEvent('pointerdown', { button: 2, clientY: 20, bubbles: true }));
    window.dispatchEvent(pointer('pointermove', 110));
    expect(onMove).not.toHaveBeenCalled();
  });
});
```

Тест не учитывает, что после `onMove` DOM в харнессе не переставляется: середины считаются по исходному порядку, а исключается элемент по текущему `draggingIndex`. При движении к 70: исключён индекс 0, середины 60 (idx1) и 100 (idx2), выше 70 одна → next = 1. При 110: исключён idx1 (теперь draggingIndex = 1; в DOM это элемент со серединой 60), остальные — 20 и 100, обе выше 110 → next = 2. Ожидания совпадают.

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @harmofin/web test -- app/composables/useSortableList.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализация**

```ts
import { onBeforeUnmount, ref, type Ref } from 'vue';

// Vertical drag-and-drop on pointer events (mouse and touch, no dependency).
// The list re-renders on every onMove, so the dragged item follows the pointer.
// Keyboard users reorder with explicit buttons; this is the pointer path only.

const EDGE = 48;
const STEP = 12;

export function useSortableList(options: {
  container: Ref<HTMLElement | null>;
  itemSelector: string;
  onMove: (from: number, to: number) => void;
  onDrop?: (index: number) => void;
}) {
  const draggingIndex = ref<number | null>(null);

  function targetIndex(clientY: number): number {
    const items = Array.from(
      options.container.value?.querySelectorAll<HTMLElement>(options.itemSelector) ?? [],
    );
    let index = 0;
    items.forEach((item, position) => {
      if (position === draggingIndex.value) return;
      const rect = item.getBoundingClientRect();
      if (rect.top + rect.height / 2 < clientY) index += 1;
    });
    return index;
  }

  function onPointerMove(event: PointerEvent | MouseEvent): void {
    if (draggingIndex.value === null) return;
    event.preventDefault();
    if (event.clientY < EDGE) window.scrollBy(0, -STEP);
    else if (event.clientY > window.innerHeight - EDGE) window.scrollBy(0, STEP);
    const next = targetIndex(event.clientY);
    if (next !== draggingIndex.value) {
      options.onMove(draggingIndex.value, next);
      draggingIndex.value = next;
    }
  }

  function stop(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  function onPointerUp(): void {
    const index = draggingIndex.value;
    stop();
    draggingIndex.value = null;
    if (index !== null) options.onDrop?.(index);
  }

  function startDrag(event: PointerEvent | MouseEvent, index: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingIndex.value = index;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  onBeforeUnmount(stop);

  return { draggingIndex, startDrag };
}
```

- [ ] **Step 4: Тест проходит**

Run: `pnpm --filter @harmofin/web test -- app/composables/useSortableList.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (после «да» владельца)**

```bash
git add apps/web/app/composables/useSortableList.ts apps/web/app/composables/useSortableList.test.ts
git commit -m "feat(web): перетаскивание в вертикальном списке на pointer events"
```

---

### Task 6: Web — карточка и редактор правил

**Files:**
- Create: `apps/web/app/components/funding-rules/FundingRuleCard.vue`
- Create: `apps/web/app/components/funding-rules/FundingRulesEditor.vue`
- Create: `apps/web/app/components/funding-rules/FundingRulesEditor.test.ts`

**Interfaces:**
- Consumes: Task 3 (`listFundingRules`, `saveFundingRules`, тексты), Task 4 (модель), Task 5 (`useSortableList`), `useBudgetReferenceData().getBudget/listCategories`, `useEnvelopePlanV2().listEnvelopes`, `useToast`, `v2ErrorMessage`, `ApiRequestError`.
- Produces: `<FundingRulesEditor :budget-id @dirty="(value: boolean) => …" />`; `FundingRuleCard` с props `card: RuleCard`, `position: number | null`, `incomeLabel: string | null`, `errors: Partial<Record<RuleField, string>>`, `canMoveUp: boolean`, `canMoveDown: boolean`, `dragging: boolean` и emits `type(value)`, `fixed(value)`, `percent(value)`, `up`, `down`, `grab(event)`.

Тестовые идентификаторы (на них опирается E2E): `rules-queue`, `rules-outside`, `rule-card-<envelopeId>`, `rule-type-<envelopeId>`, `rule-fixed-<envelopeId>`, `rule-percent-<envelopeId>`, `rule-up-<envelopeId>`, `rule-down-<envelopeId>`, `rule-income-<envelopeId>`, `rules-save`, `rules-reset`, `rules-error`, `rules-announce`, `suggestion-enabled`, `suggestion-category`, `suggestion-envelope`.

- [ ] **Step 1: Падающий тест редактора**

```ts
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../composables/useApiClient.js';

enableAutoUnmount(afterEach);

const BUDGET = 'budget-1';

const mocks = vi.hoisted(() => ({
  v2: { listEnvelopes: vi.fn(), listFundingRules: vi.fn(), saveFundingRules: vi.fn() },
  reference: { getBudget: vi.fn(), listCategories: vi.fn() },
  push: vi.fn(),
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
vi.mock('../../composables/useBudgetReferenceData.js', () => ({
  useBudgetReferenceData: () => mocks.reference,
}));
vi.mock('../../composables/useToast.js', () => ({ useToast: () => ({ push: mocks.push }) }));

import FundingRulesEditor from './FundingRulesEditor.vue';

const envelope = (id: string, name: string, envelopeType = 'CURRENT_EXPENSES') => ({
  id,
  name,
  envelopeType,
  periodSlot: null,
  targetAmountMinor: null,
  comment: null,
  fundedMinor: '0',
  spentMinor: '0',
  balanceMinor: '0',
  archivedAt: null,
});
const rule = (envelopeId: string, type: string, priority: number, extra = {}) => ({
  id: `r-${envelopeId}`,
  envelopeId,
  type,
  priority,
  fixedAmountMinor: null,
  percentBasisPoints: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.v2.listEnvelopes.mockResolvedValue({
    items: [envelope('a', 'Еда'), envelope('b', 'Подушка', 'SAVINGS_GOAL'), envelope('c', 'Аптека')],
  });
  mocks.v2.listFundingRules.mockResolvedValue({
    items: [
      rule('a', 'FIXED_PER_PERIOD', 10, { fixedAmountMinor: '1500000' }),
      rule('b', 'PERCENT_OF_INCOME', 20, { percentBasisPoints: 1000 }),
    ],
  });
  mocks.reference.getBudget.mockResolvedValue({
    incomeAllocationRuleEnabled: true,
    incomeAllocationSourceCategoryId: 'cat',
    incomeAllocationTargetEnvelopeId: 'b',
  });
  mocks.reference.listCategories.mockResolvedValue([{ id: 'cat', name: 'Зарплата' }]);
});

async function mountEditor() {
  const wrapper = mount(FundingRulesEditor, { props: { budgetId: BUDGET }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}
const queueIds = (wrapper: Awaited<ReturnType<typeof mountEditor>>) =>
  wrapper.findAll('[data-testid="rules-queue"] [data-queue-item]').map((item) => item.attributes('data-envelope-id'));

describe('FundingRulesEditor', () => {
  it('показывает очередь по порядку, вне очереди и метку дохода', async () => {
    const wrapper = await mountEditor();
    expect(queueIds(wrapper)).toEqual(['a', 'b']);
    expect(wrapper.find('[data-testid="rules-outside"]').text()).toContain('Аптека');
    expect(wrapper.find('[data-testid="rules-outside"]').text()).toContain('Правило не задано');
    expect(wrapper.find('[data-testid="rule-income-b"]').text()).toContain('Доход: Зарплата');
    expect(wrapper.find('[data-testid="rules-save"]').attributes('disabled')).toBeDefined();
  });

  it('смена типа переносит карточку между зонами и включает сохранение', async () => {
    const wrapper = await mountEditor();
    const emitted = () => wrapper.emitted('dirty') ?? [];
    await wrapper.find('[data-testid="rule-type-a"]').setValue('MANUAL');
    expect(queueIds(wrapper)).toEqual(['b']);
    expect(wrapper.find('[data-testid="rules-outside"]').text()).toContain('Еда');
    expect(emitted().at(-1)).toEqual([true]);
    expect(wrapper.find('[data-testid="rules-save"]').attributes('disabled')).toBeUndefined();
    await wrapper.find('[data-testid="rules-reset"]').trigger('click');
    expect(queueIds(wrapper)).toEqual(['a', 'b']);
    expect(emitted().at(-1)).toEqual([false]);
  });

  it('кнопки ↑/↓ переставляют и объявляют позицию', async () => {
    const wrapper = await mountEditor();
    await wrapper.find('[data-testid="rule-down-a"]').trigger('click');
    expect(queueIds(wrapper)).toEqual(['b', 'a']);
    expect(wrapper.find('[data-testid="rules-announce"]').text()).toBe('Еда: позиция 2 из 2');
    expect(wrapper.find('[data-testid="rule-down-a"]').attributes('disabled')).toBeDefined();
  });

  it('сохраняет одним запросом и перечитывает ответ', async () => {
    mocks.v2.saveFundingRules.mockResolvedValue({
      items: [
        rule('b', 'PERCENT_OF_INCOME', 10, { percentBasisPoints: 1000 }),
        rule('a', 'FIXED_PER_PERIOD', 20, { fixedAmountMinor: '1500000' }),
      ],
      incomeSuggestion: { enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' },
    });
    const wrapper = await mountEditor();
    await wrapper.find('[data-testid="rule-up-b"]').trigger('click');
    await wrapper.find('[data-testid="rules-save"]').trigger('click');
    await flushPromises();
    const [budgetId, body, key] = mocks.v2.saveFundingRules.mock.calls[0]!;
    expect(budgetId).toBe(BUDGET);
    expect(body).toEqual({
      queue: [
        { envelopeId: 'b', type: 'PERCENT_OF_INCOME', percentBasisPoints: 1000 },
        { envelopeId: 'a', type: 'FIXED_PER_PERIOD', fixedAmount: '15000.00' },
      ],
      outside: [],
      incomeSuggestion: { enabled: true, sourceCategoryId: 'cat', targetEnvelopeId: 'b' },
    });
    expect(typeof key).toBe('string');
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
    expect(wrapper.find('[data-testid="rules-save"]').attributes('disabled')).toBeDefined();
  });

  it('ошибка формы показывается у поля, запрос не уходит', async () => {
    const wrapper = await mountEditor();
    await wrapper.find('[data-testid="rule-fixed-a"]').setValue('0');
    await wrapper.find('[data-testid="rules-save"]').trigger('click');
    expect(mocks.v2.saveFundingRules).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="rule-card-a"]').text()).toContain('Укажите сумму больше нуля');
    expect(wrapper.find('[data-testid="rule-fixed-a"]').attributes('aria-invalid')).toBe('true');
  });

  it('ошибка сервера с путём показывается в нужной карточке', async () => {
    mocks.v2.saveFundingRules.mockRejectedValue(
      new ApiRequestError(422, {
        type: 'about:blank',
        title: 'Unprocessable',
        status: 422,
        code: 'ENVELOPE_ARCHIVED',
        detail: 'Конверт архивирован.',
        fieldErrors: [{ field: 'queue.1.envelopeId', message: 'x', code: 'invalid' }],
      } as never),
    );
    const wrapper = await mountEditor();
    await wrapper.find('[data-testid="rule-percent-b"]').setValue('11');
    await wrapper.find('[data-testid="rules-save"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="rule-card-b"]').text()).toContain('Проверьте тип правила');
  });

  it('ошибка загрузки и повтор', async () => {
    mocks.v2.listFundingRules.mockRejectedValueOnce(new Error('boom'));
    const wrapper = await mountEditor();
    expect(wrapper.text()).toContain('Не удалось загрузить правила');
    await wrapper.find('[data-testid="rules-retry"]').trigger('click');
    await flushPromises();
    expect(queueIds(wrapper)).toEqual(['a', 'b']);
  });
});
```

Форму объекта `ProblemDetails` для `new ApiRequestError(...)` сверить с `apps/web/app/composables/useApiClient.ts` и подставить обязательные поля.

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @harmofin/web test -- app/components/funding-rules/FundingRulesEditor.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: `FundingRuleCard.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, ChevronDown, ChevronUp, GripVertical, Wallet } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiCard from '../ui/Card.vue';
import UiInfoTooltip from '../ui/InfoTooltip.vue';
import type { FundingRuleType } from '../../composables/useEnvelopePlanV2.js';
import { RULE_TYPE_HINTS, RULE_TYPE_LABELS, ruleTypeOptions } from './funding-rule-text.js';
import type { RuleCard, RuleField } from './rules-editor-state.js';

defineOptions({ name: 'FundingRuleCard' });

const props = defineProps<{
  card: RuleCard;
  /** 1-based queue position; null outside the queue. */
  position: number | null;
  incomeLabel: string | null;
  errors: Partial<Record<RuleField, string>>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
}>();
const emit = defineEmits<{
  type: [value: FundingRuleType | ''];
  fixed: [value: string];
  percent: [value: string];
  up: [];
  down: [];
  grab: [event: PointerEvent];
}>();

const id = computed(() => props.card.envelopeId);
const options = computed(() => ruleTypeOptions(props.card.envelopeType));
const typeHint = computed(() =>
  props.card.type === ''
    ? 'Тип определяет, как сервер предлагает сумму.'
    : RULE_TYPE_HINTS[props.card.type],
);
const showsFixed = computed(
  () => props.card.type === 'FIXED_PER_PERIOD' || props.card.type === 'SUGGESTED_FIXED',
);
const fixedLabel = computed(() =>
  props.card.type === 'SUGGESTED_FIXED' ? 'Предлагаемая сумма, ₽' : 'Сумма на период, ₽',
);
</script>

<template>
  <UiCard
    as="article"
    class="rule-card"
    :class="{ 'rule-card--dragging': dragging }"
    :data-testid="`rule-card-${id}`"
    :aria-label="position === null ? card.name : `${position}. ${card.name}`"
  >
    <div class="rule-card__head">
      <span
        v-if="position !== null"
        class="rule-card__handle"
        aria-hidden="true"
        :data-testid="`rule-handle-${id}`"
        @pointerdown="emit('grab', $event)"
      >
        <GripVertical :size="20" />
      </span>
      <span v-if="position !== null" class="rule-card__position">{{ position }}</span>
      <h3 class="rule-card__name">{{ card.name }}</h3>
      <div v-if="position !== null" class="rule-card__moves">
        <UiButton
          variant="tertiary"
          size="sm"
          :aria-label="`Переместить выше: ${card.name}`"
          tooltip="Выше"
          :disabled="!canMoveUp"
          :data-testid="`rule-up-${id}`"
          @click="emit('up')"
        >
          <ChevronUp :size="18" aria-hidden="true" />
        </UiButton>
        <UiButton
          variant="tertiary"
          size="sm"
          :aria-label="`Переместить ниже: ${card.name}`"
          tooltip="Ниже"
          :disabled="!canMoveDown"
          :data-testid="`rule-down-${id}`"
          @click="emit('down')"
        >
          <ChevronDown :size="18" aria-hidden="true" />
        </UiButton>
      </div>
    </div>

    <p v-if="incomeLabel" class="rule-card__badge" :data-testid="`rule-income-${id}`">
      <Wallet :size="14" aria-hidden="true" />
      {{ incomeLabel }}
    </p>
    <p v-if="card.type === ''" class="rule-card__muted">Правило не задано</p>

    <div class="rule-card__field">
      <span class="rule-card__label">
        <label :for="`rule-type-${id}`">Тип правила</label>
        <UiInfoTooltip :text="typeHint" :label="`Подсказка: тип правила, ${card.name}`" />
      </span>
      <select
        :id="`rule-type-${id}`"
        class="rule-card__input"
        :data-testid="`rule-type-${id}`"
        :value="card.type"
        :aria-invalid="errors.type ? 'true' : undefined"
        :aria-describedby="errors.type ? `rule-type-error-${id}` : undefined"
        @change="emit('type', ($event.target as HTMLSelectElement).value as FundingRuleType | '')"
      >
        <option value="" disabled>Выберите тип</option>
        <option v-for="value in options" :key="value" :value="value">
          {{ RULE_TYPE_LABELS[value] }}
        </option>
      </select>
      <p v-if="errors.type" :id="`rule-type-error-${id}`" class="rule-card__error">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ errors.type }}
      </p>
    </div>

    <div v-if="showsFixed" class="rule-card__field">
      <label class="rule-card__label" :for="`rule-fixed-${id}`">{{ fixedLabel }}</label>
      <input
        :id="`rule-fixed-${id}`"
        class="rule-card__input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :data-testid="`rule-fixed-${id}`"
        :value="card.fixed"
        :aria-invalid="errors.fixedAmount ? 'true' : undefined"
        :aria-describedby="`rule-fixed-hint-${id}${errors.fixedAmount ? ` rule-fixed-error-${id}` : ''}`"
        @input="emit('fixed', ($event.target as HTMLInputElement).value)"
      />
      <p :id="`rule-fixed-hint-${id}`" class="rule-card__muted">
        Сумма больше нуля, не более двух знаков после запятой.
      </p>
      <p v-if="errors.fixedAmount" :id="`rule-fixed-error-${id}`" class="rule-card__error">
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ errors.fixedAmount }}
      </p>
    </div>

    <div v-if="card.type === 'PERCENT_OF_INCOME'" class="rule-card__field">
      <label class="rule-card__label" :for="`rule-percent-${id}`">Процент от дохода, %</label>
      <input
        :id="`rule-percent-${id}`"
        class="rule-card__input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :data-testid="`rule-percent-${id}`"
        :value="card.percent"
        :aria-invalid="errors.percentBasisPoints ? 'true' : undefined"
        :aria-describedby="`rule-percent-hint-${id}${errors.percentBasisPoints ? ` rule-percent-error-${id}` : ''}`"
        @input="emit('percent', ($event.target as HTMLInputElement).value)"
      />
      <p :id="`rule-percent-hint-${id}`" class="rule-card__muted">
        Значение от 0 до 100, не более двух знаков после запятой.
      </p>
      <p
        v-if="errors.percentBasisPoints"
        :id="`rule-percent-error-${id}`"
        class="rule-card__error"
      >
        <AlertTriangle :size="14" aria-hidden="true" />
        {{ errors.percentBasisPoints }}
      </p>
    </div>
  </UiCard>
</template>

<style scoped>
.rule-card {
  display: grid;
  gap: var(--hf-space-3);
  min-width: 0;
}

.rule-card--dragging {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.rule-card__head {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  min-width: 0;
}

.rule-card__handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  color: var(--hf-color-text-subtle);
  cursor: grab;
  touch-action: none;
}

.rule-card--dragging .rule-card__handle {
  cursor: grabbing;
}

.rule-card__position {
  font-variant-numeric: tabular-nums;
  font-weight: var(--hf-font-weight-semibold);
  color: var(--hf-color-text-muted);
}

.rule-card__name {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
  overflow-wrap: anywhere;
}

.rule-card__moves {
  display: flex;
  gap: var(--hf-space-1);
}

.rule-card__badge {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
  width: fit-content;
  margin: 0;
  padding: var(--hf-space-1) var(--hf-space-2);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-surface-subtle);
  font-size: var(--hf-font-size-small);
}

.rule-card__field {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-small);
}

.rule-card__label {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-1);
}

.rule-card__input {
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.rule-card__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.rule-card__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.rule-card__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.rule-card__error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}
</style>
```

Если в `@lucide/vue` нет иконки `Wallet`, взять `Banknote` (проверить: `grep -rn "Banknote\|Wallet" apps/web/app --include=*.vue | head -2`). Если `UiButton` не прокидывает `disabled` в атрибут кнопки — тест в Step 1 проверяет атрибут `disabled` у корневого элемента `UiButton`; сверить по `Button.vue` и при необходимости проверять `aria-disabled`.

- [ ] **Step 4: `FundingRulesEditor.vue`**

```vue
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { AlertTriangle, ArrowDown } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import UiInfoTooltip from '../ui/InfoTooltip.vue';
import UiSkeleton from '../ui/Skeleton.vue';
import { ApiRequestError } from '../../composables/useApiClient.js';
import { useBudgetReferenceData } from '../../composables/useBudgetReferenceData.js';
import {
  type EnvelopePlanDto,
  type FundingRuleType,
  type PutFundingRulesBatchRequest,
  useEnvelopePlanV2,
} from '../../composables/useEnvelopePlanV2.js';
import { useSortableList } from '../../composables/useSortableList.js';
import { useToast } from '../../composables/useToast.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import FundingRuleCard from './FundingRuleCard.vue';
import { OUTSIDE_HINT, QUEUE_HINT, SUGGESTION_HINT } from './funding-rule-text.js';
import {
  type CardErrors,
  type EditorState,
  type SuggestionErrors,
  buildRequest,
  buildState,
  mapServerErrors,
  move,
  setType,
  snapshotOf,
  updateCard,
} from './rules-editor-state.js';

defineOptions({ name: 'FundingRulesEditor' });

// The whole budget's funding rules on one screen. Reads envelopes, rules, the
// budget's income suggestion and income categories; saves everything with one
// batch request. The order of the queue is what the server uses to distribute
// income. Rules are settings: saving never moves money.

const props = defineProps<{ budgetId: string }>();
const emit = defineEmits<{ dirty: [value: boolean] }>();

const v2 = useEnvelopePlanV2();
const reference = useBudgetReferenceData();
const { push } = useToast();

const loading = ref(true);
const loadError = ref('');
const envelopes = ref<EnvelopePlanDto[]>([]);
const categories = ref<Array<{ id: string; name: string }>>([]);
const state = ref<EditorState | null>(null);
const initial = ref('');
const cardErrors = ref<CardErrors>({});
const suggestionErrors = ref<SuggestionErrors>({});
const formError = ref('');
const saving = ref(false);
const announcement = ref('');
const queueList = ref<HTMLElement | null>(null);

const dirty = computed(() => state.value !== null && snapshotOf(state.value) !== initial.value);
watch(dirty, (value) => emit('dirty', value));

const incomeLabel = computed(() => {
  const suggestion = state.value?.suggestion;
  if (!suggestion?.enabled || suggestion.targetEnvelopeId === '') return null;
  const category = categories.value.find((item) => item.id === suggestion.sourceCategoryId);
  return category ? { envelopeId: suggestion.targetEnvelopeId, text: `Доход: ${category.name}` } : null;
});
const labelFor = (envelopeId: string) =>
  incomeLabel.value?.envelopeId === envelopeId ? incomeLabel.value.text : null;
const allCards = computed(() => (state.value ? [...state.value.queue, ...state.value.outside] : []));

function apply(next: EditorState): void {
  state.value = next;
  initial.value = snapshotOf(next);
  cardErrors.value = {};
  suggestionErrors.value = {};
  formError.value = '';
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [envelopeList, rules, budget, incomeCategories] = await Promise.all([
      v2.listEnvelopes(props.budgetId),
      v2.listFundingRules(props.budgetId),
      reference.getBudget(props.budgetId),
      reference.listCategories(props.budgetId, 'INCOME', 'active'),
    ]);
    envelopes.value = envelopeList.items;
    categories.value = incomeCategories.map((item) => ({ id: item.id, name: item.name }));
    apply(
      buildState(envelopeList.items, rules.items, {
        enabled: budget.incomeAllocationRuleEnabled,
        sourceCategoryId: budget.incomeAllocationSourceCategoryId,
        targetEnvelopeId: budget.incomeAllocationTargetEnvelopeId,
      }),
    );
  } catch (error) {
    loadError.value = v2ErrorMessage(error, 'Не удалось загрузить правила. Повторите попытку.');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function reset(): void {
  if (!state.value || saving.value) return;
  apply(JSON.parse(initial.value) as EditorState);
}

function onType(envelopeId: string, type: FundingRuleType | ''): void {
  if (!state.value) return;
  state.value = setType(state.value, envelopeId, type);
  delete cardErrors.value[envelopeId];
}
function onFixed(envelopeId: string, fixed: string): void {
  if (state.value) state.value = updateCard(state.value, envelopeId, { fixed });
}
function onPercent(envelopeId: string, percent: string): void {
  if (state.value) state.value = updateCard(state.value, envelopeId, { percent });
}

function announce(index: number): void {
  const queue = state.value?.queue ?? [];
  const card = queue[index];
  if (card) announcement.value = `${card.name}: позиция ${index + 1} из ${queue.length}`;
}

function moveBy(index: number, delta: -1 | 1): void {
  if (!state.value) return;
  const to = index + delta;
  const card = state.value.queue[index];
  const next = move(state.value, index, to);
  if (next === state.value || !card) return;
  state.value = next;
  announce(to);
  void nextTick(() => {
    const atEdge = to === 0 || to === next.queue.length - 1;
    const direction = atEdge ? (delta < 0 ? 'down' : 'up') : delta < 0 ? 'up' : 'down';
    document
      .querySelector<HTMLElement>(`[data-testid="rule-${direction}-${card.envelopeId}"]`)
      ?.focus();
  });
}

const sortable = useSortableList({
  container: queueList,
  itemSelector: '[data-queue-item]',
  onMove: (from, to) => {
    if (state.value) state.value = move(state.value, from, to);
  },
  onDrop: announce,
});

function setSuggestion(patch: Partial<EditorState['suggestion']>): void {
  if (!state.value) return;
  state.value = { ...state.value, suggestion: { ...state.value.suggestion, ...patch } };
  suggestionErrors.value = {};
}

// One Idempotency-Key per distinct attempt; the same body retried keeps it.
let attempt: { fingerprint: string; key: string } | null = null;
function attemptKey(body: PutFundingRulesBatchRequest): string {
  const fingerprint = JSON.stringify(body);
  if (attempt?.fingerprint !== fingerprint) attempt = { fingerprint, key: crypto.randomUUID() };
  return attempt.key;
}

function focusFirstInvalid(): void {
  void nextTick(() => {
    document.querySelector<HTMLElement>('.rules-editor [aria-invalid="true"]')?.focus();
  });
}

async function save(): Promise<void> {
  if (!state.value || saving.value || !dirty.value) return;
  formError.value = '';
  const result = buildRequest(state.value);
  cardErrors.value = result.cardErrors;
  suggestionErrors.value = result.suggestionErrors;
  if (!result.body) {
    focusFirstInvalid();
    return;
  }
  saving.value = true;
  try {
    const response = await v2.saveFundingRules(props.budgetId, result.body, attemptKey(result.body));
    attempt = null;
    apply(buildState(envelopes.value, response.items, response.incomeSuggestion));
    push({
      tone: 'success',
      title: 'Правила сохранены',
      description: 'Распределения и остатки не изменились.',
    });
  } catch (error) {
    const mapped =
      error instanceof ApiRequestError
        ? mapServerErrors(result.body, error.problem.fieldErrors ?? [])
        : null;
    if (mapped?.matched) {
      cardErrors.value = mapped.cardErrors;
      suggestionErrors.value = mapped.suggestionErrors;
      focusFirstInvalid();
    } else {
      formError.value = v2ErrorMessage(
        error,
        'Не удалось сохранить правила. Повторите попытку: дубль не создастся.',
      );
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="rules-editor">
    <UiEmptyState v-if="loadError" title="Правила недоступны" :description="loadError">
      <template #action>
        <UiButton data-testid="rules-retry" @click="load">Повторить</UiButton>
      </template>
    </UiEmptyState>
    <div v-else-if="loading && !state" aria-busy="true">
      <UiSkeleton variant="row" :count="4" />
    </div>

    <template v-else-if="state">
      <section class="rules-editor__block" aria-labelledby="suggestion-title">
        <h2 id="suggestion-title" class="rules-editor__title">
          Предложение для дохода
          <UiInfoTooltip :text="SUGGESTION_HINT" label="Подсказка: предложение для дохода" />
        </h2>
        <label class="rules-editor__switch">
          <input
            type="checkbox"
            role="switch"
            data-testid="suggestion-enabled"
            :checked="state.suggestion.enabled"
            @change="setSuggestion({ enabled: ($event.target as HTMLInputElement).checked })"
          />
          Включено
        </label>
        <div class="rules-editor__suggestion">
          <label class="rules-editor__field">
            <span>Доход категории</span>
            <select
              class="rules-editor__input"
              data-testid="suggestion-category"
              :disabled="!state.suggestion.enabled"
              :value="state.suggestion.sourceCategoryId"
              :aria-invalid="suggestionErrors.sourceCategoryId ? 'true' : undefined"
              :aria-describedby="suggestionErrors.sourceCategoryId ? 'suggestion-category-error' : undefined"
              @change="setSuggestion({ sourceCategoryId: ($event.target as HTMLSelectElement).value })"
            >
              <option value="">Не выбрана</option>
              <option v-for="item in categories" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
          </label>
          <label class="rules-editor__field">
            <span>предлагать в конверт</span>
            <select
              class="rules-editor__input"
              data-testid="suggestion-envelope"
              :disabled="!state.suggestion.enabled"
              :value="state.suggestion.targetEnvelopeId"
              :aria-invalid="suggestionErrors.targetEnvelopeId ? 'true' : undefined"
              :aria-describedby="suggestionErrors.targetEnvelopeId ? 'suggestion-envelope-error' : undefined"
              @change="setSuggestion({ targetEnvelopeId: ($event.target as HTMLSelectElement).value })"
            >
              <option value="">Не выбран</option>
              <option v-for="card in allCards" :key="card.envelopeId" :value="card.envelopeId">
                {{ card.name }}
              </option>
            </select>
          </label>
        </div>
        <p v-if="suggestionErrors.sourceCategoryId" id="suggestion-category-error" class="rules-editor__error">
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ suggestionErrors.sourceCategoryId }}
        </p>
        <p v-if="suggestionErrors.targetEnvelopeId" id="suggestion-envelope-error" class="rules-editor__error">
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ suggestionErrors.targetEnvelopeId }}
        </p>
      </section>

      <section class="rules-editor__block" aria-labelledby="queue-title">
        <h2 id="queue-title" class="rules-editor__title">
          Очередь распределения
          <UiInfoTooltip :text="QUEUE_HINT" label="Подсказка: очередь распределения" />
        </h2>
        <p v-if="state.queue.length === 0" class="rules-editor__muted">
          В очереди пока нет конвертов: выберите тип правила у конверта ниже.
        </p>
        <ol ref="queueList" class="rules-editor__queue" data-testid="rules-queue">
          <li
            v-for="(card, index) in state.queue"
            :key="card.envelopeId"
            class="rules-editor__item"
            data-queue-item
            :data-envelope-id="card.envelopeId"
          >
            <FundingRuleCard
              :card="card"
              :position="index + 1"
              :income-label="labelFor(card.envelopeId)"
              :errors="cardErrors[card.envelopeId] ?? {}"
              :can-move-up="index > 0"
              :can-move-down="index < state.queue.length - 1"
              :dragging="sortable.draggingIndex.value === index"
              @type="onType(card.envelopeId, $event)"
              @fixed="onFixed(card.envelopeId, $event)"
              @percent="onPercent(card.envelopeId, $event)"
              @up="moveBy(index, -1)"
              @down="moveBy(index, 1)"
              @grab="sortable.startDrag($event, index)"
            />
            <ArrowDown
              v-if="index < state.queue.length - 1"
              class="rules-editor__arrow"
              :size="20"
              aria-hidden="true"
            />
          </li>
        </ol>
        <p class="rules-editor__live" role="status" aria-live="polite" data-testid="rules-announce">
          {{ announcement }}
        </p>
      </section>

      <section class="rules-editor__block" aria-labelledby="outside-title">
        <h2 id="outside-title" class="rules-editor__title">
          Вне очереди
          <UiInfoTooltip :text="OUTSIDE_HINT" label="Подсказка: вне очереди" />
        </h2>
        <ul class="rules-editor__outside" data-testid="rules-outside">
          <li v-for="card in state.outside" :key="card.envelopeId">
            <FundingRuleCard
              :card="card"
              :position="null"
              :income-label="labelFor(card.envelopeId)"
              :errors="cardErrors[card.envelopeId] ?? {}"
              :can-move-up="false"
              :can-move-down="false"
              :dragging="false"
              @type="onType(card.envelopeId, $event)"
              @fixed="onFixed(card.envelopeId, $event)"
              @percent="onPercent(card.envelopeId, $event)"
            />
          </li>
        </ul>
      </section>

      <div class="rules-editor__bar">
        <p v-if="formError" class="rules-editor__error" role="alert" data-testid="rules-error">
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ formError }}
        </p>
        <div class="rules-editor__actions">
          <UiButton
            variant="tertiary"
            :disabled="!dirty || saving"
            data-testid="rules-reset"
            @click="reset"
          >
            Отменить изменения
          </UiButton>
          <UiButton :loading="saving" :disabled="!dirty" data-testid="rules-save" @click="save">
            Сохранить
          </UiButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rules-editor {
  display: grid;
  gap: var(--hf-space-5);
  min-width: 0;
}

.rules-editor__block {
  display: grid;
  gap: var(--hf-space-3);
}

.rules-editor__title {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.rules-editor__switch {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-space-2);
  min-height: 44px;
}

.rules-editor__suggestion {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--hf-space-3);
}

.rules-editor__field {
  display: grid;
  gap: var(--hf-space-1);
  font-size: var(--hf-font-size-small);
}

.rules-editor__input {
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--hf-space-3);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
  font: inherit;
}

.rules-editor__input:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}

.rules-editor__input[aria-invalid='true'] {
  border-color: var(--hf-color-border-danger);
}

.rules-editor__queue,
.rules-editor__outside {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.rules-editor__item {
  display: grid;
  justify-items: center;
  gap: var(--hf-space-2);
}

.rules-editor__item > * {
  justify-self: stretch;
}

.rules-editor__arrow {
  justify-self: center !important;
  color: var(--hf-color-text-subtle);
}

.rules-editor__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.rules-editor__muted {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.rules-editor__error {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: var(--hf-font-size-small);
}

.rules-editor__bar {
  position: sticky;
  bottom: 0;
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-space-3) 0;
  border-top: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
}

.rules-editor__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--hf-space-2);
}
</style>
```

Если `BudgetDto` не содержит полей `incomeAllocation*` в типе — они есть (`useBudgetReferenceData.ts:16-18`). Если в токенах нет переменной, использованной выше, взять ближайшую из `apps/web/app/assets/**/tokens.css` (поиск `--hf-`).

- [ ] **Step 5: Тесты проходят**

Run: `pnpm --filter @harmofin/web test -- app/components/funding-rules`
Expected: PASS.

- [ ] **Step 6: Commit (после «да» владельца)**

```bash
git add apps/web/app/components/funding-rules
git commit -m "feat(web): редактор очереди и правил пополнения"
```

---

### Task 7: Web — маршрут `/app/envelopes/rules`

**Files:**
- Move: `apps/web/app/pages/app/envelopes.vue` → `apps/web/app/pages/app/envelopes/index.vue`
- Move: `apps/web/app/pages/app/envelopes.v2.test.ts` → `apps/web/app/pages/app/envelopes/index.v2.test.ts`
- Create: `apps/web/app/pages/app/envelopes/rules.vue`
- Create: `apps/web/app/pages/app/envelopes/rules.test.ts`

**Interfaces:**
- Consumes: `FundingRulesEditor` (Task 6), `useAuth`, `UiConfirmDialog`.
- Produces: страница `/app/envelopes/rules`.

- [ ] **Step 1: Перенести страницу конвертов**

```bash
mkdir -p apps/web/app/pages/app/envelopes
git mv apps/web/app/pages/app/envelopes.vue apps/web/app/pages/app/envelopes/index.vue
git mv apps/web/app/pages/app/envelopes.v2.test.ts apps/web/app/pages/app/envelopes/index.v2.test.ts
sed -i "s#'\.\./\.\./#'../../../#g" apps/web/app/pages/app/envelopes/index.vue apps/web/app/pages/app/envelopes/index.v2.test.ts
sed -i "s#from './envelopes.vue'#from './index.vue'#" apps/web/app/pages/app/envelopes/index.v2.test.ts
```

Run: `pnpm --filter @harmofin/web test -- app/pages/app/envelopes/index.v2.test.ts`
Expected: PASS (поведение не менялось).

- [ ] **Step 2: Падающий тест страницы правил**

```ts
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

enableAutoUnmount(afterEach);

const mocks = vi.hoisted(() => ({
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
  navigateTo: vi.fn(),
  leaveGuard: null as null | ((to: { fullPath: string }) => boolean | undefined),
}));

vi.mock('#imports', () => ({ definePageMeta: vi.fn(), navigateTo: mocks.navigateTo }));
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  onBeforeRouteLeave: (guard: (to: { fullPath: string }) => boolean | undefined) => {
    mocks.leaveGuard = guard;
  },
}));
vi.mock('../../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));

const EditorStub = defineComponent({
  name: 'FundingRulesEditor',
  props: { budgetId: { type: String, required: true } },
  emits: ['dirty'],
  setup(props, { emit }) {
    return () =>
      h('button', { 'data-testid': 'editor-stub', 'data-budget': props.budgetId, onClick: () => emit('dirty', true) });
  },
});

import RulesPage from './rules.vue';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.leaveGuard = null;
  mocks.auth.currentData.value = { workspaces: [{ budgets: [{ id: 'budget-1' }] }] };
});

async function mountPage() {
  const wrapper = mount(RulesPage, {
    attachTo: document.body,
    global: { stubs: { FundingRulesEditor: EditorStub, NuxtLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return wrapper;
}

describe('rules page', () => {
  it('передаёт бюджет редактору и ведёт назад к конвертам', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="editor-stub"]').attributes('data-budget')).toBe('budget-1');
    expect(wrapper.text()).toContain('Правила пополнения');
    expect(wrapper.text()).toContain('Назад к конвертам');
  });

  it('без изменений уход разрешён', async () => {
    await mountPage();
    expect(mocks.leaveGuard!({ fullPath: '/app' })).toBe(true);
  });

  it('с изменениями спрашивает подтверждение и уходит после него', async () => {
    const wrapper = await mountPage();
    await wrapper.find('[data-testid="editor-stub"]').trigger('click');
    expect(mocks.leaveGuard!({ fullPath: '/app' })).toBe(false);
    await flushPromises();
    expect(document.body.textContent).toContain('Есть несохранённые изменения');
    const confirm = document.querySelector<HTMLButtonElement>('[data-testid="leave-confirm"]');
    confirm?.click();
    await flushPromises();
    expect(mocks.navigateTo).toHaveBeenCalledWith('/app');
    expect(mocks.leaveGuard!({ fullPath: '/app' })).toBe(true);
  });

  it('beforeunload предупреждает только при изменениях', async () => {
    const wrapper = await mountPage();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await wrapper.find('[data-testid="editor-stub"]').trigger('click');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
```

`UiConfirmDialog` не принимает `data-testid` для кнопок; посмотреть в `apps/web/app/components/ui/ConfirmDialog.vue`, как помечена кнопка подтверждения (атрибут или ref), и найти её в тесте по нему (например, по тексту `'Уйти без сохранения'`), заменив `[data-testid="leave-confirm"]`.

- [ ] **Step 3: Убедиться, что падает**

Run: `pnpm --filter @harmofin/web test -- app/pages/app/envelopes/rules.test.ts`
Expected: FAIL — страницы нет.

- [ ] **Step 4: Страница**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ArrowLeft } from '@lucide/vue';
import { definePageMeta, navigateTo } from '#imports';

import FundingRulesEditor from '../../../components/funding-rules/FundingRulesEditor.vue';
import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiConfirmDialog from '../../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import { useAuth } from '../../../composables/useAuth.js';

defineOptions({ name: 'AppEnvelopeRulesPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { currentData, loadMe } = useAuth();
const hydrated = ref(false);
const loading = ref(true);
const loadError = ref('');
const dirty = ref(false);
const leaveOpen = ref(false);
let pendingPath: string | null = null;
let leaving = false;

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);

async function loadPage(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
  } catch {
    loadError.value = 'Не удалось загрузить правила. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

onBeforeRouteLeave((to) => {
  if (!dirty.value || leaving) return true;
  pendingPath = to.fullPath;
  leaveOpen.value = true;
  return false;
});

function confirmLeave(): void {
  leaving = true;
  leaveOpen.value = false;
  if (pendingPath) void navigateTo(pendingPath);
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onMounted(() => {
  hydrated.value = true;
  window.addEventListener('beforeunload', onBeforeUnload);
  void loadPage();
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload));
</script>

<template>
  <div v-if="hydrated" class="reference-page" data-hydrated="true">
    <ReferencePageLayout>
      <template #kicker>Конверты</template>
      <template #title>Правила пополнения</template>
      <template #description>
        Правила подсказывают, сколько предложить в конверт при распределении дохода. Они ничего не
        распределяют сами и не меняют остатки.
      </template>
      <template #actions>
        <UiButton variant="secondary" to="/app/envelopes" data-testid="rules-back">
          <ArrowLeft :size="16" aria-hidden="true" />
          Назад к конвертам
        </UiButton>
      </template>
      <template #content>
        <FundingRulesEditor v-if="budgetId" :budget-id="budgetId" @dirty="dirty = $event" />
        <UiEmptyState v-else-if="loadError" title="Правила недоступны" :description="loadError">
          <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
        </UiEmptyState>
        <UiEmptyState
          v-else-if="!loading"
          title="Бюджет не выбран"
          description="Выберите бюджет, чтобы настроить правила."
        />
      </template>
    </ReferencePageLayout>

    <UiConfirmDialog
      :open="leaveOpen"
      title="Уйти со страницы?"
      description="Есть несохранённые изменения. Уйти без сохранения?"
      confirm-label="Уйти без сохранения"
      cancel-label="Остаться"
      variant="danger"
      @confirm="confirmLeave"
      @cancel="leaveOpen = false"
    />
  </div>
</template>
```

- [ ] **Step 5: Тесты проходят**

Run: `pnpm --filter @harmofin/web test -- app/pages/app/envelopes`
Expected: PASS.

- [ ] **Step 6: Commit (после «да» владельца)**

```bash
git add apps/web/app/pages/app/envelopes apps/web/app/pages/app/envelopes.vue apps/web/app/pages/app/envelopes.v2.test.ts
git commit -m "feat(web): страница правил пополнения конвертов"
```

---

### Task 8: Web — диалог цели периода

**Files:**
- Create: `apps/web/app/components/envelopes/PeriodTargetDialog.vue`
- Create: `apps/web/app/components/envelopes/PeriodTargetDialog.test.ts`

**Interfaces:**
- Consumes: `useEnvelopePlanV2().updatePeriodTarget`, `UiModal`, `formatPlainDate`.
- Produces: `<PeriodTargetDialog :open :budget-id :envelope="EnvelopePlanDto | null" :period-start="string | null" @close @changed="(message: string) => …" />`.

Поведение переносится из блока «Текущая цель периода» `RuleSettingsSheet.vue` (строки 139–344 скрипта и 539–618 шаблона) без изменений: предупреждение о последствиях, поле с подсказкой, подтверждение, отмена, идемпотентный ключ, фокус, недоступность при `periodStart === null`. Отличие: блок — это весь диалог, поэтому кнопки «Изменить текущую цель» нет; диалог открывается сразу с полем.

- [ ] **Step 1: Перенести тесты цели**

Создать `PeriodTargetDialog.test.ts`: скопировать из `apps/web/app/components/funding/RuleSettingsSheet.test.ts` подготовку моков (`vi.hoisted`, `vi.mock` для `useEnvelopePlanV2`, хелперы `q`, `click`, `type`, фабрику конверта) и все тесты, где встречается `target-` (`grep -n "target-" RuleSettingsSheet.test.ts`: тесты «explains that the current target cannot be changed…», «…confirm…», «can cancel the target change…», блок `describe('focus of the target block')`, «target: same payload retried keeps the key…»). Заменить монтирование `RuleSettingsSheet` на

```ts
import PeriodTargetDialog from './PeriodTargetDialog.vue';

function mountDialog(periodStart: string | null = '2026-10-01') {
  return mount(PeriodTargetDialog, {
    props: { open: true, budgetId: BUDGET, envelope: envelope(), periodStart },
    attachTo: document.body,
  });
}
```

и убрать шаги `await click('[data-testid="target-open"]')`: поле видно сразу. Ожидание фокуса «после отмены — на `target-open`» заменить на «отмена эмитит `close`»:

```ts
  it('отмена закрывает диалог без запроса', async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await click('[data-testid="target-cancel"]');
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(mocks.v2.updatePeriodTarget).not.toHaveBeenCalled();
  });
```

а «после подтверждения» — на `changed`:

```ts
    expect(wrapper.emitted('changed')?.[0]).toEqual(['Цель текущего периода изменена.']);
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @harmofin/web test -- app/components/envelopes/PeriodTargetDialog.test.ts`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Компонент**

```vue
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import { type EnvelopePlanDto, useEnvelopePlanV2 } from '../../composables/useEnvelopePlanV2.js';
import { ApiRequestError } from '../../composables/useApiClient.js';
import { v2ErrorMessage } from '../../composables/useV2Error.js';
import { formatPlainDate } from '../obligations/format-plain-date.js';

defineOptions({ name: 'PeriodTargetDialog' });

// Explicit, confirmed change of one concrete period's target. Never assigns or
// moves money. The server owns every rule and answers with field errors.

const props = defineProps<{
  open: boolean;
  budgetId: string;
  envelope: EnvelopePlanDto | null;
  /** Start date of the envelope's current period; null when the data does not give it. */
  periodStart: string | null;
}>();
const emit = defineEmits<{ close: []; changed: [message: string] }>();

const v2 = useEnvelopePlanV2();

const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const TARGET_TEXT = 'Укажите сумму от нуля, не более двух знаков после запятой.';

const value = ref('');
const fieldError = ref('');
const formError = ref('');
const pending = ref(false);
let attempt: { fingerprint: string; key: string } | null = null;

function attemptKey(payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (attempt?.fingerprint !== fingerprint) attempt = { fingerprint, key: crypto.randomUUID() };
  return attempt.key;
}

function focusInput(): void {
  void nextTick(() => document.querySelector<HTMLElement>('[data-testid="target-input"]')?.focus());
}

watch(
  () => [props.open, props.envelope?.id] as const,
  ([open]) => {
    if (!open) return;
    value.value = '';
    fieldError.value = '';
    formError.value = '';
    attempt = null;
    if (props.periodStart !== null) focusInput();
  },
  { immediate: true },
);

async function confirm(): Promise<void> {
  const envelope = props.envelope;
  const periodStart = props.periodStart;
  if (pending.value || !envelope || periodStart === null) return;
  const text = value.value.trim();
  fieldError.value = '';
  formError.value = '';
  if (!AMOUNT_PATTERN.test(text)) {
    fieldError.value = TARGET_TEXT;
    focusInput();
    return;
  }
  const body = { target: text.replace(',', '.') };
  pending.value = true;
  try {
    await v2.updatePeriodTarget(
      props.budgetId,
      envelope.id,
      periodStart,
      body,
      attemptKey({ periodStart, body }),
    );
    attempt = null;
    emit('changed', 'Цель текущего периода изменена.');
  } catch (error) {
    if (error instanceof ApiRequestError && (error.problem.fieldErrors ?? []).length > 0) {
      fieldError.value = TARGET_TEXT;
      focusInput();
    } else {
      formError.value = v2ErrorMessage(
        error,
        'Не удалось изменить цель. Повторите попытку: дубль не создастся.',
      );
    }
  } finally {
    pending.value = false;
  }
}

function requestClose(): void {
  if (!pending.value) emit('close');
}
</script>

<template>
  <UiModal :open="open" title="Цель текущего периода" size="sm" @close="requestClose">
    <div v-if="envelope" class="target-dialog">
      <p class="target-dialog__muted target-dialog__name">{{ envelope.name }}</p>
      <p v-if="periodStart === null" class="target-dialog__muted" data-testid="target-unavailable">
        Текущая цель периода недоступна для изменения здесь: период этого конверта не определён.
        Новое правило начнёт действовать со следующего периода.
      </p>
      <template v-else>
        <p class="target-dialog__warning" role="note" data-testid="target-consequence">
          <AlertTriangle :size="16" aria-hidden="true" />
          Внимание: подтверждённая цель периода с {{ formatPlainDate(periodStart) }} изменится на
          указанную сумму. Распределения и остаток конверта не изменятся.
        </p>
        <label class="target-dialog__field">
          <span>Новая цель периода, ₽</span>
          <input
            v-model="value"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            class="target-dialog__input"
            data-testid="target-input"
            :aria-invalid="fieldError ? 'true' : undefined"
            :aria-describedby="fieldError ? 'target-input-error target-input-hint' : 'target-input-hint'"
          />
        </label>
        <p id="target-input-hint" class="target-dialog__muted">
          Сумма от нуля, не более двух знаков после запятой.
        </p>
        <p v-if="fieldError" id="target-input-error" class="target-dialog__error" data-testid="target-error">
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ fieldError }}
        </p>
        <p v-if="formError" class="target-dialog__error" role="alert" data-testid="target-form-error">
          <AlertTriangle :size="14" aria-hidden="true" />
          {{ formError }}
        </p>
      </template>
    </div>

    <template #footer>
      <UiButton
        v-if="periodStart !== null"
        :loading="pending"
        data-testid="target-confirm"
        @click="confirm"
      >
        Подтвердить изменение цели
      </UiButton>
      <UiButton variant="tertiary" :disabled="pending" data-testid="target-cancel" @click="requestClose">
        Отмена
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
/* ← перенести из RuleSettingsSheet.vue правила .rule-sheet, __muted, __name, __field, __input
   (+ :focus-visible, [aria-invalid]), __error, __warning, переименовав префикс в .target-dialog */
</style>
```

Стили переносятся буквально с заменой префикса `rule-sheet` → `target-dialog`; `.rule-sheet` → `.target-dialog` (grid, gap `var(--hf-space-3)`).

- [ ] **Step 4: Тесты проходят**

Run: `pnpm --filter @harmofin/web test -- app/components/envelopes/PeriodTargetDialog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (после «да» владельца)**

```bash
git add apps/web/app/components/envelopes/PeriodTargetDialog.vue apps/web/app/components/envelopes/PeriodTargetDialog.test.ts
git commit -m "feat(web): диалог изменения цели текущего периода"
```

---

### Task 9: Web — встроить в страницу конвертов и убрать старое окно

**Files:**
- Modify: `apps/web/app/components/envelopes/EnvelopesPlanView.vue`
- Modify: `apps/web/app/components/envelopes/EnvelopePlanDialog.vue`
- Create: `apps/web/app/components/envelopes/EnvelopesPlanView.target.test.ts`
- Modify: `apps/web/app/pages/app/envelopes/index.v2.test.ts`
- Delete: `apps/web/app/components/funding/RuleSettingsSheet.vue`, `apps/web/app/components/funding/RuleSettingsSheet.test.ts`, `apps/web/app/components/envelopes/EnvelopesPlanView.rules.test.ts`

**Interfaces:**
- Consumes: `listFundingRules`, `describeRule` (Task 3), `PeriodTargetDialog` (Task 8), маршрут `/app/envelopes/rules` (Task 7).
- Produces: `EnvelopePlanDialog` — новый prop `ruleSummary: string | null` и событие `target` вместо `rules`.

- [ ] **Step 1: Падающий тест**

Создать `EnvelopesPlanView.target.test.ts`. Скопировать из `EnvelopesPlanView.rules.test.ts` моки (`vi.hoisted` с `listEnvelopes`, `getDashboard`, `getEnvelopeHistory`; моки `useOperationReferenceData`, `useToast`), фабрики `envelope(...)`, `dashboard(...)` и функцию монтирования, заменив `SheetStub` на заглушку `PeriodTargetDialog` с теми же атрибутами (`data-testid="target-stub"`, `data-envelope`, `data-period`, кнопка `stub-changed` эмитит `changed` с `'Цель текущего периода изменена.'`), и добавить в `mocks.v2` `listFundingRules: vi.fn()`. Тесты:

```ts
describe('EnvelopesPlanView: правила и цель периода', () => {
  it('рядом с «Создать конверт» есть ссылка «Задать правила», в меню строки нет «Правило пополнения»', async () => {
    const wrapper = await mountView();
    const link = wrapper.find('[data-action="envelope-rules"]');
    expect(link.text()).toBe('Задать правила');
    expect(link.attributes('href') ?? link.attributes('to')).toBe('/app/envelopes/rules');
    expect(wrapper.find('[data-testid="row-rules"]').exists()).toBe(false);
  });

  it('диалог конверта показывает правило и номер в очереди', async () => {
    mocks.v2.listFundingRules.mockResolvedValue({
      items: [
        { id: 'r1', envelopeId: 'env-b', type: 'SUM_OF_PLANS', priority: 10, fixedAmountMinor: null, percentBasisPoints: null },
        { id: 'r2', envelopeId: 'env-a', type: 'PERCENT_OF_INCOME', priority: 20, fixedAmountMinor: null, percentBasisPoints: 1000 },
      ],
    });
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    expect(document.body.textContent).toContain('Процент от дохода, 10 % · №2 в очереди');
  });

  it('если правила не загрузились, страница работает без строки правила', async () => {
    mocks.v2.listFundingRules.mockRejectedValue(new Error('boom'));
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    expect(document.querySelector('[data-testid="plan-dialog-rule"]')).toBeNull();
  });

  it('«Изменить цель периода» открывает диалог цели с периодом из дашборда', async () => {
    mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', 'p1', [['env-a', 'p1']]));
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    (document.querySelector('[data-testid="plan-dialog-target"]') as HTMLButtonElement).click();
    await flushPromises();
    const stub = wrapper.find('[data-testid="target-stub"]');
    expect(stub.attributes('data-envelope')).toBe('env-a');
    expect(stub.attributes('data-period')).toBe('2026-10-01');
  });

  it('период чужого конверта не передаётся', async () => {
    mocks.v2.getDashboard.mockResolvedValue(dashboard('2026-10-01', 'p1', [['env-b', 'p1']]));
    const wrapper = await mountView();
    await openDetails(wrapper, 'env-a');
    (document.querySelector('[data-testid="plan-dialog-target"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(wrapper.find('[data-testid="target-stub"]').attributes('data-period')).toBe('null');
  });
});
```

`mountView` и `openDetails` взять из `EnvelopesPlanView.rules.test.ts` (там есть монтирование и открытие деталей через клик по строке; `EnvelopePlanDialog` в этих тестах НЕ заглушать). Если в исходном тесте детали открываются иначе — повторить его способ.

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @harmofin/web test -- app/components/envelopes/EnvelopesPlanView.target.test.ts`
Expected: FAIL — нет ссылки `envelope-rules`, нет `plan-dialog-target`.

- [ ] **Step 3: `EnvelopePlanDialog.vue`**

- В `defineProps` добавить `ruleSummary?: string | null` (`withDefaults` не нужен: `undefined` трактуется как «нет данных»).
- В `defineEmits` заменить `rules: [envelope: EnvelopePlanDto]` на `target: [envelope: EnvelopePlanDto]`.
- В `<dl class="plan-dialog__rows">` после строки «Половина периода»:

```vue
        <div v-if="ruleSummary" data-testid="plan-dialog-rule">
          <dt>Правило пополнения</dt>
          <dd>{{ ruleSummary }}</dd>
        </div>
```

- В футере заменить кнопку `plan-dialog-rules` на:

```vue
      <UiButton
        v-if="!envelope.archivedAt"
        variant="secondary"
        data-testid="plan-dialog-target"
        @click="emit('target', envelope)"
      >
        Изменить цель периода
      </UiButton>
```

- [ ] **Step 4: `EnvelopesPlanView.vue`**

- Удалить импорт `RuleSettingsSheet`, импортировать `PeriodTargetDialog from './PeriodTargetDialog.vue'`, `describeRule from '../funding-rules/funding-rule-text.js'` и тип `FundingRuleResponse`.
- Состояние и загрузка правил (после `const envelopes = ref…`):

```ts
// Saved funding rules, for the read-only summary in the details dialog. A failed
// read only hides that line; the page keeps working.
const rules = ref<FundingRuleResponse[] | null>(null);
const detailedRule = computed(() =>
  detailed.value ? describeRule(detailed.value.id, rules.value) : null,
);
```

в `load()` после `envelopes.value = response.items;`:

```ts
    try {
      rules.value = (await planV2.listFundingRules(props.budgetId)).items;
    } catch {
      rules.value = null;
    }
```

- Блок «Funding rule panel» переименовать в «Period target dialog»: `ruleEnvelope` → `targetEnvelope`, `rulePeriodStart` → `targetPeriodStart`, `ruleSeq` → `targetSeq`, `startRules` → `startTarget`, `closeRules` → `closeTarget`, `onRuleChanged` → `onTargetChanged`; логика определения периода по дашборду не меняется. Комментарий над блоком:

```ts
// Period target dialog. The envelope DTO does not carry the current period, so
// it is taken from the dashboard only when it demonstrably belongs to this
// envelope (an assignment of the envelope in that period).
```

- В `#actions` перед «Создать конверт»:

```vue
      <UiButton variant="secondary" to="/app/envelopes/rules" data-action="envelope-rules">
        Задать правила
      </UiButton>
```

- Удалить пункт меню строки с `data-testid="row-rules"`.
- `EnvelopePlanDialog`: заменить `@rules="startRules"` на `@target="startTarget"`, добавить `:rule-summary="detailedRule"`.
- Заменить `<RuleSettingsSheet …/>` на:

```vue
  <PeriodTargetDialog
    :open="targetEnvelope !== null"
    :budget-id="budgetId"
    :envelope="targetEnvelope"
    :period-start="targetPeriodStart"
    @close="closeTarget"
    @changed="onTargetChanged"
  />
```

`onTargetChanged` дополнительно закрывает диалог: после `statusMessage.value = message;` вызвать `closeTarget();` перед `await load();`.

- [ ] **Step 5: Удалить старое окно и обновить тест страницы**

```bash
git rm apps/web/app/components/funding/RuleSettingsSheet.vue apps/web/app/components/funding/RuleSettingsSheet.test.ts apps/web/app/components/envelopes/EnvelopesPlanView.rules.test.ts
grep -rn "RuleSettingsSheet\|startRules\|row-rules\|plan-dialog-rules" apps/web/app
```

Expected: `grep` ничего не находит.

В `apps/web/app/pages/app/envelopes/index.v2.test.ts` добавить в `mocks.v2` `listFundingRules: vi.fn().mockResolvedValue({ items: [] })` (и в `beforeEach`, если там сбрасываются моки через `mockReset`, вернуть это значение).

- [ ] **Step 6: Тесты, типы, линт**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS весь набор web.
Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: без ошибок.

- [ ] **Step 7: Commit (после «да» владельца)**

```bash
git add -A apps/web/app/components/envelopes apps/web/app/components/funding apps/web/app/pages/app/envelopes
git commit -m "feat(web): правило в деталях конверта, цель периода отдельным диалогом"
```

---

### Task 10: E2E-сценарий (выполняется в CI)

**Files:**
- Create: `e2e/envelope-v2-funding-rules.spec.ts`

**Interfaces:**
- Consumes: тестовые идентификаторы Task 6 и 9, `apiMutate`, API Task 1–2.

- [ ] **Step 1: Написать сценарий**

```ts
import { expect, test, type Page } from '@playwright/test';
import { apiMutate } from './api-mutate';
import { apiOrigin, apiV1 } from './env';

// Funding rules page: the queue is reordered with the buttons, one rule type is
// changed, everything is saved with one button; the API returns the new order
// and the envelope details show the rule and its queue number. Setup goes
// through the API and is marked "SETUP". Amounts are synthetic.

const password = 'e2e-password-10';
const API_V2 = `${apiOrigin}/api/v2`;

interface MeResponse {
  workspaces: Array<{ budgets: Array<{ id: string; planModelVersion: number }> }>;
}
interface EnvelopeList {
  items: Array<{ id: string; name: string; envelopeType: string }>;
}
interface RuleList {
  items: Array<{ envelopeId: string; type: string; priority: number; fixedAmountMinor: string | null }>;
}

test('funding rules page: reorder, change a rule and save once', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  await registerAndReachApp(page);
  const budgetId = await budgetIdOf(page);
  const base = `${API_V2}/budgets/${budgetId}`;

  // SETUP (API): template envelopes, then a known queue of two envelopes.
  const preview = await getJson<{ previewHash: string }>(page, `${base}/reference-template/preview`);
  await apiMutate(page, `${base}/reference-template/apply`, {
    previewHash: preview.previewHash,
    periods: [
      { role: 'FIRST', action: 'CREATE' },
      { role: 'SECOND', action: 'CREATE' },
    ],
    mandatory: { action: 'CREATE' },
    savings: [],
  });
  const envelopes = (await getJson<EnvelopeList>(page, `${base}/envelopes`)).items;
  const candidates = envelopes.filter((item) => item.envelopeType !== 'MANDATORY_EXPENSES');
  expect(candidates.length).toBeGreaterThanOrEqual(2);
  const [first, second] = candidates as [EnvelopeList['items'][0], EnvelopeList['items'][0]];
  await apiMutate(
    page,
    `${base}/funding-rules`,
    {
      queue: [
        { envelopeId: first.id, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1000 },
        { envelopeId: second.id, type: 'PERCENT_OF_INCOME', percentBasisPoints: 2000 },
      ],
      outside: envelopes
        .filter((item) => item.id !== first.id && item.id !== second.id)
        .map((item) => ({ envelopeId: item.id, type: 'MANUAL' })),
      incomeSuggestion: { enabled: false, sourceCategoryId: null, targetEnvelopeId: null },
    },
    'PUT',
  );

  // 1. From the envelopes page to the rules page.
  await page.goto('/app/envelopes');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('link', { name: 'Задать правила' }).click();
  await expect(page).toHaveURL(/\/app\/envelopes\/rules$/);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  const queue = page.getByTestId('rules-queue');
  await expect(queue.locator('[data-queue-item]')).toHaveCount(2);

  // 2. Move the first envelope down and give it a fixed amount.
  await page.getByTestId(`rule-down-${first.id}`).click();
  await expect(page.getByTestId('rules-announce')).toContainText('позиция 2 из 2');
  await page.getByTestId(`rule-type-${first.id}`).selectOption('FIXED_PER_PERIOD');
  await page.getByTestId(`rule-fixed-${first.id}`).fill('15000');
  await page.getByTestId('rules-save').click();
  await expect(page.getByText('Правила сохранены')).toBeVisible();
  await expect(page.getByTestId('rules-save')).toBeDisabled();

  // 3. The API returns the new order and rule.
  const rules = (await getJson<RuleList>(page, `${base}/funding-rules`)).items.filter(
    (item) => item.type !== 'MANUAL',
  );
  expect(rules.map((item) => item.envelopeId)).toEqual([second.id, first.id]);
  expect(rules[1]).toMatchObject({ type: 'FIXED_PER_PERIOD', fixedAmountMinor: '1500000' });

  // 4. The envelope details show the rule and its queue number.
  await page.getByTestId('rules-back').click();
  await expect(page).toHaveURL(/\/app\/envelopes$/);
  await page.getByTestId(`envelope-row-${first.id}`).click();
  await expect(page.getByTestId('plan-dialog-rule')).toContainText('№2 в очереди');
});

// ← getJson, budgetIdOf, registerAndReachApp скопировать без изменений из
//   e2e/envelope-v2-plans.spec.ts (строки 320–352), поменяв префикс email на `v2-rules-`.
```

Если у `UiButton` с `to` роль не `link` — заменить шаг 1 на `page.locator('[data-action="envelope-rules"]').click()`.

- [ ] **Step 2: Проверка без запуска браузера**

Run: `pnpm exec tsc --noEmit -p e2e/tsconfig.json` (если такого tsconfig нет — `pnpm lint` в корне покрывает `e2e/`; проверить `ls e2e/tsconfig.json`).
Expected: без ошибок. Сам сценарий запускается в CI; локально Playwright не запускать.

- [ ] **Step 3: Commit (после «да» владельца)**

```bash
git add e2e/envelope-v2-funding-rules.spec.ts
git commit -m "test(e2e): сценарий страницы правил пополнения"
```

---

### Task 11: Финальная проверка и ревью

- [ ] **Step 1: Полный прогон**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`
Expected: всё зелёное.
Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-rules-batch.integration.test.ts test/v2-funding-rules.integration.test.ts test/v2-funding-preview.integration.test.ts test/v2-openapi.integration.test.ts`
Expected: PASS.
Run: `node scripts/openapi/generate.mjs openapi.check.json && diff -q openapi.json openapi.check.json; rm openapi.check.json`
Expected: файлы совпадают (OpenAPI в репозитории актуален).

- [ ] **Step 2: Проверить итоговый diff**

Run: `git diff main --stat` и `git diff main -- apps/api/src`
Expected: нет изменений вне файлов из раздела «Файлы»; `identity/logo_description.png` не тронут; одиночные эндпоинты не изменили ответы.

- [ ] **Step 3: Ревью**

Read-only ревью по маршрутам репозитория: financial (пакетная мутация правил и её влияние на preview), security (новые GET/PUT, роли, изоляция бюджета, CSRF), API (контракт, OpenAPI, ошибки с путями), UI/UX (Calm Fintech, доступность: клавиатура, фокус, `aria-live`, 44px, светлая/тёмная тема), QA и финальное. `BLOCK` исправляет исполнитель, затем повторяются затронутые проверки и ревью.

- [ ] **Step 4: Отчёт владельцу**

Кратко: что сделано, результаты проверок с выводом, что выполнит только CI (E2E), ветка `feat/funding-rules-page`, коммиты — только с разрешения владельца, push/PR — только по его запросу.
