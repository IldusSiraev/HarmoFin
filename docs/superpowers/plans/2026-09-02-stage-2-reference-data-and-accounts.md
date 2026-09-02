# План реализации Этапа 2 HarmoFin: справочники и счета

> **Для агентских исполнителей:** ОБЯЗАТЕЛЬНОЕ ПОДЗАДАНИЕ: использовать `superpowers:subagent-driven-development` (рекомендуется) или `superpowers:executing-plans` для реализации этого плана по задачам. Шаги используют чекбоксы (`- [ ]`) для отслеживания.

**Цель:** Добавить изолированные по бюджету счета, категории, конверты, настройки бюджета и русскоязычный settings UI без финансовых операций.

**Архитектура:** Prisma migration добавляет только Stage 2 модели и бюджетные настройки; все деньги хранятся PostgreSQL `BIGINT`, а API получает decimal strings и возвращает canonical integer strings. Отдельные NestJS-модули `accounts`, `categories` и `envelopes` реализуют controller → application service → scoped repository; существующий `budgets` модуль хранит settings и idempotent template action. Nuxt получает server-confirmed DTO через существующий cookie/CSRF API client, а foundation CSS и небольшие presentation components поддерживают адаптивные и доступные страницы.

**Технологический стек:** Node.js 24.20.0, pnpm 11.24.0, TypeScript strict, NestJS 11, Fastify 5, Prisma 6, PostgreSQL 18, Zod 4, Nuxt 4, Vue 3, Vitest и Playwright.

**Спецификация:** [docs/superpowers/specs/2026-09-02-stage-2-reference-data-and-accounts-design.md](../specs/2026-09-02-stage-2-reference-data-and-accounts-design.md), [docs/superpowers/specs/2026-09-02-ui-foundation-design.md](../specs/2026-09-02-ui-foundation-design.md)

## Глобальные ограничения

- Поведение продукта определяется [функциональным ТЗ](../specs/2026-08-30-family-budget-app-spec.md); технические решения — [спецификацией разработки](../specs/2026-08-30-family-budget-development-spec.md).
- Новая migration только additive; [первая Stage 1 migration](../../../prisma/migrations/20260831000000_init/migration.sql) не меняется.
- Для денег использовать только PostgreSQL `BIGINT` и TypeScript `bigint`; decimal strings конвертируются напрямую без `Number`, `parseFloat` или floating-point arithmetic.
- MVP использует только `RUB` и `scale = 2`; API monetary response всегда canonical integer string `^-?\d+$`.
- `currentBalanceMinor` не хранится: в Stage 2 он равен `startingBalanceMinor` в server response.
- Signed starting balance разрешён только при `budget.allowNegativeBalance === true`; planned/target amount всегда неотрицательны.
- Каждая user-data query фильтрует `budget_id` в SQL/Prisma query и проверяет authenticated user, active membership, active workspace, budget ownership, role, object state.
- Cross-budget ID substitution возвращает `404 RESOURCE_NOT_FOUND`; доступный EDITOR/VIEWER получает `403 FORBIDDEN` на mutation.
- Каждая create/update/archive/settings/template mutation и audit event выполняются в одной transaction. Audit использует allowlisted fields и не содержит full request payload, comments, last four digits, cookies, tokens, passwords или full payment data.
- Счета, категории и конверты не удаляются физически. Archive выставляет `archived_at`; повторный archive успешен и не меняет timestamp/audit повторно.
- Existing Stage 1 budgets не получают defaults из migration или обычного seed. Только OWNER action `POST /api/v1/budgets/{budgetId}/reference-template` создаёт отсутствующие defaults.
- Контроллеры не вызывают Prisma и не считают деньги. Shared packages остаются client-safe и не получают Prisma, SQL, secrets или repository rules.
- Все unsafe HTTP endpoints требуют существующие `OriginGuard`, `SessionAuthGuard` и `CsrfGuard`.
- User-facing copy, UI labels и documentation — русский; identifiers, database/API names и code — English.
- UI не хранит auth или financial tokens в `localStorage`, не делает optimistic balance calculation и показывает только server-confirmed balances.
- UI controls имеют минимум `44x44px`, visible two-tone focus, labels, field errors, keyboard support и non-color-only status. Compact breakpoint: `<768px`.
- Не добавлять transactions, allocations, transfers, cycle calculations, dashboard, worker jobs, plans, notifications, analytics, external integration, bank import, multi-currency conversion, credit/debt accounts, collaboration UI, AI, billing или deployment.
- Не изменять и не stage `identity/logo_description.png`.

---

## Карта файлов

### Database и backend common

- `prisma/schema.prisma` — Stage 2 enums, models, budget settings и Prisma relations.
- `prisma/migrations/20260902000000_stage_2_reference_data/migration.sql` — additive PostgreSQL DDL, checks, foreign keys, partial unique indexes и indexes.
- `apps/api/src/common/money/minor-units.ts` — strict decimal-string parser и canonical bigint formatter.
- `apps/api/src/common/money/minor-units.test.ts` — unit tests parser/formatter, including `BIGINT` boundaries.
- `apps/api/src/common/reference-data/reference-data.errors.ts` — safe domain exceptions for duplicate names, invalid state and invalid cross-reference.
- `apps/api/src/common/reference-data/reference-data.types.ts` — shared status/currency/scale input types used only by API modules.
- `apps/api/src/budgets/budget.repository.ts` — active access scope, settings view, settings update and template transaction methods.
- `apps/api/src/budgets/budget.application.service.ts` — settings business rules and template orchestration.
- `apps/api/src/budgets/budget.schemas.ts` — strict Zod budget settings/template schemas.
- `apps/api/src/budgets/budget.dto.ts` — Swagger request/response DTOs for expanded budget contract and template response.
- `apps/api/src/budgets/budget.controller.ts` — existing budget routes plus template endpoint.
- `apps/api/src/budgets/budget.module.ts` — dependencies needed by template/settings service.

### Reference-data API modules

- `apps/api/src/accounts/account.repository.ts` — account persistence with budget/member scope and audited transactions.
- `apps/api/src/accounts/account.application.service.ts` — account validation, authorization and view mapping.
- `apps/api/src/accounts/account.schemas.ts` — strict list/create/update schemas.
- `apps/api/src/accounts/account.dto.ts` — Swagger account list/request/response DTOs.
- `apps/api/src/accounts/account.controller.ts` — account HTTP routes.
- `apps/api/src/accounts/account.module.ts` — NestJS account module factories.
- `apps/api/src/accounts/account.application.service.test.ts` — account business-rule unit tests with repository doubles.
- `apps/api/src/categories/category.repository.ts` — category persistence, scoped parent lookups and audited transactions.
- `apps/api/src/categories/category.application.service.ts` — category parent/type/cycle rules and view mapping.
- `apps/api/src/categories/category.schemas.ts` — strict list/create/update schemas.
- `apps/api/src/categories/category.dto.ts` — Swagger category list/request/response DTOs.
- `apps/api/src/categories/category.controller.ts` — category HTTP routes.
- `apps/api/src/categories/category.module.ts` — NestJS category module factories.
- `apps/api/src/categories/category.application.service.test.ts` — category hierarchy and archive unit tests.
- `apps/api/src/envelopes/envelope.repository.ts` — envelope persistence with budget/member scope and audited transactions.
- `apps/api/src/envelopes/envelope.application.service.ts` — envelope rules and view mapping.
- `apps/api/src/envelopes/envelope.schemas.ts` — strict list/create/update schemas.
- `apps/api/src/envelopes/envelope.dto.ts` — Swagger envelope list/request/response DTOs.
- `apps/api/src/envelopes/envelope.controller.ts` — envelope HTTP routes.
- `apps/api/src/envelopes/envelope.module.ts` — NestJS envelope module factories.
- `apps/api/src/envelopes/envelope.application.service.test.ts` — envelope validation/archive unit tests.
- `apps/api/src/app.module.ts` — register accounts/categories/envelopes modules.
- `apps/api/test/reference-data.integration.test.ts` — real PostgreSQL API tests for all Stage 2 contracts, isolation, RBAC, audit and OpenAPI.

### Web foundation and data access

- `apps/web/public/fonts/inter-cyrillic-4.1.0.woff2` — checked-in, self-hosted Inter 4.1.0 variable WOFF2 containing Cyrillic glyphs and weights 400–700.
- `apps/web/app/assets/styles/tokens.css` — exact primitive, semantic and shared component tokens from UI foundation.
- `apps/web/app/assets/styles/base.css` — `@font-face`, reset, typography, focus and reduced-motion defaults.
- `apps/web/nuxt.config.ts` — global stylesheet registration.
- `apps/web/app/components/ui/Button.vue` — `UiButton`.
- `apps/web/app/components/ui/Input.vue` — `UiInput`.
- `apps/web/app/components/ui/Select.vue` — `UiSelect`.
- `apps/web/app/components/ui/Card.vue` — `UiCard`.
- `apps/web/app/components/ui/Status.vue` — `UiStatus`.
- `apps/web/app/components/ui/ConfirmDialog.vue` — `UiConfirmDialog` based on native `<dialog>`.
- `apps/web/app/components/ui/EmptyState.vue` — `UiEmptyState`.
- `apps/web/app/components/ui/*.test.ts` — focused primitive behavior/accessibility tests.
- `apps/web/app/components/finance/FinanceMoney.vue` — bigint-only server-money display.
- `apps/web/app/components/finance/FinanceMoneyInput.vue` — decimal-string field composition.
- `apps/web/app/components/finance/money-format.ts` — `formatMinorUnits` implementation without `Number`.
- `apps/web/app/components/finance/money-format.test.ts` — large/negative/zero money formatting tests.
- `apps/web/app/composables/useBudgetReferenceData.ts` — typed Stage 2 API DTOs and CRUD/template requests through `useApiClient`.
- `apps/web/app/composables/useReferenceDataForm.ts` — safe Problem Details field mapping and decimal-string form normalization.
- `apps/web/app/components/accounts/AccountCard.vue` — account presentation card.
- `apps/web/app/components/envelopes/EnvelopeCard.vue` — envelope presentation card.
- `apps/web/app/components/auth/AuthForm.vue` — existing auth UI migrated to foundation tokens without behavior changes.
- `apps/web/app/pages/app/index.vue` — existing protected landing page migrated to foundation tokens without auth-flow changes.

### Web routes and browser coverage

- `apps/web/app/pages/app/settings.vue` — budget settings form and template action.
- `apps/web/app/pages/app/accounts.vue` — accounts list/create/edit/archive UI.
- `apps/web/app/pages/app/categories.vue` — income/expense categories list/create/edit/archive UI.
- `apps/web/app/pages/app/envelopes.vue` — envelopes list/create/edit/archive UI.
- `apps/web/app/components/finance/*.test.ts` — money input/presentation unit tests.
- `apps/web/app/composables/useBudgetReferenceData.test.ts` — typed API path/payload and Problem Details mapping tests.
- `e2e/playwright.config.ts` — include existing auth and new Stage 2 browser specs.
- `e2e/reference-data.spec.ts` — owner desktop/compact settings, reference-data and accessibility flows.

---

### Задача 1: Добавить Stage 2 database contract и additive migration

**Файлы:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260902000000_stage_2_reference_data/migration.sql`
- Modify: `apps/api/test/workspace-budget.integration.test.ts`
- Create: `apps/api/test/reference-data.migration.integration.test.ts`

**Интерфейсы:**
- Produces Prisma enums `AccountType`, `CategoryType`, `EnvelopeType`.
- Produces models `Account`, `Category`, `Envelope` and expanded `Budget` relation fields.
- Produces columns `budgets.timezone`, `budgets.income_allocation_rule_enabled`, `budgets.income_allocation_source_category_id`, `budgets.income_allocation_target_envelope_id`.
- Produces database invariant: active name uniqueness applies only where `archived_at IS NULL`; `template_key` is unique only when non-null.

- [ ] **Шаг 1: Написать failing migration integration tests.**

Создать real-PostgreSQL test that inserts a Stage 1-shaped budget, applies migration through existing `pnpm db:migrate`, then asserts new defaults and constraints. Test partial uniqueness, `RUB`/scale checks, target date relation and same-budget composite references:

```ts
it('keeps existing Stage 1 budgets and adds Stage 2 defaults', async () => {
  const budget = await prisma.budget.create({
    data: { id: createUuidV7(), workspaceId, name: 'Существующий бюджет' },
  });

  const stored = await prisma.budget.findUniqueOrThrow({ where: { id: budget.id } });

  expect(stored).toMatchObject({
    timezone: 'Europe/Moscow',
    incomeAllocationRuleEnabled: false,
    incomeAllocationSourceCategoryId: null,
    incomeAllocationTargetEnvelopeId: null,
  });
  await expect(prisma.category.count({ where: { budgetId: budget.id } })).resolves.toBe(0);
  await expect(prisma.envelope.count({ where: { budgetId: budget.id } })).resolves.toBe(0);
});

it('enforces Stage 2 SQL constraints', async () => {
  await expect(
    prisma.account.create({
      data: { ...accountData, currency: 'USD', scale: 2 },
    }),
  ).rejects.toMatchObject({ code: 'P2004' });

  await expect(
    prisma.envelope.create({
      data: { ...envelopeData, targetDate: new Date('2026-12-31') },
    }),
  ).rejects.toMatchObject({ code: 'P2004' });
});
```

- [ ] **Шаг 2: Run migration test to verify it fails.**

Run:

```bash
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reference-data.migration.integration.test.ts
```

Expected: FAIL because Stage 2 Prisma fields, models and database constraints do not exist.

- [ ] **Шаг 3: Extend Prisma schema.**

Add exact enum and model shape. Use mapped snake_case names, UUID relations with `Restrict`, `TIMESTAMPTZ(3)`, `BIGINT` for all minor units and no `current_balance_minor` column:

```prisma
enum AccountType {
  BANK_ACCOUNT
  BANK_CARD
  CASH
}

enum CategoryType {
  INCOME
  EXPENSE
}

enum EnvelopeType {
  CURRENT_EXPENSES
  MANDATORY_EXPENSES
  SAVINGS_GOAL
  RESERVE
  FREE_MONEY
  CUSTOM
}

model Account {
  id                   String      @id @db.Uuid
  budgetId             String      @map("budget_id") @db.Uuid
  name                 String      @db.VarChar(120)
  accountType          AccountType @map("account_type")
  bankName             String?     @map("bank_name") @db.VarChar(120)
  lastFourDigits       String?     @map("last_four_digits") @db.Char(4)
  currency             String      @default("RUB") @db.Char(3)
  scale                Int         @default(2) @db.SmallInt
  startingBalanceMinor BigInt      @map("starting_balance_minor")
  accountingStartDate  DateTime    @map("accounting_start_date") @db.Date
  comment              String?     @db.VarChar(500)
  archivedAt           DateTime?   @map("archived_at") @db.Timestamptz(3)
  createdAt            DateTime    @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt            DateTime    @updatedAt @map("updated_at") @db.Timestamptz(3)

  budget Budget @relation(fields: [budgetId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([budgetId, archivedAt])
  @@map("accounts")
}
```

Add these exact models after `Account`:

```prisma
model Category {
  id           String       @id @db.Uuid
  budgetId     String       @map("budget_id") @db.Uuid
  templateKey  String?      @map("template_key") @db.VarChar(80)
  name         String       @db.VarChar(120)
  categoryType CategoryType @map("category_type")
  parentId     String?      @map("parent_id") @db.Uuid
  displayOrder Int          @map("display_order")
  comment      String?      @db.VarChar(500)
  archivedAt   DateTime?    @map("archived_at") @db.Timestamptz(3)
  createdAt    DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)

  budget   Budget     @relation(fields: [budgetId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  parent   Category?  @relation("CategoryParent", fields: [parentId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  children Category[] @relation("CategoryParent")

  @@unique([id, budgetId])
  @@index([budgetId, categoryType, archivedAt])
  @@map("categories")
}

model Envelope {
  id                        String       @id @db.Uuid
  budgetId                  String       @map("budget_id") @db.Uuid
  templateKey               String?      @map("template_key") @db.VarChar(80)
  name                      String       @db.VarChar(120)
  envelopeType              EnvelopeType @map("envelope_type")
  currency                  String       @default("RUB") @db.Char(3)
  scale                     Int          @default(2) @db.SmallInt
  startingBalanceMinor      BigInt       @map("starting_balance_minor")
  monthlyPlannedAmountMinor BigInt?      @map("monthly_planned_amount_minor")
  targetAmountMinor         BigInt?      @map("target_amount_minor")
  targetDate                DateTime?    @map("target_date") @db.Date
  displayOrder              Int          @map("display_order")
  comment                   String?      @db.VarChar(500)
  archivedAt                DateTime?    @map("archived_at") @db.Timestamptz(3)
  createdAt                 DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt                 DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)

  budget Budget @relation(fields: [budgetId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([id, budgetId])
  @@index([budgetId, archivedAt])
  @@map("envelopes")
}
```

Add the following fields to `Budget`, preserving all existing fields/relations:

```prisma
timezone                  String     @default("Europe/Moscow") @db.VarChar(64)
incomeAllocationRuleEnabled      Boolean    @default(false) @map("income_allocation_rule_enabled")
incomeAllocationSourceCategoryId String?    @map("income_allocation_source_category_id") @db.Uuid
incomeAllocationTargetEnvelopeId String?    @map("income_allocation_target_envelope_id") @db.Uuid
accounts                  Account[]
categories                Category[]
envelopes                 Envelope[]
```

`incomeAllocationSourceCategoryId` and `incomeAllocationTargetEnvelopeId` stay nullable scalar columns. PostgreSQL composite FKs are supplied by migration; do not add independent single-column foreign keys or Prisma relations for them.

- [ ] **Шаг 4: Write additive SQL migration.**

Create new migration with this DDL. It must create tables and add budget fields without touching prior migration:

```sql
CREATE TYPE "AccountType" AS ENUM ('BANK_ACCOUNT', 'BANK_CARD', 'CASH');
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "EnvelopeType" AS ENUM (
  'CURRENT_EXPENSES',
  'MANDATORY_EXPENSES',
  'SAVINGS_GOAL',
  'RESERVE',
  'FREE_MONEY',
  'CUSTOM'
);

ALTER TABLE "budgets"
  ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
  ADD COLUMN "income_allocation_rule_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "income_allocation_source_category_id" UUID,
  ADD COLUMN "income_allocation_target_envelope_id" UUID;

CREATE TABLE "accounts" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "account_type" "AccountType" NOT NULL,
  "bank_name" VARCHAR(120),
  "last_four_digits" CHAR(4),
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "scale" SMALLINT NOT NULL DEFAULT 2,
  "starting_balance_minor" BIGINT NOT NULL,
  "accounting_start_date" DATE NOT NULL,
  "comment" VARCHAR(500),
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounts_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accounts_currency_check" CHECK ("currency" = 'RUB'),
  CONSTRAINT "accounts_scale_check" CHECK ("scale" = 2),
  CONSTRAINT "accounts_last_four_digits_check"
    CHECK ("last_four_digits" IS NULL OR "last_four_digits" ~ '^[0-9]{4}$')
);

CREATE TABLE "categories" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "template_key" VARCHAR(80),
  "name" VARCHAR(120) NOT NULL,
  "category_type" "CategoryType" NOT NULL,
  "parent_id" UUID,
  "display_order" INTEGER NOT NULL,
  "comment" VARCHAR(500),
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "categories_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "categories_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "categories_parent_budget_fkey"
    FOREIGN KEY ("parent_id", "budget_id") REFERENCES "categories"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "categories_display_order_check" CHECK ("display_order" >= 0),
  CONSTRAINT "categories_parent_not_self_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

CREATE TABLE "envelopes" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "template_key" VARCHAR(80),
  "name" VARCHAR(120) NOT NULL,
  "envelope_type" "EnvelopeType" NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "scale" SMALLINT NOT NULL DEFAULT 2,
  "starting_balance_minor" BIGINT NOT NULL,
  "monthly_planned_amount_minor" BIGINT,
  "target_amount_minor" BIGINT,
  "target_date" DATE,
  "display_order" INTEGER NOT NULL,
  "comment" VARCHAR(500),
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "envelopes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "envelopes_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "envelopes_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "envelopes_currency_check" CHECK ("currency" = 'RUB'),
  CONSTRAINT "envelopes_scale_check" CHECK ("scale" = 2),
  CONSTRAINT "envelopes_display_order_check" CHECK ("display_order" >= 0),
  CONSTRAINT "envelopes_monthly_planned_non_negative_check"
    CHECK ("monthly_planned_amount_minor" IS NULL OR "monthly_planned_amount_minor" >= 0),
  CONSTRAINT "envelopes_target_amount_non_negative_check"
    CHECK ("target_amount_minor" IS NULL OR "target_amount_minor" >= 0),
  CONSTRAINT "envelopes_target_date_requires_amount_check"
    CHECK ("target_date" IS NULL OR "target_amount_minor" IS NOT NULL)
);

ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_income_allocation_source_category_budget_fkey"
    FOREIGN KEY ("income_allocation_source_category_id", "id")
    REFERENCES "categories"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "budgets_income_allocation_target_envelope_budget_fkey"
    FOREIGN KEY ("income_allocation_target_envelope_id", "id")
    REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "accounts_active_budget_name_key"
  ON "accounts" ("budget_id", lower("name")) WHERE "archived_at" IS NULL;
CREATE INDEX "accounts_budget_id_archived_at_idx"
  ON "accounts" ("budget_id", "archived_at");
CREATE UNIQUE INDEX "categories_active_budget_type_name_key"
  ON "categories" ("budget_id", "category_type", lower("name")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "categories_budget_template_key_key"
  ON "categories" ("budget_id", "template_key") WHERE "template_key" IS NOT NULL;
CREATE INDEX "categories_budget_type_archived_idx"
  ON "categories" ("budget_id", "category_type", "archived_at");
CREATE UNIQUE INDEX "envelopes_active_budget_name_key"
  ON "envelopes" ("budget_id", lower("name")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "envelopes_budget_template_key_key"
  ON "envelopes" ("budget_id", "template_key") WHERE "template_key" IS NOT NULL;
CREATE INDEX "envelopes_budget_id_archived_at_idx"
  ON "envelopes" ("budget_id", "archived_at");
```

Keep constraint and index names exactly as shown.

- [ ] **Шаг 5: Generate client and run migration integration tests.**

Run:

```bash
pnpm db:generate
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reference-data.migration.integration.test.ts
```

Expected: PASS. Existing-budget test finds no implicit reference data; check and partial-index tests fail at database boundary as specified.

- [ ] **Шаг 6: Commit database contract.**

```bash
git add prisma/schema.prisma prisma/migrations/20260902000000_stage_2_reference_data apps/api/test/reference-data.migration.integration.test.ts apps/api/test/workspace-budget.integration.test.ts
git diff --cached --check
git commit -m "feat: add reference data schema"
```

---

### Задача 2: Добавить exact decimal-to-minor-units boundary

**Файлы:**
- Create: `apps/api/src/common/money/minor-units.ts`
- Create: `apps/api/src/common/money/minor-units.test.ts`
- Create: `apps/api/src/common/reference-data/reference-data.errors.ts`
- Create: `apps/api/src/common/reference-data/reference-data.types.ts`

**Интерфейсы:**
- Produces `parseDecimalToMinorUnits(value: string, scale: number, allowNegative: boolean): bigint`.
- Produces `formatMinorUnits(value: bigint): string`.
- Produces `ensureNonNegativeMinorUnits(value: bigint, field: string): void`.
- Throws `BadRequestException` with `code: 'VALIDATION_FAILED'` and an individual field error for malformed decimal, too many fraction digits, prohibited sign or `BIGINT` overflow.

- [ ] **Шаг 1: Write failing unit tests for parser boundary.**

```ts
import { describe, expect, it } from 'vitest';

import { formatMinorUnits, parseDecimalToMinorUnits } from './minor-units.js';

describe('parseDecimalToMinorUnits', () => {
  it.each([
    ['0', false, 0n],
    ['12', false, 1200n],
    ['12.3', false, 1230n],
    ['12.30', false, 1230n],
    ['-12.30', true, -1230n],
    ['+12.30', false, 1230n],
  ])('parses %s without floating point', (input, allowNegative, expected) => {
    expect(parseDecimalToMinorUnits(input, 2, allowNegative)).toBe(expected);
  });

  it.each(['', ' ', '12,30', '01.20', '1.234', '--1', '1e3', '92233720368547758.08'])
    ('rejects invalid decimal %s', (input) => {
      expect(() => parseDecimalToMinorUnits(input, 2, true)).toThrow();
    });

  it('rejects a negative value when balance setting forbids it', () => {
    expect(() => parseDecimalToMinorUnits('-0.01', 2, false)).toThrow();
  });

  it('formats canonical bigint strings', () => {
    expect(formatMinorUnits(-9223372036854775808n)).toBe('-9223372036854775808');
  });
});
```

- [ ] **Шаг 2: Run unit test to verify it fails.**

Run:

```bash
pnpm --filter @harmofin/api test -- minor-units.test.ts
```

Expected: FAIL because module is absent.

- [ ] **Шаг 3: Implement parser with string and bigint operations only.**

Use ASCII decimal grammar `^[+-]?(0|[1-9]\d*)(?:\.\d+)?$`; reject leading zero forms other than exactly `0`. Pad fraction to requested scale, construct signed integer text, parse through `BigInt`, then compare against exact PostgreSQL limits. Do not normalize locale commas here.

```ts
const BIGINT_MIN = -9_223_372_036_854_775_808n;
const BIGINT_MAX = 9_223_372_036_854_775_807n;

export function parseDecimalToMinorUnits(
  value: string,
  scale: number,
  allowNegative: boolean,
): bigint {
  const match = /^([+-]?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) throw validationError('Некорректный денежный формат.');

  const [, sign, integerPart, fractionPart = ''] = match;
  if (fractionPart.length > scale) throw validationError('Допустимо не более двух знаков после запятой.');
  const digits = `${integerPart}${fractionPart.padEnd(scale, '0')}`;
  const parsed = BigInt(`${sign === '-' ? '-' : ''}${digits}`);
  if ((!allowNegative && parsed < 0n) || parsed < BIGINT_MIN || parsed > BIGINT_MAX) {
    throw validationError('Денежное значение недопустимо.');
  }
  return parsed;
}
```

Keep error field assignment in endpoint schema/service, not inside generic parser; helper throws a safe `BadRequestException` without a raw submitted value.

- [ ] **Шаг 4: Implement shared safe domain errors and API-only types.**

```ts
export type ReferenceDataStatus = 'active' | 'archived' | 'all';
export const REFERENCE_CURRENCY = 'RUB' as const;
export const REFERENCE_SCALE = 2 as const;

export function resourceNotFound(): NotFoundException {
  return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Ресурс не найден.' });
}

export function forbidden(): ForbiddenException {
  return new ForbiddenException({ code: 'FORBIDDEN', detail: 'Недостаточно прав для действия.' });
}
```

Define `duplicateName()` as `ConflictException` with `code: 'REFERENCE_NAME_CONFLICT'`, and `invalidReference()` as `BadRequestException` with `code: 'REFERENCE_INVALID'`. Details must be Russian and generic; no ID/value is interpolated.

- [ ] **Шаг 5: Run API unit suite.**

Run:

```bash
pnpm --filter @harmofin/api test
pnpm --filter @harmofin/api typecheck
```

Expected: PASS. Test suite demonstrates conversion of values above `Number.MAX_SAFE_INTEGER` without loss and no implementation uses `Number`/`parseFloat`.

- [ ] **Шаг 6: Commit money boundary.**

```bash
git add apps/api/src/common/money apps/api/src/common/reference-data
git diff --cached --check
git commit -m "feat: add safe monetary value parsing"
```

---

### Задача 3: Expand budget access scope and settings contract

**Файлы:**
- Modify: `apps/api/src/budgets/budget.repository.ts`
- Modify: `apps/api/src/budgets/budget.application.service.ts`
- Modify: `apps/api/src/budgets/budget.schemas.ts`
- Modify: `apps/api/src/budgets/budget.dto.ts`
- Modify: `apps/api/src/budgets/budget.controller.ts`
- Modify: `apps/api/src/budgets/budget.module.ts`
- Modify: `apps/api/test/workspace-budget.integration.test.ts`

**Интерфейсы:**
- Produces `BudgetView` with `timezone`, `incomeAllocationRuleEnabled`, `incomeAllocationSourceCategoryId`, `incomeAllocationTargetEnvelopeId`.
- Produces `UpdateBudgetInput` with optional `name`, `timezone`, `cycleStartDay`, `periodBoundaryOffset`, `allowNegativeBalance`, `incomeAllocationRuleEnabled`, `incomeAllocationSourceCategoryId`, `incomeAllocationTargetEnvelopeId`.
- Produces `BudgetApplicationService.update(userId, budgetId, input, requestId?): Promise<BudgetView>`.
- Existing budget list/create contracts remain compatible.

- [ ] **Шаг 1: Write failing API tests for settings and active-scope behavior.**

Add tests to existing integration fixture:

```ts
it('updates owner settings and records allowlisted audit fields', async () => {
  const response = await server.inject({
    method: 'PATCH',
    url: `/api/v1/budgets/${ownerBudgetId}`,
    headers: { origin, 'x-csrf-token': ownerCsrf },
    cookies: { harmofin_session: ownerCookie },
    payload: {
      timezone: 'Asia/Yekaterinburg',
      cycleStartDay: 5,
      periodBoundaryOffset: 14,
      allowNegativeBalance: true,
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ timezone: 'Asia/Yekaterinburg', allowNegativeBalance: true });
  const audit = await prisma.auditEvent.findFirst({
    where: { budgetId: ownerBudgetId, entityType: 'budget', action: 'UPDATED' },
  });
  expect(audit?.newValues).toMatchObject({
    allowNegativeBalance: true,
  });
});

it('does not permit mutation when budget or workspace is archived', async () => {
  await prisma.budget.update({ where: { id: ownerBudgetId }, data: { status: 'ARCHIVED' } });
  const response = await updateBudget({ name: 'Запрещено' });
  expect(response.statusCode).toBe(404);
});
```

Also test strict unknown field rejection, cycle ranges, invalid IANA timezone and EDITOR/VIEWER `403` on PATCH.

- [ ] **Шаг 2: Run focused integration test to verify it fails.**

```bash
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/workspace-budget.integration.test.ts
```

Expected: FAIL because settings fields are rejected/absent and archived budget can mutate through current query.

- [ ] **Шаг 3: Make all budget access queries active and expand DTO/select.**

Every Stage 2 read must require `workspace.status: 'ACTIVE'` plus active membership. Mutation lookup also requires `budget.status: 'ACTIVE'` and membership role `OWNER` inside transaction:

```ts
const activeAccessibleBudgetWhere = (userId: string, budgetId: string) => ({
  id: budgetId,
  status: 'ACTIVE' as const,
  workspace: {
    status: 'ACTIVE' as const,
    memberships: { some: { userId, isActive: true } },
  },
});

const budgetViewSelect = {
  id: true,
  workspaceId: true,
  name: true,
  primaryCurrency: true,
  timezone: true,
  cycleStartDay: true,
  periodBoundaryOffset: true,
  allowNegativeBalance: true,
  incomeAllocationRuleEnabled: true,
  incomeAllocationSourceCategoryId: true,
  incomeAllocationTargetEnvelopeId: true,
  status: true,
} as const;
```

Make `listForWorkspace` filter `workspace: { status: 'ACTIVE', memberships: { some: { userId, isActive: true } } }` and `status: 'ACTIVE'`; Stage 2 exposes neither archived budget mutations nor an archived-budget list mode.

- [ ] **Шаг 4: Add strict settings schema and application rules.**

Use `Intl.DateTimeFormat` construction to validate timezone string after Zod length validation. Merge partial input into current settings. If `incomeAllocationRuleEnabled` is true after merge, require both reference IDs, query source category and target envelope by `{ id, budgetId, archivedAt: null }`, and confirm source category type `INCOME`; if false, persist both reference IDs as `null`, even when patch contains IDs. Update and audit atomically.

```ts
export const updateBudgetSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    cycleStartDay: z.number().int().min(1).max(28).optional(),
    periodBoundaryOffset: z.number().int().min(1).max(27).optional(),
    allowNegativeBalance: z.boolean().optional(),
    incomeAllocationRuleEnabled: z.boolean().optional(),
    incomeAllocationSourceCategoryId: z.string().uuid().optional(),
    incomeAllocationTargetEnvelopeId: z.string().uuid().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });
```

Application service must obtain current full view before merge. If enabled after merging `input` into current settings, require both IDs; if disabled, clear them regardless of supplied IDs. Audit `oldValues`/`newValues` allowlist name, timezone, cycle values, negative setting, rule flag and reference IDs only.

- [ ] **Шаг 5: Document expanded OpenAPI contract and run focused tests.**

Add Swagger fields in `UpdateBudgetRequest` and `BudgetDetailResponse`; mark optional settings request fields `required: false`. Keep `@UseGuards(CsrfGuard)` on PATCH and declare 400/401/403/404 Problem Details responses.

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/workspace-budget.integration.test.ts
pnpm --filter @harmofin/api test
```

Expected: PASS. Active owner can save settings; archived or inaccessible budget reports `RESOURCE_NOT_FOUND`; accessible non-owner reports `FORBIDDEN`.

- [ ] **Шаг 6: Commit budget settings contract.**

```bash
git add apps/api/src/budgets apps/api/test/workspace-budget.integration.test.ts
git diff --cached --check
git commit -m "feat: add budget reference settings"
```

---

### Задача 4: Implement owner-only idempotent reference template

**Файлы:**
- Modify: `apps/api/src/budgets/budget.repository.ts`
- Modify: `apps/api/src/budgets/budget.application.service.ts`
- Modify: `apps/api/src/budgets/budget.schemas.ts`
- Modify: `apps/api/src/budgets/budget.dto.ts`
- Modify: `apps/api/src/budgets/budget.controller.ts`
- Modify: `apps/api/src/budgets/budget.module.ts`
- Modify: `apps/api/test/reference-data.integration.test.ts`

**Интерфейсы:**
- Produces `ReferenceTemplateResult { createdCategoryKeys: string[]; existingCategoryKeys: string[]; createdEnvelopeKeys: string[]; existingEnvelopeKeys: string[]; }`.
- Produces `BudgetApplicationService.initializeReferenceTemplate(userId, budgetId, requestId?): Promise<ReferenceTemplateResult>`.
- Produces `POST /api/v1/budgets/:budgetId/reference-template` returning `200`.

- [ ] **Шаг 1: Write failing integration tests for defaults, idempotency and archival.**

```ts
it('creates exact defaults and a safe template audit event', async () => {
  const response = await initializeTemplate(ownerBudgetId, ownerCookie, ownerCsrf);

  expect(response.statusCode).toBe(200);
  expect(await prisma.category.findMany({ where: { budgetId: ownerBudgetId }, orderBy: { displayOrder: 'asc' } }))
    .toHaveLength(39);
  expect(await prisma.category.findFirst({
    where: { budgetId: ownerBudgetId, name: 'Кэшбек', categoryType: 'INCOME' },
  })).not.toBeNull();
  expect(await prisma.category.findFirst({
    where: { budgetId: ownerBudgetId, name: 'Проценты от вкладов', categoryType: 'INCOME' },
  })).not.toBeNull();
  expect(await prisma.envelope.count({ where: { budgetId: ownerBudgetId } })).toBe(6);
  const audit = await prisma.auditEvent.findFirst({
    where: { budgetId: ownerBudgetId, action: 'REFERENCE_TEMPLATE_INITIALIZED' },
  });
  expect(audit?.newValues).toMatchObject({
    createdCategoryKeys: expect.arrayContaining(['income-cashback']),
  });
  expect(JSON.stringify(audit?.newValues)).not.toContain('comment');
});

it('never duplicates or resurrects manually archived defaults', async () => {
  await initializeTemplate(ownerBudgetId, ownerCookie, ownerCsrf);
  const repair = await prisma.envelope.findFirstOrThrow({ where: { budgetId: ownerBudgetId, templateKey: 'envelope-repair' } });
  await prisma.envelope.update({ where: { id: repair.id }, data: { archivedAt: new Date() } });

  const second = await initializeTemplate(ownerBudgetId, ownerCookie, ownerCsrf);
  expect(second.statusCode).toBe(200);
  expect(await prisma.envelope.count({ where: { budgetId: ownerBudgetId, templateKey: 'envelope-repair' } })).toBe(1);
  expect((await prisma.envelope.findUniqueOrThrow({ where: { id: repair.id } })).archivedAt).not.toBeNull();
});
```

Include tests for non-owner `403`, foreign budget `404`, and one transaction rollback if one template insert is forced to fail.

- [ ] **Шаг 2: Run focused integration test to verify it fails.**

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reference-data.integration.test.ts
```

Expected: FAIL because endpoint and template persistence are absent.

- [ ] **Шаг 3: Define immutable default records and implement transaction.**

Store defaults as local immutable constants, never from request body. Use stable ASCII template keys and display order starting at zero. Include these income records exactly:

```ts
const DEFAULT_INCOME_CATEGORIES = [
  ['income-salary', 'Зарплата'],
  ['income-shabashka', 'Шабашка'],
  ['income-other', 'Прочий доход'],
  ['income-cashback', 'Кэшбек'],
  ['income-deposit-interest', 'Проценты от вкладов'],
] as const;

const DEFAULT_ENVELOPES = [
  ['envelope-current-10-24', 'Текущие 10–24', 'CURRENT_EXPENSES'],
  ['envelope-current-25-9', 'Текущие 25–9', 'CURRENT_EXPENSES'],
  ['envelope-mandatory', 'Обязательные', 'MANDATORY_EXPENSES'],
  ['envelope-repair', 'Ремонт', 'SAVINGS_GOAL'],
  ['envelope-car', 'Автомобиль', 'SAVINGS_GOAL'],
  ['envelope-free', 'Свободные', 'FREE_MONEY'],
] as const;
```

Define all 34 approved expense records in one immutable constant, with these exact stable keys and Russian values:

```ts
const DEFAULT_EXPENSE_CATEGORIES = [
  ['expense-wife', 'Жена'],
  ['expense-groceries', 'Продукты'],
  ['expense-mortgage', 'Ипотека'],
  ['expense-fuel', 'Бензин'],
  ['expense-activities', 'Секции и кружки'],
  ['expense-leisure', 'Досуг'],
  ['expense-car-service', 'Автосервис'],
  ['expense-cafes', 'Кафе и рестораны'],
  ['expense-household', 'Хозтовары'],
  ['expense-clothes', 'Одежда'],
  ['expense-subscriptions', 'Подписки'],
  ['expense-utilities', 'Коммуналка'],
  ['expense-pharmacy', 'Аптека'],
  ['expense-fast-food', 'Фастфуд'],
  ['expense-sport', 'Спорт и фитнес'],
  ['expense-kindergarten', 'Детский сад'],
  ['expense-clinic', 'Клиника'],
  ['expense-repair', 'Ремонт'],
  ['expense-children-leisure', 'Досуг детей'],
  ['expense-beauty', 'Красота'],
  ['expense-taxi', 'Такси'],
  ['expense-gifts', 'Подарки'],
  ['expense-internet', 'Интернет'],
  ['expense-electronics', 'Электроника'],
  ['expense-mobile', 'Мобильная связь'],
  ['expense-alcohol', 'Алкоголь'],
  ['expense-parking', 'Парковка'],
  ['expense-insurance', 'Страховка'],
  ['expense-education', 'Образование'],
  ['expense-travel', 'Путешествия'],
  ['expense-home-repair', 'Ремонт/жилье'],
  ['expense-bank-fees', 'Банковские комиссии'],
  ['expense-taxes', 'Налоги'],
  ['expense-other', 'Прочее'],
] as const;

Inside one `prisma.$transaction`, find active owner-scoped budget; query all existing `templateKey`s including archived rows; `createMany` only keys absent from DB; never update/restore an existing key. Template initialization never changes generic income-allocation rule configuration and never allocates money. Create one `REFERENCE_TEMPLATE_INITIALIZED` audit event listing only sorted created/existing template key arrays.

- [ ] **Шаг 4: Expose guarded route and Swagger response.**

```ts
@Post('budgets/:budgetId/reference-template')
@UseGuards(CsrfGuard)
@ApiOkResponse({ type: ReferenceTemplateResponse })
@ApiResponse({ status: 401, type: ProblemDetailsResponse })
@ApiResponse({ status: 403, type: ProblemDetailsResponse })
@ApiResponse({ status: 404, type: ProblemDetailsResponse })
initializeReferenceTemplate(@Param('budgetId') budgetId: string, @Req() request: AuthenticatedRequest) {
  return this.service.initializeReferenceTemplate(contextOf(request).userId, budgetId, request.id);
}
```

`ReferenceTemplateResponse` exposes only four key arrays. No input body exists, so do not add `@ApiBody`.

- [ ] **Шаг 5: Run test suite and inspect transaction/audit result.**

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reference-data.integration.test.ts
pnpm --filter @harmofin/api typecheck
```

Expected: PASS. Second call has no duplicate rows; archived default remains archived; audit contains keys, never financial/comment/card payload.

- [ ] **Шаг 6: Commit template action.**

```bash
git add apps/api/src/budgets apps/api/test/reference-data.integration.test.ts
git diff --cached --check
git commit -m "feat: add reference template initialization"
```

---

### Задача 5: Implement accounts API and server-confirmed Stage 2 balance

**Файлы:**
- Create: `apps/api/src/accounts/account.repository.ts`
- Create: `apps/api/src/accounts/account.application.service.ts`
- Create: `apps/api/src/accounts/account.schemas.ts`
- Create: `apps/api/src/accounts/account.dto.ts`
- Create: `apps/api/src/accounts/account.controller.ts`
- Create: `apps/api/src/accounts/account.module.ts`
- Create: `apps/api/src/accounts/account.application.service.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/reference-data.integration.test.ts`

**Интерфейсы:**
- Produces `AccountView`:

```ts
export interface AccountView {
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
```

- Produces list/create/get/update/archive routes under `/api/v1/budgets/:budgetId/accounts`.

- [ ] **Шаг 1: Write failing account service tests.**

Use a repository double and parser real implementation:

```ts
it('uses signed starting balance only when settings allow it', async () => {
  repository.findAccessibleWithRole.mockResolvedValue(ownerBudget({ allowNegativeBalance: false }));
  await expect(
    service.create(ownerId, budgetId, accountInput({ startingBalance: '-1.00' })),
  ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VALIDATION_FAILED' }) });

  repository.findAccessibleWithRole.mockResolvedValue(ownerBudget({ allowNegativeBalance: true }));
  await service.create(ownerId, budgetId, accountInput({ startingBalance: '-1.00' }));
  expect(repository.create).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ startingBalanceMinor: -100n }),
    undefined,
  );
});

it('maps current balance from server starting balance', async () => {
  expect(service.toView(account({ startingBalanceMinor: 9007199254740993n }))).toMatchObject({
    startingBalanceMinor: '9007199254740993',
    currentBalanceMinor: '9007199254740993',
  });
});
```

- [ ] **Шаг 2: Run account unit test to verify it fails.**

```bash
pnpm --filter @harmofin/api test -- account.application.service.test.ts
```

Expected: FAIL because accounts module is absent.

- [ ] **Шаг 3: Implement strict account transport schemas and Swagger DTOs.**

Create schema accepts decimal strings, not numeric money values:

```ts
const accountFields = {
  name: z.string().trim().min(1).max(120),
  accountType: z.enum(['BANK_ACCOUNT', 'BANK_CARD', 'CASH']),
  bankName: z.string().trim().min(1).max(120).nullable().optional(),
  lastFourDigits: z.string().regex(/^\d{4}$/).nullable().optional(),
  currency: z.literal('RUB'),
  startingBalance: z.string().min(1).max(64),
  accountingStartDate: z.string().date(),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
};
export const createAccountSchema = z.object(accountFields).strict();
export const listAccountsSchema = z.object({ status: z.enum(['active', 'archived', 'all']).default('active') }).strict();
```

Update schema has optional editable fields but never `currency`, `scale`, `archivedAt`, `currentBalanceMinor`, `budgetId` or `id`; refine requires one property. DTO marks `startingBalance` as decimal string request and both response balance fields as string pattern `^-?\\d+$`.

- [ ] **Шаг 4: Implement repository transaction and application service.**

Repository list/get scopes user access in database query:

```ts
where: {
  id: accountId,
  budgetId,
  budget: {
    status: 'ACTIVE',
    workspace: {
      status: 'ACTIVE',
      memberships: { some: { userId, isActive: true } },
    },
  },
}
```

`list` adds selected archive status in same `where`. Create/update/archive use `prisma.$transaction`; mutation lookup includes `role: 'OWNER'`, active budget/workspace and `archivedAt: null` for update. Archive lookup omits `archivedAt`, returns already archived view without a new audit event, otherwise updates timestamp and writes `ARCHIVED` audit. Catch only Prisma unique-constraint conflict for active name and translate it to `REFERENCE_NAME_CONFLICT`.

Application service checks owner role before mutation, parses `startingBalance` using current budget setting, and calls repository. It maps database `bigint` to strings with `formatMinorUnits`; it does not return `BigInt` through Fastify JSON. Audit allowlist includes name, account type, bank name, currency, scale, starting balance, accounting start date and archive timestamp; excludes `lastFourDigits`, comment and full request.

- [ ] **Шаг 5: Implement guarded controller/module and API integration tests.**

Use existing controller conventions. GET routes use `SessionAuthGuard`; POST/PATCH/archive add `CsrfGuard`.

```ts
@Post('budgets/:budgetId/accounts/:accountId/archive')
@UseGuards(CsrfGuard)
@ApiOkResponse({ type: AccountResponse })
archive(
  @Param('budgetId') budgetId: string,
  @Param('accountId') accountId: string,
  @Req() request: AuthenticatedRequest,
) {
  return this.service.archive(contextOf(request).userId, budgetId, accountId, request.id);
}
```

Integration tests must cover create/list/get/update/archive, `status=active|archived|all`, 4-digit validation, signed amount setting, canonical balances, idempotent archive, active-name uniqueness/reuse after archive, cross-budget `404`, editor/viewer `403`, no-Origin rejection, invalid CSRF rejection, audit allowlist and OpenAPI schemas.

- [ ] **Шаг 6: Run focused tests and commit accounts.**

```bash
pnpm --filter @harmofin/api test -- account.application.service.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reference-data.integration.test.ts
pnpm --filter @harmofin/api typecheck
git add apps/api/src/accounts apps/api/src/app.module.ts apps/api/test/reference-data.integration.test.ts
git diff --cached --check
git commit -m "feat: add budget accounts"
```

Expected: PASS. Account balances round-trip as canonical strings, no client number conversion, and all entity reads stay budget scoped.

---

### Задача 6: Implement categories API with safe parent hierarchy

**Файлы:**
- Create: `apps/api/src/categories/category.repository.ts`
- Create: `apps/api/src/categories/category.application.service.ts`
- Create: `apps/api/src/categories/category.schemas.ts`
- Create: `apps/api/src/categories/category.dto.ts`
- Create: `apps/api/src/categories/category.controller.ts`
- Create: `apps/api/src/categories/category.module.ts`
- Create: `apps/api/src/categories/category.application.service.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/reference-data.integration.test.ts`

**Интерфейсы:**
- Produces `CategoryView { id; budgetId; templateKey; name; categoryType; parentId; displayOrder; comment; archivedAt; }` with nullable fields serialized as `null`.
- Produces `GET /categories?type=INCOME|EXPENSE&status=active|archived|all`, create/get/update/archive endpoints.
- `parentId` is optional on create/update and only references active same-budget category of identical type.

- [ ] **Шаг 1: Write failing category hierarchy unit tests.**

```ts
it('rejects a parent from another budget or type', async () => {
  repository.findParent.mockResolvedValue(category({ budgetId: otherBudgetId, categoryType: 'INCOME' }));
  await expect(service.create(ownerId, budgetId, categoryInput({ parentId: parentId }))).rejects.toMatchObject({
    response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
  });

  repository.findParent.mockResolvedValue(category({ budgetId, categoryType: 'EXPENSE' }));
  await expect(service.create(ownerId, budgetId, categoryInput({ parentId: parentId }))).rejects.toThrow();
});

it('rejects self-reference and a descendant cycle', async () => {
  repository.findAncestorIds.mockResolvedValue([childId, rootId]);
  await expect(service.update(ownerId, budgetId, rootId, { parentId: childId })).rejects.toThrow();
});

it('rejects archived parent', async () => {
  repository.findParent.mockResolvedValue(category({ budgetId, archivedAt: new Date() }));
  await expect(service.create(ownerId, budgetId, categoryInput({ parentId }))).rejects.toThrow();
});
```

- [ ] **Шаг 2: Run category unit test to verify it fails.**

```bash
pnpm --filter @harmofin/api test -- category.application.service.test.ts
```

Expected: FAIL because categories module is absent.

- [ ] **Шаг 3: Add strict schemas and DTOs.**

```ts
export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  categoryType: z.enum(['INCOME', 'EXPENSE']),
  parentId: z.string().uuid().nullable().optional(),
  displayOrder: z.number().int().min(0).max(1_000_000),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
}).strict();

export const listCategoriesSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
}).strict();
```

Do not accept `templateKey` in API mutations: template keys are immutable internal records. Update does not accept `categoryType`; preserving category type avoids invalid existing hierarchy transitions.

- [ ] **Шаг 4: Implement scoped parent traversal and audited persistence.**

Repository `findParent` filters `id`, `budgetId`, `archivedAt: null` and returns `categoryType`; it must never load parent by ID alone. `findAncestorIds` follows `parentId` by repeated scoped query and returns at most number of rows in current budget plus one; service rejects when proposed parent equals category ID or ancestor list contains category ID. This defensive bound prevents malformed old data from creating infinite loop.

Create/update/archive transactions must query category with `{ id: categoryId, budgetId, budget: { status: 'ACTIVE', workspace: { status: 'ACTIVE', memberships: { some: { userId, isActive: true, role: 'OWNER' } } } } }`. On archive, reject when an active child has `parentId = category.id` with `REFERENCE_INVALID`, rather than silently orphaning current hierarchy. List is readable by any active member and scopes both `budgetId` and membership in one query. Audit allowlist contains name, type, parent ID, display order and archive timestamp; it excludes comment.

- [ ] **Шаг 5: Add controller/module and integration contract tests.**

Controller exposes query parsed by `ZodValidationPipe(listCategoriesSchema)`. Add tests for default template income/expense totals and filters, create/update/read/archive, active name uniqueness by `(budget,type)`, same name allowed across types, reuse after archive, invalid parent rules, active-child archive rejection, foreign ID `404`, owner/editor/viewer matrix, CSRF/Origin, audit, Problem Details and OpenAPI.

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reference-data.integration.test.ts
```

Expected: PASS. Parent lookup never accepts forged/cross-budget/archived category and no API endpoint exposes a physical delete.

- [ ] **Шаг 6: Commit categories.**

```bash
git add apps/api/src/categories apps/api/src/app.module.ts apps/api/test/reference-data.integration.test.ts
git diff --cached --check
git commit -m "feat: add budget categories"
```

---

### Задача 7: Implement envelopes API and target constraints

**Файлы:**
- Create: `apps/api/src/envelopes/envelope.repository.ts`
- Create: `apps/api/src/envelopes/envelope.application.service.ts`
- Create: `apps/api/src/envelopes/envelope.schemas.ts`
- Create: `apps/api/src/envelopes/envelope.dto.ts`
- Create: `apps/api/src/envelopes/envelope.controller.ts`
- Create: `apps/api/src/envelopes/envelope.module.ts`
- Create: `apps/api/src/envelopes/envelope.application.service.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/reference-data.integration.test.ts`

**Интерфейсы:**
- Produces `EnvelopeView` with `startingBalanceMinor`, `currentBalanceMinor`, `monthlyPlannedAmountMinor`, `targetAmountMinor` as integer strings or `null`; all money is server-confirmed.
- Produces list/create/get/update/archive endpoints under `/api/v1/budgets/:budgetId/envelopes`.

- [ ] **Шаг 1: Write failing envelope rule unit tests.**

```ts
it('rejects negative planned and target values', async () => {
  await expect(service.create(ownerId, budgetId, envelopeInput({ monthlyPlannedAmount: '-0.01' }))).rejects.toThrow();
  await expect(service.create(ownerId, budgetId, envelopeInput({ targetAmount: '-1.00' }))).rejects.toThrow();
});

it('requires target amount when target date exists', async () => {
  await expect(service.create(ownerId, budgetId, envelopeInput({ targetDate: '2026-12-31' }))).rejects.toThrow();
});

it('formats stage 2 balances from bigint values', async () => {
  repository.create.mockResolvedValue(envelope({ startingBalanceMinor: -1n }));
  const view = await service.create(ownerId, budgetId, envelopeInput({ startingBalance: '-0.01' }));
  expect(view).toMatchObject({ startingBalanceMinor: '-1', currentBalanceMinor: '-1' });
});
```

- [ ] **Шаг 2: Run envelope unit test to verify it fails.**

```bash
pnpm --filter @harmofin/api test -- envelope.application.service.test.ts
```

Expected: FAIL because envelopes module is absent.

- [ ] **Шаг 3: Implement strict money-string schema and response DTO.**

```ts
export const createEnvelopeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  envelopeType: z.enum([
    'CURRENT_EXPENSES', 'MANDATORY_EXPENSES', 'SAVINGS_GOAL', 'RESERVE', 'FREE_MONEY', 'CUSTOM',
  ]),
  currency: z.literal('RUB'),
  startingBalance: z.string().min(1).max(64),
  monthlyPlannedAmount: z.string().min(1).max(64).nullable().optional(),
  targetAmount: z.string().min(1).max(64).nullable().optional(),
  targetDate: z.string().date().nullable().optional(),
  displayOrder: z.number().int().min(0).max(1_000_000),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
}).strict();
```

Update schema accepts optional `name`, `envelopeType`, `startingBalance`, `monthlyPlannedAmount`, `targetAmount`, `targetDate`, `displayOrder` and `comment`, then requires at least one. It never accepts `currency`, `scale`, `templateKey`, `archivedAt`, `currentBalanceMinor`, `budgetId` or `id`. Dates serialize as `YYYY-MM-DD`; money response fields serialize through bigint formatter, never `Number`.

- [ ] **Шаг 4: Implement validation, scoped repository and audit.**

Service reads active owner budget before parsing signed starting balance. It passes `allowNegativeBalance` only to starting balance parser; planned/target parser always uses `false`. It rejects target date when merged target amount is null. It accepts target amount without date.

Repository list/get scopes reads with `{ budgetId, budget: { status: 'ACTIVE', workspace: { status: 'ACTIVE', memberships: { some: { userId, isActive: true } } } } }`; mutation transaction lookup additionally requires `role: 'OWNER'` and `archivedAt: null` for update. Archive lookup omits `archivedAt`, returns existing archived view without new audit event, otherwise writes timestamp and audit. Default template keys remain immutable because public schemas omit them. Audit allowlist includes name, type, currency, scale, all monetary bigint values as canonical strings, target date, display order and archive timestamp; excludes comment. `currentBalanceMinor` is response-only and never persisted/audited as an independent field.

- [ ] **Шаг 5: Add guarded routes/module and integration tests.**

Test all envelope types, decimal/negative rules, target relationship, 6 defaults, balance equality, archive/list states, active-name collision/reuse, forged budget/envelope IDs, owner/editor/viewer roles, Origin/CSRF, audit allowlist, Problem Details and OpenAPI.

```bash
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reference-data.integration.test.ts
pnpm --filter @harmofin/api typecheck
```

Expected: PASS. No totals, target progress, allocation or other financial operation exists.

- [ ] **Шаг 6: Commit envelopes.**

```bash
git add apps/api/src/envelopes apps/api/src/app.module.ts apps/api/test/reference-data.integration.test.ts
git diff --cached --check
git commit -m "feat: add budget envelopes"
```

---

### Задача 8: Complete backend contract verification and seed boundary

**Файлы:**
- Modify: `apps/api/test/reference-data.integration.test.ts`
- Modify: `apps/api/src/database/seed.ts`
- Modify: `apps/api/src/database/seed.test.ts`
- Modify: `README.md` only if a new verified command is needed; otherwise do not modify.

**Интерфейсы:**
- Produces comprehensive Stage 2 API integration coverage while preserving existing safe demo seed behavior.
- Seed continues to create only Stage 1 demo data for existing budget and never invokes template action implicitly.

- [ ] **Шаг 1: Write failing regression test for seed non-interference.**

```ts
it('does not create Stage 2 defaults for an existing demo budget', async () => {
  await runSeed(validSeedEnvironment);
  const budget = await prisma.budget.findUniqueOrThrow({ where: { id: demo.budgetId } });

  expect(await prisma.category.count({ where: { budgetId: budget.id } })).toBe(0);
  expect(await prisma.envelope.count({ where: { budgetId: budget.id } })).toBe(0);
});
```

Also add one integration assertion that OpenAPI documents all exact Stage 2 paths, request body refs, cookie security, success response schemas and Problem Details error response codes.

- [ ] **Шаг 2: Run tests to verify current fixture assumptions.**

```bash
pnpm --filter @harmofin/api test -- seed.test.ts
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reference-data.integration.test.ts
```

Expected: seed test initially fails only if implementation accidentally starts invoking the template; otherwise add it and confirm it passes before refactoring test setup.

- [ ] **Шаг 3: Preserve explicit initialization semantics.**

Keep seed’s single transaction, production guard, Argon2id test password behavior and existing audit event. Do not import template constants or call application services from seed. If Prisma relation cleanup or typed select needs adjustment after schema expansion, make only that compile-safe change.

```ts
if (input.NODE_ENV === 'production') {
  throw new Error('Seed cannot run in production.');
}
```

Do not log or assert raw seed password, session token or complete financial payload.

- [ ] **Шаг 4: Run backend quality gates and commit.**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
git add apps/api/test/reference-data.integration.test.ts apps/api/src/database/seed.ts apps/api/src/database/seed.test.ts
git diff --cached --check
git commit -m "test: cover reference data API contracts"
```

Expected: PASS. Existing budget creation and demo seed remain non-invasive; integration tests explicitly call template endpoint.

---

### Задача 9: Add UI foundation assets, tokens and tested primitives

**Файлы:**
- Create: `apps/web/public/fonts/inter-cyrillic-4.1.0.woff2`
- Create: `apps/web/app/assets/styles/tokens.css`
- Create: `apps/web/app/assets/styles/base.css`
- Modify: `apps/web/nuxt.config.ts`
- Create: `apps/web/app/components/ui/Button.vue`
- Create: `apps/web/app/components/ui/Input.vue`
- Create: `apps/web/app/components/ui/Select.vue`
- Create: `apps/web/app/components/ui/Card.vue`
- Create: `apps/web/app/components/ui/Status.vue`
- Create: `apps/web/app/components/ui/ConfirmDialog.vue`
- Create: `apps/web/app/components/ui/EmptyState.vue`
- Create: `apps/web/app/components/ui/Button.test.ts`
- Create: `apps/web/app/components/ui/Input.test.ts`
- Create: `apps/web/app/components/ui/ConfirmDialog.test.ts`

**Интерфейсы:**
- Produces Nuxt auto-imported `UiButton`, `UiInput`, `UiSelect`, `UiCard`, `UiStatus`, `UiConfirmDialog`, `UiEmptyState` contracts defined by UI foundation.
- Produces only local WOFF2 font loading; no remote runtime font request.

- [ ] **Шаг 1: Add failing component tests.**

```ts
it('connects label, hint and field error without replacing visible label', async () => {
  const wrapper = mount(UiInput, {
    props: { modelValue: '', name: 'name', label: 'Название', hint: 'До 120 символов', error: 'Заполните поле' },
  });
  const input = wrapper.get('input');

  expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
  expect(input.attributes('aria-invalid')).toBe('true');
  expect(input.attributes('aria-describedby')).toContain('name-hint');
  expect(input.attributes('aria-describedby')).toContain('name-error');
});

it('does not emit confirmation more than once while pending', async () => {
  const wrapper = mount(UiConfirmDialog, { props: confirmProps({ loading: true }) });
  await wrapper.get('button[data-confirm]').trigger('click');
  expect(wrapper.emitted('confirm')).toBeUndefined();
});
```

Test native button type/default/disabled, `update:modelValue`, native select placeholder, `UiStatus` Russian text slot and dialog Escape/return-focus behavior in happy-dom with explicit mock methods where platform dialog APIs are missing.

- [ ] **Шаг 2: Run web unit tests to verify they fail.**

```bash
pnpm --filter @harmofin/web test -- app/components/ui
```

Expected: FAIL because primitives and styles are absent.

- [ ] **Шаг 3: Add versioned local Inter and global styles.**

Check in Inter 4.1.0 variable WOFF2 asset under listed filename; it must include Cyrillic glyphs and be served by Nuxt locally. Register assets in Nuxt:

```ts
export default defineNuxtConfig({
  css: ['~/app/assets/styles/tokens.css', '~/app/assets/styles/base.css'],
  // existing config remains unchanged
});
```

`base.css` supplies `@font-face` with `font-family: 'Inter'`, `font-weight: 400 700`, `font-style: normal`, `font-display: swap`, and `src: url('/fonts/inter-cyrillic-4.1.0.woff2') format('woff2')`. Copy exact colors, font weights, spacing, radii, shadows, motion and semantic aliases from UI foundation into `tokens.css`; it is sole location containing concrete palette hex values. `base.css` applies `box-sizing`, body `16px/1.5`, token family, canvas colors, visible two-tone `:focus-visible`, and `prefers-reduced-motion` handling.

- [ ] **Шаг 4: Implement minimal reusable primitives.**

`UiButton` emits native click, preserves `type`, applies `aria-busy` when loading and blocks duplicate click. `UiInput`/`UiSelect` generate SSR-safe IDs from supplied `id` or deterministic `name` suffixes and use native controls. `UiCard` only renders semantic wrapper/slots. `UiStatus` always renders text. `UiConfirmDialog` uses controlled native `<dialog>`, initial focus to cancel/confirm, Escape handling, `showModal()`, `close()`, focus return to trigger and no closing while `loading`.

```vue
<button
  :type="type"
  :disabled="disabled || loading"
  :aria-busy="loading || undefined"
  class="ui-button"
  :class="[`ui-button--${variant}`, `ui-button--${size}`, { 'ui-button--full': fullWidth }]"
  @click="$emit('click', $event)"
>
  <span v-if="loading">Сохранение…</span>
  <slot v-else />
</button>
```

Use semantic/component tokens only; no direct hex in Vue styles. Each interactive control has min size `44px`.

- [ ] **Шаг 5: Run style/component checks.**

```bash
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web build
```

Expected: PASS. Build output contains local font asset and no remote font CSS request.

- [ ] **Шаг 6: Commit UI foundation slice.**

```bash
git add apps/web/public/fonts/inter-cyrillic-4.1.0.woff2 apps/web/app/assets/styles apps/web/app/components/ui apps/web/nuxt.config.ts
git diff --cached --check
git commit -m "feat: add web UI foundation"
```

---

### Задача 10: Add bigint-safe web money presentation and reference-data API composables

**Файлы:**
- Create: `apps/web/app/components/finance/money-format.ts`
- Create: `apps/web/app/components/finance/money-format.test.ts`
- Create: `apps/web/app/components/finance/FinanceMoney.vue`
- Create: `apps/web/app/components/finance/FinanceMoneyInput.vue`
- Create: `apps/web/app/components/accounts/AccountCard.vue`
- Create: `apps/web/app/components/envelopes/EnvelopeCard.vue`
- Create: `apps/web/app/composables/useBudgetReferenceData.ts`
- Create: `apps/web/app/composables/useBudgetReferenceData.test.ts`
- Create: `apps/web/app/composables/useReferenceDataForm.ts`

**Интерфейсы:**
- Produces `formatMinorUnits(minorUnits: string | bigint, currency: string, scale: number, locale?: string): string`.
- Produces typed `BudgetDto`, `AccountDto`, `CategoryDto`, `EnvelopeDto` and `useBudgetReferenceData()` endpoint methods.
- Form models retain money as decimal strings until API request.

- [ ] **Шаг 1: Write failing bigint formatting and API path tests.**

```ts
it('formats bigint above Number.MAX_SAFE_INTEGER without Number conversion', () => {
  expect(formatMinorUnits('9007199254740993', 'RUB', 2)).toContain('90');
  expect(formatMinorUnits('-1', 'RUB', 2)).toContain('-');
  expect(formatMinorUnits('0', 'RUB', 2)).toContain('0');
});

it('sends account decimal string unchanged to API client', async () => {
  const request = vi.fn().mockResolvedValue(accountDto);
  const data = createBudgetReferenceData({ request } as never);
  await data.createAccount('budget-id', { ...accountForm, startingBalance: '123.45' });
  expect(request).toHaveBeenCalledWith('/api/v1/budgets/budget-id/accounts', {
    method: 'POST',
    body: JSON.stringify(expect.objectContaining({ startingBalance: '123.45' })),
  });
});
```

Also test safe generic user error mapping: an unknown raw API detail maps to `Не удалось выполнить действие. Повторите попытку.`, while known field error maps to matching known form field.

- [ ] **Шаг 2: Run tests to verify they fail.**

```bash
pnpm --filter @harmofin/web test -- money-format useBudgetReferenceData
```

Expected: FAIL because components/composables do not exist.

- [ ] **Шаг 3: Implement presentation-only money formatter.**

Validate `/^-?\d+$/`, then split `BigInt` magnitude into integer/fraction with `10n ** BigInt(scale)`. Use `Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: scale, maximumFractionDigits: scale }).formatToParts(0)` solely for separators and currency placement, replacing numeric parts with bigint-derived strings. Never pass actual money to `Intl.NumberFormat` as a number.

```ts
export function formatMinorUnits(
  minorUnits: string | bigint,
  currency: string,
  scale: number,
  locale = 'ru-RU',
): string {
  if (!/^-?\d+$/.test(String(minorUnits))) {
    throw new TypeError('minorUnits must be an integer string or bigint');
  }

  const value = typeof minorUnits === 'bigint' ? minorUnits : BigInt(minorUnits);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const integer = (magnitude / divisor).toString();
  const fraction = (magnitude % divisor).toString().padStart(scale, '0');
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const group = formatter.formatToParts(1000).find((part) => part.type === 'group')?.value ?? ' ';
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);

  return formatter.formatToParts(negative ? -0 : 0).map((part) => {
    if (part.type === 'integer') return groupedInteger;
    if (part.type === 'fraction') return fraction;
    return part.value;
  }).join('');
}
```

`FinanceMoney` displays `—` for invalid prop in production and does not expose supplied value in diagnostic. `FinanceMoneyInput` delegates text semantics to `UiInput`, applies `inputmode="decimal"`, never parses/rounds/mutates decimal string.

- [ ] **Шаг 4: Implement typed endpoint facade and cards.**

All client methods call existing `useApiClient().request`, so cookie/Origin/memory-CSRF behavior remains unchanged:

```ts
export interface BudgetReferenceDataApi {
  getBudget(budgetId: string): Promise<BudgetDto>;
  updateBudget(budgetId: string, input: UpdateBudgetInput): Promise<BudgetDto>;
  initializeTemplate(budgetId: string): Promise<ReferenceTemplateResult>;
  listAccounts(budgetId: string, status?: ReferenceStatus): Promise<AccountDto[]>;
  createAccount(budgetId: string, input: CreateAccountInput): Promise<AccountDto>;
  updateAccount(budgetId: string, accountId: string, input: UpdateAccountInput): Promise<AccountDto>;
  archiveAccount(budgetId: string, accountId: string): Promise<AccountDto>;
}
```

Define same complete methods for categories/envelopes. `AccountCard` and `EnvelopeCard` receive only presentation props, localized enum label and server DTO values; they render no raw enum and do no authorization/balance logic. `useReferenceDataForm` removes Unicode whitespace used as a Russian thousands separator and replaces one comma decimal separator with a dot before submission, keeps the result as a string, and maps known field errors using existing `useAuth().errorMessage` behavior.

- [ ] **Шаг 5: Run web tests and commit data UI primitives.**

```bash
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web typecheck
git add apps/web/app/components/finance apps/web/app/components/accounts apps/web/app/components/envelopes apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/composables/useBudgetReferenceData.test.ts apps/web/app/composables/useReferenceDataForm.ts
git diff --cached --check
git commit -m "feat: add reference data web client"
```

Expected: PASS. Money never crosses a `number` boundary; authenticated API client remains cookie/CSRF based.

---

### Задача 11: Build protected settings page and migrate existing auth/app shell

**Файлы:**
- Create: `apps/web/app/pages/app/settings.vue`
- Modify: `apps/web/app/pages/app/index.vue`
- Modify: `apps/web/app/components/auth/AuthForm.vue`
- Create: `apps/web/app/pages/app/settings.test.ts`

**Интерфейсы:**
- Produces `/app/settings` guarded by existing `auth` middleware.
- Uses `UiInput`, `UiSelect`, `UiButton`, `UiStatus`, `UiEmptyState` and `useBudgetReferenceData`.
- Existing `/app`, register/login/logout/recovery routes retain their behavior and hydration marker.

- [ ] **Шаг 1: Write failing settings page tests.**

```ts
it('shows settings only from server DTO and saves field errors next to controls', async () => {
  api.getBudget.mockResolvedValue(budgetDto({ allowNegativeBalance: false }));
  api.updateBudget.mockRejectedValue(problemError({
    fieldErrors: [{ field: 'timezone', message: 'Укажите корректный часовой пояс.', code: 'custom' }],
  }));
  const wrapper = mount(SettingsPage, { global: pageStubs });

  await flushPromises();
  await wrapper.get('[name="timezone"]').setValue('bad-zone');
  await wrapper.get('form').trigger('submit');
  expect(wrapper.text()).toContain('Укажите корректный часовой пояс.');
  expect(wrapper.get('[name="timezone"]').attributes('aria-invalid')).toBe('true');
});
```

Test disabled template action while pending, successful server refresh/toast, unchecked `allowNegativeBalance` accepting only boolean, and no rule references shown as selected unless server confirms them.

- [ ] **Шаг 2: Run settings page test to verify it fails.**

```bash
pnpm --filter @harmofin/web test -- settings.test.ts
```

Expected: FAIL because route page is absent.

- [ ] **Шаг 3: Implement settings UI.**

Resolve active budget from `useAuth().data.value?.workspaces[0]?.budgets[0]`; if absent, display `UiEmptyState` with safe message instead of inventing an ID. Fetch full budget DTO on mount. Form exposes: name, timezone, cycle start day, period boundary offset, checkbox `Разрешить отрицательный баланс`, checkbox `Настроить автоматическое распределение дохода`, select `Категория дохода` from active income categories and select `Конверт` from active envelopes when rule is enabled. Load category/envelope choices from API; submit disabled until both references are selected when rule is enabled.

Template action uses visible Russian label `Создать базовый шаблон`, then refetches all settings/reference choices. It never sends direct defaults from browser. Failure renders safe summary; successful response refetches budget before success text.

- [ ] **Шаг 4: Migrate app shell and auth styles to tokens without behavior changes.**

Replace direct hex/unsupported font weights in [AuthForm.vue](../../../apps/web/app/components/auth/AuthForm.vue) and [index.vue](../../../apps/web/app/pages/app/index.vue) with CSS variables. Retain full auth form DOM semantics, submit behavior, `data-hydrated`, wordmark text and all existing page routes. Replace weights `750`/`800` with token-backed `700`; do not use tracking below `-0.04em`. Do not use `identity/logo_description.png` as an image.

- [ ] **Шаг 5: Run component/auth regression tests and commit.**

```bash
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web typecheck
git add apps/web/app/pages/app/settings.vue apps/web/app/pages/app/settings.test.ts apps/web/app/pages/app/index.vue apps/web/app/components/auth/AuthForm.vue
git diff --cached --check
git commit -m "feat: add budget settings page"
```

Expected: PASS. Settings labels and errors are Russian; old auth tests still pass with same cookie/session behavior.

---

### Задача 12: Build accounts, categories and envelopes settings pages

**Файлы:**
- Create: `apps/web/app/pages/app/accounts.vue`
- Create: `apps/web/app/pages/app/categories.vue`
- Create: `apps/web/app/pages/app/envelopes.vue`
- Create: `apps/web/app/pages/app/accounts.test.ts`
- Create: `apps/web/app/pages/app/categories.test.ts`
- Create: `apps/web/app/pages/app/envelopes.test.ts`

**Интерфейсы:**
- Produces protected routes `/app/accounts`, `/app/categories`, `/app/envelopes`.
- Uses active list by default, explicit `Показать архив` status mode, create/edit forms and `UiConfirmDialog` archive confirmation.
- No page performs money arithmetic or exposes physical deletion.

- [ ] **Шаг 1: Write failing page interaction tests.**

```ts
it('creates account from decimal text and refreshes server-confirmed card', async () => {
  api.listAccounts.mockResolvedValue([]);
  api.createAccount.mockResolvedValue(accountDto({ currentBalanceMinor: '12345' }));
  const wrapper = mount(AccountsPage, { global: pageStubs });

  await flushPromises();
  await wrapper.get('input[name="name"]').setValue('Основной счёт');
  await wrapper.get('input[name="startingBalance"]').setValue('123,45');
  await wrapper.get('form[data-account-form]').trigger('submit');
  expect(api.createAccount).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ startingBalance: '123.45' }));
  expect(wrapper.text()).toContain('Основной счёт');
});

it('requires explicit archive confirmation', async () => {
  const wrapper = mount(EnvelopesPage, { global: pageStubs });
  await wrapper.get('[data-action="archive-envelope"]').trigger('click');
  expect(api.archiveEnvelope).not.toHaveBeenCalled();
  await wrapper.get('[data-confirm="archive-envelope"]').trigger('click');
  expect(api.archiveEnvelope).toHaveBeenCalled();
});
```

For categories, test separate `Доходы`/`Расходы` regions, type-specific creation and active parent select. For all pages test loading, error retry, empty template invitation, field errors, status words and compact card markup.

- [ ] **Шаг 2: Run page tests to verify they fail.**

```bash
pnpm --filter @harmofin/web test -- accounts.test.ts categories.test.ts envelopes.test.ts
```

Expected: FAIL because routes are absent.

- [ ] **Шаг 3: Implement accounts page.**

Use `AccountCard` for all widths, not desktop table. Form contains explicit labels for name, type, optional bank, optional four final digits, start balance and accounting start date. `allowNegative` for money input comes only from loaded budget settings. Provide a status filter control with `Активные`, `В архиве`, `Все`; cards render `UiStatus` text `Активен` or `В архиве`. Edit does not create a balance calculated in browser. Archive dialog description is exactly `Счёт останется в истории, но будет недоступен для новых операций.`

- [ ] **Шаг 4: Implement categories page.**

Render two labelled regions/sections: `Доходы` and `Расходы`. Category create/edit form selects type only on creation; parent options filter to loaded active same-type categories and exclude current category. Keep display order numeric field as a plain integer text/number UI value validated server-side. Use template action only in empty state. Archive dialog names category and explains history remains; no delete action appears.

- [ ] **Шаг 5: Implement envelopes page.**

Use `EnvelopeCard`; form carries name, type, starting balance, optional monthly plan, target amount/date, display order and comment. Preserve money values as strings, show target date only as date string and no client target-progress computation. Archive dialog description: `Конверт останется в истории, но будет недоступен для новых операций.`

- [ ] **Шаг 6: Ensure responsive/accessibility contracts and run tests.**

Every page has a single `h1`, content landmark, compact padding at least `20px`, form max width token, field-level error associations, focusable retry, live status only for transient loading/success, and no horizontal clipped table. Confirm dialog supports Escape, focus trapping and focus return. Use Russian copy from UI foundation.

```bash
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web build
```

Expected: PASS. Desktop and compact output use cards/labelled controls; all mutations refetch server DTO before success state.

- [ ] **Шаг 7: Commit reference-data pages.**

```bash
git add apps/web/app/pages/app/accounts.vue apps/web/app/pages/app/categories.vue apps/web/app/pages/app/envelopes.vue apps/web/app/pages/app/accounts.test.ts apps/web/app/pages/app/categories.test.ts apps/web/app/pages/app/envelopes.test.ts
git diff --cached --check
git commit -m "feat: add reference data settings pages"
```

---

### Задача 13: Add browser coverage and manual browser verification

**Файлы:**
- Modify: `e2e/playwright.config.ts`
- Create: `e2e/reference-data.spec.ts`
- Modify: `e2e/auth.spec.ts` only if selectors changed by token migration; preserve assertions.

**Интерфейсы:**
- Playwright runs both `auth.spec.ts` and `reference-data.spec.ts`.
- E2E tests use only browser-visible product flow; no database bypass for owner actions.

- [ ] **Шаг 1: Write failing Stage 2 Playwright spec.**

```ts
test('owner initializes settings data then creates, edits and archives reference data', async ({ page }) => {
  await registerAndReachApp(page);

  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Создать базовый шаблон' }).click();
  await expect(page.getByText('Базовый шаблон создан')).toBeVisible();

  await page.goto('/app/accounts');
  await page.getByRole('button', { name: 'Создать счёт' }).click();
  await page.getByLabel('Название счёта').fill('Основной счёт');
  await page.getByLabel('Начальный баланс').fill('1 234,50');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByText('Основной счёт')).toBeVisible();
  await expect(page.getByText(/1.*234.*50/)).toBeVisible();

  await page.getByRole('button', { name: 'Переместить в архив' }).click();
  await page.getByRole('button', { name: 'Архивировать счёт' }).click();
  await expect(page.getByText('В архиве')).toBeVisible();
});
```

Add browser cases for settings save, category creation in income/expense, envelope create/edit/archive, invalid money field error, template repeat without duplicate visible card, keyboard Escape closes archive dialog and returns focus, protected route redirect and existing `localStorage` auth regression.

- [ ] **Шаг 2: Run new spec to verify it fails before implementation completion.**

```bash
pnpm test:e2e -- reference-data.spec.ts
```

Expected: FAIL until pages/actions exist; after tasks 9–12 it must be green.

- [ ] **Шаг 3: Configure test discovery and make selectors stable.**

Change Playwright `testMatch` from only `auth.spec.ts` to `*.spec.ts`. Use role/label selectors, not implementation classes. Keep web/API startup and test DB configuration unchanged.

- [ ] **Шаг 4: Run desktop, compact and auth browser tests.**

```bash
pnpm test:e2e
```

Expected: PASS. Add `test.use({ viewport: { width: 375, height: 812 } })` compact scenario that reaches all new page headings/actions without horizontal desktop table; normal scenario runs at default desktop viewport. Existing registration/login/logout/recovery tests pass unchanged in intent.

- [ ] **Шаг 5: Start local stack and perform manual browser verification.**

```bash
pnpm infra:up
pnpm dev
```

In browser, check owner flow on desktop and at `375px`: create/edit/archive account, category and envelope; save budget settings; execute template twice; inspect archive status; tab through a form and archive dialog; use Escape; verify visible focus and field errors. Stop local dev processes only after observation; do not use destructive database cleanup.

- [ ] **Шаг 6: Commit browser coverage.**

```bash
git add e2e/playwright.config.ts e2e/reference-data.spec.ts e2e/auth.spec.ts
git diff --cached --check
git commit -m "test: cover reference data settings flow"
```

---

### Задача 14: Run final project verification and record actual results

**Файлы:**
- Modify: no files by default.
- Modify: `README.md` only if an implementation-created command was verified and needs user documentation; no new command is planned for this stage.

**Интерфейсы:**
- Produces verified Stage 2 branch with all source, migration, tests, OpenAPI, web build and compose configuration passing.

- [ ] **Шаг 1: Review staged and working tree scope.**

```bash
git status --short
git diff --check
git log --oneline main..HEAD
```

Expected: only intentional Stage 2 files. Confirm `identity/logo_description.png` is absent from status and no `.env`, credentials, cookie/token, raw request payload or generated output is staged.

- [ ] **Шаг 2: Execute full required CI gate from clean migrated local database.**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
docker compose -f infra/compose/local.yml config --quiet
```

Expected: every command exits `0`. If a command fails, fix root cause, add/adjust focused regression test where behavior changed, then rerun failing command and full gate. Do not bypass checks with `--no-verify`, suppress failures or destructive database commands.

- [ ] **Шаг 3: Verify migration compatibility separately.**

Run migration against both fresh local database and one database containing Stage 1 fixtures; inspect that existing budgets retain no automatic defaults and all tables/indexes/constraints exist:

```bash
pnpm db:migrate
pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/reference-data.migration.integration.test.ts
```

Expected: PASS.

- [ ] **Шаг 4: Final commit only if verification caused intentional source changes.**

```bash
git status --short
git add -u
git diff --cached --check
git commit -m "fix: complete stage 2 verification"
```

Do not create an empty verification commit. Report executed commands, browser flows observed and resulting commit list in completion message.
