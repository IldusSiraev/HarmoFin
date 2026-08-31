# HarmoFin

HarmoFin — веб-приложение для личного и семейного бюджета. Оно связывает фактическое движение денег по счетам с назначением денег в конвертах и поддерживает настраиваемые финансовые циклы.

## Текущий статус

Foundation Этапа 0 реализован: monorepo, web, API, worker, локальная PostgreSQL и базовые проверки готовы. Продуктовые функции MVP — аутентификация, бюджеты, счета, конверты, операции и расчёты — ещё не реализованы.

## Стек foundation

- **Runtime:** Node.js 24.20.0, pnpm 11.24.0;
- **Web:** Nuxt 4.5.2, Vue 3.5.42, TypeScript strict;
- **API:** NestJS 11.2.3, Fastify 5.11.3, REST/OpenAPI;
- **Worker:** отдельный TypeScript-процесс с безопасным lifecycle;
- **Local infrastructure:** PostgreSQL 18 через Docker Compose;
- **Quality:** ESLint, Prettier, Vitest, GitHub Actions.

Полный стек и продуктовые границы описаны в [спецификации разработки](docs/superpowers/specs/2026-08-30-family-budget-development-spec.md).

## Требования

- Node.js `24.20.0`;
- Corepack и pnpm `11.24.0`;
- Docker Desktop с Docker Compose.

Проверить версии:

```bash
node --version
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm --version
docker compose version
```

## Локальный запуск

Установить зависимости:

```bash
pnpm install --frozen-lockfile
```

Создать локальный env-файл.

Windows:

```bash
copy .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Запустить PostgreSQL:

```bash
pnpm infra:up
```

Запустить web, API и worker в отдельных workspace-процессах:

```bash
pnpm dev
```

Остановить PostgreSQL:

```bash
pnpm infra:down
```

`pnpm infra:down` не удаляет named volume с локальными данными.

## Локальные адреса

- Web: http://localhost:3000/
- API live: http://localhost:3001/api/v1/health/live
- API ready: http://localhost:3001/api/v1/health/ready
- OpenAPI UI: http://localhost:3001/docs
- OpenAPI JSON: http://localhost:3001/openapi.json

`live` проверяет работоспособность API-процесса. `ready` дополнительно выполняет безопасный probe PostgreSQL.

## Проверки

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Интеграционные тесты требуют доступной локальной PostgreSQL:

```bash
pnpm infra:up
pnpm test:integration
```

## Границы foundation

В текущем этапе намеренно отсутствуют:

- Prisma schema, migrations и seed;
- пользователи, сессии, бюджеты, аутентификация и авторизация;
- финансовые сущности, балансы и бизнес-расчёты;
- PrimeVue, Tailwind CSS, Pinia, TanStack Query, vee-validate и ECharts;
- frontend OpenAPI client;
- production images, staging, production deploy, object storage и observability backends;
- E2E-сценарии продукта.

Foundation не содержит фиктивных финансовых данных и не имитирует готовый MVP.

## План реализации

1. Foundation — текущий этап;
2. база данных и аутентификация;
3. справочники и счета;
4. операции и распределения;
5. переводы;
6. планы и уведомления;
7. аналитика и экспорт;
8. production readiness.

## Документация

- [Функциональное ТЗ](docs/superpowers/specs/2026-08-30-family-budget-app-spec.md);
- [Спецификация разработки](docs/superpowers/specs/2026-08-30-family-budget-development-spec.md);
- [Дизайн инициализации репозитория](docs/superpowers/specs/2026-08-30-project-initialization-design.md);
- [Дизайн foundation](docs/superpowers/specs/2026-08-31-project-foundation-design.md);
- [Implementation plan foundation](docs/superpowers/plans/2026-08-31-project-foundation.md);
- [ADR](docs/adr/);
- [Начальные категории](categories.txt).

## Безопасность

- Не коммитить реальные `.env`, secrets, credentials и production-конфигурацию.
- Не хранить auth-секреты в клиентском bundle или `localStorage`.
- Финансовые расчёты должны выполняться на сервере; floating-point значения не могут быть источником истины для денег.
- Каждый запрос к пользовательским данным должен проверять workspace и budget isolation на сервере.
- Пароли, cookies, session secrets и полные финансовые payload не должны попадать в логи.

## Лицензия

Права на использование не предоставлены, пока в репозитории отсутствует файл `LICENSE`.
