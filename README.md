# HarmoFin

HarmoFin — веб-приложение для личного и семейного бюджета. Этап 1 добавляет PostgreSQL schema, аутентификацию и безопасные границы workspace/budget. Финансовые сущности пока не реализованы.

## Стек

- Node.js `24.20.0`, pnpm `11.24.0`;
- Nuxt 4/Vue 3, NestJS/Fastify, PostgreSQL 18 и Prisma;
- Argon2id, серверные сессии в PostgreSQL, HttpOnly cookies;
- Vitest, Playwright и GitHub Actions.

## Требования

- Node.js `24.20.0`;
- Corepack и pnpm `11.24.0`;
- Docker Desktop с Docker Compose.

```bash
node --version
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm --version
docker compose version
```

## Локальный запуск

Установить зависимости и создать локальную конфигурацию.

```bash
pnpm install --frozen-lockfile
```

Windows:

```bash
copy .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

`.env` содержит только local/test values. Не коммитить этот файл. Перед запуском заменить `AUTH_TOKEN_HASH_SECRET` на собственную случайную строку длиной не менее 32 символов.

Поднять PostgreSQL и Mailpit, сгенерировать Prisma client и применить миграцию.

```bash
pnpm infra:up
pnpm db:generate
pnpm db:migrate
```

Безопасный демонстрационный seed запускается только в `development` или `test`, требует `SEED_DEMO_PASSWORD` длиной минимум 10 символов и идемпотентен.

```bash
pnpm db:seed
```

Запустить web, API и worker:

```bash
pnpm dev
```

Остановить local services:

```bash
pnpm infra:down
```

`pnpm infra:down` не удаляет PostgreSQL volume.

## Локальные адреса

- Web: http://localhost:3000/
- Регистрация: http://localhost:3000/register
- Вход: http://localhost:3000/login
- Восстановление пароля: http://localhost:3000/forgot-password
- API live: http://localhost:3001/api/v1/health/live
- API ready: http://localhost:3001/api/v1/health/ready
- OpenAPI UI: http://localhost:3001/docs
- OpenAPI JSON: http://localhost:3001/openapi.json
- Mailpit: http://localhost:8025

## База данных

```bash
pnpm db:generate
pnpm db:migrate:dev
pnpm db:migrate
pnpm db:seed
```

`db:migrate:dev` предназначена только для local development. Не применять destructive rollback или reset к данным, которые нужно сохранить.

## Проверки

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Интеграционные и browser tests требуют работающие PostgreSQL и Mailpit:

```bash
pnpm infra:up
pnpm db:migrate
pnpm test:integration
pnpm test:e2e
```

## Этап 1: auth и изоляция данных

Реализованы:

- Prisma schema и первая migration для users, sessions, workspaces, workspace memberships, budgets, recovery tokens и audit events;
- регистрация, вход, выход, смена и восстановление пароля;
- Argon2id и пароль от 10 до 128 символов;
- opaque server-side sessions: cookie содержит случайный token, PostgreSQL — только HMAC digest;
- HttpOnly, `SameSite=Lax`, production `Secure` и `__Host-` cookie name;
- CSRF synchronizer token, Origin validation и rate limit входа/восстановления;
- просмотр и отзыв активных сессий;
- `/api/v1/me`, workspace и protected budget endpoints;
- server-side membership/role checks и DB-scoped workspace/budget queries;
- базовый audit auth/workspace/budget events;
- русскоязычные страницы `/register`, `/login`, `/forgot-password`, `/reset-password` и защищённая `/app`;
- Mailpit для local/CI recovery mail.

Роли `OWNER`, `EDITOR` и `VIEWER` существуют в schema и policy layer. Registration создаёт `OWNER`; приглашения и collaborative UI не входят в Этап 1.

## Границы этапа

Отсутствуют счета, категории, конверты, операции, распределения, переводы, планы, уведомления, аналитика, экспорт и production deployment. Email verification enforcement также требует отдельного решения до публичного запуска.

## Безопасность

- Не коммитить `.env`, credentials, cookie values, raw tokens или passwords.
- Не хранить auth token в `localStorage`.
- Не логировать пароли, cookies, reset links, token values или полный sensitive payload.
- UI и route parameter не являются авторизацией: доступ проверяет API в guard, policy и repository query.

## Документация

- [Функциональное ТЗ](docs/superpowers/specs/2026-08-30-family-budget-app-spec.md)
- [Спецификация разработки](docs/superpowers/specs/2026-08-30-family-budget-development-spec.md)
- [Дизайн Этапа 1](docs/superpowers/specs/2026-08-31-stage-1-database-auth-design.md)
- [Implementation plan Этапа 1](docs/superpowers/plans/2026-08-31-stage-1-database-auth.md)
