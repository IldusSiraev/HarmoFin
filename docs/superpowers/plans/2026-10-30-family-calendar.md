# Семейный календарь — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Календарь семьи в HarmoFin: события с повторениями, участниками и напоминаниями внутри приложения, лента «события + платежи из планов» с видами «Месяц» и «Повестка».

**Architecture:** События — таблица бюджета `calendar_events` (+ участники), вхождения не хранятся: чистая функция `expandOccurrences` разворачивает правило по диапазону в локальном времени бюджета. Функция есть в api и worker в двух копиях, их сверяет общий эталон `fixtures/calendar-recurrence/cases.json`. API — модуль `apps/api/src/calendar` по образцу этапа B (`BudgetAccessPolicy`, idempotency, audit); платежи в ленте берутся из `PlansCalendarApplicationService`. Напоминания — новая задача worker `EVALUATE_CALENDAR_REMINDERS` раз в 5 минут, уведомление `CALENDAR_REMINDER`. Веб — страница `/app/calendar` из существующих UI-компонентов.

**Tech Stack:** TypeScript strict, NestJS 11 + Fastify, Prisma 6 + PostgreSQL 18, zod 4, Vitest 4, Nuxt 4 / Vue 3.5, `@lucide/vue`, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-30-family-calendar-design.md](../specs/2026-10-30-family-calendar-design.md) — читать целиком перед первой задачей. При расхождении плана и спецификации прав дизайн; расхождение сообщить координатору.

## Как выполнять этот план (для другой сессии)

- Ветка `feat/family-calendar` (уже создана, на ней закоммичены дизайн и этот план). Перед каждым коммитом проверять `git branch --show-current`.
- Работа делится на 4 PR (раздел «Поставка» дизайна). Задачи 1–3 — PR 1, задачи 4–6 — PR 2, задача 7 — PR 3, задачи 8–13 — PR 4. После последней задачи PR координатор останавливается и спрашивает владельца, открывать ли PR. Следующий PR начинается от свежего `main` после мержа предыдущего (новая ветка `feat/family-calendar-api`, `feat/family-calendar-reminders`, `feat/family-calendar-web`), без worktree.
- Subagent-driven development: один writer на задачу; writer только индексирует изменения (`git add <пути>`), коммит делает координирующая сессия после review по таблице в конце плана. Если review вернул `BLOCK` — исправляет тот же writer, review повторяется.
- Ход выполнения вести в этом файле: в конце — раздел «Ход выполнения» (задача, коммит, review, решения). Это единственный источник состояния для следующей сессии.

## Global Constraints

- Роли: `OWNER` («Создатель»), `EDITOR` («Участник»), `VIEWER` («Наблюдатель»). Writer — `OWNER` или `EDITOR`. Изменять и удалять событие может только его автор (`createdByUserId`), у создателя семьи нет прав на чужие события.
- Новые коды: 403 `NOT_EVENT_AUTHOR` (`detail`: «Изменять событие может только его автор.»), 422 `PARTICIPANT_NOT_MEMBER` (`detail`: «Участником события может быть только член семьи.»). Остальные — существующие: 400 `VALIDATION_FAILED` с `fieldErrors`, 403 `FORBIDDEN`, 404 `RESOURCE_NOT_FOUND`, 409 `IDEMPOTENCY_CONFLICT`, 409 `MODEL_VERSION_MISMATCH`.
- Каждый запрос к данным фильтрует `budgetId` в самом запросе. Участник и роль читаются внутри транзакции мутации после `lockBudget`: `planModelPolicy.requireModel` → `lockBudget` → idempotency → `requireAccessActor` → загрузка события (`budgetId`, `deletedAt: null`) → `requireEventAuthor` → валидация → запись → `AuditEvent`.
- Только аддитивные изменения API `/api/v2` и OpenAPI; каждый эндпоинт, поле и код ошибки описаны.
- Миграция только аддитивная, бэкфилла нет. Никогда не запускать `pnpm db:migrate:dev`, reset или откат на данных владельца (`harmofin`).
- Денег календарь не считает: суммы платежей — строки minor units с сервера (`PlansCalendarApplicationService`), клиент их только форматирует.
- Время событий — в часовом поясе бюджета (`Budget.timezone`); клиент получает локальные `startTime`/`endTime` строками и не пересчитывает пояса.
- Диапазон ленты — не больше 62 дней. `reminderMinutes` ∈ {15, 60, 1440, 10080} или `null`. `interval` 1–99. `weekdays` — ISO 1–7.
- UI-тексты на русском, идентификаторы на английском. Calm Fintech: icon-only действия строки с `aria-label`, `UiModal` вместо панелей, статус — иконка и текст, только `@lucide/vue`, Inter, без новых цветов.
- Подписи людей — через `authorLabel` (`apps/web/app/components/operations/author-label.ts`): «Алия», «Алия (не в семье)».
- Local Playwright не запускать (только CI). Не создавать worktree. Не трогать `identity/logo_description.png`. Субагенты не запускают `pnpm infra:down` и не трогают dev-процессы владельца.
- Интеграционные тесты: весь набор — только `pnpm test:integration` (одноразовая БД `harmofin_v22_test`); один файл — `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts <файл>`. Перед первым запуском одного файла после новой миграции один раз прогнать `pnpm test:integration` — он применяет миграции к одноразовой БД.
- `pnpm db:generate` может падать с EPERM, пока у владельца запущены dev-процессы (Windows держит движок Prisma). Процессы не трогать — сообщить координатору.
- `openapi.json` обновлять командой `node scripts/openapi/generate.mjs` после изменений контроллеров и DTO; затем `pnpm exec prettier --write openapi.json`.

## Карта файлов

| Файл | Ответственность | Задача |
|---|---|---|
| `fixtures/calendar-recurrence/cases.json` | эталонные случаи разворачивания | 1 |
| `apps/api/src/calendar/zoned-time.ts` (+test) | перевод локальных даты/времени ↔ UTC через `Intl` | 1 |
| `apps/api/src/calendar/calendar-recurrence.ts` (+test) | `expandOccurrences`, `RecurringEvent`, `Occurrence` | 1 |
| `apps/worker/src/zoned-time.ts`, `apps/worker/src/calendar-recurrence.ts` (+test) | копия для worker, сверка по эталону | 2 |
| `prisma/schema.prisma`, `prisma/migrations/20261030000000_family_calendar/migration.sql` | таблицы, enum-значения, ограничения | 3 |
| `apps/api/test/calendar-schema.integration.test.ts` | ограничения БД | 3 |
| `apps/api/src/common/policies/budget-access.policy.ts`, `access.errors.ts` | `requireEventAuthor`, `notEventAuthor` | 4 |
| `apps/api/src/calendar/calendar.schemas.ts` (+test) | zod-схемы тела и query | 4 |
| `apps/api/src/calendar/calendar-event.mapper.ts` (+test) | тело → строка БД, строка → `RecurringEvent`, вид для ответа | 4 |
| `apps/api/src/calendar/calendar.repository.ts` | запросы Prisma | 5 |
| `apps/api/src/calendar/calendar.application.service.ts` | CRUD, доступ, audit | 5 |
| `apps/api/src/calendar/calendar.dto.ts`, `calendar.controller.ts`, `calendar.module.ts`, `apps/api/src/app.module.ts` | HTTP и OpenAPI | 5, 6 |
| `apps/api/test/calendar-events.integration.test.ts` | доступ, валидация, idempotency, audit | 5 |
| `apps/api/src/calendar/calendar-feed.ts` (+test) | сборка и порядок ленты | 6 |
| `apps/api/test/calendar-feed.integration.test.ts` | лента | 6 |
| `apps/worker/src/calendar-reminder.ts` (+test), `calendar-reminder.handler.ts` (+test), `job.repository.ts`, `job-runner.ts`, `main.ts` | напоминания | 7 |
| `apps/web/app/composables/useFamilyCalendar.ts` (+test), `useBudgetReferenceData.ts` | клиент API и типы | 8 |
| `apps/web/app/components/calendar/calendar-dates.ts` (+test) | сетка месяца, диапазоны, подписи дат | 9 |
| `apps/web/app/components/calendar/participants-label.ts` (+test) | «Алия, Ильдар», «Вся семья» | 9 |
| `apps/web/app/components/calendar/CalendarHeader.vue`, `CalendarMonthGrid.vue`, `CalendarDayDialog.vue` (+tests) | месяц и панель дня | 10 |
| `apps/web/app/components/calendar/CalendarAgenda.vue` (+test) | повестка | 10 |
| `apps/web/app/components/calendar/calendar-event-form.ts` (+test), `CalendarEventForm.vue` (+test) | форма события | 11 |
| `apps/web/app/components/calendar/CalendarEventDialog.vue`, `CalendarPlanDialog.vue` (+tests) | карточки события и платежа | 11 |
| `apps/web/app/pages/app/calendar.vue` (+test) | страница, загрузка, состояние | 12 |
| `AppSidebar.vue`, `AppMobileMenu.vue`, `NotificationCard.vue` (+tests) | навигация, уведомление | 12 |
| `e2e/family-calendar.spec.ts`, функциональная спецификация, `README.md` | e2e и документация | 13 |

---

## PR 1 — данные и повторения

### Task 1: Эталон повторений и `expandOccurrences` в api

**Files:**
- Create: `fixtures/calendar-recurrence/cases.json`
- Create: `apps/api/src/calendar/zoned-time.ts`, `apps/api/src/calendar/zoned-time.test.ts`
- Create: `apps/api/src/calendar/calendar-recurrence.ts`, `apps/api/src/calendar/calendar-recurrence.test.ts`

**Interfaces:**
- Produces:
  - `localToUtc(date: string, time: string, timezone: string): Date` — `date` `YYYY-MM-DD`, `time` `HH:MM`, локальное время пояса → момент UTC. Несуществующее локальное время (весенний переход) сдвигается вперёд на величину перехода; неоднозначное (осенний) — берётся первое вхождение (летнее смещение).
  - `utcToLocal(instant: Date, timezone: string): { date: string; time: string }`
  - `type CalendarRecurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'`
  - `interface RecurringEvent { allDay: boolean; startDate: string; endDate: string; startTime: string | null; durationMinutes: number; recurrence: CalendarRecurrence; interval: number; weekdays: number[]; repeatUntil: string | null }` — `endDate` у события со временем — локальная дата конца первого вхождения; у «весь день» — последняя дата.
  - `interface Occurrence { occurrenceDate: string; startDate: string; endDate: string; startsAt: string | null; endsAt: string | null; startTime: string | null; endTime: string | null }` — `startsAt`/`endsAt` ISO-строки UTC (`toISOString()`), у «весь день» `null`.
  - `expandOccurrences(event: RecurringEvent, window: { from: string; to: string }, timezone: string): Occurrence[]` — отсортировано по `occurrenceDate`, затем `startsAt`.
  - `addDays(date: string, days: number): string`, `isoWeekday(date: string): number` (1 = пн … 7 = вс).

- [ ] **Step 1: Эталонные случаи**

Создать `fixtures/calendar-recurrence/cases.json`. Даты проверены: 01.10.2026 — четверг; в Берлине летнее время до 25.10.2026 03:00 (+2 → +1); в Нью-Йорке до 01.11.2026 02:00 (−4 → −5); в Москве переходов нет (+3).

```json
{
  "cases": [
    {
      "name": "одно событие со временем в окне",
      "timezone": "Europe/Moscow",
      "event": { "allDay": false, "startDate": "2026-11-03", "endDate": "2026-11-03", "startTime": "17:00", "durationMinutes": 90, "recurrence": "NONE", "interval": 1, "weekdays": [], "repeatUntil": null },
      "window": { "from": "2026-11-01", "to": "2026-11-30" },
      "expected": [
        { "occurrenceDate": "2026-11-03", "startDate": "2026-11-03", "endDate": "2026-11-03", "startsAt": "2026-11-03T14:00:00.000Z", "endsAt": "2026-11-03T15:30:00.000Z", "startTime": "17:00", "endTime": "18:30" }
      ]
    },
    {
      "name": "одно событие вне окна",
      "timezone": "Europe/Moscow",
      "event": { "allDay": false, "startDate": "2026-12-03", "endDate": "2026-12-03", "startTime": "17:00", "durationMinutes": 90, "recurrence": "NONE", "interval": 1, "weekdays": [], "repeatUntil": null },
      "window": { "from": "2026-11-01", "to": "2026-11-30" },
      "expected": []
    },
    {
      "name": "каждый вторник до даты окончания",
      "timezone": "Europe/Moscow",
      "event": { "allDay": false, "startDate": "2026-10-06", "endDate": "2026-10-06", "startTime": "17:00", "durationMinutes": 90, "recurrence": "WEEKLY", "interval": 1, "weekdays": [2], "repeatUntil": "2026-11-03" },
      "window": { "from": "2026-10-20", "to": "2026-11-10" },
      "expected": [
        { "occurrenceDate": "2026-10-20", "startDate": "2026-10-20", "endDate": "2026-10-20", "startsAt": "2026-10-20T14:00:00.000Z", "endsAt": "2026-10-20T15:30:00.000Z", "startTime": "17:00", "endTime": "18:30" },
        { "occurrenceDate": "2026-10-27", "startDate": "2026-10-27", "endDate": "2026-10-27", "startsAt": "2026-10-27T14:00:00.000Z", "endsAt": "2026-10-27T15:30:00.000Z", "startTime": "17:00", "endTime": "18:30" },
        { "occurrenceDate": "2026-11-03", "startDate": "2026-11-03", "endDate": "2026-11-03", "startsAt": "2026-11-03T14:00:00.000Z", "endsAt": "2026-11-03T15:30:00.000Z", "startTime": "17:00", "endTime": "18:30" }
      ]
    },
    {
      "name": "еженедельно через переход на зимнее время в Берлине",
      "timezone": "Europe/Berlin",
      "event": { "allDay": false, "startDate": "2026-10-20", "endDate": "2026-10-20", "startTime": "17:00", "durationMinutes": 60, "recurrence": "WEEKLY", "interval": 1, "weekdays": [2], "repeatUntil": null },
      "window": { "from": "2026-10-19", "to": "2026-10-31" },
      "expected": [
        { "occurrenceDate": "2026-10-20", "startDate": "2026-10-20", "endDate": "2026-10-20", "startsAt": "2026-10-20T15:00:00.000Z", "endsAt": "2026-10-20T16:00:00.000Z", "startTime": "17:00", "endTime": "18:00" },
        { "occurrenceDate": "2026-10-27", "startDate": "2026-10-27", "endDate": "2026-10-27", "startsAt": "2026-10-27T16:00:00.000Z", "endsAt": "2026-10-27T17:00:00.000Z", "startTime": "17:00", "endTime": "18:00" }
      ]
    },
    {
      "name": "раз в две недели по пн и ср, весь день",
      "timezone": "Europe/Moscow",
      "event": { "allDay": true, "startDate": "2026-10-07", "endDate": "2026-10-07", "startTime": null, "durationMinutes": 0, "recurrence": "WEEKLY", "interval": 2, "weekdays": [1, 3], "repeatUntil": null },
      "window": { "from": "2026-10-01", "to": "2026-10-25" },
      "expected": [
        { "occurrenceDate": "2026-10-07", "startDate": "2026-10-07", "endDate": "2026-10-07", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null },
        { "occurrenceDate": "2026-10-19", "startDate": "2026-10-19", "endDate": "2026-10-19", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null },
        { "occurrenceDate": "2026-10-21", "startDate": "2026-10-21", "endDate": "2026-10-21", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null }
      ]
    },
    {
      "name": "ежемесячно 31-го — последний день короткого месяца",
      "timezone": "Europe/Moscow",
      "event": { "allDay": true, "startDate": "2026-01-31", "endDate": "2026-01-31", "startTime": null, "durationMinutes": 0, "recurrence": "MONTHLY", "interval": 1, "weekdays": [], "repeatUntil": null },
      "window": { "from": "2026-02-01", "to": "2026-04-30" },
      "expected": [
        { "occurrenceDate": "2026-02-28", "startDate": "2026-02-28", "endDate": "2026-02-28", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null },
        { "occurrenceDate": "2026-03-31", "startDate": "2026-03-31", "endDate": "2026-03-31", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null },
        { "occurrenceDate": "2026-04-30", "startDate": "2026-04-30", "endDate": "2026-04-30", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null }
      ]
    },
    {
      "name": "ежегодно 29 февраля — 28 февраля в невисокосный год",
      "timezone": "Europe/Moscow",
      "event": { "allDay": true, "startDate": "2024-02-29", "endDate": "2024-02-29", "startTime": null, "durationMinutes": 0, "recurrence": "YEARLY", "interval": 1, "weekdays": [], "repeatUntil": null },
      "window": { "from": "2026-01-01", "to": "2026-03-01" },
      "expected": [
        { "occurrenceDate": "2026-02-28", "startDate": "2026-02-28", "endDate": "2026-02-28", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null }
      ]
    },
    {
      "name": "каждые три дня со временем",
      "timezone": "Europe/Moscow",
      "event": { "allDay": false, "startDate": "2026-11-01", "endDate": "2026-11-01", "startTime": "09:30", "durationMinutes": 30, "recurrence": "DAILY", "interval": 3, "weekdays": [], "repeatUntil": null },
      "window": { "from": "2026-11-05", "to": "2026-11-12" },
      "expected": [
        { "occurrenceDate": "2026-11-07", "startDate": "2026-11-07", "endDate": "2026-11-07", "startsAt": "2026-11-07T06:30:00.000Z", "endsAt": "2026-11-07T07:00:00.000Z", "startTime": "09:30", "endTime": "10:00" },
        { "occurrenceDate": "2026-11-10", "startDate": "2026-11-10", "endDate": "2026-11-10", "startsAt": "2026-11-10T06:30:00.000Z", "endsAt": "2026-11-10T07:00:00.000Z", "startTime": "09:30", "endTime": "10:00" }
      ]
    },
    {
      "name": "многодневное событие, начатое до окна",
      "timezone": "Europe/Moscow",
      "event": { "allDay": true, "startDate": "2026-10-30", "endDate": "2026-11-02", "startTime": null, "durationMinutes": 0, "recurrence": "NONE", "interval": 1, "weekdays": [], "repeatUntil": null },
      "window": { "from": "2026-11-01", "to": "2026-11-30" },
      "expected": [
        { "occurrenceDate": "2026-10-30", "startDate": "2026-10-30", "endDate": "2026-11-02", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null }
      ]
    },
    {
      "name": "ежедневно до даты окончания включительно",
      "timezone": "Europe/Moscow",
      "event": { "allDay": true, "startDate": "2026-11-01", "endDate": "2026-11-01", "startTime": null, "durationMinutes": 0, "recurrence": "DAILY", "interval": 1, "weekdays": [], "repeatUntil": "2026-11-03" },
      "window": { "from": "2026-11-01", "to": "2026-11-10" },
      "expected": [
        { "occurrenceDate": "2026-11-01", "startDate": "2026-11-01", "endDate": "2026-11-01", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null },
        { "occurrenceDate": "2026-11-02", "startDate": "2026-11-02", "endDate": "2026-11-02", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null },
        { "occurrenceDate": "2026-11-03", "startDate": "2026-11-03", "endDate": "2026-11-03", "startsAt": null, "endsAt": null, "startTime": null, "endTime": null }
      ]
    },
    {
      "name": "ежедневно через переход на зимнее время в Нью-Йорке",
      "timezone": "America/New_York",
      "event": { "allDay": false, "startDate": "2026-10-31", "endDate": "2026-10-31", "startTime": "08:00", "durationMinutes": 60, "recurrence": "DAILY", "interval": 1, "weekdays": [], "repeatUntil": null },
      "window": { "from": "2026-10-31", "to": "2026-11-01" },
      "expected": [
        { "occurrenceDate": "2026-10-31", "startDate": "2026-10-31", "endDate": "2026-10-31", "startsAt": "2026-10-31T12:00:00.000Z", "endsAt": "2026-10-31T13:00:00.000Z", "startTime": "08:00", "endTime": "09:00" },
        { "occurrenceDate": "2026-11-01", "startDate": "2026-11-01", "endDate": "2026-11-01", "startsAt": "2026-11-01T13:00:00.000Z", "endsAt": "2026-11-01T14:00:00.000Z", "startTime": "08:00", "endTime": "09:00" }
      ]
    },
    {
      "name": "событие через полночь попадает в окно следующего дня",
      "timezone": "Europe/Moscow",
      "event": { "allDay": false, "startDate": "2026-11-05", "endDate": "2026-11-06", "startTime": "23:30", "durationMinutes": 60, "recurrence": "NONE", "interval": 1, "weekdays": [], "repeatUntil": null },
      "window": { "from": "2026-11-06", "to": "2026-11-06" },
      "expected": [
        { "occurrenceDate": "2026-11-05", "startDate": "2026-11-05", "endDate": "2026-11-06", "startsAt": "2026-11-05T20:30:00.000Z", "endsAt": "2026-11-05T21:30:00.000Z", "startTime": "23:30", "endTime": "00:30" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Падающие тесты**

`apps/api/src/calendar/zoned-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { localToUtc, utcToLocal } from './zoned-time.js';

describe('zoned time', () => {
  it('converts local Moscow time to UTC and back', () => {
    const instant = localToUtc('2026-11-03', '17:00', 'Europe/Moscow');
    expect(instant.toISOString()).toBe('2026-11-03T14:00:00.000Z');
    expect(utcToLocal(instant, 'Europe/Moscow')).toEqual({ date: '2026-11-03', time: '17:00' });
  });

  it('uses the summer offset before and the winter offset after the Berlin switch', () => {
    expect(localToUtc('2026-10-24', '12:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-24T10:00:00.000Z',
    );
    expect(localToUtc('2026-10-26', '12:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-26T11:00:00.000Z',
    );
  });

  it('moves a non-existent spring local time forward', () => {
    // 29.03.2026 02:30 does not exist in Berlin; it becomes 03:30 CEST (01:30Z).
    expect(localToUtc('2026-03-29', '02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('takes the first (summer) instant of an ambiguous autumn local time', () => {
    // 25.10.2026 02:30 happens twice in Berlin; the first is CEST (00:30Z).
    expect(localToUtc('2026-10-25', '02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
});
```

`apps/api/src/calendar/calendar-recurrence.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  expandOccurrences,
  isoWeekday,
  type Occurrence,
  type RecurringEvent,
} from './calendar-recurrence.js';

type Case = {
  name: string;
  timezone: string;
  event: RecurringEvent;
  window: { from: string; to: string };
  expected: Occurrence[];
};

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../fixtures/calendar-recurrence/cases.json'), 'utf8'),
) as { cases: Case[] };

describe('expandOccurrences (shared fixture)', () => {
  it.each(fixture.cases.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    expect(expandOccurrences(item.event, item.window, item.timezone)).toEqual(item.expected);
  });
});

describe('isoWeekday', () => {
  it('numbers Monday 1 and Sunday 7', () => {
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(isoWeekday('2026-10-11')).toBe(7);
  });
});
```

Если `__dirname` недоступен в ESM-окружении Vitest api, заменить на `fileURLToPath(new URL('.', import.meta.url))` из `node:url`.

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `pnpm --filter @harmofin/api exec vitest run src/calendar`
Expected: FAIL — модули `./zoned-time.js` и `./calendar-recurrence.js` не найдены.

- [ ] **Step 4: Реализация `zoned-time.ts`**

```ts
// Local wall-clock date/time of an IANA zone <-> UTC instants, with Intl only (no tz library).

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, value);
  }
  return value;
}

function wallClock(instant: Date, timezone: string): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const part of formatter(timezone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

/** Zone offset at `instant`, minutes east of UTC. */
function offsetMinutes(instant: Date, timezone: string): number {
  const p = wallClock(instant, timezone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

export function localToUtc(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Two candidate offsets around the local time; the earlier valid one wins (ambiguous autumn
  // time takes the summer instant). A spring gap matches neither and moves forward.
  const before = offsetMinutes(new Date(naive - 12 * 3_600_000), timezone);
  const after = offsetMinutes(new Date(naive + 12 * 3_600_000), timezone);
  for (const offset of [Math.max(before, after), Math.min(before, after)]) {
    const candidate = new Date(naive - offset * 60_000);
    if (offsetMinutes(candidate, timezone) === offset) return candidate;
  }
  return new Date(naive - Math.min(before, after) * 60_000);
}

export function utcToLocal(instant: Date, timezone: string): { date: string; time: string } {
  const p = wallClock(instant, timezone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${p.year}-${pad(p.month!)}-${pad(p.day!)}`,
    time: `${pad(p.hour!)}:${pad(p.minute!)}`,
  };
}
```

Пояснение к выбору кандидата: осенью «до» — летнее смещение (+120), «после» — зимнее (+60); первым проверяется большее смещение, то есть более ранний момент. Весной в «дыре» ни один кандидат не проходит проверку; возврат `naive − min` даёт момент на величину перехода позже (02:30 → 03:30 CEST).

- [ ] **Step 5: Реализация `calendar-recurrence.ts`**

```ts
import { localToUtc, utcToLocal } from './zoned-time.js';

export type CalendarRecurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** An event rule in the budget's local wall-clock terms. */
export interface RecurringEvent {
  allDay: boolean;
  startDate: string;
  /** All day: last day; timed: local date the first occurrence ends on. */
  endDate: string;
  startTime: string | null;
  durationMinutes: number;
  recurrence: CalendarRecurrence;
  interval: number;
  /** ISO weekdays 1 (Mon) … 7 (Sun); WEEKLY only. */
  weekdays: number[];
  repeatUntil: string | null;
}

export interface Occurrence {
  /** Local start date: the occurrence id within the series. */
  occurrenceDate: string;
  startDate: string;
  endDate: string;
  startsAt: string | null;
  endsAt: string | null;
  startTime: string | null;
  endTime: string | null;
}

const DAY_MS = 86_400_000;

function toUtcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function fromUtcDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtcDay(toUtcDay(date) + days * DAY_MS);
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDay(to) - toUtcDay(from)) / DAY_MS);
}

export function isoWeekday(date: string): number {
  const day = new Date(toUtcDay(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

function clampedDate(year: number, monthIndex: number, day: number): string {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return fromUtcDay(Date.UTC(year, monthIndex, Math.min(day, last)));
}

/** Local start dates of the series between `lo` and `hi` inclusive. */
function startDates(event: RecurringEvent, lo: string, hi: string): string[] {
  const start = event.startDate;
  const last = event.repeatUntil && event.repeatUntil < hi ? event.repeatUntil : hi;
  const from = lo > start ? lo : start;
  if (from > last) return [];
  if (event.recurrence === 'NONE') return start >= lo && start <= last ? [start] : [];

  const dates: string[] = [];
  if (event.recurrence === 'DAILY') {
    const skip = Math.ceil(daysBetween(start, from) / event.interval);
    for (let date = addDays(start, skip * event.interval); date <= last; ) {
      dates.push(date);
      date = addDays(date, event.interval);
    }
    return dates;
  }
  if (event.recurrence === 'WEEKLY') {
    const startMonday = addDays(start, 1 - isoWeekday(start));
    for (let date = from; date <= last; date = addDays(date, 1)) {
      const monday = addDays(date, 1 - isoWeekday(date));
      const week = daysBetween(startMonday, monday) / 7;
      if (week % event.interval === 0 && event.weekdays.includes(isoWeekday(date))) {
        dates.push(date);
      }
    }
    return dates;
  }
  const [startYear, startMonth, startDay] = start.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const step = event.recurrence === 'MONTHLY' ? event.interval : event.interval * 12;
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number];
  const monthsToFrom = (fromYear - startYear) * 12 + (fromMonth - startMonth);
  // One step back so a clamped date of the previous step is never missed.
  let index = Math.max(0, Math.floor(monthsToFrom / step) - 1);
  for (;;) {
    const total = startMonth - 1 + index * step;
    const date = clampedDate(startYear + Math.floor(total / 12), total % 12, startDay);
    if (date > last) break;
    if (date >= from) dates.push(date);
    index += 1;
  }
  return dates;
}

export function expandOccurrences(
  event: RecurringEvent,
  window: { from: string; to: string },
  timezone: string,
): Occurrence[] {
  const span = daysBetween(event.startDate, event.endDate);
  // An occurrence that started up to `span` days before the window still overlaps it.
  const candidates = startDates(event, addDays(window.from, -span), window.to);
  const result: Occurrence[] = [];
  for (const date of candidates) {
    if (event.allDay) {
      const endDate = addDays(date, span);
      if (endDate < window.from) continue;
      result.push({
        occurrenceDate: date,
        startDate: date,
        endDate,
        startsAt: null,
        endsAt: null,
        startTime: null,
        endTime: null,
      });
      continue;
    }
    const startsAt = localToUtc(date, event.startTime!, timezone);
    const endsAt = new Date(startsAt.getTime() + event.durationMinutes * 60_000);
    const end = utcToLocal(endsAt, timezone);
    if (end.date < window.from) continue;
    result.push({
      occurrenceDate: date,
      startDate: date,
      endDate: end.date,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      startTime: event.startTime,
      endTime: end.time,
    });
  }
  return result;
}
```

- [ ] **Step 6: Тесты проходят**

Run: `pnpm --filter @harmofin/api exec vitest run src/calendar`
Expected: PASS, все 12 случаев эталона и тесты `zoned-time`. Если случай эталона падает, сначала перепроверить ожидание вручную (день недели, смещение пояса), затем код; эталон и код меняются только вместе.

- [ ] **Step 7: Проверки и индексация**

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint && pnpm exec prettier --check fixtures apps/api/src/calendar`
Expected: без ошибок.

```bash
git add fixtures/calendar-recurrence apps/api/src/calendar
```

Коммит (координатор): `feat(api): разворачивание повторов событий календаря`.

### Task 2: Копия `expandOccurrences` в worker

**Files:**
- Create: `apps/worker/src/zoned-time.ts`, `apps/worker/src/calendar-recurrence.ts`, `apps/worker/src/calendar-recurrence.test.ts`

**Interfaces:**
- Consumes: `fixtures/calendar-recurrence/cases.json` (задача 1).
- Produces: те же экспорты, что у api (`localToUtc`, `utcToLocal`, `expandOccurrences`, `RecurringEvent`, `Occurrence`, `addDays`, `isoWeekday`) из `apps/worker/src/zoned-time.ts` и `apps/worker/src/calendar-recurrence.ts`.

- [ ] **Step 1: Падающий тест**

`apps/worker/src/calendar-recurrence.test.ts` — тот же код, что `apps/api/src/calendar/calendar-recurrence.test.ts` из задачи 1, с путём к эталону `resolve(__dirname, '../../../fixtures/calendar-recurrence/cases.json')`, плюс четыре теста `zoned-time` из задачи 1 (импорт `./zoned-time.js`) в том же файле.

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @harmofin/worker exec vitest run src/calendar-recurrence.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Копии модулей**

Скопировать `apps/api/src/calendar/zoned-time.ts` → `apps/worker/src/zoned-time.ts` и `apps/api/src/calendar/calendar-recurrence.ts` → `apps/worker/src/calendar-recurrence.ts` без изменений кода. Первой строкой каждого файла добавить:

```ts
// Copy of apps/api/src/calendar/<имя файла>; both are checked against fixtures/calendar-recurrence/cases.json. Change them together.
```

и такую же строку (с путём к копии worker) — в оба файла api.

- [ ] **Step 4: Тест проходит**

Run: `pnpm --filter @harmofin/worker exec vitest run src/calendar-recurrence.test.ts`
Expected: PASS.

- [ ] **Step 5: Сверка копий**

Run: `diff <(tail -n +2 apps/api/src/calendar/calendar-recurrence.ts) <(tail -n +2 apps/worker/src/calendar-recurrence.ts) && diff <(tail -n +2 apps/api/src/calendar/zoned-time.ts) <(tail -n +2 apps/worker/src/zoned-time.ts)`
Expected: пустой вывод.

- [ ] **Step 6: Проверки и индексация**

Run: `pnpm --filter @harmofin/worker typecheck && pnpm --filter @harmofin/worker lint`

```bash
git add apps/worker/src/zoned-time.ts apps/worker/src/calendar-recurrence.ts apps/worker/src/calendar-recurrence.test.ts apps/api/src/calendar/zoned-time.ts apps/api/src/calendar/calendar-recurrence.ts
```

Коммит: `feat(worker): копия разворачивания повторов для напоминаний`.

### Task 3: Схема и миграция

**Files:**
- Modify: `prisma/schema.prisma` (enum `NotificationType`, enum `WorkerJobType`, новые enum и модели, обратные связи в `Workspace`, `Budget`, `User`)
- Create: `prisma/migrations/20261030000000_family_calendar/migration.sql`
- Create: `apps/api/test/calendar-schema.integration.test.ts`
- Modify: `apps/worker/src/account-purge.ts`, `docs/runbooks/budget-reset.sql`

**Interfaces:**
- Produces: модели Prisma `CalendarEvent` (`prisma.calendarEvent`) и `CalendarEventParticipant` (`prisma.calendarEventParticipant`), enum `CalendarRecurrence`, значения `NotificationType.CALENDAR_REMINDER`, `WorkerJobType.EVALUATE_CALENDAR_REMINDERS`.

- [ ] **Step 1: Схема**

В `enum NotificationType` добавить последней строкой `CALENDAR_REMINDER`, в `enum WorkerJobType` — `EVALUATE_CALENDAR_REMINDERS`. После `model Notification` добавить:

```prisma
enum CalendarRecurrence {
  NONE
  DAILY
  WEEKLY
  MONTHLY
  YEARLY
}

model CalendarEvent {
  id              String             @id @db.Uuid
  workspaceId     String             @map("workspace_id") @db.Uuid
  budgetId        String             @map("budget_id") @db.Uuid
  createdByUserId String             @map("created_by_user_id") @db.Uuid
  title           String             @db.VarChar(200)
  description     String?            @db.VarChar(2000)
  allDay          Boolean            @map("all_day")
  startsOn        DateTime?          @map("starts_on") @db.Date
  endsOn          DateTime?          @map("ends_on") @db.Date
  startsAt        DateTime?          @map("starts_at") @db.Timestamptz(3)
  endsAt          DateTime?          @map("ends_at") @db.Timestamptz(3)
  recurrence      CalendarRecurrence @default(NONE)
  interval        Int                @default(1)
  weekdays        Int[]              @default([])
  repeatUntil     DateTime?          @map("repeat_until") @db.Date
  reminderMinutes Int?               @map("reminder_minutes")
  deletedAt       DateTime?          @map("deleted_at") @db.Timestamptz(3)
  createdAt       DateTime           @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime           @updatedAt @map("updated_at") @db.Timestamptz(3)

  workspace    Workspace                  @relation(fields: [workspaceId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  budget       Budget                     @relation(fields: [budgetId, workspaceId], references: [id, workspaceId], onDelete: Restrict, onUpdate: Cascade)
  createdBy    User                       @relation("CalendarEventAuthor", fields: [createdByUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  participants CalendarEventParticipant[]

  @@unique([id, budgetId])
  @@index([budgetId, deletedAt])
  @@index([budgetId, createdByUserId])
  @@map("calendar_events")
}

model CalendarEventParticipant {
  eventId  String @map("event_id") @db.Uuid
  budgetId String @map("budget_id") @db.Uuid
  userId   String @map("user_id") @db.Uuid

  event CalendarEvent @relation(fields: [eventId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  user  User          @relation("CalendarEventParticipantUser", fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@id([eventId, userId])
  @@index([budgetId, userId])
  @@map("calendar_event_participants")
}
```

Добавить обратные связи: в `Workspace` — `calendarEvents CalendarEvent[]`; в `Budget` — `calendarEvents CalendarEvent[]`; в `User` — `calendarEventsCreated CalendarEvent[] @relation("CalendarEventAuthor")` и `calendarEventParticipations CalendarEventParticipant[] @relation("CalendarEventParticipantUser")`. Проверить, что у `Budget` уже есть `@@unique([id, workspaceId])` (на него ссылается `Notification`); если нет — сообщить координатору, не добавлять самостоятельно.

- [ ] **Step 2: Миграция**

Сгенерировать SQL без применения к БД владельца:

Run: `pnpm --filter @harmofin/api exec prisma migrate diff --from-schema-datasource ../../prisma/schema.prisma --to-schema-datamodel ../../prisma/schema.prisma --script`

Если команда требует доступа к БД — не применять ничего к `harmofin`: написать SQL вручную по образцу `prisma/migrations/20261026000000_family_object_ownership/migration.sql`. Итоговый `prisma/migrations/20261030000000_family_calendar/migration.sql` должен содержать:

```sql
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CALENDAR_REMINDER';
ALTER TYPE "WorkerJobType" ADD VALUE 'EVALUATE_CALENDAR_REMINDERS';

-- CreateEnum
CREATE TYPE "CalendarRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "all_day" BOOLEAN NOT NULL,
    "starts_on" DATE,
    "ends_on" DATE,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "recurrence" "CalendarRecurrence" NOT NULL DEFAULT 'NONE',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "repeat_until" DATE,
    "reminder_minutes" INTEGER,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calendar_events_title_not_blank" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "calendar_events_day_or_time" CHECK (
      ("all_day" AND "starts_on" IS NOT NULL AND "ends_on" IS NOT NULL AND "starts_at" IS NULL AND "ends_at" IS NULL AND "ends_on" >= "starts_on" AND "ends_on" - "starts_on" <= 30)
      OR
      (NOT "all_day" AND "starts_at" IS NOT NULL AND "ends_at" IS NOT NULL AND "starts_on" IS NULL AND "ends_on" IS NULL AND "ends_at" >= "starts_at" AND "ends_at" - "starts_at" <= INTERVAL '24 hours')
    ),
    CONSTRAINT "calendar_events_interval_range" CHECK ("interval" BETWEEN 1 AND 99),
    CONSTRAINT "calendar_events_weekdays_rule" CHECK (
      ("recurrence" = 'WEEKLY' AND cardinality("weekdays") BETWEEN 1 AND 7 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7])
      OR ("recurrence" <> 'WEEKLY' AND cardinality("weekdays") = 0)
    ),
    CONSTRAINT "calendar_events_repeat_until_rule" CHECK ("repeat_until" IS NULL OR "recurrence" <> 'NONE'),
    CONSTRAINT "calendar_events_reminder_minutes" CHECK ("reminder_minutes" IS NULL OR "reminder_minutes" IN (15, 60, 1440, 10080))
);

CREATE TABLE "calendar_event_participants" (
    "event_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    CONSTRAINT "calendar_event_participants_pkey" PRIMARY KEY ("event_id", "user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_id_budget_id_key" ON "calendar_events"("id", "budget_id");
CREATE INDEX "calendar_events_budget_id_deleted_at_idx" ON "calendar_events"("budget_id", "deleted_at");
CREATE INDEX "calendar_events_budget_id_created_by_user_id_idx" ON "calendar_events"("budget_id", "created_by_user_id");
CREATE INDEX "calendar_events_reminders_idx" ON "calendar_events"("budget_id") WHERE "reminder_minutes" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "calendar_event_participants_budget_id_user_id_idx" ON "calendar_event_participants"("budget_id", "user_id");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_budget_id_workspace_id_fkey" FOREIGN KEY ("budget_id", "workspace_id") REFERENCES "budgets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_event_id_budget_id_fkey" FOREIGN KEY ("event_id", "budget_id") REFERENCES "calendar_events"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Имена таблиц `workspaces`, `budgets`, `users` сверить с `@@map` в `schema.prisma`; если отличаются — использовать фактические. `ALTER TYPE … ADD VALUE` нельзя использовать в той же транзакции, где значение применяется; здесь значения только добавляются — так уже сделано в `20261026000000_family_object_ownership` для `OBJECTS_TRANSFERRED`, сверить формат с ним.

**Удаление аккаунта.** `apps/worker/src/account-purge.ts` удаляет данные бюджетов по списку таблиц, а `account-purge.coverage.test.ts` падает на любой новой модели с `budgetId` или связью с `User`, пока она не классифицирована. Поэтому в этой же задаче:

- в `BUDGET_TABLES_IN_DELETE_ORDER` добавить `'calendar_event_participants'` и сразу за ним `'calendar_events'` — перед `'notifications'` (дети раньше родителей, все FK `RESTRICT`);
- в `USER_RETAINED_OUTSIDE_SCOPE` добавить:

```ts
  calendar_events:
    "created_by_user_id rows outside the owned budget scope are another family's calendar and are retained; the user row is anonymized, not deleted.",
  calendar_event_participants:
    "user_id rows outside the owned budget scope belong to another family's events and are retained.",
```

- тот же порядок добавить в `docs/runbooks/budget-reset.sql` (файл зеркалит порядок, см. комментарий в начале `account-purge.ts`): удаление из `calendar_event_participants` и `calendar_events` в том же стиле, что соседние строки, перед `notifications`.

Проверка — после шага 3:

Run: `pnpm --filter @harmofin/worker exec vitest run src/account-purge.coverage.test.ts`
Expected: PASS.

- [ ] **Step 3: Генерация клиента**

Run: `pnpm db:generate`
Expected: успех. При EPERM — сообщить координатору (у владельца запущены dev-процессы), не убивать процессы.

- [ ] **Step 4: Падающий интеграционный тест схемы**

`apps/api/test/calendar-schema.integration.test.ts`:

```ts
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createUuidV7 } from '../src/common/identifiers/uuid-v7.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
});

afterAll(async () => {
  await env.prisma.calendarEventParticipant.deleteMany({ where: { budgetId: creator.budgetId } });
  await env.prisma.calendarEvent.deleteMany({ where: { budgetId: creator.budgetId } });
  await env.stop();
});

function base(overrides: Partial<Prisma.CalendarEventUncheckedCreateInput> = {}) {
  return {
    id: createUuidV7(),
    workspaceId: creator.workspaceId,
    budgetId: creator.budgetId,
    createdByUserId: creator.user.id,
    title: 'Кружок',
    allDay: true,
    startsOn: new Date('2026-11-03T00:00:00Z'),
    endsOn: new Date('2026-11-03T00:00:00Z'),
    ...overrides,
  } satisfies Prisma.CalendarEventUncheckedCreateInput;
}

async function rejects(data: Prisma.CalendarEventUncheckedCreateInput): Promise<void> {
  await expect(env.prisma.calendarEvent.create({ data })).rejects.toMatchObject({
    meta: { code: '23514' },
  });
}

describe('calendar_events constraints', () => {
  it('stores an all-day event and a timed weekly event', async () => {
    await env.prisma.calendarEvent.create({ data: base() });
    await env.prisma.calendarEvent.create({
      data: base({
        allDay: false,
        startsOn: null,
        endsOn: null,
        startsAt: new Date('2026-11-03T14:00:00Z'),
        endsAt: new Date('2026-11-03T15:30:00Z'),
        recurrence: 'WEEKLY',
        weekdays: [2],
        reminderMinutes: 60,
      }),
    });
  });

  it('rejects mixing day and time fields', async () => {
    await rejects(base({ startsAt: new Date('2026-11-03T14:00:00Z') }));
  });

  it('rejects an end before the start', async () => {
    await rejects(base({ endsOn: new Date('2026-11-02T00:00:00Z') }));
  });

  it('rejects weekdays outside WEEKLY and an empty WEEKLY', async () => {
    await rejects(base({ recurrence: 'DAILY', weekdays: [1] }));
    await rejects(base({ recurrence: 'WEEKLY', weekdays: [] }));
    await rejects(base({ recurrence: 'WEEKLY', weekdays: [8] }));
  });

  it('rejects an unsupported reminder and an interval out of range', async () => {
    await rejects(base({ reminderMinutes: 30 }));
    await rejects(base({ recurrence: 'DAILY', interval: 0 }));
  });

  it('rejects repeatUntil on a non-repeating event and a blank title', async () => {
    await rejects(base({ repeatUntil: new Date('2026-12-01T00:00:00Z') }));
    await rejects(base({ title: '   ' }));
  });
});
```

Если Prisma отдаёт код check-нарушения не в `meta.code`, а в `meta.driverAdapterError` или тексте — по образцу `apps/api/test/family-ownership-schema.integration.test.ts` проверять тот же код `23514` тем способом, что там используется для `23502`.

- [ ] **Step 5: Применить миграцию к одноразовой БД и прогнать тест**

Run: `pnpm test:integration` (применяет миграции к `harmofin_v22_test` и гонит весь набор; набор должен быть зелёным, новый файл — проходить).
Expected: все тесты проходят. Падение известного даты-зависимого теста (если появится) сравнить с `main` и сообщить, не чинить в этой задаче.

- [ ] **Step 6: Проверки и индексация**

Run: `pnpm typecheck && pnpm lint && pnpm exec prettier --check prisma apps/api/test/calendar-schema.integration.test.ts`

```bash
git add prisma/schema.prisma prisma/migrations/20261030000000_family_calendar apps/api/test/calendar-schema.integration.test.ts apps/worker/src/account-purge.ts docs/runbooks/budget-reset.sql
```

Коммит: `feat(db): таблицы событий семейного календаря`. **Конец PR 1** — координатор останавливается и спрашивает владельца об открытии PR.

---

## PR 2 — API событий и лента

Перед стартом: свежий `main` после мержа PR 1, ветка `feat/family-calendar-api`.

### Task 4: Политика, схемы запросов и преобразование события

**Files:**
- Modify: `apps/api/src/common/policies/access.errors.ts`, `apps/api/src/common/policies/budget-access.policy.ts`, `apps/api/src/common/policies/budget-access.policy.test.ts` (если файла нет — создать)
- Create: `apps/api/src/calendar/calendar.errors.ts`
- Create: `apps/api/src/calendar/calendar.schemas.ts`, `apps/api/src/calendar/calendar.schemas.test.ts`
- Create: `apps/api/src/calendar/calendar-event.mapper.ts`, `apps/api/src/calendar/calendar-event.mapper.test.ts`

**Interfaces:**
- Consumes: `localToUtc`, `utcToLocal`, `RecurringEvent` (задача 1).
- Produces:
  - `notEventAuthor(): ForbiddenException` (`NOT_EVENT_AUTHOR`); `BudgetAccessPolicy.canEditEvent(actor: AccessActor, event: AuthoredRecord): boolean`; `BudgetAccessPolicy.requireEventAuthor(actor: AccessActor, event: AuthoredRecord): void`.
  - `participantNotMember(): UnprocessableEntityException` (`PARTICIPANT_NOT_MEMBER`) из `calendar.errors.ts`.
  - `calendarEventInputSchema`, `type CalendarEventInput`, `calendarFeedQuerySchema`, `type CalendarFeedQuery`, `calendarUuidSchema`, `REMINDER_MINUTES = [15, 60, 1440, 10080] as const`, `MAX_FEED_DAYS = 62`.
  - `interface CalendarEventData` (поля для `create`/`update` без `id`, `workspaceId`, `budgetId`, `createdByUserId`), `interface CalendarEventRow extends CalendarEventData { id; budgetId; createdByUserId; deletedAt; participantUserIds: string[] }`;
  - `toEventData(input: CalendarEventInput, timezone: string): CalendarEventData`;
  - `toRecurringEvent(row: CalendarEventData, timezone: string): RecurringEvent`;
  - `toLocalFields(row: CalendarEventData, timezone: string): { date: string; endDate: string; startTime: string | null; endTime: string | null }`.

- [ ] **Step 1: Падающие тесты политики**

В `apps/api/src/common/policies/budget-access.policy.test.ts` (если файл есть — дописать `describe`, сохранив его стиль):

```ts
import { describe, expect, it } from 'vitest';

import { BudgetAccessPolicy, type AccessActor } from './budget-access.policy.js';

const policy = new BudgetAccessPolicy();
const actor = (role: AccessActor['role'], isCreator = false): AccessActor => ({
  userId: 'me',
  role,
  isCreator,
});
const code = (value: string) =>
  expect.objectContaining({ response: expect.objectContaining({ code: value }) });

describe('calendar events', () => {
  it('lets the author edit their event', () => {
    expect(policy.canEditEvent(actor('EDITOR'), { createdByUserId: 'me' })).toBe(true);
    expect(() =>
      policy.requireEventAuthor(actor('EDITOR'), { createdByUserId: 'me' }),
    ).not.toThrow();
  });

  it('refuses a foreign event even to the family creator', () => {
    expect(policy.canEditEvent(actor('OWNER', true), { createdByUserId: 'other' })).toBe(false);
    expect(() =>
      policy.requireEventAuthor(actor('OWNER', true), { createdByUserId: 'other' }),
    ).toThrow(code('NOT_EVENT_AUTHOR'));
  });

  it('refuses a viewer with FORBIDDEN before the author check', () => {
    expect(policy.canEditEvent(actor('VIEWER'), { createdByUserId: 'me' })).toBe(false);
    expect(() =>
      policy.requireEventAuthor(actor('VIEWER'), { createdByUserId: 'me' }),
    ).toThrow(code('FORBIDDEN'));
  });
});
```

Если `toThrow(objectContaining)` не сработает с `ForbiddenException`, проверять через `try/catch` и `getResponse()` — как в существующих тестах политики.

- [ ] **Step 2: Падающие тесты схем**

`apps/api/src/calendar/calendar.schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { calendarEventInputSchema, calendarFeedQuerySchema } from './calendar.schemas.js';

const timed = {
  title: 'Кружок рисования',
  allDay: false,
  date: '2026-11-03',
  startTime: '17:00',
  endTime: '18:30',
  recurrence: 'WEEKLY',
  weekdays: [2],
  participantUserIds: [],
};
const allDay = (extra: Record<string, unknown> = {}) => ({
  title: 'Поездка',
  allDay: true,
  date: '2026-10-31',
  recurrence: 'NONE',
  participantUserIds: [],
  ...extra,
});

function fields(value: unknown): string[] {
  const result = calendarEventInputSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('calendarEventInputSchema', () => {
  it('accepts a timed weekly event and fills defaults', () => {
    expect(calendarEventInputSchema.parse(timed)).toMatchObject({
      interval: 1,
      reminderMinutes: null,
      description: null,
      endDate: null,
      repeatUntil: null,
    });
  });

  it('accepts an all-day event without times', () => {
    expect(fields(allDay({ recurrence: 'YEARLY' }))).toEqual([]);
  });

  it('requires both times for a timed event and an end not before the start', () => {
    expect(fields({ ...timed, startTime: undefined })).toContain('startTime');
    expect(fields({ ...timed, endTime: '16:30' })).toContain('endTime');
  });

  it('rejects times on an all-day event, an end date before the date and a span over 31 days', () => {
    expect(fields({ ...timed, allDay: true })).toContain('startTime');
    expect(fields(allDay({ endDate: '2026-10-30' }))).toContain('endDate');
    expect(fields(allDay({ date: '2026-07-01', endDate: '2026-08-01' }))).toContain('endDate');
    expect(fields(allDay({ date: '2026-07-01', endDate: '2026-07-31' }))).toEqual([]);
  });

  it('checks weekdays, repeatUntil, interval and reminder', () => {
    expect(fields({ ...timed, weekdays: [] })).toContain('weekdays');
    expect(fields({ ...timed, recurrence: 'DAILY' })).toContain('weekdays');
    expect(fields({ ...timed, repeatUntil: '2026-11-01' })).toContain('repeatUntil');
    expect(fields({ ...timed, recurrence: 'NONE', weekdays: [], repeatUntil: '2026-12-01' })).toContain(
      'repeatUntil',
    );
    expect(fields({ ...timed, interval: 100 })).toContain('interval');
    expect(fields({ ...timed, reminderMinutes: 30 })).toContain('reminderMinutes');
  });

  it('trims the title and rejects a blank one and unknown fields', () => {
    expect(calendarEventInputSchema.parse({ ...timed, title: '  Врач  ' }).title).toBe('Врач');
    expect(fields({ ...timed, title: '   ' })).toContain('title');
    expect(calendarEventInputSchema.safeParse({ ...timed, color: 'red' }).success).toBe(false);
  });
});

describe('calendarFeedQuerySchema', () => {
  it('parses a range and the flag', () => {
    expect(
      calendarFeedQuerySchema.parse({ from: '2026-10-26', to: '2026-12-06', includePlans: 'false' }),
    ).toEqual({ from: '2026-10-26', to: '2026-12-06', includePlans: false });
  });

  it('rejects a reversed range and a range longer than 62 days', () => {
    expect(calendarFeedQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success).toBe(false);
    expect(calendarFeedQuerySchema.safeParse({ from: '2026-01-01', to: '2026-03-04' }).success).toBe(false);
    expect(calendarFeedQuerySchema.safeParse({ from: '2026-01-01', to: '2026-03-03' }).success).toBe(true);
  });
});
```

(01.01–03.03.2026 — 62 дня включительно; по 04.03 — 63.)

- [ ] **Step 3: Падающие тесты преобразования**

`apps/api/src/calendar/calendar-event.mapper.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { calendarEventInputSchema } from './calendar.schemas.js';
import { toEventData, toLocalFields, toRecurringEvent } from './calendar-event.mapper.js';

const tz = 'Europe/Moscow';

describe('calendar event mapper', () => {
  it('stores a timed event as UTC instants of the budget time zone', () => {
    const data = toEventData(
      calendarEventInputSchema.parse({
        title: 'Кружок',
        allDay: false,
        date: '2026-11-03',
        startTime: '17:00',
        endTime: '18:30',
        recurrence: 'WEEKLY',
        weekdays: [2],
        participantUserIds: [],
        reminderMinutes: 60,
      }),
      tz,
    );
    expect(data).toMatchObject({
      allDay: false,
      startsOn: null,
      endsOn: null,
      startsAt: new Date('2026-11-03T14:00:00.000Z'),
      endsAt: new Date('2026-11-03T15:30:00.000Z'),
      recurrence: 'WEEKLY',
      interval: 1,
      weekdays: [2],
      repeatUntil: null,
      reminderMinutes: 60,
    });
    expect(toRecurringEvent(data, tz)).toEqual({
      allDay: false,
      startDate: '2026-11-03',
      endDate: '2026-11-03',
      startTime: '17:00',
      durationMinutes: 90,
      recurrence: 'WEEKLY',
      interval: 1,
      weekdays: [2],
      repeatUntil: null,
    });
    expect(toLocalFields(data, tz)).toEqual({
      date: '2026-11-03',
      endDate: '2026-11-03',
      startTime: '17:00',
      endTime: '18:30',
    });
  });

  it('stores an all-day event as dates; the end date defaults to the date', () => {
    const data = toEventData(
      calendarEventInputSchema.parse({
        title: 'День рождения',
        allDay: true,
        date: '2026-10-18',
        recurrence: 'YEARLY',
        participantUserIds: [],
      }),
      tz,
    );
    expect(data).toMatchObject({
      startsOn: new Date('2026-10-18T00:00:00.000Z'),
      endsOn: new Date('2026-10-18T00:00:00.000Z'),
      startsAt: null,
      endsAt: null,
    });
    expect(toRecurringEvent(data, tz)).toMatchObject({
      allDay: true,
      startDate: '2026-10-18',
      endDate: '2026-10-18',
      startTime: null,
      durationMinutes: 0,
    });
  });
});
```

- [ ] **Step 4: Убедиться, что падают**

Run: `pnpm --filter @harmofin/api exec vitest run src/calendar src/common/policies`
Expected: FAIL — нет `canEditEvent`, `calendar.schemas.js`, `calendar-event.mapper.js`.

- [ ] **Step 5: Политика и ошибки**

В `access.errors.ts`:

```ts
export function notEventAuthor(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_EVENT_AUTHOR',
    detail: 'Изменять событие может только его автор.',
  });
}
```

В `budget-access.policy.ts` импортировать `notEventAuthor` и добавить рядом с `canEditTransaction` / `requireOperationAuthor` (реализацию `canEditEvent` сделать так же, как `canEditTransaction`, — через ту же проверку writer):

```ts
  canEditEvent(actor: AccessActor, event: AuthoredRecord): boolean {
    return WRITERS.has(actor.role) && event.createdByUserId === actor.userId;
  }

  requireEventAuthor(actor: AccessActor, event: AuthoredRecord): void {
    this.requireWriter(actor);
    if (event.createdByUserId !== actor.userId) throw notEventAuthor();
  }
```

`apps/api/src/calendar/calendar.errors.ts`:

```ts
import { UnprocessableEntityException } from '@nestjs/common';

export function participantNotMember(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'PARTICIPANT_NOT_MEMBER',
    detail: 'Участником события может быть только член семьи.',
  });
}
```

- [ ] **Step 6: `calendar.schemas.ts`**

```ts
import { z } from 'zod';

export const REMINDER_MINUTES = [15, 60, 1440, 10080] as const;
export const MAX_FEED_DAYS = 62;
const MAX_ALL_DAY_SPAN_DAYS = 30;

const date = z.string().date('Укажите дату в формате ГГГГ-ММ-ДД.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Укажите время в формате ЧЧ:ММ.');
const uuid = z.string().uuid();

export const calendarUuidSchema = uuid;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const calendarEventInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Введите название.').max(200, 'Не длиннее 200 символов.'),
    description: z.string().trim().max(2000, 'Не длиннее 2000 символов.').nullable().optional(),
    allDay: z.boolean(),
    date,
    endDate: date.nullable().optional(),
    startTime: time.nullable().optional(),
    endTime: time.nullable().optional(),
    recurrence: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    interval: z.number().int().min(1, 'От 1 до 99.').max(99, 'От 1 до 99.').default(1),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    repeatUntil: date.nullable().optional(),
    participantUserIds: z.array(uuid).max(50).default([]),
    reminderMinutes: z
      .number()
      .int()
      .refine((value) => (REMINDER_MINUTES as readonly number[]).includes(value), {
        message: 'Выберите напоминание из списка.',
      })
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (value.allDay) {
      if (value.startTime) issue('startTime', 'У события на весь день нет времени начала.');
      if (value.endTime) issue('endTime', 'У события на весь день нет времени конца.');
      if (value.endDate && value.endDate < value.date) {
        issue('endDate', 'Дата окончания не может быть раньше даты начала.');
      } else if (value.endDate && daysBetween(value.date, value.endDate) > MAX_ALL_DAY_SPAN_DAYS) {
        issue('endDate', 'Событие может длиться не больше 31 дня.');
      }
    } else {
      if (!value.startTime) issue('startTime', 'Укажите время начала.');
      if (!value.endTime) issue('endTime', 'Укажите время конца.');
      if (value.endDate) issue('endDate', 'Дата окончания — только у события на весь день.');
      if (value.startTime && value.endTime && value.endTime < value.startTime) {
        issue('endTime', 'Конец не может быть раньше начала.');
      }
    }
    if (value.recurrence === 'WEEKLY' && value.weekdays.length === 0) {
      issue('weekdays', 'Выберите хотя бы один день недели.');
    }
    if (value.recurrence !== 'WEEKLY' && value.weekdays.length > 0) {
      issue('weekdays', 'Дни недели — только у еженедельного повтора.');
    }
    if (new Set(value.weekdays).size !== value.weekdays.length) {
      issue('weekdays', 'Дни недели не должны повторяться.');
    }
    if (value.repeatUntil && value.recurrence === 'NONE') {
      issue('repeatUntil', 'Дата окончания повтора — только у повторяющегося события.');
    } else if (value.repeatUntil && value.repeatUntil < value.date) {
      issue('repeatUntil', 'Повтор не может закончиться раньше начала.');
    }
  })
  .transform((value) => ({
    ...value,
    description: value.description ? value.description : null,
    endDate: value.endDate ?? null,
    startTime: value.startTime ?? null,
    endTime: value.endTime ?? null,
    repeatUntil: value.repeatUntil ?? null,
    reminderMinutes: value.reminderMinutes ?? null,
    weekdays: [...value.weekdays].sort((a, b) => a - b),
    participantUserIds: [...new Set(value.participantUserIds)],
  }));

export type CalendarEventInput = z.output<typeof calendarEventInputSchema>;

export const calendarFeedQuerySchema = z
  .object({
    from: date,
    to: date,
    participantUserId: uuid.optional(),
    includePlans: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Конец диапазона раньше начала.' });
    } else if (daysBetween(value.from, value.to) + 1 > MAX_FEED_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Диапазон — не больше 62 дней.' });
    }
  });

export type CalendarFeedQuery = z.output<typeof calendarFeedQuerySchema>;
```

Без `includePlans` поле в результате отсутствует; сервис трактует это как `true`.

- [ ] **Step 7: `calendar-event.mapper.ts`**

```ts
import type { CalendarRecurrence } from '@prisma/client';

import type { RecurringEvent } from './calendar-recurrence.js';
import type { CalendarEventInput } from './calendar.schemas.js';
import { localToUtc, utcToLocal } from './zoned-time.js';

export interface CalendarEventData {
  title: string;
  description: string | null;
  allDay: boolean;
  startsOn: Date | null;
  endsOn: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  recurrence: CalendarRecurrence;
  interval: number;
  weekdays: number[];
  repeatUntil: Date | null;
  reminderMinutes: number | null;
}

export interface CalendarEventRow extends CalendarEventData {
  id: string;
  budgetId: string;
  createdByUserId: string;
  deletedAt: Date | null;
  participantUserIds: string[];
}

const asDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

export function toEventData(input: CalendarEventInput, timezone: string): CalendarEventData {
  const repeating = input.recurrence !== 'NONE';
  const common = {
    title: input.title,
    description: input.description,
    allDay: input.allDay,
    recurrence: input.recurrence,
    interval: repeating ? input.interval : 1,
    weekdays: input.recurrence === 'WEEKLY' ? input.weekdays : [],
    repeatUntil: repeating && input.repeatUntil ? asDate(input.repeatUntil) : null,
    reminderMinutes: input.reminderMinutes,
  };
  if (input.allDay) {
    return {
      ...common,
      startsOn: asDate(input.date),
      endsOn: asDate(input.endDate ?? input.date),
      startsAt: null,
      endsAt: null,
    };
  }
  return {
    ...common,
    startsOn: null,
    endsOn: null,
    startsAt: localToUtc(input.date, input.startTime!, timezone),
    endsAt: localToUtc(input.date, input.endTime!, timezone),
  };
}

export function toLocalFields(
  row: CalendarEventData,
  timezone: string,
): { date: string; endDate: string; startTime: string | null; endTime: string | null } {
  if (row.allDay) {
    return {
      date: isoDate(row.startsOn!),
      endDate: isoDate(row.endsOn!),
      startTime: null,
      endTime: null,
    };
  }
  const start = utcToLocal(row.startsAt!, timezone);
  const end = utcToLocal(row.endsAt!, timezone);
  return { date: start.date, endDate: end.date, startTime: start.time, endTime: end.time };
}

export function toRecurringEvent(row: CalendarEventData, timezone: string): RecurringEvent {
  const local = toLocalFields(row, timezone);
  return {
    allDay: row.allDay,
    startDate: local.date,
    endDate: local.endDate,
    startTime: local.startTime,
    durationMinutes: row.allDay
      ? 0
      : Math.round((row.endsAt!.getTime() - row.startsAt!.getTime()) / 60_000),
    recurrence: row.recurrence,
    interval: row.interval,
    weekdays: row.weekdays,
    repeatUntil: row.repeatUntil ? isoDate(row.repeatUntil) : null,
  };
}
```

- [ ] **Step 8: Тесты проходят, проверки**

Run: `pnpm --filter @harmofin/api exec vitest run src/calendar src/common/policies && pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Expected: PASS, без ошибок.

```bash
git add apps/api/src/common/policies apps/api/src/calendar/calendar.errors.ts apps/api/src/calendar/calendar.schemas.ts apps/api/src/calendar/calendar.schemas.test.ts apps/api/src/calendar/calendar-event.mapper.ts apps/api/src/calendar/calendar-event.mapper.test.ts
```

Коммит: `feat(api): правила доступа и схемы событий календаря`.

### Task 5: CRUD событий — репозиторий, сервис, контроллер

**Files:**
- Create: `apps/api/src/calendar/calendar.repository.ts`
- Create: `apps/api/src/calendar/calendar.application.service.ts`
- Create: `apps/api/src/calendar/calendar.dto.ts`, `apps/api/src/calendar/calendar.controller.ts`, `apps/api/src/calendar/calendar.module.ts`
- Modify: `apps/api/src/app.module.ts` — импорт и `CalendarModule.register()` рядом с `PlansCalendarModule.register()`
- Modify: `openapi.json` (генерация)
- Test: `apps/api/test/calendar-events.integration.test.ts`

**Interfaces:**
- Consumes: задачи 1, 3, 4.
- Produces:
  - `type StoredCalendarEvent = CalendarEventRow & { createdAt: Date; updatedAt: Date }`
  - `class CalendarRepository` (без состояния, `tx` первым аргументом): `budgetTimezone(db, budgetId): Promise<string>`, `findEvent(db, budgetId, eventId): Promise<StoredCalendarEvent | null>`, `activeMemberIds(db, workspaceId, userIds): Promise<Set<string>>`, `personRefs(db, workspaceId, userIds): Promise<Map<string, PersonRef>>`, `createEvent(tx, data, participantUserIds): Promise<StoredCalendarEvent>`, `updateEvent(tx, budgetId, eventId, data, participantUserIds): Promise<StoredCalendarEvent>`, `softDelete(tx, budgetId, eventId): Promise<void>`, `listForWindow(db, budgetId, window): Promise<StoredCalendarEvent[]>` (нужен задаче 6).
  - `interface CalendarEventView { id; title; description; allDay; date; endDate; startTime; endTime; recurrence; interval; weekdays; repeatUntil; reminderMinutes; participants: PersonRef[]; createdBy: PersonRef; canEdit: boolean; createdAt: string; updatedAt: string }`
  - `class CalendarApplicationService`: `getEvent(userId, budgetId, eventId)`, `createEvent(userId, budgetId, input, key, requestId?)`, `updateEvent(userId, budgetId, eventId, input, key, requestId?)`, `deleteEvent(userId, budgetId, eventId, requestId?)`.
  - HTTP: `GET|PATCH|DELETE /api/v2/budgets/:budgetId/calendar/events/:eventId`, `POST /api/v2/budgets/:budgetId/calendar/events`.

- [ ] **Step 1: Падающие интеграционные тесты**

`apps/api/test/calendar-events.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;
let stranger: FamilyActor;

const base = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}/calendar/events`;

const weekly = (participantUserIds: string[] = []) => ({
  title: 'Кружок рисования',
  allDay: false,
  date: '2026-11-03',
  startTime: '17:00',
  endTime: '18:30',
  recurrence: 'WEEKLY',
  weekdays: [2],
  participantUserIds,
  reminderMinutes: 60,
});

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
  stranger = await env.register();
});

afterAll(async () => {
  for (const actor of [creator, stranger]) {
    await env.prisma.calendarEventParticipant.deleteMany({ where: { budgetId: actor.budgetId } });
    await env.prisma.calendarEvent.deleteMany({ where: { budgetId: actor.budgetId } });
  }
  await env.stop();
});

async function create(actor: FamilyActor, body: Record<string, unknown> = weekly()) {
  const response = await env.inject('POST', base(actor), actor, body);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string; canEdit: boolean }>();
}

function keyed(actor: FamilyActor, key: string | null, payload: Record<string, unknown>) {
  return env.server.inject({
    method: 'POST',
    url: base(actor),
    headers: {
      origin: 'http://localhost:3000',
      'x-csrf-token': actor.csrfToken,
      ...(key ? { 'idempotency-key': key } : {}),
    },
    cookies: { harmofin_session: actor.cookie },
    payload,
  });
}

describe('calendar events: create and read', () => {
  it('a member creates an event; it comes back in local time with people refs', async () => {
    const created = await create(editor, weekly([creator.user.id]));
    const response = await env.inject('GET', `${base(editor)}/${created.id}`, editor);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      title: 'Кружок рисования',
      allDay: false,
      date: '2026-11-03',
      startTime: '17:00',
      endTime: '18:30',
      recurrence: 'WEEKLY',
      weekdays: [2],
      reminderMinutes: 60,
      createdBy: { userId: editor.user.id, isActiveMember: true },
      participants: [{ userId: creator.user.id, isActiveMember: true }],
      canEdit: true,
    });
  });

  it('a viewer reads the event but cannot edit it', async () => {
    const created = await create(editor);
    const response = await env.inject('GET', `${base(viewer)}/${created.id}`, viewer);
    expect(response.json()).toMatchObject({ canEdit: false });
  });

  it('a viewer cannot create: 403 FORBIDDEN', async () => {
    const response = await env.inject('POST', base(viewer), viewer, weekly());
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('records an audit event without the description', async () => {
    const created = await create(editor, { ...weekly(), description: 'Взять альбом' });
    const audit = await env.prisma.auditEvent.findFirst({
      where: { entityType: 'calendar_event', entityId: created.id, action: 'CREATED' },
    });
    expect(audit).toMatchObject({ actorUserId: editor.user.id, budgetId: editor.budgetId });
    expect(JSON.stringify(audit?.newValues)).not.toContain('альбом');
  });
});

describe('calendar events: isolation', () => {
  it('another family gets 404 for the budget and for the event', async () => {
    const created = await create(editor);
    const foreignBudget = await env.inject('GET', `${base(creator)}/${created.id}`, stranger);
    expect(foreignBudget.statusCode).toBe(404);
    const ownBudget = await env.inject('GET', `${base(stranger)}/${created.id}`, stranger);
    expect(ownBudget.statusCode).toBe(404);
  });

  it('a participant must be an active member of this family: 422', async () => {
    const response = await env.inject('POST', base(editor), editor, weekly([stranger.user.id]));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'PARTICIPANT_NOT_MEMBER' });
  });
});

describe('calendar events: only the author edits', () => {
  it('the author updates the whole series', async () => {
    const created = await create(editor);
    const response = await env.inject('PATCH', `${base(editor)}/${created.id}`, editor, {
      ...weekly(),
      title: 'Кружок лепки',
      weekdays: [2, 4],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ title: 'Кружок лепки', weekdays: [2, 4] });
  });

  it('the family creator gets 403 NOT_EVENT_AUTHOR on a member event', async () => {
    const created = await create(editor);
    const patch = await env.inject('PATCH', `${base(creator)}/${created.id}`, creator, weekly());
    expect(patch.statusCode).toBe(403);
    expect(patch.json()).toMatchObject({ code: 'NOT_EVENT_AUTHOR' });
    const remove = await env.inject('DELETE', `${base(creator)}/${created.id}`, creator);
    expect(remove.statusCode).toBe(403);
    expect(remove.json()).toMatchObject({ code: 'NOT_EVENT_AUTHOR' });
  });

  it('a viewer gets 403 FORBIDDEN before the author check', async () => {
    const created = await create(editor);
    const response = await env.inject('DELETE', `${base(viewer)}/${created.id}`, viewer);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('delete is logical and hides the event', async () => {
    const created = await create(editor);
    const removed = await env.inject('DELETE', `${base(editor)}/${created.id}`, editor);
    expect(removed.statusCode).toBe(204);
    const row = await env.prisma.calendarEvent.findUnique({ where: { id: created.id } });
    expect(row?.deletedAt).not.toBeNull();
    expect((await env.inject('GET', `${base(editor)}/${created.id}`, editor)).statusCode).toBe(404);
    expect((await env.inject('DELETE', `${base(editor)}/${created.id}`, editor)).statusCode).toBe(404);
  });
});

describe('calendar events: former member', () => {
  it('their events stay visible and nobody can edit them', async () => {
    const leaving = await env.join(creator, await env.register(), 'EDITOR');
    const created = await create(leaving, weekly([editor.user.id]));
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: creator.workspaceId, userId: leaving.user.id },
      data: { isActive: false },
    });
    const read = await env.inject('GET', `${base(creator)}/${created.id}`, creator);
    expect(read.json()).toMatchObject({
      createdBy: { userId: leaving.user.id, isActiveMember: false },
      canEdit: false,
    });
    const own = await env.inject('PATCH', `${base(leaving)}/${created.id}`, leaving, weekly());
    expect(own.statusCode).toBe(403);
    expect(own.json()).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('calendar events: validation and idempotency', () => {
  it('returns field errors', async () => {
    const response = await env.inject('POST', base(editor), editor, {
      ...weekly(),
      endTime: '16:30',
      weekdays: [],
    });
    expect(response.statusCode).toBe(400);
    const fields = response
      .json<{ fieldErrors: Array<{ field: string }> }>()
      .fieldErrors.map((item) => item.field);
    expect(fields).toEqual(expect.arrayContaining(['endTime', 'weekdays']));
  });

  it('replays the same key and refuses the same key with another body', async () => {
    const key = `calendar-${randomUUID()}`;
    const first = await keyed(editor, key, weekly());
    const second = await keyed(editor, key, weekly());
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    const conflict = await keyed(editor, key, { ...weekly(), title: 'Другое' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('requires the Idempotency-Key header', async () => {
    expect((await keyed(editor, null, weekly())).statusCode).toBe(400);
  });
});
```

Если `PATCH` от бывшего участника возвращает 404, а не 403 (его отсекает `requireModel` раньше транзакции) — так ведут себя мутации этапа B; поправить ожидание на фактический код этапа B (`grep -rn "former\|isActive: false" apps/api/test/family-*.integration.test.ts`), смысл «правка запрещена» сохраняется.

- [ ] **Step 2: Убедиться, что падают**

Run: один файл `test/calendar-events.integration.test.ts` (команда в Global Constraints).
Expected: FAIL — 404 на `/calendar/events`.

- [ ] **Step 3: Репозиторий**

`apps/api/src/calendar/calendar.repository.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';

import { findPersonRefs, type PersonRef } from '../common/people/person-ref.repository.js';
import type { CalendarEventData, CalendarEventRow } from './calendar-event.mapper.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

const eventSelect = {
  id: true,
  budgetId: true,
  createdByUserId: true,
  title: true,
  description: true,
  allDay: true,
  startsOn: true,
  endsOn: true,
  startsAt: true,
  endsAt: true,
  recurrence: true,
  interval: true,
  weekdays: true,
  repeatUntil: true,
  reminderMinutes: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  participants: { select: { userId: true }, orderBy: { userId: 'asc' } },
} satisfies Prisma.CalendarEventSelect;

type SelectedEvent = Prisma.CalendarEventGetPayload<{ select: typeof eventSelect }>;
export type StoredCalendarEvent = CalendarEventRow & { createdAt: Date; updatedAt: Date };

function toRow(event: SelectedEvent): StoredCalendarEvent {
  const { participants, ...rest } = event;
  return { ...rest, participantUserIds: participants.map((item) => item.userId) };
}

const shiftedDate = (value: string, days: number): Date => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

export class CalendarRepository {
  async budgetTimezone(db: Db, budgetId: string): Promise<string> {
    const budget = await db.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: { timezone: true },
    });
    return budget.timezone;
  }

  async findEvent(db: Db, budgetId: string, eventId: string): Promise<StoredCalendarEvent | null> {
    const event = await db.calendarEvent.findFirst({
      where: { id: eventId, budgetId, deletedAt: null },
      select: eventSelect,
    });
    return event ? toRow(event) : null;
  }

  async activeMemberIds(db: Db, workspaceId: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await db.workspaceMembership.findMany({
      where: { workspaceId, userId: { in: userIds }, isActive: true },
      select: { userId: true },
    });
    return new Set(rows.map((row) => row.userId));
  }

  personRefs(db: Db, workspaceId: string, userIds: string[]): Promise<Map<string, PersonRef>> {
    return findPersonRefs(db, workspaceId, userIds);
  }

  async createEvent(
    tx: Tx,
    data: CalendarEventData & {
      id: string;
      workspaceId: string;
      budgetId: string;
      createdByUserId: string;
    },
    participantUserIds: string[],
  ): Promise<StoredCalendarEvent> {
    const event = await tx.calendarEvent.create({
      data: {
        ...data,
        participants: {
          create: participantUserIds.map((userId) => ({ userId, budgetId: data.budgetId })),
        },
      },
      select: eventSelect,
    });
    return toRow(event);
  }

  async updateEvent(
    tx: Tx,
    budgetId: string,
    eventId: string,
    data: CalendarEventData,
    participantUserIds: string[],
  ): Promise<StoredCalendarEvent> {
    await tx.calendarEventParticipant.deleteMany({ where: { budgetId, eventId } });
    await tx.calendarEventParticipant.createMany({
      data: participantUserIds.map((userId) => ({ eventId, budgetId, userId })),
    });
    await tx.calendarEvent.updateMany({ where: { id: eventId, budgetId }, data });
    const event = await tx.calendarEvent.findFirstOrThrow({
      where: { id: eventId, budgetId },
      select: eventSelect,
    });
    return toRow(event);
  }

  async softDelete(tx: Tx, budgetId: string, eventId: string): Promise<void> {
    await tx.calendarEvent.updateMany({
      where: { id: eventId, budgetId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Candidates whose occurrences may touch the window; expandOccurrences filters exactly.
   * Bounds are widened by a day for time zones and by 32 days for multi-day spans.
   */
  async listForWindow(
    db: Db,
    budgetId: string,
    window: { from: string; to: string },
  ): Promise<StoredCalendarEvent[]> {
    const upper = shiftedDate(window.to, 1);
    const lower = shiftedDate(window.from, -32);
    const events = await db.calendarEvent.findMany({
      where: {
        budgetId,
        deletedAt: null,
        AND: [
          { OR: [{ startsOn: { lte: upper } }, { startsAt: { lte: upper } }] },
          { OR: [{ repeatUntil: null }, { repeatUntil: { gte: lower } }] },
          {
            OR: [
              { recurrence: { not: 'NONE' } },
              { endsOn: { gte: lower } },
              { endsAt: { gte: lower } },
            ],
          },
        ],
      },
      select: eventSelect,
      orderBy: { id: 'asc' },
    });
    return events.map(toRow);
  }
}
```

`updateMany` по `{ id, budgetId }` вместо `update` по уникальному ключу — чтобы фильтр бюджета был в самом запросе без зависимости от имени составного ключа.

- [ ] **Step 4: DTO**

`apps/api/src/calendar/calendar.dto.ts`. Класс ссылки на человека переиспользовать: этап B сохранил OpenAPI-имя `AuthorRefResponse` (`grep -rn "class AuthorRefResponse" apps/api/src`); импортировать его оттуда, где он объявлен.

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AuthorRefResponse } from '<путь к классу AuthorRefResponse>';

const RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const REMINDERS = [15, 60, 1440, 10080];
const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

export class CalendarEventBody {
  @ApiProperty({ maxLength: 200, example: 'Кружок рисования' })
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true, type: String })
  description?: string | null;

  @ApiProperty()
  allDay!: boolean;

  @ApiProperty({ format: 'date', example: '2026-11-03', description: 'Дата начала, локальная для бюджета.' })
  date!: string;

  @ApiPropertyOptional({ format: 'date', nullable: true, type: String, description: 'Последний день события на весь день; по умолчанию — date.' })
  endDate?: string | null;

  @ApiPropertyOptional({ pattern: TIME_PATTERN, nullable: true, type: String, example: '17:00', description: 'Локальное время бюджета; обязательно без allDay.' })
  startTime?: string | null;

  @ApiPropertyOptional({ pattern: TIME_PATTERN, nullable: true, type: String, example: '18:30' })
  endTime?: string | null;

  @ApiProperty({ enum: RECURRENCES })
  recurrence!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 99, default: 1 })
  interval?: number;

  @ApiPropertyOptional({ type: [Number], description: 'ISO-дни недели 1–7, только у WEEKLY.' })
  weekdays?: number[];

  @ApiPropertyOptional({ format: 'date', nullable: true, type: String })
  repeatUntil?: string | null;

  @ApiProperty({ type: [String], format: 'uuid', description: 'Активные члены семьи; прав не дают.' })
  participantUserIds!: string[];

  @ApiPropertyOptional({ enum: REMINDERS, nullable: true, type: Number, description: 'Минуты до начала; у события на весь день — от 09:00.' })
  reminderMinutes?: number | null;
}

export class CalendarEventResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() allDay!: boolean;
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty({ format: 'date' }) endDate!: string;
  @ApiProperty({ nullable: true, type: String, example: '17:00' }) startTime!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '18:30' }) endTime!: string | null;
  @ApiProperty({ enum: RECURRENCES }) recurrence!: string;
  @ApiProperty() interval!: number;
  @ApiProperty({ type: [Number] }) weekdays!: number[];
  @ApiProperty({ format: 'date', nullable: true, type: String }) repeatUntil!: string | null;
  @ApiProperty({ enum: REMINDERS, nullable: true, type: Number }) reminderMinutes!: number | null;
  @ApiProperty({ type: [AuthorRefResponse] }) participants!: AuthorRefResponse[];
  @ApiProperty({ type: AuthorRefResponse }) createdBy!: AuthorRefResponse;
  @ApiProperty({ description: 'Может ли текущий участник изменять и удалять событие (только автор).' }) canEdit!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
```

Если у соседних DTO принят стиль «декоратор на отдельной строке» — привести к нему (prettier формат не меняет).

- [ ] **Step 5: Сервис**

`apps/api/src/calendar/calendar.application.service.ts`:

```ts
import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { personRefOf, type PersonRef } from '../common/people/person-ref.repository.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { findAccessActor, requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy, type AccessActor } from '../common/policies/budget-access.policy.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import type { PrismaService } from '../database/prisma.service.js';
import { toEventData, toLocalFields } from './calendar-event.mapper.js';
import { participantNotMember } from './calendar.errors.js';
import { CalendarRepository, type StoredCalendarEvent } from './calendar.repository.js';
import type { CalendarEventInput } from './calendar.schemas.js';

type Tx = Prisma.TransactionClient;

export interface CalendarEventView {
  id: string;
  title: string;
  description: string | null;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  recurrence: string;
  interval: number;
  weekdays: number[];
  repeatUntil: string | null;
  reminderMinutes: number | null;
  participants: PersonRef[];
  createdBy: PersonRef;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

type Write = (
  tx: Tx,
  actor: AccessActor,
  workspaceId: string,
) => Promise<{ status: number; event: StoredCalendarEvent }>;

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class CalendarApplicationService {
  protected readonly repository = new CalendarRepository();
  protected readonly access = new BudgetAccessPolicy();

  constructor(
    protected readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    protected readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async getEvent(userId: string, budgetId: string, eventId: string): Promise<CalendarEventView> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      const actor = await findAccessActor(tx, model.workspaceId, userId);
      if (!actor) throw resourceNotFound();
      const event = await this.repository.findEvent(tx, budgetId, eventId);
      if (!event) throw resourceNotFound();
      return this.view(tx, model.workspaceId, budgetId, event, actor);
    });
  }

  createEvent(
    userId: string,
    budgetId: string,
    input: CalendarEventInput,
    key: string,
    requestId?: string,
  ): Promise<CalendarEventView> {
    return this.mutate(userId, budgetId, key, 'calendar.event.create', input, async (tx, actor, workspaceId) => {
      this.access.requireWriter(actor);
      await this.requireParticipants(tx, workspaceId, input.participantUserIds);
      const timezone = await this.repository.budgetTimezone(tx, budgetId);
      const event = await this.repository.createEvent(
        tx,
        {
          ...toEventData(input, timezone),
          id: createUuidV7(),
          workspaceId,
          budgetId,
          createdByUserId: userId,
        },
        input.participantUserIds,
      );
      await this.audit(tx, { workspaceId, budgetId, actorUserId: userId, entityId: event.id, action: 'CREATED', after: event, requestId });
      return { status: 201, event };
    });
  }

  updateEvent(
    userId: string,
    budgetId: string,
    eventId: string,
    input: CalendarEventInput,
    key: string,
    requestId?: string,
  ): Promise<CalendarEventView> {
    return this.mutate(userId, budgetId, key, `calendar.event.update:${eventId}`, input, async (tx, actor, workspaceId) => {
      const current = await this.repository.findEvent(tx, budgetId, eventId);
      if (!current) throw resourceNotFound();
      this.access.requireEventAuthor(actor, current);
      await this.requireParticipants(tx, workspaceId, input.participantUserIds);
      const timezone = await this.repository.budgetTimezone(tx, budgetId);
      const event = await this.repository.updateEvent(
        tx,
        budgetId,
        eventId,
        toEventData(input, timezone),
        input.participantUserIds,
      );
      await this.audit(tx, { workspaceId, budgetId, actorUserId: userId, entityId: eventId, action: 'UPDATED', before: current, after: event, requestId });
      return { status: 200, event };
    });
  }

  async deleteEvent(userId: string, budgetId: string, eventId: string, requestId?: string): Promise<void> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    await this.prisma.$transaction(async (tx) => {
      await this.lockBudget(tx, budgetId);
      const actor = await requireAccessActor(tx, model.workspaceId, userId);
      const current = await this.repository.findEvent(tx, budgetId, eventId);
      if (!current) throw resourceNotFound();
      this.access.requireEventAuthor(actor, current);
      await this.repository.softDelete(tx, budgetId, eventId);
      await this.audit(tx, { workspaceId: model.workspaceId, budgetId, actorUserId: userId, entityId: eventId, action: 'DELETED', before: current, requestId });
    });
  }

  protected async view(
    tx: Tx,
    workspaceId: string,
    budgetId: string,
    event: StoredCalendarEvent,
    actor: AccessActor,
  ): Promise<CalendarEventView> {
    const timezone = await this.repository.budgetTimezone(tx, budgetId);
    const people = await this.repository.personRefs(tx, workspaceId, [
      event.createdByUserId,
      ...event.participantUserIds,
    ]);
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      allDay: event.allDay,
      ...toLocalFields(event, timezone),
      recurrence: event.recurrence,
      interval: event.interval,
      weekdays: event.weekdays,
      repeatUntil: event.repeatUntil ? isoDate(event.repeatUntil) : null,
      reminderMinutes: event.reminderMinutes,
      participants: event.participantUserIds.map((id) => personRefOf(people, id)),
      createdBy: personRefOf(people, event.createdByUserId),
      canEdit: this.access.canEditEvent(actor, event),
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }

  private async mutate(
    userId: string,
    budgetId: string,
    key: string,
    operation: string,
    input: CalendarEventInput,
    write: Write,
  ): Promise<CalendarEventView> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockBudget(tx, budgetId);
      return this.idempotency.execute<CalendarEventView & Record<string, unknown>>(
        tx,
        { budgetId, actorUserId: userId, key, operation, requestHash: hash(input) },
        async () => {
          const actor = await requireAccessActor(tx, model.workspaceId, userId);
          const { status, event } = await write(tx, actor, model.workspaceId);
          const body = await this.view(tx, model.workspaceId, budgetId, event, actor);
          return { status, body: body as CalendarEventView & Record<string, unknown> };
        },
      );
    });
    return result.body;
  }

  private async lockBudget(tx: Tx, budgetId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "budgets" WHERE "id" = ${budgetId}::uuid FOR UPDATE`;
  }

  private async requireParticipants(tx: Tx, workspaceId: string, userIds: string[]): Promise<void> {
    const active = await this.repository.activeMemberIds(tx, workspaceId, userIds);
    if (userIds.some((id) => !active.has(id))) throw participantNotMember();
  }

  private async audit(
    tx: Tx,
    entry: {
      workspaceId: string;
      budgetId: string;
      actorUserId: string;
      entityId: string;
      action: 'CREATED' | 'UPDATED' | 'DELETED';
      before?: StoredCalendarEvent;
      after?: StoredCalendarEvent;
      requestId?: string | undefined;
    },
  ): Promise<void> {
    // Rule fields only: no title, description or participant names in the audit payload.
    const values = (event: StoredCalendarEvent) => ({
      allDay: event.allDay,
      startsOn: event.startsOn?.toISOString() ?? null,
      startsAt: event.startsAt?.toISOString() ?? null,
      recurrence: event.recurrence,
      interval: event.interval,
      weekdays: event.weekdays,
      repeatUntil: event.repeatUntil?.toISOString() ?? null,
      reminderMinutes: event.reminderMinutes,
      participantCount: event.participantUserIds.length,
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: entry.actorUserId,
        workspaceId: entry.workspaceId,
        budgetId: entry.budgetId,
        entityType: 'calendar_event',
        entityId: entry.entityId,
        action: entry.action,
        source: 'API',
        requestId: entry.requestId ?? null,
        ...(entry.before ? { oldValues: values(entry.before) } : {}),
        ...(entry.after ? { newValues: values(entry.after) } : {}),
      },
    });
  }
}
```

Сверить перед реализацией: (а) тип поля `AuditEvent.action` — если это enum без `DELETED`, использовать значение, которым логически удаляются операции (`grep -rn "action: '" apps/api/src/v2-transactions | head`); (б) `requireWriter` у `BudgetAccessPolicy` публичный; (в) `lockBudget` — если в соседних сервисах есть общий хелпер блокировки бюджета, использовать его вместо локального SQL. Тексты `title` в audit не пишутся сознательно (персональные данные семьи).

- [ ] **Step 6: Контроллер и модуль**

`apps/api/src/calendar/calendar.controller.ts` — импорты, `AuthenticatedRequest`, `idempotencyHeader`, `validKey` и `contextOf` — как в `apps/api/src/plans/income-plan-v2.controller.ts` (скопировать функции). `idPipe = new ZodValidationPipe(calendarUuidSchema)`.

```ts
@ApiTags('calendar (v2)')
@Controller({ path: 'budgets/:budgetId/calendar', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class CalendarController {
  constructor(
    @Inject(CalendarApplicationService) private readonly service: CalendarApplicationService,
  ) {}

  @Get('events/:eventId')
  @ApiOperation({
    summary: 'Событие календаря с правилом повторения',
    description:
      'Дата и время — локальные для часового пояса бюджета. Доступно любому активному участнику; canEdit — только у автора. Коды: 401, 404 RESOURCE_NOT_FOUND (чужой бюджет или удалённое событие), 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiOkResponse({ type: CalendarEventResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  getEvent(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('eventId', idPipe) eventId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getEvent(contextOf(request).userId, budgetId, eventId);
  }

  @Post('events')
  @HttpCode(201)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Создать событие календаря',
    description:
      'OWNER и EDITOR. Участники — активные члены семьи, прав не дают. Время — в часовом поясе бюджета. Коды: 400 VALIDATION_FAILED (fieldErrors), 401, 403 FORBIDDEN|CSRF_INVALID, 404, 409 IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH, 422 PARTICIPANT_NOT_MEMBER.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: CalendarEventBody })
  @ApiCreatedResponse({ type: CalendarEventResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  createEvent(
    @Param('budgetId', idPipe) budgetId: string,
    @Body(new ZodValidationPipe(calendarEventInputSchema)) input: CalendarEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createEvent(contextOf(request).userId, budgetId, input, validKey(key), request.id);
  }

  @Patch('events/:eventId')
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Изменить событие (всю серию)',
    description:
      'Тело полное, как при создании. Только автор. Коды: 400 VALIDATION_FAILED, 401, 403 FORBIDDEN|NOT_EVENT_AUTHOR|CSRF_INVALID, 404, 409 IDEMPOTENCY_CONFLICT|MODEL_VERSION_MISMATCH, 422 PARTICIPANT_NOT_MEMBER.',
  })
  @ApiHeader(idempotencyHeader)
  @ApiBody({ type: CalendarEventBody })
  @ApiOkResponse({ type: CalendarEventResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  updateEvent(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('eventId', idPipe) eventId: string,
    @Body(new ZodValidationPipe(calendarEventInputSchema)) input: CalendarEventInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateEvent(contextOf(request).userId, budgetId, eventId, input, validKey(key), request.id);
  }

  @Delete('events/:eventId')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Удалить событие и все его повторы',
    description:
      'Логическое удаление, только автор. Уже созданные напоминания остаются. Коды: 401, 403 FORBIDDEN|NOT_EVENT_AUTHOR|CSRF_INVALID, 404, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiNoContentResponse()
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  async deleteEvent(
    @Param('budgetId', idPipe) budgetId: string,
    @Param('eventId', idPipe) eventId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.deleteEvent(contextOf(request).userId, budgetId, eventId, request.id);
  }
}
```

`apps/api/src/calendar/calendar.module.ts`:

```ts
import { DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { CalendarApplicationService } from './calendar.application.service.js';
import { CalendarController } from './calendar.controller.js';

@Module({})
export class CalendarModule {
  static register(): DynamicModule {
    return {
      module: CalendarModule,
      controllers: [CalendarController],
      providers: [
        {
          provide: CalendarApplicationService,
          useFactory: (prisma: PrismaService) =>
            new CalendarApplicationService(prisma, new IdempotencyService(), new PlanModelPolicy(prisma)),
          inject: [PrismaService],
        },
      ],
    };
  }
}
```

В `app.module.ts` — `import { CalendarModule } from './calendar/calendar.module.js';` и `CalendarModule.register(),` рядом с `PlansCalendarModule.register()`. Тест `apps/api/src/di-explicit-inject.test.ts` требует `@Inject` у параметров конструкторов контроллеров — у `CalendarController` он есть.

- [ ] **Step 7: Тесты проходят**

Run: один файл `test/calendar-events.integration.test.ts`, затем `pnpm --filter @harmofin/api test`
Expected: PASS.

- [ ] **Step 8: OpenAPI и проверки**

Run: `node scripts/openapi/generate.mjs && pnpm exec prettier --write openapi.json && pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Проверить в `openapi.json`: пути `/api/v2/budgets/{budgetId}/calendar/events` и `/{eventId}`, `Idempotency-Key` у POST и PATCH, коды 403 и 422 описаны.

```bash
git add apps/api/src/calendar apps/api/src/app.module.ts apps/api/test/calendar-events.integration.test.ts openapi.json
```

Коммит: `feat(api): события семейного календаря`.

### Task 6: Лента календаря

**Files:**
- Create: `apps/api/src/calendar/calendar-feed.ts`, `apps/api/src/calendar/calendar-feed.test.ts`
- Modify: `apps/api/src/calendar/calendar.application.service.ts` (метод `feed`, четвёртый параметр конструктора), `calendar.controller.ts` (`GET /calendar`), `calendar.dto.ts` (классы ленты), `calendar.module.ts`, `apps/api/src/plans-calendar/plans-calendar.module.ts` (`exports`)
- Modify: `openapi.json`
- Test: `apps/api/test/calendar-feed.integration.test.ts`

**Interfaces:**
- Consumes: `expandOccurrences` (1), `toRecurringEvent` (4), `CalendarRepository.listForWindow` и `CalendarApplicationService` (5), существующий `PlansCalendarApplicationService.calendar(userId, budgetId, { month, ownerUserId? })`.
- Produces:
  - `interface CalendarFeedEventItem { kind: 'EVENT'; eventId; occurrenceDate; title; allDay; startDate; endDate; startTime: string | null; endTime: string | null; startsAt: string | null; endsAt: string | null; recurrence: string; participants: PersonRef[]; createdBy: PersonRef; canEdit: boolean }`
  - `interface CalendarFeedPlanItem { kind: 'PLAN'; occurrenceId; planId; planKind: 'OBLIGATION' | 'INCOME_PLAN'; title; amountMinor: string; status: string; isOverdue: boolean; scheduledOn: string; owner: PersonRef }`
  - `type CalendarFeedItem`, `sortFeed(items)`, `monthsOf(window): string[]`
  - `CalendarApplicationService.feed(userId, budgetId, query): Promise<{ from: string; to: string; items: CalendarFeedItem[] }>`
  - HTTP `GET /api/v2/budgets/:budgetId/calendar?from&to[&participantUserId][&includePlans]`.

- [ ] **Step 1: Падающий unit-тест порядка и месяцев**

`apps/api/src/calendar/calendar-feed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { monthsOf, sortFeed, type CalendarFeedItem } from './calendar-feed.js';

const person = { userId: 'u', displayName: 'Алия', isActiveMember: true };
const event = (title: string, date: string, startTime: string | null): CalendarFeedItem => ({
  kind: 'EVENT',
  eventId: title,
  occurrenceDate: date,
  title,
  allDay: startTime === null,
  startDate: date,
  endDate: date,
  startTime,
  endTime: startTime,
  startsAt: null,
  endsAt: null,
  recurrence: 'NONE',
  participants: [],
  createdBy: person,
  canEdit: false,
});
const plan = (title: string, date: string): CalendarFeedItem => ({
  kind: 'PLAN',
  occurrenceId: title,
  planId: title,
  planKind: 'OBLIGATION',
  title,
  amountMinor: '100',
  status: 'PENDING',
  isOverdue: false,
  scheduledOn: date,
  owner: person,
});

describe('sortFeed', () => {
  it('orders by date, then items without time, then time, then title', () => {
    const sorted = sortFeed([
      event('Кино', '2026-10-30', '19:30'),
      event('Завтрак', '2026-10-30', '09:30'),
      plan('Школа', '2026-10-30'),
      event('Поездка', '2026-10-31', null),
      event('Аптека', '2026-10-30', null),
    ]);
    expect(sorted.map((item) => item.title)).toEqual(['Аптека', 'Школа', 'Завтрак', 'Кино', 'Поездка']);
  });
});

describe('monthsOf', () => {
  it('lists every month the window touches', () => {
    expect(monthsOf({ from: '2026-10-26', to: '2026-12-06' })).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(monthsOf({ from: '2026-12-20', to: '2027-01-10' })).toEqual(['2026-12', '2027-01']);
    expect(monthsOf({ from: '2026-11-01', to: '2026-11-30' })).toEqual(['2026-11']);
  });
});
```

- [ ] **Step 2: Падающий интеграционный тест ленты**

`apps/api/test/calendar-feed.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;

const events = (actor: FamilyActor) => `/api/v2/budgets/${actor.budgetId}/calendar/events`;
const feed = (actor: FamilyActor, query: string) =>
  `/api/v2/budgets/${actor.budgetId}/calendar?${query}`;

type FeedBody = { items: Array<Record<string, unknown> & { kind: string; title: string }> };

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  await env.prisma.budget.update({ where: { id: creator.budgetId }, data: { timezone: 'Europe/Moscow' } });
  const weekly = await env.inject('POST', events(editor), editor, {
    title: 'Кружок',
    allDay: false,
    date: '2026-11-03',
    startTime: '17:00',
    endTime: '18:30',
    recurrence: 'WEEKLY',
    weekdays: [2],
    participantUserIds: [creator.user.id],
  });
  expect(weekly.statusCode, weekly.body).toBe(201);
  const birthday = await env.inject('POST', events(creator), creator, {
    title: 'День рождения',
    allDay: true,
    date: '2026-11-10',
    recurrence: 'NONE',
    participantUserIds: [],
  });
  expect(birthday.statusCode, birthday.body).toBe(201);
});

afterAll(async () => {
  await env.prisma.calendarEventParticipant.deleteMany({ where: { budgetId: creator.budgetId } });
  await env.prisma.calendarEvent.deleteMany({ where: { budgetId: creator.budgetId } });
  await env.stop();
});

describe('calendar feed', () => {
  it('expands occurrences in order with local and UTC times', async () => {
    const response = await env.inject('GET', feed(creator, 'from=2026-11-01&to=2026-11-14&includePlans=false'), creator);
    expect(response.statusCode, response.body).toBe(200);
    const items = response.json<FeedBody>().items;
    expect(items.map((item) => [item.title, item.occurrenceDate])).toEqual([
      ['Кружок', '2026-11-03'],
      ['День рождения', '2026-11-10'],
      ['Кружок', '2026-11-10'],
    ]);
    expect(items[0]).toMatchObject({
      kind: 'EVENT',
      startTime: '17:00',
      endTime: '18:30',
      startsAt: '2026-11-03T14:00:00.000Z',
      canEdit: false,
      createdBy: { userId: editor.user.id },
      participants: [{ userId: creator.user.id }],
    });
  });

  it('"mine" keeps events I created or take part in', async () => {
    const editorMine = await env.inject(
      'GET',
      feed(editor, `from=2026-11-01&to=2026-11-14&includePlans=false&participantUserId=${editor.user.id}`),
      editor,
    );
    expect(editorMine.json<FeedBody>().items.map((item) => item.title)).toEqual(['Кружок', 'Кружок']);
    const creatorMine = await env.inject(
      'GET',
      feed(creator, `from=2026-11-01&to=2026-11-14&includePlans=false&participantUserId=${creator.user.id}`),
      creator,
    );
    expect(creatorMine.json<FeedBody>().items).toHaveLength(3);
  });

  it('rejects a range longer than 62 days', async () => {
    const response = await env.inject('GET', feed(creator, 'from=2026-01-01&to=2026-03-04'), creator);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('plan items repeat the plans calendar of the same month', async () => {
    // Создание обязательства — тем же запросом, что в ближайшем интеграционном тесте планов этапа B
    // (grep -rln "obligations" apps/api/test); здесь — разовое обязательство «Аренда» на 15.11.2026, 45 000,00.
    await createObligation(creator, 'Аренда', '45000.00', '2026-11-15');

    const calendarFeed = await env.inject('GET', feed(creator, 'from=2026-11-01&to=2026-11-30'), creator);
    const planItems = calendarFeed.json<FeedBody>().items.filter((item) => item.kind === 'PLAN');
    const plans = await env.inject('GET', `/api/v2/budgets/${creator.budgetId}/plans/calendar?month=2026-11`, creator);
    const expected = plans
      .json<{ items: Array<{ occurrenceId: string; expectedMinor: string; status: string; overdue: boolean }> }>()
      .items.filter((item) => item.status !== 'CANCELLED' && item.status !== 'SKIPPED');
    expect(planItems.map((item) => [item.occurrenceId, item.amountMinor, item.status, item.isOverdue])).toEqual(
      expected.map((item) => [item.occurrenceId, item.expectedMinor, item.status, item.overdue]),
    );
    expect(planItems.find((item) => item.title === 'Аренда')).toMatchObject({
      amountMinor: '4500000',
      planKind: 'OBLIGATION',
    });

    const hidden = await env.inject('GET', feed(creator, 'from=2026-11-01&to=2026-11-30&includePlans=false'), creator);
    expect(hidden.json<FeedBody>().items.some((item) => item.kind === 'PLAN')).toBe(false);
  });
});
```

Функцию `createObligation(actor, name, amount, scheduledOn)` написать в этом файле по образцу создания обязательства в существующем тесте (путь, тело, категория через `env.categoryId(actor.budgetId, 'EXPENSE')`), с проверкой `201`. Порядок в `expected` у `PlansCalendar` может отличаться от порядка ленты; если так — сравнивать отсортированные по `occurrenceId` массивы.

- [ ] **Step 3: Убедиться, что падают**

Run: `pnpm --filter @harmofin/api exec vitest run src/calendar/calendar-feed.test.ts` и один файл `test/calendar-feed.integration.test.ts`
Expected: FAIL.

- [ ] **Step 4: `calendar-feed.ts`**

```ts
import type { PersonRef } from '../common/people/person-ref.repository.js';

export interface CalendarFeedEventItem {
  kind: 'EVENT';
  eventId: string;
  occurrenceDate: string;
  title: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
  recurrence: string;
  participants: PersonRef[];
  createdBy: PersonRef;
  canEdit: boolean;
}

export interface CalendarFeedPlanItem {
  kind: 'PLAN';
  occurrenceId: string;
  planId: string;
  planKind: 'OBLIGATION' | 'INCOME_PLAN';
  title: string;
  amountMinor: string;
  status: string;
  isOverdue: boolean;
  scheduledOn: string;
  owner: PersonRef;
}

export type CalendarFeedItem = CalendarFeedEventItem | CalendarFeedPlanItem;

const dateOf = (item: CalendarFeedItem): string =>
  item.kind === 'EVENT' ? item.occurrenceDate : item.scheduledOn;
const timeOf = (item: CalendarFeedItem): string | null =>
  item.kind === 'EVENT' && !item.allDay ? item.startTime : null;

/** Day by day; inside a day items without time (all-day events, payments) first, then by time, then title. */
export function sortFeed(items: CalendarFeedItem[]): CalendarFeedItem[] {
  return [...items].sort((left, right) => {
    const byDate = dateOf(left).localeCompare(dateOf(right));
    if (byDate !== 0) return byDate;
    const leftTime = timeOf(left);
    const rightTime = timeOf(right);
    if (leftTime === null && rightTime !== null) return -1;
    if (leftTime !== null && rightTime === null) return 1;
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return leftTime.localeCompare(rightTime);
    }
    return left.title.localeCompare(right.title, 'ru');
  });
}

export function monthsOf(window: { from: string; to: string }): string[] {
  const months: string[] = [];
  let [year, month] = window.from.slice(0, 7).split('-').map(Number) as [number, number];
  const last = window.to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= last) return months;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}
```

- [ ] **Step 5: Метод `feed`**

Конструктор `CalendarApplicationService` получает четвёртый параметр `private readonly plansCalendar: PlansCalendarApplicationService` (импорт из `../plans-calendar/plans-calendar.application.service.js`). Метод (импорты: `expandOccurrences` из `./calendar-recurrence.js`, `toRecurringEvent` из `./calendar-event.mapper.js`, типы и функции из `./calendar-feed.js`, `CalendarFeedQuery` из `./calendar.schemas.js`):

```ts
  async feed(
    userId: string,
    budgetId: string,
    query: CalendarFeedQuery,
  ): Promise<{ from: string; to: string; items: CalendarFeedItem[] }> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const window = { from: query.from, to: query.to };
    const person = query.participantUserId;

    const events = await this.prisma.$transaction(async (tx) => {
      const actor = await findAccessActor(tx, model.workspaceId, userId);
      if (!actor) throw resourceNotFound();
      const timezone = await this.repository.budgetTimezone(tx, budgetId);
      const rows = (await this.repository.listForWindow(tx, budgetId, window)).filter(
        (row) => !person || row.createdByUserId === person || row.participantUserIds.includes(person),
      );
      const people = await this.repository.personRefs(
        tx,
        model.workspaceId,
        rows.flatMap((row) => [row.createdByUserId, ...row.participantUserIds]),
      );
      return rows.flatMap((row) =>
        expandOccurrences(toRecurringEvent(row, timezone), window, timezone).map(
          (occurrence): CalendarFeedEventItem => ({
            kind: 'EVENT',
            eventId: row.id,
            title: row.title,
            allDay: row.allDay,
            recurrence: row.recurrence,
            ...occurrence,
            participants: row.participantUserIds.map((id) => personRefOf(people, id)),
            createdBy: personRefOf(people, row.createdByUserId),
            canEdit: this.access.canEditEvent(actor, row),
          }),
        ),
      );
    });

    const plans: CalendarFeedPlanItem[] = [];
    if (query.includePlans !== false) {
      for (const month of monthsOf(window)) {
        const calendar = await this.plansCalendar.calendar(userId, budgetId, {
          month,
          ...(person ? { ownerUserId: person } : {}),
        });
        for (const item of calendar.items) {
          if (item.scheduledOn < window.from || item.scheduledOn > window.to) continue;
          if (item.status === 'CANCELLED' || item.status === 'SKIPPED') continue;
          plans.push({
            kind: 'PLAN',
            occurrenceId: item.occurrenceId,
            planId: item.planId,
            planKind: item.kind,
            title: item.name,
            amountMinor: item.expectedMinor,
            status: item.status,
            isOverdue: item.overdue,
            scheduledOn: item.scheduledOn,
            owner: item.owner,
          });
        }
      }
    }
    return { from: window.from, to: window.to, items: sortFeed([...events, ...plans]) };
  }
```

Сверить форму `PlansCalendarItemView` (`apps/api/src/plans-calendar/plans-calendar.application.service.ts`): если `owner` там `{ id, displayName, isActiveMember }`, преобразовать в `{ userId: owner.id, displayName, isActiveMember }`; если `scheduledOn` — `Date`, привести к `YYYY-MM-DD`.

`calendar.module.ts`: `imports: [PlansCalendarModule.register()]`, фабрика `(prisma: PrismaService, plans: PlansCalendarApplicationService) => new CalendarApplicationService(prisma, new IdempotencyService(), new PlanModelPolicy(prisma), plans)` с `inject: [PrismaService, PlansCalendarApplicationService]`. В `plans-calendar.module.ts` — `exports: [PlansCalendarApplicationService]`. Если двойная регистрация `PlansCalendarModule.register()` (в `app.module.ts` и здесь) даёт дубль контроллера — вместо импорта модуля создать сервис прямо в фабрике: `new PlansCalendarApplicationService(prisma, new PlanModelPolicy(prisma))` (так он создаётся в его собственном модуле), без изменения `plans-calendar.module.ts`.

- [ ] **Step 6: DTO и маршрут**

В `calendar.dto.ts` добавить:

```ts
export class CalendarFeedItemResponse {
  @ApiProperty({ enum: ['EVENT', 'PLAN'] }) kind!: 'EVENT' | 'PLAN';
  @ApiProperty() title!: string;

  // kind = EVENT
  @ApiPropertyOptional({ format: 'uuid' }) eventId?: string;
  @ApiPropertyOptional({ format: 'date', description: 'Локальная дата начала вхождения — его идентификатор в серии.' }) occurrenceDate?: string;
  @ApiPropertyOptional() allDay?: boolean;
  @ApiPropertyOptional({ format: 'date' }) startDate?: string;
  @ApiPropertyOptional({ format: 'date' }) endDate?: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: '17:00', description: 'Локальное время бюджета.' }) startTime?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: '18:30' }) endTime?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) startsAt?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) endsAt?: string | null;
  @ApiPropertyOptional({ enum: ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] }) recurrence?: string;
  @ApiPropertyOptional({ type: [AuthorRefResponse] }) participants?: AuthorRefResponse[];
  @ApiPropertyOptional({ type: AuthorRefResponse }) createdBy?: AuthorRefResponse;
  @ApiPropertyOptional() canEdit?: boolean;

  // kind = PLAN
  @ApiPropertyOptional({ format: 'uuid' }) occurrenceId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) planId?: string;
  @ApiPropertyOptional({ enum: ['OBLIGATION', 'INCOME_PLAN'] }) planKind?: 'OBLIGATION' | 'INCOME_PLAN';
  @ApiPropertyOptional({ example: '4500000', description: 'Ожидаемая сумма вхождения, minor units (как expectedMinor календаря планов).' }) amountMinor?: string;
  @ApiPropertyOptional({ description: 'Статус вхождения плана.' }) status?: string;
  @ApiPropertyOptional() isOverdue?: boolean;
  @ApiPropertyOptional({ format: 'date' }) scheduledOn?: string;
  @ApiPropertyOptional({ type: AuthorRefResponse }) owner?: AuthorRefResponse;
}

export class CalendarFeedResponse {
  @ApiProperty({ format: 'date' }) from!: string;
  @ApiProperty({ format: 'date' }) to!: string;
  @ApiProperty({ type: [CalendarFeedItemResponse] }) items!: CalendarFeedItemResponse[];
}
```

В контроллер, первым методом класса:

```ts
  @Get()
  @ApiOperation({
    summary: 'Лента календаря: вхождения событий и платежи планов за диапазон',
    description:
      'Диапазон не больше 62 дней. События разворачиваются по правилу повторения в часовом поясе бюджета; startTime/endTime — локальное время, startsAt/endsAt — UTC. Платежи (kind = PLAN) — те же вхождения и суммы minor units, что у календаря планов, без отменённых и пропущенных; только просмотр. participantUserId — «Мои»: события, где пользователь автор или участник, и платежи его планов. includePlans=false скрывает платежи. Доступно любому активному участнику. Коды: 400 VALIDATION_FAILED, 401, 404, 409 MODEL_VERSION_MISMATCH.',
  })
  @ApiQuery({ name: 'from', required: true, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'to', required: true, schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'participantUserId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'includePlans', required: false, schema: { type: 'boolean', default: true } })
  @ApiOkResponse({ type: CalendarFeedResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  feed(
    @Param('budgetId', idPipe) budgetId: string,
    @Query(new ZodValidationPipe(calendarFeedQuerySchema)) query: CalendarFeedQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.feed(contextOf(request).userId, budgetId, query);
  }
```

- [ ] **Step 7: Тесты, OpenAPI, проверки**

Run: `pnpm --filter @harmofin/api test`, оба интеграционных файла календаря, затем весь `pnpm test:integration` (регрессия планов и этапа B).
Run: `node scripts/openapi/generate.mjs && pnpm exec prettier --write openapi.json && pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`

```bash
git add apps/api/src/calendar apps/api/src/plans-calendar/plans-calendar.module.ts apps/api/test/calendar-feed.integration.test.ts openapi.json
```

Коммит: `feat(api): лента семейного календаря с платежами планов`. **Конец PR 2.**

---

## PR 3 — напоминания

Перед стартом: свежий `main` после мержа PR 2, ветка `feat/family-calendar-reminders`.

### Task 7: Задача worker `EVALUATE_CALENDAR_REMINDERS`

**Files:**
- Create: `apps/worker/src/calendar-reminder.ts`, `apps/worker/src/calendar-reminder.test.ts`
- Create: `apps/worker/src/calendar-reminder.handler.ts`, `apps/worker/src/calendar-reminder.handler.test.ts`
- Modify: `apps/worker/src/job.repository.ts` (`recurringJobs`), `apps/worker/src/job-runner.ts` (интервалы), `apps/worker/src/main.ts` (обработчики), `apps/worker/src/job-runner.test.ts`

**Interfaces:**
- Consumes: `expandOccurrences`, `addDays`, `Occurrence`, `RecurringEvent` из `apps/worker/src/calendar-recurrence.ts`; `localToUtc`, `utcToLocal` из `apps/worker/src/zoned-time.ts` (задача 2); таблицы задачи 3.
- Produces:
  - `REMINDER_LOOKBACK_MS = 1_800_000`, `ALL_DAY_REMINDER_TIME = '09:00'`
  - `reminderWindow(now: Date, reminderMinutes: number, timezone: string): { from: string; to: string }`
  - `reminderMoment(occurrence: Occurrence, reminderMinutes: number, timezone: string): Date`
  - `isReminderDue(moment: Date, now: Date): boolean` — `moment ∈ (now − 30 мин, now]`
  - `reminderBody(occurrence: Occurrence, now: Date, timezone: string): string`
  - `reminderKey(eventId: string, occurrenceDate: string, reminderMinutes: number): string`
  - `class CalendarReminderHandler { constructor(prisma: PrismaClient); execute(now: Date): Promise<void> }`

- [ ] **Step 1: Падающие тесты правила**

`apps/worker/src/calendar-reminder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { Occurrence } from './calendar-recurrence.js';
import {
  isReminderDue,
  reminderBody,
  reminderKey,
  reminderMoment,
  reminderWindow,
} from './calendar-reminder.js';

const tz = 'Europe/Moscow';
const timed: Occurrence = {
  occurrenceDate: '2026-11-03',
  startDate: '2026-11-03',
  endDate: '2026-11-03',
  startsAt: '2026-11-03T14:00:00.000Z',
  endsAt: '2026-11-03T15:30:00.000Z',
  startTime: '17:00',
  endTime: '18:30',
};
const allDay: Occurrence = {
  occurrenceDate: '2026-11-03',
  startDate: '2026-11-03',
  endDate: '2026-11-03',
  startsAt: null,
  endsAt: null,
  startTime: null,
  endTime: null,
};

describe('calendar reminder rule', () => {
  it('a timed occurrence is reminded reminderMinutes before its start', () => {
    expect(reminderMoment(timed, 60, tz).toISOString()).toBe('2026-11-03T13:00:00.000Z');
  });

  it('an all-day occurrence counts from 09:00 in the budget time zone', () => {
    expect(reminderMoment(allDay, 1440, tz).toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });

  it('is due only within the last 30 minutes', () => {
    const moment = new Date('2026-11-03T13:00:00.000Z');
    expect(isReminderDue(moment, new Date('2026-11-03T12:59:59.000Z'))).toBe(false);
    expect(isReminderDue(moment, new Date('2026-11-03T13:00:00.000Z'))).toBe(true);
    expect(isReminderDue(moment, new Date('2026-11-03T13:29:59.000Z'))).toBe(true);
    expect(isReminderDue(moment, new Date('2026-11-03T13:30:00.000Z'))).toBe(false);
  });

  it('the expansion window covers the lookback and the reminder lead', () => {
    // 02.11 21:10Z = 03.11 00:10 МСК; −30 мин → 02.11; +7 дней → 10.11; ±1 день запаса.
    expect(reminderWindow(new Date('2026-11-02T21:10:00.000Z'), 10080, tz)).toEqual({
      from: '2026-11-01',
      to: '2026-11-11',
    });
  });

  it('writes relative Russian copy', () => {
    const now = new Date('2026-11-03T13:00:00.000Z');
    expect(reminderBody(timed, now, tz)).toBe('Сегодня в 17:00');
    expect(reminderBody(allDay, new Date('2026-11-02T06:00:00.000Z'), tz)).toBe('Завтра, весь день');
    expect(
      reminderBody({ ...timed, startDate: '2026-11-10', occurrenceDate: '2026-11-10' }, now, tz),
    ).toBe('10 ноября в 17:00');
  });

  it('builds the dedupe key', () => {
    expect(reminderKey('event-1', '2026-11-03', 60)).toBe('calendar:event-1:2026-11-03:60');
  });
});
```

- [ ] **Step 2: Убедиться, что падают**

Run: `pnpm --filter @harmofin/worker exec vitest run src/calendar-reminder.test.ts`
Expected: FAIL.

- [ ] **Step 3: `calendar-reminder.ts`**

```ts
import { addDays, type Occurrence } from './calendar-recurrence.js';
import { localToUtc, utcToLocal } from './zoned-time.js';

export const REMINDER_LOOKBACK_MS = 1_800_000;
export const ALL_DAY_REMINDER_TIME = '09:00';

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

export function reminderWindow(
  now: Date,
  reminderMinutes: number,
  timezone: string,
): { from: string; to: string } {
  const from = utcToLocal(new Date(now.getTime() - REMINDER_LOOKBACK_MS), timezone).date;
  const to = utcToLocal(new Date(now.getTime() + reminderMinutes * 60_000), timezone).date;
  return { from: addDays(from, -1), to: addDays(to, 1) };
}

export function reminderMoment(occurrence: Occurrence, reminderMinutes: number, timezone: string): Date {
  const start = occurrence.startsAt
    ? new Date(occurrence.startsAt)
    : localToUtc(occurrence.startDate, ALL_DAY_REMINDER_TIME, timezone);
  return new Date(start.getTime() - reminderMinutes * 60_000);
}

export function isReminderDue(moment: Date, now: Date): boolean {
  return (
    moment.getTime() <= now.getTime() && moment.getTime() > now.getTime() - REMINDER_LOOKBACK_MS
  );
}

export function reminderBody(occurrence: Occurrence, now: Date, timezone: string): string {
  const today = utcToLocal(now, timezone).date;
  const date = occurrence.startDate;
  const day =
    date === today
      ? 'Сегодня'
      : date === addDays(today, 1)
        ? 'Завтра'
        : `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
  return occurrence.startTime ? `${day} в ${occurrence.startTime}` : `${day}, весь день`;
}

export function reminderKey(eventId: string, occurrenceDate: string, reminderMinutes: number): string {
  return `calendar:${eventId}:${occurrenceDate}:${reminderMinutes}`;
}
```

- [ ] **Step 4: Правило проходит**

Run: `pnpm --filter @harmofin/worker exec vitest run src/calendar-reminder.test.ts`
Expected: PASS.

- [ ] **Step 5: Падающий тест обработчика**

`apps/worker/src/calendar-reminder.handler.test.ts` — тем же способом, что `apps/worker/src/notification.handler.test.ts` (сначала прочитать его: реальная одноразовая БД или мок `PrismaClient`; повторить подход и вспомогательные функции). Сценарии, каждый на своих данных:

1. Еженедельное «Кружок» (вт 17:00, бюджет `Europe/Moscow`, `reminderMinutes: 60`, автор A, участники B и C, C — неактивный член семьи). `execute(new Date('2026-11-03T13:05:00Z'))` создаёт уведомления только для A и B: `notificationType: 'CALENDAR_REMINDER'`, `title: 'Кружок'`, `body: 'Сегодня в 17:00'`, `notificationKey: 'calendar:<eventId>:2026-11-03:60'`, `relatedEntityType: 'calendar_event'`, `relatedEntityId: <eventId>`, `actionPath: '/app/calendar?date=2026-11-03'`.
2. Повторный `execute` с тем же `now` и с `now + 5 мин` не создаёт новых строк (на моках — те же ключи и `skipDuplicates: true`).
3. `execute(new Date('2026-11-03T12:59:00Z'))` и `execute(new Date('2026-11-03T13:31:00Z'))` — ничего.
4. Событие на весь день `2026-11-05`, `reminderMinutes: 1440`: `execute(new Date('2026-11-04T06:10:00Z'))` → `body: 'Завтра, весь день'`.
5. Удалённое событие и вхождение после `repeatUntil` — ничего (фильтр `deletedAt: null` в запросе; `repeatUntil` — в `expandOccurrences`).
6. Бюджет с `planModelVersion` ≠ 2 или неактивный — пропускается.

- [ ] **Step 6: Обработчик**

`apps/worker/src/calendar-reminder.handler.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { expandOccurrences, type RecurringEvent } from './calendar-recurrence.js';
import {
  isReminderDue,
  reminderBody,
  reminderKey,
  reminderMoment,
  reminderWindow,
} from './calendar-reminder.js';
import { utcToLocal } from './zoned-time.js';

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

type StoredRule = {
  allDay: boolean;
  startsOn: Date | null;
  endsOn: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  recurrence: RecurringEvent['recurrence'];
  interval: number;
  weekdays: number[];
  repeatUntil: Date | null;
};

function toRule(event: StoredRule, timezone: string): RecurringEvent {
  const shared = {
    recurrence: event.recurrence,
    interval: event.interval,
    weekdays: event.weekdays,
    repeatUntil: event.repeatUntil ? isoDate(event.repeatUntil) : null,
  };
  if (event.allDay) {
    return {
      ...shared,
      allDay: true,
      startDate: isoDate(event.startsOn!),
      endDate: isoDate(event.endsOn!),
      startTime: null,
      durationMinutes: 0,
    };
  }
  const start = utcToLocal(event.startsAt!, timezone);
  return {
    ...shared,
    allDay: false,
    startDate: start.date,
    endDate: utcToLocal(event.endsAt!, timezone).date,
    startTime: start.time,
    durationMinutes: Math.round((event.endsAt!.getTime() - event.startsAt!.getTime()) / 60_000),
  };
}

/**
 * In-app reminders for calendar events. Occurrences are expanded on the fly (none are stored);
 * the notification key turns a rerun or an overlapping run into a no-op. Only the event title and
 * the date go into the notification: no description, no participant names.
 */
export class CalendarReminderHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(now: Date): Promise<void> {
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        deletedAt: null,
        reminderMinutes: { not: null },
        budget: { status: 'ACTIVE', planModelVersion: 2, workspace: { status: 'ACTIVE' } },
      },
      select: {
        id: true,
        workspaceId: true,
        budgetId: true,
        createdByUserId: true,
        title: true,
        allDay: true,
        startsOn: true,
        endsOn: true,
        startsAt: true,
        endsAt: true,
        recurrence: true,
        interval: true,
        weekdays: true,
        repeatUntil: true,
        reminderMinutes: true,
        budget: { select: { timezone: true } },
        participants: { select: { userId: true } },
      },
    });

    for (const event of events) {
      const minutes = event.reminderMinutes!;
      const timezone = event.budget.timezone;
      const due = expandOccurrences(
        toRule(event, timezone),
        reminderWindow(now, minutes, timezone),
        timezone,
      ).filter((occurrence) => isReminderDue(reminderMoment(occurrence, minutes, timezone), now));
      if (due.length === 0) continue;

      const candidates = [
        ...new Set([event.createdByUserId, ...event.participants.map((item) => item.userId)]),
      ];
      const recipients = await this.prisma.workspaceMembership.findMany({
        where: { workspaceId: event.workspaceId, userId: { in: candidates }, isActive: true },
        select: { userId: true },
      });
      if (recipients.length === 0) continue;

      await this.prisma.notification.createMany({
        data: due.flatMap((occurrence) =>
          recipients.map(({ userId }) => ({
            id: randomUUID(),
            workspaceId: event.workspaceId,
            budgetId: event.budgetId,
            userId,
            notificationType: 'CALENDAR_REMINDER' as const,
            relatedEntityType: 'calendar_event',
            relatedEntityId: event.id,
            title: event.title,
            body: reminderBody(occurrence, now, timezone),
            actionPath: `/app/calendar?date=${occurrence.startDate}`,
            notificationKey: reminderKey(event.id, occurrence.occurrenceDate, minutes),
          })),
        ),
        skipDuplicates: true,
      });
    }
  }
}
```

Сверить с `NotificationRuleHandler`: если он пишет `AuditEvent` на каждое созданное уведомление (`createNotificationAudit`), делать так же — создавать уведомления по одному (`createMany` с одной записью, проверка `result.count`) и писать audit только при `count === 1`. Решение записать в «Ход выполнения».

- [ ] **Step 7: Регистрация задачи**

- `job.repository.ts`: в `recurringJobs` — `{ jobKey: 'calendar:reminders-v1', jobType: 'EVALUATE_CALENDAR_REMINDERS' },`.
- `job-runner.ts`: в таблице интервалов рядом с `EVALUATE_BUDGET_NOTIFICATIONS: 900_000,` — `EVALUATE_CALENDAR_REMINDERS: 300_000,`.
- `main.ts`: `import { CalendarReminderHandler } from './calendar-reminder.handler.js';` и `EVALUATE_CALENDAR_REMINDERS: new CalendarReminderHandler(database),` в объекте обработчиков.
- `job-runner.test.ts`: тест «schedules calendar reminders five minutes later» по образцу «schedules notification evaluation fifteen minutes later».

- [ ] **Step 8: Тесты и проверки**

Run: `pnpm --filter @harmofin/worker test && pnpm --filter @harmofin/worker typecheck && pnpm --filter @harmofin/worker lint`
Expected: PASS.

```bash
git add apps/worker/src
```

Коммит: `feat(worker): напоминания о событиях календаря`. **Конец PR 3.**

---

## PR 4 — веб и документация

Перед стартом: свежий `main` после мержа PR 3, ветка `feat/family-calendar-web`. Перед любой визуальной правкой прочитать [Calm Fintech](../specs/2026-09-17-calm-fintech-visual-guidelines.md) и раздел «Интерфейс» дизайна. Браузер локально не открывать (правило владельца); визуальная проверка — unit-тесты компонентов, e2e в CI и UI/UX review.

Общие правила веб-задач:
- Деньги показываются только через `formatMinorUnits(minor, 'RUB', 2)` из `apps/web/app/components/finance/money-format.ts` (как в `PlansCalendar.vue`) или компонент `FinanceMoney` (как в `PlanDayPanel.vue`); клиент не складывает и не пересчитывает суммы.
- Даты — `date-fns` с `ru`-локалью (`import { ru } from 'date-fns/locale'`), как в `PlanDayPanel.vue`. Часовые пояса клиент не пересчитывает: время в ленте уже локальное для бюджета.
- Каждая кнопка без текста — `aria-label`; у кнопок в шапке — `tooltip` и `tooltip-placement="bottom"`.
- Стили — только токены `--hf-*` из `tokens.css`, `scoped`.

### Task 8: Клиент API календаря и типы

**Files:**
- Create: `apps/web/app/composables/useFamilyCalendar.ts`, `apps/web/app/composables/useFamilyCalendar.test.ts`
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts` (`NotificationType` + `'CALENDAR_REMINDER'`)

**Interfaces:**
- Consumes: HTTP API задач 5–6; `useApiClient` (существует); `PersonRef` из `useEnvelopePlanV2.ts`.
- Produces (все типы экспортируются из `useFamilyCalendar.ts`):
  - `type CalendarRecurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'`
  - `interface CalendarEventInput { title; description: string | null; allDay; date; endDate: string | null; startTime: string | null; endTime: string | null; recurrence; interval: number; weekdays: number[]; repeatUntil: string | null; participantUserIds: string[]; reminderMinutes: number | null }`
  - `interface CalendarEventDto` (= `CalendarEventView` задачи 5)
  - `interface CalendarFeedEventItem`, `interface CalendarFeedPlanItem`, `type CalendarFeedItem`, `interface CalendarFeedResponse { from; to; items }` (= задача 6)
  - `useFamilyCalendar()` → `{ feed(budgetId, query: { from; to; participantUserId?; includePlans? }): Promise<CalendarFeedResponse>; getEvent(budgetId, eventId): Promise<CalendarEventDto>; createEvent(budgetId, input, key): Promise<CalendarEventDto>; updateEvent(budgetId, eventId, input, key): Promise<CalendarEventDto>; deleteEvent(budgetId, eventId): Promise<void> }`

- [ ] **Step 1: Падающий тест**

`apps/web/app/composables/useFamilyCalendar.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('./useApiClient.js', () => ({ useApiClient: () => ({ request }) }));

import { useFamilyCalendar, type CalendarEventInput } from './useFamilyCalendar.js';

const input: CalendarEventInput = {
  title: 'Кружок',
  description: null,
  allDay: false,
  date: '2026-11-03',
  endDate: null,
  startTime: '17:00',
  endTime: '18:30',
  recurrence: 'WEEKLY',
  interval: 1,
  weekdays: [2],
  repeatUntil: null,
  participantUserIds: [],
  reminderMinutes: 60,
};

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({});
});

describe('useFamilyCalendar', () => {
  it('reads the feed with the range, the person filter and the payments flag', async () => {
    await useFamilyCalendar().feed('budget id', {
      from: '2026-10-26',
      to: '2026-12-06',
      participantUserId: 'user-1',
      includePlans: false,
    });
    expect(request).toHaveBeenCalledWith(
      '/api/v2/budgets/budget%20id/calendar?from=2026-10-26&to=2026-12-06&participantUserId=user-1&includePlans=false',
    );
  });

  it('omits optional query parameters', async () => {
    await useFamilyCalendar().feed('b', { from: '2026-11-01', to: '2026-11-14' });
    expect(request).toHaveBeenCalledWith('/api/v2/budgets/b/calendar?from=2026-11-01&to=2026-11-14');
  });

  it('creates and updates with an Idempotency-Key and deletes without one', async () => {
    const calendar = useFamilyCalendar();
    await calendar.createEvent('b', input, 'key-1');
    expect(request).toHaveBeenCalledWith('/api/v2/budgets/b/calendar/events', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': 'key-1' },
    });
    await calendar.updateEvent('b', 'e 1', input, 'key-2');
    expect(request).toHaveBeenCalledWith('/api/v2/budgets/b/calendar/events/e%201', {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': 'key-2' },
    });
    await calendar.deleteEvent('b', 'e1');
    expect(request).toHaveBeenCalledWith('/api/v2/budgets/b/calendar/events/e1', { method: 'DELETE' });
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useFamilyCalendar.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализация**

`apps/web/app/composables/useFamilyCalendar.ts`:

```ts
import { useApiClient } from './useApiClient.js';
import type { PersonRef } from './useEnvelopePlanV2.js';

// Thin typed client over the v2 calendar API. Times in the feed are already local to the budget
// time zone; amounts are minor-units strings from the server. Nothing here computes money.

export type CalendarRecurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface CalendarEventInput {
  title: string;
  description: string | null;
  allDay: boolean;
  date: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  recurrence: CalendarRecurrence;
  interval: number;
  weekdays: number[];
  repeatUntil: string | null;
  participantUserIds: string[];
  reminderMinutes: number | null;
}

export interface CalendarEventDto {
  id: string;
  title: string;
  description: string | null;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  recurrence: CalendarRecurrence;
  interval: number;
  weekdays: number[];
  repeatUntil: string | null;
  reminderMinutes: number | null;
  participants: PersonRef[];
  createdBy: PersonRef;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarFeedEventItem {
  kind: 'EVENT';
  eventId: string;
  occurrenceDate: string;
  title: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
  recurrence: CalendarRecurrence;
  participants: PersonRef[];
  createdBy: PersonRef;
  canEdit: boolean;
}

export interface CalendarFeedPlanItem {
  kind: 'PLAN';
  occurrenceId: string;
  planId: string;
  planKind: 'OBLIGATION' | 'INCOME_PLAN';
  title: string;
  amountMinor: string;
  status: string;
  isOverdue: boolean;
  scheduledOn: string;
  owner: PersonRef;
}

export type CalendarFeedItem = CalendarFeedEventItem | CalendarFeedPlanItem;

export interface CalendarFeedResponse {
  from: string;
  to: string;
  items: CalendarFeedItem[];
}

export interface CalendarFeedQuery {
  from: string;
  to: string;
  participantUserId?: string | undefined;
  includePlans?: boolean | undefined;
}

export function useFamilyCalendar() {
  const api = useApiClient();
  const base = (budgetId: string) => `/api/v2/budgets/${encodeURIComponent(budgetId)}/calendar`;

  return {
    feed(budgetId: string, query: CalendarFeedQuery): Promise<CalendarFeedResponse> {
      const params = new URLSearchParams({ from: query.from, to: query.to });
      if (query.participantUserId) params.set('participantUserId', query.participantUserId);
      if (query.includePlans === false) params.set('includePlans', 'false');
      return api.request<CalendarFeedResponse>(`${base(budgetId)}?${params.toString()}`);
    },
    getEvent(budgetId: string, eventId: string): Promise<CalendarEventDto> {
      return api.request<CalendarEventDto>(`${base(budgetId)}/events/${encodeURIComponent(eventId)}`);
    },
    createEvent(budgetId: string, input: CalendarEventInput, key: string): Promise<CalendarEventDto> {
      return api.request<CalendarEventDto>(`${base(budgetId)}/events`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': key },
      });
    },
    updateEvent(
      budgetId: string,
      eventId: string,
      input: CalendarEventInput,
      key: string,
    ): Promise<CalendarEventDto> {
      return api.request<CalendarEventDto>(`${base(budgetId)}/events/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': key },
      });
    },
    async deleteEvent(budgetId: string, eventId: string): Promise<void> {
      await api.request(`${base(budgetId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    },
  };
}
```

В `useBudgetReferenceData.ts` в `NotificationType` добавить `| 'CALENDAR_REMINDER'`.

Если `api.request` для `DELETE` с ответом 204 падает на разборе пустого тела — посмотреть, как `useApiClient.ts` обрабатывает 204 (у других `DELETE` в проекте), и использовать тот же вызов.

- [ ] **Step 4: Тест проходит, проверки**

Run: `pnpm --filter @harmofin/web exec vitest run app/composables/useFamilyCalendar.test.ts && pnpm --filter @harmofin/web typecheck`
Expected: PASS.

```bash
git add apps/web/app/composables/useFamilyCalendar.ts apps/web/app/composables/useFamilyCalendar.test.ts apps/web/app/composables/useBudgetReferenceData.ts
```

Коммит: `feat(web): клиент API семейного календаря`.

### Task 9: Даты, диапазоны и подписи людей

**Files:**
- Create: `apps/web/app/components/calendar/calendar-dates.ts`, `calendar-dates.test.ts`
- Create: `apps/web/app/components/calendar/participants-label.ts`, `participants-label.test.ts`

**Interfaces:**
- Produces:
  - `addIsoDays(date: string, days: number): string`, `isoWeekday(date: string): number`
  - `monthGrid(month: string): string[][]` — недели (по 7 дат `YYYY-MM-DD`, с понедельника), покрывающие месяц `YYYY-MM`
  - `monthRange(month: string): { from: string; to: string }` — первый и последний день сетки
  - `agendaRange(start: string, days = 14): { from: string; to: string }`
  - `shiftMonth(month: string, delta: number): string`
  - `monthTitle(month: string): string` → «Октябрь 2026»
  - `agendaTitle(range: { from; to }): string` → «30 окт – 12 ноя»
  - `dayHeading(date: string, today: string): string` → «Сегодня, пт 30 октября», «Завтра, сб 31 октября», «Вт 3 ноября»
  - `dayDialogTitle(date: string): string` → «Пятница, 30 октября»
  - `itemDate(item: CalendarFeedItem): string` (дата вхождения или платежа)
  - `groupByDay(items: CalendarFeedItem[]): Map<string, CalendarFeedItem[]>` — многодневное событие попадает в каждый свой день
  - `participantsLabel(people: PersonRef[], activeMemberIds: ReadonlySet<string>): string` — «Вся семья», если отмечены все активные члены семьи (и их больше одного); иначе имена через `authorLabel`, через запятую; пустой список — `''`.

- [ ] **Step 1: Падающие тесты**

`calendar-dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import {
  agendaRange,
  agendaTitle,
  dayDialogTitle,
  dayHeading,
  groupByDay,
  monthGrid,
  monthRange,
  monthTitle,
  shiftMonth,
} from './calendar-dates.js';

describe('calendar dates', () => {
  it('builds a Monday-first grid that covers the month', () => {
    const grid = monthGrid('2026-10');
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(grid.at(-1)?.at(-1)).toBe('2026-11-01');
    expect(monthRange('2026-10')).toEqual({ from: '2026-09-28', to: '2026-11-01' });
  });

  it('a six-week month gets six rows', () => {
    expect(monthGrid('2026-08')).toHaveLength(6);
  });

  it('moves between months and titles them', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthTitle('2026-10')).toBe('Октябрь 2026');
  });

  it('builds the agenda range and its title', () => {
    expect(agendaRange('2026-10-30')).toEqual({ from: '2026-10-30', to: '2026-11-12' });
    expect(agendaTitle({ from: '2026-10-30', to: '2026-11-12' })).toBe('30 окт – 12 ноя');
  });

  it('writes day headings', () => {
    expect(dayHeading('2026-10-30', '2026-10-30')).toBe('Сегодня, пт 30 октября');
    expect(dayHeading('2026-10-31', '2026-10-30')).toBe('Завтра, сб 31 октября');
    expect(dayHeading('2026-11-03', '2026-10-30')).toBe('Вт 3 ноября');
    expect(dayDialogTitle('2026-10-30')).toBe('Пятница, 30 октября');
  });

  it('puts a multi-day event into each of its days', () => {
    const trip = {
      kind: 'EVENT',
      eventId: 'e',
      occurrenceDate: '2026-10-31',
      startDate: '2026-10-31',
      endDate: '2026-11-02',
      title: 'Поездка',
      allDay: true,
    } as CalendarFeedItem;
    expect([...groupByDay([trip]).keys()]).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });
});
```

`participants-label.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { participantsLabel } from './participants-label.js';

const alia = { userId: 'a', displayName: 'Алия', isActiveMember: true };
const ildar = { userId: 'i', displayName: 'Ильдар', isActiveMember: true };
const former = { userId: 'f', displayName: 'Тимур', isActiveMember: false };

describe('participantsLabel', () => {
  it('names people in order', () => {
    expect(participantsLabel([alia, ildar], new Set(['a', 'i', 't']))).toBe('Алия, Ильдар');
  });

  it('says "Вся семья" when every active member takes part', () => {
    expect(participantsLabel([ildar, alia], new Set(['a', 'i']))).toBe('Вся семья');
  });

  it('keeps former members with the existing caption', () => {
    expect(participantsLabel([alia, former], new Set(['a', 'i']))).toBe('Алия, Тимур (не в семье)');
  });

  it('is empty without participants', () => {
    expect(participantsLabel([], new Set(['a']))).toBe('');
  });
});
```

- [ ] **Step 2: Убедиться, что падают**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/calendar`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`calendar-dates.ts`:

```ts
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';

const DAY_MS = 86_400_000;
const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (value: number): string => new Date(value).toISOString().slice(0, 10);
// date-fns formats in the runtime zone; noon UTC keeps the calendar day in every zone.
const asLocalNoon = (date: string): Date => new Date(`${date}T12:00:00Z`);
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function addIsoDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

export function isoWeekday(date: string): number {
  const day = new Date(toUtc(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const last = fromUtc(Date.UTC(year, monthNumber, 0));
  let day = addIsoDays(first, 1 - isoWeekday(first));
  const weeks: string[][] = [];
  while (day <= last) {
    const week: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      week.push(day);
      day = addIsoDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function monthRange(month: string): { from: string; to: string } {
  const grid = monthGrid(month);
  return { from: grid[0]![0]!, to: grid.at(-1)!.at(-1)! };
}

export function agendaRange(start: string, days = 14): { from: string; to: string } {
  return { from: start, to: addIsoDays(start, days - 1) };
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function monthTitle(month: string): string {
  return capitalize(format(asLocalNoon(`${month}-01`), 'LLLL yyyy', { locale: ru }));
}

const SHORT_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
// Fixed three-letter forms from the approved prototype («30 окт – 12 ноя»), not date-fns «нояб.».
const shortMonth = (date: string): string =>
  `${Number(date.slice(8))} ${SHORT_MONTHS[Number(date.slice(5, 7)) - 1]}`;

export function agendaTitle(range: { from: string; to: string }): string {
  return `${shortMonth(range.from)} – ${shortMonth(range.to)}`;
}

export function dayHeading(date: string, today: string): string {
  const weekday = format(asLocalNoon(date), 'EEEEEE', { locale: ru });
  const dayMonth = format(asLocalNoon(date), 'd MMMM', { locale: ru });
  if (date === today) return `Сегодня, ${weekday} ${dayMonth}`;
  if (date === addIsoDays(today, 1)) return `Завтра, ${weekday} ${dayMonth}`;
  return `${capitalize(weekday)} ${dayMonth}`;
}

export function dayDialogTitle(date: string): string {
  return capitalize(format(asLocalNoon(date), 'EEEE, d MMMM', { locale: ru }));
}

export function itemDate(item: CalendarFeedItem): string {
  return item.kind === 'EVENT' ? item.occurrenceDate : item.scheduledOn;
}

export function groupByDay(items: readonly CalendarFeedItem[]): Map<string, CalendarFeedItem[]> {
  const days = new Map<string, CalendarFeedItem[]>();
  const push = (date: string, item: CalendarFeedItem) => {
    const list = days.get(date) ?? [];
    list.push(item);
    days.set(date, list);
  };
  for (const item of items) {
    if (item.kind === 'EVENT' && item.allDay && item.endDate > item.startDate) {
      for (let date = item.startDate; date <= item.endDate; date = addIsoDays(date, 1)) push(date, item);
    } else {
      push(itemDate(item), item);
    }
  }
  return new Map([...days.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
```

Строки `date-fns` проверены на `date-fns` проекта: `LLLL yyyy` → «октябрь 2026», `d MMMM` → «30 октября», `EEEEEE` → «пт», `EEEE, d MMMM` → «пятница, 30 октября». Короткие месяцы взяты фиксированным списком: `date-fns` даёт «нояб.», а в прототипе «ноя». Если форма отличается, поправить шаблон, а не тест (тексты утверждены).

`participants-label.ts`:

```ts
import type { PersonRef } from '../../composables/useEnvelopePlanV2.js';
import { authorLabel } from '../operations/author-label.js';

export function participantsLabel(
  people: readonly PersonRef[],
  activeMemberIds: ReadonlySet<string>,
): string {
  if (people.length === 0) return '';
  const active = people.filter((person) => person.isActiveMember).map((person) => person.userId);
  const everyone =
    activeMemberIds.size > 1 &&
    active.length === people.length &&
    [...activeMemberIds].every((id) => active.includes(id));
  return everyone ? 'Вся семья' : people.map((person) => authorLabel(person)).join(', ');
}
```

- [ ] **Step 4: Тесты проходят**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/calendar`
Expected: PASS.

```bash
git add apps/web/app/components/calendar/calendar-dates.ts apps/web/app/components/calendar/calendar-dates.test.ts apps/web/app/components/calendar/participants-label.ts apps/web/app/components/calendar/participants-label.test.ts
```

Коммит: `feat(web): даты и подписи семейного календаря`.

### Task 10: Месяц, повестка, панель дня, шапка

**Files:**
- Create: `apps/web/app/components/calendar/CalendarHeader.vue`, `CalendarHeader.test.ts`
- Create: `apps/web/app/components/calendar/CalendarMonthGrid.vue`, `CalendarMonthGrid.test.ts`
- Create: `apps/web/app/components/calendar/CalendarAgenda.vue`, `CalendarAgenda.test.ts`
- Create: `apps/web/app/components/calendar/CalendarDayDialog.vue`, `CalendarDayDialog.test.ts`
- Create: `apps/web/app/components/calendar/CalendarItemLine.vue` (строка элемента для ячейки месяца)

**Interfaces:**
- Consumes: задачи 8, 9; `UiButtonGroup`, `UiButton`, `UiModal`, `UiListRow`, `UiStatus`, `UiEmptyState`, `formatMinorUnits`.
- Produces:
  - `CalendarHeader` props `{ view: 'month' | 'agenda'; title: string; ownerFilter: 'all' | 'mine'; showOwnerFilter: boolean; showPlans: boolean; canCreate: boolean }`, emits `update:view`, `update:ownerFilter`, `update:showPlans`, `previous`, `next`, `today`, `create`.
  - `CalendarMonthGrid` props `{ month: string; today: string; items: CalendarFeedItem[] }`, emits `openDay(date: string)`.
  - `CalendarAgenda` props `{ today: string; items: CalendarFeedItem[]; activeMemberIds: ReadonlySet<string>; loadingMore: boolean }`, emits `openEvent(item: CalendarFeedEventItem)`, `openPlan(item: CalendarFeedPlanItem)`, `more()`.
  - `CalendarDayDialog` props `{ open: boolean; date: string; items: CalendarFeedItem[]; activeMemberIds: ReadonlySet<string>; canCreate: boolean }`, emits `close`, `openEvent`, `openPlan`, `create(date: string)`.
  - `planStatusLabel(item: CalendarFeedPlanItem): { label: string; tone: 'neutral' | 'success' | 'warning' }` — экспорт из `CalendarItemLine.vue` нельзя; положить в `calendar-dates.ts`: `isOverdue` → «Просрочен»/`warning`; `status === 'COMPLETED'` → «Оплачен» (для `INCOME_PLAN` — «Получен»)/`success`; иначе «Ожидается»/`neutral`.

- [ ] **Step 1: Падающие тесты компонентов**

`CalendarMonthGrid.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import CalendarMonthGrid from './CalendarMonthGrid.vue';

const person = { userId: 'u', displayName: 'Алия', isActiveMember: true };
const event = (title: string, date: string, startTime: string | null): CalendarFeedItem => ({
  kind: 'EVENT', eventId: title, occurrenceDate: date, title, allDay: startTime === null,
  startDate: date, endDate: date, startTime, endTime: startTime, startsAt: null, endsAt: null,
  recurrence: 'NONE', participants: [], createdBy: person, canEdit: false,
});
const plan = (title: string, date: string, isOverdue = false): CalendarFeedItem => ({
  kind: 'PLAN', occurrenceId: title, planId: title, planKind: 'OBLIGATION', title,
  amountMinor: '4500000', status: 'PENDING', isOverdue, scheduledOn: date, owner: person,
});

function mountGrid(items: CalendarFeedItem[]) {
  return mount(CalendarMonthGrid, { props: { month: '2026-10', today: '2026-10-30', items } });
}

describe('CalendarMonthGrid', () => {
  it('is a grid with Monday-first weekday headers and labelled days', () => {
    const wrapper = mountGrid([event('Кружок', '2026-10-06', '17:00'), plan('Аренда', '2026-10-15')]);
    expect(wrapper.get('[role="grid"]').attributes('aria-label')).toBe('Октябрь 2026');
    expect(wrapper.findAll('[role="columnheader"]').map((cell) => cell.text())).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
    expect(wrapper.get('[data-date="2026-10-06"]').attributes('aria-label')).toBe('6 октября, 1 событие');
    expect(wrapper.get('[data-date="2026-10-15"]').attributes('aria-label')).toBe('15 октября, 1 платёж');
  });

  it('shows at most three lines and "+ ещё N"', () => {
    const items = ['08:00', '09:00', '10:00', '11:00', '12:00'].map((time, index) => event(`Дело ${index}`, '2026-10-30', time));
    const cell = mountGrid(items).get('[data-date="2026-10-30"]');
    expect(cell.findAll('[data-testid="calendar-line"]')).toHaveLength(3);
    expect(cell.text()).toContain('+ ещё 2');
  });

  it('marks today with aria-current and overdue payments with text', () => {
    const wrapper = mountGrid([plan('Школа', '2026-10-30', true)]);
    expect(wrapper.get('[data-date="2026-10-30"]').attributes('aria-current')).toBe('date');
    expect(wrapper.get('[data-date="2026-10-30"]').text()).toContain('просрочен');
    expect(wrapper.get('[data-date="2026-10-30"]').text()).toMatch(/45\s000/);
  });

  it('opens a day by click and by Enter; arrows move focus', async () => {
    const wrapper = mountGrid([]);
    await wrapper.get('[data-date="2026-10-14"]').trigger('click');
    expect(wrapper.emitted('openDay')?.[0]).toEqual(['2026-10-14']);
    await wrapper.get('[data-date="2026-10-14"]').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('openDay')?.[1]).toEqual(['2026-10-14']);
    await wrapper.get('[data-date="2026-10-14"]').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.get('[data-date="2026-10-15"]').attributes('tabindex')).toBe('0');
    expect(wrapper.get('[data-date="2026-10-14"]').attributes('tabindex')).toBe('-1');
  });
});
```

`CalendarAgenda.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import CalendarAgenda from './CalendarAgenda.vue';

const alia = { userId: 'a', displayName: 'Алия', isActiveMember: true };
const ildar = { userId: 'i', displayName: 'Ильдар', isActiveMember: true };
const breakfast: CalendarFeedItem = {
  kind: 'EVENT', eventId: 'e1', occurrenceDate: '2026-10-30', title: 'Семейный завтрак', allDay: false,
  startDate: '2026-10-30', endDate: '2026-10-30', startTime: '09:30', endTime: '10:30', startsAt: null, endsAt: null,
  recurrence: 'NONE', participants: [alia, ildar], createdBy: ildar, canEdit: true,
};
const school: CalendarFeedItem = {
  kind: 'PLAN', occurrenceId: 'o1', planId: 'p1', planKind: 'OBLIGATION', title: 'Школа', amountMinor: '1250000',
  status: 'DUE', isOverdue: true, scheduledOn: '2026-10-30', owner: ildar,
};
const trip: CalendarFeedItem = { ...breakfast, eventId: 'e2', title: 'Поездка за город', occurrenceDate: '2026-10-31', startDate: '2026-10-31', endDate: '2026-10-31', allDay: true, startTime: null, endTime: null };

function mountAgenda(items: CalendarFeedItem[]) {
  return mount(CalendarAgenda, {
    props: { today: '2026-10-30', items, activeMemberIds: new Set(['a', 'i']), loadingMore: false },
  });
}

describe('CalendarAgenda', () => {
  it('groups by day with headings and skips empty days', () => {
    const wrapper = mountAgenda([school, breakfast, trip]);
    expect(wrapper.findAll('[data-testid="agenda-day-heading"]').map((item) => item.text())).toEqual([
      'Сегодня, пт 30 октября',
      'Завтра, сб 31 октября',
    ]);
  });

  it('shows the status of a payment once, as a pill, and people for an event', () => {
    const wrapper = mountAgenda([school, breakfast]);
    const payment = wrapper.get('[data-testid="agenda-item-o1"]');
    expect(payment.text()).toMatch(/12\s500/);
    expect(payment.text().match(/Просрочен/g)).toHaveLength(1);
    expect(wrapper.get('[data-testid="agenda-item-e1"]').text()).toContain('09:30 · Вся семья');
  });

  it('opens items and asks for more', async () => {
    const wrapper = mountAgenda([school, breakfast]);
    await wrapper.get('[data-testid="agenda-item-e1"] button').trigger('click');
    expect(wrapper.emitted('openEvent')?.[0]?.[0]).toMatchObject({ eventId: 'e1' });
    await wrapper.get('[data-testid="agenda-item-o1"] button').trigger('click');
    expect(wrapper.emitted('openPlan')?.[0]?.[0]).toMatchObject({ occurrenceId: 'o1' });
    await wrapper.get('[data-testid="agenda-more"]').trigger('click');
    expect(wrapper.emitted('more')).toHaveLength(1);
  });

  it('shows an empty state', () => {
    expect(mountAgenda([]).text()).toContain('На эти дни ничего не запланировано');
  });
});
```

`CalendarDayDialog.test.ts` — по образцу: открыта с `date: '2026-10-30'`, заголовок «Пятница, 30 октября»; событие показывает «09:30», название, «Алия, Ильдар» и «Автор: Ильдар»; платёж — сумму и «Владелец: Ильдар»; при `canCreate: false` кнопки «Новое событие на этот день» нет; клик по ней эмитит `create` с `'2026-10-30'`; «Закрыть» эмитит `close`.

`CalendarHeader.test.ts`: при `view: 'agenda'` заголовок — переданный `title`; клики по «‹», «›», «Сегодня» эмитят `previous`, `next`, `today`; без `showOwnerFilter` группы «Все / Мои» нет; при `canCreate: false` кнопки «Новое событие» нет; кнопки-стрелки имеют `aria-label` «Предыдущий период» / «Следующий период»; переключатель «Платежи» — `role="switch"` с `aria-checked`.

- [ ] **Step 2: Убедиться, что падают**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/calendar`
Expected: FAIL.

- [ ] **Step 3: `CalendarItemLine.vue` и `planStatusLabel`**

В `calendar-dates.ts` добавить:

```ts
import type { CalendarFeedPlanItem } from '../../composables/useFamilyCalendar.js';

export function planStatusLabel(item: CalendarFeedPlanItem): {
  label: string;
  tone: 'neutral' | 'success' | 'warning';
} {
  if (item.isOverdue) return { label: 'Просрочен', tone: 'warning' };
  if (item.status === 'COMPLETED') {
    return { label: item.planKind === 'INCOME_PLAN' ? 'Получен' : 'Оплачен', tone: 'success' };
  }
  return { label: 'Ожидается', tone: 'neutral' };
}
```

`CalendarItemLine.vue` — одна строка в ячейке месяца:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { AlertCircle, ArrowDownLeft, Wallet } from '@lucide/vue';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import { formatMinorUnits } from '../finance/money-format.js';

const props = defineProps<{ item: CalendarFeedItem }>();

const text = computed(() => {
  const item = props.item;
  if (item.kind === 'EVENT') return item.allDay ? `Весь день · ${item.title}` : `${item.startTime} ${item.title}`;
  const sign = item.planKind === 'INCOME_PLAN' ? '+' : '';
  return `${item.title} · ${sign}${formatMinorUnits(item.amountMinor, 'RUB', 2)}`;
});
const icon = computed(() => {
  if (props.item.kind !== 'PLAN') return null;
  if (props.item.isOverdue) return AlertCircle;
  return props.item.planKind === 'INCOME_PLAN' ? ArrowDownLeft : Wallet;
});
</script>

<template>
  <span
    class="calendar-line"
    :class="{
      'calendar-line--plan': item.kind === 'PLAN',
      'calendar-line--overdue': item.kind === 'PLAN' && item.isOverdue,
    }"
    data-testid="calendar-line"
  >
    <component :is="icon" v-if="icon" :size="12" aria-hidden="true" />
    <span class="calendar-line__text">{{ text }}</span>
    <span v-if="item.kind === 'PLAN' && item.isOverdue" class="calendar-line__status">просрочен</span>
  </span>
</template>

<style scoped>
.calendar-line {
  display: flex;
  align-items: center;
  gap: var(--hf-space-1);
  min-width: 0;
  font-size: var(--hf-font-size-xs);
  color: var(--hf-color-text);
}
.calendar-line__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calendar-line--plan {
  padding: 0 var(--hf-space-1);
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-surface-subtle);
}
.calendar-line--overdue {
  background: var(--hf-color-warning-soft);
}
.calendar-line__status {
  margin-left: auto;
  color: var(--hf-color-text-warning);
}
</style>
```

Имена токенов (`--hf-font-size-xs`, `--hf-color-warning-soft`, `--hf-color-text-warning`, `--hf-radius-sm`, `--hf-space-1`) сверить с `apps/web/app/assets/styles/tokens.css`; при отсутствии — взять ближайшие существующие (как у `UiStatus tone="warning"`), новых токенов не вводить. `formatMinorUnits` уже добавляет символ валюты — сверить вывод с `PlansCalendar.vue`; ожидания тестов («45 000», «12 500») проверяют только число.

- [ ] **Step 4: `CalendarMonthGrid.vue`**

```vue
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import type { CalendarFeedItem } from '../../composables/useFamilyCalendar.js';
import CalendarItemLine from './CalendarItemLine.vue';
import { addIsoDays, groupByDay, monthGrid, monthTitle } from './calendar-dates.js';

const props = defineProps<{ month: string; today: string; items: CalendarFeedItem[] }>();
const emit = defineEmits<{ openDay: [date: string] }>();

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const VISIBLE_LINES = 3;

const weeks = computed(() => monthGrid(props.month));
const byDay = computed(() => groupByDay(props.items));
const focused = ref(props.today.startsWith(props.month) ? props.today : `${props.month}-01`);
const grid = ref<HTMLElement | null>(null);

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function dayLabel(date: string): string {
  const items = byDay.value.get(date) ?? [];
  const events = items.filter((item) => item.kind === 'EVENT').length;
  const plans = items.length - events;
  const parts = [format(new Date(`${date}T12:00:00Z`), 'd MMMM', { locale: ru })];
  if (events > 0) parts.push(`${events} ${plural(events, 'событие', 'события', 'событий')}`);
  if (plans > 0) parts.push(`${plans} ${plural(plans, 'платёж', 'платежа', 'платежей')}`);
  return parts.join(', ');
}

async function move(date: string, days: number): Promise<void> {
  const target = addIsoDays(date, days);
  const flat = weeks.value.flat();
  if (!flat.includes(target)) return;
  focused.value = target;
  await nextTick();
  grid.value?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus();
}

function onKeydown(event: KeyboardEvent, date: string): void {
  const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
  if (event.key in steps) {
    event.preventDefault();
    void move(date, steps[event.key]!);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('openDay', date);
  }
}
</script>

<template>
  <div ref="grid" class="calendar-month" role="grid" :aria-label="monthTitle(month)">
    <div class="calendar-month__row" role="row">
      <span v-for="weekday in WEEKDAYS" :key="weekday" class="calendar-month__weekday" role="columnheader">
        {{ weekday }}
      </span>
    </div>
    <div v-for="week in weeks" :key="week[0]" class="calendar-month__row" role="row">
      <div
        v-for="date in week"
        :key="date"
        class="calendar-month__day"
        :class="{ 'calendar-month__day--outside': !date.startsWith(month) }"
        role="gridcell"
        :data-date="date"
        :tabindex="date === focused ? 0 : -1"
        :aria-label="dayLabel(date)"
        :aria-current="date === today ? 'date' : undefined"
        @click="emit('openDay', date)"
        @keydown="onKeydown($event, date)"
        @focus="focused = date"
      >
        <span class="calendar-month__number" :class="{ 'calendar-month__number--today': date === today }">
          {{ Number(date.slice(8)) }}
        </span>
        <CalendarItemLine
          v-for="item in (byDay.get(date) ?? []).slice(0, VISIBLE_LINES)"
          :key="item.kind === 'EVENT' ? `${item.eventId}:${item.occurrenceDate}` : item.occurrenceId"
          :item="item"
        />
        <span v-if="(byDay.get(date) ?? []).length > VISIBLE_LINES" class="calendar-month__more">
          + ещё {{ (byDay.get(date) ?? []).length - VISIBLE_LINES }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-month {
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
  overflow: hidden;
}
.calendar-month__row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.calendar-month__weekday {
  padding: var(--hf-space-2);
  text-align: center;
  font-size: var(--hf-font-size-xs);
  color: var(--hf-color-text-muted);
  background: var(--hf-color-surface-subtle);
  text-transform: uppercase;
}
.calendar-month__day {
  display: flex;
  flex-direction: column;
  gap: var(--hf-space-1);
  min-height: 7.5rem;
  padding: var(--hf-space-2);
  border-top: 1px solid var(--hf-color-border);
  border-left: 1px solid var(--hf-color-border);
  cursor: pointer;
  min-width: 0;
}
.calendar-month__day:nth-child(7n + 1) {
  border-left: 0;
}
.calendar-month__day:focus-visible {
  outline: 2px solid var(--hf-color-brand);
  outline-offset: -2px;
}
.calendar-month__day--outside {
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}
.calendar-month__number {
  display: inline-grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  font-weight: 600;
}
.calendar-month__number--today {
  border: 2px solid var(--hf-color-brand);
  border-radius: 50%;
}
.calendar-month__more {
  font-size: var(--hf-font-size-xs);
  color: var(--hf-color-brand-active);
}
</style>
```

- [ ] **Step 5: `CalendarAgenda.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { CalendarDays, ChevronRight, Wallet } from '@lucide/vue';

import type {
  CalendarFeedEventItem,
  CalendarFeedItem,
  CalendarFeedPlanItem,
} from '../../composables/useFamilyCalendar.js';
import { formatMinorUnits } from '../finance/money-format.js';
import UiButton from '../ui/Button.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import UiStatus from '../ui/Status.vue';
import { dayHeading, groupByDay, planStatusLabel } from './calendar-dates.js';
import { participantsLabel } from './participants-label.js';

const props = defineProps<{
  today: string;
  items: CalendarFeedItem[];
  activeMemberIds: ReadonlySet<string>;
  loadingMore: boolean;
}>();
const emit = defineEmits<{
  openEvent: [item: CalendarFeedEventItem];
  openPlan: [item: CalendarFeedPlanItem];
  more: [];
}>();

const days = computed(() => [...groupByDay(props.items).entries()]);

function key(item: CalendarFeedItem): string {
  return item.kind === 'EVENT' ? `${item.eventId}:${item.occurrenceDate}` : item.occurrenceId;
}
function testId(item: CalendarFeedItem): string {
  return `agenda-item-${item.kind === 'EVENT' ? item.eventId : item.occurrenceId}`;
}
function subtitle(item: CalendarFeedItem): string {
  if (item.kind === 'PLAN') {
    const sign = item.planKind === 'INCOME_PLAN' ? '+' : '';
    return `${sign}${formatMinorUnits(item.amountMinor, 'RUB', 2)}`;
  }
  const when = item.allDay ? 'Весь день' : (item.startTime ?? '');
  const people = participantsLabel(item.participants, props.activeMemberIds);
  return people ? `${when} · ${people}` : when;
}
function open(item: CalendarFeedItem): void {
  if (item.kind === 'EVENT') emit('openEvent', item);
  else emit('openPlan', item);
}
</script>

<template>
  <div class="calendar-agenda">
    <UiEmptyState
      v-if="days.length === 0"
      title="На эти дни ничего не запланировано"
      description="Добавьте событие или выберите другие даты."
    />
    <section v-for="[date, dayItems] in days" :key="date" class="calendar-agenda__day">
      <h2 class="calendar-agenda__heading" data-testid="agenda-day-heading">{{ dayHeading(date, today) }}</h2>
      <ul class="calendar-agenda__list">
        <li v-for="item in dayItems" :key="key(item)" :data-testid="testId(item)">
          <button type="button" class="calendar-agenda__row" @click="open(item)">
            <span class="calendar-agenda__icon" aria-hidden="true">
              <CalendarDays v-if="item.kind === 'EVENT'" :size="18" />
              <Wallet v-else :size="18" />
            </span>
            <span class="calendar-agenda__text">
              <span class="calendar-agenda__title">{{ item.title }}</span>
              <span class="calendar-agenda__subtitle">{{ subtitle(item) }}</span>
            </span>
            <UiStatus
              v-if="item.kind === 'PLAN'"
              :label="planStatusLabel(item).label"
              :tone="planStatusLabel(item).tone"
            />
            <ChevronRight :size="18" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>
    <UiButton
      v-if="days.length > 0"
      variant="secondary"
      full-width
      :loading="loadingMore"
      data-testid="agenda-more"
      @click="emit('more')"
    >
      Показать ещё
    </UiButton>
  </div>
</template>
```

Стили: группа дня — карточка (`border`, `--hf-radius-lg`, `--hf-color-surface`, `--hf-shadow-sm`), строки разделены `border-top`, высота строки не меньше 44px, плашка иконки — 2.25rem, `--hf-radius-md`, `--hf-color-brand-soft` для события и `--hf-color-surface-subtle` для платежа, `:focus-visible` — обводка `--hf-color-brand`. Если в проекте строки списков уже делаются через `UiListRow` с кнопкой внутри — использовать `UiListRow` вместо разметки выше, сохранив `data-testid` и кнопку.

- [ ] **Step 6: `CalendarDayDialog.vue` и `CalendarHeader.vue`**

`CalendarDayDialog.vue`: `UiModal :open :title="dayDialogTitle(date)" size="sm" @close`. Тело — список строк: у события слева время (`startTime` или «Весь день»), справа название, под ним `participantsLabel(...)` и «Автор: {{ authorLabel(item.createdBy) }}»; у платежа — иконка `Wallet`, название, «Владелец: {{ authorLabel(item.owner) }}», справа сумма и `UiStatus` из `planStatusLabel`. Строка — `button`, эмитит `openEvent`/`openPlan`. Футер (слот `footer` у `UiModal`, сверить имя слота): `UiButton variant="secondary"` «Закрыть» и, при `canCreate`, `UiButton` с `Plus` «Новое событие на этот день» → `emit('create', date)`.

`CalendarHeader.vue`:

```vue
<script setup lang="ts">
import { ChevronLeft, ChevronRight, Plus } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import UiButtonGroup from '../ui/ButtonGroup.vue';

defineProps<{
  view: 'month' | 'agenda';
  title: string;
  ownerFilter: 'all' | 'mine';
  showOwnerFilter: boolean;
  showPlans: boolean;
  canCreate: boolean;
}>();
const emit = defineEmits<{
  'update:view': [value: 'month' | 'agenda'];
  'update:ownerFilter': [value: 'all' | 'mine'];
  'update:showPlans': [value: boolean];
  previous: [];
  next: [];
  today: [];
  create: [];
}>();

const VIEW_OPTIONS = [
  { value: 'month', label: 'Месяц' },
  { value: 'agenda', label: 'Повестка' },
];
const OWNER_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'mine', label: 'Мои' },
];
</script>

<template>
  <header class="calendar-header">
    <div class="calendar-header__titles">
      <p class="calendar-header__eyebrow">Семейный календарь</p>
      <h1 class="calendar-header__title">Календарь</h1>
    </div>
    <div class="calendar-header__controls">
      <UiButtonGroup
        :options="VIEW_OPTIONS"
        :model-value="view"
        label="Вид календаря"
        testid-prefix="calendar-view"
        @update:model-value="emit('update:view', $event as 'month' | 'agenda')"
      />
      <div class="calendar-header__nav">
        <UiButton variant="tertiary" size="sm" aria-label="Предыдущий период" tooltip="Предыдущий период" tooltip-placement="bottom" @click="emit('previous')">
          <ChevronLeft :size="18" aria-hidden="true" />
        </UiButton>
        <span class="calendar-header__period" aria-live="polite" data-testid="calendar-period">{{ title }}</span>
        <UiButton variant="tertiary" size="sm" aria-label="Следующий период" tooltip="Следующий период" tooltip-placement="bottom" @click="emit('next')">
          <ChevronRight :size="18" aria-hidden="true" />
        </UiButton>
        <UiButton variant="secondary" size="sm" @click="emit('today')">Сегодня</UiButton>
      </div>
      <UiButtonGroup
        v-if="showOwnerFilter"
        :options="OWNER_OPTIONS"
        :model-value="ownerFilter"
        label="Чьи события"
        testid-prefix="calendar-owner"
        @update:model-value="emit('update:ownerFilter', $event as 'all' | 'mine')"
      />
      <button
        type="button"
        class="calendar-header__switch"
        role="switch"
        :aria-checked="showPlans"
        data-testid="calendar-plans-toggle"
        @click="emit('update:showPlans', !showPlans)"
      >
        <span class="calendar-header__switch-track" aria-hidden="true" />
        Платежи
      </button>
      <UiButton v-if="canCreate" class="calendar-header__create" data-testid="calendar-create" @click="emit('create')">
        <Plus :size="18" aria-hidden="true" />
        <span class="calendar-header__create-label">Новое событие</span>
      </UiButton>
    </div>
  </header>
</template>
```

Стили шапки: от 1024px — заголовок слева, элементы управления в одну строку справа; ниже 1024px — `flex-wrap: wrap`, `UiButtonGroup`-ы отдельной строкой, навигация под ними, у кнопки создания скрыт текст (`.calendar-header__create-label` визуально скрыт классом `sr-only`-аналога проекта, `aria-label="Новое событие"` на кнопке); горизонтальной прокрутки нет. Если в проекте уже есть компонент-переключатель (`grep -rln 'role="switch"' apps/web/app/components`) — использовать его вместо разметки выше. Если `UiButton` не пробрасывает `aria-label`, `tooltip` — сверить с его props и `categories.vue`.

- [ ] **Step 7: Тесты проходят, проверки**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/calendar && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS, без ошибок (предупреждения lint в новых файлах — исправить).

```bash
git add apps/web/app/components/calendar
```

Коммит: `feat(web): виды «Месяц» и «Повестка» семейного календаря`.

### Task 11: Форма, карточки события и платежа

**Files:**
- Modify: `apps/web/app/components/ui/Input.vue`, `apps/web/app/components/ui/Input.test.ts` (тип `'time'`)
- Create: `apps/web/app/components/calendar/calendar-event-form.ts`, `calendar-event-form.test.ts`
- Create: `apps/web/app/components/calendar/CalendarEventForm.vue`, `CalendarEventForm.test.ts`
- Create: `apps/web/app/components/calendar/CalendarEventDialog.vue`, `CalendarEventDialog.test.ts`
- Create: `apps/web/app/components/calendar/CalendarPlanDialog.vue`, `CalendarPlanDialog.test.ts`

**Interfaces:**
- Consumes: задачи 8, 9; `UiModal`, `UiInput`, `UiSelect`, `UiDatePicker`, `UiButton`, `UiActionMenu`, `UiConfirmDialog`, `UiMoreLink`, `UiStatus`; `Member` из `useFamily.ts`.
- Produces:
  - `interface EventFormState { title; description; allDay; date; endDate; startTime; endTime; recurrence; weekdays: number[]; repeatUntil; participantUserIds: string[]; reminder: '' | '15' | '60' | '1440' | '10080' }` (строки для полей)
  - `emptyForm(date: string): EventFormState` — `startTime` '09:00', `endTime` '10:00', `recurrence` 'NONE', `weekdays` — день недели даты
  - `fromEvent(event: CalendarEventDto): EventFormState`
  - `toInput(state: EventFormState): CalendarEventInput`
  - `validateForm(state: EventFormState): Record<string, string>` — те же правила и тексты, что у сервера (задача 4)
  - `fieldErrorsFromProblem(problem: unknown): Record<string, string>` — из `{ fieldErrors: [{ field, message }] }`
  - `describeRecurrence(event: CalendarEventDto): string` → «Каждый вторник, 17:00–18:30», «Каждый день», «Каждые 2 недели: пн, ср», «Каждый месяц, 31-го», «Каждый год, 18 октября», «Не повторяется»
  - `REMINDER_LABELS: Record<string, string>` — `''` «Без напоминания», `'15'` «За 15 минут», `'60'` «За 1 час», `'1440'` «За 1 день», `'10080'` «За 1 неделю»
  - `CalendarEventForm` props `{ open: boolean; mode: 'create' | 'edit'; initial: EventFormState; members: Member[]; pending: boolean; serverErrors: Record<string, string> }`, emits `close`, `submit(input: CalendarEventInput)`
  - `CalendarEventDialog` props `{ open: boolean; event: CalendarEventDto | null; activeMemberIds: ReadonlySet<string>; deleting: boolean }`, emits `close`, `edit`, `delete`
  - `CalendarPlanDialog` props `{ open: boolean; item: CalendarFeedPlanItem | null }`, emits `close`

- [ ] **Step 1: Время в `UiInput`**

В `Input.vue` добавить `'time'` в union `type`; если поле применяет `inputmode` или маску для других типов — для `time` не применять. Тест в `Input.test.ts`: `mount(UiInput, { props: { modelValue: '17:00', name: 'start', label: 'Начало', type: 'time' } })` рендерит `input[type="time"]` с меткой «Начало» и эмитит `update:modelValue` при вводе. Если `UiInput` не пробрасывает `step` — добавить необязательный prop `step?: number`.

- [ ] **Step 2: Падающие тесты логики формы**

`calendar-event-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { CalendarEventDto } from '../../composables/useFamilyCalendar.js';
import {
  describeRecurrence,
  emptyForm,
  fieldErrorsFromProblem,
  fromEvent,
  toInput,
  validateForm,
} from './calendar-event-form.js';

describe('calendar event form', () => {
  it('starts on the given date with a one-hour slot and that weekday', () => {
    expect(emptyForm('2026-11-03')).toMatchObject({
      date: '2026-11-03',
      startTime: '09:00',
      endTime: '10:00',
      recurrence: 'NONE',
      weekdays: [2],
      allDay: false,
      reminder: '',
    });
  });

  it('builds the API input, dropping fields the rule does not use', () => {
    const state = { ...emptyForm('2026-11-03'), title: ' Кружок ', recurrence: 'WEEKLY' as const, startTime: '17:00', endTime: '18:30', reminder: '60' as const };
    expect(toInput(state)).toEqual({
      title: 'Кружок',
      description: null,
      allDay: false,
      date: '2026-11-03',
      endDate: null,
      startTime: '17:00',
      endTime: '18:30',
      recurrence: 'WEEKLY',
      interval: 1,
      weekdays: [2],
      repeatUntil: null,
      participantUserIds: [],
      reminderMinutes: 60,
    });
    expect(toInput({ ...state, recurrence: 'NONE', repeatUntil: '2026-12-01' })).toMatchObject({ weekdays: [], repeatUntil: null });
    expect(toInput({ ...state, allDay: true })).toMatchObject({ startTime: null, endTime: null });
  });

  it('validates with the server texts', () => {
    const state = { ...emptyForm('2026-11-03'), title: '', startTime: '17:00', endTime: '16:30', recurrence: 'WEEKLY' as const, weekdays: [] };
    expect(validateForm(state)).toEqual({
      title: 'Введите название.',
      endTime: 'Конец не может быть раньше начала.',
      weekdays: 'Выберите хотя бы один день недели.',
    });
  });

  it('reads server field errors', () => {
    expect(fieldErrorsFromProblem({ fieldErrors: [{ field: 'endTime', message: 'Конец не может быть раньше начала.' }] })).toEqual({
      endTime: 'Конец не может быть раньше начала.',
    });
    expect(fieldErrorsFromProblem(new Error('x'))).toEqual({});
  });

  it('describes the repeat rule', () => {
    const event = { allDay: false, date: '2026-11-03', startTime: '17:00', endTime: '18:30', recurrence: 'WEEKLY', interval: 1, weekdays: [2] } as CalendarEventDto;
    expect(describeRecurrence(event)).toBe('Каждый вторник, 17:00–18:30');
    expect(describeRecurrence({ ...event, interval: 2, weekdays: [1, 3] })).toBe('Каждые 2 недели: пн, ср, 17:00–18:30');
    expect(describeRecurrence({ ...event, allDay: true, recurrence: 'YEARLY', date: '2026-10-18' })).toBe('Каждый год, 18 октября');
    expect(describeRecurrence({ ...event, recurrence: 'MONTHLY', date: '2026-01-31' })).toBe('Каждый месяц, 31-го, 17:00–18:30');
    expect(describeRecurrence({ ...event, recurrence: 'NONE' })).toBe('Не повторяется, 17:00–18:30');
  });

  it('round-trips an event into the form', () => {
    const event = {
      title: 'Кружок', description: null, allDay: false, date: '2026-11-03', endDate: '2026-11-03', startTime: '17:00', endTime: '18:30',
      recurrence: 'WEEKLY', interval: 1, weekdays: [2], repeatUntil: '2026-12-29', reminderMinutes: 60,
      participants: [{ userId: 'a', displayName: 'Алия', isActiveMember: true }],
    } as CalendarEventDto;
    expect(toInput(fromEvent(event))).toMatchObject({ repeatUntil: '2026-12-29', reminderMinutes: 60, participantUserIds: ['a'] });
  });
});
```

Только активных участников переносит `fromEvent` в `participantUserIds` (бывших участников сервер не примет — 422); если в событии был бывший участник, форма показывает под полем «Участники» подсказку «Тимур (не в семье) будет убран из участников при сохранении».

- [ ] **Step 3: Реализация `calendar-event-form.ts`**

```ts
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import type {
  CalendarEventDto,
  CalendarEventInput,
  CalendarRecurrence,
} from '../../composables/useFamilyCalendar.js';
import { isoWeekday } from './calendar-dates.js';

export type ReminderValue = '' | '15' | '60' | '1440' | '10080';

export interface EventFormState {
  title: string;
  description: string;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  recurrence: CalendarRecurrence;
  weekdays: number[];
  repeatUntil: string;
  participantUserIds: string[];
  reminder: ReminderValue;
}

export const REMINDER_LABELS: Record<ReminderValue, string> = {
  '': 'Без напоминания',
  '15': 'За 15 минут',
  '60': 'За 1 час',
  '1440': 'За 1 день',
  '10080': 'За 1 неделю',
};

export const RECURRENCE_LABELS: Record<CalendarRecurrence, string> = {
  NONE: 'Не повторять',
  DAILY: 'Каждый день',
  WEEKLY: 'Каждую неделю',
  MONTHLY: 'Каждый месяц',
  YEARLY: 'Каждый год',
};

const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEKDAY_EVERY = ['Каждый понедельник', 'Каждый вторник', 'Каждую среду', 'Каждый четверг', 'Каждую пятницу', 'Каждую субботу', 'Каждое воскресенье'];

export function emptyForm(date: string): EventFormState {
  return {
    title: '',
    description: '',
    allDay: false,
    date,
    endDate: '',
    startTime: '09:00',
    endTime: '10:00',
    recurrence: 'NONE',
    weekdays: [isoWeekday(date)],
    repeatUntil: '',
    participantUserIds: [],
    reminder: '',
  };
}

export function fromEvent(event: CalendarEventDto): EventFormState {
  return {
    title: event.title,
    description: event.description ?? '',
    allDay: event.allDay,
    date: event.date,
    endDate: event.allDay && event.endDate !== event.date ? event.endDate : '',
    startTime: event.startTime ?? '09:00',
    endTime: event.endTime ?? '10:00',
    recurrence: event.recurrence,
    weekdays: event.recurrence === 'WEEKLY' ? [...event.weekdays] : [isoWeekday(event.date)],
    repeatUntil: event.repeatUntil ?? '',
    participantUserIds: event.participants.filter((person) => person.isActiveMember).map((person) => person.userId),
    reminder: (event.reminderMinutes === null ? '' : String(event.reminderMinutes)) as ReminderValue,
  };
}

export function toInput(state: EventFormState): CalendarEventInput {
  const repeating = state.recurrence !== 'NONE';
  return {
    title: state.title.trim(),
    description: state.description.trim() || null,
    allDay: state.allDay,
    date: state.date,
    endDate: state.allDay && state.endDate ? state.endDate : null,
    startTime: state.allDay ? null : state.startTime,
    endTime: state.allDay ? null : state.endTime,
    recurrence: state.recurrence,
    interval: 1,
    weekdays: state.recurrence === 'WEEKLY' ? [...state.weekdays].sort((a, b) => a - b) : [],
    repeatUntil: repeating && state.repeatUntil ? state.repeatUntil : null,
    participantUserIds: [...state.participantUserIds],
    reminderMinutes: state.reminder === '' ? null : Number(state.reminder),
  };
}

export function validateForm(state: EventFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!state.title.trim()) errors.title = 'Введите название.';
  if (!state.date) errors.date = 'Укажите дату в формате ГГГГ-ММ-ДД.';
  if (state.allDay) {
    if (state.endDate && state.endDate < state.date) errors.endDate = 'Дата окончания не может быть раньше даты начала.';
  } else {
    if (!state.startTime) errors.startTime = 'Укажите время начала.';
    if (!state.endTime) errors.endTime = 'Укажите время конца.';
    else if (state.startTime && state.endTime < state.startTime) errors.endTime = 'Конец не может быть раньше начала.';
  }
  if (state.recurrence === 'WEEKLY' && state.weekdays.length === 0) errors.weekdays = 'Выберите хотя бы один день недели.';
  if (state.recurrence !== 'NONE' && state.repeatUntil && state.repeatUntil < state.date) {
    errors.repeatUntil = 'Повтор не может закончиться раньше начала.';
  }
  return errors;
}

export function fieldErrorsFromProblem(problem: unknown): Record<string, string> {
  const list = (problem as { fieldErrors?: Array<{ field: string; message: string }> } | null)?.fieldErrors;
  if (!Array.isArray(list)) return {};
  return Object.fromEntries(list.map((item) => [item.field, item.message]));
}

export function describeRecurrence(event: Pick<CalendarEventDto, 'allDay' | 'date' | 'startTime' | 'endTime' | 'recurrence' | 'interval' | 'weekdays'>): string {
  const time = event.allDay ? '' : `${event.startTime}–${event.endTime}`;
  const noon = new Date(`${event.date}T12:00:00Z`);
  let rule: string;
  switch (event.recurrence) {
    case 'DAILY':
      rule = event.interval > 1 ? `Каждые ${event.interval} дня` : 'Каждый день';
      break;
    case 'WEEKLY':
      rule =
        event.interval === 1 && event.weekdays.length === 1
          ? WEEKDAY_EVERY[event.weekdays[0]! - 1]!
          : `${event.interval > 1 ? `Каждые ${event.interval} недели` : 'Каждую неделю'}: ${event.weekdays.map((day) => WEEKDAY_SHORT[day - 1]).join(', ')}`;
      break;
    case 'MONTHLY':
      rule = `Каждый месяц, ${Number(event.date.slice(8))}-го`;
      break;
    case 'YEARLY':
      rule = `Каждый год, ${format(noon, 'd MMMM', { locale: ru })}`;
      break;
    default:
      rule = 'Не повторяется';
  }
  return time ? `${rule}, ${time}` : rule;
}
```

(`interval` в форме первой версии всегда 1 — выбора интервала в UI нет; `describeRecurrence` поддерживает `interval > 1` для событий, созданных через API.)

- [ ] **Step 4: Падающие тесты компонентов**

`CalendarEventForm.test.ts` (`mount` с `attachTo: document.body`, если `UiModal` телепортирует содержимое — сверить с `PlanCreateDialog.test.ts`):
1. Режим `create`, заголовок «Новое событие», кнопка «Сохранить событие». Заполнить «Название», нажать «Сохранить событие» → эмит `submit` с `toInput(...)`.
2. Включить «Весь день» → полей «Начало» и «Конец» нет, появляется «Дата окончания».
3. Выбрать «Каждую неделю» → видны чипы «Пн … Вс» (`aria-pressed`), выбранный по умолчанию — день даты; поле «Повторять до» с подписью «необязательно».
4. Пустое название и конец раньше начала → `submit` не эмитится, под полями тексты из `validateForm`.
5. `serverErrors: { endTime: '…' }` → текст под полем «Конец».
6. Участники — чипы по `members` (`displayName`, иначе email), выбранный — с иконкой `Check` и `aria-pressed="true"`.
7. Режим `edit` — заголовок «Изменить событие».
8. `pending: true` → кнопка сохранения в состоянии загрузки, «Отмена» эмитит `close`.

`CalendarEventDialog.test.ts`:
1. `canEdit: true` → есть icon-only «Изменить» (`aria-label="Изменить событие"`) и `UiActionMenu` «Действия с событием» с пунктом «Удалить»; выбор «Удалить» открывает `UiConfirmDialog` «Удалить событие и все его повторы?», подтверждение эмитит `delete`.
2. `canEdit: false` → действий нет, есть плашка «Автор: Алия. Изменять событие может только автор».
3. Строки: `describeRecurrence`, «Повторяется до 29 декабря» при `repeatUntil`, участники через `participantsLabel`, напоминание через `REMINDER_LABELS`, «Автор: …», описание.
4. Автор — бывший участник → «Автор: Тимур (не в семье)».

`CalendarPlanDialog.test.ts`: заголовок — название платежа; «Сумма» и сумма через `formatMinorUnits`; `UiStatus` с «Просрочен»; «Владелец: Ильдар»; ссылка «Открыть в «Планах» →» с `href="/app/plans?occurrence=<occurrenceId>"`.

- [ ] **Step 5: Реализация компонентов**

`CalendarEventForm.vue` — `UiModal :title="mode === 'create' ? 'Новое событие' : 'Изменить событие'"` (размер по умолчанию, 40rem; на телефоне `UiModal` сам открывается на весь экран). Локальное состояние `reactive<EventFormState>({ ...initial })`, сброс по `watch(() => props.open)`. Поля сверху вниз, все с `label` и `:error="errors.<поле> ?? serverErrors.<поле>"`:

- `UiInput name="title" label="Название"`;
- переключатель «Весь день» (тот же компонент-переключатель, что в шапке) с подсказкой «Событие без времени начала и конца»;
- `UiDatePicker` «Дата» (`v-model="state.date"`); при `allDay` — `UiDatePicker` «Дата окончания» (необязательно);
- без `allDay` — `UiInput type="time" step=300` «Начало» и «Конец» в одной строке (`grid-template-columns: 1fr 1fr`, на узком экране — одна колонка);
- `UiSelect name="recurrence" label="Повторять"` с опциями из `RECURRENCE_LABELS`;
- при `WEEKLY` — блок на `--hf-color-surface-subtle`: `fieldset` с `legend` «Дни недели», семь кнопок-чипов «Пн…Вс» (`type="button"`, `:aria-pressed`, клик переключает день), ошибка `errors.weekdays` под блоком;
- при повторе — `UiDatePicker` «Повторять до» с подсказкой «необязательно»;
- `fieldset` «Участники» — чипы членов семьи (кнопки с `aria-pressed`, у выбранных иконка `Check`); если в `initial` были бывшие участники — подсказка про их удаление (см. шаг 2);
- `UiSelect name="reminder" label="Напоминание"` с опциями из `REMINDER_LABELS`;
- `textarea` «Описание» с подсказкой «необязательно» (если в проекте есть `UiTextarea` — использовать его, иначе нативный `textarea` с `label` и стилями `UiInput`);
- футер: `UiButton variant="secondary"` «Отмена» → `close`; `UiButton :loading="pending"` «Сохранить событие» → `const errors = validateForm(state)`, при пустом объекте — `emit('submit', toInput(state))`, иначе показать ошибки и сфокусировать первое поле с ошибкой.

`CalendarEventDialog.vue` — `UiModal size="sm" :title="event?.title ?? ''"`; в шапке (слот действий `UiModal`, сверить имя; если его нет — первая строка тела, выровненная вправо) при `event.canEdit`: `UiButton variant="tertiary" size="sm" aria-label="Изменить событие" tooltip="Изменить"` с `Pencil` → `edit`, `UiActionMenu label="Действия с событием"` с пунктом «Удалить» → открыть `UiConfirmDialog` (`title="Удалить событие и все его повторы?"`, `description="Уже созданные напоминания останутся в центре уведомлений."`, `confirmLabel="Удалить"`, `cancelLabel="Отмена"`, `variant="danger"`, `:loading="deleting"`) → `delete`. Строки тела — иконка (`Repeat` для повторяющегося, иначе `CalendarDays`; `Users`; `Bell`) + основной текст + подпись мелким («Повторяется до 29 декабря», «Участники», «Напоминание»); затем «Автор: {{ authorLabel(event.createdBy) }}»; затем «Описание». При `!event.canEdit` — плашка `Info` на `--hf-color-brand-soft`: «Автор: {{ authorLabel(event.createdBy) }}. Изменять событие может только автор».

`CalendarPlanDialog.vue` — `UiModal size="sm" :title="item?.title ?? ''"`: плашка-иконка `Wallet`, подпись «Сумма», сумма `formatMinorUnits(item.amountMinor, 'RUB', 2)` крупно (`tabular-nums`), справа `UiStatus` из `planStatusLabel`, ниже «Владелец: {{ authorLabel(item.owner) }}», внизу `UiMoreLink` «Открыть в «Планах»» с `to="/app/plans?occurrence=<occurrenceId>"` (сверить props `UiMoreLink`; стрелка «→» — его часть или текст).

- [ ] **Step 6: Тесты проходят, проверки**

Run: `pnpm --filter @harmofin/web exec vitest run app/components/calendar app/components/ui/Input.test.ts && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS.

```bash
git add apps/web/app/components/calendar apps/web/app/components/ui/Input.vue apps/web/app/components/ui/Input.test.ts
```

Коммит: `feat(web): форма и карточки событий календаря`.

### Task 12: Страница `/app/calendar`, навигация и уведомление

**Files:**
- Create: `apps/web/app/pages/app/calendar.vue`, `apps/web/app/pages/app/calendar.test.ts`
- Modify: `apps/web/app/components/app/AppSidebar.vue` (+ его тест), `apps/web/app/components/app/AppMobileMenu.vue` (+ тест)
- Modify: `apps/web/app/components/notifications/NotificationCard.vue`, `NotificationCard.test.ts`

**Interfaces:**
- Consumes: задачи 8–11; `useActiveWorkspace` (`budget`, `workspace`), `usePermissions` (`canCreate`, `userId`), `useFamily(workspaceId)` (`members`, `load`), `useToast`, `ApiRequestError` из `useApiClient.ts`.
- Produces: страница по маршруту `/app/calendar` с query `view=month|agenda` и `date=YYYY-MM-DD`; `data-hydrated="true"` на корне после монтирования (e2e ждёт его).

- [ ] **Step 1: Падающий тест страницы**

`apps/web/app/pages/app/calendar.test.ts` — по образцу `apps/web/app/pages/app/plans.test.ts` (моки `useApiClient`, `useActiveWorkspace`, `usePermissions`, `useFamily`, `useRoute`/`navigateTo` через `app/test/nuxt-imports.ts`). Мок `useFamilyCalendar`:

```ts
const calendar = {
  feed: vi.fn(),
  getEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
};
vi.mock('../../composables/useFamilyCalendar.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFamilyCalendar: () => calendar,
}));
```

Сценарии (системное время зафиксировать `vi.setSystemTime(new Date('2026-10-30T09:00:00Z'))`):
1. На ширине ≥1024px (`window.innerWidth = 1280` до монтирования) открывается «Месяц»: `calendar.feed` вызван с `{ from: '2026-09-28', to: '2026-11-01' }` (диапазон сетки октября), заголовок периода «Октябрь 2026».
2. На ширине 390 — «Повестка»: `feed` с `{ from: '2026-10-30', to: '2026-11-12' }`; «Показать ещё» вызывает `feed` с `{ from: '2026-11-13', to: '2026-11-26' }` и дописывает элементы.
3. `?view=agenda&date=2026-11-03` из query уважается.
4. «›» в месяце → `feed` с диапазоном ноября; «Сегодня» возвращает к октябрю.
5. «Мои» → `feed` с `participantUserId: <userId>`; выключение «Платежи» → `includePlans: false`.
6. Для `VIEWER` (`canCreate: false`) кнопки «Новое событие» нет.
7. Создание: «Новое событие» → форма → `submit` → `calendar.createEvent(budgetId, input, key)`; при успехе — toast «Событие сохранено», лента перезагружается. Ошибка 400 с `fieldErrors` → ошибки уходят в форму, форма открыта. Повтор той же попытки после сетевой ошибки использует тот же `Idempotency-Key`; новое открытие формы — новый ключ.
8. Клик по событию в повестке → `getEvent` → карточка события; «Изменить» → форма в режиме `edit` с `fromEvent`; «Удалить» → `deleteEvent`, toast «Событие удалено».
9. 403 `NOT_EVENT_AUTHOR` при сохранении → toast с `detail` сервера, форма закрывается, лента перезагружается.
10. Ошибка загрузки ленты → `UiEmptyState` «Календарь недоступен» с кнопкой «Повторить».

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/calendar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Страница**

`apps/web/app/pages/app/calendar.vue` — `definePageMeta({ middleware: 'auth', layout: 'app' })`, как у `plans.vue`. Состояние:

```ts
const route = useRoute();
const { budget, workspace } = useActiveWorkspace();
const { canCreate, userId } = usePermissions();
const { members, load: loadMembers } = useFamily(computed(() => workspace.value?.id));
const calendar = useFamilyCalendar();
const { push } = useToast();

const hydrated = ref(false);
const today = ref(todayLocal()); // локальная дата браузера; дата «сегодня» нужна только для подсветки и якоря
const view = ref<'month' | 'agenda'>('month');
const anchor = ref(today.value); // YYYY-MM-DD: месяц для «Месяца», первый день для «Повестки»
const ownerFilter = ref<'all' | 'mine'>('all');
const showPlans = ref(true);
const items = ref<CalendarFeedItem[]>([]);
const loadError = ref(false);
const loadingMore = ref(false);
let agendaTo = '';
let request = 0;

const activeMemberIds = computed(() => new Set(members.value.map((member) => member.userId)));
const month = computed(() => anchor.value.slice(0, 7));
const range = computed(() => (view.value === 'month' ? monthRange(month.value) : agendaRange(anchor.value)));
const title = computed(() => (view.value === 'month' ? monthTitle(month.value) : agendaTitle(range.value)));

async function load(): Promise<void> {
  if (!budget.value) return;
  const mine = request + 1;
  request = mine;
  loadError.value = false;
  try {
    const response = await calendar.feed(budget.value.id, {
      ...range.value,
      participantUserId: ownerFilter.value === 'mine' ? (userId.value ?? undefined) : undefined,
      includePlans: showPlans.value,
    });
    if (mine !== request) return;
    items.value = response.items;
    agendaTo = range.value.to;
  } catch {
    if (mine === request) loadError.value = true;
  }
}
```

- `todayLocal()` — `format(new Date(), 'yyyy-MM-dd')` из `date-fns`. Сервер считает «сегодня» по поясу бюджета; для подсветки дня этого достаточно — денежных решений на клиенте нет.
- `onMounted`: `view` — из `route.query.view`, иначе `window.innerWidth >= 1024 ? 'month' : 'agenda'`; `anchor` — из `route.query.date` (если валидная дата), иначе `today`; затем `loadMembers()` и `load()`; `hydrated.value = true`.
- `watch([view, anchor, ownerFilter, showPlans], load)`; смена `view`/`anchor` обновляет query через `navigateTo({ query: { view, date } }, { replace: true })`.
- «‹»/«›»: в «Месяце» — `anchor = \`${shiftMonth(month, ∓1)}-01\``, в «Повестке» — `anchor = addIsoDays(anchor, ∓14)`; «Сегодня» — `anchor = today`.
- «Показать ещё»: `feed` с `{ from: addIsoDays(agendaTo, 1), to: addIsoDays(agendaTo, 14) }`, элементы дописываются, `agendaTo` сдвигается; `loadingMore` на время запроса.
- Фильтр «Все / Мои» показывается при `members.length > 1`.
- `openDay(date)` → `CalendarDayDialog` с `groupByDay(items).get(date) ?? []`.
- `openEvent(item)` → `calendar.getEvent(budgetId, item.eventId)` → `CalendarEventDialog`; ошибка 404 → toast «Событие удалено или недоступно», перезагрузка ленты.
- `openPlan(item)` → `CalendarPlanDialog`.
- Создание/правка: при открытии формы — `idempotencyKey = crypto.randomUUID()`; `submit(input)` → `createEvent`/`updateEvent` с этим ключом. Успех → закрыть форму и карточку, toast `{ tone: 'success', title: 'Событие сохранено' }`, `load()`. `ApiRequestError` со статусом 400/422 → `serverErrors = fieldErrorsFromProblem(error.problem)` (для 422 `PARTICIPANT_NOT_MEMBER` — `{ participantUserIds: detail }`), форма остаётся. 403 → toast с `detail`, форма закрывается, `load()`. Сеть/5xx → toast «Не удалось сохранить событие. Повторите попытку.», форма и ключ остаются. Поле с ошибкой и форму ошибки сверить с тем, как `plans.vue` разбирает `ApiRequestError` (имя поля с телом проблемы).
- Удаление → `deleteEvent`, toast «Событие удалено», закрыть карточку, `load()`.
- «Новое событие на этот день» → форма с `emptyForm(date)`.

Разметка: корень `<div v-if="hydrated" class="calendar-page" data-hydrated="true">`; `CalendarHeader`; при `loadError` — `UiEmptyState title="Календарь недоступен" description="Не удалось загрузить события. Проверьте соединение и повторите."` со слотом действия `UiButton` «Повторить» → `load()`; иначе `CalendarMonthGrid` или `CalendarAgenda`; затем диалоги. Отступы и ширина страницы — как у `plans.vue`.

- [ ] **Step 4: Навигация**

`AppSidebar.vue`: сразу после ссылки «Планы» —

```vue
        <NuxtLink
          to="/app/calendar"
          class="app-sidebar__link"
          active-class="app-sidebar__link--active"
          :aria-current="currentPage('/app/calendar')"
          ><CalendarDays :size="18" aria-hidden="true" />Календарь</NuxtLink
        >
```

(импорт `CalendarDays` из `@lucide/vue`). Так же — в `AppMobileMenu.vue` после «Планов», в его стиле разметки. В тестах сайдбара и мобильного меню — ожидание ссылки «Календарь» на `/app/calendar` и `aria-current="page"` на этом маршруте (по образцу проверки «Планов»).

- [ ] **Step 5: Уведомление**

`NotificationCard.vue`: для `CALENDAR_REMINDER` — иконка `Bell` в заголовке и подпись типа «Календарь» вместо «Семья»; текст ссылки «Открыть в календаре». Минимальная правка:

```ts
const MEMBER_EVENT_ICONS: Partial<Record<NotificationType, Component>> = {
  MEMBER_JOINED: UserPlus,
  MEMBER_LEFT: UserMinus,
  MEMBER_REMOVED: UserX,
  OBJECTS_TRANSFERRED: Users,
  CALENDAR_REMINDER: Bell,
};

function typeCaption(): string {
  return props.notification.notificationType === 'CALENDAR_REMINDER' ? 'Календарь' : 'Семья';
}

function linkText(): string {
  return props.notification.notificationType === 'CALENDAR_REMINDER' ? 'Открыть в календаре' : 'Открыть';
}
```

и в шаблоне `{{ typeCaption() }}` вместо «Семья», `{{ linkText() }}` вместо «Открыть». Тест в `NotificationCard.test.ts`: уведомление `CALENDAR_REMINDER` с `actionPath: '/app/calendar?date=2026-11-03'` показывает «Календарь», заголовок, текст «Сегодня в 17:00» и ссылку «Открыть в календаре» на этот путь; существующие тесты семейных уведомлений не меняются.

- [ ] **Step 6: Тесты и проверки**

Run: `pnpm --filter @harmofin/web test && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS.

```bash
git add apps/web/app/pages/app/calendar.vue apps/web/app/pages/app/calendar.test.ts apps/web/app/components/app apps/web/app/components/notifications
```

Коммит: `feat(web): страница семейного календаря`.

### Task 13: E2E и документация

**Files:**
- Create: `e2e/family-calendar.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md` (новый раздел и строка в границах v1), `README.md` (если в нём перечислены разделы приложения), `docs/superpowers/specs/2026-10-30-family-calendar-design.md` (статус «реализован»)

- [ ] **Step 1: E2E-сценарий (только CI)**

`e2e/family-calendar.spec.ts` — по образцу `e2e/family-ownership.spec.ts` (скопировать оттуда `registerAccount`, `waitForHydration`, `setDisplayName`, блок приглашения и регистрации участницы). Сценарий:

```ts
import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('a family shares a weekly event; the member sees it but cannot edit it', async ({ browser }) => {
  test.setTimeout(180_000);
  const creator = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const creatorPage = await creator.newPage();
  const member = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberPage = await member.newPage();
  const stamp = Date.now();

  // 1. Creator with a name; invite and register the member (helpers from family-ownership.spec.ts).
  await registerAccount(creatorPage, `e2e-cal-creator-${stamp}@harmofin.test`);
  await setDisplayName(creatorPage, 'Ильдар');
  await inviteAndJoin(creatorPage, memberPage, `e2e-cal-member-${stamp}@harmofin.test`, 'Алия');

  // 2. Creator adds a weekly event with the member as participant.
  await creatorPage.goto('/app/calendar?view=month');
  await waitForHydration(creatorPage);
  await creatorPage.getByTestId('calendar-create').click();
  const form = creatorPage.getByRole('dialog', { name: 'Новое событие' });
  await form.getByLabel('Название').fill('Кружок рисования');
  await form.getByLabel('Начало').fill('17:00');
  await form.getByLabel('Конец').fill('18:30');
  await form.getByRole('combobox', { name: 'Повторять' }).click();
  await creatorPage.getByRole('option', { name: 'Каждую неделю' }).click();
  await form.getByRole('button', { name: 'Алия' }).click();
  await form.getByRole('button', { name: 'Сохранить событие' }).click();
  await expect(creatorPage.getByTestId('toast-stack')).toContainText('Событие сохранено');
  await expect(creatorPage.getByRole('grid')).toContainText('17:00 Кружок рисования');

  // 3. The member sees it in the agenda, read-only.
  await memberPage.goto('/app/calendar?view=agenda');
  await waitForHydration(memberPage);
  const row = memberPage.locator('[data-testid^="agenda-item-"]', { hasText: 'Кружок рисования' }).first();
  await expect(row).toContainText('17:00');
  await row.getByRole('button').click();
  const card = memberPage.getByRole('dialog', { name: 'Кружок рисования' });
  await expect(card).toContainText('Изменять событие может только автор');
  await expect(card.getByRole('button', { name: 'Изменить событие' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Закрыть' }).click();

  // 4. The member creates her own all-day event.
  await memberPage.getByTestId('calendar-create').click();
  const ownForm = memberPage.getByRole('dialog', { name: 'Новое событие' });
  await ownForm.getByLabel('Название').fill('День рождения бабушки');
  await ownForm.getByRole('switch', { name: 'Весь день' }).click();
  await ownForm.getByRole('button', { name: 'Сохранить событие' }).click();
  await expect(memberPage.getByTestId('toast-stack')).toContainText('Событие сохранено');
  await expect(memberPage.locator('[data-testid^="agenda-item-"]', { hasText: 'День рождения бабушки' })).toBeVisible();

  await creator.close();
  await member.close();
});

test('mobile agenda in the dark theme has no horizontal scroll', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await context.newPage();
  await registerAccount(page, `e2e-cal-mobile-${Date.now()}@harmofin.test`);
  await page.goto('/app/calendar');
  await waitForHydration(page);
  await expect(page.getByTestId('calendar-view-agenda')).toHaveAttribute('aria-pressed', 'true');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});
```

`inviteAndJoin(creatorPage, memberPage, email, name)` — вынести шаги приглашения и регистрации участника из `family-ownership.spec.ts` в функцию этого файла (код скопировать, не импортировать между спеками). Атрибут выбранной кнопки `UiButtonGroup` (`aria-pressed` или `aria-checked`) и способ выбора в `UiSelect` (`combobox`/`option`) сверить с компонентами и другими спеками; поля времени `type="time"` в Chromium заполняются `fill('17:00')`. Выбор даты не нужен: форма по умолчанию открывается на сегодняшней дате.

Run: `pnpm exec tsc --noEmit -p e2e/tsconfig.json` (если такой конфиг есть; иначе `pnpm lint`) — только типы и lint. **Playwright локально не запускать.**

- [ ] **Step 2: Функциональная спецификация**

В `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`:
- в разделе «4. Границы v1» — строка, что семейный календарь входит в v1 по решению владельца от 30.10.2026 (ссылка на дизайн), по образцу строки про семейный доступ;
- новый подраздел в разделе 14 или отдельный раздел после «15. Уведомления» — «Семейный календарь»: что это, события (поля, повторения, участники, напоминание), права (таблица из дизайна), лента «события + платежи только для просмотра», виды «Месяц» и «Повестка», напоминания `CALENDAR_REMINDER`, что вне объёма. Текст — короче дизайна, без технических деталей API;
- в «21. Критерии приемки v1» — 3–5 пунктов календаря (создание повторяющегося события, правка только автором, платежи в ленте совпадают с «Планами», напоминание приходит один раз).

- [ ] **Step 3: README и статус дизайна**

Если `README.md` перечисляет разделы приложения — добавить «Календарь». В дизайне календаря строку статуса заменить на «**Статус:** реализован; остаётся источником правил календаря».

- [ ] **Step 4: Финальные проверки ветки**

Run по очереди: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:integration`.
Expected: всё зелёное. Красный набор, не связанный с календарём, — сравнить с `main` и сообщить координатору, не чинить в этой задаче.

```bash
git add e2e/family-calendar.spec.ts docs/superpowers/specs/2026-08-30-family-budget-app-spec.md docs/superpowers/specs/2026-10-30-family-calendar-design.md README.md
```

Коммит: `test(e2e): семейный календарь; документация`. **Конец PR 4.**

---

## Review по задачам

| Задача | Обязательные review |
|---|---|
| 1. Повторения в api | backend, QA, final |
| 2. Копия в worker | backend, QA, final |
| 3. Схема и миграция | backend (миграция), security (purge, связи с `users`), QA, final |
| 4. Политика и схемы | security, API, QA, final |
| 5. CRUD событий | security, API, backend, QA, final |
| 6. Лента | security, API, financial (суммы платежей из планов не пересчитываются), QA, final |
| 7. Напоминания | backend, security (получатели, данные в уведомлении), QA, final |
| 8. Клиент API | API, QA, final |
| 9. Даты и подписи | UI/UX, QA, final |
| 10. Месяц и повестка | UI/UX, QA, final |
| 11. Форма и карточки | UI/UX, QA, final |
| 12. Страница, навигация, уведомление | UI/UX, security (видимость действий не заменяет серверную проверку), QA, final |
| 13. E2E и документация | QA, final |

`BLOCK` Financial или Security координатор не снимает сам: исправляет writer, review повторяется. Каждый reviewer получает: текст задачи из этого плана, раздел дизайна, `git diff` задачи и вывод проверок.

## Ход выполнения

| Задача | Статус | Коммит | Review |
|---|---|---|---|
| План и дизайн | закоммичены | — | — |
| 1–13 | не начаты | — | — |

Решения, принятые при выполнении, и отложенные мелкие замечания — записывать сюда.
