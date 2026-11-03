# Команды Telegram-бота: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Цель.** Участник семьи с привязанным личным чатом включает в настройках «Команды бота» и подтверждает согласие. После этого в Telegram он может:
- провести расход, доход или перевод;
- создать простое событие календаря;
- посмотреть последние операции, ближайшие платежи, события и остатки.

**Архитектура.**
- Webhook остаётся прежним. `parseTelegramUpdate` начинает понимать команды, текст и нажатия inline-кнопок.
- `TelegramLinkApplicationService` по-прежнему обрабатывает `/start` и `/stop`, а всё остальное отдаёт новому `TelegramCommandService`.
- `TelegramCommandService` проверяет чат, ограничение частоты и переключатель команд, определяет бюджет, затем ведёт пошаговый диалог или отвечает на команду просмотра.
- Логика шагов — чистые функции в `bot/dialog-flow.ts`. Состояние диалога лежит в таблице `telegram_dialogs`.
- Запись и чтение идут только через существующие application services (операции v2, переводы, календарь, журнал, планы, счета, дашборд). У бота нет своих расчётов денег и своих проверок прав.

**Стек.** TypeScript strict, NestJS 11 + Fastify, Prisma 6 + PostgreSQL 18, zod 4, Vitest 4, Nuxt 4 / Vue 3.5, Playwright (только CI), bash.

**Spec:** [docs/superpowers/specs/2026-11-02-telegram-bot-commands-design.md](../../specs/2026-11-02-telegram-bot-commands-design.md). Прочитать целиком один раз перед задачей 1. Если план и спецификация расходятся, прав дизайн, а расхождение записывается в «Ход выполнения».

Основа — уже работающие уведомления в Telegram ([дизайн](../../specs/2026-10-31-telegram-notifications-design.md)). Привязка чата, webhook, `TelegramRepository` и `HttpTelegramBotClient` уже есть в `main`.

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
- **Ветка.** Одна ветка — `feat/telegram-bot-commands`. На ней уже закоммичены спецификация и этот план. Начать с `git fetch origin && git switch feat/telegram-bot-commands && git pull --ff-only`. Перед каждым коммитом `git branch --show-current` должен вывести `feat/telegram-bot-commands`.
- **Без PR.** Каждая задача заканчивается одним коммитом. Если review потребовал исправления, допустимы два коммита. `git push` делается только по прямому разрешению владельца.
- **Порядок строгий: 1 → 2 → … → 8.** Следующая задача начинается только после того, как предыдущая закоммичена и её проверки зелёные.
- **Если что-то не сходится** (файл выглядит не так, как в плане, или тест падает непонятно почему): остановиться, не импровизировать, записать строку в «Ход выполнения» и спросить владельца. Исключение — опечатки, импорты, которые подсказывает TypeScript, и переносы строк от Prettier.
- **Ход выполнения** ведётся в конце этого README. После каждого коммита добавляется строка: задача, хеш, пройденные проверки, отступления.

## Global Constraints

- Обновления принимаются только из личных чатов (`chat.type = "private"`). Пользователь определяется только по `telegram_links.chat_id`, данные профиля Telegram не используются и не хранятся.
- Перед любым ответом по команде проверяется вся цепочка:
  1. привязка есть;
  2. `users.status = 'ACTIVE'`;
  3. `telegram_links.commands_enabled_at IS NOT NULL`;
  4. есть активное участие в активном пространстве;
  5. у этого пространства есть активный бюджет с `planModelVersion = 2`.
- Бюджет — из участия с наибольшим `last_selected_at` (`nulls last`), затем самого раннего по `created_at`. В пространстве берётся самый ранний активный бюджет с `planModelVersion = 2`.
- Деньги, роли, владение счётом и фильтр по бюджету проверяют только существующие сервисы: `TransactionV2ApplicationService.create`, `DirectTransferApplicationService.create`, `CalendarApplicationService.createEvent`. Бот не пишет в финансовые таблицы напрямую.
- Операции из бота сразу `CONFIRMED`. Ключ идемпотентности и `requestId` — `telegram:<id диалога>`. Повторное «Провести» не создаёт вторую запись.
- Сумма разбирается строкой: пробелы убираются, запятая заменяется точкой, не больше 12 цифр до точки и 2 после, больше нуля. В сервис уходит каноническая строка `"1250.50"`. Float для денег не используется.
- Для операций предлагаются только свои активные RUB-счета пользователя, потому что этого требует `requireAccountOwner`. Получатель перевода — любой активный RUB-счёт бюджета, кроме источника.
- Конверты обязательных платежей (`MANDATORY_EXPENSES`) в боте не предлагаются. Будущая дата у операции не принимается.
- `callback_data` — `<версия>:<действие>[:<индекс>]`, не длиннее 64 байт, без UUID. Если версия не совпала, бот отвечает «Диалог устарел, начните заново».
- Диалог живёт 30 минут с последнего шага. У чата не больше одного диалога: новая команда заменяет старый диалог.
- Ограничение частоты: 30 обновлений в минуту на чат, счётчик в памяти процесса. Обновления сверх лимита отбрасываются без ответа.
- Webhook всегда отвечает 200, если секрет верный. Любая ошибка внутри бота превращается в короткий ответ в чате, исключение наружу не выходит.
- Не попадают в логи, метрики, аудит и `last_error`: `chat_id`, текст сообщений пользователя, суммы, названия. URL запросов к Bot API содержит токен и никогда не логируется.
- Новый эндпоинт только один: `PUT /api/v1/me/notification-settings/telegram/commands`. К ответу `GET` добавляется поле `commandsEnabled`. Изменения только добавляют, ничего не ломают, всё описано в OpenAPI.
- Миграция только аддитивная, без бэкфилла. **Никогда** не запускать `pnpm db:migrate:dev`, reset или откат на данных владельца (БД `harmofin`).
- Тексты бота и UI — на русском, идентификаторы — на английском. Бот отправляет HTML с parse mode `HTML`, весь пользовательский текст проходит через `escapeHtml`.
- Calm Fintech: только существующие компоненты и токены, без новых цветов. Статус показывается текстом.
- Local Playwright не запускать, только CI. Не создавать worktree. Не трогать `identity/logo_description.png`. Не запускать `pnpm infra:down` и не убивать dev-процессы владельца.
- Новых npm-зависимостей не добавлять.
- Интеграционные тесты:
  - Весь набор: `pnpm test:integration`. Он работает на одноразовой БД `harmofin_v22_test` и применяет миграции.
  - Один файл: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/<файл>`.
  - Если Prisma даёт `P1001` на `localhost`, взять `127.0.0.1`. Это особенность среды, в код она не попадает.
  - После новой миграции сначала один раз прогнать `pnpm test:integration`.
- `pnpm db:generate` может падать с EPERM, пока у владельца запущены dev-процессы: Windows держит движок Prisma. Процессы не трогать, сообщить владельцу.
- `openapi.json` обновляется так:
  1. `node scripts/openapi/generate.mjs`;
  2. `pnpm exec prettier --write openapi.json`;
  3. `node scripts/openapi/check.mjs openapi.json` — должен завершиться без `lint:`.
- Сообщения коммитов — Conventional Commits, описание на русском, например `feat(telegram): ...`.

## Уточнения к дизайну, найденные при подготовке плана

1. В спецификации шаги просмотра описаны как «журнал v2 и переводы». В плане `/last` берёт `JournalApplicationService.list` с `status: 'CONFIRMED'` и `limit: 10`: он уже сливает операции и переводы в один порядок.
2. Для `/plans` используется `PlansCalendarApplicationService.calendar`. Он отдаёт `overdue` (все открытые просроченные) и `items` месяца. Ближайшие — открытые (`PENDING` и `DUE`) с датой от сегодня до сегодня + 6 дней, не просроченные. Сумма — `unpaidMinor`.
3. `/events` вызывает `CalendarApplicationService.feed` с `includePlans: false` на окно «сегодня … сегодня + 6».
4. `/balance` использует `AccountApplicationService.list(..., 'active')` и `DashboardV2ApplicationService.summary`. «Доступно» — `spendable.amountMinor` до `period.end`. При `NEEDS_PERIOD_SETUP` бот пишет «настройте период в приложении».
5. Аудит создаваемых записей пишут сами сервисы с источником `API`, а `request_id` содержит `telegram:<id диалога>`. Сервисы не меняются.
6. В `TelegramModule` сервисы создаются через `new` в `useFactory`, как это делают их собственные модули. Импортировать их модули второй раз нельзя: контроллеры зарегистрировались бы дважды.
7. При текстовом ответе (сумма, название, дата) бот присылает новое сообщение с клавиатурой. При нажатии кнопки он редактирует своё сообщение. Версия диалога растёт на каждом шаге, поэтому кнопки старых сообщений становятся устаревшими.
8. VIEWER получает отказ сразу при `/expense`, `/income`, `/transfer`, `/event`, а сервисы при сохранении всё равно проверяют роль ещё раз.
9. Скрипт регистрации webhook добавляет `callback_query` в `allowed_updates` и вызывает `setMyCommands`. Без `callback_query` Telegram не присылает нажатия кнопок.
10. В интеграционных тестах `WEB_BASE_URL = http://localhost:3000`, поэтому url-кнопок нет (`webButton` возвращает `[]`). Callback-кнопки при этом есть.

## Задачи

| № | Файл | Что делает | Review |
|---|---|---|---|
| 1 | [task-01-schema.md](task-01-schema.md) | Колонки команд, таблица `telegram_dialogs`, удаление аккаунта, очистка в воркере | backend, security, QA, final |
| 2 | [task-02-bot-client.md](task-02-bot-client.md) | Клавиатуры, правка сообщения, ответ на кнопку; разбор команд, текста, кнопок | security, QA, final |
| 3 | [task-03-commands-setting.md](task-03-commands-setting.md) | `PUT .../telegram/commands`, `commandsEnabled`, OpenAPI | security, API, QA, final |
| 4 | [task-04-dialog-flow.md](task-04-dialog-flow.md) | Чистые функции: разбор сумм и дат, `callback_data`, машина шагов всех диалогов | financial, QA, final |
| 5 | [task-05-command-service.md](task-05-command-service.md) | Репозиторий бота, контекст, лимит, `TelegramCommandService`, сохранение, wiring | financial, security, backend, QA, final |
| 6 | [task-06-views.md](task-06-views.md) | `/last`, `/plans`, `/events`, `/balance` | security, financial, QA, final |
| 7 | [task-07-web.md](task-07-web.md) | Переключатель «Команды бота» с согласием на странице Telegram | UI/UX, security, QA, final |
| 8 | [task-08-infra-docs.md](task-08-infra-docs.md) | Скрипт webhook, E2E, документация | release, security, QA, final |

## Финальная проверка (после задачи 8)

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
for test_file in infra/scripts/*.test.sh; do bash "$test_file" || exit 1; done
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
| 1 | d43e0c0 | `db:generate` PASS; `prisma migrate diff` (применённая миграция vs schema.prisma, `--script`) = пустой diff; `typecheck` PASS; worker test 174 PASS; полный `pnpm test:integration` PASS (после дополнений ниже); ревью backend/security/QA/final — все APPROVE | Docker-блок снят перезапуском владельцем. Пробел плана: `budget-reset-script.integration.test.ts` требует строки фикстуры и `DELETE` в `docs/runbooks/budget-reset.sql` для каждой таблицы с `budget_id` из `information_schema`; plan task-01 этого не предусматривал. Владелец одобрил отступление: `DELETE FROM telegram_dialogs` + фикстура `telegramDialog`. Прогоны с `DATABASE_URL` на `127.0.0.1` (P1001 на `localhost` — особенность Windows-сокета, в код не вошло). |
| 2 | 7e005e7 | unit `vitest run src/telegram` 28 PASS (падения Step 2/4 зафиксированы до имплементации); integration `telegram-linking` 16 PASS; `typecheck`/`lint`/`prettier --check` PASS; ревью security/QA/final — все APPROVE | Prettier `--write` двух тестовых файлов (переносы, разрешено правилами). Неблокирующие INFO ревьюеров: срез текста по UTF-16 на границе 1000 (код из плана); сетевая ошибка fetch может показать URL с токеном (унаследовано от задачи 1, на радаре задачи 5). |
| 3 | 066a39e | unit Step 1 FAIL зафиксирован, затем `vitest run src/telegram` 34 PASS; integration 3 файла (commands/settings/linking) 29 PASS; openapi generate+check без `lint:`; `pnpm --filter @harmofin/api test` 463 PASS (di-explicit-inject включён); typecheck/lint PASS; ревью security/API/QA/final — все APPROVE | Отступлений нет. Неблокирующие замечания ревьюеров (не менять): LOW гонка конкурентного unlink -> P2025 вместо 409; nit — после 422 в интеграционном тесте не проверен `commandsConsentAt` (покрыто unit); гонка двух `enabled:true` даст два аудита ENABLED (идемпотентно). |
| 4 | 9ac05b8 | TDD-падения Step 2/6 зафиксированы (`Cannot find module`); `vitest run src/telegram/bot` 3 файла 35 PASS (12+5+18); `typecheck` PASS; `lint` 0 errors; `prettier --check src/telegram/bot` PASS; ревью financial/QA/final — все APPROVE | Только Prettier-переносы (разрешено). Расхождение план/spec, решение оркестратора по правилу «прав дизайн»: spec (`2026-11-02-...design.md:106`) требует кнопку-ссылку `/app/accounts` при пустом списке своих счетов — чистый модуль base-URL не знает, задача 5 дописывает url-кнопку в keyboard перед отправкой. Carry-forward в packet задачи 5: фильтр `MANDATORY_EXPENSES` в контракте `envelopes()` (P3), сверка `version` + идемпотентный ключ `telegram:<id диалога>` (LOW), бросок `encodeCallback` при >999 элементов списка — ограничить длину списков или ловить рендер в сервисе (P3), граница года `parseDay` для EVENT — отсечь на схеме, тест в задаче 6 (P4). Spec в packet задачи 4 был указан 11-03 — фактический путь 11-02. |
| 5 | 1f39283 | лимитер TDD красный/зелёный; unit `vitest run src/telegram/bot` 4 файла 37 PASS; `pnpm --filter @harmofin/api test` 500 PASS; `pnpm test:integration` (root) 845 PASS / 85 файлов (14 новых диалоговых + telegram-linking 16 PASS + соседние telegram-интеграции 27 PASS); typecheck/lint 0 errors/prettier PASS; ревью financial/security/backend/QA/final — все APPROVE | Отступление ①: `accountsLink` — url-кнопка `/app/accounts` при «Нет своих счетов» (spec `2026-11-02-...design.md:106` требует, в плановом кода не было; правило «прав дизайн»). Отступление ②: Prisma-сид категорий в `beforeAll` интеграционного теста (регистрация их не создаёт; повторяет паттерн существующих интеграционных тестов). Carry-forward LOW в backlog (не блокируют): сверка `messageId` в callback против stale-диалога; юнит-тест `accountsLink` + константа вместо подстроки «Нет своих счетов»; `prune()` лимитера best-effort при >10k живых чатов; INFO: retry save с изменённым hash → idempotency-conflict; лимитер in-process (single-instance assumption). |
| 6 | d356d5c (+ style 28d04cf) | TDD red/green; `vitest run src/telegram/bot` 6 файлов 46 PASS; integration views+dialogs 20 PASS (оркестратор перепроверил dialogs 14/14); `pnpm --filter @harmofin/api test` 509 PASS; typecheck/lint 0 errors/prettier PASS; ревью security/QA/final APPROVE; financial сначала **BLOCK** (см. отступление), после фикса re-review APPROVE | BLOCK финансовый (плановый баг кода): `/plans` печатал доходы «+0,00 ₽» — `line()` читал `unpaidMinor`, который `incomeItem()` сервиса жёстко ставит `'0'`; реальная сумма в `expectedMinor` (spec:141 требует сумму). Фикс: `PlanLine.amountMinor` с маппингом по kind (OBLIGATION→unpaidMinor, INCOME_PLAN→expectedMinor), unit-мок приведён к фактической форме `incomeItem()`, интеграция добавила ненулевые `+80 000 ₽`/`−3 000 ₽` через API. Отступления от плана: фикс BLOCK + новый unit-файл `telegram-bot-views.test.ts` ( loader-маппинг). Style-коммит 28d04cf: prettier для `telegram-dialogs-schema.integration.test.ts`, закоммичен грязным в task-01. Backlog INFO/LOW: `escapeHtml` для HH:MM на будущее; именованный options-объект конструктора вместо позиционных `views?/limiter?`; усечение `/events` без футера «и ещё N»; тест границы года `parseDay` (carry-forward task-04, в плане task-06 не оказался). |
| 7 | b78a80e | TDD red (нет `setTelegramCommands`; 3 FAIL страницы) / green; `vitest run` 2 файлов 13 PASS; `pnpm --filter @harmofin/web test` 1807 PASS / 218 файлов (свежий прогон QA); typecheck/lint 0 errors/prettier PASS; ревью UI/UX/security/QA/final — все APPROVE | Отступление: prettier --write `telegram.test.ts` (разрешено). Backlog LOW (не блокируют, правка по желанию в task-08/отдельно): `commandsError` не сбрасывается в `load()`/`unlink()` (устаревший danger после перепривязки); live-область ошибки через `v-if` (паттерн страницы); INFO контраст success-пилюли `UiStatus` (вне diff). |
| 8 | c3e3bf4 | bash-тест скрипта красный (4 FAIL) / зелёный; все `infra/scripts/*.test.sh` PASS (перепроверено оркестратором); openapi-блок «Финальной проверки» PASS (check без `lint:`/`breaking change:`, diff пуст после prettier-нормализации, повторено оркестратором на HEAD); Финальная проверка: typecheck PASS, lint 0 errors/171 warnings, `format:check` красен только разрешённый `manifest.webmanifest`, `pnpm test` EXIT=0 (web 1807/218), интеграции root initially 848/851 (3 flaky FAIL в не менявшихся `account-deletion`/`api-process` — перепрогон изолированно 20/20 PASS; прогон writer до коммита 851/851); ревью release/security/QA/final — все APPROVE | Отступлений нет (все плановые тексты доков дословно). Playwright не запускался (e2e только CI). Backlog (вне diff, не блокируют): e2e `/balance` ждёт только 200 без проверки ответа бота (плановая конструкция — закрытый порт); устаревшие `allowed_updates` в историческом design `2026-10-31-telegram-notifications-design.md:145,157`; проверка «нет токена в выводе» только на success-ветке скрипт-теста; токен в argv curl (`ps`) — канон Bot API. |
