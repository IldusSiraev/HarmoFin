# Лента семьи — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Лента «что сделали другие с прошлого визита»: карточка на главной, страница `/app/activity` и счётчик новых событий в меню.

**Architecture:** Источник — существующая таблица `audit_events`. Сервер выбирает строки бюджета за 30 дней по белому списку пар «`entityType` + `action`», без своих событий и событий без автора. Каждая строка разбирается чистой функцией в черновик записи; названия счетов, конвертов, категорий, планов и событий подставляются запросами внутри бюджета. Отметка «просмотрено» хранится в новой таблице `activity_feed_cursors` и сдвигается при открытии страницы ленты. Веб собирает фразы по `kind` и использует существующие компоненты Calm Fintech.

**Tech Stack:** TypeScript strict, NestJS 11 + Fastify, Prisma 6 + PostgreSQL 18, zod 4, Vitest 4, Nuxt 4 / Vue 3.5, `@lucide/vue`, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-30-family-activity-feed-design.md](../specs/2026-10-30-family-activity-feed-design.md) — читать целиком перед первой задачей. При расхождении плана и спецификации прав дизайн; расхождение сообщить координатору.

## Как выполнять этот план (для другой сессии)

- Ветка `feat/family-activity-feed` (уже создана, на ней закоммичены дизайн, roadmap и этот план). Перед каждым коммитом проверять `git branch --show-current`.
- Работа делится на 2 PR. Задачи 1–3 — PR 1 (API), задачи 4–7 — PR 2 (веб). После последней задачи PR координатор останавливается и спрашивает владельца, открывать ли PR. PR 2 начинается от свежего `main` после мержа PR 1 (новая ветка `feat/family-activity-feed-web`), без worktree.
- Subagent-driven development: один writer на задачу; writer только индексирует изменения (`git add <пути>`), коммит делает координирующая сессия после review по таблице в конце плана. Если review вернул `BLOCK` — исправляет тот же writer, review повторяется.
- Ход выполнения вести в этом файле: в конце — раздел «Ход выполнения» (задача, коммит, review, решения). Это единственный источник состояния для следующей сессии.

## Global Constraints

- Лента доступна всем ролям: `OWNER` («Создатель»), `EDITOR` («Участник»), `VIEWER` («Наблюдатель»). Каждый сдвигает только свою отметку; `userId` берётся из сессии.
- Доступ: `planModelPolicy.requireModel(userId, budgetId, 2)` (404 `RESOURCE_NOT_FOUND` для чужого бюджета, 409 `MODEL_VERSION_MISMATCH`) → `findAccessActor` в транзакции (нет — 404). Новых кодов ошибок нет; испорченный курсор — 400 `VALIDATION_FAILED`.
- Каждый запрос к данным фильтрует `budgetId` в самом запросе. Белый список и исключение своих событий — в `where` запроса, не после выборки.
- Наружу не отдаются `oldValues`, `newValues`, `requestId`, `source` записей аудита.
- Окно ленты — 30 дней от времени сервера. Без отметки новыми считаются события за последние 7 дней. Страница — до 30 записей, карточка — 5.
- Лента не считает деньги: суммы — строки minor units из записей аудита, клиент их только форматирует через `formatMinorUnits(minor, currency, 2)`.
- Только аддитивные изменения API `/api/v2` и OpenAPI; оба эндпоинта, все поля и коды ошибок описаны.
- Миграция только аддитивная, бэкфилла нет. Никогда не запускать `pnpm db:migrate:dev`, reset или откат на данных владельца (`harmofin`).
- UI-тексты на русском, идентификаторы на английском. Calm Fintech: только существующие токены и компоненты, `@lucide/vue`, Inter, без новых цветов; статус — текстом, не только цветом.
- Подписи людей — через `authorLabel` (`apps/web/app/components/operations/author-label.ts`): «Алия», «Алия (не в семье)», без имени — «Участник».
- Local Playwright не запускать (только CI). Не создавать worktree. Не трогать `identity/logo_description.png`. Субагенты не запускают `pnpm infra:down` и не трогают dev-процессы владельца.
- Интеграционные тесты: весь набор — только `pnpm test:integration` (одноразовая БД `harmofin_v22_test`); один файл — `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts <файл>`. Перед первым запуском одного файла после новой миграции один раз прогнать `pnpm test:integration` — он применяет миграции к одноразовой БД.
- `pnpm db:generate` может падать с EPERM, пока у владельца запущены dev-процессы (Windows держит движок Prisma). Процессы не трогать — сообщить координатору.
- `openapi.json` обновлять командой `node scripts/openapi/generate.mjs` после изменений контроллеров и DTO; затем `pnpm exec prettier --write openapi.json`.

## Уточнения к дизайну, найденные при подготовке плана

Код аудита проверен при подготовке плана. Дизайн обновлён теми же правками; здесь — короткая сводка для writer.

- `calendar_event` пишет в аудит только поля правила (`startsOn`, `startsAt`, без названия). Название берётся из `calendar_events` по `entityId` внутри бюджета.
- `plan_occurrence` `COMPLETED` в модели v2 пишет только `{ status }` (`obligations/obligation.repository.ts`). Название плана берётся через вхождение (`plan_occurrences.plan_id` → `regular_plans.name`). Суммы у `PLAN_PAID` нет: ожидаемая сумма вхождения не равна фактической оплате.
- В v2 у операций нет отдельного действия `CANCELLED`: `transaction` пишет `CREATED`, `UPDATED`, `DELETED`, `RESTORED`. `TRANSACTION_CANCELLED` в белый список не входит.
- `transfer` `UPDATED` пишет только изменённые поля и в белый список не входит.
- События состава семьи (`workspace_invitation` `ACCEPTED`, `workspace_membership` `LEFT`/`REMOVED`) записывают `budgetId` активного бюджета, поэтому вся лента читается по `budgetId`.
- Автор в ответе — существующий `PersonRef` (`{ userId, displayName, isActiveMember }`), как в календаре.
- Ответ содержит `people` — других участников семьи (активных и бывших). Веб скрывает карточку при пустом списке и строит из него фильтр.
- Строка ленты — `UiListRow` с новым свойством `static` (рендер `div` вместо `button`) для записей без ссылки.
- Пункт «Лента» — в сайдбаре и мобильном меню (нижняя навигация не меняется).

## Карта файлов

| Файл | Ответственность | Задача |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261031000000_activity_feed_cursors/migration.sql` | таблица отметки | 1 |
| `apps/worker/src/account-purge.ts` | удаление отметок при удалении аккаунта | 1 |
| `docs/runbooks/budget-reset.sql` | удаление отметок при сбросе бюджета | 1 |
| `apps/api/test/helpers/family-app.ts` | очистка отметок после тестов | 1 |
| `apps/api/test/budget-reset-script.integration.test.ts` | строка отметки в фикстуре | 1 |
| `apps/api/test/activity-feed-schema.integration.test.ts` | уникальность и связи | 1 |
| `apps/api/src/activity-feed/feed-kinds.ts` (+test) | белый список, `FeedKind`, `kindOf` | 2 |
| `apps/api/src/activity-feed/feed-parsers.ts` (+test) | разбор записи аудита в `FeedDraft` | 2 |
| `apps/api/src/activity-feed/feed-cursor.ts` (+test) | курсор страниц | 2 |
| `apps/api/src/activity-feed/activity-feed.schemas.ts` (+test) | zod-схема query | 3 |
| `apps/api/src/activity-feed/activity-feed.repository.ts` | запросы аудита, названий, отметки | 3 |
| `apps/api/src/activity-feed/activity-feed.application.service.ts` | доступ, окно, сборка ответа | 3 |
| `apps/api/src/activity-feed/activity-feed.dto.ts`, `activity-feed.controller.ts`, `activity-feed.module.ts`, `apps/api/src/app.module.ts` | HTTP и OpenAPI | 3 |
| `apps/api/test/activity-feed.integration.test.ts` | доступ, изоляция, окно, отметка | 3 |
| `apps/api/test/v2-openapi.integration.test.ts`, `openapi.json` | контракт | 3 |
| `apps/web/app/composables/useActivityFeed.ts` (+test) | клиент API, общий счётчик | 4 |
| `apps/web/app/components/activity/activity-phrases.ts` (+test) | фраза, иконка, тон, ссылка, время | 4 |
| `apps/web/app/components/ui/ListRow.vue` (+test) | свойство `static` | 5 |
| `apps/web/app/components/activity/ActivityRow.vue` (+test) | строка ленты | 5 |
| `apps/web/app/components/dashboard/FamilyActivityCard.vue` (+test), `apps/web/app/pages/app/index.vue` | карточка на главной | 5 |
| `apps/web/app/pages/app/activity.vue` (+test) | страница ленты | 6 |
| `apps/web/app/components/app/AppSidebar.vue`, `AppMobileMenu.vue` (+tests) | пункт «Лента» и счётчик | 6 |
| `e2e/family-activity.spec.ts` | сквозной сценарий (CI) | 7 |
| `README.md` | описание возможности | 7 |

---

## PR 1 — данные и API

### Task 1: Таблица отметки, миграция и очистка

**Files:**
- Modify: `prisma/schema.prisma` (новая модель; обратные связи в `User` рядом с `calendarEventParticipations` ~строка 225, в `Workspace` рядом с `calendarEvents` ~строка 267, в `Budget` рядом с `calendarEvents` ~строка 354)
- Create: `prisma/migrations/20261031000000_activity_feed_cursors/migration.sql`
- Modify: `apps/worker/src/account-purge.ts`
- Modify: `docs/runbooks/budget-reset.sql`
- Modify: `apps/api/test/helpers/family-app.ts` (метод `cleanup`)
- Modify: `apps/api/test/budget-reset-script.integration.test.ts` (функция `seedBudget`)
- Test: `apps/api/test/activity-feed-schema.integration.test.ts`

**Interfaces:**
- Produces: Prisma-модель `ActivityFeedCursor` (`prisma.activityFeedCursor`), таблица `activity_feed_cursors`, уникальный ключ `budgetId_userId`.

- [ ] **Step 1: Модель Prisma**

В `prisma/schema.prisma` после модели `CalendarEventParticipant`:

```prisma
/// Per-member "seen" marker of the family activity feed. Not a financial record: no audit, no history.
model ActivityFeedCursor {
  id          String   @id @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  budgetId    String   @map("budget_id") @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  seenAt      DateTime @map("seen_at") @db.Timestamptz(3)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  budget    Budget    @relation(fields: [budgetId, workspaceId], references: [id, workspaceId], onDelete: Restrict, onUpdate: Cascade)
  user      User      @relation("ActivityFeedCursorUser", fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([budgetId, userId])
  @@map("activity_feed_cursors")
}
```

Обратные связи:

- в `User`: `activityFeedCursors ActivityFeedCursor[] @relation("ActivityFeedCursorUser")`;
- в `Workspace`: `activityFeedCursors ActivityFeedCursor[]`;
- в `Budget`: `activityFeedCursors ActivityFeedCursor[]`.

- [ ] **Step 2: SQL миграции (вручную, без `migrate dev`)**

`prisma/migrations/20261031000000_activity_feed_cursors/migration.sql`:

```sql
-- Family activity feed: per-member "seen" marker.
-- Additive: one new table with FKs to existing workspaces/budgets/users, no backfill.

-- CreateTable
CREATE TABLE "activity_feed_cursors" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seen_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "activity_feed_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_feed_cursors_budget_id_user_id_key" ON "activity_feed_cursors"("budget_id", "user_id");

-- AddForeignKey
ALTER TABLE "activity_feed_cursors" ADD CONSTRAINT "activity_feed_cursors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_feed_cursors" ADD CONSTRAINT "activity_feed_cursors_budget_id_workspace_id_fkey" FOREIGN KEY ("budget_id", "workspace_id") REFERENCES "budgets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_feed_cursors" ADD CONSTRAINT "activity_feed_cursors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Run: `pnpm db:generate`
Expected: `Generated Prisma Client`. При EPERM — остановиться и сообщить координатору.

- [ ] **Step 3: Падающий тест схемы**

`apps/api/test/activity-feed-schema.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createUuidV7 } from '../src/common/identifiers/uuid-v7.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let other: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  other = await env.register();
});

afterAll(async () => {
  await env.stop();
});

const cursor = (actor: FamilyActor, budgetId = actor.budgetId) => ({
  id: createUuidV7(),
  workspaceId: actor.workspaceId,
  budgetId,
  userId: actor.user.id,
  seenAt: new Date('2026-10-30T10:00:00.000Z'),
});

describe('activity_feed_cursors', () => {
  it('stores one marker per budget and user', async () => {
    await env.prisma.activityFeedCursor.create({ data: cursor(creator) });
    await expect(env.prisma.activityFeedCursor.create({ data: cursor(creator) })).rejects.toThrow(
      /Unique constraint/,
    );
  });

  it('rejects a budget of another workspace', async () => {
    await expect(
      env.prisma.activityFeedCursor.create({ data: cursor(creator, other.budgetId) }),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});
```

Run: `pnpm test:integration` (первый прогон после миграции), затем один файл командой из Global Constraints.
Expected до шага 4: тесты схемы PASS (таблица уже есть), но `afterAll` падает с `Foreign key constraint` при удалении бюджета — строки отметки не удаляются.

- [ ] **Step 4: Очистка в тестовом помощнике**

В `apps/api/test/helpers/family-app.ts`, метод `cleanup`, первой строкой после `const byBudget = …`:

```ts
    await this.prisma.activityFeedCursor.deleteMany({ where: byBudget });
```

Run: тот же файл.
Expected: PASS, `afterAll` без ошибок.

- [ ] **Step 5: Удаление аккаунта**

В `apps/worker/src/account-purge.ts`:

1. В начало `BUDGET_TABLES_IN_DELETE_ORDER` (перед `'plan_payments'`) — `'activity_feed_cursors',`.
2. В `USER_OWNED_TABLES` — `'activity_feed_cursors',` последним элементом.
3. В `purgeUserData` после строки `DELETE FROM "user_consents" …`:

```ts
  // The user's own "seen" markers in other families' feeds: personal state, not shared history.
  await tx.$executeRaw`DELETE FROM "activity_feed_cursors" WHERE "user_id" = ${userId}::uuid`;
```

Run: `pnpm --filter @harmofin/worker exec vitest run src/account-purge.coverage.test.ts src/account-purge.handler.test.ts`
Expected: PASS (без шага 5 первый тест покрытия падал бы с `ActivityFeedCursor -> activity_feed_cursors`).

- [ ] **Step 6: Сброс бюджета**

В `docs/runbooks/budget-reset.sql`, раздел «3. Удаление дочерних таблиц», перед `DELETE FROM plan_payments …`:

```sql
  DELETE FROM activity_feed_cursors WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('activity_feed_cursors', v_n);
```

В `apps/api/test/budget-reset-script.integration.test.ts`, функция `seedBudget`, после создания `calendarEventParticipant`:

```ts
  await prisma.activityFeedCursor.create({
    data: { id: id(), workspaceId, budgetId, userId, seenAt: new Date() },
  });
```

Run: один файл `test/budget-reset-script.integration.test.ts`.
Expected: PASS. Тест «фикстура богатая» без строки в фикстуре падал бы с `fixture has no rows in activity_feed_cursors`.

- [ ] **Step 7: Проверки и индексация**

Run: `pnpm typecheck` и `pnpm --filter @harmofin/worker test`
Expected: без ошибок.

```bash
git add prisma/schema.prisma prisma/migrations/20261031000000_activity_feed_cursors apps/worker/src/account-purge.ts docs/runbooks/budget-reset.sql apps/api/test/helpers/family-app.ts apps/api/test/budget-reset-script.integration.test.ts apps/api/test/activity-feed-schema.integration.test.ts
```

Сообщение коммита (делает координатор): `feat(db): отметка просмотра ленты семьи`.

### Task 2: Белый список, разбор записей аудита, курсор

**Files:**
- Create: `apps/api/src/activity-feed/feed-kinds.ts`
- Create: `apps/api/src/activity-feed/feed-parsers.ts`
- Create: `apps/api/src/activity-feed/feed-cursor.ts`
- Test: `apps/api/src/activity-feed/feed-kinds.test.ts`, `feed-parsers.test.ts`, `feed-cursor.test.ts`

**Interfaces:**
- Produces:
  - `FEED_KINDS` (readonly tuple), `type FeedKind`, `FEED_SOURCES: ReadonlyArray<{ entityType: string; action: string; kind: FeedKind }>`, `kindOf(entityType: string, action: string): FeedKind | null`;
  - `interface FeedAuditRow { id: string; createdAt: Date; actorUserId: string; entityType: string; entityId: string | null; action: string; oldValues: unknown; newValues: unknown }`;
  - `type RefType = 'ACCOUNT' | 'ENVELOPE' | 'CATEGORY' | 'PLAN' | 'OCCURRENCE' | 'CALENDAR_EVENT'`, `interface Ref { type: RefType; id: string }`;
  - `type LinkType = 'TRANSACTION' | 'TRANSFER' | 'ENVELOPE' | 'PLAN_OCCURRENCE' | 'PLAN' | 'CALENDAR_EVENT'`;
  - `interface FeedDraft` (поля ниже), `parseAuditRow(row: FeedAuditRow): FeedDraft | null`;
  - `interface FeedCursor { createdAt: Date; id: string }`, `encodeCursor(cursor: FeedCursor): string`, `decodeCursor(raw: string): FeedCursor | null`.

- [ ] **Step 1: Падающие тесты белого списка и курсора**

`apps/api/src/activity-feed/feed-kinds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { FEED_KINDS, FEED_SOURCES, kindOf } from './feed-kinds.js';

describe('feed kinds', () => {
  it('maps every whitelisted audit pair to one kind', () => {
    expect(kindOf('transaction', 'CREATED')).toBe('TRANSACTION_CREATED');
    expect(kindOf('envelope-movement', 'CREATED')).toBe('ENVELOPE_MOVED');
    expect(kindOf('plan_occurrence', 'COMPLETED')).toBe('PLAN_PAID');
    expect(kindOf('workspace_invitation', 'ACCEPTED')).toBe('MEMBER_JOINED');
  });

  it('ignores pairs outside the whitelist', () => {
    expect(kindOf('transaction', 'CANCELLED')).toBeNull();
    expect(kindOf('transfer', 'UPDATED')).toBeNull();
    expect(kindOf('auth', 'LOGIN')).toBeNull();
    expect(kindOf('budget', 'UPDATED')).toBeNull();
  });

  it('has exactly one source per kind and no duplicate pairs', () => {
    expect(FEED_SOURCES.map((source) => source.kind).sort()).toEqual([...FEED_KINDS].sort());
    const pairs = FEED_SOURCES.map((source) => `${source.entityType}:${source.action}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
```

`apps/api/src/activity-feed/feed-cursor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './feed-cursor.js';

const id = '0195f0a0-0000-7000-8000-000000000001';

describe('feed cursor', () => {
  it('round-trips createdAt and id', () => {
    const createdAt = new Date('2026-10-30T11:20:00.123Z');
    expect(decodeCursor(encodeCursor({ createdAt, id }))).toEqual({ createdAt, id });
  });

  it('rejects garbage, wrong version, bad date and bad id', () => {
    const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(raw({ v: 2, createdAt: '2026-10-30T00:00:00.000Z', id }))).toBeNull();
    expect(decodeCursor(raw({ v: 1, createdAt: 'yesterday', id }))).toBeNull();
    expect(decodeCursor(raw({ v: 1, createdAt: '2026-10-30T00:00:00.000Z', id: 'x' }))).toBeNull();
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/activity-feed`
Expected: FAIL — `Cannot find module './feed-kinds.js'` и `'./feed-cursor.js'`.

- [ ] **Step 2: Белый список**

`apps/api/src/activity-feed/feed-kinds.ts`:

```ts
/**
 * Family-relevant audit pairs shown in the activity feed. Technical events (sign-in, settings,
 * reference data, notifications, demo seed) are deliberately absent. A pair is listed only when a
 * v2 write path records it; see the design doc for the source repositories.
 */
export const FEED_KINDS = [
  'TRANSACTION_CREATED',
  'TRANSACTION_UPDATED',
  'TRANSACTION_DELETED',
  'TRANSACTION_RESTORED',
  'TRANSFER_CREATED',
  'TRANSFER_DELETED',
  'ENVELOPE_FUNDED',
  'ENVELOPE_MOVED',
  'PLAN_PAID',
  'PLAN_CREATED',
  'CALENDAR_EVENT_CREATED',
  'CALENDAR_EVENT_UPDATED',
  'CALENDAR_EVENT_DELETED',
  'MEMBER_JOINED',
  'MEMBER_LEFT',
  'MEMBER_REMOVED',
] as const;

export type FeedKind = (typeof FEED_KINDS)[number];

export const FEED_SOURCES: ReadonlyArray<{ entityType: string; action: string; kind: FeedKind }> =
  [
    { entityType: 'transaction', action: 'CREATED', kind: 'TRANSACTION_CREATED' },
    { entityType: 'transaction', action: 'UPDATED', kind: 'TRANSACTION_UPDATED' },
    { entityType: 'transaction', action: 'DELETED', kind: 'TRANSACTION_DELETED' },
    { entityType: 'transaction', action: 'RESTORED', kind: 'TRANSACTION_RESTORED' },
    { entityType: 'transfer', action: 'CREATED', kind: 'TRANSFER_CREATED' },
    { entityType: 'transfer', action: 'DELETED', kind: 'TRANSFER_DELETED' },
    { entityType: 'envelope-assignment', action: 'CREATED', kind: 'ENVELOPE_FUNDED' },
    { entityType: 'envelope-movement', action: 'CREATED', kind: 'ENVELOPE_MOVED' },
    { entityType: 'plan_occurrence', action: 'COMPLETED', kind: 'PLAN_PAID' },
    { entityType: 'regular_plan', action: 'CREATED', kind: 'PLAN_CREATED' },
    { entityType: 'calendar_event', action: 'CREATED', kind: 'CALENDAR_EVENT_CREATED' },
    { entityType: 'calendar_event', action: 'UPDATED', kind: 'CALENDAR_EVENT_UPDATED' },
    { entityType: 'calendar_event', action: 'DELETED', kind: 'CALENDAR_EVENT_DELETED' },
    { entityType: 'workspace_invitation', action: 'ACCEPTED', kind: 'MEMBER_JOINED' },
    { entityType: 'workspace_membership', action: 'LEFT', kind: 'MEMBER_LEFT' },
    { entityType: 'workspace_membership', action: 'REMOVED', kind: 'MEMBER_REMOVED' },
  ];

export function kindOf(entityType: string, action: string): FeedKind | null {
  return (
    FEED_SOURCES.find((source) => source.entityType === entityType && source.action === action)
      ?.kind ?? null
  );
}
```

- [ ] **Step 3: Курсор**

`apps/api/src/activity-feed/feed-cursor.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyset position in `createdAt DESC, id DESC` order. Opaque to the client. */
export interface FeedCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify({ v: 1, createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString('base64url');
}

export function decodeCursor(raw: string): FeedCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { v, createdAt, id } = parsed as Record<string, unknown>;
  if (v !== 1 || typeof createdAt !== 'string' || typeof id !== 'string' || !UUID.test(id)) {
    return null;
  }
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : { createdAt: date, id };
}
```

Run: `pnpm --filter @harmofin/api exec vitest run src/activity-feed/feed-kinds.test.ts src/activity-feed/feed-cursor.test.ts`
Expected: PASS.

- [ ] **Step 4: Падающие тесты разбора**

Эталонные записи повторяют реальные формы `newValues`/`oldValues` из репозиториев: `transactions/transaction.repository.ts` (`auditValues`), `v2-transfers/direct-transfer.repository.ts` (`newValues` при создании, `transferAuditValues`), `envelope-plans/assignment.repository.ts`, `envelope-plans/movement.repository.ts`, `obligations/obligation.repository.ts` (`{ status }`), `plans/regular-plan.repository.ts` (`planAuditValues`), `calendar/calendar.application.service.ts` (`auditValues` без названия), `family/invitation-acceptance.ts`, `family/members.application.service.ts`.

`apps/api/src/activity-feed/feed-parsers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseAuditRow, type FeedAuditRow } from './feed-parsers.js';

const ids = {
  row: '0195f0a0-0000-7000-8000-0000000000a1',
  actor: '0195f0a0-0000-7000-8000-0000000000b1',
  entity: '0195f0a0-0000-7000-8000-0000000000c1',
  account: '0195f0a0-0000-7000-8000-0000000000d1',
  account2: '0195f0a0-0000-7000-8000-0000000000d2',
  category: '0195f0a0-0000-7000-8000-0000000000e1',
  envelope: '0195f0a0-0000-7000-8000-0000000000f1',
  envelope2: '0195f0a0-0000-7000-8000-0000000000f2',
};
const at = new Date('2026-10-30T11:20:00.000Z');

const row = (overrides: Partial<FeedAuditRow>): FeedAuditRow => ({
  id: ids.row,
  createdAt: at,
  actorUserId: ids.actor,
  entityType: 'transaction',
  entityId: ids.entity,
  action: 'CREATED',
  oldValues: null,
  newValues: null,
  ...overrides,
});

const transactionValues = {
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '120000',
  occurredOn: '2026-10-30',
  accountId: ids.account,
  categoryId: ids.category,
  envelopeId: ids.envelope,
  isPlanned: false,
  confirmedAt: '2026-10-30T11:20:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  preDeleteStatus: null,
};

describe('parseAuditRow', () => {
  it('transaction created: amount, type, category title, account and envelope details, link', () => {
    expect(parseAuditRow(row({ newValues: transactionValues }))).toEqual({
      auditEventId: ids.row,
      occurredAt: at,
      kind: 'TRANSACTION_CREATED',
      actorUserId: ids.actor,
      amountMinor: 120000n,
      transactionType: 'EXPENSE',
      title: { type: 'CATEGORY', id: ids.category },
      details: [
        { type: 'ACCOUNT', id: ids.account },
        { type: 'ENVELOPE', id: ids.envelope },
      ],
      link: { type: 'TRANSACTION', id: ids.entity },
      eventStart: null,
      targetMembershipId: null,
    });
  });

  it('transaction deleted reads the state before deletion', () => {
    const draft = parseAuditRow(
      row({
        action: 'DELETED',
        oldValues: { ...transactionValues, envelopeId: null },
        newValues: { ...transactionValues, status: 'DELETED', envelopeId: null },
      }),
    );
    expect(draft).toMatchObject({
      kind: 'TRANSACTION_DELETED',
      amountMinor: 120000n,
      details: [{ type: 'ACCOUNT', id: ids.account }],
    });
  });

  it('transfer created and deleted: total and both accounts', () => {
    const created = parseAuditRow(
      row({
        entityType: 'transfer',
        newValues: {
          mode: 'ACCOUNT_ONLY',
          sourceAccountId: ids.account,
          destinationAccountId: ids.account2,
          totalMinor: '500000',
          occurredOn: '2026-10-30',
        },
      }),
    );
    expect(created).toMatchObject({
      kind: 'TRANSFER_CREATED',
      amountMinor: 500000n,
      transactionType: null,
      title: null,
      details: [
        { type: 'ACCOUNT', id: ids.account },
        { type: 'ACCOUNT', id: ids.account2 },
      ],
      link: { type: 'TRANSFER', id: ids.entity },
    });
    const deleted = parseAuditRow(
      row({
        entityType: 'transfer',
        action: 'DELETED',
        oldValues: {
          status: 'CONFIRMED',
          sourceAccountId: ids.account,
          destinationAccountId: ids.account2,
          totalMinor: '500000',
          occurredOn: '2026-10-30',
          comment: null,
          deletedAt: null,
        },
        newValues: { status: 'DELETED' },
      }),
    );
    expect(deleted).toMatchObject({ kind: 'TRANSFER_DELETED', amountMinor: 500000n });
  });

  it('envelope funded and moved', () => {
    expect(
      parseAuditRow(
        row({
          entityType: 'envelope-assignment',
          newValues: {
            envelopeId: ids.envelope,
            periodId: ids.entity,
            type: 'FREE',
            sourceIncomeTransactionId: null,
            amountMinor: '300000',
            effectiveOn: '2026-10-30T00:00:00.000Z',
          },
        }),
      ),
    ).toMatchObject({
      kind: 'ENVELOPE_FUNDED',
      amountMinor: 300000n,
      title: { type: 'ENVELOPE', id: ids.envelope },
      details: [],
      link: { type: 'ENVELOPE', id: ids.envelope },
    });
    expect(
      parseAuditRow(
        row({
          entityType: 'envelope-movement',
          newValues: {
            sourceEnvelopeId: ids.envelope,
            sourcePeriodId: ids.entity,
            destinationEnvelopeId: ids.envelope2,
            destinationPeriodId: ids.entity,
            amountMinor: '150000',
            effectiveOn: '2026-10-30T00:00:00.000Z',
          },
        }),
      ),
    ).toMatchObject({
      kind: 'ENVELOPE_MOVED',
      amountMinor: 150000n,
      title: null,
      details: [
        { type: 'ENVELOPE', id: ids.envelope },
        { type: 'ENVELOPE', id: ids.envelope2 },
      ],
      link: { type: 'ENVELOPE', id: ids.envelope2 },
    });
  });

  it('plan paid has no amount and resolves its title through the occurrence', () => {
    expect(
      parseAuditRow(
        row({
          entityType: 'plan_occurrence',
          action: 'COMPLETED',
          oldValues: { status: 'DUE' },
          newValues: { status: 'COMPLETED' },
        }),
      ),
    ).toMatchObject({
      kind: 'PLAN_PAID',
      amountMinor: null,
      title: { type: 'OCCURRENCE', id: ids.entity },
      link: { type: 'PLAN_OCCURRENCE', id: ids.entity },
    });
  });

  it('plan created keeps the planned amount', () => {
    expect(
      parseAuditRow(
        row({
          entityType: 'regular_plan',
          newValues: { name: 'Интернет', planType: 'EXPENSE', amountMinor: '70000' },
        }),
      ),
    ).toMatchObject({
      kind: 'PLAN_CREATED',
      amountMinor: 70000n,
      title: { type: 'PLAN', id: ids.entity },
      link: { type: 'PLAN', id: ids.entity },
    });
  });

  it('calendar event: all-day date or timed instant, title from the event row', () => {
    expect(
      parseAuditRow(
        row({
          entityType: 'calendar_event',
          newValues: { allDay: true, startsOn: '2026-11-05T00:00:00.000Z', startsAt: null },
        }),
      ),
    ).toMatchObject({
      kind: 'CALENDAR_EVENT_CREATED',
      title: { type: 'CALENDAR_EVENT', id: ids.entity },
      link: { type: 'CALENDAR_EVENT', id: ids.entity },
      eventStart: { date: '2026-11-05' },
    });
    expect(
      parseAuditRow(
        row({
          entityType: 'calendar_event',
          action: 'DELETED',
          oldValues: { allDay: false, startsOn: null, startsAt: '2026-11-05T14:00:00.000Z' },
        }),
      ),
    ).toMatchObject({
      kind: 'CALENDAR_EVENT_DELETED',
      eventStart: { instant: '2026-11-05T14:00:00.000Z' },
    });
  });

  it('family membership events carry no amount; removal names the membership', () => {
    expect(
      parseAuditRow(row({ entityType: 'workspace_invitation', action: 'ACCEPTED' })),
    ).toMatchObject({ kind: 'MEMBER_JOINED', amountMinor: null, link: null, title: null });
    expect(
      parseAuditRow(row({ entityType: 'workspace_membership', action: 'LEFT' })),
    ).toMatchObject({ kind: 'MEMBER_LEFT', link: null });
    expect(
      parseAuditRow(row({ entityType: 'workspace_membership', action: 'REMOVED' })),
    ).toMatchObject({ kind: 'MEMBER_REMOVED', targetMembershipId: ids.entity });
  });

  it('returns null for unknown pairs and for incomplete or legacy payloads', () => {
    expect(parseAuditRow(row({ entityType: 'auth', action: 'LOGIN' }))).toBeNull();
    expect(parseAuditRow(row({ newValues: null }))).toBeNull();
    expect(parseAuditRow(row({ newValues: { ...transactionValues, amountMinor: 12 } }))).toBeNull();
    expect(parseAuditRow(row({ newValues: { ...transactionValues, amountMinor: '-5' } }))).toBeNull();
    expect(
      parseAuditRow(row({ newValues: { ...transactionValues, transactionType: 'TRANSFER' } })),
    ).toBeNull();
    expect(parseAuditRow(row({ newValues: { ...transactionValues, accountId: 'x' } }))).toBeNull();
    expect(parseAuditRow(row({ entityId: null, newValues: transactionValues }))).toBeNull();
    expect(
      parseAuditRow(row({ entityType: 'transfer', newValues: { totalMinor: '100' } })),
    ).toBeNull();
    expect(
      parseAuditRow(row({ entityType: 'workspace_membership', action: 'REMOVED', entityId: null })),
    ).toBeNull();
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/activity-feed/feed-parsers.test.ts`
Expected: FAIL — `Cannot find module './feed-parsers.js'`.

- [ ] **Step 5: Разбор**

`apps/api/src/activity-feed/feed-parsers.ts`:

```ts
import { kindOf, type FeedKind } from './feed-kinds.js';

/** The audit columns the feed reads. Values stay inside the server: only parsed fields go out. */
export interface FeedAuditRow {
  id: string;
  createdAt: Date;
  actorUserId: string;
  entityType: string;
  entityId: string | null;
  action: string;
  oldValues: unknown;
  newValues: unknown;
}

export type RefType = 'ACCOUNT' | 'ENVELOPE' | 'CATEGORY' | 'PLAN' | 'OCCURRENCE' | 'CALENDAR_EVENT';

export interface Ref {
  type: RefType;
  id: string;
}

export type LinkType =
  | 'TRANSACTION'
  | 'TRANSFER'
  | 'ENVELOPE'
  | 'PLAN_OCCURRENCE'
  | 'PLAN'
  | 'CALENDAR_EVENT';

export interface FeedDraft {
  auditEventId: string;
  occurredAt: Date;
  kind: FeedKind;
  actorUserId: string;
  amountMinor: bigint | null;
  transactionType: 'INCOME' | 'EXPENSE' | null;
  /** Main label of the row (category, envelope, plan or event name). */
  title: Ref | null;
  /** Secondary labels in display order (accounts, envelopes). */
  details: Ref[];
  /** Object the row opens; dropped later when the object no longer exists. */
  link: { type: LinkType; id: string } | null;
  /** Calendar only: event start as stored in the audit row. */
  eventStart: { date: string } | { instant: string } | null;
  /** MEMBER_REMOVED only: membership of the removed person. */
  targetMembershipId: string | null;
}

type Body = Omit<FeedDraft, 'auditEventId' | 'occurredAt' | 'kind' | 'actorUserId'>;
type Values = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: Body = {
  amountMinor: null,
  transactionType: null,
  title: null,
  details: [],
  link: null,
  eventStart: null,
  targetMembershipId: null,
};

function objectOf(value: unknown): Values | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Values)
    : null;
}

/** Deletions describe the object before the change; everything else after it. */
function valuesOf(row: FeedAuditRow, kind: FeedKind): Values | null {
  return kind.endsWith('_DELETED') ? objectOf(row.oldValues) : objectOf(row.newValues);
}

function idOf(values: Values, key: string): string | null {
  const value = values[key];
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function minorOf(values: Values, key: string): bigint | null {
  const value = values[key];
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;
}

function transaction(row: FeedAuditRow, values: Values | null): Body | null {
  if (!values || !row.entityId) return null;
  const amountMinor = minorOf(values, 'amountMinor');
  const type = values['transactionType'];
  const accountId = idOf(values, 'accountId');
  const categoryId = idOf(values, 'categoryId');
  if (amountMinor === null || (type !== 'INCOME' && type !== 'EXPENSE')) return null;
  if (!accountId || !categoryId) return null;
  const envelopeId = idOf(values, 'envelopeId');
  return {
    ...EMPTY,
    amountMinor,
    transactionType: type,
    title: { type: 'CATEGORY', id: categoryId },
    details: [
      { type: 'ACCOUNT', id: accountId },
      ...(envelopeId ? [{ type: 'ENVELOPE' as const, id: envelopeId }] : []),
    ],
    link: { type: 'TRANSACTION', id: row.entityId },
  };
}

function transfer(row: FeedAuditRow, values: Values | null): Body | null {
  if (!values || !row.entityId) return null;
  const amountMinor = minorOf(values, 'totalMinor');
  const source = idOf(values, 'sourceAccountId');
  const destination = idOf(values, 'destinationAccountId');
  if (amountMinor === null || !source || !destination) return null;
  return {
    ...EMPTY,
    amountMinor,
    details: [
      { type: 'ACCOUNT', id: source },
      { type: 'ACCOUNT', id: destination },
    ],
    link: { type: 'TRANSFER', id: row.entityId },
  };
}

function envelopeFunded(_row: FeedAuditRow, values: Values | null): Body | null {
  if (!values) return null;
  const amountMinor = minorOf(values, 'amountMinor');
  const envelopeId = idOf(values, 'envelopeId');
  if (amountMinor === null || !envelopeId) return null;
  return {
    ...EMPTY,
    amountMinor,
    title: { type: 'ENVELOPE', id: envelopeId },
    link: { type: 'ENVELOPE', id: envelopeId },
  };
}

function envelopeMoved(_row: FeedAuditRow, values: Values | null): Body | null {
  if (!values) return null;
  const amountMinor = minorOf(values, 'amountMinor');
  const source = idOf(values, 'sourceEnvelopeId');
  const destination = idOf(values, 'destinationEnvelopeId');
  if (amountMinor === null || !source || !destination) return null;
  return {
    ...EMPTY,
    amountMinor,
    details: [
      { type: 'ENVELOPE', id: source },
      { type: 'ENVELOPE', id: destination },
    ],
    link: { type: 'ENVELOPE', id: destination },
  };
}

// v2 payments record only the status change: no amount, the name comes through the occurrence.
function planPaid(row: FeedAuditRow): Body | null {
  if (!row.entityId) return null;
  return {
    ...EMPTY,
    title: { type: 'OCCURRENCE', id: row.entityId },
    link: { type: 'PLAN_OCCURRENCE', id: row.entityId },
  };
}

function planCreated(row: FeedAuditRow, values: Values | null): Body | null {
  if (!row.entityId) return null;
  return {
    ...EMPTY,
    amountMinor: values ? minorOf(values, 'amountMinor') : null,
    title: { type: 'PLAN', id: row.entityId },
    link: { type: 'PLAN', id: row.entityId },
  };
}

// Calendar audit rows hold rule fields only (no title): the name comes from the event row.
function calendarEvent(row: FeedAuditRow, values: Values | null): Body | null {
  if (!row.entityId) return null;
  const startsOn = values?.['startsOn'];
  const startsAt = values?.['startsAt'];
  const eventStart =
    typeof startsOn === 'string' && /^\d{4}-\d{2}-\d{2}/.test(startsOn)
      ? { date: startsOn.slice(0, 10) }
      : typeof startsAt === 'string' && !Number.isNaN(Date.parse(startsAt))
        ? { instant: startsAt }
        : null;
  return {
    ...EMPTY,
    title: { type: 'CALENDAR_EVENT', id: row.entityId },
    link: { type: 'CALENDAR_EVENT', id: row.entityId },
    eventStart,
  };
}

function memberRemoved(row: FeedAuditRow): Body | null {
  return row.entityId ? { ...EMPTY, targetMembershipId: row.entityId } : null;
}

const PARSERS: Record<FeedKind, (row: FeedAuditRow, values: Values | null) => Body | null> = {
  TRANSACTION_CREATED: transaction,
  TRANSACTION_UPDATED: transaction,
  TRANSACTION_DELETED: transaction,
  TRANSACTION_RESTORED: transaction,
  TRANSFER_CREATED: transfer,
  TRANSFER_DELETED: transfer,
  ENVELOPE_FUNDED: envelopeFunded,
  ENVELOPE_MOVED: envelopeMoved,
  PLAN_PAID: planPaid,
  PLAN_CREATED: planCreated,
  CALENDAR_EVENT_CREATED: calendarEvent,
  CALENDAR_EVENT_UPDATED: calendarEvent,
  CALENDAR_EVENT_DELETED: calendarEvent,
  MEMBER_JOINED: () => ({ ...EMPTY }),
  MEMBER_LEFT: () => ({ ...EMPTY }),
  MEMBER_REMOVED: memberRemoved,
};

/** Null for pairs outside the whitelist and for payloads the parser cannot trust. */
export function parseAuditRow(row: FeedAuditRow): FeedDraft | null {
  const kind = kindOf(row.entityType, row.action);
  if (!kind) return null;
  const body = PARSERS[kind](row, valuesOf(row, kind));
  if (!body) return null;
  return {
    auditEventId: row.id,
    occurredAt: row.createdAt,
    kind,
    actorUserId: row.actorUserId,
    ...body,
  };
}
```

Run: `pnpm --filter @harmofin/api exec vitest run src/activity-feed`
Expected: PASS, все три файла.

- [ ] **Step 6: Проверки и индексация**

Run: `pnpm --filter @harmofin/api typecheck` и `pnpm exec eslint apps/api/src/activity-feed`
Expected: без ошибок.

```bash
git add apps/api/src/activity-feed
```

Сообщение коммита: `feat(api): разбор записей аудита для ленты семьи`.

### Task 3: API ленты — репозиторий, сервис, контроллер, OpenAPI

**Files:**
- Create: `apps/api/src/activity-feed/activity-feed.schemas.ts` (+ `activity-feed.schemas.test.ts`)
- Create: `apps/api/src/activity-feed/activity-feed.repository.ts`
- Create: `apps/api/src/activity-feed/activity-feed.application.service.ts`
- Create: `apps/api/src/activity-feed/activity-feed.dto.ts`
- Create: `apps/api/src/activity-feed/activity-feed.controller.ts`
- Create: `apps/api/src/activity-feed/activity-feed.module.ts`
- Modify: `apps/api/src/app.module.ts` (импорт и `ActivityFeedModule.register()` рядом с `CalendarModule.register()`)
- Modify: `apps/api/test/v2-openapi.integration.test.ts` (список операций, `PREVIEW_ONLY`)
- Modify: `openapi.json` (генерация)
- Test: `apps/api/test/activity-feed.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 — `prisma.activityFeedCursor`; Task 2 — `FEED_SOURCES`, `FEED_KINDS`, `FeedKind`, `parseAuditRow`, `FeedAuditRow`, `FeedDraft`, `Ref`, `RefType`, `LinkType`, `encodeCursor`, `decodeCursor`, `FeedCursor`.
- Produces (HTTP, для Task 4):
  - `GET /api/v2/budgets/:budgetId/activity?limit=&actorId=&cursor=` → `ActivityFeedView`;
  - `POST /api/v2/budgets/:budgetId/activity/seen` → `{ seenAt: string }`;
  - `interface ActivityItemView { id: string; occurredAt: string; kind: FeedKind; isNew: boolean; actor: PersonRef; amountMinor: string | null; currency: string; transactionType: 'INCOME' | 'EXPENSE' | null; title: string | null; details: string[]; target: PersonRef | null; link: { type: LinkType; id: string; date: string | null } | null }`;
  - `interface ActivityFeedView { seenAt: string | null; newSince: string; unseenCount: number; people: PersonRef[]; items: ActivityItemView[]; nextCursor: string | null }`.

- [ ] **Step 1: Схема query с тестом**

`apps/api/src/activity-feed/activity-feed.schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { encodeCursor } from './feed-cursor.js';
import { activityFeedQuerySchema } from './activity-feed.schemas.js';

describe('activityFeedQuerySchema', () => {
  it('defaults limit to 30 and coerces strings', () => {
    expect(activityFeedQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(activityFeedQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
  });

  it('rejects limits outside 1..30, a bad actor id and a bad cursor', () => {
    expect(activityFeedQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(activityFeedQuerySchema.safeParse({ limit: '31' }).success).toBe(false);
    expect(activityFeedQuerySchema.safeParse({ actorId: 'me' }).success).toBe(false);
    expect(activityFeedQuerySchema.safeParse({ cursor: 'garbage' }).success).toBe(false);
  });

  it('accepts a cursor produced by the server', () => {
    const cursor = encodeCursor({
      createdAt: new Date('2026-10-30T10:00:00.000Z'),
      id: '0195f0a0-0000-7000-8000-000000000001',
    });
    expect(activityFeedQuerySchema.parse({ cursor }).cursor).toBe(cursor);
  });
});
```

`apps/api/src/activity-feed/activity-feed.schemas.ts`:

```ts
import { z } from 'zod';

import { decodeCursor } from './feed-cursor.js';

export const FEED_PAGE_LIMIT = 30;

export const activityUuidSchema = z.string().uuid();

export const activityFeedQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int('От 1 до 30.')
    .min(1, 'От 1 до 30.')
    .max(FEED_PAGE_LIMIT, 'От 1 до 30.')
    .default(FEED_PAGE_LIMIT),
  actorId: z.string().uuid('Некорректный участник.').optional(),
  cursor: z
    .string()
    .max(512, 'Некорректный курсор.')
    .refine((value) => decodeCursor(value) !== null, 'Некорректный курсор.')
    .optional(),
});

export type ActivityFeedQuery = z.infer<typeof activityFeedQuerySchema>;
```

Run: `pnpm --filter @harmofin/api exec vitest run src/activity-feed/activity-feed.schemas.test.ts`
Expected: PASS.

- [ ] **Step 2: Падающий интеграционный тест**

`apps/api/test/activity-feed.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createUuidV7 } from '../src/common/identifiers/uuid-v7.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

type Person = { userId: string; displayName: string | null; isActiveMember: boolean };
type Item = {
  id: string;
  occurredAt: string;
  kind: string;
  isNew: boolean;
  actor: Person;
  amountMinor: string | null;
  currency: string;
  transactionType: string | null;
  title: string | null;
  details: string[];
  target: Person | null;
  link: { type: string; id: string; date: string | null } | null;
};
type Feed = {
  seenAt: string | null;
  newSince: string;
  unseenCount: number;
  people: Person[];
  items: Item[];
  nextCursor: string | null;
};

const env = new FamilyTestApp();
const budgets: string[] = [];
const MINUTE = 60_000;
const DAY = 86_400_000;

beforeAll(async () => {
  await env.start();
});

afterAll(async () => {
  for (const budgetId of budgets) {
    await env.prisma.calendarEventParticipant.deleteMany({ where: { budgetId } });
    await env.prisma.calendarEvent.deleteMany({ where: { budgetId } });
  }
  await env.stop();
});

async function family() {
  const creator = await env.register();
  const editor = await env.join(creator, await env.register(), 'EDITOR');
  const viewer = await env.join(creator, await env.register(), 'VIEWER');
  budgets.push(creator.budgetId);
  return { creator, editor, viewer };
}

const feedUrl = (actor: FamilyActor, query = '') =>
  `/api/v2/budgets/${actor.budgetId}/activity${query}`;

async function feed(actor: FamilyActor, query = ''): Promise<Feed> {
  const response = await env.inject('GET', feedUrl(actor, query), actor);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Feed>();
}

const markSeen = (actor: FamilyActor) =>
  env.inject('POST', `/api/v2/budgets/${actor.budgetId}/activity/seen`, actor);

/** A calendar audit row written directly, for window and paging cases. */
async function auditRow(
  actor: FamilyActor,
  createdAt: Date,
  overrides: { actorUserId?: string | null; entityType?: string; action?: string } = {},
): Promise<string> {
  const id = createUuidV7(createdAt);
  await env.prisma.auditEvent.create({
    data: {
      id,
      actorUserId: overrides.actorUserId === undefined ? actor.user.id : overrides.actorUserId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      entityType: overrides.entityType ?? 'calendar_event',
      entityId: randomUUID(),
      action: overrides.action ?? 'CREATED',
      newValues: { allDay: true, startsOn: '2026-11-05T00:00:00.000Z', startsAt: null },
      source: 'test',
      createdAt,
    },
  });
  return id;
}

describe('activity feed: content', () => {
  it('shows what other members did, never own actions, with labels from the budget', async () => {
    const { creator, editor } = await family();
    const accountId = await env.createAccount(editor, 'Карта Алии', '5000.00');
    const expenseId = await env.record(editor, {
      type: 'EXPENSE',
      accountId,
      amount: '1200.00',
    });
    const ownAccount = await env.createAccount(creator, 'Наличные');
    await env.record(creator, { type: 'EXPENSE', accountId: ownAccount, amount: '10.00' });
    const category = await env.prisma.transaction.findUniqueOrThrow({
      where: { id: expenseId },
      select: { category: { select: { name: true } } },
    });

    const response = await env.inject('GET', feedUrl(creator), creator);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toMatch(/oldValues|newValues|requestId/);
    const body = response.json<Feed>();
    expect(body.items.every((item) => item.actor.userId !== creator.user.id)).toBe(true);
    expect(body.items.map((item) => item.kind)).toEqual(['TRANSACTION_CREATED']);
    expect(body.items[0]).toMatchObject({
      isNew: true,
      actor: { userId: editor.user.id, isActiveMember: true },
      amountMinor: '120000',
      currency: 'RUB',
      transactionType: 'EXPENSE',
      title: category.category.name,
      details: ['Карта Алии'],
      target: null,
      link: { type: 'TRANSACTION', id: expenseId, date: null },
    });
    expect(body.people.some((person) => person.userId === editor.user.id)).toBe(true);
    expect(body.people.some((person) => person.userId === creator.user.id)).toBe(false);
  });

  it('takes the calendar title from the event row and drops the link once deleted', async () => {
    const { creator, editor } = await family();
    const created = await env.inject(
      'POST',
      `/api/v2/budgets/${editor.budgetId}/calendar/events`,
      editor,
      { title: 'Родительское собрание', allDay: true, date: '2026-11-05', recurrence: 'NONE' },
    );
    expect(created.statusCode, created.body).toBe(201);
    const eventId = created.json<{ id: string }>().id;

    expect((await feed(creator)).items[0]).toMatchObject({
      kind: 'CALENDAR_EVENT_CREATED',
      title: 'Родительское собрание',
      amountMinor: null,
      link: { type: 'CALENDAR_EVENT', id: eventId, date: '2026-11-05' },
    });

    const deleted = await env.inject(
      'DELETE',
      `/api/v2/budgets/${editor.budgetId}/calendar/events/${eventId}`,
      editor,
    );
    expect(deleted.statusCode, deleted.body).toBe(204);
    const items = (await feed(creator)).items;
    expect(items.map((item) => item.kind)).toEqual([
      'CALENDAR_EVENT_DELETED',
      'CALENDAR_EVENT_CREATED',
    ]);
    expect(items.every((item) => item.title === 'Родительское собрание')).toBe(true);
    expect(items.every((item) => item.link === null)).toBe(true);
  });

  it('falls back to neutral labels when referenced objects are missing', async () => {
    const { creator, editor } = await family();
    await env.prisma.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: editor.user.id,
        workspaceId: editor.workspaceId,
        budgetId: editor.budgetId,
        entityType: 'transaction',
        entityId: randomUUID(),
        action: 'CREATED',
        newValues: {
          transactionType: 'EXPENSE',
          amountMinor: '4500',
          accountId: randomUUID(),
          categoryId: randomUUID(),
          envelopeId: null,
        },
        source: 'test',
      },
    });
    expect((await feed(creator)).items[0]).toMatchObject({
      title: 'без категории',
      details: ['удалённый счёт'],
      link: null,
    });
  });

  it('labels a former member and names the removed person', async () => {
    const { creator, editor, viewer } = await family();
    const accountId = await env.createAccount(editor, 'Карта');
    await env.record(editor, { type: 'EXPENSE', accountId, amount: '300.00' });
    const membership = await env.prisma.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: creator.workspaceId, userId: editor.user.id } },
      data: { isActive: false, removedAt: new Date() },
      select: { id: true },
    });
    await env.prisma.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: creator.user.id,
        workspaceId: creator.workspaceId,
        budgetId: creator.budgetId,
        entityType: 'workspace_membership',
        entityId: membership.id,
        action: 'REMOVED',
        source: 'test',
      },
    });

    const items = (await feed(viewer)).items;
    expect(items[0]).toMatchObject({
      kind: 'MEMBER_REMOVED',
      actor: { userId: creator.user.id },
      target: { userId: editor.user.id, isActiveMember: false },
    });
    expect(items[1]).toMatchObject({
      kind: 'TRANSACTION_CREATED',
      actor: { userId: editor.user.id, isActiveMember: false },
    });
  });
});

describe('activity feed: window and marker', () => {
  it('counts the last 7 days without a marker, then only what came after it', async () => {
    const { creator, editor } = await family();
    const now = Date.now();
    const old = await auditRow(editor, new Date(now - 10 * DAY));
    const recent = await auditRow(editor, new Date(now - 3 * DAY));

    const first = await feed(creator);
    expect(first.seenAt).toBeNull();
    expect(Date.parse(first.newSince)).toBeLessThan(now - 7 * DAY + MINUTE);
    expect(Date.parse(first.newSince)).toBeGreaterThan(now - 7 * DAY - MINUTE);
    expect(first.unseenCount).toBe(1);
    expect(first.items.map((item) => [item.id, item.isNew])).toEqual([
      [recent, true],
      [old, false],
    ]);

    const seen = await markSeen(creator);
    expect(seen.statusCode, seen.body).toBe(200);
    const seenAt = seen.json<{ seenAt: string }>().seenAt;
    const after = await feed(creator);
    expect(after.seenAt).toBe(seenAt);
    expect(after.newSince).toBe(seenAt);
    expect(after.unseenCount).toBe(0);
    expect(after.items.every((item) => !item.isNew)).toBe(true);

    const fresh = await auditRow(editor, new Date(Date.parse(seenAt) + MINUTE));
    const next = await feed(creator);
    expect(next.unseenCount).toBe(1);
    expect(next.items[0]).toMatchObject({ id: fresh, isNew: true });
  });

  it('never moves the marker back', async () => {
    const { creator } = await family();
    const future = new Date(Date.now() + 60 * MINUTE);
    await env.prisma.activityFeedCursor.create({
      data: {
        id: createUuidV7(),
        workspaceId: creator.workspaceId,
        budgetId: creator.budgetId,
        userId: creator.user.id,
        seenAt: future,
      },
    });
    const response = await markSeen(creator);
    expect(response.json<{ seenAt: string }>().seenAt).toBe(future.toISOString());
  });

  it('shows 30 days only and hides rows without an author', async () => {
    const { creator, editor } = await family();
    const now = Date.now();
    await auditRow(editor, new Date(now - 31 * DAY));
    await auditRow(editor, new Date(now - MINUTE), { actorUserId: null });
    const kept = await auditRow(editor, new Date(now - 29 * DAY));
    expect((await feed(creator)).items.map((item) => item.id)).toEqual([kept]);
  });

  it('ignores audit pairs outside the whitelist', async () => {
    const { creator, editor } = await family();
    await auditRow(editor, new Date(), { entityType: 'account', action: 'CREATED' });
    await auditRow(editor, new Date(), { entityType: 'auth', action: 'LOGIN' });
    expect((await feed(creator)).items).toEqual([]);
  });

  it('pages by cursor; the actor filter leaves unseenCount alone', async () => {
    const { creator, editor, viewer } = await family();
    const now = Date.now();
    const ids: string[] = [];
    for (let index = 0; index < 35; index += 1) {
      ids.push(await auditRow(editor, new Date(now - (index + 1) * MINUTE)));
    }

    const first = await feed(creator);
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    const second = await feed(creator, `?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(ids);

    const filtered = await feed(creator, `?actorId=${viewer.user.id}`);
    expect(filtered.items).toEqual([]);
    expect(filtered.unseenCount).toBe(first.unseenCount);
    expect((await feed(creator, '?limit=5')).items).toHaveLength(5);

    const badCursor = await env.inject('GET', feedUrl(creator, '?cursor=garbage'), creator);
    expect(badCursor.statusCode).toBe(400);
    const badLimit = await env.inject('GET', feedUrl(creator, '?limit=31'), creator);
    expect(badLimit.statusCode).toBe(400);
  });
});

describe('activity feed: access', () => {
  it('any member reads and marks; a stranger gets 404 and other budgets never leak', async () => {
    const { creator, viewer } = await family();
    const stranger = await env.register();
    budgets.push(stranger.budgetId);
    const foreign = await auditRow(stranger, new Date(), { actorUserId: stranger.user.id });

    expect((await env.inject('GET', feedUrl(creator), stranger)).statusCode).toBe(404);
    expect((await markSeen({ ...stranger, budgetId: creator.budgetId })).statusCode).toBe(404);
    expect((await feed(creator)).items.some((item) => item.id === foreign)).toBe(false);

    expect((await feed(viewer)).seenAt).toBeNull();
    expect((await markSeen(viewer)).statusCode).toBe(200);
    expect((await feed(viewer)).seenAt).not.toBeNull();
    expect((await feed(creator)).seenAt).toBeNull();
  });
});
```

Run: один файл (Global Constraints).
Expected: FAIL — все запросы 404 (маршрута нет).

- [ ] **Step 3: Репозиторий**

`apps/api/src/activity-feed/activity-feed.repository.ts`:

```ts
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { FeedCursor } from './feed-cursor.js';
import { FEED_SOURCES } from './feed-kinds.js';
import type { FeedAuditRow, LinkType, Ref, RefType } from './feed-parsers.js';

type Db = Prisma.TransactionClient;

export const refKey = (type: RefType | LinkType, id: string): string => `${type}:${id}`;

export interface FeedFilter {
  budgetId: string;
  userId: string;
  /** Start of the 30-day window, inclusive. */
  from: Date;
  /** Only rows strictly after this moment (unseen count). */
  after?: Date | undefined;
  actorId?: string | undefined;
  cursor?: FeedCursor | undefined;
}

/** Budget, window, whitelist and "not mine, has an author" — all inside the SQL query. */
export function feedWhere(filter: FeedFilter): Prisma.AuditEventWhereInput {
  return {
    budgetId: filter.budgetId,
    createdAt: { gte: filter.from, ...(filter.after ? { gt: filter.after } : {}) },
    OR: FEED_SOURCES.map(({ entityType, action }) => ({ entityType, action })),
    AND: [
      { actorUserId: { not: null } },
      { actorUserId: { not: filter.userId } },
      ...(filter.actorId ? [{ actorUserId: filter.actorId }] : []),
      ...(filter.cursor
        ? [
            {
              OR: [
                { createdAt: { lt: filter.cursor.createdAt } },
                { createdAt: filter.cursor.createdAt, id: { lt: filter.cursor.id } },
              ],
            },
          ]
        : []),
    ],
  };
}

function idsOf(refs: ReadonlyArray<{ type: string; id: string }>, type: string): string[] {
  return [...new Set(refs.filter((ref) => ref.type === type).map((ref) => ref.id))];
}

export class ActivityFeedRepository {
  async budgetSettings(db: Db, budgetId: string): Promise<{ timezone: string; currency: string }> {
    const budget = await db.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: { timezone: true, primaryCurrency: true },
    });
    return { timezone: budget.timezone, currency: budget.primaryCurrency };
  }

  async findSeenAt(db: Db, budgetId: string, userId: string): Promise<Date | null> {
    const row = await db.activityFeedCursor.findUnique({
      where: { budgetId_userId: { budgetId, userId } },
      select: { seenAt: true },
    });
    return row?.seenAt ?? null;
  }

  /** Upsert that only moves forward: a stale tab cannot push the marker back. */
  async markSeen(
    db: Db,
    input: { workspaceId: string; budgetId: string; userId: string; now: Date },
  ): Promise<Date> {
    const rows = await db.$queryRaw<Array<{ seen_at: Date }>>`
      INSERT INTO "activity_feed_cursors"
        ("id", "workspace_id", "budget_id", "user_id", "seen_at", "updated_at")
      VALUES (${createUuidV7(input.now)}::uuid, ${input.workspaceId}::uuid, ${input.budgetId}::uuid,
        ${input.userId}::uuid, ${input.now}, ${input.now})
      ON CONFLICT ("budget_id", "user_id") DO UPDATE
        SET "seen_at" = GREATEST("activity_feed_cursors"."seen_at", EXCLUDED."seen_at"),
            "updated_at" = EXCLUDED."updated_at"
      RETURNING "seen_at"`;
    return rows[0]!.seen_at;
  }

  count(db: Db, where: Prisma.AuditEventWhereInput): Promise<number> {
    return db.auditEvent.count({ where });
  }

  async listRows(db: Db, where: Prisma.AuditEventWhereInput, take: number): Promise<FeedAuditRow[]> {
    const rows = await db.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        createdAt: true,
        actorUserId: true,
        entityType: true,
        entityId: true,
        action: true,
        oldValues: true,
        newValues: true,
      },
    });
    return rows.flatMap((row) =>
      row.actorUserId ? [{ ...row, actorUserId: row.actorUserId }] : [],
    );
  }

  /** Names of referenced objects, budget-scoped; archived and logically deleted rows included. */
  async labels(db: Db, budgetId: string, refs: ReadonlyArray<Ref>): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    const put = (type: RefType, rows: Array<{ id: string; name: string }>) => {
      for (const row of rows) labels.set(refKey(type, row.id), row.name);
    };
    const accounts = idsOf(refs, 'ACCOUNT');
    if (accounts.length > 0) {
      put(
        'ACCOUNT',
        await db.account.findMany({
          where: { budgetId, id: { in: accounts } },
          select: { id: true, name: true },
        }),
      );
    }
    const envelopes = idsOf(refs, 'ENVELOPE');
    if (envelopes.length > 0) {
      put(
        'ENVELOPE',
        await db.envelope.findMany({
          where: { budgetId, id: { in: envelopes } },
          select: { id: true, name: true },
        }),
      );
    }
    const categories = idsOf(refs, 'CATEGORY');
    if (categories.length > 0) {
      put(
        'CATEGORY',
        await db.category.findMany({
          where: { budgetId, id: { in: categories } },
          select: { id: true, name: true },
        }),
      );
    }
    const plans = idsOf(refs, 'PLAN');
    if (plans.length > 0) {
      put(
        'PLAN',
        await db.regularPlan.findMany({
          where: { budgetId, id: { in: plans } },
          select: { id: true, name: true },
        }),
      );
    }
    const occurrences = idsOf(refs, 'OCCURRENCE');
    if (occurrences.length > 0) {
      const rows = await db.planOccurrence.findMany({
        where: { budgetId, id: { in: occurrences } },
        select: { id: true, plan: { select: { name: true } } },
      });
      put(
        'OCCURRENCE',
        rows.map((row) => ({ id: row.id, name: row.plan.name })),
      );
    }
    const events = idsOf(refs, 'CALENDAR_EVENT');
    if (events.length > 0) {
      const rows = await db.calendarEvent.findMany({
        where: { budgetId, id: { in: events } },
        select: { id: true, title: true },
      });
      put(
        'CALENDAR_EVENT',
        rows.map((row) => ({ id: row.id, name: row.title })),
      );
    }
    return labels;
  }

  /** Link targets that can still be opened: present in the budget and not logically deleted. */
  async liveLinks(
    db: Db,
    budgetId: string,
    links: ReadonlyArray<{ type: LinkType; id: string }>,
  ): Promise<Set<string>> {
    const live = new Set<string>();
    const add = (type: LinkType, rows: Array<{ id: string }>) => {
      for (const row of rows) live.add(refKey(type, row.id));
    };
    const select = { id: true } as const;
    const transactions = idsOf(links, 'TRANSACTION');
    if (transactions.length > 0) {
      add(
        'TRANSACTION',
        await db.transaction.findMany({
          where: { budgetId, id: { in: transactions }, deletedAt: null },
          select,
        }),
      );
    }
    const transfers = idsOf(links, 'TRANSFER');
    if (transfers.length > 0) {
      add(
        'TRANSFER',
        await db.transfer.findMany({
          where: { budgetId, id: { in: transfers }, deletedAt: null },
          select,
        }),
      );
    }
    const envelopes = idsOf(links, 'ENVELOPE');
    if (envelopes.length > 0) {
      add(
        'ENVELOPE',
        await db.envelope.findMany({ where: { budgetId, id: { in: envelopes } }, select }),
      );
    }
    const occurrences = idsOf(links, 'PLAN_OCCURRENCE');
    if (occurrences.length > 0) {
      add(
        'PLAN_OCCURRENCE',
        await db.planOccurrence.findMany({ where: { budgetId, id: { in: occurrences } }, select }),
      );
    }
    const plans = idsOf(links, 'PLAN');
    if (plans.length > 0) {
      add(
        'PLAN',
        await db.regularPlan.findMany({
          where: { budgetId, id: { in: plans }, deletedAt: null },
          select,
        }),
      );
    }
    const events = idsOf(links, 'CALENDAR_EVENT');
    if (events.length > 0) {
      add(
        'CALENDAR_EVENT',
        await db.calendarEvent.findMany({
          where: { budgetId, id: { in: events }, deletedAt: null },
          select,
        }),
      );
    }
    return live;
  }

  /** membershipId → userId inside one workspace (removed members keep their row). */
  async membershipUsers(
    db: Db,
    workspaceId: string,
    membershipIds: string[],
  ): Promise<Map<string, string>> {
    if (membershipIds.length === 0) return new Map();
    const rows = await db.workspaceMembership.findMany({
      where: { workspaceId, id: { in: [...new Set(membershipIds)] } },
      select: { id: true, userId: true },
    });
    return new Map(rows.map((row) => [row.id, row.userId]));
  }

  async otherMemberIds(db: Db, workspaceId: string, userId: string): Promise<string[]> {
    const rows = await db.workspaceMembership.findMany({
      where: { workspaceId, userId: { not: userId } },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.userId);
  }
}
```

Имена полей сверены со схемой: `WorkspaceMembership.createdAt`; `budgetId` есть у `Account`, `Envelope`, `Category`, `RegularPlan`, `PlanOccurrence`, `CalendarEvent`, `Transfer`, `Transaction`.

- [ ] **Step 4: Сервис**

`apps/api/src/activity-feed/activity-feed.application.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { findPersonRefs, personRefOf, type PersonRef } from '../common/people/person-ref.repository.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { findAccessActor } from '../common/policies/access-actor.repository.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import type { PrismaService } from '../database/prisma.service.js';
import { utcToLocal } from '../calendar/zoned-time.js';
import { decodeCursor, encodeCursor } from './feed-cursor.js';
import type { FeedKind } from './feed-kinds.js';
import { parseAuditRow, type FeedDraft, type LinkType, type Ref, type RefType } from './feed-parsers.js';
import { ActivityFeedRepository, feedWhere, refKey } from './activity-feed.repository.js';
import type { ActivityFeedQuery } from './activity-feed.schemas.js';

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;
export const FEED_WINDOW_DAYS = 30;
export const UNSEEN_DEFAULT_DAYS = 7;

const FALLBACK_LABELS: Record<RefType, string> = {
  ACCOUNT: 'удалённый счёт',
  ENVELOPE: 'удалённый конверт',
  CATEGORY: 'без категории',
  PLAN: 'удалённый план',
  OCCURRENCE: 'удалённый план',
  CALENDAR_EVENT: 'удалённое событие',
};

export interface ActivityItemView {
  id: string;
  occurredAt: string;
  kind: FeedKind;
  isNew: boolean;
  actor: PersonRef;
  amountMinor: string | null;
  currency: string;
  transactionType: 'INCOME' | 'EXPENSE' | null;
  title: string | null;
  details: string[];
  target: PersonRef | null;
  link: { type: LinkType; id: string; date: string | null } | null;
}

export interface ActivityFeedView {
  seenAt: string | null;
  /** Boundary of isNew: seenAt, or now minus 7 days without a marker. */
  newSince: string;
  unseenCount: number;
  people: PersonRef[];
  items: ActivityItemView[];
  nextCursor: string | null;
}

function eventDate(draft: FeedDraft, timezone: string): string | null {
  if (!draft.eventStart) return null;
  return 'date' in draft.eventStart
    ? draft.eventStart.date
    : utcToLocal(new Date(draft.eventStart.instant), timezone).date;
}

/**
 * Read-only view over the audit trail. Money is passed through as minor-unit strings from the
 * audit rows; nothing here sums or recalculates amounts.
 */
@Injectable()
export class ActivityFeedApplicationService {
  private readonly repository = new ActivityFeedRepository();
  private readonly logger = new Logger('ActivityFeedApplicationService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    query: ActivityFeedQuery,
    now = new Date(),
  ): Promise<ActivityFeedView> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      if (!(await findAccessActor(tx, model.workspaceId, userId))) throw resourceNotFound();
      const from = new Date(now.getTime() - FEED_WINDOW_DAYS * DAY_MS);
      const seenAt = await this.repository.findSeenAt(tx, budgetId, userId);
      const since = seenAt ?? new Date(now.getTime() - UNSEEN_DEFAULT_DAYS * DAY_MS);

      const unseenCount = await this.repository.count(
        tx,
        feedWhere({ budgetId, userId, from, after: since }),
      );
      const rows = await this.repository.listRows(
        tx,
        feedWhere({
          budgetId,
          userId,
          from,
          actorId: query.actorId,
          cursor: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
        }),
        query.limit + 1,
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null;

      const drafts = page.flatMap((row) => {
        const draft = parseAuditRow(row);
        if (!draft) {
          this.logger.warn({ event: 'activity_feed_unparsed_row', auditEventId: row.id });
          return [];
        }
        return [draft];
      });
      const items = await this.assemble(tx, model.workspaceId, budgetId, drafts, since);
      const others = await this.repository.otherMemberIds(tx, model.workspaceId, userId);
      const people = await findPersonRefs(tx, model.workspaceId, others);
      return {
        seenAt: seenAt?.toISOString() ?? null,
        newSince: since.toISOString(),
        unseenCount,
        people: others.map((id) => personRefOf(people, id)),
        items,
        nextCursor,
      };
    });
  }

  async markSeen(userId: string, budgetId: string, now = new Date()): Promise<{ seenAt: string }> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      if (!(await findAccessActor(tx, model.workspaceId, userId))) throw resourceNotFound();
      const seenAt = await this.repository.markSeen(tx, {
        workspaceId: model.workspaceId,
        budgetId,
        userId,
        now,
      });
      return { seenAt: seenAt.toISOString() };
    });
  }

  private async assemble(
    tx: Tx,
    workspaceId: string,
    budgetId: string,
    drafts: FeedDraft[],
    since: Date,
  ): Promise<ActivityItemView[]> {
    if (drafts.length === 0) return [];
    const settings = await this.repository.budgetSettings(tx, budgetId);
    const refs = drafts.flatMap((draft) => [...(draft.title ? [draft.title] : []), ...draft.details]);
    const labels = await this.repository.labels(tx, budgetId, refs);
    const live = await this.repository.liveLinks(
      tx,
      budgetId,
      drafts.flatMap((draft) => (draft.link ? [draft.link] : [])),
    );
    const targets = await this.repository.membershipUsers(
      tx,
      workspaceId,
      drafts.flatMap((draft) => (draft.targetMembershipId ? [draft.targetMembershipId] : [])),
    );
    const people = await findPersonRefs(tx, workspaceId, [
      ...drafts.map((draft) => draft.actorUserId),
      ...targets.values(),
    ]);
    const label = (ref: Ref) => labels.get(refKey(ref.type, ref.id)) ?? FALLBACK_LABELS[ref.type];

    return drafts.map((draft) => {
      const targetUserId = draft.targetMembershipId
        ? targets.get(draft.targetMembershipId)
        : undefined;
      return {
        id: draft.auditEventId,
        occurredAt: draft.occurredAt.toISOString(),
        kind: draft.kind,
        isNew: draft.occurredAt.getTime() > since.getTime(),
        actor: personRefOf(people, draft.actorUserId),
        amountMinor: draft.amountMinor?.toString() ?? null,
        currency: settings.currency,
        transactionType: draft.transactionType,
        title: draft.title ? label(draft.title) : null,
        details: draft.details.map(label),
        target: targetUserId ? personRefOf(people, targetUserId) : null,
        link:
          draft.link && live.has(refKey(draft.link.type, draft.link.id))
            ? { ...draft.link, date: eventDate(draft, settings.timezone) }
            : null,
      };
    });
  }
}
```

`utcToLocal` из `apps/api/src/calendar/zoned-time.ts` (сигнатура `utcToLocal(instant: Date, timezone: string): { date: string; time: string }`).

- [ ] **Step 5: DTO**

`apps/api/src/activity-feed/activity-feed.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

import { PersonRefResponse } from '../common/people/person-ref.dto.js';
import { FEED_KINDS } from './feed-kinds.js';

const LINK_TYPES = [
  'TRANSACTION',
  'TRANSFER',
  'ENVELOPE',
  'PLAN_OCCURRENCE',
  'PLAN',
  'CALENDAR_EVENT',
] as const;

export class ActivityLinkResponse {
  @ApiProperty({ type: String, enum: LINK_TYPES })
  type!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Только для событий календаря: дата начала в часовом поясе бюджета.',
  })
  date!: string | null;
}

export class ActivityItemResponse {
  @ApiProperty({ type: String, format: 'uuid', description: 'Идентификатор записи аудита.' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ type: String, enum: FEED_KINDS })
  kind!: string;

  @ApiProperty({ type: Boolean, description: 'Событие позже отметки «просмотрено».' })
  isNew!: boolean;

  @ApiProperty({ type: PersonRefResponse })
  actor!: PersonRefResponse;

  @ApiProperty({
    type: String,
    pattern: '^\\d+$',
    nullable: true,
    description: 'Сумма в minor units из записи аудита; у оплаты платежа и событий семьи — null.',
  })
  amountMinor!: string | null;

  @ApiProperty({ type: String, example: 'RUB' })
  currency!: string;

  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'], nullable: true })
  transactionType!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Категория, конверт, план или событие; для отсутствующего объекта — нейтральная метка.',
  })
  title!: string | null;

  @ApiProperty({ type: [String], description: 'Счета и конверты по порядку показа.' })
  details!: string[];

  @ApiProperty({
    type: PersonRefResponse,
    nullable: true,
    description: 'Только для MEMBER_REMOVED: исключённый участник.',
  })
  target!: PersonRefResponse | null;

  @ApiProperty({
    type: ActivityLinkResponse,
    nullable: true,
    description: 'null, если объект удалён или открыть его нельзя.',
  })
  link!: ActivityLinkResponse | null;
}

export class ActivityFeedResponse {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  seenAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Граница isNew: seenAt, а без отметки — время сервера минус 7 дней.',
  })
  newSince!: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Новые события с отметки (без отметки — за 7 дней); фильтр actorId не учитывается.',
  })
  unseenCount!: number;

  @ApiProperty({ type: [PersonRefResponse], description: 'Другие участники семьи, включая бывших.' })
  people!: PersonRefResponse[];

  @ApiProperty({ type: [ActivityItemResponse] })
  items!: ActivityItemResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class ActivityFeedSeenResponse {
  @ApiProperty({ type: String, format: 'date-time' })
  seenAt!: string;
}
```

Целые числа описываются как в других DTO проекта: `type: Number` (см. `budgets/budget.dto.ts`).

- [ ] **Step 6: Контроллер и модуль**

`apps/api/src/activity-feed/activity-feed.controller.ts`:

```ts
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ActivityFeedApplicationService } from './activity-feed.application.service.js';
import { ActivityFeedResponse, ActivityFeedSeenResponse } from './activity-feed.dto.js';
import {
  activityFeedQuerySchema,
  activityUuidSchema,
  type ActivityFeedQuery,
} from './activity-feed.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}

const idPipe = new ZodValidationPipe(activityUuidSchema);

@ApiTags('activity (v2)')
@Controller({ path: 'budgets/:budgetId/activity', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class ActivityFeedController {
  constructor(
    @Inject(ActivityFeedApplicationService)
    private readonly service: ActivityFeedApplicationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Лента семьи: что сделали другие участники за 30 дней',
    description:
      'Записи аудита бюджета по белому списку (операции, переводы, конверты, платежи и планы, календарь, состав семьи), без собственных действий и действий без автора; сортировка от новых к старым. isNew и unseenCount считаются от отметки «просмотрено», без отметки — за 7 дней. Суммы — minor units из записей аудита, без пересчёта. Доступно любому активному участнику. Коды: 400 VALIDATION_FAILED (limit, actorId, cursor), 401, 403, 404 RESOURCE_NOT_FOUND, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 30, default: 30 },
  })
  @ApiQuery({ name: 'actorId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string', maxLength: 512 } })
  @ApiOkResponse({ type: ActivityFeedResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  list(
    @Param('budgetId', idPipe) budgetId: string,
    @Query(new ZodValidationPipe(activityFeedQuerySchema)) query: ActivityFeedQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }

  @Post('seen')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Отметить ленту просмотренной',
    description:
      'Ставит отметку текущего пользователя на время сервера; отметка только растёт. Повтор безопасен, Idempotency-Key не нужен: запрос не создаёт финансовых записей. Доступно любому активному участнику, включая наблюдателя. Коды: 400 VALIDATION_FAILED (некорректный budgetId), 401, 403 CSRF_INVALID, 404 RESOURCE_NOT_FOUND, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiOkResponse({ type: ActivityFeedSeenResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  seen(@Param('budgetId', idPipe) budgetId: string, @Req() request: AuthenticatedRequest) {
    return this.service.markSeen(contextOf(request).userId, budgetId);
  }
}
```

`apps/api/src/activity-feed/activity-feed.module.ts`:

```ts
import { DynamicModule, Module } from '@nestjs/common';

import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { ActivityFeedApplicationService } from './activity-feed.application.service.js';
import { ActivityFeedController } from './activity-feed.controller.js';

@Module({})
export class ActivityFeedModule {
  static register(): DynamicModule {
    return {
      module: ActivityFeedModule,
      controllers: [ActivityFeedController],
      providers: [
        {
          provide: ActivityFeedApplicationService,
          useFactory: (prisma: PrismaService) =>
            new ActivityFeedApplicationService(prisma, new PlanModelPolicy(prisma)),
          inject: [PrismaService],
        },
      ],
    };
  }
}
```

В `apps/api/src/app.module.ts`: `import { ActivityFeedModule } from './activity-feed/activity-feed.module.js';` и `ActivityFeedModule.register(),` сразу после `CalendarModule.register(),`.

Run: один файл `test/activity-feed.integration.test.ts`.
Expected: PASS. Если `markSeen` возвращает строку вместо `Date` (драйвер), привести `new Date(rows[0]!.seen_at)` и записать решение.

- [ ] **Step 7: Контракт OpenAPI**

В `apps/api/test/v2-openapi.integration.test.ts`:

1. В список ожидаемых операций после `['delete', '/api/v2/budgets/{budgetId}/calendar/events/{eventId}'],`:

```ts
  ['get', '/api/v2/budgets/{budgetId}/activity'],
  ['post', '/api/v2/budgets/{budgetId}/activity/seen'],
```

2. В `PREVIEW_ONLY` добавить строку с комментарием:

```ts
  // Not a preview, but also writes no financial record: a monotonic "seen" marker needs no key.
  'post /api/v2/budgets/{budgetId}/activity/seen',
```

Run: `node scripts/openapi/generate.mjs && pnpm exec prettier --write openapi.json`, затем один файл `test/v2-openapi.integration.test.ts`.
Expected: PASS.

- [ ] **Step 8: Полный прогон и индексация**

Run: `pnpm --filter @harmofin/api typecheck`, `pnpm --filter @harmofin/api lint`, `pnpm --filter @harmofin/api test`, `pnpm test:integration`
Expected: всё зелёное. Несвязанные падения — сообщить, не чинить.

```bash
git add apps/api/src/activity-feed apps/api/src/app.module.ts apps/api/test/activity-feed.integration.test.ts apps/api/test/v2-openapi.integration.test.ts openapi.json
```

Сообщение коммита: `feat(api): лента семьи и отметка просмотра`.

После коммита Task 3 координатор останавливается и спрашивает владельца, открывать ли PR 1.

## PR 2 — веб

Ветка `feat/family-activity-feed-web` от свежего `main` после мержа PR 1. Перед первой задачей прочитать [визуальные правила Calm Fintech](../specs/2026-09-17-calm-fintech-visual-guidelines.md).

### Task 4: Клиент API и тексты ленты

**Files:**
- Create: `apps/web/app/composables/useActivityFeed.ts` (+ `useActivityFeed.test.ts`)
- Create: `apps/web/app/components/activity/activity-phrases.ts` (+ `activity-phrases.test.ts`)
- Modify: `apps/web/app/components/calendar/calendar-dates.ts` (экспорт `shortMonth`)

**Interfaces:**
- Consumes: HTTP из Task 3.
- Produces:
  - `type ActivityKind` (16 значений `FEED_KINDS`), `type ActivityLinkType`, `interface ActivityItem`, `interface ActivityFeedResponse`, `interface ActivityFeedQuery { limit?: number | undefined; actorId?: string | undefined; cursor?: string | undefined }`;
  - `useActivityFeed(): { unseenCount: Ref<number | null>; list(budgetId: string, query?: ActivityFeedQuery): Promise<ActivityFeedResponse>; markSeen(budgetId: string): Promise<{ seenAt: string }> }`;
  - из `activity-phrases.ts`: `activityAction(item)`, `activityHeadline(item)`, `activitySubtitle(item, now)`, `activityTime(iso, now)`, `activityDayKey(iso)`, `activityDayLabel(dayKey, now)`, `activityTone(item)`, `activityIcon(item)`, `activityHref(item)`, `isStruck(item)`, `unseenShort(count)`, `unseenLabel(count)`.

- [ ] **Step 1: Падающие тесты клиента**

`apps/web/app/composables/useActivityFeed.test.ts`:

```ts
import { ref, type Ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
const states = new Map<string, Ref<unknown>>();
vi.mock('./useApiClient.js', () => ({ useApiClient: () => ({ request }) }));
vi.mock('#imports', () => ({
  useState: <T>(key: string, init: () => T) => {
    if (!states.has(key)) states.set(key, ref(init()));
    return states.get(key) as Ref<T>;
  },
}));

import { useActivityFeed } from './useActivityFeed.js';

const page = {
  seenAt: null,
  newSince: '2026-10-23T10:00:00.000Z',
  unseenCount: 3,
  people: [],
  items: [],
  nextCursor: null,
};

beforeEach(() => {
  request.mockReset();
  states.clear();
});

describe('useActivityFeed', () => {
  it('reads the feed with the query and shares the unseen count', async () => {
    request.mockResolvedValue(page);
    await useActivityFeed().list('budget id', { limit: 5, actorId: 'user-1', cursor: 'abc' });
    expect(request).toHaveBeenCalledWith(
      '/api/v2/budgets/budget%20id/activity?limit=5&actorId=user-1&cursor=abc',
    );
    expect(useActivityFeed().unseenCount.value).toBe(3);
  });

  it('reads without a query string when nothing is set', async () => {
    request.mockResolvedValue(page);
    await useActivityFeed().list('budget-id');
    expect(request).toHaveBeenCalledWith('/api/v2/budgets/budget-id/activity');
  });

  it('marks the feed seen and clears the shared count', async () => {
    request.mockResolvedValueOnce(page).mockResolvedValueOnce({ seenAt: '2026-10-30T10:00:00Z' });
    const feed = useActivityFeed();
    await feed.list('budget-id');
    await feed.markSeen('budget-id');
    expect(request).toHaveBeenLastCalledWith('/api/v2/budgets/budget-id/activity/seen', {
      method: 'POST',
    });
    expect(useActivityFeed().unseenCount.value).toBe(0);
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useActivityFeed.test.ts`
Expected: FAIL — `Cannot find module './useActivityFeed.js'`.

- [ ] **Step 2: Клиент**

`apps/web/app/composables/useActivityFeed.ts`:

```ts
import type { Ref } from 'vue';
import { useState } from '#imports';

import { useApiClient } from './useApiClient.js';
import type { PersonRef } from './useEnvelopePlanV2.js';

// Thin typed client over the v2 activity feed. Amounts are minor-unit strings from the server;
// nothing here computes money.

export type ActivityKind =
  | 'TRANSACTION_CREATED'
  | 'TRANSACTION_UPDATED'
  | 'TRANSACTION_DELETED'
  | 'TRANSACTION_RESTORED'
  | 'TRANSFER_CREATED'
  | 'TRANSFER_DELETED'
  | 'ENVELOPE_FUNDED'
  | 'ENVELOPE_MOVED'
  | 'PLAN_PAID'
  | 'PLAN_CREATED'
  | 'CALENDAR_EVENT_CREATED'
  | 'CALENDAR_EVENT_UPDATED'
  | 'CALENDAR_EVENT_DELETED'
  | 'MEMBER_JOINED'
  | 'MEMBER_LEFT'
  | 'MEMBER_REMOVED';

export type ActivityLinkType =
  | 'TRANSACTION'
  | 'TRANSFER'
  | 'ENVELOPE'
  | 'PLAN_OCCURRENCE'
  | 'PLAN'
  | 'CALENDAR_EVENT';

export interface ActivityItem {
  id: string;
  occurredAt: string;
  kind: ActivityKind;
  isNew: boolean;
  actor: PersonRef;
  amountMinor: string | null;
  currency: string;
  transactionType: 'INCOME' | 'EXPENSE' | null;
  title: string | null;
  details: string[];
  target: PersonRef | null;
  link: { type: ActivityLinkType; id: string; date: string | null } | null;
}

export interface ActivityFeedResponse {
  seenAt: string | null;
  newSince: string;
  unseenCount: number;
  people: PersonRef[];
  items: ActivityItem[];
  nextCursor: string | null;
}

export interface ActivityFeedQuery {
  limit?: number | undefined;
  actorId?: string | undefined;
  cursor?: string | undefined;
}

export function useActivityFeed(): {
  unseenCount: Ref<number | null>;
  list(budgetId: string, query?: ActivityFeedQuery): Promise<ActivityFeedResponse>;
  markSeen(budgetId: string): Promise<{ seenAt: string }>;
} {
  const api = useApiClient();
  // One count for the dashboard card, the feed page and the navigation badge; null until read.
  const unseenCount = useState<number | null>('activity-unseen', () => null) as Ref<number | null>;
  const base = (budgetId: string) => `/api/v2/budgets/${encodeURIComponent(budgetId)}/activity`;

  return {
    unseenCount,
    async list(budgetId, query = {}) {
      const params = new URLSearchParams();
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.actorId) params.set('actorId', query.actorId);
      if (query.cursor) params.set('cursor', query.cursor);
      const search = params.toString();
      const feed = await api.request<ActivityFeedResponse>(
        search ? `${base(budgetId)}?${search}` : base(budgetId),
      );
      unseenCount.value = feed.unseenCount;
      return feed;
    },
    async markSeen(budgetId) {
      const result = await api.request<{ seenAt: string }>(`${base(budgetId)}/seen`, {
        method: 'POST',
      });
      unseenCount.value = 0;
      return result;
    },
  };
}
```

Run: тот же файл.
Expected: PASS.

- [ ] **Step 3: Экспорт `shortMonth`**

В `apps/web/app/components/calendar/calendar-dates.ts` заменить `const shortMonth = (date: string): string =>` на `export const shortMonth = (date: string): string =>`. Комментарий над ней оставить.

- [ ] **Step 4: Падающие тесты текстов**

Время в тестах задаётся локальными конструкторами `new Date(год, месяц, день, час, минута)`, поэтому тест не зависит от пояса машины.

`apps/web/app/components/activity/activity-phrases.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { ActivityItem } from '../../composables/useActivityFeed.js';
import {
  activityAction,
  activityDayKey,
  activityDayLabel,
  activityHeadline,
  activityHref,
  activitySubtitle,
  activityTime,
  activityTone,
  isStruck,
  unseenLabel,
  unseenShort,
} from './activity-phrases.js';

const alia = { userId: 'alia', displayName: 'Алия', isActiveMember: true };
const now = new Date(2026, 9, 30, 18, 0);
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();

const item = (overrides: Partial<ActivityItem>): ActivityItem => ({
  id: 'audit-1',
  occurredAt: at(30, 14, 20),
  kind: 'TRANSACTION_CREATED',
  isNew: true,
  actor: alia,
  amountMinor: '120000',
  currency: 'RUB',
  transactionType: 'EXPENSE',
  title: 'Продукты',
  details: ['Карта'],
  target: null,
  link: { type: 'TRANSACTION', id: 'tx-1', date: null },
  ...overrides,
});

describe('activity phrases', () => {
  it('names the action by kind and operation type, gender-neutral', () => {
    expect(activityAction(item({}))).toBe('добавлен расход');
    expect(activityAction(item({ transactionType: 'INCOME' }))).toBe('получен доход');
    expect(activityAction(item({ kind: 'TRANSACTION_DELETED' }))).toBe('удалён расход');
    expect(activityAction(item({ kind: 'PLAN_PAID', transactionType: null }))).toBe(
      'оплачен платёж',
    );
    expect(activityAction(item({ kind: 'MEMBER_LEFT' }))).toBe('больше не в семье');
  });

  it('puts the author first, a former member with the fixed suffix, the removed person last', () => {
    expect(activityHeadline(item({}))).toBe('Алия · добавлен расход');
    expect(activityHeadline(item({ actor: { ...alia, isActiveMember: false } }))).toBe(
      'Алия (не в семье) · добавлен расход',
    );
    expect(
      activityHeadline(
        item({
          kind: 'MEMBER_REMOVED',
          target: { userId: 'u', displayName: 'Игорь', isActiveMember: false },
        }),
      ),
    ).toBe('Алия · исключён участник «Игорь (не в семье)»');
    expect(activityHeadline(item({ kind: 'MEMBER_REMOVED', target: null }))).toBe(
      'Алия · исключён участник',
    );
  });

  it('builds the subtitle from title, details and time; transfers use an arrow', () => {
    expect(activitySubtitle(item({}), now)).toBe('Продукты · Карта · 14:20');
    expect(
      activitySubtitle(
        item({ kind: 'TRANSFER_CREATED', title: null, details: ['Карта', 'Наличные'] }),
        now,
      ),
    ).toBe('Карта → Наличные · 14:20');
    expect(
      activitySubtitle(
        item({ kind: 'ENVELOPE_MOVED', title: null, details: ['Продукты', 'Отпуск'] }),
        now,
      ),
    ).toBe('Продукты → Отпуск · 14:20');
    expect(
      activitySubtitle(item({ kind: 'MEMBER_JOINED', title: null, details: [] }), now),
    ).toBe('14:20');
  });

  it('formats time as today, yesterday or a short date', () => {
    expect(activityTime(at(30, 9, 5), now)).toBe('09:05');
    expect(activityTime(at(29, 23, 40), now)).toBe('вчера, 23:40');
    expect(activityTime(at(28, 14, 20), now)).toBe('28 окт, 14:20');
  });

  it('groups by local day', () => {
    expect(activityDayKey(at(28, 23, 59))).toBe('2026-10-28');
    expect(activityDayLabel('2026-10-30', now)).toBe('Сегодня');
    expect(activityDayLabel('2026-10-29', now)).toBe('Вчера');
    expect(activityDayLabel('2026-10-28', now)).toBe('28 октября');
  });

  it('chooses a tone only for operations and transfers', () => {
    expect(activityTone(item({}))).toBe('expense');
    expect(activityTone(item({ transactionType: 'INCOME' }))).toBe('income');
    expect(activityTone(item({ kind: 'TRANSFER_CREATED', transactionType: null }))).toBe(
      'transfer',
    );
    expect(activityTone(item({ kind: 'PLAN_PAID', transactionType: null }))).toBeUndefined();
  });

  it('links to the object, or nowhere once it is gone', () => {
    expect(activityHref(item({}))).toBe('/app/operations?operationId=tx-1');
    expect(activityHref(item({ link: { type: 'TRANSFER', id: 't', date: null } }))).toBe(
      '/app/operations',
    );
    expect(activityHref(item({ link: { type: 'ENVELOPE', id: 'e', date: null } }))).toBe(
      '/app/envelopes',
    );
    expect(activityHref(item({ link: { type: 'PLAN_OCCURRENCE', id: 'o', date: null } }))).toBe(
      '/app/plans?occurrence=o',
    );
    expect(activityHref(item({ link: { type: 'PLAN', id: 'p', date: null } }))).toBe('/app/plans');
    expect(
      activityHref(item({ link: { type: 'CALENDAR_EVENT', id: 'c', date: '2026-11-05' } })),
    ).toBe('/app/calendar?view=agenda&date=2026-11-05');
    expect(activityHref(item({ link: null }))).toBeNull();
  });

  it('strikes deleted money rows only', () => {
    expect(isStruck(item({ kind: 'TRANSACTION_DELETED' }))).toBe(true);
    expect(isStruck(item({ kind: 'TRANSFER_DELETED' }))).toBe(true);
    expect(isStruck(item({ kind: 'CALENDAR_EVENT_DELETED' }))).toBe(false);
  });

  it('declines the unseen count', () => {
    expect(unseenShort(1)).toBe('1 новое');
    expect(unseenShort(3)).toBe('3 новых');
    expect(unseenShort(11)).toBe('11 новых');
    expect(unseenShort(21)).toBe('21 новое');
    expect(unseenLabel(1)).toBe('1 новое событие');
    expect(unseenLabel(3)).toBe('3 новых события');
    expect(unseenLabel(5)).toBe('5 новых событий');
    expect(unseenLabel(12)).toBe('12 новых событий');
    expect(unseenLabel(22)).toBe('22 новых события');
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/components/activity`
Expected: FAIL — `Cannot find module './activity-phrases.js'`.

- [ ] **Step 5: Тексты**

`apps/web/app/components/activity/activity-phrases.ts`:

```ts
import { format } from 'date-fns';
import type { Component } from 'vue';
import { ArrowLeftRight, CalendarClock, CalendarDays, PiggyBank, Receipt, Users } from '@lucide/vue';

import type { ActivityItem, ActivityKind } from '../../composables/useActivityFeed.js';
import { shortMonth } from '../calendar/calendar-dates.js';
import { formatDayMonth } from '../envelopes/envelope-plan-kind.js';
import { authorLabel } from '../operations/author-label.js';

// Impersonal phrases: the reader's gender toward a co-author is unknown (see author-label.ts).
const ACTIONS: Record<ActivityKind, string | { INCOME: string; EXPENSE: string }> = {
  TRANSACTION_CREATED: { EXPENSE: 'добавлен расход', INCOME: 'получен доход' },
  TRANSACTION_UPDATED: { EXPENSE: 'изменён расход', INCOME: 'изменён доход' },
  TRANSACTION_DELETED: { EXPENSE: 'удалён расход', INCOME: 'удалён доход' },
  TRANSACTION_RESTORED: 'восстановлена операция',
  TRANSFER_CREATED: 'перевод',
  TRANSFER_DELETED: 'удалён перевод',
  ENVELOPE_FUNDED: 'пополнен конверт',
  ENVELOPE_MOVED: 'перемещение между конвертами',
  PLAN_PAID: 'оплачен платёж',
  PLAN_CREATED: 'новый план',
  CALENDAR_EVENT_CREATED: 'новое событие',
  CALENDAR_EVENT_UPDATED: 'изменено событие',
  CALENDAR_EVENT_DELETED: 'удалено событие',
  MEMBER_JOINED: 'в семье',
  MEMBER_LEFT: 'больше не в семье',
  MEMBER_REMOVED: 'исключён участник',
};

const ARROW_KINDS: ReadonlySet<ActivityKind> = new Set([
  'TRANSFER_CREATED',
  'TRANSFER_DELETED',
  'ENVELOPE_MOVED',
]);

export function activityAction(item: ActivityItem): string {
  const action = ACTIONS[item.kind];
  return typeof action === 'string' ? action : action[item.transactionType ?? 'EXPENSE'];
}

export function activityHeadline(item: ActivityItem): string {
  const target = item.kind === 'MEMBER_REMOVED' && item.target ? ` «${authorLabel(item.target)}»` : '';
  return `${authorLabel(item.actor)} · ${activityAction(item)}${target}`;
}

export function activityDayKey(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd');
}

function previousDayKey(now: Date): string {
  return format(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12), 'yyyy-MM-dd');
}

export function activityTime(iso: string, now: Date): string {
  const time = format(new Date(iso), 'HH:mm');
  const day = activityDayKey(iso);
  if (day === format(now, 'yyyy-MM-dd')) return time;
  if (day === previousDayKey(now)) return `вчера, ${time}`;
  return `${shortMonth(day)}, ${time}`;
}

export function activityDayLabel(dayKey: string, now: Date): string {
  if (dayKey === format(now, 'yyyy-MM-dd')) return 'Сегодня';
  if (dayKey === previousDayKey(now)) return 'Вчера';
  return formatDayMonth(dayKey);
}

export function activitySubtitle(item: ActivityItem, now: Date): string {
  const parts = ARROW_KINDS.has(item.kind)
    ? [item.details.join(' → ')]
    : [...(item.title ? [item.title] : []), ...item.details];
  return [...parts.filter((part) => part.length > 0), activityTime(item.occurredAt, now)].join(
    ' · ',
  );
}

export function activityTone(item: ActivityItem): 'income' | 'expense' | 'transfer' | undefined {
  if (item.kind.startsWith('TRANSFER_')) return 'transfer';
  if (item.kind.startsWith('TRANSACTION_') && item.transactionType) {
    return item.transactionType === 'INCOME' ? 'income' : 'expense';
  }
  return undefined;
}

// Same icons as the matching navigation sections.
export function activityIcon(item: ActivityItem): Component {
  if (item.kind.startsWith('TRANSACTION_')) return Receipt;
  if (item.kind.startsWith('TRANSFER_')) return ArrowLeftRight;
  if (item.kind.startsWith('ENVELOPE_')) return PiggyBank;
  if (item.kind.startsWith('PLAN_')) return CalendarClock;
  if (item.kind.startsWith('CALENDAR_')) return CalendarDays;
  return Users;
}

export function activityHref(item: ActivityItem): string | null {
  const link = item.link;
  if (!link) return null;
  const id = encodeURIComponent(link.id);
  switch (link.type) {
    case 'TRANSACTION':
      return `/app/operations?operationId=${id}`;
    case 'TRANSFER':
      return '/app/operations';
    case 'ENVELOPE':
      return '/app/envelopes';
    case 'PLAN_OCCURRENCE':
      return `/app/plans?occurrence=${id}`;
    case 'PLAN':
      return '/app/plans';
    case 'CALENDAR_EVENT':
      return link.date ? `/app/calendar?view=agenda&date=${link.date}` : '/app/calendar';
  }
}

export function isStruck(item: ActivityItem): boolean {
  return item.kind === 'TRANSACTION_DELETED' || item.kind === 'TRANSFER_DELETED';
}

function isSingular(count: number): boolean {
  return count % 10 === 1 && count % 100 !== 11;
}

function isFew(count: number): boolean {
  return count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14);
}

/** Pill text: «1 новое», «3 новых». */
export function unseenShort(count: number): string {
  return `${count} ${isSingular(count) ? 'новое' : 'новых'}`;
}

/** Accessible name of the badge: «1 новое событие», «3 новых события», «5 новых событий». */
export function unseenLabel(count: number): string {
  if (isSingular(count)) return `${count} новое событие`;
  return `${count} новых ${isFew(count) ? 'события' : 'событий'}`;
}
```

Run: `pnpm --filter @harmofin/web exec vitest run app/components/activity app/components/calendar/calendar-dates.test.ts`
Expected: PASS.

- [ ] **Step 6: Проверки и индексация**

Run: `pnpm --filter @harmofin/web typecheck` и `pnpm --filter @harmofin/web lint`
Expected: без ошибок.

```bash
git add apps/web/app/composables/useActivityFeed.ts apps/web/app/composables/useActivityFeed.test.ts apps/web/app/components/activity apps/web/app/components/calendar/calendar-dates.ts
```

Сообщение коммита: `feat(web): клиент и тексты ленты семьи`.

### Task 5: Строка ленты и карточка на главной

**Files:**
- Modify: `apps/web/app/components/ui/ListRow.vue` (+ `ListRow.test.ts`)
- Create: `apps/web/app/components/activity/ActivityRow.vue` (+ `ActivityRow.test.ts`)
- Create: `apps/web/app/components/dashboard/FamilyActivityCard.vue` (+ `FamilyActivityCard.test.ts`)
- Modify: `apps/web/app/pages/app/index.vue`, `apps/web/app/pages/app/index.test.ts`

**Interfaces:**
- Consumes: Task 4 — `useActivityFeed`, `ActivityItem`, функции `activity-phrases.ts`.
- Produces: `UiListRow` prop `interactive?: boolean` (по умолчанию `true`); `ActivityRow` props `{ item: ActivityItem; now: Date }`; `FamilyActivityCard` props `{ budgetId: string }`.

- [ ] **Step 1: Падающий тест `UiListRow`**

Добавить в `apps/web/app/components/ui/ListRow.test.ts`:

```ts
it('renders a plain block without a button when not interactive', async () => {
  const wrapper = mount(UiListRow, {
    props: { label: 'Строка', interactive: false },
    slots: { default: 'Текст' },
  });
  expect(wrapper.find('button').exists()).toBe(false);
  expect(wrapper.find('[data-testid="list-row-static"]').text()).toContain('Текст');
  await wrapper.find('[data-testid="list-row-static"]').trigger('click');
  expect(wrapper.emitted('select')).toBeUndefined();
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/components/ui/ListRow.test.ts`
Expected: FAIL — кнопка есть.

- [ ] **Step 2: `interactive` в `UiListRow`**

В `apps/web/app/components/ui/ListRow.vue`:

```ts
const props = withDefaults(
  defineProps<{
    label: string;
    /** Hue of the leading tile; neutral when not set. */
    leadingTone?: 'income' | 'expense' | 'transfer' | undefined;
    /** False renders the row as plain content: no button, no focus stop, no select event. */
    interactive?: boolean;
  }>(),
  { leadingTone: undefined, interactive: true },
);
```

В шаблоне кнопку заменить на:

```vue
    <button
      v-if="interactive"
      type="button"
      class="ui-list-row__select"
      data-testid="list-row-select"
      :aria-label="label"
      @click="$emit('select')"
    >
      <span v-if="$slots.leading" :class="leadingClass"><slot name="leading" /></span>
      <span class="ui-list-row__body"><slot /></span>
      <span v-if="$slots.trailing" class="ui-list-row__trailing"><slot name="trailing" /></span>
    </button>
    <div v-else class="ui-list-row__select ui-list-row__select--static" data-testid="list-row-static">
      <span v-if="$slots.leading" :class="leadingClass"><slot name="leading" /></span>
      <span class="ui-list-row__body"><slot /></span>
      <span v-if="$slots.trailing" class="ui-list-row__trailing"><slot name="trailing" /></span>
    </div>
```

В стилях:

```css
.ui-list-row__select--static {
  cursor: default;
}
```

Если у `.ui-list-row:hover` есть подсветка фона, для статичной строки её не менять: Calm Fintech не требует отключать hover, но курсор не должен обещать клик.

Run: тот же файл.
Expected: PASS, прежние тесты `ListRow.test.ts` тоже.

- [ ] **Step 3: Падающие тесты строки и карточки**

`apps/web/app/components/activity/ActivityRow.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('#imports', () => ({ navigateTo: mocks.navigateTo }));

import type { ActivityItem } from '../../composables/useActivityFeed.js';
import ActivityRow from './ActivityRow.vue';

const now = new Date(2026, 9, 30, 18, 0);
const item = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'audit-1',
  occurredAt: new Date(2026, 9, 30, 14, 20).toISOString(),
  kind: 'TRANSACTION_CREATED',
  isNew: true,
  actor: { userId: 'alia', displayName: 'Алия', isActiveMember: true },
  amountMinor: '120000',
  currency: 'RUB',
  transactionType: 'EXPENSE',
  title: 'Продукты',
  details: ['Карта'],
  target: null,
  link: { type: 'TRANSACTION', id: 'tx-1', date: null },
  ...overrides,
});

const normalize = (text: string) => text.replace(/\s/g, ' ');

describe('ActivityRow', () => {
  it('shows author, action, details, amount and the «новое» status as text', () => {
    const wrapper = mount(ActivityRow, { props: { item: item(), now } });
    const text = normalize(wrapper.text());
    expect(text).toContain('Алия · добавлен расход');
    expect(text).toContain('Продукты · Карта · 14:20');
    expect(text).toContain('1 200,00 ₽');
    expect(text).toContain('новое');
    expect(wrapper.find('button').attributes('aria-label')).toContain('новое');
  });

  it('opens the object', async () => {
    const wrapper = mount(ActivityRow, { props: { item: item(), now } });
    await wrapper.find('button').trigger('click');
    expect(mocks.navigateTo).toHaveBeenCalledWith('/app/operations?operationId=tx-1');
  });

  it('marks a deleted operation in text and leaves no button when the object is gone', () => {
    const wrapper = mount(ActivityRow, {
      props: { item: item({ kind: 'TRANSACTION_DELETED', isNew: false, link: null }), now },
    });
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).toContain('удалено');
    expect(wrapper.find('.activity-row__amount--struck').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('новое');
  });
});
```

`apps/web/app/components/dashboard/FamilyActivityCard.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const feed = vi.hoisted(() => ({ list: vi.fn(), markSeen: vi.fn(), unseenCount: { value: null } }));
vi.mock('#imports', () => ({ navigateTo: vi.fn() }));
vi.mock('../../composables/useActivityFeed.js', () => ({
  useActivityFeed: () => ({ ...feed, unseenCount: ref(feed.unseenCount.value) }),
}));

import FamilyActivityCard from './FamilyActivityCard.vue';

const alia = { userId: 'alia', displayName: 'Алия', isActiveMember: true };
const response = (overrides = {}) => ({
  seenAt: null,
  newSince: '2026-10-23T00:00:00.000Z',
  unseenCount: 2,
  people: [alia],
  items: [
    {
      id: 'audit-1',
      occurredAt: new Date().toISOString(),
      kind: 'CALENDAR_EVENT_CREATED',
      isNew: true,
      actor: alia,
      amountMinor: null,
      currency: 'RUB',
      transactionType: null,
      title: 'Родительское собрание',
      details: [],
      target: null,
      link: { type: 'CALENDAR_EVENT', id: 'e', date: '2026-11-05' },
    },
  ],
  nextCursor: null,
  ...overrides,
});

const mountCard = () =>
  mount(FamilyActivityCard, {
    props: { budgetId: 'budget-id' },
    global: { stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } } },
  });

beforeEach(() => {
  feed.list.mockReset();
  feed.markSeen.mockReset();
});

describe('FamilyActivityCard', () => {
  it('reads five items, shows the new count and links to the feed, without marking it seen', async () => {
    feed.list.mockResolvedValue(response());
    const wrapper = mountCard();
    await flushPromises();
    expect(feed.list).toHaveBeenCalledWith('budget-id', { limit: 5 });
    expect(wrapper.text()).toContain('Что нового в семье');
    expect(wrapper.text()).toContain('2 новых');
    expect(wrapper.text()).toContain('Алия · новое событие');
    expect(wrapper.find('a[href="/app/activity"]').text()).toContain('Все события');
    expect(feed.markSeen).not.toHaveBeenCalled();
  });

  it('says it is quiet when the family did nothing', async () => {
    feed.list.mockResolvedValue(response({ items: [], unseenCount: 0 }));
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.text()).toContain('Пока тихо — семья ничего не меняла.');
    expect(wrapper.text()).not.toContain('новых');
  });

  it('stays hidden for a single-person budget and when the request fails', async () => {
    feed.list.mockResolvedValue(response({ people: [] }));
    const single = mountCard();
    await flushPromises();
    expect(single.find('[data-testid="family-activity-card"]').exists()).toBe(false);

    feed.list.mockRejectedValue(new Error('offline'));
    const failed = mountCard();
    await flushPromises();
    expect(failed.find('[data-testid="family-activity-card"]').exists()).toBe(false);
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/components/activity/ActivityRow.test.ts app/components/dashboard/FamilyActivityCard.test.ts`
Expected: FAIL — компонентов нет.

- [ ] **Step 4: `ActivityRow`**

`apps/web/app/components/activity/ActivityRow.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo } from '#imports';

import UiListRow from '../ui/ListRow.vue';
import UiStatus from '../ui/Status.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import type { ActivityItem } from '../../composables/useActivityFeed.js';
import {
  activityHeadline,
  activityHref,
  activityIcon,
  activitySubtitle,
  activityTone,
  isStruck,
} from './activity-phrases.js';

defineOptions({ name: 'ActivityRow' });

const props = defineProps<{ item: ActivityItem; now: Date }>();

const headline = computed(() => activityHeadline(props.item));
const subtitle = computed(() => activitySubtitle(props.item, props.now));
const href = computed(() => activityHref(props.item));
const struck = computed(() => isStruck(props.item));
// Display only: the server sent minor units, the client formats them.
const amount = computed(() =>
  props.item.amountMinor === null
    ? null
    : formatMinorUnits(props.item.amountMinor, props.item.currency, 2),
);
const label = computed(() =>
  [
    headline.value,
    subtitle.value,
    amount.value,
    struck.value ? 'удалено' : null,
    props.item.isNew ? 'новое' : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('. '),
);

function open(): void {
  if (href.value) void navigateTo(href.value);
}
</script>

<template>
  <UiListRow
    :label="label"
    :leading-tone="activityTone(item)"
    :interactive="href !== null"
    :data-testid="`activity-row-${item.id}`"
    @select="open"
  >
    <template #leading>
      <component :is="activityIcon(item)" :size="18" aria-hidden="true" />
    </template>
    <span class="activity-row__headline">{{ headline }}</span>
    <span class="activity-row__subtitle">{{ subtitle }}</span>
    <template #trailing>
      <span class="activity-row__trailing">
        <UiStatus v-if="item.isNew" label="новое" tone="info" />
        <span
          v-if="amount"
          class="activity-row__amount"
          :class="{ 'activity-row__amount--struck': struck }"
          >{{ amount }}</span
        >
        <span v-if="struck" class="activity-row__deleted">удалено</span>
      </span>
    </template>
  </UiListRow>
</template>

<style scoped>
.activity-row__headline {
  display: block;
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-row__subtitle {
  display: block;
  overflow: hidden;
  color: var(--hf-color-text-muted);
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-row__trailing {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  justify-content: flex-end;
}

.activity-row__amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.activity-row__amount--struck,
.activity-row__deleted {
  color: var(--hf-color-text-muted);
}

.activity-row__amount--struck {
  text-decoration: line-through;
}

.activity-row__deleted {
  font-size: 0.875rem;
}
</style>
```

Имена токенов (`--hf-color-text-muted`, `--hf-font-weight-medium`, `--hf-space-2`) сверить с `apps/web/app/assets/styles/tokens.css`; новых токенов не вводить.

- [ ] **Step 5: `FamilyActivityCard`**

`apps/web/app/components/dashboard/FamilyActivityCard.vue` (оформление карточки — как у `RecentOperations.vue`):

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import ActivityRow from '../activity/ActivityRow.vue';
import { unseenShort } from '../activity/activity-phrases.js';
import UiMoreLink from '../ui/MoreLink.vue';
import UiStatus from '../ui/Status.vue';
import {
  type ActivityFeedResponse,
  useActivityFeed,
} from '../../composables/useActivityFeed.js';

defineOptions({ name: 'FamilyActivityCard' });

const props = defineProps<{ budgetId: string }>();

const feed = useActivityFeed();
const state = ref<ActivityFeedResponse | null>(null);
const now = ref(new Date());

// The dashboard must not break because of the feed: a failed read just hides the card.
async function load(): Promise<void> {
  try {
    now.value = new Date();
    state.value = await feed.list(props.budgetId, { limit: 5 });
  } catch {
    state.value = null;
  }
}

onMounted(load);
watch(() => props.budgetId, load);

const visible = computed(() => (state.value?.people.length ?? 0) > 0);
</script>

<template>
  <section
    v-if="visible && state"
    class="family-activity"
    aria-labelledby="family-activity-title"
    data-testid="family-activity-card"
  >
    <header class="family-activity__header">
      <div>
        <h2 id="family-activity-title">Что нового в семье</h2>
        <p class="family-activity__subtitle">Действия других участников</p>
      </div>
      <div class="family-activity__aside">
        <UiStatus v-if="state.unseenCount > 0" :label="unseenShort(state.unseenCount)" tone="info" />
        <UiMoreLink to="/app/activity">Все события</UiMoreLink>
      </div>
    </header>

    <p v-if="state.items.length === 0" class="family-activity__empty">
      Пока тихо — семья ничего не меняла.
    </p>
    <ul v-else class="family-activity__list">
      <li v-for="item in state.items" :key="item.id">
        <ActivityRow :item="item" :now="now" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.family-activity {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.family-activity__header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: baseline;
  justify-content: space-between;
}

.family-activity__header h2 {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.family-activity__subtitle,
.family-activity__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
}

.family-activity__aside {
  display: inline-flex;
  gap: var(--hf-space-3);
  align-items: center;
}

.family-activity__list {
  display: grid;
  gap: var(--hf-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
```

Стили заголовка и подписи сверить с `RecentOperations.vue` (`.recent-operations__subtitle`) и повторить те же токены.

Run: тесты строки и карточки.
Expected: PASS.

- [ ] **Step 6: Карточка на главной**

В `apps/web/app/pages/app/index.vue`:

- импорт `import FamilyActivityCard from '../../components/dashboard/FamilyActivityCard.vue';` рядом с `UpcomingObligations`;
- сразу после `<UpcomingObligations :items="dashboardV2.nearestObligations" />`:

```vue
        <FamilyActivityCard v-if="activeBudget" :budget-id="activeBudget.id" />
```

В `apps/web/app/pages/app/index.test.ts` рядом с другими `vi.mock`:

```ts
vi.mock('../../components/dashboard/FamilyActivityCard.vue', () => ({
  default: { name: 'FamilyActivityCard', props: ['budgetId'], template: '<div data-testid="family-activity-stub" />' },
}));
```

и в существующий тест, проверяющий порядок блоков дашборда (или в новый `it`), добавить: `expect(wrapper.find('[data-testid="family-activity-stub"]').exists()).toBe(true);`.

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/index.test.ts`
Expected: PASS.

- [ ] **Step 7: Проверки и индексация**

Run: `pnpm --filter @harmofin/web test`, `pnpm --filter @harmofin/web typecheck`, `pnpm --filter @harmofin/web lint`
Expected: без ошибок.

```bash
git add apps/web/app/components/ui/ListRow.vue apps/web/app/components/ui/ListRow.test.ts apps/web/app/components/activity/ActivityRow.vue apps/web/app/components/activity/ActivityRow.test.ts apps/web/app/components/dashboard/FamilyActivityCard.vue apps/web/app/components/dashboard/FamilyActivityCard.test.ts apps/web/app/pages/app/index.vue apps/web/app/pages/app/index.test.ts
```

Сообщение коммита: `feat(web): карточка «Что нового в семье» на главной`.

### Task 6: Страница `/app/activity` и пункт меню

**Files:**
- Create: `apps/web/app/pages/app/activity.vue` (+ `activity.test.ts`)
- Modify: `apps/web/app/components/app/AppSidebar.vue` (+ `AppSidebar.test.ts`)
- Modify: `apps/web/app/components/app/AppMobileMenu.vue` (+ `AppMobileMenu.test.ts`)

**Interfaces:**
- Consumes: Task 4 — `useActivityFeed`, `ActivityItem`, `activityDayKey`, `activityDayLabel`, `unseenLabel`; Task 5 — `ActivityRow`.

- [ ] **Step 1: Падающий тест страницы**

`apps/web/app/pages/app/activity.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const feed = vi.hoisted(() => ({ list: vi.fn(), markSeen: vi.fn() }));
const auth = {
  currentData: { value: { workspaces: [{ id: 'ws', budgets: [{ id: 'budget-id' }] }] } },
  loadMe: vi.fn(),
};
vi.mock('#imports', () => ({ definePageMeta: vi.fn(), navigateTo: vi.fn() }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useActivityFeed.js', () => ({
  useActivityFeed: () => ({ ...feed, unseenCount: ref(null) }),
}));

import ActivityPage from './activity.vue';

const alia = { userId: 'alia', displayName: 'Алия', isActiveMember: true };
const igor = { userId: 'igor', displayName: 'Игорь', isActiveMember: true };
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const item = (id: string, occurredAt: string, actor = alia) => ({
  id,
  occurredAt,
  kind: 'CALENDAR_EVENT_CREATED',
  isNew: false,
  actor,
  amountMinor: null,
  currency: 'RUB',
  transactionType: null,
  title: `Событие ${id}`,
  details: [],
  target: null,
  link: null,
});
const page = (overrides = {}) => ({
  seenAt: hoursAgo(2),
  newSince: hoursAgo(2),
  unseenCount: 1,
  people: [alia, igor],
  items: [item('fresh', hoursAgo(1)), item('old', hoursAgo(50))],
  nextCursor: null,
  ...overrides,
});

beforeEach(() => {
  feed.list.mockReset();
  feed.markSeen.mockReset();
  feed.markSeen.mockResolvedValue({ seenAt: new Date().toISOString() });
});

describe('activity page', () => {
  it('splits new from earlier by the first boundary, then marks the feed seen', async () => {
    feed.list.mockResolvedValue(page());
    const wrapper = mount(ActivityPage);
    await flushPromises();
    const news = wrapper.find('[data-testid="activity-new"]');
    expect(news.text()).toContain('Событие fresh');
    expect(news.text()).not.toContain('Событие old');
    expect(wrapper.find('[data-testid="activity-earlier"]').text()).toContain('Событие old');
    expect(feed.markSeen).toHaveBeenCalledWith('budget-id');
    expect(feed.markSeen.mock.invocationCallOrder[0]).toBeGreaterThan(
      feed.list.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the split after a filter change and marks seen only once', async () => {
    feed.list.mockResolvedValueOnce(page()).mockResolvedValueOnce(
      page({ seenAt: new Date().toISOString(), newSince: new Date().toISOString(), items: [item('fresh', hoursAgo(1))] }),
    );
    const wrapper = mount(ActivityPage);
    await flushPromises();
    await wrapper.findComponent({ name: 'UiFilterBar' }).vm.$emit('change', 'actor', 'alia');
    await flushPromises();
    expect(feed.list).toHaveBeenLastCalledWith('budget-id', { actorId: 'alia' });
    expect(wrapper.find('[data-testid="activity-new"]').text()).toContain('Событие fresh');
    expect(feed.markSeen).toHaveBeenCalledTimes(1);
  });

  it('loads more with the cursor', async () => {
    feed.list
      .mockResolvedValueOnce(page({ nextCursor: 'next' }))
      .mockResolvedValueOnce(page({ items: [item('older', hoursAgo(80))], nextCursor: null }));
    const wrapper = mount(ActivityPage);
    await flushPromises();
    await wrapper.find('[data-testid="activity-more"]').trigger('click');
    await flushPromises();
    expect(feed.list).toHaveBeenLastCalledWith('budget-id', { cursor: 'next' });
    expect(wrapper.text()).toContain('Событие older');
    expect(wrapper.find('[data-testid="activity-more"]').exists()).toBe(false);
  });

  it('shows an empty state and a retry on failure; a failed mark is silent', async () => {
    feed.list.mockResolvedValueOnce(page({ items: [], unseenCount: 0 }));
    feed.markSeen.mockRejectedValueOnce(new Error('offline'));
    const empty = mount(ActivityPage);
    await flushPromises();
    expect(empty.text()).toContain('За 30 дней семья ничего не меняла');

    feed.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page());
    const failed = mount(ActivityPage);
    await flushPromises();
    expect(failed.text()).toContain('Не удалось загрузить ленту');
    await failed.find('[data-testid="activity-retry"]').trigger('click');
    await flushPromises();
    expect(failed.text()).toContain('Событие fresh');
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/activity.test.ts`
Expected: FAIL — страницы нет.

- [ ] **Step 2: Страница**

`apps/web/app/pages/app/activity.vue`:

```vue
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { definePageMeta } from '#imports';

import ActivityRow from '../../components/activity/ActivityRow.vue';
import { activityDayKey, activityDayLabel } from '../../components/activity/activity-phrases.js';
import { authorLabel } from '../../components/operations/author-label.js';
import UiButton from '../../components/ui/Button.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiFilterBar from '../../components/ui/FilterBar.vue';
import UiSkeleton from '../../components/ui/Skeleton.vue';
import { useActiveWorkspace } from '../../composables/useActiveWorkspace.js';
import { type ActivityItem, useActivityFeed } from '../../composables/useActivityFeed.js';
import type { PersonRef } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'ActivityPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { budget } = useActiveWorkspace();
const feed = useActivityFeed();

const items = ref<ActivityItem[]>([]);
const people = ref<PersonRef[]>([]);
const nextCursor = ref<string | null>(null);
const actorFilter = ref('');
const loading = ref(true);
const loadingMore = ref(false);
const loadError = ref(false);
const now = ref(new Date());
const listEl = ref<HTMLElement | null>(null);
// «Новое» is fixed by the first response of this visit: marking seen right after must not
// move rows to «Ранее» while the page is open.
const boundary = ref<number | null>(null);
let markedSeen = false;

const isNew = (item: ActivityItem) =>
  boundary.value !== null && Date.parse(item.occurredAt) > boundary.value;
const shown = computed(() => items.value.map((item) => ({ ...item, isNew: isNew(item) })));
const fresh = computed(() => shown.value.filter((item) => item.isNew));
const earlier = computed(() => {
  const groups: Array<{ key: string; label: string; items: ActivityItem[] }> = [];
  for (const item of shown.value.filter((entry) => !entry.isNew)) {
    const key = activityDayKey(item.occurredAt);
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: activityDayLabel(key, now.value), items: [item] });
  }
  return groups;
});
const chips = computed(() => [
  {
    key: 'actor',
    label: 'Участник',
    options: people.value.map((person) => ({ value: person.userId, label: authorLabel(person) })),
  },
]);

async function load(): Promise<void> {
  const budgetId = budget.value?.id;
  if (!budgetId) return;
  loading.value = true;
  loadError.value = false;
  try {
    now.value = new Date();
    const page = await feed.list(budgetId, actorFilter.value ? { actorId: actorFilter.value } : {});
    items.value = page.items;
    people.value = page.people;
    nextCursor.value = page.nextCursor;
    if (boundary.value === null) boundary.value = Date.parse(page.newSince);
    if (!markedSeen) {
      markedSeen = true;
      // Failure is invisible to the user: the next visit simply shows the same rows as new.
      void feed.markSeen(budgetId).catch(() => undefined);
    }
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  const budgetId = budget.value?.id;
  if (!budgetId || !nextCursor.value) return;
  loadingMore.value = true;
  const firstNewIndex = items.value.length;
  try {
    const page = await feed.list(budgetId, {
      cursor: nextCursor.value,
      ...(actorFilter.value ? { actorId: actorFilter.value } : {}),
    });
    items.value = [...items.value, ...page.items];
    nextCursor.value = page.nextCursor;
    await nextTick();
    // Keyboard users continue from the first row that just appeared.
    listEl.value
      ?.querySelectorAll<HTMLElement>('[data-testid^="activity-row-"] button')
      [firstNewIndex]?.focus();
  } catch {
    loadError.value = true;
  } finally {
    loadingMore.value = false;
  }
}

function changeFilter(_key: string, value: string): void {
  actorFilter.value = value;
  void load();
}

function resetFilter(): void {
  actorFilter.value = '';
  void load();
}

onMounted(load);
</script>

<template>
  <div class="activity-page">
    <header class="activity-page__header">
      <p class="activity-page__eyebrow">Семья</p>
      <h1>Лента</h1>
      <p class="activity-page__subtitle">Что сделали другие участники за 30 дней</p>
    </header>

    <UiFilterBar
      v-if="people.length > 1"
      :chips="chips"
      :values="{ actor: actorFilter }"
      :can-reset="actorFilter !== ''"
      @change="changeFilter"
      @reset="resetFilter"
    />

    <UiEmptyState
      v-if="loadError && items.length === 0"
      title="Не удалось загрузить ленту"
      description="Проверьте соединение и повторите."
    >
      <template #action>
        <UiButton data-testid="activity-retry" @click="load">Повторить</UiButton>
      </template>
    </UiEmptyState>
    <div v-else-if="loading" class="activity-page__loading" aria-busy="true">
      <UiSkeleton variant="row" :count="4" />
    </div>
    <UiEmptyState
      v-else-if="items.length === 0"
      title="За 30 дней семья ничего не меняла"
      description="Здесь появятся операции, платежи и события других участников."
    />
    <div v-else ref="listEl" class="activity-page__content">
      <section
        v-if="fresh.length > 0"
        class="activity-page__group"
        aria-labelledby="activity-new-title"
        data-testid="activity-new"
      >
        <h2 id="activity-new-title" class="activity-page__group-title">Новое</h2>
        <ul class="activity-page__list">
          <li v-for="item in fresh" :key="item.id"><ActivityRow :item="item" :now="now" /></li>
        </ul>
      </section>

      <div v-if="earlier.length > 0" class="activity-page__earlier" data-testid="activity-earlier">
        <h2 class="activity-page__divider">Ранее</h2>
        <section
          v-for="group in earlier"
          :key="group.key"
          class="activity-page__group"
          :aria-label="group.label"
        >
          <h3 class="activity-page__group-title">{{ group.label }}</h3>
          <ul class="activity-page__list">
            <li v-for="item in group.items" :key="item.id">
              <ActivityRow :item="item" :now="now" />
            </li>
          </ul>
        </section>
      </div>

      <UiButton
        v-if="nextCursor"
        variant="secondary"
        class="activity-page__more"
        data-testid="activity-more"
        :disabled="loadingMore"
        @click="loadMore"
      >
        Показать ещё
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.activity-page {
  display: grid;
  gap: var(--hf-space-5);
  max-width: 56rem;
  margin: 0 auto;
  padding: var(--hf-space-8);
}

.activity-page__header h1,
.activity-page__eyebrow,
.activity-page__subtitle {
  margin: 0;
}

.activity-page__header h1 {
  font-size: clamp(2rem, 4vw, 3.5rem);
  letter-spacing: -0.04em;
}

.activity-page__eyebrow {
  color: var(--hf-color-action-primary-hover);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.activity-page__subtitle {
  color: var(--hf-color-text-muted);
}

.activity-page__loading,
.activity-page__content,
.activity-page__earlier {
  display: grid;
  gap: var(--hf-space-4);
}

.activity-page__group {
  display: grid;
  gap: var(--hf-space-2);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.activity-page__group-title,
.activity-page__divider {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.activity-page__divider {
  color: var(--hf-color-text-muted);
}

.activity-page__list {
  display: grid;
  gap: var(--hf-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.activity-page__more {
  justify-self: center;
}

@media (max-width: 47.9375rem) {
  .activity-page {
    padding: var(--hf-space-5);
  }
}
</style>
```

Свойства `UiEmptyState` (`title`, `description`, слот `action`) и `UiSkeleton` сверить с `calendar.vue`; заголовок и eyebrow — как у `notifications.vue`.

Run: тест страницы.
Expected: PASS.

- [ ] **Step 3: Падающие тесты меню**

В `AppSidebar.test.ts` и `AppMobileMenu.test.ts` рядом с `vi.mock('../../composables/useAuth.js', …)`:

```ts
const activity = vi.hoisted(() => ({
  unseenCount: { value: null as number | null },
  list: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../composables/useActivityFeed.js', () => ({ useActivityFeed: () => activity }));
```

`useActiveWorkspace` не мокать: его же читает `AppWorkspaceSwitcher`. Активный бюджет задаётся через уже замоканный `useAuth` (`currentData.value.workspaces`).

Новый тест в `AppSidebar.test.ts`:

```ts
it('links to the feed with an accessible new-events count', async () => {
  activity.unseenCount.value = 3;
  const wrapper = mountSidebar();
  await flushPromises();
  const link = wrapper.find('a[href="/app/activity"]');
  expect(link.text()).toContain('Лента');
  expect(link.text()).toContain('3 новых события');
  expect(activity.list).not.toHaveBeenCalled();
});

it('reads the count once when nothing loaded it yet', async () => {
  activity.unseenCount.value = null;
  activity.list.mockClear();
  mocks.auth.currentData.value = {
    user: { email: 'owner@example.test' },
    workspaces: [{ id: 'ws', isCreator: true, role: 'OWNER', budgets: [{ id: 'budget-id' }] }],
  } as never;
  mountSidebar();
  await flushPromises();
  expect(activity.list).toHaveBeenCalledWith('budget-id', { limit: 1 });
});
```

После этого теста вернуть `mocks.auth.currentData.value` к исходному значению (в `afterEach` или в конце теста), чтобы не задеть соседние тесты.

В `AppMobileMenu.test.ts` — аналогичная проверка ссылки `/app/activity` с текстом «Лента» и «3 новых события» (функция монтирования — та, что уже есть в файле).

Run: `pnpm --filter @harmofin/web exec vitest run app/components/app/AppSidebar.test.ts app/components/app/AppMobileMenu.test.ts`
Expected: FAIL — ссылки нет.

- [ ] **Step 4: Пункт меню**

`AppSidebar.vue`, скрипт:

```ts
import { Activity } from '@lucide/vue'; // добавить в существующий импорт из '@lucide/vue'
import { unseenLabel } from '../activity/activity-phrases.js';
import { useActiveWorkspace } from '../../composables/useActiveWorkspace.js';
import { useActivityFeed } from '../../composables/useActivityFeed.js';

const { budgetId } = useActiveWorkspace();
const activity = useActivityFeed();
```

В существующий `onMounted` после `hydrated.value = true;`:

```ts
  // One read per app load when neither the dashboard card nor the feed page has filled the count.
  if (activity.unseenCount.value === null && budgetId.value) {
    void activity.list(budgetId.value, { limit: 1 }).catch(() => undefined);
  }
```

Шаблон: в секцию с «Аналитикой» и «Уведомлениями», перед ссылкой «Уведомления»:

```vue
        <NuxtLink
          to="/app/activity"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app/activity')"
          ><Activity :size="18" aria-hidden="true" />Лента<template
            v-if="hydrated && (activity.unseenCount.value ?? 0) > 0"
            ><span class="app-sidebar__badge" aria-hidden="true">{{
              activity.unseenCount.value
            }}</span
            ><span class="app-sidebar__sr">, {{ unseenLabel(activity.unseenCount.value ?? 0) }}</span></template
          ></NuxtLink
        >
```

Стили:

```css
.app-sidebar__badge {
  margin-left: auto;
  min-width: 1.5rem;
  padding: 0 var(--hf-space-1);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-status-info-background);
  color: var(--hf-color-status-info);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-bold);
  line-height: 1.5rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.app-sidebar__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
```

Тест ожидает в `link.text()` и «3», и «3 новых события»: видимое число скрыто от экранного диктора (`aria-hidden`), диктор читает «Лента, 3 новых события».

`AppMobileMenu.vue`: после ссылки «Календарь» — ссылка `/app/activity` в том же стиле, что соседние (`mobile-menu__link`, `@click="handleClose"`), с текстом «Лента» и тем же бейджем и скрытой подписью (классы `mobile-menu__badge`, `mobile-menu__sr` с теми же стилями). Счётчик берётся из `useActivityFeed().unseenCount`; отдельный запрос из мобильного меню не делается.

Run: тесты меню.
Expected: PASS.

- [ ] **Step 5: Проверки и индексация**

Run: `pnpm --filter @harmofin/web test`, `pnpm --filter @harmofin/web typecheck`, `pnpm --filter @harmofin/web lint`
Expected: без ошибок.

```bash
git add apps/web/app/pages/app/activity.vue apps/web/app/pages/app/activity.test.ts apps/web/app/components/app/AppSidebar.vue apps/web/app/components/app/AppSidebar.test.ts apps/web/app/components/app/AppMobileMenu.vue apps/web/app/components/app/AppMobileMenu.test.ts
```

Сообщение коммита: `feat(web): страница ленты семьи и пункт меню`.

### Task 7: E2E и документация

**Files:**
- Create: `e2e/family-activity.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: E2E-сценарий (запускается только в CI)**

Помощники `registerAccount`, `setDisplayName`, `inviteAndJoin`, `waitForHydration` скопировать из `e2e/family-calendar.spec.ts` (они локальные в том файле) без изменений.

`e2e/family-activity.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

// Family activity feed: what the member did shows up for the creator as new, and opening the feed
// clears the navigation counter.
test('the creator sees a member event in the feed and the counter clears', async ({ browser }) => {
  test.setTimeout(180_000);
  const creator = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const creatorPage = await creator.newPage();
  const member = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberPage = await member.newPage();
  const stamp = Date.now();

  await registerAccount(creatorPage, `e2e-feed-creator-${stamp}@harmofin.test`);
  await setDisplayName(creatorPage, 'Ильдар');
  await inviteAndJoin(creatorPage, memberPage, `e2e-feed-member-${stamp}@harmofin.test`, 'Алия');

  // The member adds an all-day event.
  await memberPage.goto('/app/calendar?view=agenda');
  await waitForHydration(memberPage);
  await memberPage.getByTestId('calendar-create').click();
  const form = memberPage.getByRole('dialog', { name: 'Новое событие' });
  await form.getByLabel('Название').fill('Родительское собрание');
  await form.getByRole('switch', { name: 'Весь день' }).click();
  await form.getByRole('button', { name: 'Сохранить событие' }).click();
  await expect(memberPage.getByTestId('toast-stack')).toContainText('Событие сохранено');

  // The creator sees it on the dashboard as new, together with the member joining the family.
  await creatorPage.goto('/app');
  await waitForHydration(creatorPage);
  const card = creatorPage.getByTestId('family-activity-card');
  await expect(card).toContainText('Алия · новое событие');
  await expect(card).toContainText('Родительское собрание');
  await expect(card).toContainText('Алия · в семье');
  await expect(card).toContainText('2 новых');

  // Opening the feed shows it under «Новое» and clears the counter in the sidebar.
  // The sidebar is the aside labelled «Основная навигация»; other navigation regions exist on the page.
  const nav = creatorPage.getByRole('complementary', { name: 'Основная навигация' });
  await expect(nav.getByRole('link', { name: /Лента, 2 новых события/ })).toBeVisible();
  await card.getByRole('link', { name: 'Все события' }).click();
  await waitForHydration(creatorPage);
  await expect(creatorPage.getByTestId('activity-new')).toContainText('Родительское собрание');
  await expect(nav.getByRole('link', { name: 'Лента', exact: true })).toBeVisible();

  await creator.close();
  await member.close();
});

// --- helpers copied from e2e/family-calendar.spec.ts ---
```

После комментария вставить четыре функции из `e2e/family-calendar.spec.ts` целиком. Если у страницы нет `data-hydrated` (её проверяет `waitForHydration`), добавить `data-hydrated="true"` на корень `activity.vue` после `onMounted`, как в `calendar.vue` (`v-if="hydrated"`), и отразить это в тесте страницы.

Локально не запускать. Проверить только типы: `pnpm exec tsc --noEmit -p e2e/tsconfig.json`, если такой tsconfig есть; иначе `pnpm lint`.

- [ ] **Step 2: README**

В `README.md` в список возможностей после строки про семейный календарь:

```markdown
- лента семьи: что сделали другие участники за 30 дней, с отметкой новых событий с прошлого визита;
```

Строку про email и push (раздел ограничений) не менять: лента работает только внутри приложения.

- [ ] **Step 3: Проверки и индексация**

Run: `pnpm format:check`, `pnpm lint`
Expected: без ошибок.

```bash
git add e2e/family-activity.spec.ts README.md
```

Сообщение коммита: `test(e2e): лента семьи; docs: README`.

После коммита Task 7 координатор останавливается и спрашивает владельца, открывать ли PR 2. E2E проверяет CI этого PR.

## Review по задачам

| Задача | Обязательные review |
|---|---|
| 1. Таблица и миграция | backend (миграция), security (purge, связь с `users`), QA, final |
| 2. Белый список и разбор | security (что уходит наружу из `oldValues`/`newValues`), QA, final |
| 3. API ленты | security, API, backend, QA, final |
| 4. Клиент и тексты | API, UI/UX (тексты, род), QA, final |
| 5. Строка и карточка | UI/UX, QA, final |
| 6. Страница и меню | UI/UX, security (счётчик и видимость не заменяют серверную проверку), QA, final |
| 7. E2E и документация | QA, final |

Financial review не требуется: лента не меняет деньги и не считает итоги. Если writer начнёт пересчитывать суммы или объединять их — это нарушение Global Constraints, нужен financial review.

`BLOCK` Security координатор не снимает сам: исправляет writer, review повторяется. Каждый reviewer получает: текст задачи из этого плана, раздел дизайна, `git diff` задачи и вывод проверок.

## Ход выполнения

- Task 1: complete, коммит `0ea6681`. Review: backend, security, QA, final — APPROVE. Проверки: `db:generate`, `prisma migrate diff` (пусто), `pnpm test:integration` (705), worker (86), `pnpm typecheck`. Решение: первый writer упёрся в EPERM `db:generate` (dev-процессы владельца), владелец их остановил, проверки добиты вторым запуском. Заметка security (не блокер): FK не связывает пользователя отметки с членством, членство проверяет сервис (Task 3).
- Task 2: complete, коммит `20de5a7`. Review: security, QA, final — APPROVE. Проверки: unit `src/activity-feed` (14), typecheck, eslint. Для Task 3 (из review): ссылки на счета/конверты/категории/планы из аудита разрешать запросом с фильтром `budgetId`; warn-лог только с `auditEventId`; испорченный курсор (`null`) → 400; курсор не заменяет фильтр бюджета; проверять членство пользователя в сервисе. Minor (отложено): нет прямых тестов `TRANSACTION_UPDATED`/`RESTORED` и курсора-не-объекта.
- Task 3: complete, коммит `df44181`. Review: security, API, backend, QA, final — APPROVE. Проверки: unit api (371), интеграция (715, весь набор прогнан напрямую vitest на `harmofin_v22_test`, скрипт `pnpm test:integration` с reset заблокирован классификатором прав), `activity-feed` 10/10, `v2-openapi` 17/17, typecheck, eslint. Решения writer: `markSeen` приводит `seen_at` через `new Date()` (разрешено планом); в тесте счетам задан `startingBalance`; `cleanupUser` в `v2-openapi` удаляет отметки (иначе FK RESTRICT). Backend-reviewer не дочитал хвост диффа (фикстура, cleanupUser) — их проверил final. Minor (отложено): `unseenCount` в OpenAPI `number`, не `integer` (`activity-feed.dto.ts:426`); `membershipUsers`/`findPersonRefs` фильтруют по `workspaceId` (допустимо при одном бюджете на семью).
- PR 1 (задачи 1–3) готов к открытию; ждёт решения владельца.
- Task 4: complete, коммит `5664932`. Review: API, UI/UX, final — APPROVE; QA — BLOCK (тесты фраз только для 5 из 16 видов, `activityIcon` без теста), fix round 1 тем же writer, scoped re-review APPROVE. Проверки: vitest `useActivityFeed` + `components/activity` (48), web typecheck, eslint. Решения: в `MEMBER_REMOVED` имя исключённого без суффикса «(не в семье)» (по дизайну «исключён участник «Имя»»). Minor (отложено): строка RESTORED в тесте не проверяет тип операции.
- Task 5: complete, коммит `829b54d`. Review: UI/UX, QA, final — APPROVE. Проверки: vitest ListRow, activity/, FamilyActivityCard, pages/app/index (72), web typecheck, `pnpm --filter @harmofin/web lint` (0 ошибок, предупреждения есть и до задачи), prettier. Решения: свойство `interactive` (по дизайну), а не `static` из «Уточнений» плана; подпись карточки на токенах caption как у RecentOperations. Minor (отложено): литерал `0.875rem` в `ActivityRow.vue:90,118`; `ActivityRow.test.ts` не проверяет иконку; 2 предупреждения eslint в `ActivityRow.vue:69` (из кода плана, prettier принимает).
- Task 6: complete, коммит `90e60d0`. Review: security, QA, final — APPROVE; UI/UX — BLOCK (ошибка не видна при непустом списке, потеря фокуса, нет aria-live), fix round 1 тем же writer (+ защита от устаревших ответов, `aria-labelledby`, `position: relative` у ссылок меню), scoped re-review APPROVE. Проверки: vitest `activity.test.ts` + `components/app` (79), web typecheck, lint (0 ошибок), prettier. Решения writer: фокус после «Показать ещё» — первая новая кнопка → строка → контейнер (селектор плана ломался для строк без ссылки); бейдж в мобильном меню после mount (без hydration mismatch). Minor (отложено): `.activity-page__sr` absolute без relative-родителя (клипуется, не виден).
- Task 7: complete, коммит `bb8df87`. Review: QA, final — APPROVE (QA статически подтвердил, что у создателя ровно 2 события: `MEMBER_JOINED` и `CALENDAR_EVENT_CREATED`). Проверки: `pnpm format:check`, `pnpm lint` (0 ошибок), `activity.test.ts` (9), одиночный tsc спеки; после задачи 7 — весь `pnpm --filter @harmofin/web test` (1727), `pnpm typecheck`. Playwright локально не запускался, E2E проверит CI. Решения: на `/app` ожидание готовности — по видимости карточки (у дашборда нет `data-hydrated`); `data-hydrated` добавлен на корень `activity.vue` с тестом.
- PR 2 (задачи 4–7) готов к открытию; ждёт решения владельца.
