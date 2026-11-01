# Часовой пояс бюджета Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пользователь выбирает часовой пояс при регистрации (по умолчанию пояс браузера) и владелец может безопасно менять пояс бюджета в любой момент.

**Architecture:** Блокировка `hasConfirmedPlanHistory` заменяется точной проверкой «ни одна сохранённая серверная дата не окажется в будущем нового пояса». История не меняется. Timed-события календаря сдвигаются в выбранном режиме. Регистрация принимает необязательный `timezone`.

**Tech Stack:** NestJS/Fastify, Prisma, zod, Vitest, Nuxt 4/Vue 3.

**Spec:** [2026-11-01-budget-timezone-design.md](../specs/2026-11-01-budget-timezone-design.md) (вариант B, утверждён владельцем).

## Global Constraints

- Тексты UI и документации — по-русски; идентификаторы и API — по-английски.
- Не запускать `pnpm db:migrate:dev`, локальный Playwright; не создавать worktree; не менять `identity/logo_description.png`; не коммитить без одобрения владельца (шаги «Commit» выполняет основная сессия после ревью).
- Миграций схемы нет. Изменения `/api/v1` и `/api/v2` только аддитивные.
- Каждый запрос фильтрует `workspace_id`/`budget_id` в БД. Роль OWNER, идемпотентность и `lockBudget` сохраняются.
- Деньги не затрагиваются; история (`occurredOn`, `effectiveOn`, периоды) не переписывается.
- Перед визуальными изменениями web прочитать `docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md`.
- Проверки: только именованные (`pnpm --filter ... test`), падение несвязанного теста — репортить, не чинить.

## File Structure

- Create `apps/api/src/cycles/timezone-change.ts` — чистые функции сдвига инстантов; без Prisma.
- Create `apps/api/src/cycles/timezone-change.test.ts` — unit-тесты.
- Modify `apps/api/src/cycles/v2-budget-settings.schemas.ts`, `.dto.ts`, `.controller.ts`, `.repository.ts`, `.application.service.ts`.
- Modify `apps/api/test/v2-budget-settings.integration.test.ts`.
- Modify `apps/api/src/auth/auth.schemas.ts`, `auth.dto.ts`, `auth.application.service.ts`; `apps/api/src/family/personal-workspace.ts`; `apps/api/src/common/plan-model/new-budget-model.ts` (без изменений сигнатуры).
- Modify `apps/web/app/pages/register.vue`, `composables/useAuth.ts`, `pages/app/settings/general.vue`, `composables/useEnvelopePlanV2.ts`, `composables/useV2Error.ts`, `pages/app/help.vue` и их тесты.
- Modify `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md:1282`.

---

### Task 1: API — смена пояса без блокировки по истории

**Files:**
- Create: `apps/api/src/cycles/timezone-change.ts`, `apps/api/src/cycles/timezone-change.test.ts`
- Modify: `apps/api/src/cycles/v2-budget-settings.schemas.ts`, `v2-budget-settings.dto.ts`, `v2-budget-settings.controller.ts:77-93`, `v2-budget-settings.repository.ts`, `v2-budget-settings.application.service.ts`
- Test: `apps/api/test/v2-budget-settings.integration.test.ts`

**Interfaces:**
- Produces: `shiftWallClock(instant: Date, fromZone: string, toZone: string): Date`; схема поле `timedEvents?: 'KEEP_WALL_CLOCK' | 'KEEP_INSTANT'`; коды `409 TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS`, `422 TIMED_EVENTS_MODE_REQUIRED`; репозиторий `hasFactsAfter(tx, budgetId, date: string): Promise<boolean>`, `listTimedEvents(tx, workspaceId, budgetId)`, `updateEventInstants(tx, workspaceId, budgetId, id, startsAt, endsAt)`.
- Consumes: `localToUtc`, `utcToLocal` из `apps/api/src/calendar/zoned-time.ts`; `todayInTimezone` из `cycle-period.domain.ts`.

- [ ] **Step 1: Unit-тест сдвига**

`apps/api/src/cycles/timezone-change.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { shiftWallClock } from './timezone-change.js';

describe('shiftWallClock', () => {
  it('keeps wall-clock time when moving Moscow -> Yekaterinburg', () => {
    // 18:00 Moscow (UTC+3) = 15:00Z; 18:00 Yekaterinburg (UTC+5) = 13:00Z
    expect(
      shiftWallClock(new Date('2026-11-05T15:00:00Z'), 'Europe/Moscow', 'Asia/Yekaterinburg'),
    ).toEqual(new Date('2026-11-05T13:00:00Z'));
  });

  it('uses the offset on the event date (DST zone)', () => {
    // 10:00 Berlin in July (UTC+2) = 08:00Z -> 10:00 UTC
    expect(shiftWallClock(new Date('2026-07-01T08:00:00Z'), 'Europe/Berlin', 'UTC')).toEqual(
      new Date('2026-07-01T10:00:00Z'),
    );
  });

  it('is the identity for the same zone', () => {
    const instant = new Date('2026-11-05T15:00:00Z');
    expect(shiftWallClock(instant, 'Europe/Moscow', 'Europe/Moscow')).toEqual(instant);
  });
});
```

- [ ] **Step 2: Запустить, увидеть падение**

Run: `pnpm --filter @harmofin/api exec vitest run src/cycles/timezone-change.test.ts` (имя пакета проверить в `apps/api/package.json`)
Expected: FAIL, модуль не найден.

- [ ] **Step 3: Реализация сдвига**

`apps/api/src/cycles/timezone-change.ts`:

```ts
import { localToUtc, utcToLocal } from '../calendar/zoned-time.js';

/** Instant with the same wall-clock date/time in `toZone` as `instant` has in `fromZone`. */
export function shiftWallClock(instant: Date, fromZone: string, toZone: string): Date {
  const local = utcToLocal(instant, fromZone);
  return localToUtc(local.date, local.time, toZone);
}
```

- [ ] **Step 4: Тест проходит**

Run: та же команда. Expected: PASS. Если DST-кейс падает из-за округления секунд — события хранятся с точностью до минуты, поправить тест, не код.

- [ ] **Step 5: Схема и DTO**

В `v2-budget-settings.schemas.ts` добавить поле и поправить refine (`timedEvents` один не считается изменением):

```ts
    timedEvents: z.enum(['KEEP_WALL_CLOCK', 'KEEP_INSTANT']).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.allowNegativeAccountBalance !== undefined ||
      input.timezone !== undefined,
    { message: 'Необходимо передать хотя бы одно поле для изменения.' },
  );
```

В `V2BudgetSettingsRequest` (dto) заменить описание `timezone` и добавить:

```ts
  @ApiProperty({
    type: String,
    required: false,
    maxLength: 64,
    example: 'Asia/Yekaterinburg',
    description:
      'Часовой пояс IANA. Меняется в любое время; сохранённые даты не меняются. 409 TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS, если после смены какая-то дата факта окажется позже «сегодня» нового пояса.',
  })
  timezone?: string;

  @ApiProperty({
    type: String,
    enum: ['KEEP_WALL_CLOCK', 'KEEP_INSTANT'],
    required: false,
    description:
      'Только вместе с timezone. Как сдвинуть события календаря со временем: сохранить настенное время (KEEP_WALL_CLOCK) или момент (KEEP_INSTANT). Обязательно, если такие события есть, иначе 422 TIMED_EVENTS_MODE_REQUIRED.',
  })
  timedEvents?: 'KEEP_WALL_CLOCK' | 'KEEP_INSTANT';
```

Обновить `description`/`@ApiResponse` в контроллере: убрать `TIMEZONE_CHANGE_REQUIRES_RECONCILIATION`, перечислить `409 TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS|IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH`, `422 TIMED_EVENTS_MODE_REQUIRED`.

- [ ] **Step 6: Падающие интеграционные тесты**

В `v2-budget-settings.integration.test.ts` заменить тесты строк 309–345 (`подтверждённый факт блокирует`, `CONFIRMED цель блокирует`, `при заблокированной зоне имя меняется`) на:

```ts
  it('подтверждённый факт НЕ блокирует смену пояса на восток; история не меняется', async () => {
    const budgetId = user('fact').budgetId;
    const before = await prisma.transaction.findMany({ where: { budgetId, status: 'CONFIRMED' } });
    expect(before.length).toBeGreaterThan(0);
    const response = await patch('fact', { timezone: 'Asia/Tokyo' });
    expect(response.statusCode).toBe(200);
    expect(response.json<SettingsBody>().timezone).toBe('Asia/Tokyo');
    const after = await prisma.transaction.findMany({ where: { budgetId, status: 'CONFIRMED' } });
    expect(after.map((row) => row.occurredOn)).toEqual(before.map((row) => row.occurredOn));
  });

  it('CONFIRMED цель не блокирует смену пояса: периоды прежние', async () => {
    const budgetId = user('target').budgetId;
    const periods = await prisma.envelopePeriod.count({ where: { budgetId } });
    const response = await patch('target', { timezone: 'Asia/Tokyo' });
    expect(response.statusCode).toBe(200);
    expect(await prisma.envelopePeriod.count({ where: { budgetId, targetStatus: 'CONFIRMED' } })).toBeGreaterThan(0);
    expect(await prisma.envelopePeriod.count({ where: { budgetId } })).toBeLessThanOrEqual(periods);
  });

  it('штамп effectiveOn в будущем нового пояса блокирует смену: 409, ничего не меняется', async () => {
    const budgetId = user('fact').budgetId;
    const current = (await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })).timezone;
    // Целевая зона на запад, в которой «сегодня» заведомо раньше завтрашней даты штампа.
    const tomorrow = new Date(`${addIsoDays(todayInTimezone(new Date(), 'Pacific/Kiritimati'), 1)}T00:00:00.000Z`);
    const movement = await seedAssignmentStamp(budgetId, tomorrow); // helper: создаёт CONFIRMED assignment с effectiveOn=tomorrow
    const response = await patch('fact', { timezone: 'Pacific/Pago_Pago', name: 'Не должно' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS');
    const after = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } });
    expect(after.timezone).toBe(current);
    expect(after.name).not.toBe('Не должно');
    await prisma.envelopeAssignment.delete({ where: { id: movement } });
  });

  it('timed-события: без режима 422, KEEP_WALL_CLOCK сдвигает инстанты, KEEP_INSTANT нет', async () => {
    const budgetId = user('editor').budgetId;
    const event = await seedTimedEvent(budgetId, '2026-12-05T15:00:00.000Z'); // 18:00 Москва
    const missing = await patch('editor', { timezone: 'Asia/Yekaterinburg' });
    expect(missing.statusCode).toBe(422);
    expect(missing.json<{ code: string }>().code).toBe('TIMED_EVENTS_MODE_REQUIRED');

    const wall = await patch('editor', { timezone: 'Asia/Yekaterinburg', timedEvents: 'KEEP_WALL_CLOCK' });
    expect(wall.statusCode).toBe(200);
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event } })).startsAt?.toISOString())
      .toBe('2026-12-05T13:00:00.000Z');

    const instant = await patch('editor', { timezone: 'UTC', timedEvents: 'KEEP_INSTANT' });
    expect(instant.statusCode).toBe(200);
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event } })).startsAt?.toISOString())
      .toBe('2026-12-05T13:00:00.000Z');
  });

  it('аудит смены пояса содержит старый и новый пояс', async () => {
    const budgetId = user('owner').budgetId;
    await patch('owner', { timezone: 'Europe/Berlin' });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { budgetId, entityType: 'budget', action: 'UPDATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit.newValues)).toContain('Europe/Berlin');
  });
```

Хелперы `seedAssignmentStamp` и `seedTimedEvent` написать в этом же файле по образцу существующих сидеров (поля обязательных колонок взять из `prisma/schema.prisma` моделей `EnvelopeAssignment`/`CalendarEvent`; событие — `allDay:false`, `startsAt`, `endsAt = startsAt + 1h`, `createdByUserId` = owner этого бюджета). Убрать из списка `names` неиспользуемые теперь роли только если они действительно не нужны другим тестам.

- [ ] **Step 7: Запустить, увидеть падение**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/v2-budget-settings.integration.test.ts` (точную команду взять из `apps/api/package.json`, `test:integration`; БД `pnpm infra:up` уже запущена владельцем).
Expected: новые тесты FAIL (старое 409 на историю).

- [ ] **Step 8: Репозиторий**

В `V2BudgetSettingsRepository` добавить:

```ts
  /** True when a server-stamped or confirmed fact date lies after `date` (ISO YYYY-MM-DD). */
  async hasFactsAfter(tx: Prisma.TransactionClient, budgetId: string, date: string): Promise<boolean> {
    const limit = new Date(`${date}T00:00:00.000Z`);
    const [transactions, assignments, movements, budget] = await Promise.all([
      tx.transaction.count({ where: { budgetId, status: 'CONFIRMED', occurredOn: { gt: limit } }, take: 1 }),
      tx.envelopeAssignment.count({ where: { budgetId, status: 'CONFIRMED', effectiveOn: { gt: limit } }, take: 1 }),
      tx.envelopeMovement.count({ where: { budgetId, status: 'CONFIRMED', effectiveOn: { gt: limit } }, take: 1 }),
      tx.budget.count({ where: { id: budgetId, planModelActivatedOn: { gt: limit } } }),
    ]);
    return transactions + assignments + movements + budget > 0;
  }

  async listTimedEvents(tx: Prisma.TransactionClient, workspaceId: string, budgetId: string) {
    return tx.calendarEvent.findMany({
      where: { workspaceId, budgetId, deletedAt: null, allDay: false, startsAt: { not: null } },
      select: { id: true, startsAt: true, endsAt: true },
    });
  }

  async updateEventInstants(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    budgetId: string,
    id: string,
    startsAt: Date,
    endsAt: Date | null,
  ): Promise<void> {
    await tx.calendarEvent.updateMany({ where: { id, workspaceId, budgetId }, data: { startsAt, endsAt } });
  }
```

Перед использованием проверить в `schema.prisma`, что `EnvelopeLedgerStatus` содержит `CONFIRMED` (уже подтверждено) и что `Transaction.status` — enum с `CONFIRMED`.

- [ ] **Step 9: Сервис**

В `v2-budget-settings.application.service.ts`: удалить `reconciliationRequired`, импорт `hasConfirmedPlanHistory`; добавить импорты `UnprocessableEntityException`, `todayInTimezone` (`../cycles/cycle-period.domain.js`), `shiftWallClock`. Включить `timedEvents` в `requestHash`. Заменить блок `if (timezoneChanges) {...}`:

```ts
          let shiftedEvents = 0;
          if (timezoneChanges && input.timezone) {
            const newToday = todayInTimezone(new Date(), input.timezone);
            if (await this.repository.hasFactsAfter(tx, budgetId, newToday)) {
              throw new ConflictException({
                code: 'TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS',
                detail:
                  'Часовой пояс сейчас менять нельзя: часть записей оказалась бы датирована «завтра» по новому поясу. Повторите после полуночи по новому поясу.',
              });
            }
            const events = await this.repository.listTimedEvents(tx, workspaceId, budgetId);
            if (events.length > 0 && !input.timedEvents) {
              throw new UnprocessableEntityException({
                code: 'TIMED_EVENTS_MODE_REQUIRED',
                detail: 'Выберите, как сдвинуть события календаря со временем при смене пояса.',
              });
            }
            if (input.timedEvents === 'KEEP_WALL_CLOCK') {
              for (const event of events) {
                if (!event.startsAt) continue;
                await this.repository.updateEventInstants(
                  tx, workspaceId, budgetId, event.id,
                  shiftWallClock(event.startsAt, before.timezone, input.timezone),
                  event.endsAt ? shiftWallClock(event.endsAt, before.timezone, input.timezone) : null,
                );
                shiftedEvents += 1;
              }
            }
            await resetUnconfirmedPeriods(tx, budgetId);
          }
```

Передать в `createAudit` `newValues: { ...pick(after), ...(timezoneChanges ? { timedEvents: input.timedEvents ?? null, shiftedEvents } : {}) }`. Обновить docstring класса (timezone меняется всегда, кроме запрета будущих дат).

- [ ] **Step 10: Тесты проходят**

Run: интеграционный файл из Step 7 и unit из Step 4; затем `pnpm --filter @harmofin/api typecheck` и `pnpm --filter @harmofin/api lint`.
Expected: PASS. Старые тесты других файлов, ссылающиеся на `TIMEZONE_CHANGE_REQUIRES_RECONCILIATION`, нет (grep подтверждён: только этот файл).

- [ ] **Step 11: Commit** (основная сессия, после QA/Financial-lite/Security/API/final review)

```bash
git add apps/api/src/cycles apps/api/test/v2-budget-settings.integration.test.ts
git commit -m "feat(api): смена часового пояса бюджета без блокировки по истории"
```

---

### Task 2: API — часовой пояс при регистрации

**Files:**
- Modify: `apps/api/src/auth/auth.schemas.ts`, `auth.dto.ts`, `auth.application.service.ts:~97`, `apps/api/src/family/personal-workspace.ts`
- Test: `apps/api/test/v2-new-budget.integration.test.ts` (или файл регистрации; найти `grep -ln "auth/register" apps/api/test`)

**Interfaces:**
- Produces: `RegisterInput.timezone?: string`; `createPersonalWorkspace(tx, userId, now, requestId?, names: { workspaceName; budgetName; timezone?: string })`.
- Consumes: `newBudgetModelData(now, timezone)` (уже принимает пояс).

- [ ] **Step 1: Падающий тест**

Регистрация с `timezone: 'Asia/Yekaterinburg'` → `Budget.timezone` и `Workspace.timezone` равны ему, `planModelActivatedOn` равен `todayInTimezone(now, 'Asia/Yekaterinburg')`. Без поля → `Europe/Moscow`. `timezone: 'Mars/Phobos'` → 400 `VALIDATION_FAILED`. Использовать существующий хелпер регистрации того же файла.

- [ ] **Step 2: Запустить, увидеть падение** (`.strict()` схема отклоняет неизвестное поле).

- [ ] **Step 3: Реализация**

`auth.schemas.ts`: экспортировать `isValidTimezone` из `v2-budget-settings.schemas.ts`? Не импортировать между модулями — вынести в `apps/api/src/common/timezone.ts`:

```ts
export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
```

Подключить в обеих схемах (удалив локальную копию), в `registerSchema`:

```ts
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isValidTimezone, { message: 'Укажите корректный часовой пояс IANA.' })
      .optional(),
```

`auth.dto.ts` — `@ApiPropertyOptional({ type: String, example: 'Asia/Yekaterinburg', maxLength: 64, description: 'Часовой пояс IANA; по умолчанию Europe/Moscow. Игнорируется при регистрации по приглашению.' }) timezone?: string;`

`personal-workspace.ts`: параметр `names` расширить `timezone?: string`; `const timezone = names.timezone ?? NEW_BUDGET_TIMEZONE`; `tx.workspace.create({ data: { ..., timezone } })`; `tx.budget.create({ data: { ..., timezone, ...newBudgetModelData(now, timezone) } })`. В `auth.application.service.ts` передать `timezone: input.timezone` в ветке личного пространства (ветка приглашения не меняется).

- [ ] **Step 4: Тест проходит**, плюс `pnpm --filter @harmofin/api typecheck`, OpenAPI-тест (`v2-openapi.integration.test.ts`) без падений.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/src/family apps/api/src/common apps/api/src/cycles/v2-budget-settings.schemas.ts apps/api/test
git commit -m "feat(api): часовой пояс при регистрации"
```

---

### Task 3: Web — выбор пояса при регистрации

**Files:**
- Modify: `apps/web/app/pages/register.vue`, `apps/web/app/composables/useAuth.ts:49`
- Test: `apps/web/app/pages/register.test.ts`

**Interfaces:**
- Consumes: `POST /api/v1/auth/register` с `timezone`.
- Produces: `browserTimezone(): string | null` в `apps/web/app/composables/browserTimezone.ts`, используется Task 4.

Перед правками прочитать Calm Fintech guidelines.

- [ ] **Step 1: Тест `browserTimezone`** (`browserTimezone.test.ts`): возвращает `Intl.DateTimeFormat().resolvedOptions().timeZone`, если он в `Intl.supportedValuesOf('timeZone')`; иначе `null` (мок `Intl`).

- [ ] **Step 2: Реализация**

```ts
export function browserTimezone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone) return null;
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return supported.includes(zone) ? zone : null;
}
```

- [ ] **Step 3: Тест страницы** — поле «Часовой пояс» (`name="timezone"`) предзаполнено поясом браузера (мок), по умолчанию `Europe/Moscow`; `register` вызван с выбранным `timezone`; в режиме приглашения (`invitationToken`) поле скрыто и `timezone` не отправляется.

- [ ] **Step 4: Реализация страницы**: `const timezone = ref(browserTimezone() ?? 'Europe/Moscow')` (инициализировать в `onMounted`, чтобы SSR не расходился с клиентом); `UiSelect` с `searchable`, label «Часовой пояс», tooltip «Нужен для писем и напоминаний. Позже его можно изменить в настройках.», опции как в `general.vue` (`Intl.supportedValuesOf`), `v-if="!invitationToken"`; в `register({...})` добавить `timezone: timezone.value` только в ветке без приглашения. В `useAuth.register` тип `input` дополнить `timezone?: string`.

- [ ] **Step 5: Тесты проходят**: `pnpm --filter @harmofin/web exec vitest run app/pages/register.test.ts app/composables/browserTimezone.test.ts`, `typecheck`, `lint`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): выбор часового пояса при регистрации"
```

---

### Task 4: Web — смена пояса в настройках и подсказка

**Files:**
- Modify: `apps/web/app/pages/app/settings/general.vue`, `apps/web/app/composables/useEnvelopePlanV2.ts:1022`, `apps/web/app/composables/useV2Error.ts:34`, `apps/web/app/pages/app/help.vue:82-89`
- Test: `settings/general.test.ts`, `useV2Error.test.ts`, `help.test.ts`

**Interfaces:**
- Consumes: `browserTimezone()` (Task 3); API поле `timedEvents`, коды `TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS`, `TIMED_EVENTS_MODE_REQUIRED`.

- [ ] **Step 1: Тип запроса**: в `BudgetSettingsV2Request` добавить `timedEvents?: 'KEEP_WALL_CLOCK' | 'KEEP_INSTANT';`.

- [ ] **Step 2: Тексты ошибок** в `useV2Error.ts` вместо `TIMEZONE_CHANGE_REQUIRES_RECONCILIATION`:

```ts
  TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS:
    'Часовой пояс сейчас менять нельзя: часть записей оказалась бы датирована «завтра». Повторите после полуночи по новому поясу.',
  TIMED_EVENTS_MODE_REQUIRED: 'Выберите, как сдвинуть события календаря со временем.',
```

Обновить `useV2Error.test.ts` (если ссылается на старый код).

- [ ] **Step 3: Падающие тесты `general.test.ts`**: заменить тест «explains the timezone restriction…» на проверку текста нового кода и `aria-invalid` у `timezone`; добавить: при изменении пояса виден `fieldset` «События календаря со временем» с радио «Сохранить время на часах (рекомендуется)» (выбрано по умолчанию) и «Сохранить момент»; сохранение шлёт `{ timezone: 'Asia/Tokyo', timedEvents: 'KEEP_WALL_CLOCK' }`; без изменения пояса `timedEvents` не шлётся и fieldset скрыт; если пояс браузера (мок `browserTimezone`) отличается от пояса бюджета и пользователь `canManage`, показан блок «Ваш браузер в {зона}. Использовать этот пояс?» с кнопкой, которая подставляет зону в форму; при совпадении блока нет.

- [ ] **Step 4: Реализация `general.vue`**:
  - `const timedEvents = ref<'KEEP_WALL_CLOCK' | 'KEEP_INSTANT'>('KEEP_WALL_CLOCK')`; в `settingsPatch()` при `form.timezone !== current.timezone` добавить `patch.timedEvents = timedEvents.value`, расширить тип `patch`; в `saveSettingsV2` при `attemptKey` fingerprint уже включает patch.
  - В `applyV2Error` расширить условие: коды `TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS` и `TIMED_EVENTS_MODE_REQUIRED` кладут сообщение в `fieldErrors.timezone`.
  - Разметка под `UiSelect` часового пояса: `<fieldset v-if="form.timezone !== budget?.timezone">` с легендой «События календаря со временем» и двумя `<label><input type="radio" …></label>`; пояснение «Прошлые операции и даты не изменятся. Письма и напоминания будут приходить по новому времени.» Статус не только цветом (текст), видимый фокус из существующих стилей форм.
  - Подсказка: `const hintZone = computed(() => { const zone = browserTimezone(); return canManage.value && zone && budget.value && zone !== budget.value.timezone ? zone : null; })`; блок с текстом «Ваш браузер в {{ hintZone }}.» и `UiButton` «Использовать этот пояс» (`@click="form.timezone = hintZone"`), расположить под полем пояса, стиль — нейтральная карточка/подсказка по Calm Fintech.
  - Обновить tooltip пояса: «…Прошлые записи не меняются».

- [ ] **Step 5: Справка**: заменить блок `<details>` «Почему не меняется часовой пояс?» на «Как изменить часовой пояс?» с текстом: «Владелец бюджета меняет пояс в Настройках → Общие в любое время. Прошлые операции и даты не меняются; письма и напоминания переходят на новое время. Если часть записей оказалась бы датирована «завтра» (при переносе на запад), сервер попросит повторить после полуночи по новому поясу.» В `help.test.ts:39` заменить ожидание на `'Как изменить часовой пояс?'`.

- [ ] **Step 6: Тесты проходят**: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/general.test.ts app/pages/app/help.test.ts app/composables/useV2Error.test.ts`, `typecheck`, `lint`, `format:check`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): смена часового пояса и подсказка в настройках"
```

---

### Task 5: Документация

**Files:**
- Modify: `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md:1282`, при необходимости `docs/superpowers/plans/2026-09-29-envelope-v2.2-00-roadmap.md:21` (пометить исторический запрет заменённым этим планом)

- [ ] **Step 1**: заменить в функциональной спецификации строку «часовой пояс бюджета задается явно, по умолчанию `Europe/Moscow`» на «часовой пояс бюджета задаётся при регистрации (по умолчанию предлагается пояс браузера, иначе `Europe/Moscow`) и может быть изменён владельцем; сохранённые календарные даты не меняются».
- [ ] **Step 2**: в roadmap добавить примечание «Заменено: [дизайн смены пояса](../specs/2026-11-01-budget-timezone-design.md)».
- [ ] **Step 3**: `pnpm format:check` по изменённым файлам.
- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: часовой пояс бюджета выбирается и меняется владельцем"
```

---

## Ревью по матрице (CLAUDE.md)

Task 1: Security (доступ OWNER, изоляция по `budgetId`), API (OpenAPI/DTO), Financial-lite (история не меняется; решение владельца: полный Financial-review не требуется, денежных мутаций нет, но проверить, что `hasFactsAfter` покрывает все серверные штампы), QA, final. Task 2: Security, API, QA, final. Tasks 3–4: UI/UX, QA, final. Playwright — только CI.

## Self-Review

- Покрытие спека: §4 B (guard, режимы событий, аудит, идемпотентность) — Task 1; §5 регистрация — Task 2–3; подсказка браузера — Task 4; §6 документация — Tasks 4–5; §8 тесты — в каждой задаче.
- Решение §7 про `Workspace.timezone`: Task 2 записывает его при создании, Task 1 PATCH его по-прежнему не меняет (поле читается только для DTO и fallback при удалении аккаунта). Если ревью потребует синхронизации, добавить `tx.workspace.updateMany` в `V2BudgetSettingsRepository.update` отдельной правкой.
- Имена согласованы: `timedEvents`, `shiftWallClock`, `hasFactsAfter`, `browserTimezone`.
