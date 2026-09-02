# Этап 1: база данных и авторизация — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить PostgreSQL schema, Prisma migrations и безопасный auth-flow HarmoFin с server-side sessions, изоляцией workspace/budget, базовым audit и русскоязычными web-страницами.

**Architecture:** Корневые Prisma schema/migrations используют один `PrismaService` в API. Auth использует собственный session service: cookie содержит только случайный opaque token, а DB хранит HMAC digest; Auth, Workspace и Budget разделены на Nest modules с repositories, application services, guards и policies. Mailpit используется local/CI через SMTP adapter, production SMTP остаётся конфигурацией секретов.

**Tech Stack:** Node.js 24.20.0, pnpm 11.24.0, TypeScript strict/ESM, NestJS 11 + Fastify 5, Prisma + PostgreSQL 18, Argon2id, `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`, Zod, Nodemailer, Nuxt 4/Vue 3, Vitest, Supertest/Fastify inject, Playwright.

**Spec:** [Stage 1 design](../specs/2026-08-31-stage-1-database-auth-design.md), [functional specification](../specs/2026-08-30-family-budget-app-spec.md), [development specification](../specs/2026-08-30-family-budget-development-spec.md)

## Global Constraints

- Поведение продукта определяется функциональным ТЗ; техническая реализация — development spec и [Stage 1 design](../specs/2026-08-31-stage-1-database-auth-design.md).
- Runtime: Node.js `24.20.0`, Corepack/pnpm `11.24.0`; сохранить ESM, NodeNext и `.js` import specifiers.
- API prefix остаётся `/api/v1`; каждый новый endpoint получает OpenAPI request/response/error schemas.
- Все пользовательские queries проверяют authenticated user, active membership, workspace, budget и role; фильтрация tenant выполняется в DB query, не после чтения.
- Passwords используют Argon2id, минимум 10 и максимум 128 символов; password, cookie, token, session secret и sensitive payload не попадают в logs, audit или API responses.
- Sessions persistent в PostgreSQL; cookie `HttpOnly`, `SameSite=Lax`, `Secure` только production, `Path=/`, без Domain; auth tokens не хранятся в `localStorage`.
- Recovery token — cryptographically random 32 bytes, HMAC-SHA256 digest only, TTL 1 hour, one-time consume; password change/recovery отзывает все старые sessions и создаёт одну rotated session.
- Cookie mutations защищены exact `Origin` и synchronizer CSRF token; login и recovery имеют отдельные rate limits.
- Первый registration transaction создаёт user, workspace, OWNER membership, budget и session; registration и seed не создают финансовые сущности.
- Role model содержит `OWNER`, `EDITOR`, `VIEWER`; MVP создаёт только OWNER, но policies тестируются для всех ролей.
- Только `CONFIRMED` financial records правило пока не используется: financial tables не создаются на Этапе 1.
- Seed разрешён только `development`/`test`, требует `SEED_DEMO_PASSWORD` через env и не печатает credentials.
- Integration tests используют реальный PostgreSQL; migration deploy проверяется на blank и existing schema/data; destructive production reset не добавляется.
- User-facing copy и документация на русском; code identifiers, API names и DB schema на английском.
- Не изменять и не stage [identity/logo_description.png](../../identity/logo_description.png).

---

### Task 1: Prisma manifests, schema, first migration и safe seed

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/migrations/20260831000000_init/migration.sql`
- Create: `prisma/seed/index.ts`
- Create: `apps/api/src/database/seed.ts`
- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `.env.example`
- Test: `apps/api/src/database/seed.test.ts`

**Interfaces:**
- Root scripts produce `db:generate`, `db:migrate:dev`, `db:migrate`, `db:seed`.
- `runSeed(input: NodeJS.ProcessEnv): Promise<void>` is the executable seed entrypoint.
- Prisma client exposes models `User`, `Session`, `Workspace`, `WorkspaceMembership`, `Budget`, `RecoveryToken`, `AuditEvent` and enums `UserStatus`, `SessionRevokeReason`, `WorkspaceStatus`, `WorkspaceMembershipRole`, `BudgetStatus`.
- Later API tasks import `@prisma/client` from `apps/api` and use schema at `../../prisma/schema.prisma`.

- [ ] **Step 1: Add dependency and script contracts before schema implementation.**

Modify API manifest with direct runtime dependencies `@prisma/client`, `argon2`, `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`, and `nodemailer`; add `prisma` as API dev dependency. Keep existing `pg` until Task 2 removes its health-only use. Add root scripts exactly:

```json
{
  "db:generate": "pnpm --filter @harmofin/api exec prisma generate --schema ../../prisma/schema.prisma",
  "db:migrate:dev": "pnpm --filter @harmofin/api exec prisma migrate dev --schema ../../prisma/schema.prisma",
  "db:migrate": "pnpm --filter @harmofin/api exec prisma migrate deploy --schema ../../prisma/schema.prisma",
  "db:seed": "pnpm --filter @harmofin/api exec tsx ../../prisma/seed/index.ts",
  "test:integration": "pnpm db:migrate && pnpm --filter @harmofin/api test:integration"
}
```

Add `.env.example` values for local/test auth and Mailpit without production secrets:

```dotenv
AUTH_TOKEN_HASH_SECRET=local-only-change-this-secret-32-bytes-minimum
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
MAIL_FROM=no-reply@harmofin.local
WEB_BASE_URL=http://localhost:3000
SEED_DEMO_PASSWORD=local-demo-password-10
```

- [ ] **Step 2: Write schema-level acceptance tests.**

Create `apps/api/src/database/seed.test.ts` with pure checks for `runSeed` guards. Assert `NODE_ENV=production` throws before opening Prisma, missing `SEED_DEMO_PASSWORD` throws, an 9-character password throws, and a 10-character password reaches the injected seed client. Expose a test-only dependency seam in `seed.ts` rather than mocking module globals.

- [ ] **Step 3: Define the Prisma schema.**

Use one PostgreSQL datasource and default Prisma client generator. Map every model/table and field to snake_case. Define fields from the approved design; representative generator and model shape:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                 String   @id @db.Uuid
  email              String   @unique @db.VarChar(320)
  passwordHash       String   @map("password_hash") @db.VarChar(512)
  displayName        String?  @map("display_name") @db.VarChar(120)
  emailVerifiedAt    DateTime? @map("email_verified_at") @db.Timestamptz(3)
  status             UserStatus @default(ACTIVE)
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt          DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  sessions           Session[]
  memberships        WorkspaceMembership[]
  ownedWorkspaces    Workspace[] @relation("WorkspaceOwner")
  recoveryTokens     RecoveryToken[]
  auditEvents        AuditEvent[]

  @@map("users")
}
```

Add equivalent complete models for `Session`, `Workspace`, `WorkspaceMembership`, `Budget`, `RecoveryToken` and `AuditEvent`, with named relations where a model has more than one user relation. Use `String @db.Uuid` IDs without database sequential defaults; application services generate UUIDv7. Use `Json?` only for safe audit snapshots.

- [ ] **Step 4: Create and review first migration.**

Generate the migration from the schema with `pnpm db:generate` and `pnpm db:migrate:dev -- --name init --create-only` against local PostgreSQL, then normalize its directory to `prisma/migrations/20260831000000_init/migration.sql` if Prisma generated a different timestamp. Keep generated SQL as source of truth and add explicit SQL checks/indexes that Prisma schema cannot express:

```sql
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_cycle_start_day_check"
  CHECK ("cycle_start_day" BETWEEN 1 AND 28);
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_period_boundary_offset_check"
  CHECK ("period_boundary_offset" BETWEEN 1 AND 27);
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expiry_order_check"
  CHECK ("idle_expires_at" > "created_at" AND "absolute_expires_at" >= "idle_expires_at");
ALTER TABLE "recovery_tokens"
  ADD CONSTRAINT "recovery_tokens_expiry_check"
  CHECK ("expires_at" > "created_at");
```

Add trimmed non-empty checks for workspace and budget names, `primary_currency = 'RUB'`, restrictive foreign keys, unique `(workspace_id,user_id)`, and indexes for active sessions, recovery expiry, membership lookup, budget lookup and audit time lookup. Review migration SQL for absent `DROP`, destructive data rewrite, production host or secret.

- [ ] **Step 5: Implement idempotent safe seed.**

`apps/api/src/database/seed.ts` must use `PrismaClient` and a transaction. Validate environment before connecting; reject production and invalid demo password. Upsert by `demo@harmofin.test`, then upsert one workspace, one OWNER membership and one active RUB budget; create the seed audit event with no password/token fields. Use a stable UUIDv7 per deterministic record or query by unique natural key, and make the second run preserve one user/workspace/membership/budget. `prisma/seed/index.ts` only loads and calls `runSeed(process.env)`.

- [ ] **Step 6: Run schema and seed checks.**

Run:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm db:migrate
pnpm --filter @harmofin/api test -- src/database/seed.test.ts
```

Expected: first migration succeeds on blank DB, seed second run is idempotent, second migration reports no pending migration, production guard unit tests pass. Do not run `db:seed` against a production URL.

- [ ] **Step 7: Commit.**

```bash
git add package.json apps/api/package.json .env.example prisma
  apps/api/src/database/seed.ts apps/api/src/database/seed.test.ts
 git diff --cached --check
git commit -m "feat: add stage 1 prisma schema and seed"
```

Do not include `identity/logo_description.png`.

---

### Task 2: Shared Prisma provider, API configuration и health lifecycle

**Files:**
- Create: `apps/api/src/database/prisma.service.ts`
- Create: `apps/api/src/database/prisma.service.test.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/config/env.test.ts`
- Modify: `apps/api/src/database/database-health.service.ts`
- Modify: `apps/api/src/database/database-health.service.test.ts`
- Modify: `apps/api/src/database/database.module.ts`
- Modify: `apps/api/src/health/health.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/health.integration.test.ts`
- Modify: `apps/api/test/api-process.integration.test.ts`

**Interfaces:**
- `loadApiConfig(input: NodeJS.ProcessEnv): ApiConfig` returns nested `auth`, `mail` and `rateLimit` config in addition to existing fields.
- `PrismaService extends PrismaClient` and implements `OnModuleDestroy`; `onModuleDestroy(): Promise<void>` disconnects once.
- `DatabaseHealthService.check(): Promise<void>` executes `$queryRaw	h` equivalent to `SELECT 1`; `close(): Promise<void>` remains idempotent.
- `DatabaseModule.register(config: ApiConfig)` exports exactly one `PrismaService` and `DatabaseHealthService` provider set.

- [ ] **Step 1: Extend configuration tests first.**

Add tests for missing/invalid `AUTH_TOKEN_HASH_SECRET`, invalid SMTP port, invalid `WEB_BASE_URL`, production missing SMTP credentials, defaults in test/development, and valid config mapping. Use explicit test input:

```ts
const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  WEB_ORIGIN: 'http://localhost:3000',
  AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'no-reply@harmofin.test',
  WEB_BASE_URL: 'http://localhost:3000',
};
```

Assert returned values include `auth.idleTimeoutSeconds = 2_592_000`, `auth.absoluteTimeoutSeconds = 7_776_000`, `auth.recoveryTtlSeconds = 3_600`, and rate defaults `loginMax = 10`, `recoveryMax = 5`, `windowSeconds = 900`. Production requires a non-placeholder secret and SMTP host/from values.

- [ ] **Step 2: Implement typed env schema.**

Keep existing `nodeEnv`, `apiPort`, `databaseUrl`, `webOrigin`, `logLevel`. Add:

```ts
interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  apiPort: number;
  databaseUrl: string;
  webOrigin: string;
  logLevel: LogLevel;
  auth: {
    tokenHashSecret: string;
    idleTimeoutSeconds: number;
    absoluteTimeoutSeconds: number;
    recoveryTtlSeconds: number;
    cookieName: string;
  };
  mail: {
    smtpHost: string;
    smtpPort: number;
    smtpUser?: string;
    smtpPassword?: string;
    from: string;
    webBaseUrl: string;
  };
  rateLimit: {
    windowSeconds: number;
    loginMax: number;
    recoveryMax: number;
  };
}
```

Derive cookie name as `__Host-harmofin_session` in production and `harmofin_session` otherwise. Reject production if `AUTH_TOKEN_HASH_SECRET` is shorter than 32 bytes or equals the local example, if SMTP credentials are incomplete, or if `WEB_BASE_URL` is not HTTP(S). Do not return raw env in error messages.

- [ ] **Step 3: Write Prisma lifecycle tests.**

Construct `PrismaService` with a mocked `$disconnect` and assert `onModuleDestroy` calls it once even when invoked twice. Construct `DatabaseHealthService` with a fake `$queryRaw` and assert `check()` resolves after one `SELECT 1` query and `close()` delegates to the same singleton. Preserve existing failure test behavior.

- [ ] **Step 4: Replace health-only pool with singleton Prisma provider.**

`PrismaService` constructor receives `databaseUrl` through `super({ datasources: { db: { url: databaseUrl }}})` and performs no query during construction. `DatabaseModule.register` creates one provider with `useFactory`, exports it, and provides health service. `HealthModule` imports `DatabaseModule` but does not register a second provider. Remove `createDatabasePool`, `DATABASE_POOL` and `pg` use after all tests migrate.

- [ ] **Step 5: Update app/test config seams.**

Update `createApiApp` callers and existing health/API process fixtures to use a shared `createTestApiConfig()` object satisfying the new `ApiConfig`. Keep `/api/v1/health/live`, `/api/v1/health/ready`, shutdown hooks and failure Problem Details unchanged. Run:

```bash
pnpm --filter @harmofin/api test -- src/config src/database src/health
pnpm --filter @harmofin/api typecheck
pnpm --filter @harmofin/api test:integration
```

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/config apps/api/src/database apps/api/src/health apps/api/src/app.module.ts apps/api/test
 git diff --cached --check
git commit -m "refactor: add shared prisma api lifecycle"
```

---

### Task 3: Validation, Problem Details, security plugins и request context

**Files:**
- Create: `apps/api/src/common/validation/zod-validation.pipe.ts`
- Create: `apps/api/src/common/validation/zod-validation.pipe.test.ts`
- Create: `apps/api/src/common/request-context/request-context.ts`
- Create: `apps/api/src/common/security/origin.guard.ts`
- Create: `apps/api/src/common/security/csrf.guard.ts`
- Create: `apps/api/src/common/security/security.constants.ts`
- Create: `apps/api/src/common/security/security.guards.test.ts`
- Modify: `apps/api/src/common/errors/problem-details.dto.ts`
- Modify: `apps/api/src/common/errors/problem-details.filter.ts`
- Modify: `apps/api/src/common/errors/problem-details.filter.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- `ZodValidationPipe<T extends z.ZodTypeAny>` implements `PipeTransform`; invalid input throws an application error carrying `fieldErrors: Array<{ field: string; message: string; code: string }>`.
- `RequestContext` is `{ userId: string; sessionId: string; csrfTokenHash: string }` and is attached only by session guard in Task 5.
- `OriginGuard.canActivate(context: ExecutionContext): boolean` rejects unsafe requests whose `Origin` is not exactly `config.webOrigin`.
- `CsrfGuard.canActivate(context: ExecutionContext): Promise<boolean>` compares `X-CSRF-Token` digest with current session digest for authenticated unsafe requests.
- Problem Details adds optional `fieldErrors` while preserving `type`, `title`, `status`, `code`, `detail`, `requestId`.

- [ ] **Step 1: Add failing tests for Zod and error mapping.**

Test a schema `{ email: z.string().email(), password: z.string().min(10) }` with both fields invalid. Assert pipe throws status `400`, code `VALIDATION_FAILED`, and deterministic field entries. Test unknown fields are rejected. Extend filter tests to assert `application/problem+json`, all existing fixed fields, field errors when present, and no stack/SQL/secret for unknown exceptions.

- [ ] **Step 2: Add failing Origin/CSRF tests.**

Use fake execution contexts for `GET`, `POST` with expected origin, `POST` with foreign origin, missing origin, missing CSRF header, matching token digest and mismatched token. Assert public auth mutations skip synchronizer CSRF but still require exact Origin; protected mutations require both.

- [ ] **Step 3: Implement validation and Problem Details.**

Use `ZodError.issues` to map `issue.path.join('.')`, `issue.message` and `issue.code`; never copy arbitrary input into error details. Register `new ValidationPipe` globally only for Zod-backed DTO parameters, or use explicit parameter pipes so health routes remain unchanged. Extend Swagger DTO with:

```ts
class FieldErrorDto {
  field!: string;
  message!: string;
  code!: string;
}

class ProblemDetailsDto {
  type!: string;
  title!: string;
  status!: number;
  code!: string;
  detail!: string;
  requestId!: string;
  fieldErrors?: FieldErrorDto[];
}
```

Update filter to whitelist `code`, `detail` and `fieldErrors`; never serialize raw `HttpException` response arrays or unknown error messages.

- [ ] **Step 4: Implement Origin/CSRF guards and app plugins.**

Register `@fastify/cookie`, `@fastify/helmet` and `@fastify/rate-limit` before Nest routes in `createApiApp`. Keep CORS `origin: config.webOrigin, credentials: true`. Origin guard compares exact configured origin for unsafe methods and allows safe methods. CSRF guard reads `request.cookies[config.auth.cookieName]`, request context and `X-CSRF-Token`; it does not accept a token from query/body. Public endpoint metadata explicitly marks register/login/recovery as anonymous-Origin-only.

- [ ] **Step 5: Run focused checks and commit.**

```bash
pnpm --filter @harmofin/api test -- src/common
pnpm --filter @harmofin/api lint
pnpm --filter @harmofin/api typecheck
```

```bash
git add apps/api/src/common apps/api/src/app.ts apps/api/src/app.module.ts
git diff --cached --check
git commit -m "feat: add api validation and csrf protection"
```

---

### Task 4: Password, opaque token, session and role policy services

**Files:**
- Create: `apps/api/src/auth/password.service.ts`
- Create: `apps/api/src/auth/password.service.test.ts`
- Create: `apps/api/src/auth/token.service.ts`
- Create: `apps/api/src/auth/token.service.test.ts`
- Create: `apps/api/src/auth/session.service.ts`
- Create: `apps/api/src/auth/session.service.test.ts`
- Create: `apps/api/src/auth/auth.types.ts`
- Create: `apps/api/src/common/policies/role-policy.ts`
- Create: `apps/api/src/common/policies/role-policy.test.ts`

**Interfaces:**

```ts
interface PasswordService {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  assertValid(password: string): void;
}

interface TokenService {
  createRawToken(): string;
  digest(rawToken: string): string;
}

interface SessionService {
  create(userId: string, metadata: SessionMetadata, tx?: Prisma.TransactionClient): Promise<CreatedSession>;
  authenticate(rawToken: string): Promise<AuthenticatedSession | null>;
  rotateForUser(userId: string, metadata: SessionMetadata, tx?: Prisma.TransactionClient): Promise<CreatedSession>;
  revoke(userId: string, sessionId: string, reason: SessionRevokeReason): Promise<boolean>;
  revokeAll(userId: string, reason: SessionRevokeReason): Promise<number>;
  list(userId: string): Promise<SessionView[]>;
}
```

`CreatedSession` contains `id`, `rawToken`, `rawCsrfToken`, `idleExpiresAt`, `absoluteExpiresAt`; no digest leaves service. `AuthenticatedSession` contains user/session IDs and stored CSRF digest only.

- [ ] **Step 1: Write password and token failing tests.**

Assert 9-character password fails, 10-character password succeeds, 129-character password fails, whitespace is not silently removed, two Argon2id hashes differ, correct password verifies, wrong password fails, raw token has at least 32 random bytes, repeated raw tokens differ, digest is deterministic and raw token never equals digest.

- [ ] **Step 2: Write session and policy failing tests.**

With a fake repository/clock, assert session creation stores only digests, sets 30-day idle/90-day absolute expiry, authenticates active non-expired rows, rejects revoked/idle-expired/absolute-expired rows, updates last-seen at most once per configured interval, rotates token after login, revokes one/all sessions, and never returns token/hash in `SessionView`. Assert policy matrix: all roles read; only OWNER manages workspace/budget/audit; EDITOR and VIEWER fail manage checks.

- [ ] **Step 3: Implement password/token services.**

Use `argon2.hash(password, { type: argon2.argon2id, timeCost: 3, memoryCost: 65_536, parallelism: 1 })`; call `argon2.verify` without logging inputs. Use `crypto.randomBytes(32).toString('base64url')` for raw tokens and `createHmac('sha256', tokenHashSecret).update(raw).digest('hex')` for digests. Keep secret and raw values in process memory only for current operation.

- [ ] **Step 4: Implement session service against Prisma.**

Create session row inside optional caller transaction with UUIDv7 ID, token/CSRF digests, bounded user-agent, UTC expiries and no raw token. Authenticate with `where: { tokenHash, revokedAt: null, userId relation active }` plus both expiry predicates in the same query; return null for any miss. `rotateForUser` revokes all old sessions in the same transaction, then creates one new session. `revoke` and `revokeAll` scope by user ID in DB query.

- [ ] **Step 5: Implement role policy and focused checks.**

Keep policy pure and independent of Nest/Prisma. Run:

```bash
pnpm --filter @harmofin/api test -- src/auth src/common/policies
pnpm --filter @harmofin/api typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/auth apps/api/src/common/policies
git diff --cached --check
git commit -m "feat: add password session and role services"
```

---

### Task 5: Auth module, recovery mail, guards и auth endpoints

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.application.service.ts`
- Create: `apps/api/src/auth/auth.repository.ts`
- Create: `apps/api/src/auth/email-sender.ts`
- Create: `apps/api/src/auth/smtp-email.sender.ts`
- Create: `apps/api/src/auth/auth.schemas.ts`
- Create: `apps/api/src/auth/auth.openapi.ts`
- Create: `apps/api/src/auth/session-auth.guard.ts`
- Create: `apps/api/src/auth/session-auth.guard.test.ts`
- Create: `apps/api/src/auth/auth.application.service.test.ts`
- Create: `apps/api/test/auth.integration.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- `EmailSender.sendPasswordRecovery(input: { recipient: string; resetUrl: string }): Promise<void>`; implementation never logs `recipient` or `resetUrl`.
- `SessionAuthGuard.canActivate(context: ExecutionContext): Promise<boolean>` authenticates cookie and sets `RequestContext`.
- `AuthApplicationService.register(input, requestMeta): Promise<AuthSessionResponse>`.
- `AuthApplicationService.login(input, requestMeta): Promise<AuthSessionResponse>`.
- `AuthApplicationService.requestRecovery(email, requestMeta): Promise<void>`.
- `AuthApplicationService.confirmRecovery(token, newPassword, requestMeta): Promise<AuthSessionResponse>`.
- `AuthApplicationService.changePassword(userId, sessionId, input, requestMeta): Promise<AuthSessionResponse>`.
- `AuthApplicationService.logout(userId, sessionId): Promise<void>`.

`AuthSessionResponse` contains safe `user`, `csrfToken`, workspace and budget summaries; it never contains session raw token, password hash or recovery token.

- [ ] **Step 1: Write failing auth application tests with fake email sender.**

Test registration transaction creates exactly one user, workspace, membership, budget and session; duplicate normalized email maps to `EMAIL_ALREADY_REGISTERED`; password is never returned. Test login wrong password and unknown email both map to `INVALID_CREDENTIALS`; successful login revokes old session and issues a different cookie token. Test logout revokes only current session. Test request recovery has same result for known/unknown email and sends only for known active user. Test confirm rejects expired and consumed tokens, accepts once, changes hash, revokes old sessions and creates one new session. Test password change requires current password and has same all-old-session revocation behavior. Use fake clock and fake email sender; assert no raw token in audit call.

- [ ] **Step 2: Write failing SessionAuthGuard tests.**

Assert missing cookie returns `401 SESSION_REQUIRED`, unknown/revoked/expired cookie returns `401 SESSION_INVALID`, valid cookie sets `{ userId, sessionId, csrfTokenHash }`, and raw cookie is not copied into context logs or response.

- [ ] **Step 3: Implement SMTP sender and auth repository.**

Create Nodemailer transporter from `config.mail`; build reset URL with `new URL('/reset-password', webBaseUrl)` and set `token` query parameter only in outbound email. Keep email body minimal and do not put password/token in logs. Repository methods must include user ID in session queries and use Prisma transaction client supplied by application service. Add a dummy Argon2id hash for unknown login email so password timing follows the same verification path.

- [ ] **Step 4: Implement auth application transactions.**

Normalize email before lookup/create. Registration transaction order: create user, workspace, OWNER membership, budget, audit event, session; set cookie only after commit. Login transaction revokes current cookie session if present, verifies password, creates rotated session and audit event. Recovery request revokes prior active reset rows, creates digest/expiry row, commits, then sends mail. Recovery confirm uses conditional update `WHERE id/token_hash AND consumed_at IS NULL AND expires_at > now()`; if update count is zero, return one generic `INVALID_RECOVERY_TOKEN`. Password change and recovery revoke sessions, update password, create session and audit atomically.

- [ ] **Step 5: Implement controller, guards, cookie helpers and route metadata.**

Add routes exactly:

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/recovery/request
POST   /api/v1/auth/recovery/confirm
GET    /api/v1/auth/csrf
POST   /api/v1/auth/password
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:sessionId
DELETE /api/v1/auth/sessions
GET    /api/v1/me
```

Use Zod schemas with reject-unknown and exact fields. Set/clear cookie with `HttpOnly`, `SameSite=Lax`, production `Secure`, `Path=/`, max-age 30 days. Apply `SessionAuthGuard` to protected routes, `OriginGuard` globally for unsafe requests, and `CsrfGuard` to authenticated mutations. Recovery request returns generic `202`; logout is idempotent `204`; session revoke current/all clears cookie.

- [ ] **Step 6: Add OpenAPI metadata and API integration tests.**

Document all request/response schemas, `401/403/404/409/422/429/500` Problem Details and `Set-Cookie` behavior. Integration tests use Fastify inject against real PostgreSQL and a fake `EMAIL_SENDER` provider. Assert registration/login/logout cookies and attributes, duplicate email, wrong password, `/me`, recovery token digest/TTL/replay, password/session revocation, CSRF rejection and OpenAPI paths. Assert response bodies contain no password, cookie, raw token or SMTP secret.

- [ ] **Step 7: Run and commit.**

```bash
pnpm --filter @harmofin/api test -- src/auth
pnpm --filter @harmofin/api test:integration -- auth.integration.test.ts
pnpm --filter @harmofin/api lint
pnpm --filter @harmofin/api typecheck
```

```bash
git add apps/api/src/auth apps/api/src/app.module.ts apps/api/src/app.ts apps/api/test/auth.integration.test.ts
git diff --cached --check
git commit -m "feat: add session based authentication"
```

---

### Task 6: Workspace/budget repositories, policies и protected endpoints

**Files:**
- Create: `apps/api/src/workspaces/workspace.module.ts`
- Create: `apps/api/src/workspaces/workspace.controller.ts`
- Create: `apps/api/src/workspaces/workspace.application.service.ts`
- Create: `apps/api/src/workspaces/workspace.repository.ts`
- Create: `apps/api/src/budgets/budget.module.ts`
- Create: `apps/api/src/budgets/budget.controller.ts`
- Create: `apps/api/src/budgets/budget.application.service.ts`
- Create: `apps/api/src/budgets/budget.repository.ts`
- Create: `apps/api/src/workspaces/workspace.schemas.ts`
- Create: `apps/api/src/budgets/budget.schemas.ts`
- Create: `apps/api/src/workspaces/workspace-budget.integration.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- `WorkspaceRepository.findAccessible(userId: string): Promise<WorkspaceSummary[]>`.
- `WorkspaceRepository.createWithFirstBudget(userId: string, input, requestMeta): Promise<WorkspaceWithBudget>`.
- `BudgetRepository.findAccessible(userId: string, budgetId: string): Promise<BudgetView | null>`.
- `BudgetRepository.listForWorkspace(userId: string, workspaceId: string): Promise<BudgetView[]>`.
- `BudgetRepository.create(userId: string, workspaceId: string, input, requestMeta): Promise<BudgetView>`.
- `BudgetRepository.update(userId: string, budgetId: string, input, requestMeta): Promise<BudgetView>`.

- [ ] **Step 1: Write repository isolation and policy tests first.**

Create two users with separate workspaces/budgets in PostgreSQL. Assert `findAccessible(userA, budgetB)` returns null, `listForWorkspace(userA, workspaceB)` returns empty, forged IDs never expose names or membership role, and every query includes user/workspace/budget predicates. Assert EDITOR/VIEWER can read and receive `403 FORBIDDEN` on create/update; OWNER can create and update only within their workspace. Assert an active membership in workspace A cannot access budget attached to workspace B.

- [ ] **Step 2: Implement scoped repository queries.**

Use nested Prisma filters, never post-fetch filtering. Budget lookup must have this shape:

```ts
where: {
  id: budgetId,
  workspace: {
    memberships: {
      some: { userId, isActive: true },
    },
  },
}
```

Workspace list filters `memberships.some({ userId, isActive: true })`; workspace budget list includes both `workspaceId` and membership predicate. Mutation transaction rechecks membership and role before writing. Audit insert receives only safe entity/name/status changes.

- [ ] **Step 3: Implement workspace and budget application services.**

`POST /workspaces` creates workspace, OWNER membership and first budget in one transaction. `POST /workspaces/:workspaceId/budgets` requires OWNER. `PATCH /budgets/:budgetId` accepts only `name` and `status`, rejects empty names and invalid status transitions, and requires OWNER. Use `404 RESOURCE_NOT_FOUND` for inaccessible resources and `403 FORBIDDEN` only after an accessible membership is found without required role.

- [ ] **Step 4: Implement controllers and OpenAPI.**

Add routes:

```text
GET    /api/v1/workspaces
POST   /api/v1/workspaces
GET    /api/v1/workspaces/:workspaceId/budgets
POST   /api/v1/workspaces/:workspaceId/budgets
GET    /api/v1/budgets/:budgetId
PATCH  /api/v1/budgets/:budgetId
```

Every route uses session, Origin/CSRF for mutations, Zod schemas, response DTOs and Problem Details. Do not expose password hashes, membership internals not needed by UI, or raw audit JSON from unrelated budgets.

- [ ] **Step 5: Run integration checks and commit.**

```bash
pnpm --filter @harmofin/api test:integration -- workspace-budget.integration.test.ts
pnpm --filter @harmofin/api test -- src/common/policies
pnpm --filter @harmofin/api typecheck
```

```bash
git add apps/api/src/workspaces apps/api/src/budgets apps/api/src/app.module.ts
git diff --cached --check
git commit -m "feat: add isolated workspace and budget api"
```

---

### Task 7: Nuxt API client, auth pages и protected app route

**Files:**
- Create: `apps/web/app/composables/useApiClient.ts`
- Create: `apps/web/app/composables/useAuth.ts`
- Create: `apps/web/app/components/auth/AuthForm.vue`
- Create: `apps/web/app/components/auth/FieldError.vue`
- Create: `apps/web/app/components/auth/PasswordField.vue`
- Create: `apps/web/app/layouts/auth.vue`
- Create: `apps/web/app/layouts/app.vue`
- Create: `apps/web/app/middleware/auth.ts`
- Create: `apps/web/app/pages/register.vue`
- Create: `apps/web/app/pages/login.vue`
- Create: `apps/web/app/pages/forgot-password.vue`
- Create: `apps/web/app/pages/reset-password.vue`
- Create: `apps/web/app/pages/app/index.vue`
- Create: `apps/web/app/composables/useApiClient.test.ts`
- Create: `apps/web/app/components/auth/AuthForm.test.ts`
- Modify: `apps/web/app/app.vue`
- Modify: `apps/web/nuxt.config.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- `useApiClient().request<T>(path: string, options?: RequestInit): Promise<T>` always uses `credentials: 'include'` and configured API URL.
- `useAuth().register/login/logout/requestRecovery/confirmRecovery` maps Problem Details to field errors and keeps CSRF token only in module/runtime memory.
- `auth` route middleware calls `/api/v1/me`; it redirects unauthenticated users to `/login`.

- [ ] **Step 1: Write failing web tests.**

Test API client fetch options include `credentials: 'include'`, configured origin and CSRF header only for mutations. Test `AuthForm` renders labels, password input, summary region, field error and disabled submit while loading. Test `useAuth` maps `fieldErrors` by field and generic `detail` to summary without writing `localStorage`.

- [ ] **Step 2: Implement API client and auth state.**

Use Nuxt `useRuntimeConfig().public.apiUrl`; do not add server secrets to `runtimeConfig.public`. For protected mutations call `GET /api/v1/auth/csrf`, retain returned raw CSRF value in a module ref, then send `X-CSRF-Token`. Do not read cookies from JavaScript. On `401`, middleware redirects; on `429`, show server detail and do not retry automatically.

- [ ] **Step 3: Implement accessible Russian forms and routes.**

Use native Vue inputs and explicit labels. `/register` posts email/password and optional workspace/budget names; `/login` posts credentials; `/forgot-password` shows the same success message for every email; `/reset-password` reads token from query for one submit, then replaces route without query; `/app` renders API user/workspace/budget names only. Add links between auth pages and `aria-live` summary for errors. Never put fake balances, fake users or fake operations in UI.

- [ ] **Step 4: Configure routes and run browser-independent checks.**

Set auth layout for public pages, app layout for `/app`, and middleware metadata. Preserve foundation `/` page until a later product navigation task; do not expose `/app` data in public SSR HTML. Run:

```bash
pnpm --filter @harmofin/web test
pnpm --filter @harmofin/web lint
pnpm --filter @harmofin/web typecheck
pnpm --filter @harmofin/web build
```

- [ ] **Step 5: Commit.**

```bash
git add apps/web
 git diff --cached --check
git commit -m "feat: add web authentication flow"
```

---

### Task 8: End-to-end security and migration acceptance suite

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/auth.spec.ts`
- Create: `e2e/fixtures.ts`
- Create: `apps/api/test/migration.integration.test.ts`
- Create: `apps/api/test/security.integration.test.ts`
- Modify: `package.json`
- Modify: `apps/api/vitest.integration.config.ts`

**Interfaces:**
- Root `test:e2e` runs Playwright against API `3001`, web `3000`, PostgreSQL `5432` and Mailpit `8025`.
- `e2e/auth.spec.ts` uses Mailpit HTTP API only to read the latest test email; it never reads `recovery_tokens` directly.
- Migration integration test runs `prisma migrate deploy` twice and asserts second run has no pending migration.

- [ ] **Step 1: Write migration and security acceptance tests.**

Migration test creates/uses blank test DB, runs deploy, inserts a demo row, runs deploy again, and asserts row/schema remains. Security test asserts cookie flags, CSRF/Origin failures, rate limit `429`, no secret fields in Problem Details, recovery digest differs from raw email token, cross-budget forged IDs return `404`, and role denial returns `403`.

- [ ] **Step 2: Implement deterministic integration isolation.**

Use `TEST_RUN_ID` in generated email addresses and names. Each test records created IDs and deletes only its own rows in child-to-parent order in `afterEach`; never issue `DROP DATABASE`, `TRUNCATE` or delete without a test-run predicate. Require `NODE_ENV=test` and a localhost/test database URL before cleanup.

- [ ] **Step 3: Configure Playwright web servers.**

Add root dev dependency `@playwright/test` and config with two web servers:

```ts
webServer: [
  { command: 'pnpm --filter @harmofin/api dev', url: 'http://127.0.0.1:3001/api/v1/health/live' },
  { command: 'pnpm --filter @harmofin/web dev', url: 'http://127.0.0.1:3000/' },
]
```

Set `baseURL` to `http://127.0.0.1:3000`, use one test project with Chromium, and use unique test email per worker.

- [ ] **Step 4: Implement E2E auth scenarios.**

`auth.spec.ts` covers registration and redirect to `/app`, login after logout, protected-route redirect, generic forgot-password response, Mailpit reset link extraction, reset-password success, old session invalidation, one-session revoke and all-session logout. Assert page has Russian labels, visible errors, no `localStorage` auth entries, and no financial fake values.

- [ ] **Step 5: Run focused acceptance.**

```bash
pnpm db:generate
pnpm db:migrate
pnpm --filter @harmofin/api test:integration
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

Expected: migration clean/existing checks, auth/security integration and browser flow pass against real services. Save no screenshots, tokens or Mailpit payloads in repository.

- [ ] **Step 6: Commit.**

```bash
git add e2e apps/api/test apps/api/vitest.integration.config.ts package.json
 git diff --cached --check
git commit -m "test: cover stage 1 auth and isolation"
```

---

### Task 9: Compose Mailpit, CI ordering, README and full verification

**Files:**
- Modify: `infra/compose/local.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `apps/api/package.json`
- Modify: `package.json` only if scripts require final wiring

**Interfaces:**
- `pnpm infra:up` starts PostgreSQL and Mailpit; `pnpm infra:down` stops them without deleting named volumes.
- README documents only verified `db:generate`, `db:migrate:dev`, `db:migrate`, `db:seed`, `test:integration` and `test:e2e` commands.
- CI runs database setup before schema-backed tests and uses no production secrets.

- [ ] **Step 1: Add Mailpit to local Compose.**

Keep PostgreSQL service unchanged and add a pinned Mailpit service using image `axllent/mailpit:v1.21.8`, SMTP port `1025`, UI/API port `8025`, healthcheck and no persistent production data volume. Expose only local ports. Validate image/service configuration with:

```bash
docker compose -f infra/compose/local.yml config --quiet
docker compose -f infra/compose/local.yml config --images
```

- [ ] **Step 2: Update CI services and environment.**

Add Mailpit service with SMTP/UI ports and health options. Add `AUTH_TOKEN_HASH_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `WEB_BASE_URL`, `SEED_DEMO_PASSWORD`, `API_PORT` and `WEB_ORIGIN` test values to job env. Keep secrets clearly test-only and do not use GitHub production secrets.

- [ ] **Step 3: Order CI steps exactly.**

After frozen install run `pnpm db:generate`; run format/lint/typecheck; run `pnpm db:migrate`; run `pnpm db:seed` twice; run `pnpm db:migrate` again; run unit tests, integration tests, OpenAPI validation, builds and Playwright; finish with Compose config validation. Ensure API and web test processes receive the same test env and no step invokes production seed.

- [ ] **Step 4: Update README only after command verification.**

Add Stage 1 status, local env fields, Mailpit UI `http://localhost:8025`, migration/seed instructions, auth URLs, protected API examples, integration/E2E prerequisites and exact security restrictions. State that email verification enforcement and financial domain remain outside this stage. Remove claims that Prisma/auth/migrations/E2E are absent; keep claims about accounts, categories, envelopes, operations and production deployment absent.

- [ ] **Step 5: Run full local gate.**

With local PostgreSQL and Mailpit healthy, run:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm db:migrate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
docker compose -f infra/compose/local.yml config --quiet
```

Check OpenAPI JSON includes `/api/v1/me`, every auth route and every workspace/budget route. Check git diff for secrets, raw tokens, cookies, passwords, financial payload, generated output and changes to `identity/logo_description.png`.

- [ ] **Step 6: Commit documentation and CI.**

```bash
git add infra/compose/local.yml .github/workflows/ci.yml README.md apps/api/package.json package.json
 git diff --cached --check
git commit -m "ci: verify stage 1 database and auth"
```

- [ ] **Step 7: Final status check.**

```bash
git diff --check
git status --short --untracked-files=all
git log --oneline --decorate -12
```

Expected: branch `main`, only intentionally committed Stage 1 files, no untracked generated artifacts or secrets, and no change to `identity/logo_description.png`.

---

## Plan Self-Review

- Schema coverage: Task 1 creates all seven approved tables, UUIDv7 IDs, FK/unique/check constraints, timestamps and first migration.
- Seed coverage: Task 1 covers deterministic demo user, workspace, OWNER membership, budget, safe audit event, production guard and idempotency.
- Auth coverage: Tasks 4–5 cover Argon2id, password policy, registration, login, logout, recovery TTL/consume/hash, password change, session rotation and session revocation.
- Authorization coverage: Tasks 3, 4 and 6 cover session guard, Origin/CSRF, OWNER/EDITOR/VIEWER policy and DB-level workspace/budget filtering.
- API coverage: Tasks 3, 5 and 6 cover `/api/v1`, Problem Details, field errors, OpenAPI, `/me`, auth routes and protected workspace/budget routes.
- Web coverage: Task 7 covers all four requested auth pages, protected `/app`, Russian accessible forms and no localStorage auth.
- Migration/CI coverage: Tasks 1, 8 and 9 cover blank/existing migration, repeated idempotent seed, real PostgreSQL, Mailpit and complete CI order.
- Security coverage: Tasks 2–5 and 8 cover cookie attributes, secret configuration, no sensitive logs/responses, CSRF, Origin, rate limiting, recovery digest and session invalidation.
- Scope check: no accounts, categories, envelopes, transactions, plans, notifications, analytics, exports or production deployment are added.
- Placeholder scan: no `TBD`, `TODO`, or unresolved implementation placeholder appears in this plan.
- Type consistency: interfaces for config, Prisma lifecycle, validation, sessions, email, repositories and web client are defined before their consumers.
