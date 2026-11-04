# Несколько напоминаний на событие календаря: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Цель.** У события календаря может быть до трёх напоминаний. Варианты: в момент начала, за 5, 15 и 30 минут, за 1 и 2 часа, за 1 и 2 дня, за 1 неделю. Каждое напоминание приходит в центр уведомлений и в уже работающие каналы: email, Telegram, push. В настройках email и Telegram появляются отдельные переключатели «Просроченные платежи» и «Напоминания календаря».

**Архитектура.**
- В строке события хранится массив смещений `calendar_events.reminder_offsets`. Старая колонка `reminder_minutes` остаётся зеркалом наименьшего смещения, чтобы откат образа не ломал напоминания.
- API календаря получает поле `reminders: number[]`. Старое `reminderMinutes` продолжает работать как устаревшее поле, поэтому бот не меняется.
- Worker перебирает смещения события. Ключ уведомления прежний: `calendar:<eventId>:<дата>:<минуты>`.
- Переключатели по типу уже есть в каждой строке `notification_channel_settings`. Worker начинает учитывать их во всех каналах, API email и Telegram начинает их отдавать и принимать.

**Стек.** TypeScript strict, NestJS 11 + Fastify, Prisma 6 + PostgreSQL 18, zod 4, Vitest 4, Nuxt 4 / Vue 3.5, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-11-03-calendar-multiple-reminders-design.md](../../specs/2026-11-03-calendar-multiple-reminders-design.md). Прочитать целиком один раз перед задачей 1. Если план и спецификация расходятся, прав дизайн, а расхождение записывается в «Ход выполнения».

Основа — уже работающий семейный календарь ([дизайн](../../specs/2026-10-30-family-calendar-design.md)) и доставка срочных уведомлений по email, Telegram и push.

## Как выполнять этот план

Исполнитель — Qwen с контекстом около 100 тыс. токенов на другом устройстве. Он работает через своих субагентов и не может открывать PR.

### Роли субагентов

- **Основной агент (оркестратор)** ведёт одну задачу за раз:
  - выдаёт субагенту-исполнителю файл задачи;
  - собирает проверки;
  - отдаёт staged diff ревьюерам;
  - делает коммит;
  - заполняет «Ход выполнения».

  Сам код он не пишет, если исполнитель справляется.
- **Исполнитель** — один на задачу, один writer. Он получает этот README и только свой `task-NN-*.md`, выполняет шаги по порядку, делает только `git add` и не коммитит.
- **Ревьюеры** только читают. Каждому ревьюеру из чек-листа задачи оркестратор даёт `git diff --staged`, файл задачи и раздел спецификации. Ответ ревьюера — `APPROVE` одной строкой или замечание по форме «серьёзность, `path:line`, сценарий, нарушенное правило, нужное исправление». Если ревьюер ответил `BLOCK`, исполнитель исправляет, затем проверки и тот же ревью запускаются повторно.
- Если субагентов нет, оркестратор проходит чек-лист сам и честно отмечает это в «Ходе выполнения».

### Правила

- **Читать по одной задаче.** Перед задачей N открыть только этот README и `task-NN-*.md`. Код в файле задачи полный: его копируют, а не придумывают. Всё нужное из других задач перечислено в блоке «Interfaces».
- **Ветка.** Одна ветка — `feat/calendar-multiple-reminders`. На ней уже закоммичены спецификация и этот план. Начать с `git fetch origin && git switch feat/calendar-multiple-reminders && git pull --ff-only`. Перед каждым коммитом `git branch --show-current` должен вывести `feat/calendar-multiple-reminders`.
- **Без PR.** Каждая задача заканчивается одним коммитом. Если review потребовал исправления, допустимы два коммита. `git push` делается только по прямому разрешению владельца.
- **Порядок строгий: 1 → 2 → … → 6.** Следующая задача начинается только после того, как предыдущая закоммичена и её проверки зелёные.
- **Если что-то не сходится** (файл выглядит не так, как в плане, или тест падает непонятно почему): остановиться, не импровизировать, записать строку в «Ход выполнения» и спросить владельца. Исключение — опечатки, импорты, которые подсказывает TypeScript, и переносы строк от Prettier.
- **Ход выполнения** ведётся в конце этого README. После каждого коммита добавляется строка: задача, хеш, пройденные проверки, отступления.

## Global Constraints

- Допустимые смещения напоминаний, в минутах: `0, 5, 15, 30, 60, 120, 1440, 2880, 10080`. Не больше 3 на событие, без повторов. Сервер хранит массив по возрастанию.
- `0` — момент начала вхождения. Для события «весь день» любое смещение отсчитывается от 09:00 дня события по часовому поясу бюджета (`ALL_DAY_REMINDER_TIME`).
- `reminder_minutes` всегда равен наименьшему смещению или `NULL`. Сервер пишет оба поля в одной операции.
- Ключ уведомления не меняется: `calendar:<eventId>:<occurrenceDate>:<minutes>`. Повтор запуска не создаёт дубль (`createMany({ skipDuplicates: true })`).
- API событий (`/api/v2/budgets/{budgetId}/calendar/events`):
  - `reminders` — новое необязательное поле;
  - `reminderMinutes` — устаревшее (`deprecated`), продолжает работать;
  - если пришли оба поля, `reminderMinutes` должно быть равно наименьшему из `reminders` (или `null` при пустом массиве);
  - если при `PATCH` не пришло ни одно, напоминания не меняются;
  - ошибки валидации — 400 `VALIDATION_FAILED` с полем `reminders`.
- Тексты ошибок дословно:
  - «Можно выбрать до трёх напоминаний.»;
  - «Выберите напоминание из списка.»;
  - «Напоминания не должны повторяться.»;
  - «Напоминания не совпадают с reminderMinutes.».
- Настройки email и Telegram: поля `planOverdueEnabled` и `calendarReminderEnabled` есть в ответе. Во входе `PUT` они необязательны; если поле не пришло, значение не меняется. По умолчанию `true`. Обновлённые значения пишутся в аудит `UPDATED` канала.
- Переключатель по типу проверяется во всех каналах: при постановке в очередь (`enqueueUrgent`) и при отправке (`cancelReason` → `TYPE_DISABLED`).
- Бот (`/event`) не меняется и продолжает работать через `reminderMinutes`.
- Миграция только аддитивная: новая колонка, backfill, расширение check-ограничений, пересоздание частичного индекса. **Никогда** не запускать `pnpm db:migrate:dev`, reset или откат на данных владельца (БД `harmofin`).
- Изоляция по бюджету и права автора события не меняются: все запросы по-прежнему фильтруют `budgetId` в самой БД.
- Тексты UI — на русском, идентификаторы — на английском. Calm Fintech: только существующие компоненты и токены, без новых цветов. Состояние чипа передаётся галочкой и `aria-pressed`, а не только цветом.
- Local Playwright не запускать, только CI. Не создавать worktree. Не трогать `identity/logo_description.png`. Не запускать `pnpm infra:down` и не убивать dev-процессы владельца.
- Новых npm-зависимостей не добавлять.
- Интеграционные тесты:
  - Весь набор: `pnpm test:integration`. Он работает только на одноразовой БД `harmofin_v22_test` и применяет миграции. Если в `.env` указана другая БД, запускать с `DATABASE_URL='postgresql://harmofin_local:harmofin_local@127.0.0.1:5432/harmofin_v22_test' pnpm test:integration`.
  - Один файл: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@127.0.0.1:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/<файл>`.
  - После новой миграции сначала один раз прогнать `pnpm test:integration`: он применит миграцию к одноразовой БД.
- `pnpm db:generate` может падать с EPERM, пока у владельца запущены dev-процессы: Windows держит движок Prisma. Процессы не трогать, сообщить владельцу.
- `openapi.json` обновляется так:
  1. `node scripts/openapi/generate.mjs`;
  2. `pnpm exec prettier --write openapi.json`;
  3. `node scripts/openapi/check.mjs openapi.json` — должен завершиться без `lint:`.
- Сообщения коммитов — Conventional Commits, описание на русском, например `feat(calendar): ...`.

## Уточнения к дизайну, найденные при подготовке плана

1. Внешняя доставка напоминаний уже работает: `CalendarReminderHandler.createReminder` вызывает `enqueueUrgent` для каждого нового уведомления. В этой работе меняется только набор смещений и проверка типа в каналах.
2. Колонки `plan_overdue_enabled` и `calendar_reminder_enabled` уже есть в каждой строке `notification_channel_settings`, по умолчанию `true`. Миграция для них не нужна.
3. Prisma создаёт массивные колонки без `NOT NULL` (`"weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[]`). Новая колонка объявляется так же, а `NULL` запрещает check-ограничение. Иначе `prisma migrate diff` после миграции не будет пустым.
4. Частичный индекс `calendar_events_reminders_idx` и check-ограничения в `schema.prisma` не описаны (Prisma их не моделирует). Они живут только в SQL миграций.
5. `PATCH` события принимает полное тело той же схемы, что и `POST`. Чтобы при отсутствии обоих полей напоминания не менялись, схема отдаёт `reminders: null` («не передано»), а сервис подставляет текущие смещения события.
6. Текущие тесты используют `reminderMinutes: 30` как недопустимое значение (`calendar.schemas.test.ts`, `calendar-schema.integration.test.ts`). Теперь 30 допустимо, эти проверки переводятся на 45.
7. Web-клиент отправляет только `reminders`. Тип ответа `CalendarEventDto` в web получает `reminders`; `reminderMinutes` в нём остаётся, потому что сервер продолжает его отдавать.
8. В push чекбоксы называются «Просроченные платежи» и «Напоминания календаря». В email и Telegram используются те же подписи и те же `name`.

## Задачи

| № | Файл | Что делает | Review |
|---|---|---|---|
| 1 | [task-01-schema.md](task-01-schema.md) | Колонка `reminder_offsets`, backfill, ограничения, индекс | backend, QA, final |
| 2 | [task-02-calendar-api.md](task-02-calendar-api.md) | `reminders` в схеме, маппере, сервисе, DTO и OpenAPI | API, security, QA, final |
| 3 | [task-03-worker.md](task-03-worker.md) | Несколько смещений в worker; тип во всех каналах | backend, QA, final |
| 4 | [task-04-channel-settings-api.md](task-04-channel-settings-api.md) | Переключатели по типу в API email и Telegram | API, security, QA, final |
| 5 | [task-05-web-reminders.md](task-05-web-reminders.md) | Чипы напоминаний в форме, строка в карточке | UI/UX, QA, final |
| 6 | [task-06-web-settings-docs.md](task-06-web-settings-docs.md) | Чекбоксы на страницах email и Telegram, E2E, документация | UI/UX, QA, final |

## Финальная проверка (после задачи 6)

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
git show origin/main:openapi.json > openapi.base.json
node scripts/openapi/generate.mjs openapi.head.json && node scripts/openapi/check.mjs openapi.head.json openapi.base.json
git diff --no-index --stat openapi.head.json openapi.json; rm -f openapi.head.json openapi.base.json
git status --short
```

Ожидается:
- всё зелёное;
- `check.mjs` без `lint:` и `breaking change:`;
- `git diff --no-index` по OpenAPI пустой или отличается только форматированием (иначе пересобрать `openapi.json`);
- у `lint` допустимы warnings при 0 errors;
- у `format:check` допустим известный красный `manifest.webmanifest`, если он красный и на `main`;
- в `git status` пусто, кроме `identity/logo_description.png`, если он есть.

E2E выполняется только в CI. После проверки остановиться и сообщить владельцу:
- список коммитов (`git log --oneline origin/main..HEAD`);
- результаты проверок;
- отступления от плана.

Push и PR — решение владельца.

## Ход выполнения

| Задача | Коммит | Проверки | Отступления и решения |
|---|---|---|---|
| 1 | e39d004 | один файл 12/12; `test:integration` 855 PASS; `migrate diff` пустой; typecheck PASS; worker tests PASS; review: backend/QA/final APPROVE | нет |
| 2 | 6eba46b | unit calendar+telegram 120/120; integration 54/54 (4 файла); api 515/515; typecheck/lint/prettier PASS; openapi regenerated, check без `lint:`; review: API/security/QA/final APPROVE | prettier перенёс строки в двух unit-файлах задач (разрешённое исключение) |
| 3 | ac6bf9c | шаг 3 fail-to-pass подтверждён; 3 изменённых файла 38/38; worker suite 179/179; typecheck/lint/prettier PASS; `test:integration` 860/860; `email-digest` отдельно 6/6; review: backend/QA/final APPROVE | ПЛАН НЕПОЛОН (расхождение плана и реальности, остановились, спросили владельца): две устаревшие фикстуры вне границ задачи — `apps/worker/src/notification.handler.test.ts` (mock настроек EMAIL без `planOverdueEnabled`/`calendarReminderEnabled`, в БД дефолт `true`) и `apps/api/test/email-digest.integration.test.ts` (прямой `create` с `reminderMinutes: 60` без `reminderOffsets`). Владелец одобрил механические правки фикстур (+type-флаги в mock; `reminderOffsets: [60]`). Дополнительно в границах задачи: type-флаги в mock `calendar-reminder.handler.test.ts`; prettier-перенос в `eligibility.test.ts`. Продуктовый код шагов 4–6 дословно по плану |
| 4 | 5638f85 | шаг 3 fail-to-pass подтверждён (5 failed); unit notification+telegram 91/91; integration 36/36 (5 файлов); api 518/518; typecheck/lint/prettier PASS; openapi regenerated, check без `lint:` и без breaking (вход optional); review: API/security/QA/final APPROVE | нет; QA INFO (не блокер): интеграционный аудит telegram и `planOverdueEnabled` в email проверены только на уровне unit-mock |
| 5 | aab0036 | state-тесты 8 fail → 15 PASS; form-тесты 4 fail → 13 PASS; web-сьют 1815 PASS; typecheck PASS; lint 0 errors; prettier чист; grep старых ссылок clean; review: UI-UX/QA/final APPROVE | отступления — порядковый импорт `MAX_REMINDERS` и prettier-перенос в form-тесте; UI/UX MINOR (не блокер): подсказка лимита без live-region (WCAG 4.1.3); QA INFO: дедуп `fromEvent` без теста |
| 6 | 129cf8f | шаг 3 fail-to-pass подтверждён (5 failed/18); настройки 18/18; web-сьют 1818 PASS; typecheck PASS; lint 0 errors (4 warning `vue/html-self-closing` — стиль плана); prettier чист, e2e-спека только формат (Playwright — CI); grep-приёмка документации clean; review: UI-UX/QA/final APPROVE | нет; QA INFO (не блокер): «скрытые срочные сохраняют значения» для telegram покрыто только скрытием, без submit-assert |
| Финал | — | typecheck PASS; lint 0 errors (175 warnings: 171 предсуществующих + 4 self-closing); `pnpm test` PASS (web 1818, все работы); `test:integration` 862/862 на `harmofin_v22_test`; `format:check` — только известный красный `apps/web/public/manifest.webmanifest` (красен и на `main`, файл не менялся); OpenAPI: `check.mjs` без `lint:` и `breaking change`, сгенерированный diff с коммитным пустой после prettier; `git status` чист, кроме этого README | строки «Хода выполнения» задач 3–6 и хеш задачи 3 в этот итоговый docs-коммит вместо коммитов задач (отступление от правила «после каждого коммита»; решено оркестратором, проверкам не мешает) |
