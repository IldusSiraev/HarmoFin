# Push-уведомления в браузере — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Участник семьи включает push на своих устройствах (браузер, PWA на iPhone) и получает системные уведомления о просроченном платеже и напоминания календаря. Без сумм, у каждого типа свой флажок. Устройство отключается при выходе из аккаунта и при ответе push-сервиса 404/410/403.

**Architecture:** Новая таблица `push_subscriptions` (устройство привязано к сессии), значение `PUSH` в `NotificationChannel` и два флажка типов в `notification_channel_settings`. API (`apps/api/src/push/`) хранит подписки и настройки, отдаёт публичный VAPID-ключ. Воркер ставит `PUSH` в общую очередь `notification_deliveries`; `PushSender` шифрует и отправляет payload пакетом `web-push` на все активные устройства пользователя. Service worker из PWA показывает уведомление и по нажатию открывает экран приложения.

**Tech Stack:** TypeScript strict, NestJS 11 + Fastify, Prisma 6 + PostgreSQL 18, zod 4, Vitest 4, `web-push` 3.x (только воркер), Nuxt 4 / Vue 3.5, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-11-02-web-push-notifications-design.md](../../specs/2026-11-02-web-push-notifications-design.md). Прочитать целиком один раз перед задачей 1. Если план расходится со спецификацией, верна спецификация. Расхождение записать в «Ход выполнения».

## Как выполнять этот план

Исполнитель — модель с контекстом около 100 тыс. токенов на другом устройстве, без возможности открывать PR.

- **Читать по одной задаче.** Перед задачей N открыть только этот README и файл `task-NN-*.md`. Код в файле задачи полный: его нужно копировать, а не придумывать. Другие задачи не читать: всё нужное из них перечислено в блоке «Interfaces» текущей задачи.
- **Ветка.** Одна ветка `feat/web-push`. На ней уже закоммичены спецификация и этот план, поэтому `git fetch origin && git switch feat/web-push`. Если ветки нет ни локально, ни в `origin`, остановиться и спросить владельца. Перед каждым коммитом `git branch --show-current` должен вывести `feat/web-push`: владелец переключает ветки.
- **Без PR.** Каждая задача заканчивается одним коммитом, или двумя, если review потребовал исправления. Промежуточных PR нет. `git push` — только с прямого разрешения владельца.
- **Порядок строгий:** 1 → 2 → … → 8. Задача начинается, только когда предыдущая закоммичена и её проверки зелёные.
- **Если что-то не сходится** (файл выглядит не так, как в плане, тест падает по непонятной причине), остановиться и не импровизировать. Записать строку в «Ход выполнения» и спросить владельца. Исключение — опечатки и импорты, которые явно подсказывает TypeScript, а также переносы строк от `prettier --write`.
- **Самопроверка перед коммитом.** В конце каждой задачи есть чек-лист review. Пройти его по `git diff --staged`. Если субагенты доступны, отдать diff ревьюерам из чек-листа (только чтение). Если нет, пройти чек-лист самому и честно отметить это в «Ход выполнения».
- **Ход выполнения** вести в конце этого README (таблица). После каждого коммита добавить строку: задача, хеш коммита, какие проверки прошли, отступления от плана.

## Global Constraints

- Push отправляется только срочным уведомлениям `PLAN_OVERDUE` и `CALENDAR_REMINDER`, только на подписки с активной сессией: `revokedAt = null`, `idleExpiresAt > now`, `absoluteExpiresAt > now`. Получатель — активный пользователь и активный участник активного бюджета (`planModelVersion = 2`). Дайджест в push не отправляется.
- Суммы в push не попадают никогда: `loadUrgentContent(..., false)`.
- Канал `PUSH` по умолчанию выключен (`enabled = false`), флажки `planOverdueEnabled` и `calendarReminderEnabled` по умолчанию `true`. Строка `PUSH` создаётся с `digestFrequency = 'OFF'`. Первая подписка включает канал. После удаления последней подписки канал выключается, а записи `PUSH` в статусе `PENDING` отменяются (`PUSH_NO_DEVICES`).
- Endpoint: только `https`, без порта и учётных данных, не длиннее 2048 символов. Хост равен одному из суффиксов `fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com`, `notify.windows.com` или оканчивается на `.` + суффикс. `p256dh` — base64url, 65 байт, первый байт `0x04`. `auth` — base64url, 16 байт.
- Не больше 10 подписок на пользователя: лишние, самые старые, удаляются (причина `limit`).
- `endpoint`, `p256dh`, `auth`, payload и приватный VAPID-ключ не попадают в логи, метрики, аудит, `last_error`, ответы API и тексты ошибок. API не отдаёт endpoint клиенту.
- Приватный VAPID-ключ есть только у воркера. В API, вебе, клиентском бандле и `runtimeConfig` его нет. Клиент получает публичный ключ из `GET /api/v1/me/notification-settings/push`.
- Ответы push-сервиса: `2xx` — успех; `404`/`410`/`403` — подписка удаляется (`gone`); `429` — `RetryLaterError` по `Retry-After` (по умолчанию 60 с); `5xx` и сеть — обычный повтор; прочие `4xx` — `PermanentSendError`, если ни одно устройство не получило уведомление.
- Новые эндпоинты — только в `/api/v1` и только добавлением. Все тела, ответы и ошибки описаны в OpenAPI.
- Миграция только добавляет, без бэкфилла. **Никогда** не запускать `pnpm db:migrate:dev`, reset или откат на данных владельца (БД `harmofin`).
- UI-тексты на русском, идентификаторы на английском. Calm Fintech: только существующие токены и компоненты, без новых цветов; статус передаётся текстом, а не только цветом.
- Локальный Playwright не запускать (только CI). Не создавать worktree. Не трогать `identity/logo_description.png`. Не запускать `pnpm infra:down` и не останавливать dev-процессы владельца.
- Новая npm-зависимость только одна: `web-push` (и `@types/web-push` в devDependencies) в `apps/worker`. Других не добавлять.
- Интеграционные тесты: весь набор — `pnpm test:integration` (одноразовая БД `harmofin_v22_test`, применяет миграции). Один файл: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/<файл>`. После новой миграции сначала один раз прогнать `pnpm test:integration`. Если Prisma на этой машине даёт P1001 на `localhost` (IPv6), использовать `127.0.0.1` в URL и записать это в «Ход выполнения».
- Интеграционные тесты обработчиков воркера живут в `apps/api/test/` и импортируют `../../worker/src/...`.
- `pnpm db:generate` может падать с EPERM, пока у владельца запущены dev-процессы (Windows держит движок Prisma). Процессы не трогать, сообщить владельцу.
- Обновление `openapi.json`: `node scripts/openapi/generate.mjs`, затем `pnpm exec prettier --write openapi.json`, затем `node scripts/openapi/check.mjs openapi.json`. Последняя команда должна завершиться без строк `lint:`.
- Сообщения коммитов — Conventional Commits, описание на русском, например `feat(push): подписки устройств и настройки канала`.

## Уточнения к дизайну, найденные при подготовке плана

1. Ветка `feat/web-push` создаётся от `main` после слияния PR 101 (линейные графики). Спецификация и план — первый коммит ветки.
2. Тип задачи `BUILD_EMAIL_DIGESTS` не переименовывается. Обработчик `BuildEmailDigestsHandler` получает только каналы дайджеста (`EMAIL`, `TELEGRAM`; тип `DigestChannel`). Без них он не строит дайджесты, но выполняет очистку, в том числе подписок неактивных сессий.
3. У `enqueueUrgent` появляется обязательный параметр `type: 'PLAN_OVERDUE' | 'CALENDAR_REMINDER'`. Его передают два места вызова: `notification.handler.ts` и `calendar-reminder.handler.ts`.
4. В `DeliveryFacts` добавляются `setting.planOverdueEnabled`, `setting.calendarReminderEnabled` и `notification.notificationType`. `cancelReason` для `PUSH` возвращает новую причину `TYPE_DISABLED`.
5. FK `push_subscriptions.session_id` → `sessions` с `ON DELETE CASCADE`: удаление сессий (удаление аккаунта, очистка тестов) убирает подписки. `user_id` → `users` с `RESTRICT`, как у других таблиц.
6. `AuthRateLimitGuard` ограничивает `POST /api/v1/me/push/subscriptions` лимитом `rateLimit.loginMax`, как ссылку Telegram. Интеграционные тесты поднимают лимит через `RATE_LIMIT_LOGIN_MAX: '100'`.
7. Service worker в dev не регистрируется (`register-service-worker.ts`). Поэтому E2E подменяет `navigator.serviceWorker.getRegistration`, `PushManager` и `Notification`.
8. Удаление аккаунта (`apps/worker/src/account-purge.ts`) должно знать `push_subscriptions`, иначе `account-purge.coverage.test.ts` упадёт на неклассифицированной модели.

## Задачи

| № | Файл | Что делает | Review |
|---|---|---|---|
| 1 | [task-01-schema.md](task-01-schema.md) | Схема, миграция, удаление аккаунта, очистка тестов | backend, security, QA, final |
| 2 | [task-02-api-foundation.md](task-02-api-foundation.md) | `VAPID_PUBLIC_KEY` в конфиге API, проверки endpoint и ключей, подпись устройства | security, API, QA, final |
| 3 | [task-03-api-endpoints.md](task-03-api-endpoints.md) | Репозиторий, сервис, контроллер, OpenAPI, интеграционные тесты API | security, API, backend, QA, final |
| 4 | [task-04-worker-queue.md](task-04-worker-queue.md) | `PUSH` в очереди, флажки типов, очистка подписок | backend, security, QA, final |
| 5 | [task-05-worker-push-sender.md](task-05-worker-push-sender.md) | Конфиг VAPID воркера, `web-push`, `PushSender`, wiring | backend, security, QA, final |
| 6 | [task-06-web-service-worker.md](task-06-web-service-worker.md) | Обработчики `push`/`notificationclick`, помощники `pwa/push.ts`, снятие подписки при выходе | security, UI/UX, QA, final |
| 7 | [task-07-web-settings.md](task-07-web-settings.md) | Страница `/app/settings/push`, composable, пункт в настройках | UI/UX, QA, final |
| 8 | [task-08-infra-e2e-docs.md](task-08-infra-e2e-docs.md) | Env, compose, E2E, функциональная спецификация, `CLAUDE.md`, `README.md` | release, security, QA, final |

## Финальная проверка (после задачи 8)

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

- все проверки зелёные: у `lint` допустимы warnings, но 0 errors; у `format:check` допустим известный красный `manifest.webmanifest`, если он красный и на `main`;
- `check.mjs` без строк `lint:` и `breaking change:`;
- `git diff --no-index` по OpenAPI пустой или отличается только форматированием, иначе пересобрать `openapi.json`;
- `git status` пустой, кроме `identity/logo_description.png`, если он есть.

E2E выполняется только в CI. Затем остановиться и сообщить владельцу:

- список коммитов (`git log --oneline origin/main..HEAD`);
- результаты проверок;
- отступления от плана.

Push и PR — решение владельца.

## Ход выполнения

| Задача | Коммит | Проверки | Отступления и решения |
|---|---|---|---|
| 1 — схема и миграция | 3babbb8 (плюс docs-коммит строки) | test:integration PASS (796, push-schema 4/4); worker test PASS (154, account-purge.coverage incl.); migrate diff — «empty migration»; typecheck PASS; test-first падения зафиксированы (2× TypeError, 2× PrismaClientValidationError) до миграции/генерации | отступлений нет; localhost, EPERM/P1001 не встречались; reviewers backend/security/QA/final — APPROVE |
| 2 — API: конфиг VAPID и проверки | 575a12c (плюс docs-коммит строки) | выполнена; все проверки шага 7 PASS (api test 72 файла/448; env.push 4; push-endpoint 15; device-label 10; typecheck PASS; lint 0 errors; rerun vitest push 29 PASS); test-first падения зафиксированы (3 файла) | отступлений нет; prettier — только перенос в env.push.test.ts; reviewers security/API/QA/final — APPROVE; чек-лист пройден writer (субагентов не было) |
| 3 — API: подписки и настройки канала | c000548 (плюс docs-коммит строки) | выполнена; шаги 10/11/12 PASS (integration 14/14; test:integration 80 файлов/810; api test 72 файла/448; typecheck/lint — 0 errors; openapi check — 4 новых пути, без `lint:`); test-first падение зафиксировано (14× 404 до реализации) | отступлений нет, только prettier-переносы (3 файла); reviewers security/API/backend/QA/final — APPROVE; BLOCK API-ревьюера снят пересмотром (унаследованный общеспековой шаблон path-параметров); чек-лист пройден writer (субагентов не было) |
| 4 — воркер: канал PUSH в очереди | ef7057f (плюс docs-коммит строки) | выполнена; unit enqueue PASS 5/5, eligibility PASS 16/16, test:integration 81 файл/814 PASS (push-queue 4/4: очередь/отозванная сессия/digest/purge; telegram-delivery/email-delivery/email-digest/delivery-channels зелёные), worker test 25 файлов/158 PASS (до и после prettier), typecheck PASS, lint 0 errors; падения шагов 3/6 зафиксированы: шаг 3 — `Tests 3 failed \| 2 passed (5)` (PUSH не ставился, `pushSubscription.count` 0 calls), шаг 6 — `Tests 2 failed \| 14 passed (16)` (`TYPE_DISABLED` не возвращался) | отступлений нет (прямая копия из плана); prettier-переносы в 5 файлах (eligibility.test, enqueue.test, enqueue, subscriptions, push-queue.integration); правки ожиданий `enqueueUrgent` в handler-тестах не потребовались; reviewers backend/security/QA/final — APPROVE; чек-лист пройден writer (субагентов не было) |
| 5 — воркер: отправка push | 55c0f6e (плюс docs-коммит строки) | выполнена; test-first падения зафиксированы: шаг 2 — `Tests 3 failed \| 1 passed (4)`, шаги 4/6/8 — `Cannot find module` (payload.js, summary.js, web-push-transport.js); PASS: конфиги 17/17 (push 4 + config 9 + telegram 4), payload 4/4, summary 4/4, транспорт 4/4, worker typecheck PASS, test:integration 82 файла/820 PASS (push-delivery 6/6), worker test 29 файлов/174 PASS (до и после prettier), typecheck PASS, lint 0 errors, worker build PASS | отступлений нет: плановая замена импорта не потребовалась — `import webpush from 'web-push'` прошёл typecheck; prettier свернул 2 предварительных переноса обратно в строки плана (push-sender.ts, web-push-transport.ts), финальный код = план; пакеты web-push 3.6.7, @types/web-push 3.6.4 (--save-exact); reviewers backend/security/QA/final — APPROVE |
| 6 — веб: service worker и push (2026-11-02) | b357bba (плюс docs-коммит строки) | готово; test-first падения зафиксированы: шаг 1 — `TypeError: listeners[type] is not a function` (11 failed, обработчиков не было), шаг 3 — `Failed to resolve import "./push.js"` (vite-эквивалент `Cannot find module`), шаг 5 — `expected [ 'logout' ] to deeply equal [ 'unsubscribe', 'logout' ]`; PASS: sw-push 11 + sw 9 = 20/20, push 11/11, logout+useAuth 8/8, web test 217 файлов/1791 PASS (до и после prettier), typecheck PASS (`Uint8Array<ArrayBuffer>` замена не потребовалась), lint 0 errors (164 warnings — прежний фон) | отступление: план, строка 211 — `let data = null;` заменено на `let data;` (после точной копии ESLint `no-useless-assignment` давал 1 error; семантический no-op: все пути try/catch переприсваивают `data` до чтения; принято оркестратором после BLOCK); prettier-переносы в push.test.ts и sw-push.test.ts; reviewers security/UI-UX/QA/final — APPROVE, BLOCK: none; чек-лист по git diff --staged прошёл writer |
| 7 — веб: страница настроек push (2026-11-02) | ad47245 (плюс docs-коммит строки) | готово; test-first падения зафиксированы: шаг 2 — `Failed to resolve import "./push.vue"`, шаг 4 — `AssertionError: expected false to be true` (ссылка «Push-уведомления», 1 failed \| 13 passed); PASS: push.test 10/10, index.test 14/14, web test 218 файлов/1802 PASS (до и после prettier), typecheck PASS (exit 0), lint 0 errors (170 warnings: 3× `vue/html-self-closing` — прежний фон, 3× vue-indent/closing-bracket — конфликты prettier-переносов), web build PASS | отступление: план, `ref<NotificationPermission | null>` заменено на `ref<ReturnType<typeof notificationPermission>>` (type-only DOM-глобал не знает ESLint `no-undef` — давал 1 error; тип тождественен: ровно `NotificationPermission | null` возвращает хелпер); токены `--hf-space-1`/`--hf-space-6` нашлись в tokens.css — отступлений нет; `aria-label` пробрасывается Button.vue (`ariaLabel` prop + `v-bind="$attrs"`); prettier изменил только push.vue, web test повторён; reviewers UI/UX/QA/final — APPROVE, BLOCK: none; чек-лист по git diff --staged прошёл writer |
