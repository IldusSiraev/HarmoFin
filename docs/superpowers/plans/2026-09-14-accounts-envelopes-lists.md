# Accounts and Envelopes Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести счета и конверты на компактные списки строк с панелью детали и серверными итогами, дать главной блок «Последние операции» и завести в ките `UiProgress`.

**Architecture:** Сервер получает два read-эндпоинта сводки (`accounts/summary`, `envelopes/summary`), каждый считает итог как сумму тех же балансов, что уходят в строки, в одной транзакции. Фронтенд получает тонкие строки `AccountRow` и `EnvelopeRow` поверх готового `UiListRow`, панели `AccountDrawer` и `EnvelopeDrawer` поверх `UiDrawer`, модуль группировки конвертов по типу и блок `RecentOperations` на главной поверх `OperationRow`. Формы создания и редактирования переезжают из тела страниц в `UiModal` без изменения полей.

**Tech Stack:** NestJS 11 + Fastify + Prisma 6 (API), Nuxt 4.5.2 / Vue 3.5.42 `<script setup lang="ts">` (web), TypeScript strict, Vitest + happy-dom + @vue/test-utils, Playwright, `@lucide/vue` 1.45.0, CSS custom properties `--hf-*`, без CSS-фреймворка и без Pinia.

**Spec:** `docs/superpowers/specs/2026-09-14-accounts-envelopes-lists-design.md`

## Global Constraints

- Node.js 24.20.0, pnpm 11.24.0. Ветку ответвлять от `main` — предыдущий этап влит (PR #20, коммит `1c78f9f`).
- Команды web: `pnpm --filter @harmofin/web test`, `... lint`, `... typecheck`, `... build`.
- Команды API: `pnpm --filter @harmofin/api test`, `... lint`, `... typecheck`. Интеграционные: `pnpm infra:up` (Docker PostgreSQL), затем `pnpm test:integration` из корня — он сам прогоняет `pnpm db:migrate`.
- Общее: `pnpm format` после правок, `pnpm format:check` в гейте. Playwright только в CI, локально не запускать.
- Prettier: `semi: true`, `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`.
- ESLint: `@typescript-eslint/no-explicit-any: error`; `vue/multi-word-component-names: error` — имя каждого компонента из двух слов через `defineOptions({ name: '...' })`; `no-irregular-whitespace` активен.
- TypeScript strict, включая `noUncheckedIndexedAccess` и `exactOptionalPropertyTypes`: индексация массива даёт `T | undefined`; для необязательных пропов объявляй тип как `X | undefined`.
- В `.vue` локальные `.ts`-модули импортируются с расширением `.js` (`import { groupByType } from './group-by-type.js'`).
- Цвета, отступы, радиусы, тени, типографика — только токенами `--hf-*`. `apps/web/app/assets/styles/tokens.css` содержит тест-страж: каждый использованный `var(--hf-color-…)` должен быть там определён.
- Деньги: сервер отдаёт строки минорных единиц; фронтенд форматирует через `FinanceMoney` / `formatMinorUnits` и **не** складывает и не вычитает суммы. Доля для полосы прогресса — отношение двух серверных сумм, это не денежная величина.
- Только `CONFIRMED` влияет на расчёты; балансы считает сервер существующим `FinancialBalanceRepository`.
- Тексты интерфейса на русском; идентификаторы, имена файлов, коммиты — на английском.
- Под Vitest `#imports` резолвится в `apps/web/app/test/nuxt-imports.ts`, `#components` — в `apps/web/app/test/nuxt-components.ts`. Нужен новый автоимпорт в тестах — добавляй его туда. Исключение: тестам, которым нужно управлять `route.query`, разрешён локальный `vi.mock('#imports', …)`.
- В денежных ассертах неразрывные пробелы пишутся escape-последовательностями `\u00a0` / `\u202f`, никогда литеральным невидимым символом.
- Не перезаписывай существующие тестовые файлы целиком: у `accounts.vue`, `envelopes.vue`, `index.vue`, `AvailableBudgetCard`, `operations.vue` тесты уже есть — меняй точечно.
- OpenAPI: у каждой операции уникальный `operationId` (иначе падает `scripts/openapi/lint.mjs`), после изменения контроллеров выполнять `node scripts/openapi/generate.mjs openapi.json` и коммитить корневой `openapi.json`.
- **Порядок маршрутов в Nest важен:** `@Get('budgets/:budgetId/accounts/summary')` должен быть объявлен **выше** `@Get('budgets/:budgetId/accounts/:accountId')`, иначе `summary` уедет в параметр `accountId`. То же для конвертов.
- Возврата записи из архива на сервере нет (есть только `POST …/archive`). Никаких кнопок «Вернуть из архива» в этом этапе.

### Формы данных, на которые опирается план

```ts
// apps/web/app/composables/useBudgetReferenceData.ts — уже существуют
type ReferenceStatus = 'active' | 'archived' | 'all';
type EnvelopeType =
  | 'CURRENT_EXPENSES'
  | 'MANDATORY_EXPENSES'
  | 'SAVINGS_GOAL'
  | 'RESERVE'
  | 'FREE_MONEY'
  | 'CUSTOM';

interface AccountDto {
  id: string;
  budgetId: string;
  name: string;
  accountType: 'BANK_ACCOUNT' | 'BANK_CARD' | 'CASH';
  bankName: string | null;
  lastFourDigits: string | null;
  currency: 'RUB';
  scale: 2;
  startingBalanceMinor: string;
  currentBalanceMinor: string;
  accountingStartDate: string;
  comment: string | null;
  archivedAt: string | null;
}

interface EnvelopeDto {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  envelopeType: EnvelopeType;
  periodSlot: 'FIRST' | 'SECOND' | null;
  currency: 'RUB';
  scale: 2;
  startingBalanceMinor: string;
  currentBalanceMinor: string;
  monthlyPlannedAmountMinor: string | null;
  targetAmountMinor: string | null;
  targetDate: string | null;
  displayOrder: number;
  comment: string | null;
  archivedAt: string | null;
}
```

Новые типы, которые появятся в Task 5 и используются дальше:

```ts
interface ReferenceSummaryDto {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
}

interface EnvelopeSummaryDto extends ReferenceSummaryDto {
  byType: Array<{ envelopeType: EnvelopeType; totalMinor: string; count: number }>;
}
```

### Карта файлов

| Файл | Ответственность |
| --- | --- |
| `apps/api/src/accounts/account.schemas.ts` | схема query сводки счетов |
| `apps/api/src/accounts/account.application.service.ts` | подсчёт итога по счетам |
| `apps/api/src/accounts/account.dto.ts` | `AccountSummaryResponse` |
| `apps/api/src/accounts/account.controller.ts` | маршрут `GET …/accounts/summary` |
| `apps/api/src/envelopes/*` | то же для конвертов плюс разбивка по типам |
| `apps/api/test/reference-summary.integration.test.ts` | интеграционные тесты обеих сводок |
| `apps/web/app/components/ui/Progress.vue` | примитив полосы прогресса |
| `apps/web/app/components/accounts/AccountRow.vue` | строка счёта |
| `apps/web/app/components/accounts/AccountDrawer.vue` | панель детали счёта |
| `apps/web/app/components/envelopes/group-by-type.ts` | группировка конвертов и порядок групп |
| `apps/web/app/components/envelopes/EnvelopeRow.vue` | строка конверта с прогрессом цели |
| `apps/web/app/components/envelopes/EnvelopeDrawer.vue` | панель детали конверта |
| `apps/web/app/components/dashboard/RecentOperations.vue` | блок «Последние операции» |
| `apps/web/app/pages/app/accounts.vue` | оркестратор списка счетов |
| `apps/web/app/pages/app/envelopes.vue` | оркестратор списка конвертов |
| `apps/web/app/pages/app/index.vue` | главная: три блока на строках |
| `apps/web/app/pages/app/operations.vue` | открытие панели по `operationId` |

---

### Task 1: Сводка по счетам на сервере

**Files:**
- Modify: `apps/api/src/accounts/account.schemas.ts`
- Modify: `apps/api/src/accounts/account.application.service.ts`
- Modify: `apps/api/src/accounts/account.dto.ts`
- Modify: `apps/api/src/accounts/account.controller.ts`
- Modify: `apps/api/src/accounts/account.application.service.test.ts`
- Modify: `openapi.json`

**Interfaces:**
- Consumes: существующие `AccountRepository.findAccessibleWithRole`, `AccountRepository.list(userId, budgetId, status)` (возвращает записи с `currentBalanceMinor: bigint`, считая их в одной транзакции), `formatMinorUnits` из `../common/money/minor-units.js`, `resourceNotFound` из `../common/reference-data/reference-data.errors.js`.
- Produces: `AccountApplicationService.summary(userId: string, budgetId: string, status: ReferenceDataStatus): Promise<AccountSummaryView>`, где

```ts
export interface AccountSummaryView {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
}
```

и маршрут `GET /api/v1/budgets/:budgetId/accounts/summary?status=` с `operationId` `AccountController_summary`.

- [ ] **Step 1: Write the failing test**

Добавить в конец `describe('AccountApplicationService', …)` в `apps/api/src/accounts/account.application.service.test.ts` (перед закрывающей скобкой и вспомогательными функциями не важно — Vitest видит их благодаря hoisting функций-деклараций):

```ts
  it('sums the balances it hands to the list and counts the rows', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.list.mockResolvedValue([
      account({ currentBalanceMinor: 120050n }),
      account({ currentBalanceMinor: -20050n }),
    ]);

    await expect(service.summary(ownerId, budgetId, 'active')).resolves.toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '100000',
      count: 2,
    });
    expect(repository.list).toHaveBeenCalledWith(ownerId, budgetId, 'active');
  });

  it('reports zero for a budget without accounts', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.list.mockResolvedValue([]);

    await expect(service.summary(ownerId, budgetId, 'all')).resolves.toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '0',
      count: 0,
    });
  });

  it('hides the summary of a budget the user cannot reach', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(null);

    await expect(service.summary(ownerId, budgetId, 'active')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
    });
    expect(repository.list).not.toHaveBeenCalled();
  });
```

В том же файле расширить `repositoryDouble` и добавить фабрику `account`, если её там нет:

```ts
  function repositoryDouble() {
    return {
      findAccessibleWithRole: vi.fn(),
      create: vi.fn(),
      list: vi.fn(),
    };
  }

  function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
    return {
      id: '00000000-0000-4000-8000-000000000010',
      budgetId,
      name: 'Основной счёт',
      accountType: AccountType.BANK_ACCOUNT,
      bankName: null,
      lastFourDigits: null,
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: 0n,
      currentBalanceMinor: 0n,
      accountingStartDate: new Date('2026-09-01T00:00:00.000Z'),
      comment: null,
      archivedAt: null,
      ...overrides,
    } as AccountRecord;
  }
```

Перед правкой открой файл: `repositoryDouble`, `ownerBudget`, `createService` и, возможно, `account` там уже есть — тогда только допиши недостающие поля и `list: vi.fn()`, а фабрику не дублируй. Сверь поля `AccountRecord` в `apps/api/src/accounts/account.repository.ts` и используй фактические.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api test account.application.service`
Expected: FAIL — `service.summary is not a function`.

- [ ] **Step 3: Write the service method**

В `apps/api/src/accounts/account.application.service.ts` добавить тип и метод (метод — сразу после `list`, чтобы соседние чтения лежали рядом):

```ts
export interface AccountSummaryView {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
}
```

```ts
  // The total is the sum of the very balances the list hands out, computed by
  // the same repository call inside one transaction: a second SQL formula would
  // drift away from the rows and nobody would notice.
  async summary(
    userId: string,
    budgetId: string,
    status: ReferenceDataStatus,
  ): Promise<AccountSummaryView> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const accounts = await this.repository.list(userId, budgetId, status);
    const totalMinor = accounts.reduce((sum, account) => sum + account.currentBalanceMinor, 0n);
    return {
      currency: 'RUB',
      scale: 2,
      totalMinor: formatMinorUnits(totalMinor),
      count: accounts.length,
    };
  }
```

Сверь сигнатуру `formatMinorUnits` в `apps/api/src/common/money/minor-units.js`: если она принимает больше одного аргумента, передай фактические (в `dashboard.application.service.ts` она вызывается как `formatMinorUnits(values.totalAccountMoneyMinor)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/api test account.application.service`
Expected: PASS.

- [ ] **Step 5: Add the response DTO**

В `apps/api/src/accounts/account.dto.ts`:

```ts
export class AccountSummaryResponse {
  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  totalMinor!: string;

  @ApiProperty({ type: Number })
  count!: number;
}
```

- [ ] **Step 6: Add the query schema**

В `apps/api/src/accounts/account.schemas.ts` рядом с `listAccountsSchema`:

```ts
export const accountSummarySchema = z
  .object({ status: z.enum(['active', 'archived', 'all']).default('active') })
  .strict();
```

и в конец файла:

```ts
export type AccountSummaryInput = z.output<typeof accountSummarySchema>;
```

- [ ] **Step 7: Add the route above the :accountId route**

В `apps/api/src/accounts/account.controller.ts` вставить **между** маршрутом списка и маршрутом `@Get('budgets/:budgetId/accounts/:accountId')`:

```ts
  @Get('budgets/:budgetId/accounts/summary')
  @ApiOkResponse({ type: AccountSummaryResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  summary(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(accountSummarySchema)) query: AccountSummaryInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.summary(contextOf(request).userId, budgetId, query.status);
  }
```

Дополнить импорты файла: `AccountSummaryResponse` из `./account.dto.js`, `accountSummarySchema` и тип `AccountSummaryInput` из `./account.schemas.js`.

- [ ] **Step 8: Regenerate the contract**

```bash
node scripts/openapi/generate.mjs openapi.json
node --test scripts/openapi/*.test.mjs
```

Expected: `openapi.json` содержит путь `/api/v1/budgets/{budgetId}/accounts/summary`, тесты контракта зелёные.

Проверь глазами, что у новой операции есть `operationId`; если Nest сгенерировал дубликат имени, задай его явно через `@ApiOperation({ operationId: 'AccountController_summary' })`.

- [ ] **Step 9: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/api lint
pnpm --filter @harmofin/api typecheck
pnpm --filter @harmofin/api test
git add apps/api/src/accounts openapi.json
git commit -m "feat(api): expose an accounts balance summary"
```

---

### Task 2: Сводка по конвертам с разбивкой по типам

**Files:**
- Modify: `apps/api/src/envelopes/envelope.schemas.ts`
- Modify: `apps/api/src/envelopes/envelope.application.service.ts`
- Modify: `apps/api/src/envelopes/envelope.dto.ts`
- Modify: `apps/api/src/envelopes/envelope.controller.ts`
- Modify: `apps/api/src/envelopes/envelope.application.service.test.ts`
- Modify: `openapi.json`

**Interfaces:**
- Consumes: `EnvelopeRepository.findAccessibleWithRole`, `EnvelopeRepository.list(userId, budgetId, status)`, `formatMinorUnits`, `resourceNotFound`.
- Produces: `EnvelopeApplicationService.summary(userId, budgetId, status): Promise<EnvelopeSummaryView>`, где

```ts
export interface EnvelopeSummaryView {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
  byType: Array<{ envelopeType: EnvelopeTypeValue; totalMinor: string; count: number }>;
}
```

и маршрут `GET /api/v1/budgets/:budgetId/envelopes/summary?status=`.

- [ ] **Step 1: Write the failing test**

Добавить в `apps/api/src/envelopes/envelope.application.service.test.ts`:

```ts
  it('groups envelope balances by type in domain order and skips empty types', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.list.mockResolvedValue([
      envelope({ envelopeType: 'SAVINGS_GOAL', currentBalanceMinor: 500000n }),
      envelope({ envelopeType: 'CURRENT_EXPENSES', currentBalanceMinor: 210000n }),
      envelope({ envelopeType: 'CURRENT_EXPENSES', currentBalanceMinor: 100000n }),
    ]);

    await expect(service.summary(ownerId, budgetId, 'active')).resolves.toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '810000',
      count: 3,
      byType: [
        { envelopeType: 'CURRENT_EXPENSES', totalMinor: '310000', count: 2 },
        { envelopeType: 'SAVINGS_GOAL', totalMinor: '500000', count: 1 },
      ],
    });
  });

  it('reports zero and an empty breakdown for a budget without envelopes', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.list.mockResolvedValue([]);

    await expect(service.summary(ownerId, budgetId, 'archived')).resolves.toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '0',
      count: 0,
      byType: [],
    });
  });

  it('hides the summary of a budget the user cannot reach', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(null);

    await expect(service.summary(ownerId, budgetId, 'active')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
    });
    expect(repository.list).not.toHaveBeenCalled();
  });
```

Открой файл и используй его существующие `repositoryDouble`, `ownerBudget`, `createService`; добавь `list: vi.fn()` в двойник и фабрику `envelope`, повторяющую поля `EnvelopeRecord` из `apps/api/src/envelopes/envelope.repository.ts` (`currentBalanceMinor` там `bigint`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/api test envelope.application.service`
Expected: FAIL — `service.summary is not a function`.

- [ ] **Step 3: Write the service method**

В `apps/api/src/envelopes/envelope.application.service.ts`:

```ts
// The order the UI shows groups in: the client must not invent it.
const ENVELOPE_TYPE_ORDER = [
  'CURRENT_EXPENSES',
  'MANDATORY_EXPENSES',
  'SAVINGS_GOAL',
  'RESERVE',
  'FREE_MONEY',
  'CUSTOM',
] as const;

export interface EnvelopeSummaryView {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
  byType: Array<{ envelopeType: (typeof ENVELOPE_TYPE_ORDER)[number]; totalMinor: string; count: number }>;
}
```

```ts
  async summary(
    userId: string,
    budgetId: string,
    status: ReferenceDataStatus,
  ): Promise<EnvelopeSummaryView> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const envelopes = await this.repository.list(userId, budgetId, status);

    const totals = new Map<string, { totalMinor: bigint; count: number }>();
    let totalMinor = 0n;
    for (const envelope of envelopes) {
      totalMinor += envelope.currentBalanceMinor;
      const current = totals.get(envelope.envelopeType) ?? { totalMinor: 0n, count: 0 };
      totals.set(envelope.envelopeType, {
        totalMinor: current.totalMinor + envelope.currentBalanceMinor,
        count: current.count + 1,
      });
    }

    return {
      currency: 'RUB',
      scale: 2,
      totalMinor: formatMinorUnits(totalMinor),
      count: envelopes.length,
      byType: ENVELOPE_TYPE_ORDER.flatMap((envelopeType) => {
        const group = totals.get(envelopeType);
        return group === undefined
          ? []
          : [{ envelopeType, totalMinor: formatMinorUnits(group.totalMinor), count: group.count }];
      }),
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/api test envelope.application.service`
Expected: PASS.

- [ ] **Step 5: Add the response DTO and query schema**

В `apps/api/src/envelopes/envelope.dto.ts`:

```ts
export class EnvelopeSummaryGroupResponse {
  @ApiProperty({
    enum: [
      'CURRENT_EXPENSES',
      'MANDATORY_EXPENSES',
      'SAVINGS_GOAL',
      'RESERVE',
      'FREE_MONEY',
      'CUSTOM',
    ],
  })
  envelopeType!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  totalMinor!: string;

  @ApiProperty({ type: Number })
  count!: number;
}

export class EnvelopeSummaryResponse {
  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  totalMinor!: string;

  @ApiProperty({ type: Number })
  count!: number;

  @ApiProperty({ type: [EnvelopeSummaryGroupResponse] })
  byType!: EnvelopeSummaryGroupResponse[];
}
```

В `apps/api/src/envelopes/envelope.schemas.ts`:

```ts
export const envelopeSummarySchema = z
  .object({ status: z.enum(['active', 'archived', 'all']).default('active') })
  .strict();
```

```ts
export type EnvelopeSummaryInput = z.output<typeof envelopeSummarySchema>;
```

- [ ] **Step 6: Add the route above the :envelopeId route**

В `apps/api/src/envelopes/envelope.controller.ts`, **выше** `@Get('budgets/:budgetId/envelopes/:envelopeId')`:

```ts
  @Get('budgets/:budgetId/envelopes/summary')
  @ApiOkResponse({ type: EnvelopeSummaryResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  summary(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(envelopeSummarySchema)) query: EnvelopeSummaryInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.summary(contextOf(request).userId, budgetId, query.status);
  }
```

- [ ] **Step 7: Regenerate the contract**

```bash
node scripts/openapi/generate.mjs openapi.json
node --test scripts/openapi/*.test.mjs
```

Expected: путь `/api/v1/budgets/{budgetId}/envelopes/summary` в документе, контрактные тесты зелёные.

- [ ] **Step 8: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/api lint
pnpm --filter @harmofin/api typecheck
pnpm --filter @harmofin/api test
git add apps/api/src/envelopes openapi.json
git commit -m "feat(api): expose an envelopes balance summary by type"
```

---

### Task 3: Интеграционные тесты обеих сводок

**Files:**
- Create: `apps/api/test/reference-summary.integration.test.ts`

**Interfaces:**
- Consumes: маршруты из Task 1 и Task 2, харнесс из `apps/api/test/dashboard-summary.integration.test.ts`.
- Produces: ничего для следующих задач.

- [ ] **Step 1: Write the integration test**

Создать `apps/api/test/reference-summary.integration.test.ts`. Регистрацию пользователя, создание бюджета и заголовки сессии скопируй из `apps/api/test/dashboard-summary.integration.test.ts` — общего харнесса в проекте нет, там такие же копии. Тело описания:

```ts
describe('reference summary API', () => {
  it('sums only the accounts the status asks for', async () => {
    const first = await createAccount(owner, { name: 'Карта', startingBalance: '1000.00' });
    await createAccount(owner, { name: 'Наличные', startingBalance: '500.00' });
    await archiveAccount(owner, first.id);

    const active = await request(owner, `/api/v1/budgets/${owner.budgetId}/accounts/summary`);
    expect(active.json()).toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '50000',
      count: 1,
    });

    const all = await request(
      owner,
      `/api/v1/budgets/${owner.budgetId}/accounts/summary?status=all`,
    );
    expect(all.json()).toMatchObject({ totalMinor: '150000', count: 2 });
  });

  it('breaks envelope balances down by type', async () => {
    await createEnvelope(owner, {
      name: 'Текущие',
      envelopeType: 'CURRENT_EXPENSES',
      startingBalance: '2100.00',
    });
    await createEnvelope(owner, {
      name: 'Отпуск',
      envelopeType: 'SAVINGS_GOAL',
      startingBalance: '5000.00',
    });

    const response = await request(owner, `/api/v1/budgets/${owner.budgetId}/envelopes/summary`);

    expect(response.json()).toMatchObject({
      totalMinor: '710000',
      count: 2,
      byType: [
        { envelopeType: 'CURRENT_EXPENSES', totalMinor: '210000', count: 1 },
        { envelopeType: 'SAVINGS_GOAL', totalMinor: '500000', count: 1 },
      ],
    });
  });

  it('does not reveal another budget totals', async () => {
    const accounts = await request(
      foreign,
      `/api/v1/budgets/${owner.budgetId}/accounts/summary`,
    );
    const envelopes = await request(
      foreign,
      `/api/v1/budgets/${owner.budgetId}/envelopes/summary`,
    );

    expect(accounts.statusCode).toBe(404);
    expect(envelopes.statusCode).toBe(404);
  });
});
```

Вспомогательные `request`, `createAccount`, `createEnvelope`, `archiveAccount` напиши по образцу того же файла-донора: `server.inject({ method, url, headers: { cookie: session.cookie, origin }, payload })`, для мутаций добавляется заголовок `x-csrf-token` — посмотри, как это сделано в доноре, и повтори.

Значения сумм в тесте исходят из того, что счёт и конверт без операций имеют баланс, равный начальному. Если в доноре начальный баланс задаётся другим полем — используй фактическое имя.

- [ ] **Step 2: Run the integration suite**

```bash
pnpm infra:up
pnpm test:integration
```

Expected: PASS, включая новый файл.

- [ ] **Step 3: Commit**

```bash
pnpm format
git add apps/api/test/reference-summary.integration.test.ts
git commit -m "test(api): cover the accounts and envelopes summaries end to end"
```

---

### Task 4: `UiProgress` и переезд `AvailableBudgetCard`

**Files:**
- Create: `apps/web/app/components/ui/Progress.vue`
- Create: `apps/web/app/components/ui/Progress.test.ts`
- Modify: `apps/web/app/components/dashboard/AvailableBudgetCard.vue`

**Interfaces:**
- Consumes: ничего.
- Produces: `UiProgress` с пропами `value: string`, `max: string` (минорные единицы) и `label: string`. Рендерит `role="progressbar"`, `aria-label`, `aria-valuetext` (обе равны `label`), `aria-valuenow` — целый процент 0…100, `aria-valuemin="0"`, `aria-valuemax="100"`.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/ui/Progress.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiProgress from './Progress.vue';

const mountProgress = (value: string, max: string) =>
  mount(UiProgress, { props: { value, max, label: 'Накоплено 1 000,00 ₽ из 5 000,00 ₽' } });

describe('UiProgress', () => {
  it('announces itself as a labelled progress bar', () => {
    const bar = mountProgress('100000', '500000').get('[role="progressbar"]');

    expect(bar.attributes('aria-valuenow')).toBe('20');
    expect(bar.attributes('aria-valuemin')).toBe('0');
    expect(bar.attributes('aria-valuemax')).toBe('100');
    expect(bar.attributes('aria-label')).toBe('Накоплено 1 000,00 ₽ из 5 000,00 ₽');
    expect(bar.attributes('aria-valuetext')).toBe('Накоплено 1 000,00 ₽ из 5 000,00 ₽');
  });

  it('never runs past the end or below zero', () => {
    expect(mountProgress('900000', '500000').get('[role="progressbar"]').attributes('aria-valuenow')).toBe(
      '100',
    );
    expect(mountProgress('-5000', '500000').get('[role="progressbar"]').attributes('aria-valuenow')).toBe(
      '0',
    );
  });

  it('shows an empty bar when there is nothing to divide by', () => {
    expect(mountProgress('100000', '0').get('[role="progressbar"]').attributes('aria-valuenow')).toBe(
      '0',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test Progress`
Expected: FAIL — `Failed to resolve import "./Progress.vue"`.

- [ ] **Step 3: Write the component**

`apps/web/app/components/ui/Progress.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'UiProgress' });

const props = defineProps<{ value: string; max: string; label: string }>();

// A share of two server-computed sums, not a money value of its own: the
// component never shows a derived amount.
const percent = computed(() => {
  let value = 0n;
  let max = 0n;
  try {
    value = BigInt(props.value);
    max = BigInt(props.max);
  } catch {
    return 0;
  }
  if (max <= 0n || value <= 0n) return 0;
  if (value >= max) return 100;
  return Number((value * 100n) / max);
});
</script>

<template>
  <div
    class="ui-progress"
    role="progressbar"
    :aria-label="label"
    :aria-valuetext="label"
    :aria-valuenow="percent"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div class="ui-progress__fill" :style="{ width: `${percent}%` }" />
  </div>
</template>

<style scoped>
.ui-progress {
  overflow: hidden;
  width: 100%;
  height: 0.5rem;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-surface-subtle);
}

.ui-progress__fill {
  height: 100%;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-brand);
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test Progress`
Expected: PASS, 3 теста.

- [ ] **Step 5: Move `AvailableBudgetCard` onto the primitive**

В `apps/web/app/components/dashboard/AvailableBudgetCard.vue` заменить самописную полосу:

```vue
      <div
        class="available-budget__track"
        role="progressbar"
        :aria-label="progressLabel"
        :aria-valuenow="spentPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="available-budget__fill" :style="{ width: `${spentPercent}%` }" />
      </div>
```

на

```vue
      <UiProgress
        :value="details.spentMinor"
        :max="details.limitMinor"
        :label="progressLabel"
      />
```

Добавить импорт `import UiProgress from '../ui/Progress.vue';`, удалить ставшие ненужными `spentPercent` и правила `.available-budget__track` / `.available-budget__fill` из `<style scoped>`. `progressLabel` остаётся как есть — его проверяет существующий тест карточки.

- [ ] **Step 6: Run the card tests**

Run: `pnpm --filter @harmofin/web test AvailableBudgetCard Progress`
Expected: PASS — существующие тесты карточки (включая `aria-valuenow` со значением `65`) зелёные без правок.

Если `aria-valuenow` разошёлся на единицу, причина в округлении: карточка считала `Math.round`, примитив усекает. Приведи тест карточки к фактическому значению и оставь усечение — «потрачено 65%» не должно превращаться в 66% раньше времени.

- [ ] **Step 7: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/ui/Progress.vue apps/web/app/components/ui/Progress.test.ts apps/web/app/components/dashboard/AvailableBudgetCard.vue apps/web/app/components/dashboard/AvailableBudgetCard.test.ts
git commit -m "feat(web): add a progress primitive and reuse it on the dashboard"
```

---

### Task 5: Клиент сводок

**Files:**
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.test.ts`

**Interfaces:**
- Consumes: существующие `withQuery`, `accountPath`, `envelopePath`, `api.request`.
- Produces:

```ts
export interface ReferenceSummaryDto {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
}

export interface EnvelopeSummaryDto extends ReferenceSummaryDto {
  byType: Array<{ envelopeType: EnvelopeType; totalMinor: string; count: number }>;
}

getAccountsSummary(budgetId: string, status?: ReferenceStatus): Promise<ReferenceSummaryDto>;
getEnvelopesSummary(budgetId: string, status?: ReferenceStatus): Promise<EnvelopeSummaryDto>;
```

- [ ] **Step 1: Write the failing test**

Добавить в `apps/web/app/composables/useBudgetReferenceData.test.ts` (файл уже мокает клиент — посмотри его шапку и повтори тот же способ):

```ts
  it('reads both reference summaries with the status the screen shows', async () => {
    request.mockResolvedValue({ currency: 'RUB', scale: 2, totalMinor: '150000', count: 2 });

    await api.getAccountsSummary('budget-id', 'archived');
    await api.getEnvelopesSummary('budget-id');

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/budgets/budget-id/accounts/summary?status=archived',
    );
    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/budgets/budget-id/envelopes/summary');
  });
```

Имена `request` и `api` возьми фактические из этого файла — там уже есть двойник клиента и созданный поверх него объект API.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test useBudgetReferenceData`
Expected: FAIL — `api.getAccountsSummary is not a function`.

- [ ] **Step 3: Add types and methods**

В `apps/web/app/composables/useBudgetReferenceData.ts` рядом с `AccountDto` добавить:

```ts
export interface ReferenceSummaryDto {
  currency: 'RUB';
  scale: 2;
  totalMinor: string;
  count: number;
}

export interface EnvelopeSummaryGroupDto {
  envelopeType: EnvelopeType;
  totalMinor: string;
  count: number;
}

export interface EnvelopeSummaryDto extends ReferenceSummaryDto {
  byType: EnvelopeSummaryGroupDto[];
}
```

В интерфейс `BudgetReferenceDataApi` добавить:

```ts
  getAccountsSummary(budgetId: string, status?: ReferenceStatus): Promise<ReferenceSummaryDto>;
  getEnvelopesSummary(budgetId: string, status?: ReferenceStatus): Promise<EnvelopeSummaryDto>;
```

В реализацию — рядом с `listAccounts` и `listEnvelopes`:

```ts
    getAccountsSummary: (budgetId, status) =>
      api.request<ReferenceSummaryDto>(
        withQuery(`${accountPath(budgetId)}/summary`, { status }),
      ),
```

```ts
    getEnvelopesSummary: (budgetId, status) =>
      api.request<EnvelopeSummaryDto>(
        withQuery(`${envelopePath(budgetId)}/summary`, { status }),
      ),
```

Сверь фактические сигнатуры `accountPath` / `envelopePath` / `withQuery` в этом файле и используй их как есть.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test useBudgetReferenceData`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/composables/useBudgetReferenceData.test.ts
git commit -m "feat(web): read the reference summaries from the API client"
```

---

### Task 6: `AccountRow`

**Files:**
- Create: `apps/web/app/components/accounts/AccountRow.vue`
- Create: `apps/web/app/components/accounts/AccountRow.test.ts`

**Interfaces:**
- Consumes: `UiListRow`, `UiStatus`, `FinanceMoney`, `AccountDto`.
- Produces: `AccountRow` с пропом `account: AccountDto`, эмитит `select: []`, слот `actions` пробрасывается в `UiListRow`.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/accounts/AccountRow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AccountRow from './AccountRow.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';

const account: AccountDto = {
  id: 'account-id',
  budgetId: 'budget-id',
  name: 'Основная карта',
  accountType: 'BANK_CARD',
  bankName: 'Банк',
  lastFourDigits: '1234',
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '1000000',
  currentBalanceMinor: '245000',
  accountingStartDate: '2026-09-01',
  comment: null,
  archivedAt: null,
};

const mountRow = (overrides: Partial<AccountDto> = {}) =>
  mount(AccountRow, { props: { account: { ...account, ...overrides } } });

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

describe('AccountRow', () => {
  it('leads with the name and says what kind of account it is', () => {
    const text = normalize(mountRow().text());

    expect(text).toContain('Основная карта');
    expect(text).toContain('Банковская карта');
    expect(text).toContain('Банк');
    expect(text).toContain('1234');
    expect(text).toContain('2 450,00 ₽');
  });

  it('marks a negative balance in words, not only in colour', () => {
    expect(mountRow().find('[data-testid="account-row-negative"]').exists()).toBe(false);

    const negative = mountRow({ currentBalanceMinor: '-1000' });

    expect(negative.get('[data-testid="account-row-negative"]').text()).toBe('Ниже нуля');
  });

  it('marks an archived account', () => {
    expect(
      mountRow({ archivedAt: '2026-09-10T00:00:00.000Z' })
        .get('[data-testid="account-row-archived"]')
        .text(),
    ).toBe('В архиве');
  });

  it('selects the account when the row is pressed', async () => {
    const wrapper = mountRow();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test AccountRow`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

`apps/web/app/components/accounts/AccountRow.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Banknote, CreditCard, Landmark } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiListRow from '../ui/ListRow.vue';
import UiStatus from '../ui/Status.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'AccountRow' });

const props = defineProps<{ account: AccountDto }>();

defineEmits<{ select: [] }>();

const TYPE_LABELS = {
  BANK_ACCOUNT: 'Банковский счёт',
  BANK_CARD: 'Банковская карта',
  CASH: 'Наличные',
} as const;

const TYPE_ICONS = {
  BANK_ACCOUNT: Landmark,
  BANK_CARD: CreditCard,
  CASH: Banknote,
} as const;

const icon = computed(() => TYPE_ICONS[props.account.accountType]);
const typeLabel = computed(() => TYPE_LABELS[props.account.accountType]);

const subtitle = computed(() =>
  [typeLabel.value, props.account.bankName, props.account.lastFourDigits]
    .filter((part): part is string => Boolean(part))
    .join(' · '),
);

// The sign comes from the server value; the client never computes the balance.
const isNegative = computed(() => props.account.currentBalanceMinor.startsWith('-'));

const rowLabel = computed(() => `Открыть счёт «${props.account.name}»`);
</script>

<template>
  <UiListRow :label="rowLabel" @select="$emit('select')">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="account-row__title">{{ account.name }}</span>
    <span class="account-row__subtitle">{{ subtitle }}</span>
    <span v-if="isNegative || account.archivedAt" class="account-row__meta">
      <UiStatus
        v-if="isNegative"
        data-testid="account-row-negative"
        label="Ниже нуля"
        tone="danger"
      />
      <UiStatus
        v-if="account.archivedAt"
        data-testid="account-row-archived"
        label="В архиве"
        tone="neutral"
      />
    </span>

    <template #trailing>
      <FinanceMoney
        class="account-row__amount"
        :minor-units="account.currentBalanceMinor"
        :currency="account.currency"
        :scale="account.scale"
      />
    </template>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiListRow>
</template>

<style scoped>
.account-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-row__subtitle {
  overflow: hidden;
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-1);
  align-items: center;
}

.account-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test AccountRow`
Expected: PASS, 4 теста.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/accounts/AccountRow.vue apps/web/app/components/accounts/AccountRow.test.ts
git commit -m "feat(web): render accounts as compact rows"
```

---

### Task 7: `AccountDrawer`

**Files:**
- Create: `apps/web/app/components/accounts/AccountDrawer.vue`
- Create: `apps/web/app/components/accounts/AccountDrawer.test.ts`

**Interfaces:**
- Consumes: `UiDrawer`, `UiButton`, `UiStatus`, `FinanceMoney`, `AccountDto`.
- Produces: `AccountDrawer` с пропом `account: AccountDto | null`; эмитит `close: []`, `edit: [account: AccountDto]`, `archive: [account: AccountDto]`. Ссылки на журнал и переводы рендерит сам через `UiButton` с пропом `to`.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/accounts/AccountDrawer.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AccountDrawer from './AccountDrawer.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';

const account: AccountDto = {
  id: 'account-id',
  budgetId: 'budget-id',
  name: 'Основная карта',
  accountType: 'BANK_CARD',
  bankName: 'Банк',
  lastFourDigits: '1234',
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '1000000',
  currentBalanceMinor: '245000',
  accountingStartDate: '2026-09-01',
  comment: 'Основная карта семьи',
  archivedAt: null,
};

const mountDrawer = (overrides: Partial<AccountDto> = {}) =>
  mount(AccountDrawer, {
    props: { account: { ...account, ...overrides } },
    attachTo: document.body,
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });

describe('AccountDrawer', () => {
  it('shows what the account is', () => {
    const wrapper = mountDrawer();
    const text = wrapper.text();

    expect(text).toContain('Банковская карта');
    expect(text).toContain('Банк');
    expect(text).toContain('1234');
    expect(text).toContain('2026-09-01');
    expect(text).toContain('Основная карта семьи');
    wrapper.unmount();
  });

  it('hands editing and archiving back to the page', async () => {
    const wrapper = mountDrawer();

    await wrapper.get('[data-testid="account-drawer-edit"]').trigger('click');
    await wrapper.get('[data-testid="account-drawer-archive"]').trigger('click');

    expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({ id: 'account-id' });
    expect(wrapper.emitted('archive')?.[0]?.[0]).toMatchObject({ id: 'account-id' });
    wrapper.unmount();
  });

  it('links to the journal and to a transfer from this account', () => {
    const wrapper = mountDrawer();

    expect(wrapper.get('[data-testid="account-drawer-operations"]').attributes('href')).toBe(
      '/app/operations?accountId=account-id',
    );
    expect(wrapper.get('[data-testid="account-drawer-transfer"]').attributes('href')).toBe(
      '/app/transfers?sourceAccountId=account-id',
    );
    wrapper.unmount();
  });

  it('offers no archiving for an account already in the archive', () => {
    const wrapper = mountDrawer({ archivedAt: '2026-09-10T00:00:00.000Z' });

    expect(wrapper.find('[data-testid="account-drawer-archive"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test AccountDrawer`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

`apps/web/app/components/accounts/AccountDrawer.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiStatus from '../ui/Status.vue';
import type { AccountDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'AccountDrawer' });

const props = defineProps<{ account: AccountDto | null }>();

const emit = defineEmits<{
  close: [];
  edit: [account: AccountDto];
  archive: [account: AccountDto];
}>();

const TYPE_LABELS = {
  BANK_ACCOUNT: 'Банковский счёт',
  BANK_CARD: 'Банковская карта',
  CASH: 'Наличные',
} as const;

const typeLabel = computed(() =>
  props.account ? TYPE_LABELS[props.account.accountType] : '',
);

const operationsLink = computed(() =>
  props.account ? `/app/operations?accountId=${encodeURIComponent(props.account.id)}` : '',
);

const transferLink = computed(() =>
  props.account ? `/app/transfers?sourceAccountId=${encodeURIComponent(props.account.id)}` : '',
);
</script>

<template>
  <UiDrawer :open="account !== null" title="Счёт" @close="emit('close')">
    <div v-if="account" class="account-drawer">
      <p class="account-drawer__amount">
        <FinanceMoney
          :minor-units="account.currentBalanceMinor"
          :currency="account.currency"
          :scale="account.scale"
        />
      </p>
      <UiStatus
        :label="account.archivedAt ? 'В архиве' : 'Активен'"
        :tone="account.archivedAt ? 'neutral' : 'success'"
      />

      <dl class="account-drawer__rows">
        <div>
          <dt>Название</dt>
          <dd>{{ account.name }}</dd>
        </div>
        <div>
          <dt>Тип</dt>
          <dd>{{ typeLabel }}</dd>
        </div>
        <div v-if="account.bankName">
          <dt>Банк</dt>
          <dd>{{ account.bankName }}</dd>
        </div>
        <div v-if="account.lastFourDigits">
          <dt>Последние цифры</dt>
          <dd>{{ account.lastFourDigits }}</dd>
        </div>
        <div>
          <dt>Начальный баланс</dt>
          <dd>
            <FinanceMoney
              :minor-units="account.startingBalanceMinor"
              :currency="account.currency"
              :scale="account.scale"
            />
          </dd>
        </div>
        <div>
          <dt>Дата начала учёта</dt>
          <dd>{{ account.accountingStartDate }}</dd>
        </div>
        <div v-if="account.comment">
          <dt>Комментарий</dt>
          <dd>{{ account.comment }}</dd>
        </div>
      </dl>
    </div>

    <template v-if="account" #footer>
      <UiButton data-testid="account-drawer-edit" @click="emit('edit', account)">
        Изменить
      </UiButton>
      <UiButton
        variant="secondary"
        data-testid="account-drawer-operations"
        :to="operationsLink"
      >
        Операции счёта
      </UiButton>
      <UiButton variant="secondary" data-testid="account-drawer-transfer" :to="transferLink">
        Перевести со счёта
      </UiButton>
      <UiButton
        v-if="!account.archivedAt"
        variant="tertiary"
        data-testid="account-drawer-archive"
        @click="emit('archive', account)"
      >
        Переместить в архив
      </UiButton>
    </template>
  </UiDrawer>
</template>

<style scoped>
.account-drawer {
  display: grid;
  gap: var(--hf-space-4);
}

.account-drawer__amount {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-h2);
}

.account-drawer__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.account-drawer__rows div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.account-drawer__rows dt {
  color: var(--hf-color-text-muted);
}

.account-drawer__rows dd {
  margin: 0;
  text-align: right;
}
</style>
```

`UiButton` с пропом `to` рендерит `NuxtLink` — поэтому тест подставляет стаб. Если у `UiButton` проп называется иначе, сверь `apps/web/app/components/ui/Button.vue` и используй фактический.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test AccountDrawer`
Expected: PASS, 4 теста.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/accounts/AccountDrawer.vue apps/web/app/components/accounts/AccountDrawer.test.ts
git commit -m "feat(web): show account details in a drawer"
```

---

### Task 8: Сборка страницы счетов

**Files:**
- Modify: `apps/web/app/pages/app/accounts.vue`
- Modify: `apps/web/app/pages/app/accounts.test.ts`
- Delete: `apps/web/app/components/accounts/AccountCard.vue`, `apps/web/app/components/accounts/AccountCard.test.ts`

**Interfaces:**
- Consumes: `AccountRow` (Task 6), `AccountDrawer` (Task 7), `getAccountsSummary` (Task 5), существующие `UiChip`, `UiActionMenu`, `UiModal`, `UiSkeleton`, `UiEmptyState`, `UiConfirmDialog`, `UiReferencePageLayout`, `useToast`, `useOperationReferenceData().invalidate()`.
- Produces: страницу-оркестратор; для следующих задач ничего не экспортирует.

Страница сохраняет за собой: загрузку списка и сводки, чип архива с записью в query, форму создания и редактирования (теперь в `UiModal`), подтверждение архивирования, состояния загрузки, пустоты и ошибки.

- [ ] **Step 1: Write the failing tests**

В `apps/web/app/pages/app/accounts.test.ts` добавить (существующие случаи не переписывать; в мок API добавить `getAccountsSummary: vi.fn()` и в `beforeEach` — `api.getAccountsSummary.mockResolvedValue({ currency: 'RUB', scale: 2, totalMinor: '150000', count: 2 })`):

```ts
  it('lists accounts as rows with the server total above them', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="list-row-select"]').length).toBeGreaterThan(0);
    expect(normalize(wrapper.get('[data-testid="accounts-total"]').text())).toContain('1 500,00 ₽');
    expect(api.getAccountsSummary).toHaveBeenCalledWith('budget-id', 'active');
  });

  it('opens the drawer from a row', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true);
  });

  it('switches both requests to the archive from the chip', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="chip-archived"]').trigger('click');
    await flushPromises();

    expect(api.listAccounts).toHaveBeenLastCalledWith('budget-id', 'archived');
    expect(api.getAccountsSummary).toHaveBeenLastCalledWith('budget-id', 'archived');
  });

  it('separates an empty archive from an empty budget', async () => {
    api.listAccounts.mockResolvedValue([]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Счетов пока нет');

    await wrapper.get('[data-testid="chip-archived"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('В архиве пусто');
  });
```

Вспомогательный `normalize` добавь в файл, если его там нет:

```ts
const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test accounts.test`
Expected: FAIL — строк, чипа, итога и панели на странице пока нет.

- [ ] **Step 3: Rebuild the page**

Ключевые фрагменты `<script setup>` (остальное — существующий код формы, архивирования и тостов, перенесённый без изменений):

```ts
import AccountDrawer from '../../components/accounts/AccountDrawer.vue';
import AccountRow from '../../components/accounts/AccountRow.vue';
import UiActionMenu from '../../components/ui/ActionMenu.vue';
import UiChip from '../../components/ui/Chip.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import FinanceMoney from '../../components/finance/FinanceMoney.vue';
import { navigateTo, useRoute } from '#imports';
import type { ReferenceSummaryDto, ReferenceStatus } from '../../composables/useBudgetReferenceData.js';

const route = useRoute();
const summary = ref<ReferenceSummaryDto | null>(null);
const detailed = ref<AccountDto | null>(null);
const formOpen = ref(false);

// The archive lives in the URL so the view survives a reload and can be shared.
const status = ref<ReferenceStatus>(route.query.status === 'archived' ? 'archived' : 'active');

async function toggleArchived(): Promise<void> {
  status.value = status.value === 'archived' ? 'active' : 'archived';
  await navigateTo(
    { path: route.path, query: status.value === 'archived' ? { status: 'archived' } : {} },
    { replace: true },
  );
  await loadPage();
}

async function loadAccounts(): Promise<void> {
  const id = budgetId.value;
  if (!id) return;
  useOperationReferenceData().invalidate();
  const [items, totals] = await Promise.all([
    api.listAccounts(id, status.value),
    api.getAccountsSummary(id, status.value),
  ]);
  accounts.value = items;
  summary.value = totals;
}
```

Существующий `loadAccounts` заменяется на приведённый: он грузит список и сводку параллельно и по-прежнему сбрасывает общий кеш справочников. Функции `startCreate`, `startEdit`, `cancelForm`, сохранение и архивирование остаются, но `startCreate` и `startEdit` дополнительно ставят `formOpen.value = true`, а `cancelForm` — `formOpen.value = false`.

Разметка списка:

```vue
<p v-if="summary" class="accounts-page__total" data-testid="accounts-total">
  Всего на счетах
  <FinanceMoney
    :minor-units="summary.totalMinor"
    :currency="summary.currency"
    :scale="summary.scale"
  />
</p>

<div class="accounts-page__filters">
  <UiChip
    label="В архиве"
    :active="status === 'archived'"
    data-testid="chip-archived"
    @click="toggleArchived"
  />
</div>

<div v-if="loading && accounts.length === 0" data-testid="accounts-loading" aria-busy="true">
  <UiSkeleton variant="row" :count="4" />
</div>

<UiEmptyState
  v-else-if="accounts.length === 0 && status === 'archived'"
  title="В архиве пусто"
  description="Архивные счета появятся здесь после архивирования."
/>

<UiEmptyState
  v-else-if="accounts.length === 0"
  title="Счетов пока нет"
  description="Создайте счёт, чтобы вести на нём операции."
>
  <template #action><UiButton @click="startCreate">Создать счёт</UiButton></template>
</UiEmptyState>

<ul v-else class="accounts-page__list" aria-label="Список счетов">
  <li v-for="account in accounts" :key="account.id">
    <AccountRow :account="account" @select="detailed = account">
      <template #actions>
        <UiActionMenu label="Действия над счётом">
          <button type="button" role="menuitem" data-testid="row-edit" @click="startEdit(account)">
            Изменить
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="row-operations"
            @click="openOperations(account)"
          >
            Операции счёта
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="row-transfer"
            @click="openTransfer(account)"
          >
            Перевести со счёта
          </button>
          <button
            v-if="!account.archivedAt"
            type="button"
            role="menuitem"
            data-testid="row-archive"
            @click="askArchive(account)"
          >
            Переместить в архив
          </button>
        </UiActionMenu>
      </template>
    </AccountRow>
  </li>
</ul>
```

Навигация из меню:

```ts
function openOperations(account: AccountDto): void {
  void navigateTo(`/app/operations?accountId=${encodeURIComponent(account.id)}`);
}

function openTransfer(account: AccountDto): void {
  void navigateTo(`/app/transfers?sourceAccountId=${encodeURIComponent(account.id)}`);
}
```

Панель и форма ниже списка:

```vue
<AccountDrawer
  :account="detailed"
  @close="detailed = null"
  @edit="startEdit"
  @archive="askArchive"
/>

<UiModal
  :open="formOpen"
  :title="editingId ? 'Изменить счёт' : 'Новый счёт'"
  @close="cancelForm"
>
  <!-- существующая форма целиком, без изменения полей и валидации -->
</UiModal>
```

`startEdit` дополнительно закрывает панель (`detailed.value = null`), иначе модалка откроется поверх открытой панели. `askArchive` — существующая функция, показывающая `UiConfirmDialog`; после успешного архивирования она уже вызывает перезагрузку, туда же добавь `detailed.value = null`.

Список рендерится `<ul>` с `<li>`, потому что `UiListRow` рассчитан на элемент списка; строке нужен `min-width: 0` у `li`, если появится горизонтальное переполнение на узком экране.

- [ ] **Step 4: Delete the card the page no longer mounts**

```bash
git rm apps/web/app/components/accounts/AccountCard.vue apps/web/app/components/accounts/AccountCard.test.ts
```

Перед удалением проверь, что других потребителей нет: `grep -rn "AccountCard" apps/web/app e2e`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS — включая дополненные случаи `accounts.test.ts`.

- [ ] **Step 6: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web build
git add apps/web/app/pages/app/accounts.vue apps/web/app/pages/app/accounts.test.ts apps/web/app/components/accounts
git commit -m "feat(web): rebuild the accounts screen around rows and a drawer"
```

---

### Task 9: Группировка конвертов по типу

**Files:**
- Create: `apps/web/app/components/envelopes/group-by-type.ts`
- Create: `apps/web/app/components/envelopes/group-by-type.test.ts`

**Interfaces:**
- Consumes: `EnvelopeDto`, `EnvelopeSummaryDto` (Task 5).
- Produces:

```ts
export interface EnvelopeGroup {
  envelopeType: EnvelopeType;
  label: string;
  totalMinor: string | null;
  items: EnvelopeDto[];
}

export function groupByType(
  envelopes: ReadonlyArray<EnvelopeDto>,
  summary: EnvelopeSummaryDto | null,
): EnvelopeGroup[];
```

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/envelopes/group-by-type.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { groupByType } from './group-by-type.js';
import type {
  EnvelopeDto,
  EnvelopeSummaryDto,
} from '../../composables/useBudgetReferenceData.js';

const envelope = (
  id: string,
  envelopeType: EnvelopeDto['envelopeType'],
  displayOrder: number,
): EnvelopeDto => ({ id, envelopeType, displayOrder }) as unknown as EnvelopeDto;

const summary: EnvelopeSummaryDto = {
  currency: 'RUB',
  scale: 2,
  totalMinor: '810000',
  count: 3,
  byType: [
    { envelopeType: 'CURRENT_EXPENSES', totalMinor: '310000', count: 2 },
    { envelopeType: 'SAVINGS_GOAL', totalMinor: '500000', count: 1 },
  ],
};

describe('groupByType', () => {
  it('orders groups by domain order, not by arrival', () => {
    const groups = groupByType(
      [
        envelope('a', 'SAVINGS_GOAL', 10),
        envelope('b', 'CURRENT_EXPENSES', 20),
        envelope('c', 'CURRENT_EXPENSES', 10),
      ],
      summary,
    );

    expect(groups.map((group) => group.envelopeType)).toEqual([
      'CURRENT_EXPENSES',
      'SAVINGS_GOAL',
    ]);
    expect(groups[0]?.label).toBe('Текущие расходы');
    expect(groups[1]?.label).toBe('Цели накоплений');
  });

  it('keeps display order inside a group', () => {
    const groups = groupByType(
      [envelope('b', 'CURRENT_EXPENSES', 20), envelope('c', 'CURRENT_EXPENSES', 10)],
      summary,
    );

    expect(groups[0]?.items.map((item) => item.id)).toEqual(['c', 'b']);
  });

  it('takes the group total from the server summary', () => {
    const groups = groupByType([envelope('a', 'SAVINGS_GOAL', 10)], summary);

    expect(groups[0]?.totalMinor).toBe('500000');
  });

  it('leaves the total empty when the summary has not arrived', () => {
    const groups = groupByType([envelope('a', 'RESERVE', 10)], null);

    expect(groups[0]?.totalMinor).toBeNull();
    expect(groups[0]?.label).toBe('Резерв');
  });

  it('returns nothing for an empty list', () => {
    expect(groupByType([], summary)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test group-by-type`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Write the module**

`apps/web/app/components/envelopes/group-by-type.ts`:

```ts
import type {
  EnvelopeDto,
  EnvelopeSummaryDto,
  EnvelopeType,
} from '../../composables/useBudgetReferenceData.js';

// The same order the API returns byType in; keeping it here too means a list
// without a summary still reads in the expected order.
const TYPE_ORDER = [
  'CURRENT_EXPENSES',
  'MANDATORY_EXPENSES',
  'SAVINGS_GOAL',
  'RESERVE',
  'FREE_MONEY',
  'CUSTOM',
] as const satisfies ReadonlyArray<EnvelopeType>;

const TYPE_LABELS: Record<EnvelopeType, string> = {
  CURRENT_EXPENSES: 'Текущие расходы',
  MANDATORY_EXPENSES: 'Обязательные расходы',
  SAVINGS_GOAL: 'Цели накоплений',
  RESERVE: 'Резерв',
  FREE_MONEY: 'Свободные деньги',
  CUSTOM: 'Другое',
};

export interface EnvelopeGroup {
  envelopeType: EnvelopeType;
  label: string;
  totalMinor: string | null;
  items: EnvelopeDto[];
}

export function groupByType(
  envelopes: ReadonlyArray<EnvelopeDto>,
  summary: EnvelopeSummaryDto | null,
): EnvelopeGroup[] {
  return TYPE_ORDER.flatMap((envelopeType) => {
    const items = envelopes
      .filter((envelope) => envelope.envelopeType === envelopeType)
      .sort((left, right) => left.displayOrder - right.displayOrder);
    if (items.length === 0) return [];
    const group = summary?.byType.find((entry) => entry.envelopeType === envelopeType);
    return [
      {
        envelopeType,
        label: TYPE_LABELS[envelopeType],
        totalMinor: group?.totalMinor ?? null,
        items,
      },
    ];
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test group-by-type`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/envelopes/group-by-type.ts apps/web/app/components/envelopes/group-by-type.test.ts
git commit -m "feat(web): group envelopes by type for the list"
```

---

### Task 10: `EnvelopeRow`

**Files:**
- Create: `apps/web/app/components/envelopes/EnvelopeRow.vue`
- Create: `apps/web/app/components/envelopes/EnvelopeRow.test.ts`

**Interfaces:**
- Consumes: `UiListRow`, `UiStatus`, `UiProgress` (Task 4), `FinanceMoney`, `formatMinorUnits` из `../finance/money-format.js`, `EnvelopeDto`.
- Produces: `EnvelopeRow` с пропом `envelope: EnvelopeDto`, эмитит `select: []`, слот `actions`.

Полоса прогресса рисуется **только** для конверта с `targetAmountMinor`; план на месяц полосы не получает.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/envelopes/EnvelopeRow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopeRow from './EnvelopeRow.vue';
import type { EnvelopeDto } from '../../composables/useBudgetReferenceData.js';

const envelope: EnvelopeDto = {
  id: 'envelope-id',
  budgetId: 'budget-id',
  templateKey: null,
  name: 'Текущие расходы',
  envelopeType: 'CURRENT_EXPENSES',
  periodSlot: 'FIRST',
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '1000000',
  currentBalanceMinor: '245000',
  monthlyPlannedAmountMinor: '300000',
  targetAmountMinor: null,
  targetDate: null,
  displayOrder: 10,
  comment: null,
  archivedAt: null,
};

const mountRow = (overrides: Partial<EnvelopeDto> = {}) =>
  mount(EnvelopeRow, { props: { envelope: { ...envelope, ...overrides } } });

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

describe('EnvelopeRow', () => {
  it('leads with the name, the type and the period half', () => {
    const text = normalize(mountRow().text());

    expect(text).toContain('Текущие расходы');
    expect(text).toContain('Первая половина');
    expect(text).toContain('2 450,00 ₽');
  });

  it('draws a progress bar only for a savings goal', () => {
    expect(mountRow().find('[role="progressbar"]').exists()).toBe(false);

    const goal = mountRow({
      envelopeType: 'SAVINGS_GOAL',
      name: 'Отпуск',
      periodSlot: null,
      targetAmountMinor: '5000000',
      currentBalanceMinor: '1000000',
    });

    expect(goal.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('20');
    expect(normalize(goal.get('[data-testid="envelope-row-goal"]').text())).toBe(
      '10 000,00 ₽ из 50 000,00 ₽',
    );
  });

  it('marks an archived envelope', () => {
    expect(
      mountRow({ archivedAt: '2026-09-10T00:00:00.000Z' })
        .get('[data-testid="envelope-row-archived"]')
        .text(),
    ).toBe('В архиве');
  });

  it('selects the envelope when the row is pressed', async () => {
    const wrapper = mountRow();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test EnvelopeRow`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

`apps/web/app/components/envelopes/EnvelopeRow.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Landmark, PiggyBank, ShieldCheck, ShoppingCart, Sparkles, Wallet } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiListRow from '../ui/ListRow.vue';
import UiProgress from '../ui/Progress.vue';
import UiStatus from '../ui/Status.vue';
import type { EnvelopeDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'EnvelopeRow' });

const props = defineProps<{ envelope: EnvelopeDto }>();

defineEmits<{ select: [] }>();

const TYPE_LABELS = {
  CURRENT_EXPENSES: 'Текущие расходы',
  MANDATORY_EXPENSES: 'Обязательные расходы',
  SAVINGS_GOAL: 'Цели накоплений',
  RESERVE: 'Резерв',
  FREE_MONEY: 'Свободные деньги',
  CUSTOM: 'Другое',
} as const;

const TYPE_ICONS = {
  CURRENT_EXPENSES: ShoppingCart,
  MANDATORY_EXPENSES: Landmark,
  SAVINGS_GOAL: PiggyBank,
  RESERVE: ShieldCheck,
  FREE_MONEY: Wallet,
  CUSTOM: Sparkles,
} as const;

const PERIOD_LABELS = { FIRST: 'Первая половина', SECOND: 'Вторая половина' } as const;

const icon = computed(() => TYPE_ICONS[props.envelope.envelopeType]);

const subtitle = computed(() =>
  [
    TYPE_LABELS[props.envelope.envelopeType],
    props.envelope.periodSlot === null ? null : PERIOD_LABELS[props.envelope.periodSlot],
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · '),
);

const goalTarget = computed(() => props.envelope.targetAmountMinor);

const goalLabel = computed(() => {
  const target = goalTarget.value;
  if (target === null) return '';
  const saved = formatMinorUnits(
    props.envelope.currentBalanceMinor,
    props.envelope.currency,
    props.envelope.scale,
  );
  const total = formatMinorUnits(target, props.envelope.currency, props.envelope.scale);
  return `${saved} из ${total}`;
});

const rowLabel = computed(() => `Открыть конверт «${props.envelope.name}»`);
</script>

<template>
  <UiListRow :label="rowLabel" @select="$emit('select')">
    <template #leading><component :is="icon" :size="20" aria-hidden="true" /></template>

    <span class="envelope-row__title">{{ envelope.name }}</span>
    <span class="envelope-row__subtitle">{{ subtitle }}</span>
    <span v-if="goalTarget !== null" class="envelope-row__goal">
      <UiProgress
        :value="envelope.currentBalanceMinor"
        :max="goalTarget"
        :label="`Накоплено ${goalLabel}`"
      />
      <span class="envelope-row__subtitle" data-testid="envelope-row-goal">{{ goalLabel }}</span>
    </span>
    <span v-if="envelope.archivedAt" class="envelope-row__meta">
      <UiStatus data-testid="envelope-row-archived" label="В архиве" tone="neutral" />
    </span>

    <template #trailing>
      <FinanceMoney
        class="envelope-row__amount"
        :minor-units="envelope.currentBalanceMinor"
        :currency="envelope.currency"
        :scale="envelope.scale"
      />
    </template>

    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiListRow>
</template>

<style scoped>
.envelope-row__title {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-row__subtitle {
  overflow: hidden;
  max-width: 100%;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-row__goal {
  display: grid;
  gap: 0.25rem;
}

.envelope-row__meta {
  display: flex;
  gap: var(--hf-space-1);
  align-items: center;
}

.envelope-row__amount {
  font-weight: var(--hf-font-weight-semibold);
  white-space: nowrap;
}
</style>
```

Сверь фактический путь и сигнатуру `formatMinorUnits` — в `apps/web/app/components/finance/FinanceMoney.vue` он импортируется как `import { formatMinorUnits } from './money-format.js'` и вызывается как `formatMinorUnits(minorUnits, currency, scale, locale?)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test EnvelopeRow`
Expected: PASS, 4 теста.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/envelopes/EnvelopeRow.vue apps/web/app/components/envelopes/EnvelopeRow.test.ts
git commit -m "feat(web): render envelopes as rows with goal progress"
```

---

### Task 11: `EnvelopeDrawer`

**Files:**
- Create: `apps/web/app/components/envelopes/EnvelopeDrawer.vue`
- Create: `apps/web/app/components/envelopes/EnvelopeDrawer.test.ts`

**Interfaces:**
- Consumes: `UiDrawer`, `UiButton`, `UiStatus`, `UiProgress`, `FinanceMoney`, `EnvelopeDto`.
- Produces: `EnvelopeDrawer` с пропом `envelope: EnvelopeDto | null`; эмитит `close: []`, `edit: [envelope: EnvelopeDto]`, `archive: [envelope: EnvelopeDto]`.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/envelopes/EnvelopeDrawer.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopeDrawer from './EnvelopeDrawer.vue';
import type { EnvelopeDto } from '../../composables/useBudgetReferenceData.js';

const envelope: EnvelopeDto = {
  id: 'envelope-id',
  budgetId: 'budget-id',
  templateKey: null,
  name: 'Отпуск',
  envelopeType: 'SAVINGS_GOAL',
  periodSlot: null,
  currency: 'RUB',
  scale: 2,
  startingBalanceMinor: '0',
  currentBalanceMinor: '1000000',
  monthlyPlannedAmountMinor: '300000',
  targetAmountMinor: '5000000',
  targetDate: '2027-06-01',
  displayOrder: 10,
  comment: 'Копим на лето',
  archivedAt: null,
};

const mountDrawer = (overrides: Partial<EnvelopeDto> = {}) =>
  mount(EnvelopeDrawer, {
    props: { envelope: { ...envelope, ...overrides } },
    attachTo: document.body,
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });

describe('EnvelopeDrawer', () => {
  it('shows the goal with its progress and date', () => {
    const wrapper = mountDrawer();

    expect(wrapper.text()).toContain('Цели накоплений');
    expect(wrapper.text()).toContain('2027-06-01');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('20');
    wrapper.unmount();
  });

  it('shows the monthly plan as text without a bar', () => {
    const wrapper = mountDrawer({ targetAmountMinor: null, targetDate: null });

    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('План на месяц');
    wrapper.unmount();
  });

  it('hands editing and archiving back to the page', async () => {
    const wrapper = mountDrawer();

    await wrapper.get('[data-testid="envelope-drawer-edit"]').trigger('click');
    await wrapper.get('[data-testid="envelope-drawer-archive"]').trigger('click');

    expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({ id: 'envelope-id' });
    expect(wrapper.emitted('archive')?.[0]?.[0]).toMatchObject({ id: 'envelope-id' });
    wrapper.unmount();
  });

  it('links to the journal filtered by this envelope', () => {
    const wrapper = mountDrawer();

    expect(wrapper.get('[data-testid="envelope-drawer-operations"]').attributes('href')).toBe(
      '/app/operations?envelopeId=envelope-id',
    );
    wrapper.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test EnvelopeDrawer`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

`apps/web/app/components/envelopes/EnvelopeDrawer.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import UiButton from '../ui/Button.vue';
import UiDrawer from '../ui/Drawer.vue';
import UiProgress from '../ui/Progress.vue';
import UiStatus from '../ui/Status.vue';
import type { EnvelopeDto } from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'EnvelopeDrawer' });

const props = defineProps<{ envelope: EnvelopeDto | null }>();

const emit = defineEmits<{
  close: [];
  edit: [envelope: EnvelopeDto];
  archive: [envelope: EnvelopeDto];
}>();

const TYPE_LABELS = {
  CURRENT_EXPENSES: 'Текущие расходы',
  MANDATORY_EXPENSES: 'Обязательные расходы',
  SAVINGS_GOAL: 'Цели накоплений',
  RESERVE: 'Резерв',
  FREE_MONEY: 'Свободные деньги',
  CUSTOM: 'Другое',
} as const;

const PERIOD_LABELS = { FIRST: 'Первая половина', SECOND: 'Вторая половина' } as const;

const typeLabel = computed(() =>
  props.envelope ? TYPE_LABELS[props.envelope.envelopeType] : '',
);

const periodLabel = computed(() =>
  props.envelope?.periodSlot ? PERIOD_LABELS[props.envelope.periodSlot] : null,
);

const goalLabel = computed(() => {
  const envelope = props.envelope;
  if (!envelope || envelope.targetAmountMinor === null) return '';
  const saved = formatMinorUnits(envelope.currentBalanceMinor, envelope.currency, envelope.scale);
  const total = formatMinorUnits(envelope.targetAmountMinor, envelope.currency, envelope.scale);
  return `${saved} из ${total}`;
});

const operationsLink = computed(() =>
  props.envelope ? `/app/operations?envelopeId=${encodeURIComponent(props.envelope.id)}` : '',
);
</script>

<template>
  <UiDrawer :open="envelope !== null" title="Конверт" @close="emit('close')">
    <div v-if="envelope" class="envelope-drawer">
      <p class="envelope-drawer__amount">
        <FinanceMoney
          :minor-units="envelope.currentBalanceMinor"
          :currency="envelope.currency"
          :scale="envelope.scale"
        />
      </p>
      <UiStatus
        :label="envelope.archivedAt ? 'В архиве' : 'Активен'"
        :tone="envelope.archivedAt ? 'neutral' : 'success'"
      />

      <div v-if="envelope.targetAmountMinor !== null" class="envelope-drawer__goal">
        <UiProgress
          :value="envelope.currentBalanceMinor"
          :max="envelope.targetAmountMinor"
          :label="`Накоплено ${goalLabel}`"
        />
        <p class="envelope-drawer__goal-text">{{ goalLabel }}</p>
      </div>

      <dl class="envelope-drawer__rows">
        <div>
          <dt>Название</dt>
          <dd>{{ envelope.name }}</dd>
        </div>
        <div>
          <dt>Тип</dt>
          <dd>{{ typeLabel }}</dd>
        </div>
        <div v-if="periodLabel">
          <dt>Половина периода</dt>
          <dd>{{ periodLabel }}</dd>
        </div>
        <div>
          <dt>Начальный остаток</dt>
          <dd>
            <FinanceMoney
              :minor-units="envelope.startingBalanceMinor"
              :currency="envelope.currency"
              :scale="envelope.scale"
            />
          </dd>
        </div>
        <div v-if="envelope.monthlyPlannedAmountMinor !== null">
          <dt>План на месяц</dt>
          <dd>
            <FinanceMoney
              :minor-units="envelope.monthlyPlannedAmountMinor"
              :currency="envelope.currency"
              :scale="envelope.scale"
            />
          </dd>
        </div>
        <div v-if="envelope.targetDate">
          <dt>Дата цели</dt>
          <dd>{{ envelope.targetDate }}</dd>
        </div>
        <div>
          <dt>Порядок отображения</dt>
          <dd>{{ envelope.displayOrder }}</dd>
        </div>
        <div v-if="envelope.comment">
          <dt>Комментарий</dt>
          <dd>{{ envelope.comment }}</dd>
        </div>
      </dl>
    </div>

    <template v-if="envelope" #footer>
      <UiButton data-testid="envelope-drawer-edit" @click="emit('edit', envelope)">
        Изменить
      </UiButton>
      <UiButton
        variant="secondary"
        data-testid="envelope-drawer-operations"
        :to="operationsLink"
      >
        Операции конверта
      </UiButton>
      <UiButton
        v-if="!envelope.archivedAt"
        variant="tertiary"
        data-testid="envelope-drawer-archive"
        @click="emit('archive', envelope)"
      >
        Переместить в архив
      </UiButton>
    </template>
  </UiDrawer>
</template>

<style scoped>
.envelope-drawer {
  display: grid;
  gap: var(--hf-space-4);
}

.envelope-drawer__amount {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  font-weight: var(--hf-font-weight-bold);
  line-height: var(--hf-line-height-h2);
}

.envelope-drawer__goal {
  display: grid;
  gap: var(--hf-space-2);
}

.envelope-drawer__goal-text {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}

.envelope-drawer__rows {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
}

.envelope-drawer__rows div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.envelope-drawer__rows dt {
  color: var(--hf-color-text-muted);
}

.envelope-drawer__rows dd {
  margin: 0;
  text-align: right;
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test EnvelopeDrawer`
Expected: PASS, 4 теста.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/components/envelopes/EnvelopeDrawer.vue apps/web/app/components/envelopes/EnvelopeDrawer.test.ts
git commit -m "feat(web): show envelope details in a drawer"
```

---

### Task 12: Сборка страницы конвертов

**Files:**
- Modify: `apps/web/app/pages/app/envelopes.vue`
- Modify: `apps/web/app/pages/app/envelopes.test.ts`
- Delete: `apps/web/app/components/envelopes/EnvelopeCard.vue`, `apps/web/app/components/envelopes/EnvelopeCard.test.ts`

**Interfaces:**
- Consumes: `EnvelopeRow` (Task 10), `EnvelopeDrawer` (Task 11), `groupByType` (Task 9), `getEnvelopesSummary` (Task 5), существующие `UiChip`, `UiActionMenu`, `UiModal`, `UiSkeleton`, `UiEmptyState`, `UiConfirmDialog`, `OperationGroup` не используется — у конвертов свой заголовок группы.
- Produces: страницу-оркестратор.

- [ ] **Step 1: Write the failing tests**

В `apps/web/app/pages/app/envelopes.test.ts` добавить (в мок API — `getEnvelopesSummary: vi.fn()`, в `beforeEach` — ответ с `byType`):

```ts
  it('groups envelopes by type with the server total in the heading', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const headings = wrapper.findAll('[data-testid="envelope-group-label"]');
    expect(headings.length).toBeGreaterThan(0);
    expect(normalize(headings[0]?.text() ?? '')).toContain('Текущие расходы');
    expect(normalize(wrapper.get('[data-testid="envelope-group-total"]').text())).toContain(
      '2 100,00 ₽',
    );
  });

  it('opens the drawer from a row', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true);
  });

  it('switches both requests to the archive from the chip', async () => {
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="chip-archived"]').trigger('click');
    await flushPromises();

    expect(api.listEnvelopes).toHaveBeenLastCalledWith('budget-id', 'archived');
    expect(api.getEnvelopesSummary).toHaveBeenLastCalledWith('budget-id', 'archived');
  });
```

Фикстура сводки в `beforeEach`:

```ts
    api.getEnvelopesSummary.mockResolvedValue({
      currency: 'RUB',
      scale: 2,
      totalMinor: '210000',
      count: 1,
      byType: [{ envelopeType: 'CURRENT_EXPENSES', totalMinor: '210000', count: 1 }],
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @harmofin/web test envelopes.test`
Expected: FAIL — групп, чипа и панели пока нет.

- [ ] **Step 3: Rebuild the page**

Загрузка и состояние — как на странице счетов (Task 8), но со сводкой конвертов и группировкой:

```ts
import EnvelopeDrawer from '../../components/envelopes/EnvelopeDrawer.vue';
import EnvelopeRow from '../../components/envelopes/EnvelopeRow.vue';
import { groupByType } from '../../components/envelopes/group-by-type.js';
import type { EnvelopeSummaryDto } from '../../composables/useBudgetReferenceData.js';

const summary = ref<EnvelopeSummaryDto | null>(null);
const detailed = ref<EnvelopeDto | null>(null);
const groups = computed(() => groupByType(envelopes.value, summary.value));

async function loadEnvelopes(): Promise<void> {
  const id = budgetId.value;
  if (!id) return;
  useOperationReferenceData().invalidate();
  const [items, totals] = await Promise.all([
    api.listEnvelopes(id, status.value),
    api.getEnvelopesSummary(id, status.value),
  ]);
  envelopes.value = items;
  summary.value = totals;
}
```

Разметка групп:

```vue
<section v-for="group in groups" :key="group.envelopeType" class="envelopes-page__group">
  <header class="envelopes-page__group-header">
    <h2 class="envelopes-page__group-label" data-testid="envelope-group-label">
      {{ group.label }}
    </h2>
    <p
      v-if="group.totalMinor !== null"
      class="envelopes-page__group-total"
      data-testid="envelope-group-total"
    >
      <FinanceMoney :minor-units="group.totalMinor" currency="RUB" :scale="2" />
    </p>
  </header>

  <ul class="envelopes-page__list" :aria-label="`Конверты: ${group.label}`">
    <li v-for="envelope in group.items" :key="envelope.id">
      <EnvelopeRow :envelope="envelope" @select="detailed = envelope">
        <template #actions>
          <UiActionMenu label="Действия над конвертом">
            <button type="button" role="menuitem" data-testid="row-edit" @click="startEdit(envelope)">
              Изменить
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="row-operations"
              @click="openOperations(envelope)"
            >
              Операции конверта
            </button>
            <button
              v-if="!envelope.archivedAt"
              type="button"
              role="menuitem"
              data-testid="row-archive"
              @click="askArchive(envelope)"
            >
              Переместить в архив
            </button>
          </UiActionMenu>
        </template>
      </EnvelopeRow>
    </li>
  </ul>
</section>
```

```ts
function openOperations(envelope: EnvelopeDto): void {
  void navigateTo(`/app/operations?envelopeId=${encodeURIComponent(envelope.id)}`);
}
```

Состояние архива, итог, скелетоны и пустые состояния:

```ts
const status = ref<ReferenceStatus>(route.query.status === 'archived' ? 'archived' : 'active');

async function toggleArchived(): Promise<void> {
  status.value = status.value === 'archived' ? 'active' : 'archived';
  await navigateTo(
    { path: route.path, query: status.value === 'archived' ? { status: 'archived' } : {} },
    { replace: true },
  );
  await loadPage();
}
```

```vue
<p v-if="summary" class="envelopes-page__total" data-testid="envelopes-total">
  Всего в конвертах
  <FinanceMoney
    :minor-units="summary.totalMinor"
    :currency="summary.currency"
    :scale="summary.scale"
  />
</p>

<div class="envelopes-page__filters">
  <UiChip
    label="В архиве"
    :active="status === 'archived'"
    data-testid="chip-archived"
    @click="toggleArchived"
  />
</div>

<div v-if="loading && envelopes.length === 0" data-testid="envelopes-loading" aria-busy="true">
  <UiSkeleton variant="row" :count="4" />
</div>

<UiEmptyState
  v-else-if="envelopes.length === 0 && status === 'archived'"
  title="В архиве пусто"
  description="Архивные конверты появятся здесь после архивирования."
/>

<UiEmptyState
  v-else-if="envelopes.length === 0"
  title="Конвертов пока нет"
  description="Создайте конверт, чтобы распределять в него деньги."
>
  <template #action><UiButton @click="startCreate">Создать конверт</UiButton></template>
</UiEmptyState>

<template v-else>
  <!-- группы из предыдущего фрагмента -->
</template>

<EnvelopeDrawer
  :envelope="detailed"
  @close="detailed = null"
  @edit="startEdit"
  @archive="askArchive"
/>

<UiModal
  :open="formOpen"
  :title="editingId ? 'Изменить конверт' : 'Новый конверт'"
  @close="cancelForm"
>
  <!-- существующая форма конверта целиком, без изменения полей и валидации -->
</UiModal>
```

Как и на странице счетов: `startCreate` и `startEdit` ставят `formOpen.value = true`, `startEdit` дополнительно закрывает панель (`detailed.value = null`), `cancelForm` ставит `formOpen.value = false`, а `askArchive` после успеха обнуляет `detailed`.

Список конвертов — это `ul` внутри каждой группы; у `li` поставь `min-width: 0`, иначе длинное название конверта расширит страницу на телефоне (та же ловушка, что была в журнале: grid-элементы имеют `min-width: auto`).

- [ ] **Step 4: Delete the card the page no longer mounts**

```bash
git rm apps/web/app/components/envelopes/EnvelopeCard.vue apps/web/app/components/envelopes/EnvelopeCard.test.ts
```

Перед удалением: `grep -rn "EnvelopeCard" apps/web/app e2e`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web build
git add apps/web/app/pages/app/envelopes.vue apps/web/app/pages/app/envelopes.test.ts apps/web/app/components/envelopes
git commit -m "feat(web): rebuild the envelopes screen around grouped rows"
```

---

### Task 13: Открытие операции по ссылке

**Files:**
- Modify: `apps/web/app/pages/app/operations.vue`
- Modify: `apps/web/app/pages/app/operations.test.ts`

**Interfaces:**
- Consumes: существующие `api.getTransaction`, `detailed`, `isUuid` в `operations.vue`.
- Produces: поведение «`/app/operations?operationId=<uuid>` открывает панель этой операции». На это поведение опирается Task 14.

- [ ] **Step 1: Write the failing test**

Добавить в `apps/web/app/pages/app/operations.test.ts`:

```ts
  it('opens the drawer for the operation named in the query', async () => {
    routeQuery.operationId = '00000000-0000-4000-8000-000000000009';
    api.getTransaction.mockResolvedValue({
      ...draftExpense,
      id: '00000000-0000-4000-8000-000000000009',
      status: 'CONFIRMED',
    });
    mountPage();
    await flushPromises();

    expect(api.getTransaction).toHaveBeenCalledWith(
      'budget-id',
      '00000000-0000-4000-8000-000000000009',
    );
    expect(wrapper!.find('[data-testid="drawer"]').exists()).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test operations.test`
Expected: FAIL — панель не открывается.

- [ ] **Step 3: Implement the deep link**

В `apps/web/app/pages/app/operations.vue` рядом с `preloadDraft` добавить:

```ts
const preloadedOperationId = ref<string | null>(null);

// A row on the dashboard links here: without this the click would land on the
// journal and lose the operation the reader asked for.
async function preloadDetailed(): Promise<void> {
  if (!budget.value || detailed.value) return;
  const operationId = typeof route.query.operationId === 'string' ? route.query.operationId : null;
  if (!operationId || !isUuid(operationId)) return;
  if (preloadedOperationId.value === operationId) return;
  preloadedOperationId.value = operationId;
  try {
    detailed.value = await api.getTransaction(budget.value.id, operationId);
  } catch {
    error.value = 'Не удалось открыть операцию.';
  }
}
```

и вызвать её в `load()` там же, где вызывается `preloadDraft()`:

```ts
    await preloadDraft();
    await preloadDetailed();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @harmofin/web test operations.test`
Expected: PASS — новый случай и все существующие.

- [ ] **Step 5: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
git add apps/web/app/pages/app/operations.vue apps/web/app/pages/app/operations.test.ts
git commit -m "feat(web): open a journal operation from a link"
```

---

### Task 14: Главная на строках

**Files:**
- Create: `apps/web/app/components/dashboard/RecentOperations.vue`
- Create: `apps/web/app/components/dashboard/RecentOperations.test.ts`
- Modify: `apps/web/app/components/dashboard/BalanceList.vue`
- Modify: `apps/web/app/components/dashboard/BalanceList.test.ts`
- Modify: `apps/web/app/pages/app/index.vue`
- Modify: `apps/web/app/pages/app/index.test.ts`

**Interfaces:**
- Consumes: `OperationRow`, `UiListRow`, `UiButton`, `useOperationReferenceData` (кеш справочников), `getAccountsSummary` / `getEnvelopesSummary` (Task 5), `preloadDetailed` из Task 13 (через ссылку `?operationId=`).
- Produces: `RecentOperations` с пропами `transactions: ReadonlyArray<TransactionDto>`, `categories: ReadonlyArray<CategoryDto>`, `accounts: ReadonlyArray<{ value: string; label: string }>`, `envelopes: ReadonlyArray<{ value: string; label: string }>`.

- [ ] **Step 1: Write the failing test**

Создать `apps/web/app/components/dashboard/RecentOperations.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import RecentOperations from './RecentOperations.vue';
import type {
  CategoryDto,
  TransactionDto,
} from '../../composables/useBudgetReferenceData.js';

const transaction = (id: string): TransactionDto =>
  ({
    id,
    budgetId: 'budget-id',
    transactionType: 'EXPENSE',
    status: 'CONFIRMED',
    amountMinor: '245000',
    currency: 'RUB',
    scale: 2,
    occurredOn: '2026-09-14',
    accountId: 'account-id',
    categoryId: 'category-id',
    envelopeId: null,
    sourceDescription: null,
    merchantName: 'Супермаркет',
    isPlanned: false,
    comment: null,
    confirmedAt: null,
    cancelledAt: null,
    deletedAt: null,
    accountCurrentBalanceMinor: '0',
    envelopeCurrentBalanceMinor: null,
    unallocatedMinor: '0',
    allocationProposal: null,
  }) as TransactionDto;

const categories = [
  { id: 'category-id', name: 'Продукты', templateKey: 'expense-groceries' },
] as unknown as CategoryDto[];

const mountBlock = (count: number) =>
  mount(RecentOperations, {
    props: {
      transactions: Array.from({ length: count }, (_, index) => transaction(`transaction-${index}`)),
      categories,
      accounts: [{ value: 'account-id', label: 'Основная карта' }],
      envelopes: [],
    },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  });

describe('RecentOperations', () => {
  it('names the account and the category on every row', () => {
    const wrapper = mountBlock(1);

    expect(wrapper.text()).toContain('Продукты');
    expect(wrapper.text()).toContain('Основная карта');
  });

  it('links each row to the journal with that operation open', () => {
    const wrapper = mountBlock(1);

    expect(wrapper.get('[data-testid="recent-operation-link"]').attributes('href')).toBe(
      '/app/operations?operationId=transaction-0',
    );
  });

  it('says so when there is nothing yet', () => {
    expect(mountBlock(0).text()).toContain('Операций пока нет');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harmofin/web test RecentOperations`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Write the component**

`apps/web/app/components/dashboard/RecentOperations.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';

import OperationRow from '../operations/OperationRow.vue';
import type {
  CategoryDto,
  TransactionDto,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'RecentOperations' });

type Option = { value: string; label: string };

const props = defineProps<{
  transactions: ReadonlyArray<TransactionDto>;
  categories: ReadonlyArray<CategoryDto>;
  accounts: ReadonlyArray<Option>;
  envelopes: ReadonlyArray<Option>;
}>();

const categoryById = computed(
  () => new Map(props.categories.map((category) => [category.id, category])),
);
const accountNameById = computed(
  () => new Map(props.accounts.map((account) => [account.value, account.label])),
);
const envelopeNameById = computed(
  () => new Map(props.envelopes.map((envelope) => [envelope.value, envelope.label])),
);

function categoryName(transaction: TransactionDto): string {
  return categoryById.value.get(transaction.categoryId)?.name ?? 'Без категории';
}

function categoryTemplateKey(transaction: TransactionDto): string | null {
  return categoryById.value.get(transaction.categoryId)?.templateKey ?? null;
}

function accountName(transaction: TransactionDto): string {
  return accountNameById.value.get(transaction.accountId) ?? 'Счёт';
}

function envelopeName(transaction: TransactionDto): string | null {
  return transaction.envelopeId === null
    ? null
    : (envelopeNameById.value.get(transaction.envelopeId) ?? 'Конверт');
}
</script>

<template>
  <section class="recent-operations" aria-label="Последние операции">
    <header class="recent-operations__header">
      <h2>Последние операции</h2>
      <NuxtLink to="/app/operations">Все операции</NuxtLink>
    </header>

    <p v-if="transactions.length === 0" class="recent-operations__empty">Операций пока нет.</p>

    <ul v-else class="recent-operations__list">
      <li v-for="transaction in transactions" :key="transaction.id">
        <NuxtLink
          class="recent-operations__link"
          data-testid="recent-operation-link"
          :to="`/app/operations?operationId=${encodeURIComponent(transaction.id)}`"
        >
          <OperationRow
            :transaction="transaction"
            :category-name="categoryName(transaction)"
            :category-template-key="categoryTemplateKey(transaction)"
            :account-name="accountName(transaction)"
            :envelope-name="envelopeName(transaction)"
          />
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.recent-operations {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.recent-operations__header {
  display: flex;
  gap: var(--hf-space-3);
  align-items: baseline;
  justify-content: space-between;
}

.recent-operations__header h2 {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.recent-operations__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}

.recent-operations__list {
  display: grid;
  gap: var(--hf-space-1);
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent-operations__list > li {
  min-width: 0;
}

.recent-operations__link {
  display: block;
  color: inherit;
  text-decoration: none;
}
</style>
```

`OperationRow` внутри ссылки сам рендерит кнопку выбора строки; на главной она никуда не ведёт и служит только заголовком строки, поэтому событие `select` здесь не слушаем — переход делает внешняя ссылка. Если при проверке в браузере окажется, что вложенная кнопка внутри ссылки мешает клику, перенеси ссылку внутрь слота `actions` и оставь на строке обработчик `@select`, ведущий тем же `navigateTo`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harmofin/web test RecentOperations`
Expected: PASS, 3 теста.

- [ ] **Step 5: Give the balance lists rows, a total and a link**

В `apps/web/app/components/dashboard/BalanceList.vue` добавить пропы и заменить самописный `ul` на `UiListRow`:

```ts
const props = defineProps<{
  title: string;
  items: ReadonlyArray<DashboardBalance>;
  warnings: ReadonlyArray<DashboardWarning>;
  subject: DashboardWarning['subject'];
  totalMinor: string | null;
  moreLink: string;
  limit?: number;
}>();

const LIMIT = 5;

const visible = computed(() => props.items.slice(0, props.limit ?? LIMIT));
```

Разметка целиком:

```vue
<template>
  <section class="balance-list" :aria-label="title">
    <header class="balance-list__header">
      <h2>{{ title }}</h2>
      <p v-if="totalMinor !== null" class="balance-list__total" data-testid="balance-list-total">
        <FinanceMoney :minor-units="totalMinor" currency="RUB" :scale="2" />
      </p>
      <NuxtLink :to="moreLink">Все</NuxtLink>
    </header>

    <p v-if="items.length === 0" class="balance-list__empty">Данных пока нет.</p>

    <ul v-else class="balance-list__list">
      <li v-for="item in visible" :key="item.id">
        <UiListRow :label="`Открыть ${item.name}`" @select="navigate">
          <span class="balance-list__name">{{ item.name }}</span>
          <span v-if="hasWarning(item.id)" class="balance-list__meta">
            <UiStatus label="Дефицит" tone="warning" />
          </span>

          <template #trailing>
            <FinanceMoney :minor-units="item.balanceMinor" currency="RUB" :scale="2" />
          </template>
        </UiListRow>
      </li>
    </ul>
  </section>
</template>
```

```ts
function hasWarning(id: string): boolean {
  return props.warnings.some(
    (warning) => warning.subject === props.subject && warning.id === id,
  );
}

function navigate(): void {
  void navigateTo(props.moreLink);
}
```

`navigateTo` импортируется из `#imports`. Существующий `BalanceList.test.ts` проверяет текст «Дефицит» — дополни его новыми пропами (`totalMinor`, `moreLink`) и добавь случай на итог и на ограничение в пять строк, а файл целиком не переписывай:

```ts
  it('shows the server total and stops at five rows', () => {
    const wrapper = mount(BalanceList, {
      props: {
        title: 'Счета',
        items: Array.from({ length: 7 }, (_, index) => ({
          id: `account-${index}`,
          name: `Счёт ${index}`,
          balanceMinor: '100000',
        })),
        warnings: [],
        subject: 'ACCOUNT',
        totalMinor: '700000',
        moreLink: '/app/accounts',
      },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });

    expect(wrapper.findAll('[data-testid="list-row-select"]')).toHaveLength(5);
    expect(wrapper.get('[data-testid="balance-list-total"]').text().replace(/[  ]/g, ' ')).toContain(
      '7 000,00 ₽',
    );
  });
```

- [ ] **Step 6: Wire the dashboard**

В `apps/web/app/pages/app/index.vue`:

```ts
import RecentOperations from '../../components/dashboard/RecentOperations.vue';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';

const recent = ref<TransactionDto[]>([]);
const accountsTotal = ref<string | null>(null);
const envelopesTotal = ref<string | null>(null);
const { accounts, categories, envelopes, load: loadReferenceData } = useOperationReferenceData();

async function loadDashboard() {
  loading.value = true;
  error.value = '';
  try {
    if (!currentData.value) await loadMe();
    const budget = activeBudget.value;
    if (!budget) return;
    const [summaryResult, recentResult, accountsSummary, envelopesSummary] = await Promise.all([
      api.getDashboardSummary(budget.id),
      api.listTransactions(budget.id, { limit: 5, sortBy: 'occurredOn', sortDirection: 'desc' }),
      api.getAccountsSummary(budget.id),
      api.getEnvelopesSummary(budget.id),
      loadReferenceData(),
    ]);
    summary.value = summaryResult;
    recent.value = recentResult.items;
    accountsTotal.value = accountsSummary.totalMinor;
    envelopesTotal.value = envelopesSummary.totalMinor;
  } catch {
    error.value = 'Не удалось загрузить сводку. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}
```

Разметка: `RecentOperations` идёт после `UpcomingObligations`, затем два `BalanceList` с новыми пропами:

```vue
<RecentOperations
  class="dashboard-grid__wide"
  :transactions="recent"
  :categories="categories"
  :accounts="accounts"
  :envelopes="envelopes"
/>

<BalanceList
  title="Счета"
  :items="summary.accounts"
  :warnings="summary.warnings"
  subject="ACCOUNT"
  :total-minor="accountsTotal"
  more-link="/app/accounts"
/>

<BalanceList
  title="Конверты"
  :items="summary.envelopes"
  :warnings="summary.warnings"
  subject="ENVELOPE"
  :total-minor="envelopesTotal"
  more-link="/app/envelopes"
/>
```

Если сводки итогов не пришли, `accountsTotal` и `envelopesTotal` остаются `null`, и блок показывает список без итога — экран не должен пропадать целиком из-за необязательной цифры. Для этого оберни оба вызова сводок так, чтобы их отказ не ронял весь `Promise.all`:

```ts
const safeTotal = async (read: Promise<{ totalMinor: string }>): Promise<string | null> =>
  read.then((value) => value.totalMinor).catch(() => null);
```

и передавай в `Promise.all` уже `safeTotal(api.getAccountsSummary(budget.id))`.

- [ ] **Step 7: Extend the dashboard test**

В `apps/web/app/pages/app/index.test.ts` добавить в мок API `listTransactions`, `getAccountsSummary`, `getEnvelopesSummary`, `listAccounts`, `listCategories`, `listEnvelopes` (последние три нужны общему кешу справочников) и случай:

```ts
  it('shows the latest operations and the balance totals', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(api.listTransactions).toHaveBeenCalledWith('budget-id', {
      limit: 5,
      sortBy: 'occurredOn',
      sortDirection: 'desc',
    });
    expect(wrapper.text()).toContain('Последние операции');
    expect(normalize(wrapper.text())).toContain('1 500,00 ₽');
  });

  it('keeps the balance lists usable when a total fails to load', async () => {
    api.getAccountsSummary.mockRejectedValue(new Error('network'));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Счета');
    expect(wrapper.text()).not.toContain('Не удалось загрузить сводку');
  });
```

Не забудь `useOperationReferenceData().invalidate()` в `beforeEach`, иначе кеш справочников переживёт тест и второй случай не сделает запросов.

- [ ] **Step 8: Run tests**

Run: `pnpm --filter @harmofin/web test`
Expected: PASS.

- [ ] **Step 9: Verify and commit**

```bash
pnpm format
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web build
git add apps/web/app/components/dashboard apps/web/app/pages/app/index.vue apps/web/app/pages/app/index.test.ts
git commit -m "feat(web): put recent operations and balance totals on the dashboard"
```

---

### Task 15: E2E и финальная проверка

**Files:**
- Create: `e2e/reference-lists.spec.ts`
- Modify: `e2e/stage-3b.spec.ts`
- Modify: `e2e/stage-6-analytics-export.spec.ts` (только если в нём остались селекторы карточек)

**Interfaces:**
- Consumes: всё из задач 1–14.
- Produces: e2e-покрытие списков и главной.

- [ ] **Step 1: Repair the specs the redesign breaks**

В `e2e/stage-3b.spec.ts` заменить обращения к карточкам:

```ts
  await page
    .getByRole('article')
    .filter({ hasText: 'Карта Stage 3b' })
    .getByRole('link', { name: 'Операции счёта' })
    .click();
```

на переход через меню строки:

```ts
  await page
    .locator('li')
    .filter({ hasText: 'Карта Stage 3b' })
    .getByTestId('action-menu-trigger')
    .click();
  await page.getByTestId('row-operations').click();
```

То же для конверта: строка с названием конверта, `row-operations`. Пройди весь файл — селекторы там повторяются. Затем проверь `grep -rn "getByRole('article')" e2e` и почини оставшиеся места тем же способом.

- [ ] **Step 2: Write the reference lists spec**

Создать `e2e/reference-lists.spec.ts`. Регистрацию, шаблон и создание счёта скопируй из `e2e/operations-journal.spec.ts`.

```ts
test('creates an account from the list and archives it behind the chip', async ({ page }) => {
  await registerAndReachApp(page, 'reference-accounts');
  await initializeTemplate(page);

  await page.goto('/app/accounts');
  await page.locator('[data-action="create-account"]').click();
  await page.getByLabel('Название счёта').fill('Карта списка');
  await page.getByLabel('Начальный баланс').fill('10 000,00');
  await page.getByLabel('Дата начала учёта').fill('2026-09-04');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();

  await expect(page.getByTestId('accounts-total')).toContainText('10');
  await expect(page.getByText('Карта списка')).toBeVisible();

  await page.locator('li').filter({ hasText: 'Карта списка' }).getByTestId('action-menu-trigger').click();
  await page.getByTestId('row-archive').click();
  await page.locator('dialog[open] [data-confirm]').click();

  await expect(page.getByText('Карта списка')).toHaveCount(0);
  await page.getByTestId('chip-archived').click();
  await expect(page.getByText('Карта списка')).toBeVisible();
});

test('opens an envelope drawer and reaches the journal from it', async ({ page }) => {
  await registerAndReachApp(page, 'reference-envelopes');
  await initializeTemplate(page);

  await page.goto('/app/envelopes');
  await expect(page.getByTestId('envelope-group-label').first()).toBeVisible();

  await page.getByTestId('list-row-select').first().click();
  await expect(page.getByTestId('drawer')).toBeVisible();
  await page.getByTestId('envelope-drawer-operations').click();

  await expect(page).toHaveURL(/\/app\/operations\?envelopeId=/);
});

test('opens an operation from the dashboard', async ({ page }) => {
  await registerAndReachApp(page, 'reference-dashboard');
  await initializeTemplate(page);
  await createAccount(page, 'Карта главной', '10 000,00');
  await createEnvelope(page, 'Текущие главной', '10 000,00');
  await createDraftExpense(page, 'Карта главной', 'Текущие главной', 'Магазин', '100,00');

  await page.goto('/app');
  await page.getByTestId('recent-operation-link').first().click();

  await expect(page).toHaveURL(/\/app\/operations\?operationId=/);
  await expect(page.getByTestId('drawer')).toBeVisible();
});

test.describe('reference lists on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps both lists free of horizontal overflow', async ({ page }) => {
    await registerAndReachApp(page, 'reference-phone');
    await initializeTemplate(page);
    await createAccount(page, 'Карта телефона с длинным названием', '10 000,00');

    for (const path of ['/app/accounts', '/app/envelopes']) {
      await page.goto(path);
      await expect(page.getByTestId('list-row-select').first()).toBeVisible();
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement;
        return root ? root.scrollWidth - root.clientWidth : 0;
      });
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
```

Сверь фактические подписи полей формы счёта и конверта перед написанием и используй настоящие; `data-action="create-account"` и `create-envelope` уже стоят на кнопках создания.

- [ ] **Step 3: Run the full local gate**

```bash
pnpm format:check
pnpm --filter @harmofin/api lint
pnpm --filter @harmofin/api typecheck
pnpm --filter @harmofin/api test
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web build
node --test scripts/openapi/*.test.mjs
```

Expected: всё зелёное. Playwright локально не запускать — он идёт в CI.

- [ ] **Step 4: Walk the widths in a browser**

Открыть `pnpm dev` и проверить `/app/accounts`, `/app/envelopes` и `/app` на 320, 390, 768, 1024, 1280 и 1440: строки не ломаются при длинном названии, итог и чип не наезжают друг на друга, панель выезжает снизу ниже 768px и справа выше, полоса цели видна и не растягивает строку, нижняя навигация не перекрывает последнюю строку.

Проверь хотя бы один денежный итог сложением на калькуляторе: сумма строк на экране обязана совпасть с итогом в заголовке.

- [ ] **Step 5: Walk the keyboard**

На ширине 1440 пройти `Tab` по списку: строка открывает панель по Enter, «⋮» достижимо и раскрывается стрелками, Escape закрывает меню и панель с возвратом фокуса, внутри панели `Tab` не уходит на фон.

- [ ] **Step 6: Commit**

```bash
git add e2e
git commit -m "test(e2e): cover the reference lists and the dashboard rows"
```

---

## Проверка покрытия спека

| Раздел спека | Где реализован |
| --- | --- |
| `GET …/accounts/summary`, статус и подсчёт в одной транзакции | Task 1 |
| `GET …/envelopes/summary`, разбивка по типам в доменном порядке | Task 2 |
| Изоляция бюджета и интеграционное покрытие сводок | Task 1, Task 2, Task 3 |
| `UiProgress` и переезд `AvailableBudgetCard` | Task 4 |
| Клиентские методы сводок | Task 5 |
| Строка счёта, метка отрицательного баланса, меню действий | Task 6, Task 8 |
| Панель счёта со ссылками на журнал и перевод | Task 7 |
| Страница счетов: чип архива в query, итог, форма в модалке, состояния | Task 8 |
| Группировка конвертов по типу с итогом группы | Task 9, Task 12 |
| Строка конверта с прогрессом только для цели накопления | Task 10 |
| Панель конверта: план текстом, цель с прогрессом | Task 11 |
| Страница конвертов | Task 12 |
| `operationId` открывает панель в журнале | Task 13 |
| Главная: «Последние операции», строки и итоги в блоках балансов, устойчивость к отказу сводки | Task 14 |
| Удаление `AccountCard` и `EnvelopeCard`, правка e2e | Task 8, Task 12, Task 15 |
| Возврата из архива нет: кнопок нет нигде | Task 7, Task 11, Task 8, Task 12 |
| Модель данных и миграции не меняются | Соблюдено во всех задачах |
