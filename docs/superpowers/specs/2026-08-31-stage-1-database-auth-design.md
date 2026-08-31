# Дизайн Этапа 1: база данных и авторизация HarmoFin

**Дата:** 31.08.2026
**Статус:** согласовано к планированию
**Область:** Этап 1 — PostgreSQL schema, migrations, seed, аутентификация, серверные сессии, изоляция workspace/budget и базовый audit

## 1. Цель и границы

Этап добавляет устойчивый слой данных и auth-flow поверх foundation проекта. Пользователь сможет зарегистрироваться, войти, выйти, восстановить и сменить пароль, управлять своими сессиями, создать workspace с первым budget и обращаться к защищенным budget endpoints.

В Этап не входят accounts, categories, envelopes, transactions, allocations, transfers, plans, notifications, analytics, exports, совместный UI-доступ и production deployment. Schema не создаёт финансовые таблицы заранее.

Модель membership поддерживает `OWNER`, `EDITOR` и `VIEWER`, но регистрация и MVP-сценарии используют `OWNER`. Email verification подготавливается полем `email_verified_at`, однако enforcement, verification tokens и отдельный verification flow откладываются. До публичного запуска verification flow должен быть добавлен отдельным решением.

## 2. Принятый подход

Используется один Prisma-backed persistence layer и собственный application session service:

- Prisma schema находится в корневом `prisma/schema.prisma`;
- API получает единственный singleton `PrismaService`;
- Prisma service заменяет health-only raw `pg` pool и предоставляет `SELECT 1` probe;
- auth cookie содержит только криптографически случайный opaque token;
- в DB хранятся только HMAC-SHA256 digests session и recovery tokens;
- Auth, Workspace и Budget остаются отдельными модулями модульного монолита;
- Mailpit используется только local/CI через SMTP adapter; production SMTP настраивается секретами;
- Fastify rate limiter хранит counters в памяти одного API процесса. Redis и отдельное rate-limit хранилище не добавляются до доказанной потребности; при multi-replica deployment storage должен быть заменён.

`@fastify/session` и JWT не используются: plugin session abstraction усложняет явный контроль rotation/revocation, а JWT не соответствует требованию server-side sessions.

## 3. Модель данных

### 3.1. Общие правила

Все внешние идентификаторы — UUIDv7, генерируемые приложением, и хранятся PostgreSQL `uuid`. Денежных сущностей на Этапе нет, поэтому денежные constraints не добавляются. Время хранится в UTC через `timestamptz`; timezone workspace/budget используется только при отображении.

Prisma models используют snake_case DB names через `@map`/`@@map`. Изменяемые сущности имеют `created_at` и `updated_at`; где применимо, также `created_by`, `updated_by`, `deleted_at` или `revoked_at`. Родительские сущности не удаляются физически, если это нарушает audit history.

### 3.2. Таблицы

`users`:

- `id`, `email`, `password_hash`;
- nullable `display_name`, nullable `email_verified_at`;
- `status` (`ACTIVE`, `LOCKED`, `DELETED`);
- `created_at`, `updated_at`.

Email нормализуется на границе API: trim и lowercase. DB unique index и check на lowercase защищают от race condition и обхода нормализации. Password никогда не попадает в DTO, audit JSON или logs.

`sessions`:

- `id`, `user_id`;
- unique `token_hash`, `csrf_token_hash`;
- `created_at`, `last_seen_at`;
- `idle_expires_at`, `absolute_expires_at`;
- nullable `revoked_at`, `revoked_reason`;
- nullable bounded `user_agent` для списка устройств.

IP не сохраняется. Текущая session вычисляется по request context, а не хранится в пользовательском payload.

`workspaces`:

- `id`, `owner_id`, `name`;
- `timezone` default `Europe/Moscow`;
- `status` (`ACTIVE`, `ARCHIVED`);
- `created_at`, `updated_at`.

`workspace_memberships`:

- `id`, `workspace_id`, `user_id`;
- `role` (`OWNER`, `EDITOR`, `VIEWER`);
- `is_active`, nullable `removed_at`;
- `created_at`, `updated_at`;
- unique `(workspace_id, user_id)`.

`budgets`:

- `id`, `workspace_id`, `name`;
- `primary_currency` default `RUB`;
- `cycle_start_day` default `10`;
- `period_boundary_offset` default `15`;
- `allow_negative_balance` default `false`;
- `status` (`ACTIVE`, `ARCHIVED`);
- `created_at`, `updated_at`.

Budget settings сохраняются для будущих финансовых этапов, но не используются для расчетов на Этапе 1.

`recovery_tokens`:

- `id`, `user_id`;
- unique `token_hash`;
- `expires_at`, nullable `consumed_at`;
- `created_at`.

Token создаётся как криптографически случайные 32 bytes, digest вычисляется HMAC-SHA256 через `AUTH_TOKEN_HASH_SECRET`. После успешного consume запись нельзя использовать повторно. Активные старые reset tokens пользователя отзываются перед созданием нового.

`audit_events`:

- `id`, nullable `actor_user_id`;
- nullable `workspace_id`, `budget_id`;
- `entity_type`, nullable `entity_id`, `action`;
- nullable safe allowlisted `old_values` и `new_values` JSON;
- `source`, nullable `request_id`, `created_at`.

Auth events не содержат passwords, cookies, raw tokens, reset links или полные пользовательские payload. Для failed login actor может быть null. Audit query доступен только OWNER и всегда scoped workspace/budget.

### 3.3. DB constraints и indexes

Первая migration добавляет:

- foreign keys с restrictive delete behavior;
- уникальность email, session/recovery digests и membership pair;
- non-empty trimmed checks для names;
- `primary_currency = 'RUB'`;
- допустимые диапазоны: `cycle_start_day` от `1` до `28`, `period_boundary_offset` от `1` до `27`;
- `expires_at > created_at` для sessions/recovery tokens;
- индексы active sessions по user/expiry, recovery по user/expiry, memberships по user/workspace, budgets по workspace/status и audit по workspace/budget/time.

Membership chain не выражается обычным foreign key: application service и каждый repository query проверяют `user_id`, `workspace_id`, `budget_id` в одном DB query.

## 4. API и application modules

### 4.1. Composition

`AppModule` регистрирует один `DatabaseModule`, `AuthModule`, `WorkspaceModule` и `BudgetModule`. Health module использует тот же Prisma provider. Auth module содержит password hashing, session management, recovery email adapter, DTO/schemas, guards и policies. Workspace/Budget repositories не принимают произвольный user query без scope object.

Request context после `SessionAuthGuard` содержит `userId` и `sessionId`. Policy layer получает membership role. Controller только валидирует transport DTO, вызывает application service и возвращает response DTO; Prisma не вызывается из controller.

### 4.2. Auth endpoints

- `POST /api/v1/auth/register` принимает email, password и optional workspace/budget names. В одной transaction создаются user, workspace, OWNER membership, budget и session. Cookie устанавливается после commit.
- `POST /api/v1/auth/login` принимает email/password. При успехе прежняя cookie session отзывается, создаётся новая session и выполняется rotation. Неверные credentials всегда дают одинаковый `401 INVALID_CREDENTIALS`.
- `POST /api/v1/auth/logout` отзывает current session и очищает cookie; повторный вызов безопасен и возвращает `204`.
- `POST /api/v1/auth/recovery/request` принимает email и всегда возвращает generic `202`, независимо от существования пользователя. Для существующего active user создаются token и Mailpit/SMTP message.
- `POST /api/v1/auth/recovery/confirm` принимает token и новый password. Transaction условно consume-ит неистёкший token, меняет password, отзывает все старые sessions и создаёт одну новую. Invalid, expired и reused tokens дают единый `422 INVALID_RECOVERY_TOKEN`.
- `GET /api/v1/auth/csrf` требует current session, ротирует CSRF token и возвращает его только response body текущего запроса.
- `POST /api/v1/auth/password` требует current password и новый password. Все старые sessions отзываются; создаётся одна новая current session.
- `GET /api/v1/auth/sessions` возвращает active sessions без token/hash/password.
- `DELETE /api/v1/auth/sessions/{sessionId}` отзывает одну session только того же user.
- `DELETE /api/v1/auth/sessions` отзывает все sessions, включая current, и очищает cookie.
- `GET /api/v1/me` возвращает safe user data, workspaces, memberships и budgets.

### 4.3. Workspace и budget endpoints

- `GET /api/v1/workspaces` возвращает только workspaces с active membership текущего user.
- `POST /api/v1/workspaces` transactionally создаёт workspace, OWNER membership и первый budget.
- `GET /api/v1/workspaces/{workspaceId}/budgets` проверяет membership и возвращает только budgets этого workspace.
- `POST /api/v1/workspaces/{workspaceId}/budgets` доступен OWNER и создаёт budget в указанном workspace.
- `GET /api/v1/budgets/{budgetId}` выполняет scoped lookup через budget и active membership.
- `PATCH /api/v1/budgets/{budgetId}` изменяет только Stage 1 поля `name` и `status`, доступен OWNER и выполняется scoped transaction.

Чужой или недоступный объект не различается по ответу от отсутствующего объекта: repository возвращает not found и API отдаёт `404 RESOURCE_NOT_FOUND`. Известный active member без нужной role получает `403 FORBIDDEN`.

### 4.4. Roles и policies

- `OWNER`: читает и управляет workspace, budget, memberships и audit.
- `EDITOR`: читает доступные workspace/budget; не управляет Stage 1 workspace/budget settings.
- `VIEWER`: читает доступные workspace/budget; не изменяет данные.

Policy tests проверяют матрицу независимо от того, что registration создаёт только OWNER. UI visibility не считается authorization.

## 5. Session, cookie и CSRF

Session token генерируется через cryptographically secure random source. Cookie содержит raw token только на клиенте. DB хранит HMAC digest и expiration. Idle timeout — 30 дней, absolute timeout — 90 дней; DB проверяет оба срока при каждом authenticated request. `last_seen_at` обновляется с ограниченной частотой.

Cookie attributes:

- `HttpOnly=true`;
- `SameSite=Lax`;
- `Secure=true` только при `NODE_ENV=production`;
- `Path=/`, без Domain;
- production cookie name использует `__Host-` prefix, local/test — безопасное non-production имя;
- max-age соответствует idle timeout, но DB absolute timeout имеет приоритет.

CSRF реализуется synchronizer token: session хранит только digest, `GET /auth/csrf` выдаёт новый raw token. Каждый authenticated `POST`, `PATCH` и `DELETE` требует exact configured `Origin` и `X-CSRF-Token`. Anonymous register/login/recovery endpoints требуют Origin и rate limit, но не CSRF session token. Web держит CSRF token только в runtime memory.

Auth secrets не помещаются в Nuxt public runtime config. Production startup требует `AUTH_TOKEN_HASH_SECRET`, SMTP credentials, web origin и корректную cookie configuration; local/test используют значения, явно заданные `.env`, а не hardcoded production secrets.

## 6. Passwords и recovery delivery

Password policy: minimum 10 characters and maximum 128 characters; password не trim-ится и не нормализуется. Argon2id parameters фиксируются в server-side password service и не меняются клиентом.

Recovery mail отправляется через `EmailSender` interface и `nodemailer` SMTP adapter. Local Compose добавляет Mailpit с SMTP endpoint; recovery URL использует configured web base URL. API никогда не возвращает raw token, не пишет его в logs/audit и не включает в error response. Integration tests могут подменить adapter; E2E извлекает link через Mailpit API.

Recovery request для неизвестного email имеет тот же response, что и существующий email. Ошибки SMTP наружу переводятся в sanitized Problem Details и не раскрывают recipient или token.

## 7. Ошибки и OpenAPI

Все auth, workspace и budget request schemas валидируются Zod pipe на API boundary с reject unknown fields. OpenAPI DTO/schema описывает каждый endpoint, body, response, cookie behavior, security requirement и ошибки.

Problem Details сохраняет текущие поля `type`, `title`, `status`, `code`, `detail`, `requestId` и получает optional `fieldErrors` с `field`, `message`, `code`. Предусмотренные статусы:

- `400` — malformed request/field validation;
- `401` — missing/invalid session или invalid credentials;
- `403` — CSRF, Origin или role denial;
- `404` — missing/inaccessible resource;
- `409` — duplicate email или state conflict;
- `422` — recovery/business validation;
- `429` — auth rate limit;
- `500/503` — sanitized internal/dependency failure.

Responses никогда не содержат stack trace, SQL, connection string, secrets, passwords, cookies, token values или full sensitive payload.

## 8. Web implementation

Добавляются русскоязычные accessible pages `/register`, `/login`, `/forgot-password`, `/reset-password?token=...` и защищённая `/app`. Forms используют labels, keyboard navigation, visible focus, field errors, summary error, loading state и disabled submit during request.

Единый API composable отправляет `credentials: 'include'`, configured `Origin` и CSRF header для mutations. Auth state не сохраняется в localStorage, cookies не читаются JavaScript. После регистрации/login/reset/password change пользователь попадает в `/app`; route middleware вызывает `/api/v1/me` и отправляет `401` на `/login`. `/app` показывает только данные user/workspace/budget из API, без fake financial values.

## 9. Seed и локальная инфраструктура

`prisma/seed` создаёт только local/test demo data:

- deterministic `demo@harmofin.test`;
- password hash из `SEED_DEMO_PASSWORD`;
- один workspace;
- OWNER membership;
- один active RUB budget;
- безопасный audit event о seed.

Seed запрещён при `NODE_ENV=production`, требует password длиной минимум 10, не выводит credentials и выполняется идempotently. Accounts, categories, envelopes, operations и fake balances не создаются.

Local Compose сохраняет PostgreSQL и добавляет Mailpit только для Stage 1. Production SMTP не использует local credentials. README получает команды только после проверки фактических scripts.

Root scripts добавляют `db:generate`, `db:migrate:dev`, `db:migrate`, `db:seed` и `test:e2e`. Prisma CLI и client ownership фиксируются в manifests так, чтобы root schema/seed и API runtime использовали совместимые generated artifacts в ESM/NodeNext workspace.

## 10. Tests и CI

Unit tests без DB проверяют:

- email/password normalization and policy;
- Argon2id service contract;
- token generation/digest and expiry decisions;
- session rotation/revocation rules;
- CSRF/Origin decisions;
- role policy matrix;
- Problem Details and field errors;
- rate-limit behavior.

Integration tests на реальном PostgreSQL проверяют:

- migration на blank DB;
- повторное `migrate deploy` на existing schema/data;
- FK, unique/check constraints;
- idempotent seed;
- registration and email uniqueness race behavior;
- login/logout/session rotation;
- recovery TTL, digest-only persistence and replay rejection;
- password change/recovery revoking old sessions;
- one/all session revoke;
- workspace/budget creation and OWNER membership;
- forged IDs and repository scope;
- role authorization;
- audit event content and safe logging.

API tests через Fastify inject проверяют cookies, CSRF, rate limits, HTTP status/error body, OpenAPI paths/schemas and absence of secrets. Web Playwright tests проверяют register, login, logout, protected `/app`, forgot-password, Mailpit reset link, reset-password and session revocation.

CI order:

1. frozen dependency install;
2. Prisma generate;
3. format, lint and typecheck;
4. blank DB migration;
5. seed twice;
6. repeated migration against existing data;
7. unit and PostgreSQL integration tests;
8. OpenAPI validation;
9. web/API/worker build;
10. Playwright with PostgreSQL and Mailpit;
11. Compose configuration validation.

CI uses only test/local credentials. No production seed, SMTP credentials, cookies, passwords, token values or financial payload enter repository or logs.

## 11. Acceptance criteria

Этап принят, если:

1. Clean checkout генерирует Prisma client и применяет first migration.
2. Повторное применение migration сохраняет schema и seeded data.
3. Seed безопасен, idempotent и не работает в production.
4. Registration atomically creates user, workspace, OWNER membership, budget and session.
5. Login, logout, session rotation, one/all revoke, password change and recovery work against PostgreSQL.
6. Recovery tokens имеют TTL, one-time consume и digest-only storage.
7. Cookies имеют требуемые HttpOnly/SameSite/Secure semantics; auth tokens не в localStorage.
8. CSRF, Origin, rate limits and Problem Details работают и покрыты tests.
9. Budget/workspace repository queries prevent cross-tenant access even when IDs are forged.
10. OWNER/EDITOR/VIEWER policies and baseline auth/budget audit events are tested.
11. `/api/v1/me` and protected workspace/budget endpoints documented in OpenAPI.
12. Web auth pages and protected route pass Playwright smoke tests.
13. README documents only verified migration, seed, integration and E2E commands.
14. Stage 1 does not add financial domain or production deployment.
