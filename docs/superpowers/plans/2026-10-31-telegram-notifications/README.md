# Уведомления в Telegram — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Участник семьи привязывает личный чат с ботом HarmoFin одноразовой ссылкой после согласия и получает туда срочные сообщения (просроченный платёж, напоминание календаря) и дайджест событий семьи; суммы — только по отдельному согласию; кнопки ведут в приложение.

**Architecture:** Две новые таблицы (`telegram_links`, `telegram_link_codes`) и значение `TELEGRAM` в `NotificationChannel`. API принимает webhook Telegram (`/api/v1/telegram/webhook`, защита секретным заголовком, мимо `OriginGuard`), выдаёт ссылку привязки и отдаёт настройки канала. Воркер: существующая очередь `notification_deliveries` обобщается по каналам, у каждого канала свой отправитель (`EmailSender`, `TelegramSender`); Bot API вызывается через `fetch` без библиотек.

**Tech Stack:** TypeScript strict, NestJS 11 + Fastify, Prisma 6 + PostgreSQL 18, zod 4, Vitest 4, Nuxt 4 / Vue 3.5, Playwright (только CI), bash для инфраструктуры.

**Spec:** [docs/superpowers/specs/2026-10-31-telegram-notifications-design.md](../../specs/2026-10-31-telegram-notifications-design.md). Прочитать целиком один раз перед задачей 1. При расхождении плана и спецификации прав дизайн; расхождение записать в «Ход выполнения».

## Как выполнять этот план

Исполнитель — модель с контекстом около 100 тыс. токенов на другом устройстве, без возможности открывать PR.

- **Читать по одной задаче.** Перед задачей N открыть только этот README и файл `task-NN-*.md`. Код в файле задачи полный: копировать его, а не придумывать. Других задач не читать — всё нужное из них перечислено в блоке «Interfaces» текущей задачи.
- **Ветка.** Одна ветка `feat/telegram-notifications` от свежего `origin/main`. Если ветки ещё нет: `git fetch origin && git switch -c feat/telegram-notifications origin/main`. Если есть (на ней уже закоммичены спецификация и этот план): `git switch feat/telegram-notifications`. Перед каждым коммитом — `git branch --show-current` должен вывести `feat/telegram-notifications`.
- **Без PR.** Каждая задача заканчивается одним коммитом (или двумя, если review потребовал исправления). Промежуточных PR нет. `git push` — только если владелец прямо разрешил; без разрешения не пушить.
- **Порядок строгий:** 1 → 2 → … → 8. Задача начинается, только когда предыдущая закоммичена и её проверки зелёные.
- **Если что-то не сходится** (файл выглядит не так, как в плане, тест падает по непонятной причине): остановиться, не импровизировать, записать в «Ход выполнения» строку с описанием и спросить владельца. Исключение: опечатки и импорты, которые TypeScript явно подсказывает.
- **Самопроверка перед коммитом.** В конце каждой задачи есть чек-лист review. Пройти его по `git diff --staged`. Если субагенты доступны — отдать diff ревьюерам из чек-листа (только чтение); если нет — пройти чек-лист самому и честно отметить это в «Ход выполнения».
- **Ход выполнения** вести в конце этого README (таблица). После каждого коммита добавить строку: задача, хеш коммита, какие проверки прошли, отступления от плана.

## Global Constraints

- Сообщения в Telegram уходят только в привязанный **личный** чат (`chat.type = "private"`), только активному пользователю (`users.status = 'ACTIVE'`), который на момент отправки — активный участник рабочего пространства бюджета, в активном бюджете с `planModelVersion = 2`.
- Канал `TELEGRAM` по умолчанию выключен (`enabled = false`), «срочные» по умолчанию включены, дайджест по умолчанию `DAILY`, суммы выключены. Пока строки настроек нет — действуют значения по умолчанию.
- Включить канал без привязки нельзя: 409 `TELEGRAM_NOT_LINKED`. Суммы — только с `amountsConsent: true` (иначе 422 `AMOUNTS_CONSENT_REQUIRED`); согласие email на Telegram не распространяется.
- Код привязки: 32 случайных байта `base64url` (43 символа), в БД — только HMAC через `TokenService.digest`, срок 15 минут, одноразовый; выдача нового кода гасит прежние неиспользованные.
- Привязка требует согласия `{consent: true}` (иначе 422 `TELEGRAM_CONSENT_REQUIRED`); время согласия хранится в коде и в привязке.
- Имя, username, профиль Telegram не хранятся. `chat_id`, код привязки, токен бота, текст сообщений, суммы не попадают в логи, метрики, аудит, `last_error`. URL запросов к Bot API (в нём токен бота) никогда не логируется и не попадает в текст ошибок.
- Webhook: `POST /api/v1/telegram/webhook`, заголовок `X-Telegram-Bot-Api-Secret-Token` сверяется с `TELEGRAM_WEBHOOK_SECRET` через `timingSafeEqual`; без бота в конфиге — 404; неверный секрет — 401; иначе всегда 200.
- Ответы Bot API в воркере: 429 — повтор через `retry_after` без роста попыток; 403 или 400 `chat not found` — отвязка и `CANCELLED`; прочие 4xx — `FAILED`; 5xx/сеть/таймаут — обычные повторы.
- Кнопки в сообщениях ставятся, только если `WEB_BASE_URL` начинается с `https://`.
- Новые эндпоинты — в `/api/v1`, только добавление; все тела, ответы и ошибки описаны в OpenAPI.
- Миграция только аддитивная, без бэкфилла. **Никогда** не запускать `pnpm db:migrate:dev`, reset или откат на данных владельца (БД `harmofin`).
- UI-тексты и сообщения бота — на русском, идентификаторы — на английском. Calm Fintech: только существующие токены и компоненты, без новых цветов; статус — текстом, не только цветом.
- Local Playwright не запускать (только CI). Не создавать worktree. Не трогать `identity/logo_description.png`. Не запускать `pnpm infra:down`, не убивать dev-процессы владельца.
- Новых npm-зависимостей не добавлять.
- Интеграционные тесты: весь набор — `pnpm test:integration` (одноразовая БД `harmofin_v22_test`, применяет миграции). Один файл: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/<файл>`. После новой миграции сначала один раз прогнать `pnpm test:integration`.
- Интеграционные тесты обработчиков воркера живут в `apps/api/test/` и импортируют `../../worker/src/...`.
- `pnpm db:generate` может падать с EPERM, пока у владельца запущены dev-процессы (Windows держит движок Prisma). Процессы не трогать — сообщить владельцу.
- `openapi.json` обновлять: `node scripts/openapi/generate.mjs`, затем `pnpm exec prettier --write openapi.json`, затем `node scripts/openapi/check.mjs openapi.json` (должен завершиться без `lint:`).
- Сообщения коммитов — Conventional Commits, описание на русском, например `feat(telegram): привязка чата и webhook`.

## Уточнения к дизайну, найденные при подготовке плана

1. PR 95 (email-уведомления) влит в `main`; ветка начинается от `main`.
2. Тип задачи `BUILD_EMAIL_DIGESTS` не переименовывается: обработчик `BuildEmailDigestsHandler` строит дайджесты всех каналов, переданных ему в конструкторе.
3. Поиск прошлого дайджеста в `build-digests.handler.ts` сейчас не фильтрует канал, а `DeliveryRepository.claim` выбирает только `EMAIL` — обе вещи меняются в задаче 5.
4. `OriginGuard` создаётся в `app.ts` через `new OriginGuard(config)` и не знает исключений. Задача 2 добавляет декоратор `@ExternalWebhook()` и второй необязательный параметр `Reflector`.
5. Страница почты `/app/settings/notifications` не меняется: страница Telegram копирует разметку полей, чтобы не трогать тесты почты.
6. Настройки Telegram живут в модуле `telegram`, отдельно от `NotificationSettingsApplicationService`, чтобы не трогать юнит-тесты почты.
7. Для E2E и тестов API добавлена необязательная переменная `TELEGRAM_API_BASE_URL` (по умолчанию `https://api.telegram.org`): в CI она указывает на закрытый порт, и ответы бота быстро падают, не мешая привязке.
8. Воркер регистрирует задачи доставки и дайджеста, если настроен хотя бы один канал (SMTP или бот). Сейчас без SMTP задачи не регистрируются вовсе.
9. Удаление аккаунта (`apps/worker/src/account-purge.ts`) должно знать новые таблицы: `account-purge.coverage.test.ts` падает на неклассифицированной модели.

## Задачи

| № | Файл | Что делает | Review |
|---|---|---|---|
| 1 | [task-01-schema.md](task-01-schema.md) | Схема, миграция, удаление аккаунта, очистка тестов | backend, security, QA, final |
| 2 | [task-02-api-foundation.md](task-02-api-foundation.md) | Конфиг API, `@ExternalWebhook()`, клиент Bot API, разбор обновлений | security, API, QA, final |
| 3 | [task-03-api-linking.md](task-03-api-linking.md) | Привязка, отвязка, webhook, контроллеры, интеграционные тесты | security, API, backend, QA, final |
| 4 | [task-04-api-settings.md](task-04-api-settings.md) | `GET`/`PUT` настроек Telegram, OpenAPI | security, API, QA, final |
| 5 | [task-05-worker-channels.md](task-05-worker-channels.md) | Очередь по каналам, `ChannelSender`, `EmailSender` (без Telegram) | backend, security, QA, final |
| 6 | [task-06-worker-telegram.md](task-06-worker-telegram.md) | Конфиг воркера, клиент Bot API, шаблоны, `TelegramSender`, wiring | backend, security, QA, final |
| 7 | [task-07-web.md](task-07-web.md) | Страница `/app/settings/telegram`, composable, ссылка в настройках | UI/UX, QA, final |
| 8 | [task-08-infra-e2e-docs.md](task-08-infra-e2e-docs.md) | Env, compose, скрипт webhook, deploy, runbook, E2E, документация | release, security, QA, final |

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

Ожидается: всё зелёное, `check.mjs` без `lint:` и `breaking change:`, `git diff --no-index` по OpenAPI пустой или только в форматировании (иначе пересобрать `openapi.json`) (у `lint` допустимы warnings, 0 errors; у `format:check` допустим известный красный `manifest.webmanifest`, если он был красным и на `main`), в `git status` пусто (кроме `identity/logo_description.png`, если он есть). E2E выполняется только в CI. Затем остановиться и сообщить владельцу: список коммитов (`git log --oneline origin/main..HEAD`), результаты проверок, отступления. Push и PR — решение владельца.

## Ход выполнения

| Задача | Коммит | Проверки | Отступления и решения |
|---|---|---|---|
