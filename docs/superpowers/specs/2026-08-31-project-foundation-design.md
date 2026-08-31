# Дизайн основания проекта HarmoFin

**Дата:** 31.08.2026  
**Статус:** согласовано к планированию  
**Область:** Этап 0 — запускаемый скелет monorepo без бизнес-функций

## 1. Цель

Создать минимальное, но реально запускаемое основание HarmoFin. Результат должен подтвердить совместимость выбранного стека, зафиксировать границы процессов и предоставить одинаковые проверки для локальной разработки и CI.

Этап не реализует пользовательские сценарии и финансовую модель. Его задача — убрать инфраструктурную неопределённость до начала разработки базы данных и аутентификации.

## 2. Принятый подход

Используется тонкий запускаемый foundation:

- monorepo на pnpm workspaces;
- web-приложение на Nuxt 4 и Vue 3;
- API на NestJS 11 с Fastify;
- отдельный TypeScript-процесс worker;
- PostgreSQL 18 для локальной инфраструктуры;
- единые правила форматирования, lint, typecheck, тестирования и сборки;
- базовый GitHub Actions pipeline.

Пустой monorepo без запускаемых приложений не выбран, поскольку он не проверяет интеграцию стека. Feature-ready scaffold не выбран, поскольку Prisma, аутентификация, финансовые модули и UI-библиотеки относятся к последующим этапам.

## 3. Границы этапа

### 3.1. Входит в этап

- запускаемая стартовая страница web на русском языке;
- API с health endpoints и OpenAPI-документацией;
- worker с проверкой конфигурации и корректным завершением;
- PostgreSQL 18 через Docker Compose;
- фиксация Node.js 24 LTS и pnpm;
- общие TypeScript- и ESLint-конфигурации;
- Prettier;
- unit- и integration-тесты основания;
- базовый CI;
- ADR и обновлённый README.

### 3.2. Не входит в этап

- Prisma schema, migrations и seed;
- пользователи, сессии, рабочие пространства и бюджеты;
- аутентификация и авторизация;
- финансовые сущности и расчёты;
- PrimeVue, Tailwind CSS, Pinia, TanStack Query, vee-validate и ECharts;
- генерация OpenAPI client;
- production Docker images;
- staging и production deployment;
- object storage и observability backends;
- E2E-сценарии продукта.

Эти исключения остаются частью утверждённой архитектуры, но добавляются только тогда, когда появляются реальные потребители.

## 4. Структура репозитория

```text
apps/
├── web/                       # Nuxt 4 + Vue 3
├── api/                       # NestJS 11 + Fastify
└── worker/                    # отдельный TypeScript-процесс
packages/
├── eslint-config/             # общий ESLint flat config
└── tsconfig/                  # общие TypeScript-конфигурации
infra/
└── compose/
    └── local.yml              # PostgreSQL 18 для local
.github/
└── workflows/
    └── ci.yml
docs/
└── adr/
```

В корне создаются:

- `package.json`;
- `pnpm-workspace.yaml`;
- `pnpm-lock.yaml`;
- `.nvmrc`;
- `.npmrc`;
- `.env.example`;
- конфигурация Prettier.

Имена workspace-пакетов:

- `@harmofin/web`;
- `@harmofin/api`;
- `@harmofin/worker`;
- `@harmofin/eslint-config`;
- `@harmofin/tsconfig`.

Приложения не импортируют runtime-код друг друга. Общие пакеты Этапа 0 содержат только конфигурацию и не становятся местом для серверной бизнес-логики.

## 5. Управление workspace

Package manager — pnpm, зафиксированный полем `packageManager` корневого `package.json` и единым lock-файлом. Версия Node.js фиксируется как Node.js 24 LTS в `.nvmrc` и `engines`.

Оркестрация выполняется штатными pnpm workspace scripts без Turborepo и Nx. Дополнительный task runner появится только при измеримой потребности в кеше или более сложном графе задач.

Корневые команды:

```text
pnpm dev
pnpm build
pnpm lint
pnpm format
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm infra:up
pnpm infra:down
```

Команды `db:migrate`, `db:seed` и `test:e2e` не объявляются до появления соответствующей реализации.

## 6. Runtime-компоненты

### 6.1. Web

Web использует Nuxt 4 и Vue 3. На Этапе 0 он содержит только русскоязычную техническую стартовую страницу HarmoFin, подтверждающую запуск приложения. Страница не содержит фиктивных финансовых данных и не имитирует готовые функции MVP.

Порт и публичный адрес задаются конфигурацией. Финансовые данные не встраиваются в публичный HTML.

### 6.2. API

API использует NestJS 11 и Fastify. Базовый API-префикс — `/api/v1`.

Минимальные endpoints:

```text
GET /api/v1/health/live
GET /api/v1/health/ready
```

`live` проверяет только работоспособность процесса и возвращает `200`, пока приложение способно обслуживать HTTP-запросы.

`ready` выполняет минимальный PostgreSQL probe `SELECT 1`. При доступной базе endpoint возвращает `200`; при недоступной обязательной зависимости — `503`. Проверка не раскрывает строку подключения, credentials или внутренние детали ошибки.

OpenAPI UI и JSON публикуются API. Health endpoints имеют request, response и error schemas. Генерация frontend client откладывается до появления продуктовых endpoint.

Ошибки API используют начальный формат Problem Details с машинным кодом и request ID. Внешний ответ не содержит stack trace, SQL, секреты и внутренние пути.

### 6.3. Worker

Worker — отдельный Node.js-процесс на TypeScript. На Этапе 0 он:

- валидирует обязательную конфигурацию при старте;
- пишет безопасные структурированные startup и shutdown logs;
- остаётся активным до сигнала завершения;
- корректно обрабатывает `SIGINT` и `SIGTERM`;
- не запускает in-memory cron и не обрабатывает фиктивные jobs.

PostgreSQL-backed jobs и связь worker с application services добавляются на Этапе 5.

## 7. Конфигурация

Каждый процесс получает конфигурацию только через типизированный слой с Zod-валидацией. Некорректная обязательная конфигурация завершает запуск понятной ошибкой.

Минимальная локальная конфигурация охватывает:

- `NODE_ENV`;
- web, API и worker ports, где применимо;
- `DATABASE_URL` для процесса, который проверяет PostgreSQL;
- разрешённый web origin для API;
- базовые URL web и API.

`.env.example` содержит только безопасные значения для локальной разработки. Реальный `.env` остаётся вне Git. Значения production не зашиваются в код, Dockerfile или клиентский bundle.

## 8. Локальная инфраструктура

`infra/compose/local.yml` поднимает только PostgreSQL 18. Web, API и worker запускаются локальным Node.js runtime через pnpm.

Compose-конфигурация содержит:

- именованный volume для локальных данных;
- healthcheck PostgreSQL;
- локальные development credentials без применения в других средах;
- фиксированную major-версию image;
- порт, допускающий переопределение через env.

Production topology и production images не входят в этот этап.

## 9. Качество и тестирование

### 9.1. Общие проверки

- TypeScript strict mode;
- ESLint flat config;
- Prettier;
- отсутствие циклических runtime-зависимостей между приложениями;
- воспроизводимая установка по lock-файлу.

Vitest используется как единый test runner основания, если интеграция конкретного framework не требует его штатной надстройки.

### 9.2. Web

- smoke-test стартового компонента;
- Nuxt typecheck;
- production build.

### 9.3. API

Unit-тесты проверяют:

- контракты health service;
- валидацию конфигурации;
- безопасное преобразование ошибок в Problem Details.

Integration-тесты используют реальный PostgreSQL и проверяют:

- `live` возвращает `200`;
- `ready` возвращает `200` при доступной базе;
- `ready` возвращает `503` при недоступной базе;
- OpenAPI содержит health endpoints и заявленные ответы.

### 9.4. Worker

Unit-тесты проверяют:

- валидацию конфигурации;
- startup/shutdown lifecycle;
- корректную реакцию на сигналы без утечки ресурсов.

Тесты не создаются ради формального покрытия и не утверждают наличие ещё не реализованной бизнес-логики.

## 10. CI

GitHub Actions workflow запускается для Pull Request и изменений основной ветки. Используются Node.js 24, Corepack/pnpm и PostgreSQL 18 service.

Pipeline выполняет:

1. установку по frozen lock-файлу;
2. проверку форматирования;
3. ESLint;
4. TypeScript typecheck;
5. unit-тесты;
6. integration-тесты с реальным PostgreSQL;
7. сборку web, API и worker;
8. валидацию Docker Compose-конфигурации.

Локальные команды и команды CI совпадают. Production secrets недоступны pipeline.

## 11. Архитектурные решения

Этап создаёт ADR по следующим решениям:

1. TypeScript monorepo и модульный монолит с отдельными процессами web, API и worker.
2. pnpm workspaces без Turborepo и Nx до появления измеримой потребности.
3. PostgreSQL как источник истины и единственная обязательная local service Этапа 0.
4. REST/OpenAPI как контракт между web и API.
5. Денежные значения в integer minor units и запрет floating-point source of truth, хотя финансовая модель появляется позже.

ADR фиксируют контекст, решение, последствия и условия пересмотра, не повторяя целиком функциональную и техническую спецификации.

## 12. Обработка ошибок и безопасность

- API использует request ID для HTTP-запросов.
- Логи структурированы и содержат service, environment, level и timestamp.
- Пароли, cookies, session secrets, строки подключения и финансовые payload не логируются.
- CORS разрешает только явно настроенный origin.
- API ограничивает размер запроса и проверяет content type там, где применимо.
- Health endpoints не раскрывают конфигурацию или детали подключения.
- Все процессы корректно завершаются при `SIGTERM`.

Полная защита cookie-based mutations, rate limiting, Argon2id и серверные сессии реализуются вместе с аутентификацией на Этапе 1, а не имитируются сейчас.

## 13. README

README обновляется после проверки реальных команд. Он должен содержать:

- prerequisites: Node.js 24 LTS, Corepack/pnpm и Docker Compose;
- установку зависимостей;
- настройку local env;
- запуск и остановку PostgreSQL;
- запуск web, API и worker;
- адреса web, API, OpenAPI и health endpoints;
- команды качества, тестирования и сборки;
- актуальный статус: основание готово, продуктовые функции ещё не реализованы;
- границы следующего этапа.

README не документирует команды или возможности, которые не были созданы и проверены.

## 14. Критерии приёмки

С чистого checkout на Node.js 24 LTS:

1. `corepack enable` и `pnpm install --frozen-lockfile` завершаются успешно.
2. `pnpm infra:up` поднимает здоровый PostgreSQL 18.
3. `pnpm dev` запускает web, API и worker.
4. Web открывает русскоязычную стартовую страницу HarmoFin.
5. API публикует OpenAPI UI и JSON.
6. `/api/v1/health/live` возвращает `200`.
7. `/api/v1/health/ready` возвращает `200` при доступной БД и `503` при недоступной БД.
8. `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` и `pnpm build` проходят.
9. GitHub Actions выполняет эквивалентные проверки.
10. README содержит только существующие и проверенные команды.
11. В репозитории отсутствуют секреты, Prisma schema, фиктивная доменная логика и production-инфраструктура.

## 15. Порядок реализации

1. Создать workspace metadata и общие конфигурации.
2. Добавить тесты основания.
3. Реализовать API и health/OpenAPI contracts.
4. Реализовать worker lifecycle.
5. Реализовать web-страницу.
6. Добавить PostgreSQL Compose.
7. Добавить GitHub Actions.
8. Записать ADR и обновить README.
9. Выполнить полный набор локальных проверок на Node.js 24.

Следующий этап после принятия основания — Этап 1: PostgreSQL schema, migrations, seed, users, sessions, workspaces, budgets, аутентификация, object isolation и базовый audit.
