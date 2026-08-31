# Основание проекта HarmoFin — план реализации

> **Для агентских исполнителей:** ОБЯЗАТЕЛЬНОЕ ПОДЗАДАНИЕ: использовать `superpowers:subagent-driven-development` (рекомендуется) или `superpowers:executing-plans` для реализации этого плана по задачам. Шаги используют чекбоксы (`- [ ]`) для отслеживания.

**Цель:** Создать запускаемый foundation monorepo HarmoFin с Nuxt web, NestJS/Fastify API, независимым worker, локальным PostgreSQL 18, едиными проверками и базовым GitHub Actions CI — без бизнес-функций.

**Архитектура:** pnpm workspace объединяет три независимых приложения и два пакета конфигурации. Web обслуживает только русскоязычную техническую стартовую страницу; API использует NestJS/Fastify, `/api/v1` и OpenAPI, а readiness выполняет безопасный PostgreSQL probe; worker пока проверяет конфигурацию и lifecycle, но не обрабатывает jobs. PostgreSQL запускается отдельно через Docker Compose, а приложения — локальным Node.js runtime.

**Технологический стек:** Node.js 24.20.0, pnpm 11.24.0, Nuxt 4.5.2, Vue 3.5.42, TypeScript 5.9.3, NestJS 11.2.3, Fastify 5.12.1, `pg` 8.23.0, Zod 4.5.4, Pino 10.3.1, ESLint 10.9.1, Prettier 3.9.6, Vitest 4.1.11, Docker Compose и GitHub Actions.

**Спецификация:** [docs/superpowers/specs/2026-08-31-project-foundation-design.md](../specs/2026-08-31-project-foundation-design.md)

## Глобальные ограничения

- Рабочее название проекта: `HarmoFin`.
- Основная ветка: `main`.
- Поведение продукта определяется [функциональным ТЗ](../specs/2026-08-30-family-budget-app-spec.md).
- Техническая реализация определяется [спецификацией разработки](../specs/2026-08-30-family-budget-development-spec.md).
- Этап 0 не добавляет Prisma, migrations, seed, пользователей, сессии, бюджеты, финансовые сущности, расчеты или бизнес-логику.
- Этап 0 не добавляет PrimeVue, Tailwind CSS, Pinia, TanStack Query, vee-validate, ECharts, OpenAPI client, object storage, production images или production deployment.
- Использовать pnpm workspaces и штатные pnpm scripts; Turborepo и Nx не добавлять.
- Использовать Node.js 24 LTS; версия должна быть зафиксирована в `.nvmrc`, `engines` и CI.
- TypeScript работает в strict mode; денежные значения в будущем будут храниться в integer minor units, но финансового кода на этом этапе нет.
- API использует REST/OpenAPI с базовым префиксом `/api/v1`.
- PostgreSQL 18 — единственная обязательная local service; web, API и worker запускаются локальным runtime.
- Никакие секреты, реальные персональные данные, полные финансовые payload и пользовательские комментарии не должны попадать в Git или логи.
- Пользовательский текст и документация пишутся на русском; идентификаторы кода, API и схемы — на английском.
- `.env.example` разрешён в Git; реальные `.env` и производные секретные файлы запрещены.
- Не добавлять команды в README до создания и проверки соответствующей реализации.
- Не изменять и не добавлять в Git пользовательский файл `identity/logo_description.png`; он уже существует вне согласованного scope и должен остаться нетронутым.
- Все текстовые файлы используют UTF-8, LF и завершающую новую строку.

---

## Карта файлов

Эта карта фиксирует границы до начала реализации.

### Корень

- `package.json` — приватный workspace root, версии runtime и агрегирующие команды.
- `pnpm-workspace.yaml` — области workspace: `apps/*` и `packages/*`.
- `pnpm-lock.yaml` — воспроизводимые зависимости.
- `.nvmrc` — Node.js `24.20.0`.
- `.npmrc` — pnpm/Corepack и строгая проверка engines.
- `.env.example` — только безопасные локальные значения.
- `.prettierignore` — generated/runtime paths, не форматируемые Prettier.
- `prettier.config.mjs` — единое форматирование.

### Общая конфигурация

- `packages/tsconfig/package.json` — экспорт общих TypeScript-конфигураций.
- `packages/tsconfig/base.json` — строгие общие compiler options.
- `packages/tsconfig/node.json` — Node.js-приложения.
- `packages/tsconfig/nuxt.json` — Nuxt-расширение.
- `packages/eslint-config/package.json` — экспорт общих ESLint-конфигураций.
- `packages/eslint-config/base.mjs` — TypeScript/Node flat config.
- `packages/eslint-config/vue.mjs` — Vue flat config поверх base.

### API

- `apps/api/package.json` — зависимости и scripts API.
- `apps/api/tsconfig.json` — typecheck-конфигурация API.
- `apps/api/tsconfig.build.json` — emit-конфигурация API.
- `apps/api/eslint.config.mjs` — Node ESLint config.
- `apps/api/src/main.ts` — production bootstrap.
- `apps/api/src/app.ts` — создание Nest application для runtime и тестов.
- `apps/api/src/app.module.ts` — композиция модулей.
- `apps/api/src/config/env.ts` — Zod-схема и типизированная конфигурация.
- `apps/api/src/database/database-health.service.ts` — PostgreSQL pool и `SELECT 1` probe.
- `apps/api/src/database/database.module.ts` — экспорт database health service.
- `apps/api/src/health/health.dto.ts` — OpenAPI response DTO.
- `apps/api/src/health/health.controller.ts` — `/health/live` и `/health/ready`.
- `apps/api/src/health/health.module.ts` — health module.
- `apps/api/src/common/errors/problem-details.dto.ts` — безопасная error schema.
- `apps/api/src/common/errors/problem-details.filter.ts` — HTTP error translation.
- `apps/api/src/common/logging/logger.ts` — безопасный Pino logger.
- `apps/api/src/config/env.test.ts` — unit-тесты env validation.
- `apps/api/src/health/health.service.test.ts` — unit-тесты health behavior.
- `apps/api/test/health.integration.test.ts` — integration-тесты через реальный PostgreSQL.
- `apps/api/vitest.config.ts` — unit test config.
- `apps/api/vitest.integration.config.ts` — integration test config.

### Worker

- `apps/worker/package.json` — worker dependencies и scripts.
- `apps/worker/tsconfig.json` — строгий typecheck.
- `apps/worker/tsconfig.build.json` — emit-конфигурация.
- `apps/worker/eslint.config.mjs` — Node ESLint config.
- `apps/worker/src/config.ts` — Zod-конфигурация worker.
- `apps/worker/src/runtime.ts` — `WorkerRuntime` и lifecycle.
- `apps/worker/src/logger.ts` — безопасный Pino logger.
- `apps/worker/src/main.ts` — process entrypoint и signal handlers.
- `apps/worker/src/runtime.test.ts` — lifecycle unit-тесты.
- `apps/worker/vitest.config.ts` — Vitest config.

### Web

- `apps/web/package.json` — Nuxt dependencies и scripts.
- `apps/web/nuxt.config.ts` — Nuxt runtime configuration.
- `apps/web/tsconfig.json` — Nuxt-generated config extension.
- `apps/web/eslint.config.mjs` — Vue ESLint config.
- `apps/web/app/app.vue` — корневой Nuxt component.
- `apps/web/app/pages/index.vue` — `/` composition.
- `apps/web/app/components/WelcomePanel.vue` — техническая стартовая страница.
- `apps/web/app/components/WelcomePanel.test.ts` — component smoke-test.
- `apps/web/vitest.config.ts` — happy-dom/Vue test config.

### Инфраструктура и CI

- `infra/compose/local.yml` — только PostgreSQL 18 для local.
- `.github/workflows/ci.yml` — проверка качества, integration и build.
- `docs/adr/0001-monorepo-runtime-boundaries.md` — границы процессов.
- `docs/adr/0002-pnpm-workspaces.md` — pnpm без task runner.
- `docs/adr/0003-postgresql-local-source-of-truth.md` — local PostgreSQL и источник истины.
- `docs/adr/0004-rest-openapi-contract.md` — API contract.
- `docs/adr/0005-money-representation.md` — будущая модель денежных значений.
- `README.md` — проверенные команды и фактический статус foundation.

---

### Задача 1: Создать workspace metadata и manifests

**Файлы:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.nvmrc`
- Create: `.npmrc`
- Create: `.env.example`
- Create: `.prettierignore`
- Create: `prettier.config.mjs`
- Create: `apps/api/package.json`
- Create: `apps/web/package.json`
- Create: `apps/worker/package.json`
- Create: `packages/eslint-config/package.json`
- Create: `packages/tsconfig/package.json`

**Интерфейсы:**
- Produces workspace names `@harmofin/api`, `@harmofin/web`, `@harmofin/worker`, `@harmofin/eslint-config`, `@harmofin/tsconfig`.
- Produces root commands `dev`, `build`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:integration`, `infra:up`, `infra:down`.
- Later tasks consume exact package scripts; no application source is required for this task.

- [ ] **Шаг 1: Зафиксировать runtime и workspace.**

Создать `.nvmrc` с единственной строкой `24.20.0`; `.npmrc` — с `engine-strict=true`, `shared-workspace-lockfile=true` и `auto-install-peers=false`; `pnpm-workspace.yaml` — с:

```yaml
packages:
  - apps/*
  - packages/*
```

Корневой `package.json` сделать приватным и задать:

```json
{
  "name": "harmofin",
  "private": true,
  "packageManager": "pnpm@11.24.0",
  "engines": {
    "node": ">=24.20.0 <25"
  },
  "scripts": {
    "dev": "pnpm --parallel --filter @harmofin/web --filter @harmofin/api --filter @harmofin/worker dev",
    "build": "pnpm --recursive --if-present build",
    "lint": "pnpm --recursive --if-present lint",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "pnpm --recursive --if-present typecheck",
    "test": "pnpm --recursive --if-present test",
    "test:integration": "pnpm --filter @harmofin/api test:integration",
    "infra:up": "docker compose -f infra/compose/local.yml up -d",
    "infra:down": "docker compose -f infra/compose/local.yml down"
  },
  "devDependencies": {
    "prettier": "3.9.6",
    "vitest": "4.1.11"
  }
}
```

Не добавлять `concurrently`, Turborepo или Nx: pnpm `--parallel` — согласованный механизм запуска.

- [ ] **Шаг 2: Создать безопасный env template и форматирование.**

`.env.example` должен содержать безопасную local-конфигурацию без production credentials:

```dotenv
NODE_ENV=development
WEB_PORT=3000
API_PORT=3001
WEB_ORIGIN=http://localhost:3000
API_URL=http://localhost:3001
DATABASE_URL=postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin
POSTGRES_PORT=5432
POSTGRES_DB=harmofin
POSTGRES_USER=harmofin_local
POSTGRES_PASSWORD=harmofin_local
```

`.prettierignore` должен исключать `node_modules`, `.nuxt`, `.output`, `dist`, `coverage`, `pnpm-lock.yaml`, `.superpowers` и `.claude`. `prettier.config.mjs` должен экспортировать единые `semi: true`, `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`.

- [ ] **Шаг 3: Создать manifests приложений и пакетов.**

В manifests задать workspace names и scripts:

```json
{
  "scripts": {
    "dev": "...",
    "build": "...",
    "lint": "eslint .",
    "typecheck": "...",
    "test": "vitest run"
  }
}
```

Подставить конкретные scripts:

- web: `dev: "nuxt dev --host 0.0.0.0"`, `build: "nuxt build"`, `typecheck: "nuxt typecheck"`;
- API: `dev: "tsx watch src/main.ts"`, `build: "tsc -p tsconfig.build.json"`, `typecheck: "tsc --noEmit -p tsconfig.json"`, `test:integration: "vitest run --config vitest.integration.config.ts"`;
- worker: `dev: "tsx watch src/main.ts"`, `build: "tsc -p tsconfig.build.json"`, `typecheck: "tsc --noEmit -p tsconfig.json"`;
- packages: только config exports, без runtime app scripts.

Указать версии, перечисленные в заголовке плана, точными значениями, не диапазонами. Использовать `workspace:*` для внутренних пакетов.

- [ ] **Шаг 4: Установить зависимости и получить lock-файл.**

Запустить под Node.js 24.20.0:

```bash
corepack enable
pnpm install
```

Проверить, что создан только корневой `pnpm-lock.yaml`, а workspace packages обнаружены командой:

```bash
pnpm list --depth -1 --recursive
```

- [ ] **Шаг 5: Запустить форматирование и зафиксировать задачу.**

Запустить:

```bash
pnpm format
pnpm format:check
```

Ожидаемый результат: `format:check` успешен; source-файлов приложений пока нет, поэтому lint/typecheck/test/build выполнятся после следующих задач.

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .nvmrc .npmrc .env.example .prettierignore prettier.config.mjs apps/*/package.json packages/*/package.json
git diff --cached --check
git commit -m "chore: add pnpm workspace foundation"
```

---

### Задача 2: Добавить общие TypeScript и ESLint конфигурации

**Файлы:**
- Create: `packages/tsconfig/package.json`
- Create: `packages/tsconfig/base.json`
- Create: `packages/tsconfig/node.json`
- Create: `packages/tsconfig/nuxt.json`
- Create: `packages/eslint-config/package.json`
- Create: `packages/eslint-config/base.mjs`
- Create: `packages/eslint-config/vue.mjs`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/eslint.config.mjs`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/tsconfig.build.json`
- Create: `apps/worker/eslint.config.mjs`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/eslint.config.mjs`

**Интерфейсы:**
- Produces `@harmofin/tsconfig/node.json` and `@harmofin/tsconfig/nuxt.json`.
- Produces `@harmofin/eslint-config/base.mjs` and `@harmofin/eslint-config/vue.mjs`.
- API and worker consume Node config; web consumes Nuxt/Vue config.

- [ ] **Шаг 1: Написать конфигурационные smoke-проверки.**

До реализации конфигураций добавить временные проверяемые условия в командный сценарий: каждый app config должен импортироваться Node.js без исключения, а TypeScript должен видеть strict option. Проверка будет выполняться после создания файлов командами:

```bash
node -e "import('./packages/eslint-config/base.mjs').then(() => import('./packages/eslint-config/vue.mjs'))"
pnpm --filter @harmofin/api exec tsc --showConfig -p tsconfig.json
pnpm --filter @harmofin/web exec nuxt prepare
```

- [ ] **Шаг 2: Создать строгие TypeScript presets.**

`base.json` должен включать `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `forceConsistentCasingInFileNames`, `skipLibCheck`, `target: ES2023`, `noEmit: true`. `node.json` должен расширять base и задавать `module: NodeNext`, `moduleResolution: NodeNext`, `lib: ["ES2023"]`, `types: ["node"]`.

`nuxt.json` должен расширять `.nuxt/tsconfig.json`, включать strict options и не переопределять Nuxt aliases/generated paths. API `tsconfig.build.json` и worker `tsconfig.build.json` должны расширять dev config, переключать `noEmit: false`, задавать `outDir: "dist"`, `rootDir: "src"` и не включать test files.

- [ ] **Шаг 3: Создать flat ESLint configs.**

`base.mjs` должен экспортировать flat config с `@eslint/js`, `typescript-eslint`, Node globals и `eslint-config-prettier`. `vue.mjs` должен расширять base конфигурацией `eslint-plugin-vue` flat recommended для `*.vue` и `*.ts` web files. Отключить правила форматирования, дублируемые Prettier; запретить `any` там, где TypeScript может вывести тип.

Каждый app config должен быть минимальным:

```js
import { baseConfig } from '@harmofin/eslint-config/base';

export default baseConfig;
```

Для web импортировать `vueConfig` из `@harmofin/eslint-config/vue`. Не добавлять server-only aliases или runtime imports в shared package.

- [ ] **Шаг 4: Проверить configs и зафиксировать задачу.**

Запустить:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Ожидаемый результат: конфигурации загружаются; возможные ошибки только от отсутствующих source entrypoints должны быть устранены добавлением минимальных временных entrypoints в следующей задаче, а не ослаблением strict/lint правил.

```bash
git add packages/tsconfig packages/eslint-config apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/eslint.config.mjs apps/worker/tsconfig.json apps/worker/tsconfig.build.json apps/worker/eslint.config.mjs apps/web/tsconfig.json apps/web/eslint.config.mjs
git diff --cached --check
git commit -m "chore: add shared quality configuration"
```

---

### Задача 3: Реализовать API foundation, health endpoints и OpenAPI

**Файлы:**
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/database/database-health.service.ts`
- Create: `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/health/health.dto.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.module.ts`
- Create: `apps/api/src/common/errors/problem-details.dto.ts`
- Create: `apps/api/src/common/errors/problem-details.filter.ts`
- Create: `apps/api/src/common/logging/logger.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/config/env.test.ts`
- Create: `apps/api/src/health/health.service.test.ts`
- Create: `apps/api/test/health.integration.test.ts`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/vitest.integration.config.ts`

**Интерфейсы:**
- `loadApiConfig(input: NodeJS.ProcessEnv): ApiConfig` возвращает проверенную конфигурацию или бросает ошибку с перечислением полей.
- `DatabaseHealthService.check(): Promise<void>` выполняет только `SELECT 1`; `close(): Promise<void>` закрывает pool.
- `createApiApp(config: ApiConfig): Promise<INestApplication>` создаёт тестируемое Nest/Fastify приложение.
- HTTP endpoints: `GET /api/v1/health/live` и `GET /api/v1/health/ready`.
- OpenAPI routes: `/docs` UI и `/openapi.json` JSON.
- Ошибки readiness имеют `503`, `application/problem+json`, machine code `DATABASE_UNAVAILABLE` и request ID; детали подключения наружу не выдаются.

- [ ] **Шаг 1: Написать failing unit tests для env и health service.**

Добавить тесты до implementation:

```ts
it('rejects missing DATABASE_URL', () => {
  expect(() => loadApiConfig({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
});

it('accepts valid local configuration', () => {
  expect(
    loadApiConfig({
      NODE_ENV: 'test',
      API_PORT: '3001',
      DATABASE_URL: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
      WEB_ORIGIN: 'http://localhost:3000',
    }),
  ).toMatchObject({ apiPort: 3001, webOrigin: 'http://localhost:3000' });
});

it('runs a SELECT 1 probe', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  const service = new DatabaseHealthService({ query, end: vi.fn() } as never);
  await expect(service.check()).resolves.toBeUndefined();
  expect(query).toHaveBeenCalledWith('SELECT 1');
});
```

Тест на readiness отдельно проверит успешный и rejected probe через mock database service. Не добавлять финансовые данные или фиктивные балансы.

- [ ] **Шаг 2: Реализовать типизированную Zod-конфигурацию.**

Схема должна валидировать `NODE_ENV`, `API_PORT` в диапазоне 1–65535, `DATABASE_URL` как непустую строку с `postgres://` или `postgresql://`, `WEB_ORIGIN` как HTTP(S) URL. Вернуть camelCase тип:

```ts
export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  apiPort: number;
  databaseUrl: string;
  webOrigin: string;
}
```

Значения по умолчанию разрешены только для безопасных local/test полей (`NODE_ENV=development`, `API_PORT=3001`, `WEB_ORIGIN=http://localhost:3000`); `DATABASE_URL` обязателен.

- [ ] **Шаг 3: Реализовать database health service.**

Создать `pg.Pool` с `connectionString`, не выполнять запрос при module construction. `check()` должен использовать `pool.query('SELECT 1')`; `close()` — `pool.end()`. Не логировать connection string и не возвращать ошибки PostgreSQL напрямую.

- [ ] **Шаг 4: Реализовать DTO, controller и безопасный error filter.**

DTO должны описывать через Swagger:

```ts
class LiveHealthResponse {
  status: 'ok';
}

class ReadyHealthResponse {
  status: 'ok';
  dependencies: { database: 'ok' };
}
```

`HealthController` должен иметь `@Controller('health')`, `@Get('live')`, `@Get('ready')`, `@ApiOkResponse` и `@ApiResponse({ status: 503 })`. При rejected `check()` бросать `ServiceUnavailableException` с `{ code: 'DATABASE_UNAVAILABLE', detail: 'База данных временно недоступна.' }`.

`ProblemDetailsFilter` должен всегда отдавать поля `type`, `title`, `status`, `code`, `detail`, `requestId`; для неизвестной ошибки — generic `500` без stack trace. Request ID получать из Fastify request id, а при его отсутствии генерировать UUID. Ответ отправлять с content type `application/problem+json`.

- [ ] **Шаг 5: Реализовать Nest/Fastify bootstrap и OpenAPI.**

`createApiApp` должен:

1. создать `NestFactory` с `FastifyAdapter({ bodyLimit: 1_048_576 })`;
2. вызвать `setGlobalPrefix('api/v1')`;
3. включить CORS только для `config.webOrigin`;
4. включить `ProblemDetailsFilter`;
5. включить shutdown hooks;
6. создать Swagger document с title `HarmoFin API`, version `1.0`, описать health endpoints;
7. зарегистрировать JSON на `/openapi.json` и UI на `/docs`;
8. экспортировать application для integration test.

`main.ts` должен загрузить env, создать app, вызвать `listen(config.apiPort, '0.0.0.0')`; startup log не должен содержать `DATABASE_URL`.

- [ ] **Шаг 6: Написать integration tests через Fastify inject.**

`apps/api/test/health.integration.test.ts` должен запускать app с `DATABASE_URL` из окружения и проверять:

```ts
const live = await server.inject({ method: 'GET', url: '/api/v1/health/live' });
expect(live.statusCode).toBe(200);
expect(live.json()).toEqual({ status: 'ok' });

const ready = await server.inject({ method: 'GET', url: '/api/v1/health/ready' });
expect(ready.statusCode).toBe(200);
expect(ready.json()).toEqual({ status: 'ok', dependencies: { database: 'ok' } });

const openapi = await server.inject({ method: 'GET', url: '/openapi.json' });
expect(openapi.statusCode).toBe(200);
expect(openapi.json().paths['/api/v1/health/live']).toBeDefined();
```

Добавить отдельный app instance с доступным HTTP-портом без PostgreSQL и проверить `503`, `content-type` `application/problem+json`, `code: 'DATABASE_UNAVAILABLE'`, непустой `requestId`, отсутствие `DATABASE_URL` и SQL в body. Закрывать каждый app в `afterAll`.

- [ ] **Шаг 7: Запустить API проверки и зафиксировать задачу.**

С поднятым PostgreSQL выполнить:

```bash
pnpm --filter @harmofin/api test
pnpm --filter @harmofin/api test:integration
pnpm --filter @harmofin/api lint
pnpm --filter @harmofin/api typecheck
pnpm --filter @harmofin/api build
```

Ожидаемый результат: unit и integration PASS; `/live` и `/ready` имеют согласованные коды; API не содержит Prisma или доменных модулей.

```bash
git add apps/api
git diff --cached --check
git commit -m "feat: add api health foundation"
```

---

### Задача 4: Реализовать worker lifecycle

**Файлы:**
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/runtime.ts`
- Create: `apps/worker/src/logger.ts`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/src/runtime.test.ts`
- Modify: `apps/worker/package.json` только если scripts не завершены в Задаче 1.

**Интерфейсы:**
- `loadWorkerConfig(input: NodeJS.ProcessEnv): WorkerConfig` проверяет env.
- `WorkerRuntime.start(): void` пишет startup event и переводит runtime в active state.
- `WorkerRuntime.stop(signal: NodeJS.Signals): Promise<void>` идемпотентно пишет shutdown event и освобождает ресурсы.
- `main.ts` обрабатывает `SIGINT` и `SIGTERM`, не запускает cron и не обрабатывает jobs.

- [ ] **Шаг 1: Написать failing lifecycle tests.**

Проверить startup, единичный shutdown и повторный shutdown:

```ts
it('starts and stops without jobs', async () => {
  const logger = createFakeLogger();
  const runtime = new WorkerRuntime(logger);

  runtime.start();
  expect(runtime.state).toBe('running');
  await runtime.stop('SIGTERM');

  expect(runtime.state).toBe('stopped');
  expect(logger.events).toEqual([
    { event: 'worker_started', service: 'worker' },
    { event: 'worker_stopped', service: 'worker', signal: 'SIGTERM' },
  ]);
});

it('does not emit duplicate shutdown', async () => {
  const logger = createFakeLogger();
  const runtime = new WorkerRuntime(logger);
  runtime.start();
  await runtime.stop('SIGINT');
  await runtime.stop('SIGTERM');
  expect(logger.events.filter(({ event }) => event === 'worker_stopped')).toHaveLength(1);
});
```

- [ ] **Шаг 2: Реализовать config и logger.**

`WorkerConfig` должен содержать `nodeEnv` и `logLevel`; `NODE_ENV` и `LOG_LEVEL` валидировать через Zod с безопасными defaults. Logger на Pino пишет только `service`, `environment`, `event`, `signal`; не принимать arbitrary payload, содержащий secrets или финансовые данные.

- [ ] **Шаг 3: Реализовать runtime и signal handling.**

`WorkerRuntime` хранит state `'created' | 'running' | 'stopping' | 'stopped'`. `start()` разрешен один раз; `stop()` безопасен при повторном вызове. `main.ts` регистрирует `process.once('SIGINT', ...)` и `process.once('SIGTERM', ...)`, задаёт `process.exitCode = 0` после успешного stop. Не использовать `setInterval`, cron, Redis, очереди или искусственные jobs.

- [ ] **Шаг 4: Проверить worker и зафиксировать задачу.**

Запустить:

```bash
pnpm --filter @harmofin/worker test
pnpm --filter @harmofin/worker lint
pnpm --filter @harmofin/worker typecheck
pnpm --filter @harmofin/worker build
```

Затем запустить `pnpm --filter @harmofin/worker dev`, отправить `SIGTERM` доступным средством среды и убедиться, что процесс завершился с кодом 0 и не оставил runtime-файл.

```bash
git add apps/worker
git diff --cached --check
git commit -m "feat: add worker lifecycle"
```

---

### Задача 5: Создать Nuxt web foundation page

**Файлы:**
- Create: `apps/web/nuxt.config.ts`
- Create: `apps/web/app/app.vue`
- Create: `apps/web/app/pages/index.vue`
- Create: `apps/web/app/components/WelcomePanel.vue`
- Create: `apps/web/app/components/WelcomePanel.test.ts`
- Create: `apps/web/vitest.config.ts`

**Интерфейсы:**
- Web dev server слушает `WEB_PORT` и bind `0.0.0.0`.
- `/` отображает `HarmoFin`, русскоязычный статус основания и отсутствие продуктовых функций.
- `WelcomePanel` не содержит финансовых значений, fake balances, fake users или fake API responses.

- [ ] **Шаг 1: Написать failing component smoke-test.**

Тест на Vue Test Utils с `happy-dom`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import WelcomePanel from './WelcomePanel.vue';

describe('WelcomePanel', () => {
  it('shows the project foundation status in Russian', () => {
    const wrapper = mount(WelcomePanel);
    expect(wrapper.get('h1').text()).toBe('HarmoFin');
    expect(wrapper.get('h2').text()).toBe('Основание проекта готово');
    expect(wrapper.text()).toContain('Продуктовые функции ещё не реализованы');
  });
});
```

- [ ] **Шаг 2: Реализовать accessible WelcomePanel и page.**

`WelcomePanel.vue` должен использовать семантические `main`, `h1`, `p`, видимый focus не требуется для неинтерактивного экрана, контраст — через простые CSS variables. Текст:

```vue
<template>
  <main aria-labelledby="welcome-title">
    <h1 id="welcome-title">HarmoFin</h1>
    <h2>Основание проекта готово</h2>
    <p>Продуктовые функции ещё не реализованы.</p>
  </main>
</template>
```

`index.vue` отвечает только за route composition и вставляет `WelcomePanel`. `app.vue` содержит `<NuxtPage />`. Не добавлять финансовый dashboard или навигацию MVP раньше соответствующего этапа.

- [ ] **Шаг 3: Настроить Nuxt и Vitest.**

`nuxt.config.ts` должен задавать `devtools: { enabled: false }`, `typescript: { strict: true, typeCheck: true }`, runtime config для `public.apiUrl` из `API_URL`, без секретов. Vitest должен использовать `environment: 'happy-dom'`, setup без network и alias для Vue/Nuxt только если он нужен тесту.

- [ ] **Шаг 4: Проверить web и зафиксировать задачу.**

Запустить:

```bash
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web build
```

Запустить `pnpm --filter @harmofin/web dev`, открыть `http://localhost:3000/`, проверить русскоязычный экран и отсутствие финансовых данных в HTML.

```bash
git add apps/web
git diff --cached --check
git commit -m "feat: add web foundation page"
```

---

### Задача 6: Добавить local PostgreSQL 18 Compose

**Файлы:**
- Create: `infra/compose/local.yml`
- Modify: `.env.example` только если Compose использует дополнительную переменную.

**Интерфейсы:**
- `pnpm infra:up` поднимает service `postgres`.
- `pnpm infra:down` останавливает local stack.
- API integration tests используют `DATABASE_URL` из `.env`/CI.

- [ ] **Шаг 1: Написать Compose acceptance check.**

Проверять конфигурацию без запуска:

```bash
docker compose -f infra/compose/local.yml config --quiet
docker compose -f infra/compose/local.yml config --images
```

Ожидать image `postgres:18-alpine`, service `postgres`, healthcheck и named volume.

- [ ] **Шаг 2: Создать Compose service.**

`infra/compose/local.yml` должен содержать service:

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-harmofin}
      POSTGRES_USER: ${POSTGRES_USER:-harmofin_local}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-harmofin_local}
    ports:
      - '${POSTGRES_PORT:-5432}:5432'
    volumes:
      - harmofin-postgres-data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}']
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 5s

volumes:
  harmofin-postgres-data:
```

Не добавлять web, API, worker, Redis, Mailpit, observability или production settings. Development credentials должны совпадать только с безопасным `.env.example` и не использоваться для staging/production.

- [ ] **Шаг 3: Поднять базу и проверить readiness.**

Запустить:

```bash
pnpm infra:up
docker compose -f infra/compose/local.yml ps
pnpm --filter @harmofin/api test:integration
```

Ожидать healthy `postgres` и PASS integration tests. Затем выполнить `pnpm infra:down`; named volume не удалять автоматически командой проекта.

- [ ] **Шаг 4: Зафиксировать задачу.**

```bash
git add infra/compose/local.yml .env.example
git diff --cached --check
git commit -m "chore: add local postgres compose"
```

---

### Задача 7: Добавить GitHub Actions foundation CI

**Файлы:**
- Create: `.github/workflows/ci.yml`

**Интерфейсы:**
- Workflow запускается на `pull_request` и `push` в `main`.
- CI использует Node.js 24.20.0, pnpm 11.24.0 и PostgreSQL 18.
- CI выполняет те же root scripts, что документированы в README.
- Production secrets не используются.

- [ ] **Шаг 1: Создать workflow с PostgreSQL service.**

Использовать `actions/checkout@v4`, `actions/setup-node@v4` с `node-version-file: .nvmrc`, Corepack и `pnpm install --frozen-lockfile`. PostgreSQL service должен быть `postgres:18-alpine` с database/user/password `harmofin`, health options и env:

```yaml
env:
  NODE_ENV: test
  DATABASE_URL: postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin
  WEB_ORIGIN: http://localhost:3000
```

- [ ] **Шаг 2: Добавить эквивалентные quality steps.**

Workflow должен последовательно выполнять:

```yaml
- run: corepack enable
- run: corepack prepare pnpm@11.24.0 --activate
- run: pnpm install --frozen-lockfile
- run: pnpm format:check
- run: pnpm lint
- run: pnpm typecheck
- run: pnpm test
- run: pnpm test:integration
- run: pnpm build
- run: docker compose -f infra/compose/local.yml config --quiet
```

Не добавлять Docker image build, deploy, production credentials или E2E job: они явно находятся вне Этапа 0.

- [ ] **Шаг 3: Проверить YAML и локальную эквивалентность.**

Запустить:

```bash
docker compose -f infra/compose/local.yml config --quiet
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Проверить, что в workflow нет строк `DATABASE_URL` с production host, секретов GitHub или токенов.

- [ ] **Шаг 4: Зафиксировать задачу.**

```bash
git add .github/workflows/ci.yml
git diff --cached --check
git commit -m "ci: add foundation checks"
```

---

### Задача 8: Добавить ADR и обновить README

**Файлы:**
- Create: `docs/adr/0001-monorepo-runtime-boundaries.md`
- Create: `docs/adr/0002-pnpm-workspaces.md`
- Create: `docs/adr/0003-postgresql-local-source-of-truth.md`
- Create: `docs/adr/0004-rest-openapi-contract.md`
- Create: `docs/adr/0005-money-representation.md`
- Modify: `README.md`

**Интерфейсы:**
- README документирует только реально созданные commands, URLs и services.
- ADR фиксируют решения без копирования полного ТЗ.
- Ссылки README на approved specs и ADR указывают на существующие files.

- [ ] **Шаг 1: Написать пять ADR.**

Каждый ADR должен иметь одинаковые разделы `Статус`, `Контекст`, `Решение`, `Последствия`, `Условия пересмотра`.

Содержимое решений:

1. `0001`: monorepo — один продуктовый модульный монолит, web/API/worker — отдельные процессы, runtime-код между приложениями не импортируется.
2. `0002`: pnpm workspaces и штатные scripts; Turborepo/Nx отложены до измеримой потребности в task graph/cache.
3. `0003`: PostgreSQL — источник истины; local Compose поднимает только PostgreSQL 18; production managed PostgreSQL появится позже.
4. `0004`: REST `/api/v1` и OpenAPI JSON/UI; frontend client не генерируется до продуктовых endpoints.
5. `0005`: будущие деньги хранятся integer minor units/decimal-safe, JavaScript floating point не является source of truth; решение зафиксировано заранее, хотя financial code отсутствует.

- [ ] **Шаг 2: Обновить README до фактического foundation status.**

Сохранить русскоязычное описание HarmoFin и добавить точный статус: foundation реализован, product features не реализованы. README должен содержать prerequisites Node.js 24.20.0, Corepack/pnpm 11.24.0 и Docker Compose; инструкции:

```bash
corepack enable
pnpm install --frozen-lockfile
copy .env.example .env
pnpm infra:up
pnpm dev
```

Для Unix отдельно указать `cp .env.example .env`; не выдавать Windows command как универсальный. Описать URLs:

- web: `http://localhost:3000/`;
- API live: `http://localhost:3001/api/v1/health/live`;
- API ready: `http://localhost:3001/api/v1/health/ready`;
- OpenAPI UI: `http://localhost:3001/docs`;
- OpenAPI JSON: `http://localhost:3001/openapi.json`.

Описать verified commands `pnpm format`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm infra:up`, `pnpm infra:down`. Явно написать, что Prisma, auth, financial domain, production images/deploy и E2E ещё не входят в foundation.

- [ ] **Шаг 3: Проверить документацию и зафиксировать задачу.**

Проверить существование всех README links и отсутствие claims о несуществующих product features:

```bash
python - <<'PY'
from pathlib import Path
for path in [Path('README.md'), Path('docs/adr/0001-monorepo-runtime-boundaries.md'), Path('docs/adr/0002-pnpm-workspaces.md'), Path('docs/adr/0003-postgresql-local-source-of-truth.md'), Path('docs/adr/0004-rest-openapi-contract.md'), Path('docs/adr/0005-money-representation.md')]:
    assert path.exists(), path
print('documentation paths OK')
PY
pnpm format:check
```

Не удалять `identity/logo_description.png`; не добавлять его в staging.

```bash
git add README.md docs/adr
git diff --cached --check
git commit -m "docs: document project foundation"
```

---

### Задача 9: Выполнить полную проверку Этапа 0

**Файлы:**
- Modify: none unless verification exposes a defect in files from Tasks 1–8.
- Exclude: `identity/logo_description.png` — не трогать и не stage.

**Интерфейсы:**
- Produces evidence that acceptance criteria from the design document pass.
- Leaves only pre-existing user-owned untracked file, if it remains present; no new generated files are left in working tree.

- [ ] **Шаг 1: Проверить runtime and clean dependency install.**

Под Node.js 24.20.0 выполнить:

```bash
node --version
corepack enable
pnpm --version
pnpm install --frozen-lockfile
```

Ожидать Node `v24.20.0` (или совместимый patch 24.x, если `.nvmrc` обновлён осознанно), pnpm `11.24.0` и успешную frozen install.

- [ ] **Шаг 2: Проверить local infrastructure and process startup.**

```bash
pnpm infra:up
docker compose -f infra/compose/local.yml ps
pnpm dev
```

Проверить web, API и worker вручную; запросить live/ready/OpenAPI URLs. Остановить dev processes и затем:

```bash
pnpm infra:down
```

Не удалять named volume как часть обычной проверки.

- [ ] **Шаг 3: Выполнить весь quality gate.**

При доступной PostgreSQL последовательно выполнить:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Ожидаемый результат: все команды PASS; API integration проверяет `200` live, `200` ready с БД, `503` ready без БД и OpenAPI paths.

- [ ] **Шаг 4: Проверить scope, secrets and generated files.**

```bash
git diff --check
git status --short --untracked-files=all
git diff --stat HEAD~8..HEAD
```

Проверить вручную, что staged/tracked changes не содержат `.env`, passwords кроме явно безопасных local example values, tokens, `node_modules`, `.nuxt`, `.output`, `dist`, coverage, Prisma, production Dockerfiles или deployment secrets. `identity/logo_description.png` может остаться единственным заранее существовавшим untracked path и не должен попасть в commit.

- [ ] **Шаг 5: Проверить итоговый git state и не делать лишний commit.**

```bash
git branch --show-current
git log --oneline --decorate -10
git status --short --untracked-files=all
```

Ожидать branch `main`, последние task commits с Conventional Commit subjects и отсутствие новых незакоммиченных файлов. Если verification потребовал fix, добавить отдельный commit с корректным type; не squashing без отдельного решения.

---

## Самопроверка плана

- Покрытие спецификации: workspace/runtime (Tasks 1–2), web/API/worker (Tasks 3–5), PostgreSQL Compose (Task 6), CI (Task 7), ADR/README (Task 8), acceptance verification (Task 9).
- Границы foundation сохранены: нет Prisma, auth, domain, production images/deploy, E2E или UI feature stack.
- API interfaces согласованы между app, unit и integration tests: `loadApiConfig`, `DatabaseHealthService.check`, `createApiApp`, `/api/v1/health/live`, `/api/v1/health/ready`.
- Worker interfaces согласованы между runtime tests и entrypoint: `start`, `stop(signal)`, lifecycle states.
- Web test импортирует компонент, создаваемый в той же задаче.
- Root commands документируются только после создания и проверки.
- Тесты используют TDD order: failing test, minimal implementation, focused verification, commit.
- Placeholder scan выполнен: в плане нет `TBD`, неразрешённых `TODO`, «добавить подходящую обработку» или ссылок на несуществующие функции без сигнатур.
- Pre-existing `identity/logo_description.png` явно исключён из scope и staging.
