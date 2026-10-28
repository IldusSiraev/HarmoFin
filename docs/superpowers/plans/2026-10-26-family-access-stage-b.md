# Семейный доступ, этап B — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Счета, конверты и планы получают владельца, распределения и перемещения — автора; одна политика `BudgetAccessPolicy` решает, кто что может делать с деньгами семьи; интерфейс показывает владельцев и авторов и скрывает чужие действия.

**Architecture:** Аддитивная миграция добавляет `owner_user_id` и `created_by_user_id` с backfill и `NOT NULL`. Новая политика `apps/api/src/common/policies/budget-access.policy.ts` заменяет `RolePolicy` и разрозненные проверки ролей. Сервисы читают участника (`AccessActor`) и объект внутри транзакции мутации, после блокировки бюджета, и вызывают `require*`-методы политики. Ответы получают `owner`, `canEdit` и `createdBy`, списки — фильтр `ownerUserId`. Выход или удаление участника передаёт его объекты создателю в той же транзакции. Веб берёт `canEdit` с сервера и не считает права сам.

**Tech Stack:** NestJS 11 + Fastify, Prisma, PostgreSQL 18, Zod, Vitest, Nuxt 4 / Vue 3.5, `@lucide/vue`, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-25-family-access-design.md](../specs/2026-10-25-family-access-design.md) — разделы «Этап B», «Матрица (этап B)», «BudgetAccessPolicy», «Выход и удаление участника», «Уведомления», «UI → Этап B», «Тесты → Этап B». Этап A уже в `main` ([план этапа A](2026-10-25-family-access-stage-a.md)).

## Статус выполнения (26.10.2026)

Ветка `feat/family-access-stage-b`. Задачи выполнялись через subagent-driven development: один writer на задачу, review по таблице в конце плана, коммит после каждой задачи.

| Задача | Статус | Коммит | Review |
|---|---|---|---|
| План | закоммичен | `b4fd09f` | — |
| 1. Схема, миграция, владельцы и авторы | готово | `cddf0ef` | backend, financial, security, QA, final — APPROVE |
| 2. `BudgetAccessPolicy`, участник в транзакции, `PersonRef`, `FamilyTestApp` | готово | `e92816b` | security, API, QA, final — APPROVE |
| 3. Счета по владельцу | готово | `8cd80c9` | API, security, financial, QA, final — APPROVE |
| 4. Конверты, цели, правила наполнения | готово | `760a62b` | security, API, financial, QA, final — APPROVE |
| 5. Распределения, перемещения, наполнение по правилам | готово | `140cef9` | financial, security, API, QA, final — APPROVE (1 раунд исправлений) |
| 6. Операции и переводы | готово | `30b9869` | financial, security, API, QA, final — APPROVE (1 раунд исправлений) |
| 7–17 | не начаты | — | — |

Проверки на момент остановки: `pnpm test:integration` (корневой скрипт) — 60 файлов, 655 тестов, все проходят; typecheck и lint чистые.

Следующий шаг — **задача 7** (планы по владельцу).

### Решения, принятые при выполнении

- Writer только индексирует изменения (`git add <пути>`), коммит делает координирующая сессия после review — правило владельца.
- Задача 1: тест схемы проверяет отказ вставки без владельца по `meta.code: '23502'`, а не по тексту ошибки (Prisma отдаёт DETAIL, а не MESSAGE для raw-запросов).
- Задача 4: `changedRuleEnvelopeIds` не ищет «удалённые» правила — `PUT funding-rules` никогда не трогает правила конвертов, которых нет в теле запроса (подтвердили security и financial review).
- Задача 5: проверка владельца для `OPENING` в `assignFree` оставлена как защита в глубину, хотя через `POST /assignments` недостижима (схема принимает только `FREE | INCOME`); из описания 403 этого эндпоинта упоминание `OPENING` убрано. Проверки `OPENING` и `confirmPeriodTargets` для чужих конвертов покрыты тестами на отдельной семье.
- Задача 6: тест `reference-data.integration.test.ts` про роли счетов переписан с `EDITOR` на `VIEWER` — это следствие задачи 3 (участник теперь создаёт свои счета). `api-process.integration.test.ts` требует запуска через `pnpm test:integration` (одноразовая БД `harmofin_v22_test`); прямой `vitest run` этого файла падает по окружению.

### Отложенные мелкие замечания (для финального review ветки)

- Задача 2: `JournalApplicationService` получает `PrismaClient` напрямую ради `findPersonRefs`; лучше обернуть в `JournalRepository`.
- Задача 3: `AccountApplicationService.restore` делает лишнюю проверку владельца до транзакции (ради порядка 403 перед 409, с `role!`); основная проверка — внутри транзакции.
- Задача 5: в `funding-confirm.application.service.ts` два чтения владельцев (`tx.envelopePeriod.findMany`, `tx.envelope.findMany`) стоят в сервисе, а не в репозитории.

### Заметки для исполнителя следующих задач

- Полный набор интеграционных тестов запускать только через корневой `pnpm test:integration`; отдельные файлы — через `pnpm --filter <api> exec vitest run --config vitest.integration.config.ts <файл>`.
- `pnpm db:generate` может падать с EPERM, пока у владельца запущены dev-процессы (Windows блокирует движок Prisma). Процессы не трогать.
- Тесты этапа A, которые ожидали 403 для `EDITOR`, переписываются на `VIEWER` с сохранением смысла.
- `RolePolicy` ещё используется в модулях, не затронутых задачами 3–6; удаляется в задаче 8.

## Global Constraints

- Роли: `OWNER` («Создатель», ровно один, `Workspace.ownerId`), `EDITOR` («Участник»), `VIEWER` («Наблюдатель»). Writer — `OWNER` или `EDITOR`.
- Создатель администрирует семью и бюджет, но **чужие финансовые объекты не правит**: на счета, конверты, планы и операции участника у него те же права, что у любого другого writer.
- «Свой доход» — `Transaction` типа `INCOME` с `createdByUserId = actor.userId`. «Своя операция» — `createdByUserId = actor.userId`.
- Деньги только целыми минорными единицами (`bigint`), расчёты на сервере в транзакции. Только `CONFIRMED` влияет на суммы.
- Каждый запрос к данным фильтрует `budgetId` в самом запросе. Участник, роль и объект читаются **внутри транзакции мутации после `lockBudget`**, до записи.
- Порядок проверок в мутации: `planModelPolicy.requireModel` (404 для чужого бюджета) → `lockBudget` → idempotency → `requireAccessActor` (403 `FORBIDDEN` для `VIEWER`/бывшего участника) → загрузка объекта с `budgetId` (404) → `require*` политики (403 с кодом) → бизнес-проверки → запись.
- Новые коды 403: `NOT_OBJECT_OWNER`, `NOT_ACCOUNT_OWNER`, `NOT_INCOME_AUTHOR`, `NOT_OPERATION_AUTHOR` (см. отклонение 1). Тело — как у остальных ошибок: `{ code, detail }` через `ForbiddenException`.
- Все изменения API аддитивные: новые поля в ответах, новый необязательный query-параметр `ownerUserId`. Существующие поля и коды не меняются, кроме перечисленных в отклонениях. OpenAPI: каждое новое поле и код ошибки описаны.
- Миграции только аддитивные; backfill в той же миграции; `NOT NULL` после backfill.
- UI-тексты на русском, идентификаторы на английском. Calm Fintech: владелец и автор — текстом, не цветом; действия строки — icon-only `UiActionMenu` с `aria-label`; переключатель «Все / Мои» — `UiButtonGroup`.
- Подписи людей гендерно-нейтральные (как `authorLabel` этапа A): «Владелец: Алия», «Алия: +10 000 ₽», а не «Алия распределила».
- Local Playwright не запускать; E2E-спека выполняется в CI.
- Не трогать `identity/logo_description.png`. Не создавать worktree. Субагенты не запускают `pnpm infra:down` и не трогают dev-процессы владельца. Коммиты делает главная сессия после review задачи, на ветке `feat/family-access-stage-b`.

## Отклонения и решения, принятые в плане

1. **Четвёртый код `NOT_OPERATION_AUTHOR` (403).** Дизайн перечисляет три кода, но матрица запрещает править чужие операции, переводы и распределения; ни один из трёх кодов это не описывает. `detail`: «Изменять операцию может только её автор.»
2. **Категории остаются настройкой бюджета (`OWNER`).** Матрица дизайна категории не упоминает; сейчас ими управляет только `OWNER`, поведение не меняется. Если владелец решит открыть категории участникам — отдельная правка `CategoryApplicationService` после этапа B.
3. **Порядок backfill автора распределения:** сначала `actorUserId` из `AuditEvent` `CREATED` по `entityId` (это тот, кто реально распределил), затем `createdByUserId` дохода-источника, затем `workspace.ownerId`. Дизайн ставил доход первым; на этапе A распределять мог только создатель, поэтому данные совпадают, а новый порядок точнее для смысла «кто распределил».
4. **Backfill владельца плана:** `regular_plans.created_by_user_id`, если этот пользователь — активный `OWNER`/`EDITOR` workspace плана, иначе `workspace.ownerId`. На этапе A участник мог создать план через «разовый платёж» (`payOneTime`), и такой план должен остаться у него.
5. **Изменить или отменить распределение** (`PATCH`/`DELETE assignments/:id`) может только его автор (`NOT_OPERATION_AUTHOR`). Дизайн этот случай не описывает; правило совпадает с «править операцию — только свою».
6. **Пакетное сохранение правил наполнения** (`PUT funding-rules`) доступно writer. Правило чужого конверта, которое пакет создаёт, меняет или удаляет, даёт `NOT_OBJECT_OWNER`; неизменённые чужие правила допустимы. Изменение блока `incomeSuggestion` (общая настройка бюджета) и отдельный `PUT income-category-suggestion` — только `OWNER` (`FORBIDDEN`).
7. **Просмотр удалённых операций** (`status=DELETED` в журнале и `GET transactions/:id`) открывается всем writer, а не только `OWNER`: автор должен видеть свою удалённую операцию, чтобы восстановить её. `VIEWER` по-прежнему получает 403.
8. **Системные конверты остаются единственными на бюджет.** Конверт «Обязательные» (`MANDATORY_EXPENSES`) и слоты `CURRENT_EXPENSES` (`FIRST`/`SECOND`) уникальны на бюджет, как сейчас; после backfill они принадлежат создателю. Оплата обязательного платежа тратит из конверта «Обязательные» — трата из любого конверта разрешена.
9. **Названия счетов и конвертов остаются уникальными на бюджет** (`accounts_active_budget_name_key`, `envelopes_active_budget_name_key`). Два участника не могут завести активные счета с одинаковым названием — сообщение `REFERENCE_NAME_CONFLICT` не меняется.
10. **История конверта:** `amountMinor` остаётся беззнаковым (совместимость), добавляются `direction: 'IN' | 'OUT'`, `createdBy` и `counterpartName`. Знак в UI берётся из `direction`, а не из `kind`. Исправляет текущую ошибку: входящее перемещение сейчас показывается как списание.
11. **Новый тип уведомления `OBJECTS_TRANSFERRED`** для сводки «Вам переданы 3 счёта, 2 конверта, 1 план».
12. **Хвост этапа A:** `GET /api/v2/budgets/:budgetId/transactions/:id` и ответ перевода получают `createdBy`, чтобы карточка операции, открытая по прямой ссылке, показывала автора.
13. **Обязательные поля Prisma.** `ownerUserId` и `createdByUserId` без значения по умолчанию: компилятор заставляет каждую точку создания передать владельца. Тестовые фикстуры (≈160 вызовов `prisma.<model>.create` в `apps/api/test`) обновляются механически в задаче 1.

## Карта файлов

API, новое:
- `apps/api/src/common/policies/budget-access.policy.ts` — `AccessActor`, `BudgetAccessPolicy` (чистые `can*` и бросающие `require*`).
- `apps/api/src/common/policies/access.errors.ts` — фабрики `notObjectOwner`, `notAccountOwner`, `notIncomeAuthor`, `notOperationAuthor`.
- `apps/api/src/common/policies/access-actor.repository.ts` — `findAccessActor`, `requireAccessActor` (чтение участника в транзакции).
- `apps/api/src/common/people/person-ref.repository.ts` — `findPersonRefs(tx, workspaceId, userIds)` → `Map<userId, PersonRef>`; переносится из `v2-journal/journal.repository.ts` (`findAuthors`).
- `apps/api/src/common/people/person-ref.dto.ts` — `PersonRefResponse` (переименованный и перенесённый `AuthorRefResponse`).
- `apps/api/src/family/object-transfer.ts` — передача объектов ушедшего участника создателю.
- `apps/api/test/helpers/family-app.ts` — общий тестовый стенд: приложение, регистрация, участники, `inject`, создание счёта/конверта/дохода, очистка.
- Миграция `prisma/migrations/20261026000000_family_object_ownership/migration.sql`.

API, изменения: `prisma/schema.prisma`; `accounts/*`; `envelope-plans/*`; `funding/*`; `v2-transactions/*`; `v2-transfers/*`; `obligations/*`; `plans/*`; `plans-calendar/*`; `v2-template/*`; `v2-dashboard/*`; `budgets/*`; `categories/*`; `cycles/*`; `exports/*`; `audit/*`; `v2-journal/*`; `family/members.application.service.ts`; `family/family-notifications.ts`; `account-deletion/*`; удаление `common/policies/role-policy.ts`.

Worker: `apps/worker/src/notification.handler.ts`.

Web: `composables/usePermissions.ts`, новый `composables/useOwnerFilter.ts`, новый `components/app/OwnerFilter.vue`, новый `components/app/owner-label.ts`; `components/operations/author-label.ts` (тип из общего `PersonRef`); `useEnvelopePlanV2.ts` и composables счетов/планов (типы); `pages/app/accounts.vue`, `components/accounts/*`; `components/envelopes/*`; `components/funding/*`; `components/operations/*`, `pages/app/operations.vue`; `pages/app/plans.vue`, `components/plans/*`; `components/notifications/NotificationCard.vue`.

E2E: `e2e/family-ownership.spec.ts`.

Документация: функциональная спецификация §17.2 (матрица прав этапа B).

---

### Task 1: Схема, миграция с backfill, владелец и автор во всех точках создания

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261026000000_family_object_ownership/migration.sql`
- Modify: `apps/api/src/accounts/account.repository.ts` (`AccountCreateData`, `create`)
- Modify: `apps/api/src/accounts/account.application.service.ts` (`createData`)
- Modify: `apps/api/src/envelope-plans/envelope-plan.repository.ts` (`createEnvelope`)
- Modify: `apps/api/src/v2-template/template-apply.repository.ts` (`createEnvelope`) и вызывающий `template-apply.application.service.ts`
- Modify: `apps/api/src/plans/regular-plan.repository.ts` (`regularPlan.create`) и его вызывающие (`obligation-plan.application.service.ts`, `income-plan-v2.application.service.ts`)
- Modify: `apps/api/src/envelope-plans/assignment.repository.ts` (`createAssignment`)
- Modify: `apps/api/src/envelope-plans/movement.repository.ts` (`createMovement`)
- Modify: все фикстуры в `apps/api/test/**/*.ts` и `prisma/seed/index.ts`, которые создают `account`, `envelope`, `regularPlan`, `envelopeAssignment`, `envelopeMovement`, включая raw SQL `INSERT` в `plans-notifications-migration.integration.test.ts`, `reference-data.migration.integration.test.ts`, `v2-ledger-schema.integration.test.ts`
- Test: `apps/api/test/family-ownership-schema.integration.test.ts`

**Interfaces:**
- Produces: `Account.ownerUserId: string`, `Envelope.ownerUserId: string`, `RegularPlan.ownerUserId: string`, `EnvelopeAssignment.createdByUserId: string`, `EnvelopeMovement.createdByUserId: string` (все `NOT NULL`, FK на `users`); `NotificationType.OBJECTS_TRANSFERRED`; индексы `(budget_id, owner_user_id)`.
- Produces: `AccountCreateData.ownerUserId`, параметр `ownerUserId` у `createEnvelope` (оба репозитория), `createdByUserId` у создания плана, `actorUserId` уже есть в `AssignmentCreateParams`/параметрах `createMovement` — он же пишется в `createdByUserId`.

- [x] **Step 1: Написать падающий тест схемы**

```ts
// apps/api/test/family-ownership-schema.integration.test.ts
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

afterAll(async () => {
  await prisma.$disconnect();
});

async function columnInfo(table: string, column: string) {
  const rows = await prisma.$queryRaw<Array<{ is_nullable: string; data_type: string }>>`
    SELECT is_nullable, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return rows[0];
}

describe('family object ownership schema', () => {
  it.each([
    ['accounts', 'owner_user_id'],
    ['envelopes', 'owner_user_id'],
    ['regular_plans', 'owner_user_id'],
    ['envelope_assignments', 'created_by_user_id'],
    ['envelope_movements', 'created_by_user_id'],
  ])('%s.%s is a NOT NULL uuid', async (table, column) => {
    expect(await columnInfo(table, column)).toEqual({ is_nullable: 'NO', data_type: 'uuid' });
  });

  it.each([
    ['accounts', 'accounts_owner_user_id_fkey'],
    ['envelopes', 'envelopes_owner_user_id_fkey'],
    ['regular_plans', 'regular_plans_owner_user_id_fkey'],
    ['envelope_assignments', 'envelope_assignments_created_by_user_id_fkey'],
    ['envelope_movements', 'envelope_movements_created_by_user_id_fkey'],
  ])('%s has foreign key %s to users', async (table, constraint) => {
    const rows = await prisma.$queryRaw<Array<{ target: string }>>`
      SELECT ccu.table_name AS target
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = ${table} AND tc.constraint_name = ${constraint}
        AND tc.constraint_type = 'FOREIGN KEY'
    `;
    expect(rows).toEqual([{ target: 'users' }]);
  });

  it.each([
    'accounts_budget_id_owner_user_id_idx',
    'envelopes_budget_id_owner_user_id_idx',
    'regular_plans_budget_id_owner_user_id_idx',
  ])('index %s exists', async (index) => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${index}
    `;
    expect(rows).toHaveLength(1);
  });

  it('rejects an account without an owner', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "accounts" ("id", "budget_id", "name", "account_type", "starting_balance_minor",
           "accounting_start_date", "updated_at")
         VALUES ('${randomUUID()}', '${randomUUID()}', 'x', 'CASH', 0, '2026-01-01', now())`,
      ),
    ).rejects.toThrow(/owner_user_id|null value/);
  });

  it('knows the OBJECTS_TRANSFERRED notification type', async () => {
    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT unnest(enum_range(NULL::"NotificationType"))::text AS value
    `;
    expect(rows.map((row) => row.value)).toContain('OBJECTS_TRANSFERRED');
  });
});
```

- [x] **Step 2: Запустить и убедиться, что тест падает**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-ownership-schema.integration.test.ts`
Expected: FAIL — колонок `owner_user_id` нет. (Если имя пакета другое — взять из `apps/api/package.json`.)

- [x] **Step 3: Миграция**

```sql
-- prisma/migrations/20261026000000_family_object_ownership/migration.sql
-- Family access, stage B: object owners and allocation authors.
-- Additive: nullable columns, backfill, then NOT NULL, foreign keys and indexes.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OBJECTS_TRANSFERRED';

ALTER TABLE "accounts" ADD COLUMN "owner_user_id" UUID;
ALTER TABLE "envelopes" ADD COLUMN "owner_user_id" UUID;
ALTER TABLE "regular_plans" ADD COLUMN "owner_user_id" UUID;
ALTER TABLE "envelope_assignments" ADD COLUMN "created_by_user_id" UUID;
ALTER TABLE "envelope_movements" ADD COLUMN "created_by_user_id" UUID;

-- Accounts and envelopes existed before ownership: they belong to the family creator.
UPDATE "accounts" AS a
SET "owner_user_id" = w."owner_id"
FROM "budgets" AS b
JOIN "workspaces" AS w ON w."id" = b."workspace_id"
WHERE b."id" = a."budget_id";

UPDATE "envelopes" AS e
SET "owner_user_id" = w."owner_id"
FROM "budgets" AS b
JOIN "workspaces" AS w ON w."id" = b."workspace_id"
WHERE b."id" = e."budget_id";

-- Plans keep their creator when that person is still an active writer of the family.
UPDATE "regular_plans" AS p
SET "owner_user_id" = p."created_by_user_id"
WHERE EXISTS (
  SELECT 1 FROM "workspace_memberships" AS m
  WHERE m."workspace_id" = p."workspace_id"
    AND m."user_id" = p."created_by_user_id"
    AND m."is_active" = true
    AND m."role" IN ('OWNER', 'EDITOR')
);

UPDATE "regular_plans" AS p
SET "owner_user_id" = w."owner_id"
FROM "workspaces" AS w
WHERE w."id" = p."workspace_id" AND p."owner_user_id" IS NULL;

-- Allocation author: who created it (audit), else the income author, else the creator.
UPDATE "envelope_assignments" AS a
SET "created_by_user_id" = ae."actor_user_id"
FROM (
  SELECT DISTINCT ON ("entity_id") "entity_id", "actor_user_id"
  FROM "audit_events"
  WHERE "entity_type" = 'envelope-assignment'
    AND "action" = 'CREATED'
    AND "actor_user_id" IS NOT NULL
    AND "entity_id" IS NOT NULL
  ORDER BY "entity_id", "created_at"
) AS ae
WHERE ae."entity_id" = a."id";

UPDATE "envelope_assignments" AS a
SET "created_by_user_id" = t."created_by_user_id"
FROM "transactions" AS t
WHERE a."created_by_user_id" IS NULL
  AND t."id" = a."source_income_transaction_id"
  AND t."budget_id" = a."budget_id";

UPDATE "envelope_assignments" AS a
SET "created_by_user_id" = w."owner_id"
FROM "budgets" AS b
JOIN "workspaces" AS w ON w."id" = b."workspace_id"
WHERE a."created_by_user_id" IS NULL AND b."id" = a."budget_id";

UPDATE "envelope_movements" AS m
SET "created_by_user_id" = ae."actor_user_id"
FROM (
  SELECT DISTINCT ON ("entity_id") "entity_id", "actor_user_id"
  FROM "audit_events"
  WHERE "entity_type" = 'envelope-movement'
    AND "action" = 'CREATED'
    AND "actor_user_id" IS NOT NULL
    AND "entity_id" IS NOT NULL
  ORDER BY "entity_id", "created_at"
) AS ae
WHERE ae."entity_id" = m."id";

UPDATE "envelope_movements" AS m
SET "created_by_user_id" = w."owner_id"
FROM "budgets" AS b
JOIN "workspaces" AS w ON w."id" = b."workspace_id"
WHERE m."created_by_user_id" IS NULL AND b."id" = m."budget_id";

ALTER TABLE "accounts" ALTER COLUMN "owner_user_id" SET NOT NULL;
ALTER TABLE "envelopes" ALTER COLUMN "owner_user_id" SET NOT NULL;
ALTER TABLE "regular_plans" ALTER COLUMN "owner_user_id" SET NOT NULL;
ALTER TABLE "envelope_assignments" ALTER COLUMN "created_by_user_id" SET NOT NULL;
ALTER TABLE "envelope_movements" ALTER COLUMN "created_by_user_id" SET NOT NULL;

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "regular_plans" ADD CONSTRAINT "regular_plans_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "envelope_assignments" ADD CONSTRAINT "envelope_assignments_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "accounts_budget_id_owner_user_id_idx" ON "accounts"("budget_id", "owner_user_id");
CREATE INDEX "envelopes_budget_id_owner_user_id_idx" ON "envelopes"("budget_id", "owner_user_id");
CREATE INDEX "regular_plans_budget_id_owner_user_id_idx" ON "regular_plans"("budget_id", "owner_user_id");
```

`ALTER TYPE … ADD VALUE` нельзя использовать в той же транзакции, где новое значение читается; здесь оно только добавляется — так же сделано в миграции этапа A для `MEMBER_*`. Проверить, что `prisma migrate` применяет файл без ошибки.

- [x] **Step 4: Схема Prisma**

В `prisma/schema.prisma`:

```prisma
enum NotificationType {
  // ...existing values...
  MEMBER_REMOVED
  OBJECTS_TRANSFERRED
}

model User {
  // ...existing fields and relations...
  ownedAccounts        Account[]            @relation("AccountOwner")
  ownedEnvelopes       Envelope[]           @relation("EnvelopeOwner")
  ownedRegularPlans    RegularPlan[]        @relation("RegularPlanOwner")
  createdAssignments   EnvelopeAssignment[] @relation("EnvelopeAssignmentCreator")
  createdMovements     EnvelopeMovement[]   @relation("EnvelopeMovementCreator")
}

model Account {
  // after budgetId:
  ownerUserId String @map("owner_user_id") @db.Uuid
  // relations:
  owner User @relation("AccountOwner", fields: [ownerUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  // indexes:
  @@index([budgetId, ownerUserId])
}

model Envelope {
  ownerUserId String @map("owner_user_id") @db.Uuid
  owner User @relation("EnvelopeOwner", fields: [ownerUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  @@index([budgetId, ownerUserId])
}

model RegularPlan {
  ownerUserId String @map("owner_user_id") @db.Uuid
  owner User @relation("RegularPlanOwner", fields: [ownerUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  @@index([budgetId, ownerUserId])
}

model EnvelopeAssignment {
  createdByUserId String @map("created_by_user_id") @db.Uuid
  createdBy User @relation("EnvelopeAssignmentCreator", fields: [createdByUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
}

model EnvelopeMovement {
  createdByUserId String @map("created_by_user_id") @db.Uuid
  createdBy User @relation("EnvelopeMovementCreator", fields: [createdByUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
}
```

Run: `pnpm db:generate`. Затем `pnpm db:migrate` (не `db:migrate:dev`; локальная БД разработки уже содержит миграции этапа A).

- [x] **Step 5: Владелец и автор во всех точках создания**

Точки создания (полный список по `grep -rn "\.account\.create\|\.envelope\.create\|\.regularPlan\.create\|\.envelopeAssignment\.create\|\.envelopeMovement\.create" apps/api/src`):

1. `accounts/account.repository.ts` — в `AccountCreateData` добавить `ownerUserId: string`; `create` пишет `...input` как сейчас. В `AccountApplicationService.createData(budgetId, input, allow)` добавить параметр `ownerUserId` и передавать `userId` из `create`.
2. `envelope-plans/envelope-plan.repository.ts` `createEnvelope` — в `data` добавить `ownerUserId: params.actorUserId`.
3. `v2-template/template-apply.repository.ts` `createEnvelope(tx, budgetId, row)` → `createEnvelope(tx, budgetId, ownerUserId, row)`, `data: { ...row, budgetId, ownerUserId, startingBalanceMinor: 0n }`; в `template-apply.application.service.ts` передать `userId` актёра.
4. `plans/regular-plan.repository.ts` `regularPlan.create` — добавить `ownerUserId: <тот же userId, что пишется в createdByUserId>`.
5. `envelope-plans/assignment.repository.ts` `createAssignment` — `createdByUserId: params.actorUserId`.
6. `envelope-plans/movement.repository.ts` `createMovement` — `createdByUserId: params.actorUserId`.

Run: `pnpm --filter @harmofin/api typecheck` — ошибок в `src` быть не должно (тестовые фикстуры исправляются в следующем шаге).

- [x] **Step 6: Обновить фикстуры тестов и seed**

Run: `pnpm --filter @harmofin/api typecheck 2>&1 | grep "test/"` — список фикстур без нового обязательного поля.

Правило подстановки: владелец и автор — пользователь, от имени которого фикстура уже создаёт объект (обычно владелец workspace теста; в файлах уже есть переменная вида `owner.user.id`, `ctx.owner.userId`, `actorUserId`, `userId`). Пример:

```ts
// before
await prisma.account.create({ data: { id: randomUUID(), budgetId, name: 'Карта', /* ... */ } });
// after
await prisma.account.create({
  data: { id: randomUUID(), budgetId, ownerUserId: ownerUserId, name: 'Карта', /* ... */ },
});
```

Для raw SQL `INSERT INTO "accounts" | "envelopes" | "regular_plans" | "envelope_assignments" | "envelope_movements"` в трёх migration-тестах: если тест вставляет строки в схему, уже прошедшую текущую миграцию, добавить колонку и значение; если тест воспроизводит старое состояние схемы до этой миграции — не трогать. Проверить по тексту теста, какой случай.

`prisma/seed/index.ts`: если создаёт перечисленные модели — передать id пользователя, которого seed создаёт владельцем workspace.

Только механическая подстановка; поведение тестов не менять.

- [x] **Step 7: Проверки**

Run:
- `pnpm --filter @harmofin/api typecheck` — PASS.
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-ownership-schema.integration.test.ts` — PASS.
- `pnpm test:integration` — PASS целиком (это главный сигнал, что фикстуры и точки создания согласованы).
- `pnpm lint` — PASS.

- [x] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261026000000_family_object_ownership apps/api/src apps/api/test prisma/seed
git commit -m "feat(db): владелец счетов, конвертов и планов, автор распределений и перемещений"
```

---

### Task 2: `BudgetAccessPolicy`, участник в транзакции, общие ссылки на людей, тестовый стенд

**Files:**
- Create: `apps/api/src/common/policies/budget-access.policy.ts`
- Create: `apps/api/src/common/policies/budget-access.policy.test.ts`
- Create: `apps/api/src/common/policies/access.errors.ts`
- Create: `apps/api/src/common/policies/access-actor.repository.ts`
- Create: `apps/api/src/common/people/person-ref.repository.ts`
- Create: `apps/api/src/common/people/person-ref.dto.ts`
- Modify: `apps/api/src/v2-journal/journal.repository.ts` (удалить `findAuthors`, `AuthorRef` → реэкспорт `PersonRef`), `journal.application.service.ts`, `journal.dto.ts` (`AuthorRefResponse` → импорт `PersonRefResponse`; имя схемы в OpenAPI сохранить через `@ApiSchema({ name: 'AuthorRefResponse' })`, если имя уже опубликовано в `v2-openapi.integration.test.ts`)
- Create: `apps/api/test/helpers/family-app.ts`
- Test: `apps/api/test/family-access-actor.integration.test.ts`

**Interfaces:**
- Produces:
  - `interface AccessActor { userId: string; role: WorkspaceMembershipRole; isCreator: boolean }`
  - `interface OwnedObject { ownerUserId: string }`, `interface AuthoredRecord { createdByUserId: string }`
  - `class BudgetAccessPolicy` с `can*` из дизайна плюс `canViewDeleted`, и `require*`: `requireWriter(actor)`, `requireBudgetSettings(actor)`, `requireObjectOwner(actor, object)`, `requireAccountOwner(actor, account)`, `requireIncomeAuthor(actor, income)`, `requireOperationAuthor(actor, record)`, `requireCanViewDeleted(actor)`.
  - `findAccessActor(db, workspaceId, userId): Promise<AccessActor | null>`, `requireAccessActor(db, workspaceId, userId): Promise<AccessActor>` (бросает `forbidden()`), где `db: Prisma.TransactionClient | PrismaClient`.
  - `type PersonRef = { userId: string; displayName: string | null; isActiveMember: boolean }`, `findPersonRefs(db, workspaceId, userIds): Promise<Map<string, PersonRef>>`, `personRefOf(map, userId): PersonRef` (неизвестный → `{ userId, displayName: null, isActiveMember: false }`).
  - `class PersonRefResponse` (OpenAPI).
  - Тестовый стенд `FamilyTestApp` (см. Step 6).

- [x] **Step 1: Падающий табличный тест политики**

```ts
// apps/api/src/common/policies/budget-access.policy.test.ts
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { BudgetAccessPolicy, type AccessActor } from './budget-access.policy.js';

const policy = new BudgetAccessPolicy();
const ME = 'me';
const OTHER = 'other';

const creator: AccessActor = { userId: ME, role: 'OWNER', isCreator: true };
const editor: AccessActor = { userId: ME, role: 'EDITOR', isCreator: false };
const viewer: AccessActor = { userId: ME, role: 'VIEWER', isCreator: false };

const mine = { ownerUserId: ME };
const theirs = { ownerUserId: OTHER };
const myRecord = { createdByUserId: ME };
const theirRecord = { createdByUserId: OTHER };

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    return ((error as ForbiddenException).getResponse() as { code: string }).code;
  }
}

describe('BudgetAccessPolicy matrix', () => {
  it('everyone reads', () => {
    expect([policy.canRead(creator), policy.canRead(editor), policy.canRead(viewer)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it.each([
    ['canManageMembers', [true, false, false]],
    ['canManageBudgetSettings', [true, false, false]],
    ['canCreateObjects', [true, true, false]],
    ['canAllocateFree', [true, true, false]],
    ['canSpendFromEnvelope', [true, true, false]],
    ['canViewDeleted', [true, true, false]],
  ] as const)('%s by role (creator, editor, viewer)', (method, expected) => {
    expect([policy[method](creator), policy[method](editor), policy[method](viewer)]).toEqual(expected);
  });

  it('a non-creator OWNER row cannot manage members', () => {
    expect(policy.canManageMembers({ userId: ME, role: 'OWNER', isCreator: false })).toBe(false);
  });

  it.each([
    ['canEditObject'],
    ['canRecordOnAccount'],
    ['canMoveOutOfEnvelope'],
    ['canTransfer'],
  ] as const)('%s: only own object, never for viewer, creator has no override', (method) => {
    expect(policy[method](creator, mine)).toBe(true);
    expect(policy[method](creator, theirs)).toBe(false);
    expect(policy[method](editor, mine)).toBe(true);
    expect(policy[method](editor, theirs)).toBe(false);
    expect(policy[method](viewer, mine)).toBe(false);
  });

  it.each([['canEditTransaction'], ['canAllocateIncome']] as const)(
    '%s: only own record',
    (method) => {
      expect(policy[method](creator, myRecord)).toBe(true);
      expect(policy[method](creator, theirRecord)).toBe(false);
      expect(policy[method](editor, myRecord)).toBe(true);
      expect(policy[method](editor, theirRecord)).toBe(false);
      expect(policy[method](viewer, myRecord)).toBe(false);
    },
  );
});

describe('BudgetAccessPolicy require*', () => {
  it('viewer gets FORBIDDEN before any ownership code', () => {
    expect(codeOf(() => policy.requireWriter(viewer))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireObjectOwner(viewer, mine))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireAccountOwner(viewer, mine))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireIncomeAuthor(viewer, myRecord))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireOperationAuthor(viewer, myRecord))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireCanViewDeleted(viewer))).toBe('FORBIDDEN');
  });

  it('writers get the ownership code for someone else’s object', () => {
    expect(codeOf(() => policy.requireObjectOwner(editor, theirs))).toBe('NOT_OBJECT_OWNER');
    expect(codeOf(() => policy.requireAccountOwner(creator, theirs))).toBe('NOT_ACCOUNT_OWNER');
    expect(codeOf(() => policy.requireIncomeAuthor(editor, theirRecord))).toBe('NOT_INCOME_AUTHOR');
    expect(codeOf(() => policy.requireOperationAuthor(creator, theirRecord))).toBe(
      'NOT_OPERATION_AUTHOR',
    );
  });

  it('passes for own objects and budget settings only for OWNER', () => {
    expect(codeOf(() => policy.requireObjectOwner(editor, mine))).toBeNull();
    expect(codeOf(() => policy.requireAccountOwner(editor, mine))).toBeNull();
    expect(codeOf(() => policy.requireIncomeAuthor(editor, myRecord))).toBeNull();
    expect(codeOf(() => policy.requireOperationAuthor(editor, myRecord))).toBeNull();
    expect(codeOf(() => policy.requireBudgetSettings(creator))).toBeNull();
    expect(codeOf(() => policy.requireBudgetSettings(editor))).toBe('FORBIDDEN');
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/common/policies/budget-access.policy.test.ts`
Expected: FAIL — модуля нет.

- [x] **Step 2: Ошибки и политика**

```ts
// apps/api/src/common/policies/access.errors.ts
import { ForbiddenException } from '@nestjs/common';

export function notObjectOwner(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_OBJECT_OWNER',
    detail: 'Изменять может только владелец.',
  });
}

export function notAccountOwner(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_ACCOUNT_OWNER',
    detail: 'Записывать деньги можно только по своему счёту.',
  });
}

export function notIncomeAuthor(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_INCOME_AUTHOR',
    detail: 'Распределять можно только свой доход.',
  });
}

export function notOperationAuthor(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_OPERATION_AUTHOR',
    detail: 'Изменять операцию может только её автор.',
  });
}
```

```ts
// apps/api/src/common/policies/budget-access.policy.ts
import type { WorkspaceMembershipRole } from '@prisma/client';

import { forbidden } from '../reference-data/reference-data.errors.js';
import {
  notAccountOwner,
  notIncomeAuthor,
  notObjectOwner,
  notOperationAuthor,
} from './access.errors.js';

/** The member performing an action, read inside the mutation transaction. */
export interface AccessActor {
  userId: string;
  role: WorkspaceMembershipRole;
  /** True for the single family creator (`Workspace.ownerId`). */
  isCreator: boolean;
}

export interface OwnedObject {
  ownerUserId: string;
}

export interface AuthoredRecord {
  createdByUserId: string;
}

const WRITERS: ReadonlySet<WorkspaceMembershipRole> = new Set(['OWNER', 'EDITOR']);

/**
 * Single source of access rules for a family budget (stage B matrix of the family access design).
 * The creator administers the family and budget settings but has no override on objects owned
 * by other members. `can*` answer, `require*` throw the matching 403.
 */
export class BudgetAccessPolicy {
  canRead(_actor: AccessActor): boolean {
    return true;
  }

  canManageMembers(actor: AccessActor): boolean {
    return actor.role === 'OWNER' && actor.isCreator;
  }

  canManageBudgetSettings(actor: AccessActor): boolean {
    return actor.role === 'OWNER';
  }

  canViewDeleted(actor: AccessActor): boolean {
    return WRITERS.has(actor.role);
  }

  canCreateObjects(actor: AccessActor): boolean {
    return WRITERS.has(actor.role);
  }

  canEditObject(actor: AccessActor, object: OwnedObject): boolean {
    return this.canCreateObjects(actor) && object.ownerUserId === actor.userId;
  }

  canRecordOnAccount(actor: AccessActor, account: OwnedObject): boolean {
    return this.canEditObject(actor, account);
  }

  canEditTransaction(actor: AccessActor, record: AuthoredRecord): boolean {
    return this.canCreateObjects(actor) && record.createdByUserId === actor.userId;
  }

  canAllocateIncome(actor: AccessActor, income: AuthoredRecord): boolean {
    return this.canEditTransaction(actor, income);
  }

  canAllocateFree(actor: AccessActor): boolean {
    return this.canCreateObjects(actor);
  }

  canSpendFromEnvelope(actor: AccessActor): boolean {
    return this.canCreateObjects(actor);
  }

  canMoveOutOfEnvelope(actor: AccessActor, envelope: OwnedObject): boolean {
    return this.canEditObject(actor, envelope);
  }

  canTransfer(actor: AccessActor, source: OwnedObject): boolean {
    return this.canEditObject(actor, source);
  }

  requireWriter(actor: AccessActor): void {
    if (!this.canCreateObjects(actor)) throw forbidden();
  }

  requireBudgetSettings(actor: AccessActor): void {
    if (!this.canManageBudgetSettings(actor)) throw forbidden();
  }

  requireCanViewDeleted(actor: AccessActor): void {
    if (!this.canViewDeleted(actor)) throw forbidden();
  }

  requireObjectOwner(actor: AccessActor, object: OwnedObject): void {
    this.requireWriter(actor);
    if (object.ownerUserId !== actor.userId) throw notObjectOwner();
  }

  requireAccountOwner(actor: AccessActor, account: OwnedObject): void {
    this.requireWriter(actor);
    if (account.ownerUserId !== actor.userId) throw notAccountOwner();
  }

  requireIncomeAuthor(actor: AccessActor, income: AuthoredRecord): void {
    this.requireWriter(actor);
    if (income.createdByUserId !== actor.userId) throw notIncomeAuthor();
  }

  requireOperationAuthor(actor: AccessActor, record: AuthoredRecord): void {
    this.requireWriter(actor);
    if (record.createdByUserId !== actor.userId) throw notOperationAuthor();
  }
}
```

Run unit test — PASS. Policy is stateless: сервисы создают её как поле `private readonly access = new BudgetAccessPolicy();` (так же, как сейчас `RolePolicy`), DI-регистрация не нужна.

- [x] **Step 3: Участник в транзакции**

```ts
// apps/api/src/common/policies/access-actor.repository.ts
import type { Prisma, PrismaClient } from '@prisma/client';

import { forbidden } from '../reference-data/reference-data.errors.js';
import type { AccessActor } from './budget-access.policy.js';

type Db = Prisma.TransactionClient | PrismaClient;

/** Active membership of an active workspace, read in the caller's transaction. */
export async function findAccessActor(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<AccessActor | null> {
  const membership = await db.workspaceMembership.findFirst({
    where: { workspaceId, userId, isActive: true, workspace: { status: 'ACTIVE' } },
    select: { role: true, workspace: { select: { ownerId: true } } },
  });
  if (!membership) return null;
  return { userId, role: membership.role, isCreator: membership.workspace.ownerId === userId };
}

export async function requireAccessActor(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<AccessActor> {
  const actor = await findAccessActor(db, workspaceId, userId);
  if (!actor) throw forbidden();
  return actor;
}
```

- [x] **Step 4: Общие ссылки на людей (перенос `findAuthors`)**

```ts
// apps/api/src/common/people/person-ref.repository.ts
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

export type PersonRef = { userId: string; displayName: string | null; isActiveMember: boolean };

/** Display data of family members (current or former) of one workspace. */
export async function findPersonRefs(
  db: Db,
  workspaceId: string,
  userIds: string[],
): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.workspaceMembership.findMany({
    where: { workspaceId, userId: { in: unique } },
    select: { userId: true, isActive: true, user: { select: { displayName: true } } },
  });
  return new Map(
    rows.map((row) => [
      row.userId,
      { userId: row.userId, displayName: row.user.displayName, isActiveMember: row.isActive },
    ]),
  );
}

export function personRefOf(refs: Map<string, PersonRef>, userId: string): PersonRef {
  return refs.get(userId) ?? { userId, displayName: null, isActiveMember: false };
}
```

```ts
// apps/api/src/common/people/person-ref.dto.ts
import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'AuthorRefResponse' })
export class PersonRefResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  userId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Алия' })
  displayName!: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'False когда человек исключён из рабочего пространства или вышел из него.',
  })
  isActiveMember!: boolean;
}
```

Если `@ApiSchema` нет в установленной версии `@nestjs/swagger`, оставить имя класса `AuthorRefResponse` в новом файле. Журнал: `findAuthors(budgetId, ids)` заменить на `findPersonRefs(this.prisma, workspaceId, ids)`; `workspaceId` журнал уже получает из бюджета (`budget.workspace`) — если нет, выбрать `workspaceId` в существующем запросе бюджета. `authorOf` → `personRefOf`. Поведение журнала не меняется — `v2-journal.integration.test.ts` должен пройти без правок.

- [x] **Step 5: Тест участника**

```ts
// apps/api/test/family-access-actor.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findAccessActor } from '../src/common/policies/access-actor.repository.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
});

afterAll(async () => {
  await env.stop();
});

describe('findAccessActor', () => {
  it('returns role and creator flag for active members', async () => {
    await expect(findAccessActor(env.prisma, creator.workspaceId, creator.user.id)).resolves.toEqual({
      userId: creator.user.id,
      role: 'OWNER',
      isCreator: true,
    });
    await expect(findAccessActor(env.prisma, creator.workspaceId, editor.user.id)).resolves.toEqual({
      userId: editor.user.id,
      role: 'EDITOR',
      isCreator: false,
    });
  });

  it('returns null for a removed member and for a stranger', async () => {
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: creator.workspaceId, userId: viewer.user.id },
      data: { isActive: false, removedAt: new Date() },
    });
    await expect(findAccessActor(env.prisma, creator.workspaceId, viewer.user.id)).resolves.toBeNull();
    const stranger = await env.register();
    await expect(
      findAccessActor(env.prisma, creator.workspaceId, stranger.user.id),
    ).resolves.toBeNull();
  });
});
```

- [x] **Step 6: Тестовый стенд `FamilyTestApp`**

Взять конфигурацию приложения, `register`, `addMember`, `inject` и очистку из `apps/api/test/family-members.integration.test.ts` (этап A) и собрать в класс. Очистка дополнительно удаляет в порядке FK: `envelope_movements`, `envelope_assignments`, `plan_payments`, `plan_occurrences`, `regular_plans`, `transfer_parts`, `transfers`, `transactions`, `envelope_funding_rules`, `envelope_periods`, затем то, что удаляет этап A. Если для какой-то таблицы есть готовый пример очистки в `v2-assignments.integration.test.ts` или `v2-obligations.integration.test.ts` — повторить его.

```ts
// apps/api/test/helpers/family-app.ts
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { createUuidV7 } from '../../src/common/identifiers/uuid-v7.js';
import { createApiApp } from '../../src/app.js';
import { loadApiConfig } from '../../src/config/env.js';

export const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

export interface FamilyActor {
  user: { id: string; email: string };
  cookie: string;
  csrfToken: string;
  /** Workspace and budget this actor works in (the family's, after `join`). */
  workspaceId: string;
  budgetId: string;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export class FamilyTestApp {
  readonly prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  server!: FastifyInstance;
  private app!: NestFastifyApplication;
  private readonly userIds = new Set<string>();

  async start(): Promise<void> {
    this.app = await createApiApp(
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
    await this.app.init();
    this.server = this.app.getHttpAdapter().getInstance() as FastifyInstance;
    await this.server.ready();
  }

  async register(): Promise<FamilyActor> {
    const email = `family-${randomUUID()}@harmofin.test`;
    const response = await this.server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    const body = response.json<{
      user: { id: string; email: string };
      workspace: { id: string };
      budget: { id: string };
      csrfToken: string;
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error(`Registration failed: ${response.statusCode} ${response.body}`);
    this.userIds.add(body.user.id);
    return {
      user: body.user,
      cookie,
      csrfToken: body.csrfToken,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
    };
  }

  /** Adds `member` to the creator's family and returns the member pointed at that family. */
  async join(
    creator: FamilyActor,
    member: FamilyActor,
    role: 'EDITOR' | 'VIEWER',
  ): Promise<FamilyActor> {
    await this.prisma.workspaceMembership.create({
      data: { id: createUuidV7(), workspaceId: creator.workspaceId, userId: member.user.id, role },
    });
    await this.prisma.user.update({
      where: { id: member.user.id },
      data: { displayName: `Участник ${member.user.email.slice(7, 13)}` },
    });
    return { ...member, workspaceId: creator.workspaceId, budgetId: creator.budgetId };
  }

  inject(
    method: Method,
    url: string,
    actor: FamilyActor,
    payload?: Record<string, unknown>,
  ) {
    const headers: Record<string, string> = { origin };
    if (method !== 'GET') {
      headers['x-csrf-token'] = actor.csrfToken;
      headers['idempotency-key'] = `family-${randomUUID()}`;
    }
    const options: InjectOptions = {
      method,
      url,
      headers,
      cookies: { harmofin_session: actor.cookie },
    };
    if (payload !== undefined) options.payload = payload;
    return this.server.inject(options);
  }

  /** Creates an account through the API as `actor`; returns its id. */
  async createAccount(actor: FamilyActor, name: string, startingBalance = '0'): Promise<string> {
    const response = await this.inject('POST', `/api/v1/budgets/${actor.budgetId}/accounts`, actor, {
      name,
      accountType: 'CASH',
      currency: 'RUB',
      startingBalance,
      accountingStartDate: '2026-01-01',
    });
    if (response.statusCode !== 201) throw new Error(`createAccount ${response.statusCode} ${response.body}`);
    return response.json<{ id: string }>().id;
  }

  /** Creates a CUSTOM envelope through the API as `actor`; returns its id. */
  async createEnvelope(actor: FamilyActor, name: string): Promise<string> {
    const response = await this.inject('POST', `/api/v2/budgets/${actor.budgetId}/envelopes`, actor, {
      name,
      envelopeType: 'CUSTOM',
    });
    if (response.statusCode !== 201) throw new Error(`createEnvelope ${response.statusCode} ${response.body}`);
    return response.json<{ id: string }>().id;
  }

  /** Any active category of the budget with the given type (registration seeds defaults). */
  async categoryId(budgetId: string, type: 'INCOME' | 'EXPENSE'): Promise<string> {
    const category = await this.prisma.category.findFirst({
      where: { budgetId, categoryType: type, archivedAt: null },
      select: { id: true },
    });
    if (category) return category.id;
    const created = await this.prisma.category.create({
      data: { id: createUuidV7(), budgetId, name: `${type}-${randomUUID().slice(0, 8)}`, categoryType: type },
      select: { id: true },
    });
    return created.id;
  }

  /** Records a confirmed income or expense through the API as `actor`; returns its id. */
  async record(
    actor: FamilyActor,
    input: { type: 'INCOME' | 'EXPENSE'; accountId: string; amount: string; envelopeId?: string },
  ): Promise<string> {
    const response = await this.inject('POST', `/api/v2/budgets/${actor.budgetId}/transactions`, actor, {
      transactionType: input.type,
      status: 'CONFIRMED',
      amount: input.amount,
      occurredOn: new Date().toISOString().slice(0, 10),
      accountId: input.accountId,
      categoryId: await this.categoryId(actor.budgetId, input.type),
      envelopeId: input.envelopeId ?? null,
    });
    if (response.statusCode !== 201) throw new Error(`record ${response.statusCode} ${response.body}`);
    return response.json<{ id: string }>().id;
  }

  async stop(): Promise<void> {
    // Delete every row created for the registered users' workspaces, children first.
    // Follow the cleanup of family-members.integration.test.ts and extend it with the
    // financial tables listed in Step 6 of Task 2 of the stage B plan.
    await this.cleanup();
    await this.app.close();
    await this.prisma.$disconnect();
  }

  private async cleanup(): Promise<void> {
    const workspaceIds = new Set<string>();
    for (const userId of this.userIds) {
      for (const { workspaceId } of await this.prisma.workspaceMembership.findMany({
        where: { userId },
        select: { workspaceId: true },
      })) {
        workspaceIds.add(workspaceId);
      }
    }
    const ids = [...workspaceIds];
    const budgetIds = (
      await this.prisma.budget.findMany({ where: { workspaceId: { in: ids } }, select: { id: true } })
    ).map((budget) => budget.id);
    const byBudget = { budgetId: { in: budgetIds } };
    await this.prisma.notification.deleteMany({ where: { workspaceId: { in: ids } } });
    await this.prisma.idempotencyRecord.deleteMany({ where: byBudget });
    await this.prisma.envelopeMovement.deleteMany({ where: byBudget });
    await this.prisma.envelopeAssignment.deleteMany({ where: byBudget });
    await this.prisma.planPayment.deleteMany({ where: byBudget });
    await this.prisma.planOccurrence.deleteMany({ where: byBudget });
    await this.prisma.regularPlan.deleteMany({ where: byBudget });
    await this.prisma.transferPart.deleteMany({ where: byBudget });
    await this.prisma.transfer.deleteMany({ where: byBudget });
    await this.prisma.transaction.deleteMany({ where: byBudget });
    await this.prisma.envelopeFundingRule.deleteMany({ where: byBudget });
    await this.prisma.envelopePeriod.deleteMany({ where: byBudget });
    await this.prisma.budgetCycleRevision.deleteMany({ where: byBudget });
    await this.prisma.workspaceInvitation.deleteMany({ where: { workspaceId: { in: ids } } });
    await this.prisma.auditEvent.deleteMany({ where: { workspaceId: { in: ids } } });
    await this.prisma.budget.updateMany({
      where: { id: { in: budgetIds } },
      data: { incomeAllocationSourceCategoryId: null, incomeAllocationTargetEnvelopeId: null },
    });
    await this.prisma.account.deleteMany({ where: byBudget });
    await this.prisma.envelope.deleteMany({ where: byBudget });
    await this.prisma.category.deleteMany({ where: byBudget });
    await this.prisma.budget.deleteMany({ where: { id: { in: budgetIds } } });
    for (const userId of this.userIds) {
      await this.prisma.session.deleteMany({ where: { userId } });
      await this.prisma.recoveryToken.deleteMany({ where: { userId } });
      await this.prisma.userConsent.deleteMany({ where: { userId } });
    }
    await this.prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: ids } } });
    await this.prisma.workspace.deleteMany({ where: { id: { in: ids } } });
    await this.prisma.user.deleteMany({ where: { id: { in: [...this.userIds] } } });
  }
}
```

Имена моделей и полей сверить со `schema.prisma` (например, `idempotencyRecord.budgetId`, `transferPart.budgetId`, `budgetCycleRevision.budgetId`); если у модели нет `budgetId` — удалять через связь, как в существующих тестах. Если регистрация сама создаёт категории — `categoryId` возьмёт существующую. Если `POST envelopes` требует шаблон или онбординг — повторить подготовку из `v2-envelopes.integration.test.ts` внутри `register()`.

Важно: на этапе B `EDITOR` впервые создаёт счета и конверты через API (до задач 3–4 это даёт 403). Поэтому тест задачи 2 использует только `findAccessActor`; `createAccount`/`createEnvelope` от имени `EDITOR` начинают работать после задач 3 и 4.

- [x] **Step 7: Проверки**

Run:
- `pnpm --filter @harmofin/api exec vitest run src/common/policies` — PASS.
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-access-actor.integration.test.ts test/v2-journal.integration.test.ts test/v2-openapi.integration.test.ts` — PASS.
- `pnpm --filter @harmofin/api typecheck` и `pnpm lint` — PASS.

- [x] **Step 8: Commit**

```bash
git add apps/api/src/common/policies apps/api/src/common/people apps/api/src/v2-journal apps/api/test/helpers/family-app.ts apps/api/test/family-access-actor.integration.test.ts
git commit -m "feat(api): политика доступа семьи и общие ссылки на участников"
```

---

### Task 3: Счета — создают все writer, правит только владелец

**Files:**
- Modify: `apps/api/src/accounts/account.application.service.ts`
- Modify: `apps/api/src/accounts/account.repository.ts`
- Modify: `apps/api/src/accounts/account.controller.ts`, `account.dto.ts`, `account.schemas.ts`, `account.module.ts`
- Modify: `apps/api/src/accounts/account.application.service.test.ts`
- Test: `apps/api/test/family-accounts-ownership.integration.test.ts`

**Interfaces:**
- Consumes: `BudgetAccessPolicy`, `requireAccessActor`, `findPersonRefs`, `personRefOf`, `PersonRefResponse` (Task 2); `Account.ownerUserId` (Task 1).
- Produces:
  - `AccountView` + `owner: PersonRef`, `canEdit: boolean`.
  - `GET budgets/:budgetId/accounts?status=…&ownerUserId=<uuid>`; `summary` принимает тот же фильтр.
  - Ошибка `NOT_OBJECT_OWNER` на `PATCH`, `archive`, `restore` чужого счёта.

- [x] **Step 1: Падающий integration-тест**

```ts
// apps/api/test/family-accounts-ownership.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let creatorAccountId: string;

const accounts = (actor: FamilyActor) => `/api/v1/budgets/${actor.budgetId}/accounts`;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  creatorAccountId = await env.createAccount(creator, 'Карта создателя', '1000');
});

afterAll(async () => {
  await env.stop();
});

describe('account ownership', () => {
  it('an editor creates an own account and sees owner and canEdit', async () => {
    const response = await env.inject('POST', accounts(editor), editor, {
      name: 'Карта участника',
      accountType: 'BANK_CARD',
      currency: 'RUB',
      startingBalance: '500',
      accountingStartDate: '2026-01-01',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      owner: { userId: editor.user.id, isActiveMember: true },
      canEdit: true,
    });
  });

  it('a viewer cannot create accounts', async () => {
    const response = await env.inject('POST', accounts(viewer), viewer, {
      name: 'Нельзя',
      accountType: 'CASH',
      currency: 'RUB',
      startingBalance: '0',
      accountingStartDate: '2026-01-01',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('everyone sees every account; canEdit is true only for the owner', async () => {
    const response = await env.inject('GET', accounts(editor), editor);
    expect(response.statusCode).toBe(200);
    const rows = response.json<Array<{ id: string; canEdit: boolean; owner: { userId: string } }>>();
    const creatorRow = rows.find((row) => row.id === creatorAccountId);
    expect(creatorRow).toMatchObject({ canEdit: false, owner: { userId: creator.user.id } });
  });

  it('the editor cannot rename, archive or restore the creator account', async () => {
    const rename = await env.inject('PATCH', `${accounts(editor)}/${creatorAccountId}`, editor, {
      name: 'Чужое',
    });
    expect(rename.statusCode).toBe(403);
    expect(rename.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
    const archive = await env.inject('POST', `${accounts(editor)}/${creatorAccountId}/archive`, editor);
    expect(archive.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('the creator has no override on the editor account', async () => {
    const editorAccountId = await env.createAccount(editor, 'Наличные участника');
    const rename = await env.inject('PATCH', `${accounts(creator)}/${editorAccountId}`, creator, {
      name: 'Переименовал создатель',
    });
    expect(rename.statusCode).toBe(403);
    expect(rename.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('filters by owner and keeps the summary consistent with the filtered list', async () => {
    const list = await env.inject('GET', `${accounts(creator)}?ownerUserId=${editor.user.id}`, creator);
    const rows = list.json<Array<{ owner: { userId: string } }>>();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.owner.userId === editor.user.id)).toBe(true);
    const summary = await env.inject(
      'GET',
      `${accounts(creator)}/summary?ownerUserId=${editor.user.id}`,
      creator,
    );
    expect(summary.json<{ count: number }>().count).toBe(rows.length);
  });

  it('rejects a malformed ownerUserId', async () => {
    const response = await env.inject('GET', `${accounts(creator)}?ownerUserId=nope`, creator);
    expect(response.statusCode).toBe(400);
  });

  it('a stranger still gets 404 for the family accounts', async () => {
    const stranger = await env.register();
    const response = await env.inject('GET', `/api/v1/budgets/${creator.budgetId}/accounts`, stranger);
    expect(response.statusCode).toBe(404);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-accounts-ownership.integration.test.ts`
Expected: FAIL (editor gets 403 on create, no `owner`/`canEdit`).

- [x] **Step 2: Репозиторий**

В `account.repository.ts`:
1. `accountSelect` + `ownerUserId: true`; `AccountRecord` + `ownerUserId: string`.
2. `activeOwnerBudgetWhere` удалить; все мутации (`create`, `update`, `archive`, `restore`) используют `activeBudgetWhere(userId, budgetId)` — право решает сервис.
3. `update`, `archive`, `restore` получают дополнительный параметр `authorize: (current: AccountRecord, tx: Prisma.TransactionClient) => Promise<void>`, который вызывается сразу после чтения `current` и **до** `lockBudget`/записи. Сервис передаёт туда проверку участника и владельца (участник читается в той же транзакции).
4. `create` получает `authorize: (tx) => Promise<void>` и вызывает его после проверки бюджета, до записи.
5. `list(userId, budgetId, status, ownerUserId?: string)` — `where` дополняется `...(ownerUserId ? { ownerUserId } : {})`.
6. `auditValues` + `ownerUserId`.

- [x] **Step 3: Сервис**

```ts
// account.application.service.ts — the parts that change
import { requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy, type AccessActor } from '../common/policies/budget-access.policy.js';
import { findPersonRefs, personRefOf, type PersonRef } from '../common/people/person-ref.repository.js';

export interface AccountView {
  // ...existing fields...
  owner: PersonRef;
  canEdit: boolean;
}

// constructor: replace `private readonly rolePolicy: RolePolicy` with
//   private readonly access = new BudgetAccessPolicy(),
// and update account.module.ts factory accordingly (drop RolePolicy from providers/inject).

async list(userId: string, budgetId: string, status: ReferenceDataStatus, ownerUserId?: string) {
  const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
  if (!budget) throw resourceNotFound();
  const rows = await this.repository.list(userId, budgetId, status, ownerUserId);
  return this.toViews(rows, budget, userId);
}

async create(userId: string, budgetId: string, input: CreateAccountInput, requestId?: string) {
  const budget = await this.requireBudget(userId, budgetId);
  const account = await this.repository.create(
    userId,
    this.createData(budgetId, userId, input, budget.allowNegativeBalance),
    requestId,
    this.unbackedGuard(budget),
    async (tx) => {
      this.access.requireWriter(await requireAccessActor(tx, budget.workspaceId, userId));
    },
  );
  if (!account) throw resourceNotFound();
  return (await this.toViews([account], budget, userId))[0]!;
}

// update / archive / restore: same shape, the authorize callback is
//   async (current, tx) => {
//     const actor = await requireAccessActor(tx, budget.workspaceId, userId);
//     this.access.requireObjectOwner(actor, current);
//   }

private async requireBudget(userId: string, budgetId: string) {
  const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
  if (!budget) throw resourceNotFound();
  return budget;
}

private async toViews(
  rows: AccountRecord[],
  budget: { workspaceId: string; workspace: { memberships: Array<{ role: WorkspaceMembershipRole }> } },
  userId: string,
): Promise<AccountView[]> {
  const people = await this.repository.personRefs(
    budget.workspaceId,
    rows.map((row) => row.ownerUserId),
  );
  const role = budget.workspace.memberships[0]?.role;
  const actor: AccessActor | null = role ? { userId, role, isCreator: false } : null;
  return rows.map((row) => ({
    ...this.toView(row),
    owner: personRefOf(people, row.ownerUserId),
    canEdit: actor !== null && this.access.canEditObject(actor, row),
  }));
}
```

`canEdit` — подсказка для UI (writer и владелец). Роль уже есть в результате `findAccessibleWithRole` (`budget.workspace.memberships[0]?.role`), отдельный запрос не нужен; `isCreator` в `canEditObject` не участвует. В `findAccessibleWithRole` добавить `workspaceId` в `select`, если его нет. `AccountRepository.personRefs(workspaceId, userIds)` — новый метод-обёртка `findPersonRefs(this.prisma, workspaceId, userIds)`, чтобы сервис не обращался к Prisma напрямую. `get` тоже возвращает `owner`/`canEdit` (для него нужен `findAccessibleWithRole`). `restore` сохраняет текущую проверку `planModelVersion`.

`createData(budgetId, ownerUserId, input, allow)` — второй параметр добавлен в задаче 1.

- [x] **Step 4: Контроллер, схемы, DTO**

- `account.schemas.ts`: `listAccountsQuerySchema` (если есть, иначе схема query в контроллере) + `ownerUserId: z.string().uuid().optional()`.
- `account.controller.ts`: `list` и `summary` принимают `ownerUserId` (`@ApiQuery({ name: 'ownerUserId', required: false, type: String, format: 'uuid' })`), передают в сервис.
- `account.dto.ts` `AccountResponse`: `@ApiProperty({ type: PersonRefResponse }) owner!: PersonRefResponse;` и `@ApiProperty({ type: Boolean, description: 'Подсказка для интерфейса: текущий пользователь может изменять счёт. Право проверяет сервер.' }) canEdit!: boolean;`. В описание 403 у `PATCH`/`archive`/`restore` добавить коды `FORBIDDEN`, `NOT_OBJECT_OWNER` (`@ApiResponse({ status: 403, type: ProblemDetailsResponse, description: 'FORBIDDEN — нет права записи; NOT_OBJECT_OWNER — счёт принадлежит другому участнику.' })`).
- `account.application.service.test.ts`: обновить моки под новую сигнатуру; добавить unit-кейс «update вызывает authorize до записи».

- [x] **Step 5: Проверки**

Run:
- `pnpm --filter @harmofin/api exec vitest run src/accounts` — PASS.
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-accounts-ownership.integration.test.ts test/v2-accounts.integration.test.ts test/v2-openapi.integration.test.ts` — PASS. Если существующий тест проверяет «`EDITOR` не может создать счёт» — это поведение этапа A, оно меняется намеренно: тест переписать на `VIEWER`.
- `pnpm --filter @harmofin/api typecheck`, `pnpm lint` — PASS.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/accounts apps/api/test/family-accounts-ownership.integration.test.ts apps/api/test/v2-accounts.integration.test.ts
git commit -m "feat(api): владелец счёта и права на изменение"
```

---

### Task 4: Конверты, цели периодов и правила наполнения — по владельцу конверта

**Files:**
- Modify: `apps/api/src/envelope-plans/envelope-plan.repository.ts` (`ENVELOPE_SELECT`, `EnvelopePlanRecord`, `findEnvelope`, список с фильтром владельца, `auditValues`)
- Modify: `apps/api/src/envelope-plans/envelope-plan.application.service.ts`
- Modify: `apps/api/src/envelope-plans/period-target.application.service.ts`
- Modify: `apps/api/src/envelope-plans/funding-rules-batch.application.service.ts`
- Modify: `apps/api/src/funding/income-category-suggestion.application.service.ts`
- Modify: `apps/api/src/envelope-plans/envelope-plan.controller.ts`, `envelope-plan.dto.ts`, `envelope-plan.schemas.ts`
- Test: `apps/api/test/family-envelopes-ownership.integration.test.ts`
- Test: `apps/api/src/envelope-plans/funding-rules-diff.test.ts`

**Interfaces:**
- Consumes: Task 2 (`BudgetAccessPolicy`, `requireAccessActor`, `findAccessActor`, `findPersonRefs`, `personRefOf`, `PersonRefResponse`), `Envelope.ownerUserId` (Task 1).
- Produces:
  - `EnvelopePlanRecord.ownerUserId: string` (используется задачами 5, 9, 10).
  - Тело конверта (`EnvelopePlanBody`, `EnvelopePlanResponse`) + `owner: PersonRef`, `canEdit: boolean`.
  - `GET envelopes?ownerUserId=<uuid>`.
  - `NOT_OBJECT_OWNER` на `PATCH envelopes/:id`, `POST envelopes/:id/archive`, `PUT envelopes/:id/funding-rule`, `PUT envelopes/:id/periods/:periodStart/target`, `POST periods/:periodId/confirm-target|reject-target`, `PUT funding-rules` (изменено чужое правило).
  - `FORBIDDEN` для не-`OWNER` на `PUT income-category-suggestion` и при изменении `incomeSuggestion` в `PUT funding-rules`.
  - `export function changedRuleEnvelopeIds(existing, desired): string[]` в `envelope-plans/funding-rules-diff.ts`.

- [x] **Step 1: Падающие тесты**

```ts
// apps/api/test/family-envelopes-ownership.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let creatorEnvelopeId: string;
let editorEnvelopeId: string;

const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  creatorEnvelopeId = await env.createEnvelope(creator, 'Отпуск');
  editorEnvelopeId = await env.createEnvelope(editor, 'Расходы на детей');
});

afterAll(async () => {
  await env.stop();
});

describe('envelope ownership', () => {
  it('an editor creates an envelope that belongs to the editor', async () => {
    const response = await env.inject('GET', `${v2(editor)}/envelopes/${editorEnvelopeId}`, editor);
    expect(response.json()).toMatchObject({ owner: { userId: editor.user.id }, canEdit: true });
  });

  it('a viewer cannot create envelopes', async () => {
    const response = await env.inject('POST', `${v2(viewer)}/envelopes`, viewer, {
      name: 'Нельзя',
      envelopeType: 'CUSTOM',
    });
    expect(response.statusCode).toBe(403);
  });

  it('list shows all envelopes with canEdit per owner and filters by owner', async () => {
    const all = await env.inject('GET', `${v2(creator)}/envelopes`, creator);
    const items = all.json<{ items: Array<{ id: string; canEdit: boolean }> }>().items;
    expect(items.find((item) => item.id === creatorEnvelopeId)?.canEdit).toBe(true);
    expect(items.find((item) => item.id === editorEnvelopeId)?.canEdit).toBe(false);
    const filtered = await env.inject(
      'GET',
      `${v2(creator)}/envelopes?ownerUserId=${editor.user.id}`,
      creator,
    );
    const ids = filtered.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id);
    expect(ids).toEqual([editorEnvelopeId]);
  });

  it('the creator gets NOT_OBJECT_OWNER renaming the editor envelope', async () => {
    const response = await env.inject('PATCH', `${v2(creator)}/envelopes/${editorEnvelopeId}`, creator, {
      name: 'Чужой',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('the creator gets NOT_OBJECT_OWNER archiving the editor envelope', async () => {
    const response = await env.inject(
      'POST',
      `${v2(creator)}/envelopes/${editorEnvelopeId}/archive`,
      creator,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('only the creator changes the income category suggestion', async () => {
    const response = await env.inject('PUT', `${v2(editor)}/income-category-suggestion`, editor, {
      enabled: false,
      sourceCategoryId: null,
      targetEnvelopeId: null,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });
});
```

Добавить в этот же файл ещё четыре кейса, тела запросов взять из существующих тестов, ожидания — указанные:
1. `PUT envelopes/:editorEnvelopeId/funding-rule` от создателя (тело — из `v2-funding-rules.integration.test.ts`) → 403 `NOT_OBJECT_OWNER`; от участника → 200.
2. `PUT envelopes/:editorEnvelopeId/periods/:periodStart/target` от создателя → `NOT_OBJECT_OWNER` (подготовка — из `v2-envelopes.integration.test.ts`/`v2-funding-rules.integration.test.ts`; если для цели нужен конверт `CURRENT_EXPENSES`, участник создаёт его со свободным слотом).
3. `PUT funding-rules` (тело — из `v2-funding-rules-batch.integration.test.ts`): участник отправляет текущие правила без изменений плюс правило своего конверта → 200; участник добавляет правило конверта создателя → 403 `NOT_OBJECT_OWNER`; участник меняет `incomeSuggestion` → 403 `FORBIDDEN`.
4. `POST periods/:periodId/confirm-target` чужого конверта → `NOT_OBJECT_OWNER`.

```ts
// apps/api/src/envelope-plans/funding-rules-diff.test.ts
import { describe, expect, it } from 'vitest';

import { changedRuleEnvelopeIds, type RuleShape } from './funding-rules-diff.js';

const rule = (envelopeId: string, priority = 1): RuleShape => ({
  envelopeId,
  type: 'FIXED_PER_PERIOD',
  priority,
  fixedMinor: 1000n,
  percentBasisPoints: null,
});

describe('changedRuleEnvelopeIds', () => {
  it('ignores unchanged rules', () => {
    expect(changedRuleEnvelopeIds([rule('a'), rule('b')], [rule('a'), rule('b')])).toEqual([]);
  });

  it('reports created, changed and removed rules', () => {
    expect(
      changedRuleEnvelopeIds([rule('a'), rule('b')], [rule('a', 2), rule('c')]).sort(),
    ).toEqual(['a', 'b', 'c']);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/envelope-plans/funding-rules-diff.test.ts` и `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-envelopes-ownership.integration.test.ts`
Expected: FAIL.

- [x] **Step 2: Репозиторий конвертов**

- `ENVELOPE_SELECT` + `ownerUserId: true`; `EnvelopePlanRecord` + `ownerUserId: string`; `auditValues` + `ownerUserId`.
- Метод списка конвертов (его вызывает `EnvelopePlanApplicationService.list`) принимает `ownerUserId?: string` и добавляет `...(ownerUserId ? { ownerUserId } : {})` в `where`.

- [x] **Step 3: Сервис конвертов**

```ts
// envelope-plan.application.service.ts — the parts that change
import { findAccessActor, requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy, type AccessActor } from '../common/policies/budget-access.policy.js';
import {
  findPersonRefs,
  personRefOf,
  type PersonRef,
} from '../common/people/person-ref.repository.js';

type EnvelopePlanBody = {
  // ...existing fields...
  owner: PersonRef;
  canEdit: boolean;
};

// field, replaces rolePolicy:
private readonly access = new BudgetAccessPolicy();

// create, inside the idempotency callback (replaces requireManageRole):
this.access.requireWriter(await requireAccessActor(tx, model.workspaceId, userId));

// update and archive, inside the idempotency callback (replaces requireManageRole);
// `current` is read after lockBudget by findEnvelope and now carries ownerUserId:
this.access.requireObjectOwner(await requireAccessActor(tx, model.workspaceId, userId), current);

// body builder: owner and canEdit for a page of envelopes
private async bodies(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  envelopes: EnvelopePlanRecord[],
  totals: Map<string, { funded: bigint; spent: bigint; balance: bigint }>,
  periods: Map<string, EnvelopePeriodBody[]>,
): Promise<EnvelopePlanBody[]> {
  const [people, actor] = await Promise.all([
    findPersonRefs(tx, workspaceId, envelopes.map((envelope) => envelope.ownerUserId)),
    findAccessActor(tx, workspaceId, userId),
  ]);
  return envelopes.map((envelope) => ({
    ...this.toBody(envelope, totals, periods),
    owner: personRefOf(people, envelope.ownerUserId),
    canEdit: actor !== null && this.access.canEditObject(actor, envelope),
  }));
}
```

`create`, `update`, `archive`, `list`, `get` возвращают тела через `bodies(…)`; тип `totals` взять из `totalsByEnvelope`. `requireManageRole` удалить, импорт `forbidden` убрать, если больше не нужен. `list` принимает `ownerUserId?: string` и передаёт в репозиторий.

- [x] **Step 4: Цели периодов и правило конверта**

В `period-target.application.service.ts` поле `access`; `requireManageRole` удалить:
- `putFundingRule(…, envelopeId, …)` и `putPeriodTarget(…, envelopeId, …)`: внутри idempotency —

```ts
const actor = await requireAccessActor(tx, model.workspaceId, userId);
const envelope = await this.envelopes.findEnvelope(tx, budgetId, envelopeId);
this.access.requireObjectOwner(actor, envelope);
```

(`this.envelopes` — экземпляр `EnvelopePlanRepository`; если в сервисе его нет, добавить поле `private readonly envelopes = new EnvelopePlanRepository();`.)
- `decideTarget(periodId)`: период читается с фильтром `budgetId` (как сейчас); затем `findEnvelope(tx, budgetId, period.envelopeId)` → `requireObjectOwner`.

- [x] **Step 5: Пакет правил и предложение по категории дохода**

```ts
// apps/api/src/envelope-plans/funding-rules-diff.ts
export type RuleShape = {
  envelopeId: string;
  type: string;
  priority: number;
  fixedMinor: bigint | null;
  percentBasisPoints: number | null;
};

const key = (rule: RuleShape): string =>
  [rule.type, rule.priority, rule.fixedMinor?.toString() ?? '', rule.percentBasisPoints ?? ''].join('|');

/** Envelopes whose funding rule a batch creates, changes or removes. */
export function changedRuleEnvelopeIds(existing: RuleShape[], desired: RuleShape[]): string[] {
  const before = new Map(existing.map((rule) => [rule.envelopeId, key(rule)]));
  const after = new Map(desired.map((rule) => [rule.envelopeId, key(rule)]));
  const ids = new Set<string>();
  for (const [id, value] of after) if (before.get(id) !== value) ids.add(id);
  for (const id of before.keys()) if (!after.has(id)) ids.add(id);
  return [...ids];
}
```

Если `putBatch` не удаляет правила, отсутствующие в `desired` (проверить по текущему коду ниже `existing` в `putBatch`), вторую петлю убрать и тест «removed» заменить на «created and changed». Имена полей правила сверить с `FundingRuleRepository.listRules`.

`funding-rules-batch.application.service.ts` внутри idempotency, вместо `requireManageRole`:

```ts
const actor = await requireAccessActor(tx, model.workspaceId, userId);
this.access.requireWriter(actor);
await this.assertEnvelopes(tx, budgetId, desired);
const existingRules = await this.rules.listRules(tx, budgetId);
const changed = changedRuleEnvelopeIds(existingRules, desired);
if (changed.length > 0) {
  const owners = await tx.envelope.findMany({
    where: { budgetId, id: { in: changed } },
    select: { ownerUserId: true },
  });
  for (const envelope of owners) this.access.requireObjectOwner(actor, envelope);
}
const currentSuggestion = await this.suggestions.read(tx, budgetId);
if (
  currentSuggestion.enabled !== suggestion.enabled ||
  currentSuggestion.sourceCategoryId !== suggestion.sourceCategoryId ||
  currentSuggestion.targetEnvelopeId !== suggestion.targetEnvelopeId
) {
  this.access.requireBudgetSettings(actor);
}
```

Метод чтения текущего предложения в `IncomeCategorySuggestionRepository` назван здесь `read` — использовать существующий (если его нет — добавить `read(tx, budgetId)`, читающий поля `incomeAllocationSourceCategoryId`/`incomeAllocationTargetEnvelopeId` бюджета с фильтром `id: budgetId`). Ниже по `putBatch` переменная `existing` уже читает правила — переиспользовать `existingRules`, не читать дважды.

`income-category-suggestion.application.service.ts`: вместо блока `membership … canManage` —

```ts
this.access.requireBudgetSettings(await requireAccessActor(tx, model.workspaceId, userId));
```

- [x] **Step 6: Контроллер, схемы, DTO**

- `envelope-plan.schemas.ts`: query списка конвертов + `ownerUserId: z.string().uuid().optional()`.
- `envelope-plan.controller.ts` `GET envelopes`: `@ApiQuery({ name: 'ownerUserId', required: false, type: String })`, передать в сервис.
- `envelope-plan.dto.ts` `EnvelopePlanResponse`: `owner: PersonRefResponse`, `canEdit: boolean` (описание как у счетов). У изменяющих эндпоинтов описание 403: «`FORBIDDEN` — нет права записи; `NOT_OBJECT_OWNER` — конверт принадлежит другому участнику».

- [x] **Step 7: Проверки**

Run:
- `pnpm --filter @harmofin/api exec vitest run src/envelope-plans src/funding` — PASS.
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-envelopes-ownership.integration.test.ts test/v2-envelopes.integration.test.ts test/v2-funding-rules.integration.test.ts test/v2-funding-rules-batch.integration.test.ts test/v2-openapi.integration.test.ts` — PASS. Тесты, где `EDITOR` ожидал 403 на создание конверта или правила, переписать на `VIEWER` (поведение меняется по дизайну).
- `pnpm --filter @harmofin/api typecheck`, `pnpm lint` — PASS.

- [x] **Step 8: Commit**

```bash
git add apps/api/src/envelope-plans apps/api/src/funding/income-category-suggestion.application.service.ts apps/api/src/funding/income-category-suggestion.repository.ts apps/api/test
git commit -m "feat(api): владелец конверта, цели и правила наполнения только своих конвертов"
```

---

### Task 5: Распределения и перемещения — свой доход, свободные деньги в любой конверт, вынимать только из своего

**Files:**
- Modify: `apps/api/src/envelope-plans/assignment.repository.ts` (`requireIncome`, `requireEnvelope`, `lockAssignment` возвращают автора/владельца)
- Modify: `apps/api/src/envelope-plans/assignment.application.service.ts`
- Modify: `apps/api/src/envelope-plans/movement.repository.ts` (исходный конверт с владельцем)
- Modify: `apps/api/src/envelope-plans/movement.application.service.ts`
- Modify: `apps/api/src/funding/funding-preview.application.service.ts`, `funding-confirm.application.service.ts`
- Modify: `apps/api/src/envelope-plans/envelope-plan.controller.ts`, `apps/api/src/funding/funding.controller.ts` (описания 403)
- Test: `apps/api/test/family-allocations.integration.test.ts`

**Interfaces:**
- Consumes: Task 2; `EnvelopePlanRecord.ownerUserId` (Task 4); авторы распределений и перемещений (Task 1).
- Produces (правила по деньгам из матрицы):
  - `POST assignments` `FREE` — любой writer, любой конверт; `OPENING` (если путь достижим через `assignFree`) — только свой конверт (`NOT_OBJECT_OWNER`); с `incomeTransactionId` — только свой доход (`NOT_INCOME_AUTHOR`), любой конверт.
  - `PATCH`/`DELETE assignments/:id` — только автор распределения (`NOT_OPERATION_AUTHOR`).
  - `POST movements` — исходный конверт свой (`NOT_OBJECT_OWNER`), получатель любой или свободные деньги.
  - `POST funding/preview`, `POST funding/confirm` — writer; `INCOME` — свой доход; строки `OPENING` — свои конверты; `confirmPeriodTargets` — периоды своих конвертов.
- Финансовые формулы (защищённые деньги, `freeToAssign`, лимит дохода, остаток источника) **не меняются**; меняется только, кто может вызвать операцию.

- [x] **Step 1: Падающий integration-тест с финансовыми инвариантами**

```ts
// apps/api/test/family-allocations.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let creatorEnvelopeId: string; // «Отпуск»
let editorEnvelopeId: string; // «Расходы на детей»
let creatorIncomeId: string;
let editorIncomeId: string;

const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;

async function envelopeBalance(envelopeId: string): Promise<bigint> {
  const response = await env.inject('GET', `${v2(creator)}/envelopes/${envelopeId}`, creator);
  return BigInt(response.json<{ balanceMinor: string }>().balanceMinor);
}

async function totalEnvelopeMoney(): Promise<bigint> {
  const response = await env.inject('GET', `${v2(creator)}/envelopes`, creator);
  return response
    .json<{ items: Array<{ balanceMinor: string }> }>()
    .items.reduce((sum, item) => sum + BigInt(item.balanceMinor), 0n);
}

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  const creatorAccountId = await env.createAccount(creator, 'Счёт создателя');
  const editorAccountId = await env.createAccount(editor, 'Счёт участника');
  creatorEnvelopeId = await env.createEnvelope(creator, 'Отпуск');
  editorEnvelopeId = await env.createEnvelope(editor, 'Расходы на детей');
  creatorIncomeId = await env.record(creator, {
    type: 'INCOME',
    accountId: creatorAccountId,
    amount: '50000',
  });
  editorIncomeId = await env.record(editor, {
    type: 'INCOME',
    accountId: editorAccountId,
    amount: '30000',
  });
});

afterAll(async () => {
  await env.stop();
});

describe('income allocation', () => {
  it('rejects allocating someone else’s income', async () => {
    const response = await env.inject('POST', `${v2(editor)}/assignments`, editor, {
      incomeTransactionId: creatorIncomeId,
      envelopeId: editorEnvelopeId,
      amount: '100',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_INCOME_AUTHOR' });
  });

  it('own income into a foreign envelope changes only that envelope', async () => {
    const otherBefore = await envelopeBalance(creatorEnvelopeId);
    const targetBefore = await envelopeBalance(editorEnvelopeId);
    const response = await env.inject('POST', `${v2(creator)}/assignments`, creator, {
      incomeTransactionId: creatorIncomeId,
      envelopeId: editorEnvelopeId,
      amount: '10000',
    });
    expect(response.statusCode).toBe(201);
    expect(await envelopeBalance(editorEnvelopeId)).toBe(targetBefore + 1_000_000n);
    expect(await envelopeBalance(creatorEnvelopeId)).toBe(otherBefore);
    const row = await env.prisma.envelopeAssignment.findFirstOrThrow({
      where: { budgetId: creator.budgetId, sourceIncomeTransactionId: creatorIncomeId },
      select: { createdByUserId: true },
    });
    expect(row.createdByUserId).toBe(creator.user.id);
  });

  it('the income limit still holds for the author', async () => {
    const response = await env.inject('POST', `${v2(creator)}/assignments`, creator, {
      incomeTransactionId: creatorIncomeId,
      envelopeId: creatorEnvelopeId,
      amount: '40000.01',
    });
    expect(response.statusCode).toBe(409);
  });

  it('a viewer cannot allocate', async () => {
    const response = await env.inject('POST', `${v2(viewer)}/assignments`, viewer, {
      envelopeId: editorEnvelopeId,
      amount: '1',
      sourceKind: 'FREE',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('free money', () => {
  it('any editor allocates free money into any envelope', async () => {
    const response = await env.inject('POST', `${v2(editor)}/assignments`, editor, {
      envelopeId: creatorEnvelopeId,
      amount: '500',
      sourceKind: 'FREE',
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ freeToAssignMinor: string; balanceMinor: string }>();
    const row = await env.prisma.envelopeAssignment.findUniqueOrThrow({
      where: { id: response.json<{ assignmentId: string }>().assignmentId },
      select: { createdByUserId: true, type: true },
    });
    expect(row).toEqual({ createdByUserId: editor.user.id, type: 'FREE' });
    expect(BigInt(body.balanceMinor)).toBe(await envelopeBalance(creatorEnvelopeId));
  });
});

describe('changing an allocation', () => {
  it('only its author revises or cancels it', async () => {
    const created = await env.inject('POST', `${v2(editor)}/assignments`, editor, {
      incomeTransactionId: editorIncomeId,
      envelopeId: editorEnvelopeId,
      amount: '300',
    });
    expect(created.statusCode).toBe(201);
    const assignmentId = created.json<{ assignmentId: string }>().assignmentId;
    const revise = await env.inject('PATCH', `${v2(creator)}/assignments/${assignmentId}`, creator, {
      amount: '100',
    });
    expect(revise.statusCode).toBe(403);
    expect(revise.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });
    const cancel = await env.inject('DELETE', `${v2(creator)}/assignments/${assignmentId}`, creator);
    expect(cancel.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });
    const own = await env.inject('DELETE', `${v2(editor)}/assignments/${assignmentId}`, editor);
    expect(own.statusCode).toBe(200);
  });
});

describe('moving money between envelopes', () => {
  it('rejects moving out of a foreign envelope', async () => {
    const response = await env.inject('POST', `${v2(creator)}/movements`, creator, {
      sourceEnvelopeId: editorEnvelopeId,
      destinationEnvelopeId: creatorEnvelopeId,
      amount: '100',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('moves out of an own envelope into a foreign one; total envelope money unchanged', async () => {
    const totalBefore = await totalEnvelopeMoney();
    const sourceBefore = await envelopeBalance(editorEnvelopeId);
    const targetBefore = await envelopeBalance(creatorEnvelopeId);
    const response = await env.inject('POST', `${v2(editor)}/movements`, editor, {
      sourceEnvelopeId: editorEnvelopeId,
      destinationEnvelopeId: creatorEnvelopeId,
      amount: '100',
    });
    expect(response.statusCode).toBe(201);
    expect(await envelopeBalance(editorEnvelopeId)).toBe(sourceBefore - 10_000n);
    expect(await envelopeBalance(creatorEnvelopeId)).toBe(targetBefore + 10_000n);
    expect(await totalEnvelopeMoney()).toBe(totalBefore);
    const movement = await env.prisma.envelopeMovement.findUniqueOrThrow({
      where: { id: response.json<{ movementId: string }>().movementId },
      select: { createdByUserId: true },
    });
    expect(movement.createdByUserId).toBe(editor.user.id);
  });
});

describe('funding by rules', () => {
  it('preview refuses someone else’s income', async () => {
    const preview = await env.inject('POST', `${v2(creator)}/funding/preview`, creator, {
      sourceKind: 'INCOME',
      incomeTransactionId: editorIncomeId,
    });
    expect(preview.statusCode).toBe(403);
    expect(preview.json()).toMatchObject({ code: 'NOT_INCOME_AUTHOR' });
  });
});
```

Дописать в этот файл кейсы по телам запросов из `apps/api/test/v2-funding-confirm.integration.test.ts` и `v2-funding-preview.integration.test.ts`:
1. Участник делает preview своего дохода с `overrides` в конверты обоих владельцев, затем confirm с `previewHash` → 200; созданные распределения имеют `createdByUserId = editor`, сумма ≤ дохода.
2. Confirm с `incomeTransactionId` чужого дохода → 403 `NOT_INCOME_AUTHOR`.
3. Confirm `sourceKind: 'OPENING'` со строкой в чужой конверт → 403 `NOT_OBJECT_OWNER` (если тестовый бюджет уже имеет подтверждённые факты и `OPENING` запрещён по другой причине, кейс опустить и отметить это в отчёте writer).
4. Confirm с `confirmPeriodTargets`, где период принадлежит чужому конверту → 403 `NOT_OBJECT_OWNER` (если в тестовом бюджете можно получить период — `CURRENT_EXPENSES` создаёт периоды; см. `v2-funding-preview.integration.test.ts`).

Код 409 для превышения дохода сверить с `sourceExhausted()` в `assignment.application.service.ts`. Тесты `describe` выполняются по порядку в одном файле: перемещение использует остаток «Расходов на детей», пополненный распределением создателя.

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-allocations.integration.test.ts`
Expected: FAIL.

- [x] **Step 2: Репозитории возвращают владельца и автора**

- `assignment.repository.ts`: `requireIncome` — `select` + `createdByUserId`, `IncomeRecord` + `createdByUserId: string`; `requireEnvelope` — + `ownerUserId`; `lockAssignment` — результат + `createdByUserId`.
- `movement.repository.ts`: метод, который читает исходный конверт в `move`, — + `ownerUserId`.

- [x] **Step 3: Сервис распределений**

В `assignment.application.service.ts`: поле `private readonly access = new BudgetAccessPolicy();` вместо `rolePolicy`. Внутри idempotency-колбэков на месте блока `membership … canManage … forbidden()`:

```ts
// assignFree
const actor = await requireAccessActor(tx, model.workspaceId, userId);
this.access.requireWriter(actor);
const envelope = await this.repository.requireEnvelope(tx, budgetId, input.envelopeId);
if (input.sourceKind === 'OPENING') this.access.requireObjectOwner(actor, envelope);
// (the existing `const envelope = …` line below is removed: the envelope is read once)

// assignIncome — `income` is read under lockIncome before the idempotency call
const actor = await requireAccessActor(tx, model.workspaceId, userId);
this.access.requireIncomeAuthor(actor, income);

// reviseAssignment and cancelAssignment — `locked` is read under lockAssignment
const actor = await requireAccessActor(tx, model.workspaceId, userId);
this.access.requireOperationAuthor(actor, locked);
```

Остальной код методов не меняется. Неиспользуемые импорты (`RolePolicy`, `forbidden`) убрать.

- [x] **Step 4: Перемещения**

`movement.application.service.ts`, вместо блока `membership … canManage`:

```ts
const actor = await requireAccessActor(tx, model.workspaceId, userId);
this.access.requireObjectOwner(actor, sourceEnvelope);
```

- [x] **Step 5: Наполнение по правилам**

`funding-preview.application.service.ts` — две проверки (`early` вне транзакции и `role` внутри):

```ts
const early = await findAccessActor(this.prisma, model.workspaceId, userId);
if (!early) throw forbidden();
this.access.requireWriter(early);
// inside the transaction, where `role` is read now:
const actor = await requireAccessActor(tx, model.workspaceId, userId);
this.access.requireWriter(actor);
if (input.sourceKind === 'INCOME' && input.incomeTransactionId) {
  const income = await this.assignments.requireIncome(tx, budgetId, input.incomeTransactionId);
  this.access.requireIncomeAuthor(actor, income);
}
```

(`this.assignments` — экземпляр `AssignmentRepository`; если в сервисе его нет, добавить поле.)

`funding-confirm.application.service.ts`: ранняя проверка — как в preview; внутри транзакции, после `lockIncome` и **до** `this.preview.compute(…)`:

```ts
const actor = await requireAccessActor(tx, model.workspaceId, userId);
this.access.requireWriter(actor);
if (incomeId) {
  this.access.requireIncomeAuthor(actor, await this.assignments.requireIncome(tx, budgetId, incomeId));
}
const guardedEnvelopeIds = new Set<string>(
  input.sourceKind === 'OPENING' ? parsed.map((line) => line.envelopeId) : [],
);
if (targetIds.length > 0) {
  const periods = await tx.envelopePeriod.findMany({
    where: { budgetId, id: { in: targetIds } },
    select: { envelopeId: true },
  });
  for (const period of periods) guardedEnvelopeIds.add(period.envelopeId);
}
if (guardedEnvelopeIds.size > 0) {
  const envelopes = await tx.envelope.findMany({
    where: { budgetId, id: { in: [...guardedEnvelopeIds] } },
    select: { ownerUserId: true },
  });
  for (const envelope of envelopes) this.access.requireObjectOwner(actor, envelope);
}
```

- [x] **Step 6: OpenAPI**

Описания 403 у `POST assignments`, `PATCH/DELETE assignments/:id`, `POST movements`, `POST funding/preview`, `POST funding/confirm` перечисляют применимые коды: `FORBIDDEN`, `NOT_INCOME_AUTHOR`, `NOT_OBJECT_OWNER`, `NOT_OPERATION_AUTHOR`.

- [x] **Step 7: Проверки**

Run:
- `pnpm --filter @harmofin/api exec vitest run src/envelope-plans src/funding` — PASS.
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-allocations.integration.test.ts test/v2-assignments.integration.test.ts test/v2-movements.integration.test.ts test/v2-funding-preview.integration.test.ts test/v2-funding-confirm.integration.test.ts test/v2-ledger.integration.test.ts test/v2-openapi.integration.test.ts` — PASS. Тесты, где `EDITOR` получал 403 на распределение, переписать: `EDITOR` со своим доходом — 201, с чужим — `NOT_INCOME_AUTHOR`, `VIEWER` — 403 `FORBIDDEN`.
- `pnpm --filter @harmofin/api typecheck`, `pnpm lint` — PASS.

- [x] **Step 8: Commit**

```bash
git add apps/api/src/envelope-plans apps/api/src/funding apps/api/test
git commit -m "feat(api): правила распределения и перемещения денег по владельцу и автору"
```

---

### Task 6: Операции и переводы — по своему счёту, правка только своих

**Files:**
- Modify: `apps/api/src/v2-transactions/transaction-v2.application.service.ts`
- Modify: `apps/api/src/transactions/transaction.repository.ts` (`findActiveV2References` → `account.ownerUserId`; `findForMutation` → `createdByUserId`)
- Modify: `apps/api/src/v2-transactions/transaction-v2.dto.ts`, `transaction-v2.controller.ts`
- Modify: `apps/api/src/v2-transfers/direct-transfer.application.service.ts`, `direct-transfer.repository.ts` (`findAccount` → `ownerUserId`; перевод → `createdByUserId`), `direct-transfer.dto.ts`, `direct-transfer.controller.ts`
- Modify: `apps/api/src/v2-journal/journal.application.service.ts` (просмотр удалённых — `canViewDeleted`)
- Test: `apps/api/test/family-operations.integration.test.ts`

**Interfaces:**
- Consumes: Task 2; `Account.ownerUserId` (Task 1).
- Produces:
  - `POST transactions` (доход и расход): счёт свой (`NOT_ACCOUNT_OWNER`), конверт любой. Проверка в `createInTransaction` — она же покрывает запись дохода по плану (`income-plan-v2` вызывает этот метод).
  - `PATCH`/`DELETE`/`POST restore transactions/:id`: только автор (`NOT_OPERATION_AUTHOR`); при смене счёта новый счёт свой (`NOT_ACCOUNT_OWNER`).
  - `POST transfers`: источник свой (`NOT_ACCOUNT_OWNER`), получатель любой; `PATCH`/`DELETE`/`restore transfers/:id` — только автор; при смене источника новый источник свой.
  - `GET transactions/:id`, `GET transfers/:id` + `createdBy: PersonRef` (отклонение 12).
  - Удалённые операции видят все writer (отклонение 7).

- [x] **Step 1: Падающий integration-тест**

```ts
// apps/api/test/family-operations.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let creatorAccountId: string;
let editorAccountId: string;
let creatorEnvelopeId: string;

const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;
const today = () => new Date().toISOString().slice(0, 10);

async function familyCash(): Promise<bigint> {
  const response = await env.inject(
    'GET',
    `/api/v1/budgets/${creator.budgetId}/accounts/summary`,
    creator,
  );
  return BigInt(response.json<{ totalMinor: string }>().totalMinor);
}

async function envelopeBalance(envelopeId: string): Promise<bigint> {
  const response = await env.inject('GET', `${v2(creator)}/envelopes/${envelopeId}`, creator);
  return BigInt(response.json<{ balanceMinor: string }>().balanceMinor);
}

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  creatorAccountId = await env.createAccount(creator, 'Счёт создателя', '10000');
  editorAccountId = await env.createAccount(editor, 'Счёт участника', '10000');
  creatorEnvelopeId = await env.createEnvelope(creator, 'Продукты');
  const funded = await env.inject('POST', `${v2(creator)}/assignments`, creator, {
    envelopeId: creatorEnvelopeId,
    amount: '5000',
    sourceKind: 'FREE',
  });
  expect(funded.statusCode).toBe(201);
});

afterAll(async () => {
  await env.stop();
});

describe('recording on an account', () => {
  it('rejects an expense on someone else’s account', async () => {
    const response = await env.inject('POST', `${v2(editor)}/transactions`, editor, {
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amount: '100',
      occurredOn: today(),
      accountId: creatorAccountId,
      categoryId: await env.categoryId(editor.budgetId, 'EXPENSE'),
      envelopeId: null,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_ACCOUNT_OWNER' });
  });

  it('spending from a foreign envelope with an own account reduces that envelope', async () => {
    const before = await envelopeBalance(creatorEnvelopeId);
    await env.record(editor, {
      type: 'EXPENSE',
      accountId: editorAccountId,
      amount: '2300',
      envelopeId: creatorEnvelopeId,
    });
    expect(await envelopeBalance(creatorEnvelopeId)).toBe(before - 230_000n);
  });

  it('a viewer cannot record', async () => {
    const response = await env.inject('POST', `${v2(viewer)}/transactions`, viewer, {
      transactionType: 'INCOME',
      status: 'CONFIRMED',
      amount: '1',
      occurredOn: today(),
      accountId: editorAccountId,
      categoryId: await env.categoryId(viewer.budgetId, 'INCOME'),
      envelopeId: null,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('changing operations', () => {
  it('only the author edits, deletes and restores; the card shows the author', async () => {
    const id = await env.record(editor, { type: 'EXPENSE', accountId: editorAccountId, amount: '10' });
    const card = await env.inject('GET', `${v2(creator)}/transactions/${id}`, creator);
    expect(card.json()).toMatchObject({
      createdBy: { userId: editor.user.id, isActiveMember: true },
    });

    const edit = await env.inject('PATCH', `${v2(creator)}/transactions/${id}`, creator, {
      amount: '20',
    });
    expect(edit.statusCode).toBe(403);
    expect(edit.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });

    const remove = await env.inject('DELETE', `${v2(editor)}/transactions/${id}`, editor);
    expect(remove.statusCode).toBe(200);
    const deleted = await env.inject('GET', `${v2(editor)}/transactions?status=DELETED`, editor);
    expect(deleted.statusCode).toBe(200);
    const restore = await env.inject('POST', `${v2(creator)}/transactions/${id}/restore`, creator);
    expect(restore.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });
  });

  it('the author cannot move an own operation onto someone else’s account', async () => {
    const id = await env.record(editor, { type: 'EXPENSE', accountId: editorAccountId, amount: '10' });
    const edit = await env.inject('PATCH', `${v2(editor)}/transactions/${id}`, editor, {
      accountId: creatorAccountId,
    });
    expect(edit.statusCode).toBe(403);
    expect(edit.json()).toMatchObject({ code: 'NOT_ACCOUNT_OWNER' });
  });
});

describe('transfers', () => {
  it('rejects a transfer from someone else’s account', async () => {
    const response = await env.inject('POST', `${v2(editor)}/transfers`, editor, {
      sourceAccountId: creatorAccountId,
      destinationAccountId: editorAccountId,
      amount: '100',
      occurredOn: today(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_ACCOUNT_OWNER' });
  });

  it('a transfer to a foreign account keeps the family total; only its author changes it', async () => {
    const totalBefore = await familyCash();
    const created = await env.inject('POST', `${v2(editor)}/transfers`, editor, {
      sourceAccountId: editorAccountId,
      destinationAccountId: creatorAccountId,
      amount: '1000',
      occurredOn: today(),
    });
    expect(created.statusCode).toBe(201);
    expect(await familyCash()).toBe(totalBefore);
    const transferId = created.json<{ id: string }>().id;
    const card = await env.inject('GET', `${v2(creator)}/transfers/${transferId}`, creator);
    expect(card.json()).toMatchObject({ createdBy: { userId: editor.user.id } });
    const remove = await env.inject('DELETE', `${v2(creator)}/transfers/${transferId}`, creator);
    expect(remove.statusCode).toBe(403);
    expect(remove.json()).toMatchObject({ code: 'NOT_OPERATION_AUTHOR' });
  });
});
```

Тело `PATCH transactions/:id` сверить с `updateTransactionV2Schema`; поле id в ответе перевода — с `direct-transfer.dto.ts`.

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-operations.integration.test.ts`
Expected: FAIL.

- [x] **Step 2: Операции**

В `transaction-v2.application.service.ts` поле `private readonly access = new BudgetAccessPolicy();`.

`createInTransaction` — вместо проверки роли в начале:

```ts
const actor = await requireAccessActor(tx, workspaceId, userId);
this.access.requireWriter(actor);
```

и сразу после проверки существования ссылок (`if (!refs.account || …) throw resourceNotFound();`):

```ts
this.access.requireAccountOwner(actor, refs.account);
```

`runLifecycle` — вместо `role !== 'OWNER' && role !== 'EDITOR'`:

```ts
const actor = await requireAccessActor(tx, model.workspaceId, userId);
this.access.requireWriter(actor);
const budget = await this.repository.findBudgetSettings(tx, budgetId);
if (!budget) throw resourceNotFound();
const current = await this.repository.findForMutation(tx, userId, budgetId, transactionId);
if (!current) throw resourceNotFound();
this.access.requireOperationAuthor(actor, current);
```

`LifecycleContext` + `actor: AccessActor`. В `updateInTransaction` и `updateIncomeInTransaction` после чтения новых ссылок и `assertReferences(...)` — `this.access.requireAccountOwner(ctx.actor, refs.account!)`. Проверить `findForMutation`: фильтр должен быть по `budgetId` и членству, не по автору (иначе чужая операция давала бы 404, а не 403).

`list`/`get` со статусом `DELETED` — вместо `role !== 'OWNER'`:

```ts
const role = budget.workspace.memberships[0]?.role;
if (!role || !this.access.canViewDeleted({ userId, role, isCreator: false })) throw forbidden();
```

`get` возвращает `createdBy: personRefOf(await findPersonRefs(this.prisma, workspaceId, [row.createdByUserId]), row.createdByUserId)`; `workspaceId` — из уже прочитанного бюджета (добавить в `select`, если нет). То же правило удалённых — в `journal.application.service.ts`.

- [x] **Step 3: Переводы**

`direct-transfer.application.service.ts` `create` — вместо проверки роли:

```ts
const actor = await requireAccessActor(tx, model.workspaceId, userId);
this.access.requireWriter(actor);
// after `if (!source || !destination) throw resourceNotFound();`
this.access.requireAccountOwner(actor, source);
```

`mutate` (update/delete/restore): вместо проверки роли — `requireAccessActor` + `requireWriter`; после чтения текущего перевода — `this.access.requireOperationAuthor(actor, current)`; в `update`, если меняется `sourceAccountId`, — `requireAccountOwner(actor, newSource)`. `get` + `createdBy`.

- [x] **Step 4: DTO и OpenAPI**

- Ответ `GET transactions/:id` — `@ApiProperty({ type: PersonRefResponse, required: false }) createdBy?: PersonRefResponse;` (в ответах `POST`/`PATCH` поле не обязательно).
- Ответ `GET transfers/:id` — то же.
- Описания 403: `FORBIDDEN`, `NOT_ACCOUNT_OWNER`, `NOT_OPERATION_AUTHOR`.

- [x] **Step 5: Проверки**

Run:
- `pnpm --filter @harmofin/api exec vitest run src/v2-transactions src/v2-transfers src/v2-journal` — PASS.
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-operations.integration.test.ts test/v2-income-lifecycle.integration.test.ts test/v2-direct-transfers.integration.test.ts test/v2-journal.integration.test.ts test/v2-income-plans.integration.test.ts test/v2-openapi.integration.test.ts` — PASS. Тест этапа A «`EDITOR` не видит удалённые» переписать под отклонение 7.
- `pnpm --filter @harmofin/api typecheck`, `pnpm lint` — PASS.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/v2-transactions apps/api/src/transactions apps/api/src/v2-transfers apps/api/src/v2-journal apps/api/test
git commit -m "feat(api): операции и переводы только по своему счёту, правка только своих"
```

---

### Task 7: Планы — владелец управляет планом и записывает по нему

**Files:**
- Modify: `apps/api/src/plans/regular-plan.repository.ts` (план с `ownerUserId`, список с фильтром)
- Modify: `apps/api/src/obligations/obligation-plan.application.service.ts`, `obligation-plan.repository.ts`, `obligation-plan.dto.ts`, `obligation-plan.controller.ts`, `obligation-plan.schemas.ts`
- Modify: `apps/api/src/obligations/obligation.application.service.ts`, `obligation.repository.ts` (вхождение → `plan.ownerUserId`, `findAccount` → `ownerUserId`)
- Modify: `apps/api/src/plans/income-plan-v2.application.service.ts`, `income-plan-v2.repository.ts`, `income-plan-v2.dto.ts`, `income-plan-v2.controller.ts`, `income-plan-v2.schemas.ts`
- Modify: `apps/api/src/plans-calendar/plans-calendar.application.service.ts`, `plans-calendar.repository.ts`, `plans-calendar.dto.ts`
- Test: `apps/api/test/family-plans-ownership.integration.test.ts`

**Interfaces:**
- Consumes: Task 2; `RegularPlan.ownerUserId` (Task 1); `createInTransaction` проверяет счёт (Task 6).
- Produces:
  - Создание плана (`POST obligations/plans`, `POST income-plans`, `POST obligations/one-time-pay`) — любой writer; владелец — автор.
  - `PATCH obligations/plans/:id`, `PATCH income-plans/:id` — только владелец (`NOT_OBJECT_OWNER`).
  - `POST obligations/:occurrenceId/pay|skip|close`, `POST income-plans/occurrences/:id/record` — только владелец плана (`NOT_OBJECT_OWNER`); счёт оплаты/дохода свой (`NOT_ACCOUNT_OWNER`).
  - Ответы планов и элементы календаря + `owner: PersonRef`, `canEdit: boolean`; списки планов + `?ownerUserId=`.
  - `payInTransaction(tx, actor, userId, budgetId, workspaceId, occurrenceId, input, occurredOn, requestId?)` — новый второй параметр `actor: AccessActor`.

- [x] **Step 1: Падающий integration-тест**

```ts
// apps/api/test/family-plans-ownership.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let creatorAccountId: string;
let editorPlanId: string;

const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;
const today = () => new Date().toISOString().slice(0, 10);

async function editorOccurrenceId(): Promise<string> {
  const response = await env.inject('GET', `${v2(editor)}/obligations/occurrences`, editor);
  const occurrence = response
    .json<{ items: Array<{ id: string; planId: string }> }>()
    .items.find((item) => item.planId === editorPlanId);
  if (!occurrence) throw new Error('occurrence of the editor plan not found');
  return occurrence.id;
}

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  creatorAccountId = await env.createAccount(creator, 'Счёт создателя', '10000');
  await env.createAccount(editor, 'Счёт участника', '10000');
  // The mandatory envelope must exist: prepare it as v2-obligation-plans.integration.test.ts does.
  const created = await env.inject('POST', `${v2(editor)}/obligations/plans`, editor, {
    name: 'Секция',
    amount: '3000',
    scheduledOn: today(),
    categoryId: await env.categoryId(editor.budgetId, 'EXPENSE'),
    recurrence: 'MONTHLY',
  });
  expect(created.statusCode).toBe(201);
  editorPlanId = created.json<{ id: string }>().id;
});

afterAll(async () => {
  await env.stop();
});

describe('plan ownership', () => {
  it('an editor creates a plan that belongs to the editor', async () => {
    const list = await env.inject('GET', `${v2(creator)}/obligations/plans`, creator);
    const plan = list
      .json<{ items: Array<{ id: string; owner: { userId: string }; canEdit: boolean }> }>()
      .items.find((item) => item.id === editorPlanId);
    expect(plan).toMatchObject({ owner: { userId: editor.user.id }, canEdit: false });
  });

  it('the creator cannot edit the editor plan', async () => {
    const response = await env.inject(
      'PATCH',
      `${v2(creator)}/obligations/plans/${editorPlanId}`,
      creator,
      { name: 'Чужой' },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('only the plan owner pays, skips or closes an occurrence', async () => {
    const occurrenceId = await editorOccurrenceId();
    const pay = await env.inject('POST', `${v2(creator)}/obligations/${occurrenceId}/pay`, creator, {
      amount: '3000',
      accountId: creatorAccountId,
      categoryId: await env.categoryId(creator.budgetId, 'EXPENSE'),
      occurredOn: today(),
    });
    expect(pay.statusCode).toBe(403);
    expect(pay.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
    const skip = await env.inject('POST', `${v2(creator)}/obligations/${occurrenceId}/skip`, creator);
    expect(skip.json()).toMatchObject({ code: 'NOT_OBJECT_OWNER' });
  });

  it('the plan owner pays only from an own account', async () => {
    const occurrenceId = await editorOccurrenceId();
    const response = await env.inject('POST', `${v2(editor)}/obligations/${occurrenceId}/pay`, editor, {
      amount: '3000',
      accountId: creatorAccountId,
      categoryId: await env.categoryId(editor.budgetId, 'EXPENSE'),
      occurredOn: today(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_ACCOUNT_OWNER' });
  });

  it('filters plans by owner', async () => {
    const response = await env.inject(
      'GET',
      `${v2(creator)}/obligations/plans?ownerUserId=${creator.user.id}`,
      creator,
    );
    const ids = response.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id);
    expect(ids).not.toContain(editorPlanId);
  });

  it('the calendar marks foreign plans as not editable', async () => {
    // GET plans-calendar for the current month (path and query from v2-plans-calendar.integration.test.ts):
    // the item with planId === editorPlanId has owner.userId === editor.user.id and canEdit === false
    // for the creator, canEdit === true for the editor.
  });
});
```

Дописать: кейс календаря (комментарий выше, путь — из `v2-plans-calendar.integration.test.ts`) и блок доходных планов — те же четыре проверки для `POST income-plans`, `PATCH income-plans/:id`, `POST income-plans/occurrences/:id/record` (чужой план → `NOT_OBJECT_OWNER`; свой план с чужим счётом → `NOT_ACCOUNT_OWNER`), тела — из `v2-income-plans.integration.test.ts`. Подготовку конверта «Обязательные», путь списка вхождений и тело `pay` сверить с `v2-obligation-plans.integration.test.ts` и `v2-obligations.integration.test.ts`.

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-plans-ownership.integration.test.ts`
Expected: FAIL.

- [x] **Step 2: Общий `run` в сервисах планов**

В `obligation-plan.application.service.ts`, `income-plan-v2.application.service.ts` и `obligation.application.service.ts` приватный `run(…, allowEditor = false)` (или вариант без флага) заменить на:

```ts
private async run<T extends Record<string, unknown>>(
  budgetId: string,
  userId: string,
  key: string,
  operation: string,
  requestHash: string,
  workspaceId: string,
  status: number,
  authorize: (tx: Tx, actor: AccessActor) => Promise<void>,
  body: (tx: Tx, actor: AccessActor) => Promise<T>,
): Promise<T> {
  const result = await this.prisma.$transaction(async (tx) => {
    await this.transactions.lockBudget(tx, budgetId);
    return this.idempotency.execute<T>(
      tx,
      { budgetId, actorUserId: userId, key, operation, requestHash },
      async () => {
        const actor = await requireAccessActor(tx, workspaceId, userId);
        this.access.requireWriter(actor);
        await authorize(tx, actor);
        return { status, body: await body(tx, actor) };
      },
    );
  });
  return result.body;
}
```

Порядок параметров у `obligation.application.service.ts` сейчас другой (нет `status`) — сохранить его порядок и добавить `authorize` перед `body`. Константа `const anyWriter = async () => {};` для вызовов без проверки владельца.

Вызовы:
- `createPlan` (оба сервиса), `payOneTime`: `authorize = anyWriter`; план создаётся с `ownerUserId = userId` (Task 1).
- `updatePlan` (оба): `authorize = async (tx, actor) => this.access.requireObjectOwner(actor, await this.<repository>.requirePlan(tx, budgetId, planId))` — метод чтения плана с фильтром `budgetId`, которым `updatePlan` уже пользуется; добавить `ownerUserId` в его `select`.
- `recordIncome`: `authorize` читает вхождение (с фильтром `budgetId`) и его план → `requireObjectOwner(actor, plan)`.
- `pay`, `skip`, `close` (`obligation.application.service.ts`): `authorize = async (tx, actor) => this.access.requireObjectOwner(actor, (await this.requireOccurrence(tx, budgetId, occurrenceId)).plan)` — в `select` вхождения добавить `plan.ownerUserId`.

`payInTransaction` получает `actor` и после чтения `account` (с `ownerUserId`) проверяет:

```ts
if (!account || !category) throw resourceNotFound();
this.access.requireAccountOwner(actor, account);
```

Вызовы `payInTransaction` из `pay` и `payOneTime` передают `actor` из `body(tx, actor)`.

- [x] **Step 3: Ответы и фильтр**

- `planView(plan)` → + `owner`, `canEdit`. Списки: `people = await findPersonRefs(this.prisma, workspaceId, plans.map((plan) => plan.ownerUserId))`, `actor = await findAccessActor(this.prisma, workspaceId, userId)`, `canEdit = actor !== null && this.access.canEditObject(actor, plan)`. Ответы `create`/`update` — так же для одного плана.
- `listObligationPlansSchema`, `listIncomePlansSchema` + `ownerUserId: z.string().uuid().optional()`; репозиторий добавляет `ownerUserId` в `where`; контроллеры — `@ApiQuery`.
- `plans-calendar`: репозиторий выбирает `plan.ownerUserId`; элемент (`PlansCalendarItemResponse`) + `owner: PersonRefResponse`, `canEdit: boolean`.
- DTO: `ObligationPlanResponse`, `IncomePlanResponse`, `PlansCalendarItemResponse` + `owner`, `canEdit`; описания 403 с кодами.

- [x] **Step 4: Проверки**

Run:
- `pnpm --filter @harmofin/api exec vitest run src/obligations src/plans src/plans-calendar` — PASS.
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-plans-ownership.integration.test.ts test/v2-obligation-plans.integration.test.ts test/v2-obligations.integration.test.ts test/v2-income-plans.integration.test.ts test/v2-plans-calendar.integration.test.ts test/v2-mandatory-due.integration.test.ts test/v2-openapi.integration.test.ts` — PASS. Тесты, где `EDITOR` получал 403 на создание плана, переписать на `VIEWER`.
- `pnpm --filter @harmofin/api typecheck`, `pnpm lint` — PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/obligations apps/api/src/plans apps/api/src/plans-calendar apps/api/test
git commit -m "feat(api): владелец плана управляет им и записывает платежи и доходы"
```

---

### Task 8: Остальные проверки ролей через политику, удаление `RolePolicy`

**Files:**
- Modify: `apps/api/src/budgets/budget.application.service.ts`, `budget.module.ts`
- Modify: `apps/api/src/categories/category.application.service.ts`, `category.module.ts`
- Modify: `apps/api/src/cycles/cycle-revision.application.service.ts`, `apps/api/src/cycles/v2-budget-settings.application.service.ts`
- Modify: `apps/api/src/v2-template/template-apply.application.service.ts`, `template-preview.application.service.ts`
- Modify: `apps/api/src/v2-dashboard/onboarding-v2.application.service.ts`, `dashboard-v2.application.service.ts`
- Modify: `apps/api/src/exports/csv-export-v2.application.service.ts`, `apps/api/src/audit/audit.application.service.ts`
- Delete: `apps/api/src/common/policies/role-policy.ts`, `apps/api/src/common/policies/role-policy.test.ts`
- Test: существующие unit- и integration-тесты этих модулей

**Interfaces:**
- Consumes: Task 2.
- Produces: `grep -rn "RolePolicy\|WRITE_ROLES\|allowEditor\|role !== 'OWNER'\|role === 'OWNER'" apps/api/src --include=*.ts | grep -v "\.test\.ts" | grep -v "src/family/"` пуст. Поведение для пользователей не меняется: всё перечисленное — настройки бюджета (`OWNER`) или чтение.

- [x] **Step 1: Замены**

| Файл | Было | Стало |
|---|---|---|
| budgets, categories, cycles (оба), template (оба), onboarding | `rolePolicy.canManage(role)` | внутри транзакции мутации — `this.access.requireBudgetSettings(await requireAccessActor(tx, workspaceId, userId))`; где роль уже прочитана запросом бюджета — `this.access.canManageBudgetSettings({ userId, role, isCreator: false })` |
| `dashboard-v2.application.service.ts` | `WRITE_ROLES.has(role)` | `this.access.canCreateObjects({ userId, role, isCreator: false })` |
| `csv-export-v2.application.service.ts` | `role !== 'OWNER'` | `!this.access.canManageBudgetSettings({ userId, role, isCreator: false })` |
| `audit.application.service.ts` | `memberships[0]?.role !== 'OWNER'` | то же через политику |

`isCreator` в этих методах не используется, поэтому `false` безопасен. Новых запросов к БД ради роли не добавлять.

`budget.module.ts`, `category.module.ts`: убрать `RolePolicy` из `providers`/`inject`; конструкторы сервисов — без него, поле `private readonly access = new BudgetAccessPolicy();`. Unit-тесты, которые передают `new RolePolicy()`, обновить.

- [x] **Step 2: Удалить `RolePolicy`**

```bash
git rm apps/api/src/common/policies/role-policy.ts apps/api/src/common/policies/role-policy.test.ts
```

Run: `grep -rn "RolePolicy\|WRITE_ROLES\|allowEditor" apps/api/src` — пусто.

- [x] **Step 3: Проверки**

Run:
- `pnpm --filter @harmofin/api typecheck`, `pnpm lint` — PASS.
- `pnpm --filter @harmofin/api test` — PASS.
- `pnpm test:integration` — PASS целиком.

- [x] **Step 4: Commit**

```bash
git status --short
git add apps/api/src
git commit -m "refactor(api): все проверки ролей через BudgetAccessPolicy"
```

В `git status` не должно быть `identity/logo_description.png` среди индексируемых и посторонних файлов.

---

### Task 9: История конверта с автором, направлением и контрагентом

**Files:**
- Modify: `apps/api/src/envelope-plans/envelope-plan.repository.ts` (`listHistory`, `EnvelopeHistoryItemRecord`)
- Modify: `apps/api/src/envelope-plans/envelope-plan.application.service.ts` (`history`)
- Modify: `apps/api/src/envelope-plans/envelope-plan.dto.ts` (`EnvelopeHistoryItemResponse`)
- Test: `apps/api/test/family-envelope-history.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (авторы), Task 2 (`findPersonRefs`, `personRefOf`, `PersonRefResponse`).
- Produces: элемент истории (используется задачей 14):

```ts
type EnvelopeHistoryItem = {
  kind: 'ASSIGNMENT' | 'MOVEMENT' | 'SPENDING';
  id: string;
  amountMinor: string; // unsigned magnitude, as before
  effectiveOn: string;
  direction: 'IN' | 'OUT';
  createdBy: PersonRef;
  /** Income category for INCOME allocations, the other envelope for movements
   *  (null = free money), the expense category for spending; null for FREE and OPENING. */
  counterpartName: string | null;
  assignmentType: 'INCOME' | 'OPENING' | 'FREE' | null;
};
```

- [x] **Step 1: Падающий тест**

```ts
// apps/api/test/family-envelope-history.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let kidsEnvelopeId: string;
let vacationEnvelopeId: string;
let expenseId: string;

const v2 = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}`;

type Item = {
  kind: string;
  id: string;
  direction: 'IN' | 'OUT';
  amountMinor: string;
  createdBy: { userId: string };
  counterpartName: string | null;
  assignmentType: string | null;
};

async function history(envelopeId: string, status?: 'DELETED'): Promise<Item[]> {
  const query = status ? `?status=${status}` : '';
  const response = await env.inject(
    'GET',
    `${v2(creator)}/envelopes/${envelopeId}/history${query}`,
    creator,
  );
  expect(response.statusCode).toBe(200);
  return response.json<{ items: Item[] }>().items;
}

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  const creatorAccountId = await env.createAccount(creator, 'Счёт создателя');
  const editorAccountId = await env.createAccount(editor, 'Счёт участника', '5000');
  kidsEnvelopeId = await env.createEnvelope(editor, 'Расходы на детей');
  vacationEnvelopeId = await env.createEnvelope(creator, 'Отпуск');
  const incomeId = await env.record(creator, {
    type: 'INCOME',
    accountId: creatorAccountId,
    amount: '10000',
  });
  await env.inject('POST', `${v2(creator)}/assignments`, creator, {
    incomeTransactionId: incomeId,
    envelopeId: kidsEnvelopeId,
    amount: '10000',
  });
  expenseId = await env.record(editor, {
    type: 'EXPENSE',
    accountId: editorAccountId,
    amount: '2300',
    envelopeId: kidsEnvelopeId,
  });
  await env.inject('POST', `${v2(editor)}/movements`, editor, {
    sourceEnvelopeId: kidsEnvelopeId,
    destinationEnvelopeId: vacationEnvelopeId,
    amount: '1000',
  });
});

afterAll(async () => {
  await env.stop();
});

describe('envelope history', () => {
  it('shows author, direction and counterpart of every entry', async () => {
    const items = await history(kidsEnvelopeId);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'ASSIGNMENT',
          direction: 'IN',
          amountMinor: '1000000',
          assignmentType: 'INCOME',
          createdBy: expect.objectContaining({ userId: creator.user.id }),
        }),
        expect.objectContaining({
          kind: 'SPENDING',
          direction: 'OUT',
          amountMinor: '230000',
          createdBy: expect.objectContaining({ userId: editor.user.id }),
        }),
        expect.objectContaining({
          kind: 'MOVEMENT',
          direction: 'OUT',
          amountMinor: '100000',
          counterpartName: 'Отпуск',
          createdBy: expect.objectContaining({ userId: editor.user.id }),
        }),
      ]),
    );
  });

  it('shows an incoming movement as IN in the destination envelope', async () => {
    const movement = (await history(vacationEnvelopeId)).find((item) => item.kind === 'MOVEMENT');
    expect(movement).toMatchObject({ direction: 'IN', counterpartName: 'Расходы на детей' });
  });

  it('a deleted spending leaves the confirmed history and appears among deleted', async () => {
    const removed = await env.inject('DELETE', `${v2(editor)}/transactions/${expenseId}`, editor);
    expect(removed.statusCode).toBe(200);
    expect((await history(kidsEnvelopeId)).some((item) => item.id === expenseId)).toBe(false);
    expect((await history(kidsEnvelopeId, 'DELETED')).some((item) => item.id === expenseId)).toBe(true);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-envelope-history.integration.test.ts`
Expected: FAIL.

- [x] **Step 2: SQL истории**

В `listHistory` три ветки `UNION ALL` получают одинаковые новые колонки; бюджет фильтруется в каждом `JOIN`:

```sql
WITH combined AS (
  SELECT
    'ASSIGNMENT'::text AS kind,
    a."id" AS id,
    a."amount_minor"::text AS "amountMinor",
    TO_CHAR(a."effective_on", 'YYYY-MM-DD') AS "effectiveOn",
    'IN'::text AS direction,
    a."created_by_user_id" AS "createdByUserId",
    c."name" AS "counterpartName",
    a."type"::text AS "assignmentType"
  FROM "envelope_assignments" AS a
  LEFT JOIN "transactions" AS t
    ON t."id" = a."source_income_transaction_id" AND t."budget_id" = a."budget_id"
  LEFT JOIN "categories" AS c
    ON c."id" = t."category_id" AND c."budget_id" = a."budget_id"
  WHERE a."budget_id" = ${budgetId}::uuid
    AND a."envelope_id" = ${envelopeId}::uuid
    AND (CASE WHEN ${status} = 'DELETED' THEN a."status" = 'DELETED' ELSE a."status" = 'CONFIRMED' END)
  UNION ALL
  SELECT
    'MOVEMENT'::text,
    m."id",
    m."amount_minor"::text,
    TO_CHAR(m."effective_on", 'YYYY-MM-DD'),
    -- A movement between two periods of the same envelope is listed once, as IN.
    CASE
      WHEN m."source_envelope_id" = ${envelopeId}::uuid
       AND m."destination_envelope_id" IS DISTINCT FROM ${envelopeId}::uuid
        THEN 'OUT'
      ELSE 'IN'
    END,
    m."created_by_user_id",
    other."name",
    NULL::text
  FROM "envelope_movements" AS m
  LEFT JOIN "envelopes" AS other
    ON other."budget_id" = m."budget_id"
   AND other."id" = CASE
         WHEN m."source_envelope_id" = ${envelopeId}::uuid THEN m."destination_envelope_id"
         ELSE m."source_envelope_id"
       END
  WHERE m."budget_id" = ${budgetId}::uuid
    AND (
      m."source_envelope_id" = ${envelopeId}::uuid
      OR m."destination_envelope_id" = ${envelopeId}::uuid
    )
    AND (CASE WHEN ${status} = 'DELETED' THEN m."status" = 'DELETED' ELSE m."status" = 'CONFIRMED' END)
  UNION ALL
  SELECT
    'SPENDING'::text,
    t."id",
    t."amount_minor"::text,
    TO_CHAR(t."occurred_on", 'YYYY-MM-DD'),
    'OUT'::text,
    t."created_by_user_id",
    c."name",
    NULL::text
  FROM "transactions" AS t
  LEFT JOIN "categories" AS c ON c."id" = t."category_id" AND c."budget_id" = t."budget_id"
  WHERE t."budget_id" = ${budgetId}::uuid
    AND t."envelope_id" = ${envelopeId}::uuid
    AND t."transaction_type" = 'EXPENSE'
    AND t."accounting_model_version" = 2
    AND (
      CASE
        WHEN ${status} = 'DELETED'
          THEN t."status" = 'DELETED' OR t."deleted_at" IS NOT NULL
        ELSE t."status" = 'CONFIRMED' AND t."deleted_at" IS NULL
      END
    )
)
SELECT combined.kind, combined.id, combined."amountMinor", combined."effectiveOn",
       combined.direction, combined."createdByUserId", combined."counterpartName",
       combined."assignmentType"
FROM combined
-- cursor and ORDER BY unchanged
```

Для перемещения между двумя периодами одного конверта (`source = destination = envelopeId`) `counterpartName` — имя того же конверта; это допустимо (сумма конверта не меняется), комментарий в SQL выше это фиксирует.

`EnvelopeHistoryItemRecord` + `direction: 'IN' | 'OUT'`, `createdByUserId: string`, `counterpartName: string | null`, `assignmentType: 'INCOME' | 'OPENING' | 'FREE' | null`.

- [x] **Step 3: Сервис и DTO**

`history`: `model = await this.planModelPolicy.requireModel(…)` уже вызывается — взять из него `workspaceId`. После чтения страницы:

```ts
const people = await findPersonRefs(tx, model.workspaceId, page.map((row) => row.createdByUserId));
const items = page.map(({ createdByUserId, ...row }) => ({
  ...row,
  createdBy: personRefOf(people, createdByUserId),
}));
```

`EnvelopeHistoryItemResponse`: `direction` (`enum: ['IN', 'OUT']`), `createdBy: PersonRefResponse`, `counterpartName` (`type: String, nullable: true`), `assignmentType` (`enum: ['INCOME', 'OPENING', 'FREE'], nullable: true`).

- [x] **Step 4: Проверки**

Run:
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-envelope-history.integration.test.ts test/v2-envelopes.integration.test.ts test/v2-openapi.integration.test.ts` — PASS.
- `pnpm --filter @harmofin/api typecheck`, `pnpm lint` — PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/envelope-plans apps/api/test/family-envelope-history.integration.test.ts
git commit -m "feat(api): история конверта с автором, направлением и контрагентом"
```

---

### Task 10: Передача объектов создателю при выходе, удалении участника и удалении аккаунта

**Files:**
- Create: `apps/api/src/family/object-transfer.ts`
- Modify: `apps/api/src/family/family-notifications.ts`
- Create: `apps/api/src/family/family-notifications.test.ts`
- Modify: `apps/api/src/family/members.application.service.ts` (`deactivate`)
- Modify: `apps/api/src/account-deletion/account-deletion.application.service.ts` (цикл по `deactivated`)
- Test: `apps/api/test/family-object-transfer.integration.test.ts`
- Modify: `apps/api/test/account-deletion.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ownerUserId`, `OBJECTS_TRANSFERRED`).
- Produces:

```ts
export interface TransferredObjects {
  accounts: number;
  envelopes: number;
  plans: number;
}

export async function transferMemberObjects(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    fromUserId: string;
    toUserId: string;
    actorUserId: string;
    requestId?: string | undefined;
    now: Date;
  },
): Promise<TransferredObjects>;

export function transferSummary(counts: TransferredObjects): string;
export async function createObjectsTransferredNotification(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    budgetId: string;
    userId: string;
    memberName: string;
    counts: TransferredObjects;
    eventKey: string;
  },
): Promise<void>;
```

- [x] **Step 1: Падающие тесты**

```ts
// apps/api/src/family/family-notifications.test.ts
import { describe, expect, it } from 'vitest';

import { transferSummary } from './family-notifications.js';

describe('transferSummary', () => {
  it.each([
    [{ accounts: 3, envelopes: 2, plans: 0 }, '3 счёта, 2 конверта'],
    [{ accounts: 1, envelopes: 5, plans: 11 }, '1 счёт, 5 конвертов, 11 планов'],
    [{ accounts: 21, envelopes: 0, plans: 0 }, '21 счёт'],
    [{ accounts: 0, envelopes: 0, plans: 2 }, '2 плана'],
  ])('%o -> %s', (counts, expected) => {
    expect(transferSummary(counts)).toBe(expected);
  });
});
```

```ts
// apps/api/test/family-object-transfer.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let firstLeaverAccountId: string;
let firstLeaver: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
});

afterAll(async () => {
  await env.stop();
});

async function memberWithObjects() {
  const member = await env.join(creator, await env.register(), 'EDITOR');
  const suffix = member.user.id.slice(0, 6);
  const accountId = await env.createAccount(member, `Счёт ${suffix}`, '100');
  const envelopeId = await env.createEnvelope(member, `Конверт ${suffix}`);
  const expenseId = await env.record(member, { type: 'EXPENSE', accountId, amount: '10' });
  return { member, accountId, envelopeId, expenseId };
}

async function membershipId(userId: string): Promise<string> {
  const row = await env.prisma.workspaceMembership.findFirstOrThrow({
    where: { workspaceId: creator.workspaceId, userId, isActive: true },
    select: { id: true },
  });
  return row.id;
}

describe('objects of a member who leaves', () => {
  it('pass to the creator atomically with audit and one summary notification', async () => {
    const { member, accountId, envelopeId, expenseId } = await memberWithObjects();
    firstLeaver = member;
    firstLeaverAccountId = accountId;
    const response = await env.inject('POST', `/api/v1/workspaces/${creator.workspaceId}/leave`, member);
    expect(response.statusCode).toBe(204);

    expect((await env.prisma.account.findUniqueOrThrow({ where: { id: accountId } })).ownerUserId).toBe(
      creator.user.id,
    );
    expect(
      (await env.prisma.envelope.findUniqueOrThrow({ where: { id: envelopeId } })).ownerUserId,
    ).toBe(creator.user.id);
    expect(
      (await env.prisma.transaction.findUniqueOrThrow({ where: { id: expenseId } })).createdByUserId,
    ).toBe(member.user.id);

    const audits = await env.prisma.auditEvent.findMany({
      where: {
        workspaceId: creator.workspaceId,
        action: 'OWNER_TRANSFERRED',
        entityId: { in: [accountId, envelopeId] },
      },
    });
    expect(audits).toHaveLength(2);

    const notifications = await env.prisma.notification.findMany({
      where: {
        workspaceId: creator.workspaceId,
        userId: creator.user.id,
        notificationType: 'OBJECTS_TRANSFERRED',
      },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toBe('Вам переданы 1 счёт, 1 конверт');
  });

  it('the same happens when the creator removes a member', async () => {
    const { member, accountId } = await memberWithObjects();
    const response = await env.inject(
      'DELETE',
      `/api/v1/workspaces/${creator.workspaceId}/members/${await membershipId(member.user.id)}`,
      creator,
    );
    expect(response.statusCode).toBe(204);
    expect((await env.prisma.account.findUniqueOrThrow({ where: { id: accountId } })).ownerUserId).toBe(
      creator.user.id,
    );
  });

  it('a member without objects produces no transfer notification', async () => {
    const member = await env.join(creator, await env.register(), 'VIEWER');
    const count = () =>
      env.prisma.notification.count({
        where: { userId: creator.user.id, notificationType: 'OBJECTS_TRANSFERRED' },
      });
    const before = await count();
    await env.inject('POST', `/api/v1/workspaces/${creator.workspaceId}/leave`, member);
    expect(await count()).toBe(before);
  });

  it('a re-activated member gets access back but not the objects', async () => {
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: creator.workspaceId, userId: firstLeaver.user.id },
      data: { isActive: true, removedAt: null, role: 'EDITOR' },
    });
    expect(
      (await env.prisma.account.findUniqueOrThrow({ where: { id: firstLeaverAccountId } })).ownerUserId,
    ).toBe(creator.user.id);
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/family/family-notifications.test.ts` и `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-object-transfer.integration.test.ts`
Expected: FAIL.

- [x] **Step 2: Передача объектов**

```ts
// apps/api/src/family/object-transfer.ts
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export interface TransferredObjects {
  accounts: number;
  envelopes: number;
  plans: number;
}

type Owned = { id: string; budgetId: string };

/**
 * Moves every account, envelope and plan of `fromUserId` in the workspace's budgets to the family
 * creator, with one AuditEvent per object. Runs in the caller's transaction right after the
 * membership row is deactivated. Authorship of operations, allocations and movements stays.
 */
export async function transferMemberObjects(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    fromUserId: string;
    toUserId: string;
    actorUserId: string;
    requestId?: string | undefined;
    now: Date;
  },
): Promise<TransferredObjects> {
  const owned = { budget: { workspaceId: input.workspaceId }, ownerUserId: input.fromUserId };
  const select = { id: true, budgetId: true } as const;
  const [accounts, envelopes, plans] = await Promise.all([
    tx.account.findMany({ where: owned, select }),
    tx.envelope.findMany({ where: owned, select }),
    tx.regularPlan.findMany({
      where: { workspaceId: input.workspaceId, ownerUserId: input.fromUserId },
      select,
    }),
  ]);
  const data = { ownerUserId: input.toUserId };
  if (accounts.length > 0) {
    await tx.account.updateMany({ where: { id: { in: accounts.map((row) => row.id) } }, data });
  }
  if (envelopes.length > 0) {
    await tx.envelope.updateMany({ where: { id: { in: envelopes.map((row) => row.id) } }, data });
  }
  if (plans.length > 0) {
    await tx.regularPlan.updateMany({ where: { id: { in: plans.map((row) => row.id) } }, data });
  }
  const audit = (entityType: string) => (row: Owned) => ({
    id: createUuidV7(input.now),
    actorUserId: input.actorUserId,
    workspaceId: input.workspaceId,
    budgetId: row.budgetId,
    entityType,
    entityId: row.id,
    action: 'OWNER_TRANSFERRED',
    source: 'API',
    requestId: input.requestId ?? null,
    oldValues: { ownerUserId: input.fromUserId },
    newValues: { ownerUserId: input.toUserId },
  });
  const events = [
    ...accounts.map(audit('account')),
    ...envelopes.map(audit('envelope')),
    ...plans.map(audit('regular_plan')),
  ];
  if (events.length > 0) await tx.auditEvent.createMany({ data: events });
  return { accounts: accounts.length, envelopes: envelopes.length, plans: plans.length };
}
```

`AuditEvent.action` и `entityType` — `varchar`, `'regular_plan'` совпадает с аудитом `regular-plan.repository.ts`. Вызов при удалении аккаунта идёт с `source: 'API'`, как остальные события удаления аккаунта (сверить с `auditMembership` в `account-deletion.repository.ts`; если там другое значение — передавать `source` параметром).

- [x] **Step 3: Уведомление со сводкой**

В `family-notifications.ts` дописать (тип `AccessType` не меняется):

```ts
import type { TransferredObjects } from './object-transfer.js';

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function transferSummary(counts: TransferredObjects): string {
  const parts: string[] = [];
  if (counts.accounts > 0) {
    parts.push(`${counts.accounts} ${plural(counts.accounts, 'счёт', 'счёта', 'счетов')}`);
  }
  if (counts.envelopes > 0) {
    parts.push(`${counts.envelopes} ${plural(counts.envelopes, 'конверт', 'конверта', 'конвертов')}`);
  }
  if (counts.plans > 0) {
    parts.push(`${counts.plans} ${plural(counts.plans, 'план', 'плана', 'планов')}`);
  }
  return parts.join(', ');
}

export async function createObjectsTransferredNotification(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    budgetId: string;
    userId: string;
    memberName: string;
    counts: TransferredObjects;
    eventKey: string;
  },
): Promise<void> {
  await tx.notification.createMany({
    data: {
      id: createUuidV7(),
      workspaceId: input.workspaceId,
      budgetId: input.budgetId,
      userId: input.userId,
      notificationType: 'OBJECTS_TRANSFERRED',
      relatedEntityType: 'workspace_membership',
      title: `Вам переданы ${transferSummary(input.counts)}`,
      body: `Участник «${input.memberName}» больше не в семье. Счета, конверты и планы участника теперь ваши.`,
      actionPath: '/app/accounts',
      notificationKey: `access:OBJECTS_TRANSFERRED:${input.eventKey}`,
    },
    skipDuplicates: true,
  });
}
```

Текст не зависит от рода участника (правило Global Constraints).

- [x] **Step 4: Вызовы**

`members.application.service.ts` `deactivate` — сразу после `resolveUserNotifications`:

```ts
const transferred = await transferMemberObjects(tx, {
  workspaceId: input.workspaceId,
  fromUserId: input.memberUserId,
  toUserId: input.ownerId,
  actorUserId: input.actorUserId,
  requestId: input.requestId,
  now,
});
```

и внутри существующего `if (budgetId) { … }` после уведомления `MEMBER_*`:

```ts
if (transferred.accounts + transferred.envelopes + transferred.plans > 0) {
  await createObjectsTransferredNotification(tx, {
    workspaceId: input.workspaceId,
    budgetId,
    userId: input.ownerId,
    memberName: input.memberName,
    counts: transferred,
    eventKey: `${input.membershipId}:${now.toISOString()}`,
  });
}
```

`account-deletion.application.service.ts` — в цикле `for (const membership of deactivated)` тот же вызов (`fromUserId: userId`, `toUserId: membership.ownerId`, `actorUserId: userId`, `requestId: meta.requestId`), уведомление — внутри существующего `if (foreignBudgetId)`.

`account-deletion.integration.test.ts`: кейс «участник со счётом в чужой семье удаляет аккаунт → счёт у создателя, есть `AuditEvent` `OWNER_TRANSFERRED`, у создателя `OBJECTS_TRANSFERRED`; после восстановления аккаунта (`restore`) счёт остаётся у создателя». Подготовку участника и счёта — через прямые `prisma`-вставки по образцу этого файла (с `ownerUserId` участника).

- [x] **Step 5: Проверки**

Run:
- `pnpm --filter @harmofin/api exec vitest run src/family` — PASS.
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/family-object-transfer.integration.test.ts test/family-members.integration.test.ts test/account-deletion.integration.test.ts` — PASS.
- `pnpm --filter @harmofin/api typecheck`, `pnpm lint` — PASS.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/family apps/api/src/account-deletion apps/api/test/family-object-transfer.integration.test.ts apps/api/test/account-deletion.integration.test.ts
git commit -m "feat(api): передача объектов создателю при выходе и удалении участника"
```

---

### Task 11: Плановые уведомления только владельцу плана

**Files:**
- Modify: `apps/worker/src/notification.handler.ts`
- Modify: `apps/worker/src/notification.handler.test.ts`
- Modify: `apps/api/test/v2-notifications.integration.test.ts`

**Interfaces:**
- Consumes: `RegularPlan.ownerUserId` (Task 1); relation `PlanOccurrence.plan`.
- Produces: `PLAN_TODAY`/`PLAN_OVERDUE` получает только владелец плана, если он активный `OWNER` или `EDITOR`. Открытые плановые уведомления других пользователей по вхождению закрываются (`resolvedAt`) с аудитом, как сейчас для бывших получателей.

- [x] **Step 1: Падающий тест**

В `apps/api/test/v2-notifications.integration.test.ts` сценарий этапа A «уведомления всем OWNER и EDITOR» переписать:
1. План создателя (`ownerUserId` создателя) с вхождением на сегодня → уведомление `PLAN_TODAY` только у создателя, у участника `EDITOR` — нет.
2. План участника (`ownerUserId` участника) → уведомление только у участника.
3. Открытое уведомление создателя по плану участника (вставлено напрямую, как осталось бы после этапа A) после запуска обработчика имеет `resolvedAt`.

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/v2-notifications.integration.test.ts`
Expected: FAIL.

- [x] **Step 2: Обработчик**

В запросе вхождений добавить владельца плана:

```ts
select: {
  id: true,
  planName: true,
  planType: true,
  scheduledOn: true,
  amountMinor: true,
  plan: { select: { ownerUserId: true } },
  payments: {
    where: {
      budgetId: budget.id,
      transaction: { status: 'CONFIRMED', deletedAt: null },
    },
    select: { transaction: { select: { amountMinor: true } } },
  },
},
```

Цикл создания:

```ts
const writers = new Set(recipientIds);
const active = new Set<string>();
for (const occurrence of occurrences) {
  const paid = occurrence.payments.reduce((sum, item) => sum + item.transaction.amountMinor, 0n);
  if (occurrence.amountMinor - paid <= 0n) continue;
  const ownerId = occurrence.plan.ownerUserId;
  // A plan of a member who left already belongs to the creator (same transaction as leaving).
  if (!writers.has(ownerId)) continue;
  const type = isoDate(occurrence.scheduledOn) < today ? 'PLAN_OVERDUE' : 'PLAN_TODAY';
  active.add(`${occurrence.id}:${type}:${ownerId}`);
  await createOccurrenceNotification(tx, budget, ownerId, type, occurrence);
}
```

Проверка открытых уведомлений:

```ts
const stillActive =
  notification.occurrenceId !== null &&
  active.has(`${notification.occurrenceId}:${notification.notificationType}:${notification.userId}`);
```

Блок `forExRecipients` не менять. Комментарий над `evaluateBudget`: «Recipient is the plan owner when they are an active OWNER or EDITOR; open plan notifications of anyone else are resolved.»

- [x] **Step 3: Unit-тест worker**

`apps/worker/src/notification.handler.test.ts`: ожидание «каждому OWNER и EDITOR» заменить на «только владельцу плана»; добавить кейс «владелец не входит в writer → уведомление не создаётся» и кейс «уведомление не-владельца закрывается».

- [x] **Step 4: Проверки**

Run:
- `pnpm --filter ./apps/worker test` — PASS.
- `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/v2-notifications.integration.test.ts test/notifications.integration.test.ts` — PASS.
- `pnpm typecheck`, `pnpm lint` — PASS.

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/notification.handler.ts apps/worker/src/notification.handler.test.ts apps/api/test/v2-notifications.integration.test.ts
git commit -m "feat(worker): плановые уведомления получает владелец плана"
```

---

### Task 12: Веб — права writer, подпись владельца, фильтр «Все / Мои»

**Files:**
- Modify: `apps/web/app/composables/usePermissions.ts`, `usePermissions.test.ts`
- Create: `apps/web/app/components/app/owner-label.ts`, `owner-label.test.ts`
- Modify: `apps/web/app/components/operations/author-label.ts` (тип `PersonRef`)
- Create: `apps/web/app/composables/useOwnerFilter.ts`, `useOwnerFilter.test.ts`
- Create: `apps/web/app/components/app/OwnerFilter.vue`, `OwnerFilter.test.ts`
- Modify: `apps/web/app/composables/useEnvelopePlanV2.ts` (тип `AuthorRef` → `PersonRef`, реэкспорт `AuthorRef` для совместимости)

**Interfaces:**
- Consumes: ответы API с `owner`, `canEdit`, `createdBy` (задачи 3–9); `useActiveWorkspace`, `useAuth` (`currentUser`), `useFamily` (этап A).
- Produces:
  - `usePermissions(): { canManage, canWrite, canCreate, userId, isMine(ownerUserId: string): boolean }`; `canCreate` = writer (создать свой счёт/конверт/план, распределить `FREE`).
  - `ownerLabel(owner: PersonRef, currentUserId: string | null): string` — «Мой» для своего, иначе `authorLabel(owner)`; `ownerNotice(owner: PersonRef): string` — «Принадлежит участнику «Алия» — изменять может только владелец».
  - `useOwnerFilter(): { mode: Ref<'all' | 'mine' | string>, ownerUserId: ComputedRef<string | undefined>, options: ComputedRef<ButtonGroupOption[]>, kind: ComputedRef<'none' | 'toggle' | 'chip'> }` — `none` при одном участнике, `toggle` («Все / Мои») при двух, `chip` (по участнику) при трёх и более.
  - `<OwnerFilter v-model="mode" />` — рендерит `UiButtonGroup` или `UiChip`-выбор по `kind`, ничего при `none`.

- [x] **Step 1: Падающие тесты**

```ts
// apps/web/app/components/app/owner-label.test.ts
import { describe, expect, it } from 'vitest';

import { ownerLabel, ownerNotice } from './owner-label.js';

const alia = { userId: 'u-alia', displayName: 'Алия', isActiveMember: true };

describe('ownerLabel', () => {
  it('names the current user «Мой»', () => {
    expect(ownerLabel(alia, 'u-alia')).toBe('Мой');
  });

  it('names other members by name and marks former ones', () => {
    expect(ownerLabel(alia, 'u-me')).toBe('Алия');
    expect(ownerLabel({ ...alia, isActiveMember: false }, 'u-me')).toBe('Алия (не в семье)');
  });

  it('explains why a foreign object is read-only', () => {
    expect(ownerNotice(alia)).toBe('Принадлежит участнику «Алия» — изменять может только владелец');
  });
});
```

```ts
// apps/web/app/composables/useOwnerFilter.test.ts — follow usePermissions.test.ts for mocking
// useActiveWorkspace/useAuth/useFamily (apps/web/app/test/nuxt-imports.ts).
import { describe, expect, it } from 'vitest';

describe('useOwnerFilter', () => {
  it('hides the filter for a single-member family', () => {
    // members = [me] -> kind 'none', ownerUserId undefined
  });
  it('offers «Все / Мои» for two members', () => {
    // members = [me, alia] -> kind 'toggle', options [{value:'all',label:'Все'},{value:'mine',label:'Мои'}];
    // mode 'mine' -> ownerUserId === my id
  });
  it('offers a chip per member for three or more', () => {
    // members = [me, alia, bob] -> kind 'chip', options include each member by authorLabel;
    // mode = alia's id -> ownerUserId === alia's id
  });
});
```

Writer заполняет три кейса `useOwnerFilter.test.ts` конкретными моками по образцу `usePermissions.test.ts` и `useFamily.test.ts`; ожидания — в комментариях. `OwnerFilter.test.ts`: при `kind = 'toggle'` рендерится `UiButtonGroup` с `label="Владелец"`, клик «Мои» эмитит `update:modelValue` с `'mine'`; при `none` — пустой рендер.

Run: `pnpm --filter ./apps/web exec vitest run app/components/app/owner-label.test.ts app/composables/useOwnerFilter.test.ts app/components/app/OwnerFilter.test.ts`
Expected: FAIL.

- [x] **Step 2: Реализация**

```ts
// apps/web/app/components/app/owner-label.ts
import { authorLabel, type AuthorRef } from '../operations/author-label.js';

export type PersonRef = AuthorRef;

/** «Мой» for the current user, otherwise the gender-neutral author label. */
export function ownerLabel(owner: PersonRef, currentUserId: string | null): string {
  return owner.userId === currentUserId ? 'Мой' : authorLabel(owner);
}

export function ownerNotice(owner: PersonRef): string {
  return `Принадлежит участнику «${owner.displayName ?? 'Участник'}» — изменять может только владелец`;
}
```

```ts
// apps/web/app/composables/usePermissions.ts
import { computed, type ComputedRef } from 'vue';

import { useActiveWorkspace } from './useActiveWorkspace.js';
import { useAuth } from './useAuth.js';

/** UI hint only: the server checks every action again. */
export function usePermissions(): {
  canManage: ComputedRef<boolean>;
  canWrite: ComputedRef<boolean>;
  canCreate: ComputedRef<boolean>;
  userId: ComputedRef<string | null>;
  isMine: (ownerUserId: string) => boolean;
} {
  const { role } = useActiveWorkspace();
  const { currentUser } = useAuth();
  const userId = computed(() => currentUser.value?.id ?? null);
  const canWrite = computed(() => role.value === 'OWNER' || role.value === 'EDITOR');
  return {
    canManage: computed(() => role.value === 'OWNER'),
    canWrite,
    canCreate: canWrite,
    userId,
    isMine: (ownerUserId: string) => ownerUserId === userId.value,
  };
}
```

Имя `currentUser` сверить с тем, что реально возвращает `useAuth()` (в файле есть `useState('auth-user')`; если наружу отдаётся под другим именем — использовать его).

`useOwnerFilter.ts`: берёт участников через `useFamily(computed(() => workspace.value?.id))`, вызывает `load()` один раз (`onMounted`), считает `kind` по `members.length`; `mode` — `ref('all')`; `ownerUserId`: `'all'` → `undefined`, `'mine'` → `userId`, иначе — `mode` (id участника). Опции чипа: `{ value: 'all', label: 'Все' }`, затем каждый участник `{ value: member.userId, label: member.userId === userId ? 'Мои' : authorLabel(member) }`.

`OwnerFilter.vue`: `kind === 'toggle'` → `<UiButtonGroup :options="options" :model-value="modelValue" label="Владелец" testid-prefix="owner-filter" @update:model-value="…" />`; `kind === 'chip'` → тот же `UiButtonGroup` (выбор одного значения из нескольких; Calm Fintech разрешает группу до 4–5 вариантов; при большем числе — `UiSelect` с меткой «Владелец»). Перед версткой прочитать `docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md`.

- [x] **Step 3: Проверки**

Run:
- `pnpm --filter ./apps/web exec vitest run app/components/app app/composables` — PASS.
- `pnpm --filter ./apps/web typecheck` (или `pnpm typecheck`), `pnpm lint` — PASS.

- [x] **Step 4: Commit**

```bash
git add apps/web/app/composables/usePermissions.ts apps/web/app/composables/usePermissions.test.ts apps/web/app/composables/useOwnerFilter.ts apps/web/app/composables/useOwnerFilter.test.ts apps/web/app/components/app/owner-label.ts apps/web/app/components/app/owner-label.test.ts apps/web/app/components/app/OwnerFilter.vue apps/web/app/components/app/OwnerFilter.test.ts apps/web/app/components/operations/author-label.ts apps/web/app/composables/useEnvelopePlanV2.ts
git commit -m "feat(web): подпись владельца и фильтр «Все / Мои»"
```

---

### Task 13: Веб — счета по владельцу

**Files:**
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts` (`AccountDto` + `owner`, `canEdit`; запрос списка с `ownerUserId`)
- Modify: `apps/web/app/pages/app/accounts.vue`, `accounts.test.ts`
- Modify: `apps/web/app/components/accounts/AccountRow.vue`, `AccountRow.test.ts`
- Modify: `apps/web/app/components/accounts/AccountDialog.vue`, `AccountDialog.test.ts`

**Interfaces:**
- Consumes: Task 3 (API), Task 12 (`usePermissions().canCreate`, `ownerLabel`, `ownerNotice`, `OwnerFilter`, `useOwnerFilter`).
- Produces: `AccountDto.owner: PersonRef`, `AccountDto.canEdit: boolean` — их же используют формы операций (задача 15).

- [x] **Step 1: Падающие тесты**

- `AccountRow.test.ts`: строка показывает подпись владельца текстом рядом с типом счёта («Наличные · Алия»; для своего — «Наличные · Мой») только если в семье больше одного участника (проп `showOwner`).
- `AccountDialog.test.ts`: для `canEdit: false` нет кнопок «Изменить» и «В архив», показан текст `ownerNotice(owner)`; для `canEdit: true` кнопки есть. `EDITOR` с `canEdit: true` видит кнопки (раньше требовался `canManage`).
- `accounts.test.ts`: кнопка «Добавить счёт» видна `EDITOR` (`canCreate`), не видна `VIEWER`; при выборе «Мои» в `OwnerFilter` список запрашивается с `ownerUserId=<мой id>` и сумма в шапке берётся из `summary` с тем же фильтром.

Run: `pnpm --filter ./apps/web exec vitest run app/components/accounts app/pages/app/accounts.test.ts`
Expected: FAIL.

- [x] **Step 2: Реализация**

- `AccountDto` + `owner: PersonRef`, `canEdit: boolean`; функции списка и сводки принимают `ownerUserId?: string` и добавляют его в query.
- `accounts.vue`: `canManage` → `canCreate` для «Добавить счёт» и пустого состояния; `<OwnerFilter v-model="ownerFilter.mode.value" />` в шапке списка (рядом с переключателем статуса); перезагрузка списка и сводки при смене `ownerUserId`.
- `AccountRow.vue`: проп `showOwner: boolean` (страница передаёт `ownerFilter.kind.value !== 'none'`); подпись `ownerLabel(account.owner, userId)` в строке метаданных, текстом.
- `AccountDialog.vue`: кнопки правки и архивации — по `account.canEdit` (вместо `canWrite`/`canManage`); при `!account.canEdit` — абзац `ownerNotice(account.owner)` с классом заметки диалога.

- [x] **Step 3: Проверки**

Run:
- `pnpm --filter ./apps/web exec vitest run app/components/accounts app/pages/app/accounts.test.ts` — PASS.
- `pnpm typecheck`, `pnpm lint` — PASS.

- [x] **Step 4: Commit**

```bash
git add apps/web/app/composables/useBudgetReferenceData.ts apps/web/app/pages/app/accounts.vue apps/web/app/pages/app/accounts.test.ts apps/web/app/components/accounts
git commit -m "feat(web): владелец счёта, правка только своих счетов"
```

---

### Task 14: Веб — конверты, распределение, перемещение и история с авторами

**Files:**
- Modify: `apps/web/app/composables/useEnvelopePlanV2.ts` (`EnvelopePlanDto` + `owner`, `canEdit`; `EnvelopeHistoryItem` + `direction`, `createdBy`, `counterpartName`, `assignmentType`; список конвертов с `ownerUserId`)
- Modify: `apps/web/app/components/envelopes/envelope-plan-kind.ts` (`historySign`/`historyAmountText` по `direction`), `envelope-plan-kind.test.ts`
- Modify: `apps/web/app/components/envelopes/EnvelopesPlanView.vue`, `EnvelopesPlanView.target.test.ts`, `apps/web/app/pages/app/envelopes/index.v2.test.ts`
- Modify: `apps/web/app/components/envelopes/EnvelopePlanRow.vue`, `EnvelopePlanRow.test.ts`
- Modify: `apps/web/app/components/envelopes/EnvelopePlanDialog.vue`, `EnvelopePlanDialog.test.ts`
- Modify: `apps/web/app/components/envelopes/EnvelopeMovePanel.vue`, `EnvelopeMovePanel.test.ts`
- Modify: `apps/web/app/components/envelopes/EnvelopesSummary.vue`, `EnvelopesShortfallDialog.vue`, `EnvelopeCoverPanel.vue` (проп `canManage` → `canAllocate`)
- Modify: `apps/web/app/components/funding/FundingReviewSheet.vue`, `FundingReviewSheet.test.ts` (подпись владельца у конвертов)
- Modify: `apps/web/app/components/envelopes/PeriodTargetDialog.vue` (действия цели — по `canEdit` конверта)

**Interfaces:**
- Consumes: задачи 4, 5, 9 (API), 12 (веб-хелперы).
- Produces: UI конвертов по матрице:
  - создать конверт — `canCreate`;
  - переименовать, архивировать, цель периода, правило наполнения — `envelope.canEdit`;
  - «Распределить» свободные деньги в любой конверт — `canCreate` (раньше `canManage`);
  - «Переместить» — только из своих конвертов (источник в `EnvelopeMovePanel` — конверты с `canEdit`); получатель — любой конверт, у чужих подпись владельца;
  - история — лента по дням с автором и направлением.

- [x] **Step 1: Падающие тесты**

```ts
// apps/web/app/components/envelopes/envelope-plan-kind.test.ts — replace the sign cases
import { describe, expect, it } from 'vitest';

import { historyAmountText, historySign } from './envelope-plan-kind.js';

describe('history sign comes from the server direction', () => {
  it('IN is plus, OUT is minus, for every kind', () => {
    expect(historySign('IN')).toBe('+');
    expect(historySign('OUT')).toBe('−');
    expect(historyAmountText('IN', '1000000')).toBe('+10 000 ₽');
    expect(historyAmountText('OUT', '230000')).toBe('−2 300 ₽');
  });
});
```

Точный формат суммы (`10 000 ₽`, неразрывные пробелы) взять из текущей реализации `historyAmountText` и существующих ожиданий теста — менять форматирование нельзя, только источник знака.

- `EnvelopePlanDialog.test.ts`: строка истории показывает «Алия: −2 300 ₽ · Детский мир» (автор — `authorLabel(createdBy)`, контрагент — `counterpartName`), перемещение — «Ильдар: −1 000 ₽ → Отпуск» для `OUT` и «Ильдар: +1 000 ₽ ← Расходы на детей» для `IN`; распределение дохода — «Ильдар: +10 000 ₽ из Зарплата»; при `canEdit: false` нет кнопок «Изменить», «Цель», «В архив», есть `ownerNotice`; кнопка «Распределить» есть у writer для чужого конверта.
- `EnvelopeMovePanel.test.ts`: в списке источников только конверты с `canEdit: true`; в списке получателей все конверты, у чужих — подпись владельца.
- `index.v2.test.ts`: «Создать конверт» видна `EDITOR`; «Распределить» в сводке видна `EDITOR`; `OwnerFilter` меняет запрос списка (`ownerUserId`).
- `FundingReviewSheet.test.ts`: у строки чужого конверта подпись владельца.

Run: `pnpm --filter ./apps/web exec vitest run app/components/envelopes app/components/funding app/pages/app/envelopes`
Expected: FAIL.

- [ ] **Step 2: Реализация** — см. «Ход выполнения» (отличие по кнопке «Распределить»)

- Типы в `useEnvelopePlanV2.ts`; `historySign(direction: 'IN' | 'OUT')`, `historyAmountText(direction, amountMinor)` — вызовы в `EnvelopePlanDialog.vue` передают `item.direction`.
- `EnvelopePlanDialog.vue`: история группируется по `effectiveOn` в стиле `OperationGroup` (заголовок дня, строки внутри; взять разметку и классы из компонента групп журнала операций). Строка: иконка вида (`KIND_ICONS`), текст `${authorLabel(item.createdBy)}: ${historyAmountText(item.direction, item.amountMinor)}`, вторичная подпись — контрагент по правилам из Step 1. Цвет суммы — только дополнительный сигнал; знак и текст всегда есть. Кнопки правки — `v-if="!envelope.archivedAt && envelope.canEdit"`; кнопка распределения — `canCreate`.
- `EnvelopesPlanView.vue`: `canManage` заменить по смыслу: создание и «Распределить» — `canCreate`; действия строки (переименовать, архив, цель) — `envelope.canEdit`; `OwnerFilter` в шапке списка; `EnvelopePlanRow` показывает подпись владельца при `kind !== 'none'`.
- `EnvelopesSummary.vue`, `EnvelopesShortfallDialog.vue`, `EnvelopeCoverPanel.vue`: проп `canManage` переименовать в `canAllocate` (значение — `canCreate`); «Покрыть» нехватку чужого конверта переводит деньги **в** него (`FREE` или перемещение из своих конвертов) — разрешено; источники перемещения внутри панели — только свои конверты.
- `PeriodTargetDialog.vue`: подтверждение/отклонение цели — только при `canEdit` конверта.
- `FundingReviewSheet.vue`: у строки конверта подпись `ownerLabel(envelope.owner, userId)`, если в семье больше одного участника.

- [x] **Step 3: Проверки**

Run:
- `pnpm --filter ./apps/web exec vitest run app/components/envelopes app/components/funding app/components/dashboard app/pages/app/envelopes` — PASS.
- `pnpm typecheck`, `pnpm lint` — PASS.

- [x] **Step 4: Commit**

```bash
git add apps/web/app/composables/useEnvelopePlanV2.ts apps/web/app/components/envelopes apps/web/app/components/funding apps/web/app/pages/app/envelopes
git commit -m "feat(web): конверты по владельцу, история с авторами"
```

---

### Task 15: Веб — формы операций и переводов, журнал

**Files:**
- Modify: `apps/web/app/composables/useOperationReferenceData.ts` (счета для формы)
- Modify: `apps/web/app/components/app/AppOperationDialogs.vue` (форма быстрого ввода и предложение распределить доход)
- Modify: `apps/web/app/components/operations/OperationDialog.vue`, `OperationDialog.test.ts`
- Modify: `apps/web/app/components/operations/TransferDialog.vue`, `TransferDialog.test.ts`
- Modify: `apps/web/app/pages/app/operations.vue`, `operations.test.ts`
- Modify: компонент формы расхода/дохода, через который `AppOperationDialogs.vue` создаёт операцию (найти по `transactionType` в `components/operations`), и его тест

**Interfaces:**
- Consumes: задачи 6 (API), 12, 13 (`AccountDto.canEdit`).
- Produces:
  - В форме дохода и расхода — только свои счета (`account.canEdit`); конверт — все конверты семьи, у чужих подпись владельца.
  - В форме перевода источник — свои счета, получатель — все счета семьи с подписью владельца.
  - Карточка операции и перевода: «Изменить», «Удалить», «Восстановить» — только если `createdBy.userId === userId`; иначе текст «Изменять операцию может только её автор». Автор виден и при открытии по прямой ссылке (поле `createdBy` в `GET :id`).
  - Предложение «Распределить доход» — только для своего дохода.
  - Фильтр «Удалённые» в журнале доступен `EDITOR` (отклонение 7).

- [x] **Step 1: Падающие тесты**

- Форма расхода: у `EDITOR` в списке счетов нет счёта с `canEdit: false`; в списке конвертов есть чужой конверт с подписью «Алия». Если своих счетов нет — вместо формы текст «Сначала добавьте свой счёт» и кнопка-ссылка на `/app/accounts`.
- `TransferDialog.test.ts`: источник — только свои счета; получатель — все, кроме выбранного источника; при открытии чужого перевода нет кнопок «Изменить»/«Удалить», есть пояснение.
- `OperationDialog.test.ts`: для операции с `createdBy.userId !== userId` нет кнопок изменения и удаления, есть пояснение; при открытии по deep link (данные из `GET :id`) строка «Добавил(а): …» заменена на нейтральное «Автор: Алия» (так же, как этап A показывает автора; сверить текущую подпись в компоненте и сохранить её формат).
- `operations.test.ts`: «Распределить» у дохода другого участника отсутствует; у своего — есть; переключатель удалённых виден `EDITOR`.

Run: `pnpm --filter ./apps/web exec vitest run app/components/operations app/components/app app/pages/app/operations.test.ts`
Expected: FAIL.

- [x] **Step 2: Реализация**

- `useOperationReferenceData.ts`: отдаёт `accounts` (все, для отображения и получателя перевода) и `ownAccounts = accounts.filter((account) => account.canEdit)`.
- Формы используют `ownAccounts` для счёта дохода/расхода и источника перевода; опции конвертов и счетов-получателей получают подпись `ownerLabel(item.owner, userId)` при семье больше одного человека.
- `OperationDialog.vue`, `TransferDialog.vue`: `canWrite` в условиях действий заменить на `isAuthor = computed(() => item.createdBy?.userId === userId.value)` в сочетании с `canWrite`; при `!isAuthor` — абзац «Изменять операцию может только её автор».
- `operations.vue`: функции `canEditTransaction`/`availableActions` учитывают автора; `isOwner`-проверка просмотра удалённых (строка с `item.status === 'CONFIRMED' || isOwner.value`) — заменить на `canWrite`.
- `AppOperationDialogs.vue` строка `funding.offer({ sourceKind: 'INCOME', … })` — вызывается для только что созданного своего дохода; дополнительных изменений не нужно, проверить тестом.

- [x] **Step 3: Проверки**

Run:
- `pnpm --filter ./apps/web exec vitest run app/components/operations app/components/app app/composables app/pages/app/operations.test.ts` — PASS.
- `pnpm typecheck`, `pnpm lint` — PASS.

- [x] **Step 4: Commit**

```bash
git add apps/web/app/composables/useOperationReferenceData.ts apps/web/app/components/app/AppOperationDialogs.vue apps/web/app/components/operations apps/web/app/pages/app/operations.vue apps/web/app/pages/app/operations.test.ts
git commit -m "feat(web): операции по своим счетам, правка только своих операций"
```

---

### Task 16: Веб — планы по владельцу и уведомление о переданных объектах

**Files:**
- Modify: композиции планов (`useObligationPlans`/`useIncomePlans`/`usePlansCalendar` — найти по путям `obligations/plans`, `income-plans`, `plans-calendar` в `apps/web/app/composables`) — типы `owner`, `canEdit`, запрос с `ownerUserId`
- Modify: `apps/web/app/pages/app/plans.vue`, `plans.test.ts`
- Modify: `apps/web/app/components/plans/PlanCatalog.vue`, `PlanDayPanel.vue`, `PlanItemList.vue` и их тесты
- Modify: `apps/web/app/components/notifications/NotificationCard.vue`, `NotificationCard.test.ts`

**Interfaces:**
- Consumes: задачи 7, 10 (API), 12.
- Produces:
  - Создание плана — `canCreate`; правка, отключение, удаление плана — `plan.canEdit`; «Оплатить», «Пропустить», «Закрыть», «Получить доход» — `item.canEdit` (владелец плана). Чужой план показывает владельца текстом.
  - `OwnerFilter` на странице планов.
  - Уведомление `OBJECTS_TRANSFERRED` — иконка и подпись как у уведомлений доступа этапа A (`MEMBER_*`), действие ведёт на `actionPath`.

- [x] **Step 1: Падающие тесты**

- `PlanItemList.test.ts`/`PlanDayPanel.test.ts`: у элемента с `canEdit: false` нет «Оплатить»/«Получить»/«Пропустить» и действий плана, есть «Владелец: Алия»; у своего — есть.
- `PlanCatalog.test.ts`: действия строки — по `plan.canEdit`; проп `canManage` удалён.
- `plans.test.ts`: «Создать план» видна `EDITOR`; `OwnerFilter` добавляет `ownerUserId` к запросам каталога.
- `NotificationCard.test.ts`: карточка `OBJECTS_TRANSFERRED` показывает заголовок с сервера и подпись типа (как `MEMBER_LEFT`), без суммы.

Run: `pnpm --filter ./apps/web exec vitest run app/components/plans app/components/notifications app/pages/app/plans.test.ts`
Expected: FAIL.

- [ ] **Step 2: Реализация** — см. «Ход выполнения» (отличие по действию «Закрыть»)

- Пропсы `canManage`/`canWrite` в `PlanCatalog`, `PlanDayPanel`, `PlanItemList` заменить на проверки `plan.canEdit`/`item.canEdit` плюс `canCreate` для кнопок создания и пустых состояний.
- Подпись владельца в строке плана — текстом в метаданных (`ownerLabel`), только при `kind !== 'none'`.
- `NotificationCard.vue`: добавить `OBJECTS_TRANSFERRED` в отображение типов уведомлений доступа (иконка и подпись — те же, что у `MEMBER_REMOVED`/`MEMBER_LEFT`; подпись типа «Семья»).

- [x] **Step 3: Проверки**

Run:
- `pnpm --filter ./apps/web exec vitest run app/components/plans app/components/notifications app/pages/app/plans.test.ts` — PASS.
- `pnpm typecheck`, `pnpm lint` — PASS.

- [x] **Step 4: Commit**

```bash
git add apps/web/app/composables apps/web/app/pages/app/plans.vue apps/web/app/pages/app/plans.test.ts apps/web/app/components/plans apps/web/app/components/notifications
git commit -m "feat(web): планы по владельцу, уведомление о переданных объектах"
```

---

### Task 17: E2E-сценарий, документация, финальная проверка

**Files:**
- Create: `e2e/family-ownership.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md` (§17.2 — матрица прав этапа B со ссылкой на дизайн)
- Modify: `docs/superpowers/specs/2026-10-25-family-access-design.md` — строка «Статус»: «этапы A и B реализованы»; раздел «Отклонения» не добавлять — они в этом плане
- Modify: `CLAUDE.md` — абзац о семейном доступе: убрать «it is being implemented in stages A and B, so check the code for what already exists», оставить ссылку на дизайн

**Interfaces:**
- Consumes: всё выше.

- [x] **Step 1: E2E-спека (выполняется в CI, локально не запускать)**

Хелперы регистрации, согласий и приглашения взять из `e2e/family-access.spec.ts` (этап A).

```ts
// e2e/family-ownership.spec.ts
import { expect, test } from '@playwright/test';

test('a family member funds the spouse envelope but cannot edit it', async ({ browser }) => {
  const creator = await browser.newContext();
  const creatorPage = await creator.newPage();
  // 1. Register the creator, set the name «Ильдар», create the account «Карта Ильдара»
  //    with a starting balance, record an income «Зарплата» 50 000 ₽ on it.
  // 2. Invite a member as «Участник» and register them through the link as «Алия»
  //    (same steps as family-access.spec.ts).
  const member = await browser.newContext();
  const memberPage = await member.newPage();
  // 3. As Алия: create the account «Карта Алии» and the envelope «Расходы на детей».
  // 4. As Ильдар: open «Конверты», allocate 10 000 ₽ of the income into «Расходы на детей».
  await creatorPage.goto('/app/envelopes');
  await creatorPage.getByText('Расходы на детей').click();
  await expect(creatorPage.getByText('Принадлежит участнику «Алия»')).toBeVisible();
  await expect(creatorPage.getByRole('button', { name: 'Изменить' })).toHaveCount(0);
  // 5. As Алия: open the envelope dialog and see the history entry by Ильдар.
  await memberPage.goto('/app/envelopes');
  await memberPage.getByText('Расходы на детей').click();
  await expect(memberPage.getByText(/Ильдар: \+10\s000/)).toBeVisible();
  // 6. As Алия: the expense form lists only «Карта Алии» as the account.
  await creator.close();
  await member.close();
});
```

Шаги-комментарии writer реализует через те же локаторы и хелперы, что в `e2e/family-access.spec.ts` и `e2e/envelope-v2-transfers-journal.spec.ts`. Локально спеку **не запускать**; проверка — `pnpm exec tsc --noEmit -p e2e` (если в репозитории есть такой tsconfig) или `pnpm lint`.

- [x] **Step 2: Документация**

§17.2 функциональной спецификации: таблица ролей дополняется матрицей этапа B (копия таблицы «Матрица (этап B)» из дизайна) и ссылкой на дизайн. Текст на русском.

- [x] **Step 3: Финальная проверка**

Run:
- `pnpm format:check` — PASS (если падает только на файлах этой ветки — `pnpm format` и повторить).
- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS.
- `pnpm test:integration` — PASS.
- `pnpm build` — PASS.
- `grep -rn "RolePolicy\|WRITE_ROLES\|allowEditor" apps/api/src` — пусто.
- `git status --short` — нет `identity/logo_description.png` в индексе.

- [x] **Step 4: Commit**

```bash
git add e2e/family-ownership.spec.ts docs/superpowers/specs/2026-08-30-family-budget-app-spec.md docs/superpowers/specs/2026-10-25-family-access-design.md CLAUDE.md
git commit -m "test(e2e): владение объектами семьи; документация этапа B"
```

---

## Review по задачам

| Задачи | Обязательные review |
|---|---|
| 1 | backend (миграция и backfill), financial (владельцы и авторы финансовых записей), security, QA, final |
| 2 | security, API (перенос `AuthorRefResponse`), QA, final |
| 3, 4 | API, security, financial (баланс счёта, архив конверта с остатком), QA, final |
| 5, 6 | **financial**, security, API, QA, final |
| 7 | **financial**, security, API, QA, final |
| 8 | security, QA, final |
| 9 | API, financial (знаки и только `CONFIRMED`), QA, final |
| 10 | security, financial (передача объектов без изменения сумм), backend, QA, final |
| 11 | backend, security, QA, final |
| 12–16 | UI/UX, security (15 — права в формах), QA, final |
| 17 | QA, final |

`BLOCK` от financial и security снимается только исправлением writer и повторной проверкой. Writer задачи — один субагент; reviewers только читают.

---

## Ход выполнения (2026-10-28)

Этап B полностью реализован и закоммичен в ветке `feat/family-access-stage-b`
(база `5364f22`, HEAD `be059ff`). Все 17 задач закрыты, каждая — отдельным
коммитом: задача 1 — `cddf0ef`, 2 — `e92816b`, 3 — `8cd80c9`, 4 — `760a62b`,
5 — `140cef9`, 6 — `30b9869` (плюс фиксация статуса `c3c461a`), 7 — `4b0ec7e`,
8 — `c0894de`, 9 — `9394983`, 10 — `eb17a79`, 11 — `7a0d533`, 12 — `be1116d`,
13 — `1a776c4`, 14 — `8cdf53f`, 15 — `15392c1`, 16 — `9352137`, 17 — `be059ff`.
Вне плана по ходу сделано три коммита: `484ac21` (мок object-transfer в
юнит-тесте удаления счёта — регресс от задачи 10), `1c3d028` (подпись владельца
в оффере пополнения из ссылок на конверты) и `309052d` (prettier к файлам
ветки).

Финальные проверки зелёные: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
`pnpm test` (api — 329 тестов, web — более 1500, worker — 50), `pnpm build`, а
также весь `pnpm test:integration`, кроме `v2-cycle-settings-at`: он падает и
на базе ветки (зависит от даты/среды, к этапу B не относится). Пустой выбор
`grep -rn "RolePolicy\|WRITE_ROLES\|allowEditor" apps/api/src` подтверждён;
`identity/logo_description.png` в коммиты не попадал.

Сознательные отличия от текста плана (остались открытыми подпункты «Реализация»
в задачах 14 и 16):

1. В списке конвертов (`EnvelopesPlanView.vue`) условие кнопки «Распределить» —
   `canCreate && envelope.canEdit !== false`, строже плана (по плану — только
   `canCreate`): у чужого конверта кнопка в строке не показывается.
2. Действие «Закрыть» у плана — не отдельная кнопка каталога по `item.canEdit`,
   как в тексте задачи 16; закрытие плана выполняется из карточки/редактирования
   и паузы под тем же `canEdit`. Смысл матрицы (чужой план не редактируется и не
   закрывается) сохранён.
3. Эндпоинты истории и аудита остались owner-only: `GET envelopes/:id/history`
   требует роль записи по учётной модели, аудит транзакции — владельца. EDITOR,
   автор записи в чужом конверте, историю/аудит своей записи не читает (403).
   План этого исключения не описывал; оставлено как есть.

OWNER-DEBT (на заметку владельцу, вне объёма этапа):

- `v2-cycle-settings-at` — хрупкий интеграционный тест (зависит от текущей
  даты), воспроизводится на базе ветки; требует стабилизации.
- `manifest.webmanifest`: prettier периодически меняет переносы строк (CRLF),
  `format:check` может шуметь на файле вне изменений.
- `openapi.json`: форматирование prettier конфликтует с выводом генератора;
  трогать только через `309052d`-подобные коммиты.
- `e2e/family-ownership.spec.ts` написан и проходит `lint`/типы, но локально не
  запускался (правило: Playwright только по запросу владельца); проверка — CI.
- Мелочи, оставленные как есть: `PrismaClient` напрямую в
  `JournalApplicationService`; устаревший кэш `loadedFor` в `useOwnerFilter`;
  потенциальный тупик правки переданного (`transferred`) счёта в UI; список
  счетов в `FundingEntryHost` без фильтра по владельцу.
