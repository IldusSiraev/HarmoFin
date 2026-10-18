# Удаление аккаунта — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пользователь удаляет аккаунт из настроек паролем; вход закрывается сразу, отмена возможна 30 дней по ссылке из письма, затем worker физически стирает данные.

**Architecture:** API — новый модуль `apps/api/src/account-deletion/` (controller → application service → repository) с двумя эндпоинтами `/api/v1/me/deletion` и `/api/v1/auth/deletion/cancel`; состояние в новой таблице `account_deletions` и новом статусе `UserStatus.PENDING_DELETION`. Worker — новое периодическое задание `PURGE_DELETED_ACCOUNTS`, удаляющее строки в порядке FK по образцу `docs/runbooks/budget-reset.sql` с защитной проверкой по `information_schema`. Web — под-страница настроек `/app/settings/delete-account` и публичные страницы `/account-deleted`, `/restore-account`.

**Tech Stack:** NestJS/Fastify, Prisma 6.19, PostgreSQL 18, Zod, Vitest (unit + integration), nodemailer, Nuxt 4/Vue 3.5, `@vue/test-utils`, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-18-account-deletion-design.md](../specs/2026-10-18-account-deletion-design.md)

## Global Constraints

- Окно отмены — ровно 30 дней: `purge_after = requested_at + 30 * 24 * 60 * 60 * 1000 мс`.
- Токен отмены — 32 случайных байта base64url (`TokenService.createRawToken`), в БД только HMAC-хеш (`TokenService.digest`), одноразовый.
- Миграция только добавляет: новые значения enum и новая таблица. Без `DROP`, без изменения существующих колонок.
- Каждая мутация — в одной транзакции БД; письмо отправляется после коммита, его сбой не откатывает удаление.
- Очистка затрагивает только рабочие пространства, где `workspaces.owner_id` = удаляемый пользователь; данные других пользователей не трогаются.
- В логах и аудите нет email, токенов, паролей и сумм.
- Тексты интерфейса и писем — русский; имена в коде — английские.
- Local Playwright не запускать; E2E-сценарий выполняется в CI.
- Не коммитить без явного разрешения владельца: шаг «Commit» выполняется только после его «да» (правило репозитория).

## Уточнения относительно спеки

Приняты при изучении кода, по существующим паттернам:

1. Неверный пароль → `422 CURRENT_PASSWORD_INVALID` с `fieldErrors[password]` (как `auth/password`), а не `400`.
2. Недействительный токен отмены → `422 ACCOUNT_RESTORE_TOKEN_INVALID` (как `INVALID_RECOVERY_TOKEN`), а не `400`.
3. Аудит — `entityType = 'auth'`, действия `ACCOUNT_DELETION_REQUESTED` / `ACCOUNT_DELETION_CANCELLED` (как `RECOVERY_REQUESTED`).
4. Частичный уникальный индекс «один открытый запрос на пользователя» не создаётся: Prisma 6 не описывает частичные индексы и `migrate dev` попытается его удалить. Инвариант держится атомарным `UPDATE users ... WHERE status = 'ACTIVE'` в начале транзакции.
5. Вместо диалога — под-страница `/app/settings/delete-account` по образцу `/app/settings/password` (паттерн хаба настроек).
6. Ссылка «Сначала выгрузите данные» ведёт на `/app/operations`, где находится существующий CSV-экспорт.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `prisma/schema.prisma` | enum-значения, модель `AccountDeletion` |
| `prisma/migrations/20261018000000_account_deletion/migration.sql` | аддитивная миграция |
| `apps/api/src/auth/email-sender.ts`, `smtp-email.sender.ts` (+ test) | письмо об удалении |
| `apps/api/src/auth/auth-http.ts` | общие HTTP-хелперы auth (вынесены из контроллера) |
| `apps/api/src/auth/auth.module.ts` | экспорт `TokenService`, `PasswordService`, `EMAIL_SENDER`, `AuthRateLimitGuard` |
| `apps/api/src/auth/auth-rate-limit.guard.ts` (+ test) | лимит на `/auth/deletion/cancel` |
| `apps/api/src/account-deletion/account-deletion.schemas.ts` | Zod-схемы запросов |
| `apps/api/src/account-deletion/account-deletion.dto.ts` | OpenAPI DTO |
| `apps/api/src/account-deletion/account-deletion.repository.ts` | весь доступ к БД модуля |
| `apps/api/src/account-deletion/account-deletion.application.service.ts` (+ test) | правила запроса и отмены |
| `apps/api/src/account-deletion/account-deletion.controller.ts` | HTTP |
| `apps/api/src/account-deletion/account-deletion.module.ts` | DI |
| `apps/api/src/app.module.ts` | регистрация модуля |
| `apps/worker/src/account-purge.ts` | SQL-очистка одного пользователя |
| `apps/worker/src/account-purge.handler.ts` (+ test) | выборка и транзакции очистки |
| `apps/worker/src/job.repository.ts`, `job-runner.ts` (+ test), `main.ts` | регистрация задания, суточный интервал |
| `apps/api/test/account-deletion.integration.test.ts` | API + очистка на реальной БД |
| `openapi.json` | регенерированный контракт |
| `apps/web/app/composables/useAuth.ts` (+ test) | клиентские методы |
| `apps/web/app/pages/app/settings/delete-account.vue` (+ test) | форма удаления |
| `apps/web/app/pages/app/settings/index.vue` (+ test) | строка в карточке «Аккаунт» |
| `apps/web/app/pages/account-deleted.vue` (+ test) | подтверждение после удаления |
| `apps/web/app/pages/restore-account.vue` (+ test) | отмена по токену |
| `e2e/account-deletion.spec.ts` | CI-сценарий |
| `docs/superpowers/specs/2026-08-30-family-budget-development-spec.md`, `docs/runbooks/account-data-request.md` | документация |

---

### Task 1: Миграция и Prisma-модель

**Files:**
- Modify: `prisma/schema.prisma` (enum `UserStatus` строки 10-14, `SessionRevokeReason` 16-23, `WorkerJobType` 153-156; новая модель после `RecoveryToken`)
- Create: `prisma/migrations/20261018000000_account_deletion/migration.sql`

**Interfaces:**
- Produces: Prisma-модель `AccountDeletion` (`prisma.accountDeletion`), поля `id, userId, requestedAt, purgeAfter, restoreTokenHash, archivedWorkspaceIds: string[], archivedBudgetIds: string[], deactivatedMembershipIds: string[], restoredAt, purgedAt`; enum-значения `UserStatus.PENDING_DELETION`, `SessionRevokeReason.ACCOUNT_DELETED`, `WorkerJobType.PURGE_DELETED_ACCOUNTS`.

- [ ] **Step 1: Дополнить enum в `prisma/schema.prisma`**

```prisma
enum UserStatus {
  ACTIVE
  LOCKED
  PENDING_DELETION
  DELETED
}

enum SessionRevokeReason {
  LOGOUT
  PASSWORD_CHANGED
  PASSWORD_RESET
  ALL_SESSIONS_REVOKED
  ROTATED
  ADMIN_REVOKED
  ACCOUNT_DELETED
}
```

```prisma
enum WorkerJobType {
  MATERIALIZE_PLAN_OCCURRENCES
  EVALUATE_BUDGET_NOTIFICATIONS
  PURGE_DELETED_ACCOUNTS
}
```

- [ ] **Step 2: Добавить модель после `model RecoveryToken { ... }`**

```prisma
// No FK to users: the row is the non-personal trace of a deletion and must outlive the purge.
model AccountDeletion {
  id                       String    @id @db.Uuid
  userId                   String    @map("user_id") @db.Uuid
  requestedAt              DateTime  @map("requested_at") @db.Timestamptz(3)
  purgeAfter               DateTime  @map("purge_after") @db.Timestamptz(3)
  restoreTokenHash         String    @unique @map("restore_token_hash") @db.Char(64)
  archivedWorkspaceIds     String[]  @default([]) @map("archived_workspace_ids") @db.Uuid
  archivedBudgetIds        String[]  @default([]) @map("archived_budget_ids") @db.Uuid
  deactivatedMembershipIds String[]  @default([]) @map("deactivated_membership_ids") @db.Uuid
  restoredAt               DateTime? @map("restored_at") @db.Timestamptz(3)
  purgedAt                 DateTime? @map("purged_at") @db.Timestamptz(3)

  @@index([purgedAt, restoredAt, purgeAfter])
  @@index([userId])
  @@map("account_deletions")
}
```

- [ ] **Step 3: Написать миграцию `prisma/migrations/20261018000000_account_deletion/migration.sql`**

```sql
-- Additive only: new enum values and a new table.
ALTER TYPE "UserStatus" ADD VALUE 'PENDING_DELETION';
ALTER TYPE "SessionRevokeReason" ADD VALUE 'ACCOUNT_DELETED';
ALTER TYPE "WorkerJobType" ADD VALUE 'PURGE_DELETED_ACCOUNTS';

CREATE TABLE "account_deletions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "purge_after" TIMESTAMPTZ(3) NOT NULL,
    "restore_token_hash" CHAR(64) NOT NULL,
    "archived_workspace_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "archived_budget_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "deactivated_membership_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "restored_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "account_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_deletions_restore_token_hash_key" ON "account_deletions"("restore_token_hash");
CREATE INDEX "account_deletions_purged_at_restored_at_purge_after_idx" ON "account_deletions"("purged_at", "restored_at", "purge_after");
CREATE INDEX "account_deletions_user_id_idx" ON "account_deletions"("user_id");
```

- [ ] **Step 4: Применить к локальной БД и сгенерировать клиент**

Run: `pnpm infra:up && pnpm db:migrate && pnpm db:generate`
Expected: `1 migration found ... applied`, `Generated Prisma Client`.

- [ ] **Step 5: Проверить, что схема и миграции совпадают**

Run: `pnpm --filter @harmofin/api exec prisma migrate diff --from-schema-datasource ../../prisma/schema.prisma --to-schema-datamodel ../../prisma/schema.prisma --exit-code`
Expected: `No difference detected.`, exit code 0. Если diff предлагает изменить массивы (`NOT NULL`/default) — привести SQL миграции к тому, что выдаёт `prisma migrate diff --from-empty`, не меняя смысла.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit (после разрешения владельца)**

```bash
git add prisma/schema.prisma prisma/migrations/20261018000000_account_deletion
git commit -m "feat(db): статус PENDING_DELETION и таблица account_deletions"
```

---

### Task 2: Письмо о запланированном удалении

**Files:**
- Modify: `apps/api/src/auth/email-sender.ts`
- Modify: `apps/api/src/auth/smtp-email.sender.ts`
- Test: `apps/api/src/auth/smtp-email.sender.test.ts` (create)

**Interfaces:**
- Produces: `EmailSender.sendAccountDeletionScheduled(input: { recipient: string; restoreUrl: string; purgeDateLabel: string }): Promise<void>`.

- [ ] **Step 1: Написать падающий тест `apps/api/src/auth/smtp-email.sender.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

import { SmtpEmailSender } from './smtp-email.sender.js';

const config = {
  mail: { smtpHost: '127.0.0.1', smtpPort: 1025, from: 'no-reply@harmofin.test' },
} as never;

describe('SmtpEmailSender', () => {
  it('sends the deletion notice with the purge date and restore link', async () => {
    await new SmtpEmailSender(config).sendAccountDeletionScheduled({
      recipient: 'owner@harmofin.test',
      restoreUrl: 'http://localhost:3000/restore-account?token=abc',
      purgeDateLabel: '17.11.2026',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@harmofin.test',
        to: 'owner@harmofin.test',
        subject: 'Аккаунт HarmoFin будет удалён',
      }),
    );
    const text = (sendMail.mock.calls[0]![0] as { text: string }).text;
    expect(text).toContain('17.11.2026');
    expect(text).toContain('http://localhost:3000/restore-account?token=abc');
    expect(text).toContain('Если это были не вы');
  });
});
```

- [ ] **Step 2: Запустить — тест падает**

Run: `pnpm --filter @harmofin/api exec vitest run src/auth/smtp-email.sender.test.ts`
Expected: FAIL — `sendAccountDeletionScheduled is not a function`.

- [ ] **Step 3: Расширить интерфейс `apps/api/src/auth/email-sender.ts`**

```ts
export interface EmailSender {
  sendPasswordRecovery(input: { recipient: string; resetUrl: string }): Promise<void>;
  sendAccountDeletionScheduled(input: {
    recipient: string;
    restoreUrl: string;
    purgeDateLabel: string;
  }): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
```

- [ ] **Step 4: Реализовать в `apps/api/src/auth/smtp-email.sender.ts` (после `sendPasswordRecovery`)**

```ts
  async sendAccountDeletionScheduled(input: {
    recipient: string;
    restoreUrl: string;
    purgeDateLabel: string;
  }): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.mail.from,
      to: input.recipient,
      subject: 'Аккаунт HarmoFin будет удалён',
      text: [
        `Вход в аккаунт закрыт. ${input.purgeDateLabel} аккаунт и все данные бюджета будут удалены безвозвратно.`,
        `Чтобы отменить удаление, откройте ссылку до этой даты: ${input.restoreUrl}`,
        'Если это были не вы — отмените удаление и сразу смените пароль.',
      ].join('\n\n'),
    });
  }
```

- [ ] **Step 5: Тест проходит**

Run: `pnpm --filter @harmofin/api exec vitest run src/auth/smtp-email.sender.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit (после разрешения владельца)**

```bash
git add apps/api/src/auth/email-sender.ts apps/api/src/auth/smtp-email.sender.ts apps/api/src/auth/smtp-email.sender.test.ts
git commit -m "feat(api): письмо о запланированном удалении аккаунта"
```

---

### Task 3: Запрос удаления — `POST /api/v1/me/deletion`

**Files:**
- Create: `apps/api/src/auth/auth-http.ts`
- Modify: `apps/api/src/auth/auth.controller.ts` (удалить локальные `requestMeta`, `requiredContext`, `cookieOptions` строки 271-291, импортировать из `auth-http.ts`)
- Modify: `apps/api/src/auth/auth.module.ts` (exports)
- Create: `apps/api/src/account-deletion/account-deletion.schemas.ts`
- Create: `apps/api/src/account-deletion/account-deletion.dto.ts`
- Create: `apps/api/src/account-deletion/account-deletion.repository.ts`
- Create: `apps/api/src/account-deletion/account-deletion.application.service.ts`
- Create: `apps/api/src/account-deletion/account-deletion.controller.ts`
- Create: `apps/api/src/account-deletion/account-deletion.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/account-deletion/account-deletion.application.service.test.ts`
- Test: `apps/api/test/account-deletion.integration.test.ts`

**Interfaces:**
- Consumes: `prisma.accountDeletion` (Task 1), `EmailSender.sendAccountDeletionScheduled` (Task 2), `PasswordService.verify(hash, password): Promise<boolean>`, `TokenService.createRawToken()`, `TokenService.digest(raw)`.
- Produces: `ACCOUNT_DELETION_GRACE_MS = 2_592_000_000`; `AccountDeletionApplicationService.requestDeletion(userId: string, input: { password: string }, meta: { requestId?: string }): Promise<{ purgeAfter: Date }>`; `AccountDeletionRepository` (методы ниже, Task 4 добавит свои); HTTP `POST /api/v1/me/deletion` → `202 { purgeAfter: string }`.

- [ ] **Step 1: Вынести HTTP-хелперы в `apps/api/src/auth/auth-http.ts`**

```ts
import type { FastifyRequest } from 'fastify';

import type { RequestContext } from '../common/request-context/request-context.js';
import type { ApiConfig } from '../config/env.js';
import type { RequestMeta } from './auth.application.service.js';

export type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

export function requestMeta(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
    ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
  };
}

export function requiredContext(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}

export function cookieOptions(config: ApiConfig) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.nodeEnv === 'production',
    path: '/',
  };
}
```

В `auth.controller.ts` удалить `type AuthenticatedRequest = ...` и три функции в конце файла, добавить:

```ts
import { cookieOptions, requestMeta, requiredContext, type AuthenticatedRequest } from './auth-http.js';
```

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api exec vitest run src/auth`
Expected: PASS (поведение не изменилось).

- [ ] **Step 2: Экспортировать зависимости из `AuthModule`**

В `apps/api/src/auth/auth.module.ts` заменить строку `exports`:

```ts
      exports: [
        API_CONFIG,
        SessionAuthGuard,
        CsrfGuard,
        SessionService,
        AuthApplicationService,
        TokenService,
        PasswordService,
        EMAIL_SENDER,
        AuthRateLimitGuard,
      ],
```

- [ ] **Step 3: Zod-схемы `apps/api/src/account-deletion/account-deletion.schemas.ts`**

```ts
import { z } from 'zod';

export const requestDeletionSchema = z.object({ password: z.string().min(1).max(128) }).strict();

export const cancelDeletionSchema = z.object({ token: z.string().min(1).max(256) }).strict();

export type RequestDeletionInput = z.output<typeof requestDeletionSchema>;
export type CancelDeletionInput = z.output<typeof cancelDeletionSchema>;
```

- [ ] **Step 4: DTO `apps/api/src/account-deletion/account-deletion.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';

export class RequestAccountDeletionRequest {
  @ApiProperty({ type: String, format: 'password', minLength: 1, maxLength: 128 })
  password!: string;
}

export class AccountDeletionScheduledResponse {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Момент, после которого данные будут удалены безвозвратно.',
  })
  purgeAfter!: string;
}

export class CancelAccountDeletionRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 256 })
  token!: string;
}
```

- [ ] **Step 5: Repository `apps/api/src/account-deletion/account-deletion.repository.ts` (методы запроса)**

```ts
import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export type Tx = Prisma.TransactionClient;

export interface OwnedWorkspace {
  id: string;
  timezone: string;
  activeBudgetIds: string[];
  otherActiveMemberCount: number;
}

export class AccountDeletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  findUserCredentials(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true, status: true },
    });
  }

  /** Atomic ACTIVE → PENDING_DELETION; false when another request already won. */
  async claimActiveUser(tx: Tx, userId: string): Promise<boolean> {
    const result = await tx.user.updateMany({
      where: { id: userId, status: 'ACTIVE' },
      data: { status: 'PENDING_DELETION' },
    });
    return result.count === 1;
  }

  async findOwnedActiveWorkspaces(tx: Tx, userId: string): Promise<OwnedWorkspace[]> {
    const workspaces = await tx.workspace.findMany({
      where: { ownerId: userId, status: 'ACTIVE' },
      select: {
        id: true,
        timezone: true,
        budgets: { where: { status: 'ACTIVE' }, select: { id: true } },
        memberships: {
          where: { isActive: true, userId: { not: userId } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return workspaces.map((workspace) => ({
      id: workspace.id,
      timezone: workspace.timezone,
      activeBudgetIds: workspace.budgets.map((budget) => budget.id),
      otherActiveMemberCount: workspace.memberships.length,
    }));
  }

  async archiveScope(tx: Tx, workspaceIds: string[], budgetIds: string[]): Promise<void> {
    if (budgetIds.length > 0)
      await tx.budget.updateMany({ where: { id: { in: budgetIds } }, data: { status: 'ARCHIVED' } });
    if (workspaceIds.length > 0)
      await tx.workspace.updateMany({
        where: { id: { in: workspaceIds } },
        data: { status: 'ARCHIVED' },
      });
  }

  /** Deactivates the user's memberships in workspaces they do not own; returns their ids. */
  async deactivateForeignMemberships(
    tx: Tx,
    userId: string,
    ownedWorkspaceIds: string[],
    now: Date,
  ): Promise<string[]> {
    const memberships = await tx.workspaceMembership.findMany({
      where: { userId, isActive: true, workspaceId: { notIn: ownedWorkspaceIds } },
      select: { id: true },
    });
    const ids = memberships.map((membership) => membership.id);
    if (ids.length > 0)
      await tx.workspaceMembership.updateMany({
        where: { id: { in: ids } },
        data: { isActive: false, removedAt: now },
      });
    return ids;
  }

  async revokeCredentials(tx: Tx, userId: string, now: Date): Promise<void> {
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'ACCOUNT_DELETED' },
    });
    await tx.recoveryToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
  }

  async createDeletion(
    tx: Tx,
    input: {
      userId: string;
      requestedAt: Date;
      purgeAfter: Date;
      restoreTokenHash: string;
      archivedWorkspaceIds: string[];
      archivedBudgetIds: string[];
      deactivatedMembershipIds: string[];
    },
  ): Promise<void> {
    await tx.accountDeletion.create({ data: { id: createUuidV7(input.requestedAt), ...input } });
  }

  async audit(
    tx: Tx,
    input: {
      userId: string;
      workspaceId: string | null;
      action: 'ACCOUNT_DELETION_REQUESTED' | 'ACCOUNT_DELETION_CANCELLED';
      purgeAfter: Date;
      requestId?: string;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: input.userId,
        workspaceId: input.workspaceId,
        entityType: 'auth',
        entityId: input.userId,
        action: input.action,
        newValues: { purgeAfter: input.purgeAfter.toISOString() },
        source: 'API',
        requestId: input.requestId ?? null,
      },
    });
  }
}
```

- [ ] **Step 6: Написать падающий unit-тест сервиса `apps/api/src/account-deletion/account-deletion.application.service.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_DELETION_GRACE_MS,
  AccountDeletionApplicationService,
} from './account-deletion.application.service.js';

const NOW = new Date('2026-10-18T09:00:00.000Z');

function setup(overrides: { passwordOk?: boolean; otherMembers?: number; claimed?: boolean } = {}) {
  const tx = {};
  const repository = {
    transaction: vi.fn((callback: (t: unknown) => unknown) => callback(tx)),
    findUserCredentials: vi.fn().mockResolvedValue({
      id: 'u1',
      email: 'owner@harmofin.test',
      passwordHash: 'hash',
      status: 'ACTIVE',
    }),
    claimActiveUser: vi.fn().mockResolvedValue(overrides.claimed ?? true),
    findOwnedActiveWorkspaces: vi.fn().mockResolvedValue([
      {
        id: 'w1',
        timezone: 'Europe/Moscow',
        activeBudgetIds: ['b1'],
        otherActiveMemberCount: overrides.otherMembers ?? 0,
      },
    ]),
    deactivateForeignMemberships: vi.fn().mockResolvedValue(['m9']),
    archiveScope: vi.fn().mockResolvedValue(undefined),
    revokeCredentials: vi.fn().mockResolvedValue(undefined),
    createDeletion: vi.fn().mockResolvedValue(undefined),
    audit: vi.fn().mockResolvedValue(undefined),
  };
  const passwordService = { verify: vi.fn().mockResolvedValue(overrides.passwordOk ?? true) };
  const tokenService = { createRawToken: () => 'raw-token', digest: (raw: string) => `hash:${raw}` };
  const emailSender = {
    sendPasswordRecovery: vi.fn(),
    sendAccountDeletionScheduled: vi.fn().mockResolvedValue(undefined),
  };
  const config = { mail: { webBaseUrl: 'http://localhost:3000' } };
  const service = new AccountDeletionApplicationService(
    repository as never,
    passwordService as never,
    tokenService as never,
    emailSender as never,
    config as never,
    () => NOW,
  );
  return { service, repository, emailSender };
}

describe('AccountDeletionApplicationService.requestDeletion', () => {
  it('schedules the purge 30 days ahead, archives owned scope and mails the restore link', async () => {
    const { service, repository, emailSender } = setup();

    const result = await service.requestDeletion('u1', { password: 'correct-password' }, {});

    const purgeAfter = new Date(NOW.getTime() + ACCOUNT_DELETION_GRACE_MS);
    expect(result).toEqual({ purgeAfter });
    expect(repository.archiveScope).toHaveBeenCalledWith(expect.anything(), ['w1'], ['b1']);
    expect(repository.revokeCredentials).toHaveBeenCalledWith(expect.anything(), 'u1', NOW);
    expect(repository.createDeletion).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      requestedAt: NOW,
      purgeAfter,
      restoreTokenHash: 'hash:raw-token',
      archivedWorkspaceIds: ['w1'],
      archivedBudgetIds: ['b1'],
      deactivatedMembershipIds: ['m9'],
    });
    expect(emailSender.sendAccountDeletionScheduled).toHaveBeenCalledWith({
      recipient: 'owner@harmofin.test',
      restoreUrl: 'http://localhost:3000/restore-account?token=raw-token',
      purgeDateLabel: '17.11.2026',
    });
  });

  it('rejects a wrong password with a field error and changes nothing', async () => {
    const { service, repository } = setup({ passwordOk: false });

    await expect(service.requestDeletion('u1', { password: 'wrong' }, {})).rejects.toMatchObject({
      response: {
        code: 'CURRENT_PASSWORD_INVALID',
        fieldErrors: [expect.objectContaining({ field: 'password' })],
      },
    });
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it('refuses when an owned workspace has other active members', async () => {
    const { service, repository } = setup({ otherMembers: 1 });

    await expect(
      service.requestDeletion('u1', { password: 'correct-password' }, {}),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_DELETION_HAS_MEMBERS' } });
    expect(repository.createDeletion).not.toHaveBeenCalled();
  });

  it('treats a lost race (user no longer ACTIVE) as an invalid session', async () => {
    const { service } = setup({ claimed: false });

    await expect(
      service.requestDeletion('u1', { password: 'correct-password' }, {}),
    ).rejects.toMatchObject({ response: { code: 'SESSION_INVALID' } });
  });

  it('keeps the deletion when the email cannot be sent', async () => {
    const { service, emailSender } = setup();
    emailSender.sendAccountDeletionScheduled.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.requestDeletion('u1', { password: 'correct-password' }, {}),
    ).resolves.toEqual({ purgeAfter: new Date(NOW.getTime() + ACCOUNT_DELETION_GRACE_MS) });
  });
});
```

- [ ] **Step 7: Запустить — тест падает**

Run: `pnpm --filter @harmofin/api exec vitest run src/account-deletion`
Expected: FAIL — модуль `account-deletion.application.service.js` не найден.

- [ ] **Step 8: Сервис `apps/api/src/account-deletion/account-deletion.application.service.ts`**

```ts
import {
  ConflictException,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { PasswordService } from '../auth/password.service.js';
import type { TokenService } from '../auth/token.service.js';
import type { EmailSender } from '../auth/email-sender.js';
import type { ApiConfig } from '../config/env.js';
import type { RequestDeletionInput } from './account-deletion.schemas.js';
import type { AccountDeletionRepository } from './account-deletion.repository.js';

export const ACCOUNT_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1_000;

export class AccountDeletionApplicationService {
  private readonly logger = new Logger('AccountDeletion');

  constructor(
    private readonly repository: AccountDeletionRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly emailSender: EmailSender,
    private readonly config: Pick<ApiConfig, 'mail'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async requestDeletion(
    userId: string,
    input: RequestDeletionInput,
    meta: { requestId?: string },
  ): Promise<{ purgeAfter: Date }> {
    const user = await this.repository.findUserCredentials(userId);
    if (!user || user.status !== 'ACTIVE') throw sessionInvalid();
    if (!(await this.passwordService.verify(user.passwordHash, input.password)))
      throw passwordInvalid();

    const rawToken = this.tokenService.createRawToken();
    const now = this.clock();
    const purgeAfter = new Date(now.getTime() + ACCOUNT_DELETION_GRACE_MS);

    const timezone = await this.repository.transaction(async (tx) => {
      if (!(await this.repository.claimActiveUser(tx, userId))) throw sessionInvalid();
      const owned = await this.repository.findOwnedActiveWorkspaces(tx, userId);
      if (owned.some((workspace) => workspace.otherActiveMemberCount > 0)) throw hasMembers();

      const workspaceIds = owned.map((workspace) => workspace.id);
      const budgetIds = owned.flatMap((workspace) => workspace.activeBudgetIds);
      const membershipIds = await this.repository.deactivateForeignMemberships(
        tx,
        userId,
        workspaceIds,
        now,
      );
      await this.repository.archiveScope(tx, workspaceIds, budgetIds);
      await this.repository.revokeCredentials(tx, userId, now);
      await this.repository.createDeletion(tx, {
        userId,
        requestedAt: now,
        purgeAfter,
        restoreTokenHash: this.tokenService.digest(rawToken),
        archivedWorkspaceIds: workspaceIds,
        archivedBudgetIds: budgetIds,
        deactivatedMembershipIds: membershipIds,
      });
      await this.repository.audit(tx, {
        userId,
        workspaceId: workspaceIds[0] ?? null,
        action: 'ACCOUNT_DELETION_REQUESTED',
        purgeAfter,
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      });
      return owned[0]?.timezone ?? 'Europe/Moscow';
    });

    const restoreUrl = new URL('/restore-account', this.config.mail.webBaseUrl);
    restoreUrl.searchParams.set('token', rawToken);
    try {
      await this.emailSender.sendAccountDeletionScheduled({
        recipient: user.email,
        restoreUrl: restoreUrl.toString(),
        purgeDateLabel: formatDate(purgeAfter, timezone),
      });
    } catch (error) {
      // The deletion is committed; the operator can resend the link (runbook).
      this.logger.warn({
        event: 'account_deletion_email_failed',
        userId,
        errorName: error instanceof Error ? error.name : 'Unknown',
      });
    }
    return { purgeAfter };
  }
}

function formatDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
}

function sessionInvalid(): UnauthorizedException {
  return new UnauthorizedException({ code: 'SESSION_INVALID', detail: 'Сессия недействительна.' });
}

function passwordInvalid(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'CURRENT_PASSWORD_INVALID',
    detail: 'Пароль неверен.',
    fieldErrors: [{ field: 'password', message: 'Пароль неверен.', code: 'invalid' }],
  });
}

function hasMembers(): ConflictException {
  return new ConflictException({
    code: 'ACCOUNT_DELETION_HAS_MEMBERS',
    detail: 'В бюджете есть другие участники. Сначала отключите их доступ.',
  });
}
```

- [ ] **Step 9: Unit-тест проходит**

Run: `pnpm --filter @harmofin/api exec vitest run src/account-deletion`
Expected: PASS (5 тестов).

- [ ] **Step 10: Controller `apps/api/src/account-deletion/account-deletion.controller.ts`**

```ts
import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBody, ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { cookieOptions, requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { API_CONFIG } from '../common/security/security.constants.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import type { ApiConfig } from '../config/env.js';
import { AccountDeletionApplicationService } from './account-deletion.application.service.js';
import {
  AccountDeletionScheduledResponse,
  RequestAccountDeletionRequest,
} from './account-deletion.dto.js';
import { requestDeletionSchema, type RequestDeletionInput } from './account-deletion.schemas.js';

@ApiTags('auth')
@Controller()
export class AccountDeletionController {
  constructor(
    @Inject(AccountDeletionApplicationService)
    private readonly service: AccountDeletionApplicationService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post('me/deletion')
  @HttpCode(202)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiBody({ type: RequestAccountDeletionRequest })
  @ApiAcceptedResponse({ type: AccountDeletionScheduledResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async requestDeletion(
    @Body(new ZodValidationPipe(requestDeletionSchema)) input: RequestDeletionInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AccountDeletionScheduledResponse> {
    const context = requiredContext(request);
    const meta = requestMeta(request);
    const result = await this.service.requestDeletion(context.userId, input, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
    reply.clearCookie(this.config.auth.cookieName, cookieOptions(this.config));
    return { purgeAfter: result.purgeAfter.toISOString() };
  }
}
```

- [ ] **Step 11: Module `apps/api/src/account-deletion/account-deletion.module.ts` и регистрация**

```ts
import { type DynamicModule, Module } from '@nestjs/common';

import { EMAIL_SENDER, type EmailSender } from '../auth/email-sender.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { AccountDeletionApplicationService } from './account-deletion.application.service.js';
import { AccountDeletionController } from './account-deletion.controller.js';
import { AccountDeletionRepository } from './account-deletion.repository.js';

@Module({})
export class AccountDeletionModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AccountDeletionModule,
      controllers: [AccountDeletionController],
      providers: [
        {
          provide: AccountDeletionApplicationService,
          useFactory: (
            prisma: PrismaService,
            password: PasswordService,
            tokens: TokenService,
            emailSender: EmailSender,
          ) =>
            new AccountDeletionApplicationService(
              new AccountDeletionRepository(prisma),
              password,
              tokens,
              emailSender,
              config,
            ),
          inject: [PrismaService, PasswordService, TokenService, EMAIL_SENDER],
        },
      ],
    };
  }
}
```

В `apps/api/src/app.module.ts`: импорт `import { AccountDeletionModule } from './account-deletion/account-deletion.module.js';` и строка `AccountDeletionModule.register(config),` сразу после `AuthModule.register(config),`.

- [ ] **Step 12: Написать интеграционный тест `apps/api/test/account-deletion.integration.test.ts` (часть «запрос»)**

```ts
import { createHmac, randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const tokenSecret = 'test-only-secret-with-at-least-32-bytes';
const DAY_MS = 86_400_000;

type Fixture = { email: string; userId: string; workspaceId: string; budgetId: string; cookie: string; csrfToken: string };

let app: NestFastifyApplication;
let server: FastifyInstance;
const createdUserIds: string[] = [];

function digest(raw: string): string {
  return createHmac('sha256', tokenSecret).update(raw).digest('hex');
}

async function register(prefix: string): Promise<Fixture> {
  const email = `${prefix}-${randomUUID()}@harmofin.test`;
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ user: { id: string }; workspace: { id: string }; budget: { id: string }; csrfToken: string }>();
  const setCookieRaw = response.headers['set-cookie'];
  const setCookie = Array.isArray(setCookieRaw) ? setCookieRaw.join('; ') : (setCookieRaw ?? '');
  const cookie = decodeURIComponent(/harmofin_session=([^;]+)/.exec(setCookie)?.[1] ?? '');
  createdUserIds.push(body.user.id);
  return { email, userId: body.user.id, workspaceId: body.workspace.id, budgetId: body.budget.id, cookie, csrfToken: body.csrfToken };
}

function requestDeletion(fixture: Fixture, body: object, withCsrf = true) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/me/deletion',
    headers: {
      origin,
      cookie: `harmofin_session=${encodeURIComponent(fixture.cookie)}`,
      ...(withCsrf ? { 'x-csrf-token': fixture.csrfToken } : {}),
    },
    payload: body,
  });
}

function login(fixture: Fixture) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email: fixture.email, password },
  });
}

describe('account deletion', () => {
  beforeAll(async () => {
    app = await createApiApp(
      loadApiConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: origin,
        AUTH_TOKEN_HASH_SECRET: tokenSecret,
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        MAIL_FROM: 'no-reply@harmofin.test',
        WEB_BASE_URL: origin,
        LOG_LEVEL: 'silent',
      }),
    );
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();
  });

  afterAll(async () => {
    // Purged users have no data left; the purge itself is the cleanup for everyone else.
    const { purgeUserData } = await import('../../worker/src/account-purge.js');
    for (const userId of createdUserIds) {
      await prisma.$transaction((tx) => purgeUserData(tx, userId), { timeout: 60_000 });
      await prisma.accountDeletion.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('documents both endpoints in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
    }>();
    expect(document.paths['/api/v1/me/deletion']).toMatchObject({ post: expect.any(Object) });
    expect(document.paths['/api/v1/auth/deletion/cancel']).toMatchObject({ post: expect.any(Object) });
  });

  it('rejects a wrong password with a field error and keeps the account', async () => {
    const fixture = await register('del-wrong');
    const response = await requestDeletion(fixture, { password: 'wrong-password-10' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'CURRENT_PASSWORD_INVALID',
      fieldErrors: [expect.objectContaining({ field: 'password' })],
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe('ACTIVE');
  });

  it('requires CSRF', async () => {
    const fixture = await register('del-csrf');
    const response = await requestDeletion(fixture, { password }, false);

    expect(response.statusCode).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe('ACTIVE');
  });

  it('refuses while an owned workspace has another active member', async () => {
    const owner = await register('del-owner');
    const member = await register('del-member');
    await prisma.workspaceMembership.create({
      data: { id: randomUUID(), workspaceId: owner.workspaceId, userId: member.userId, role: 'EDITOR' },
    });

    const response = await requestDeletion(owner, { password });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ACCOUNT_DELETION_HAS_MEMBERS' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).status).toBe('ACTIVE');
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: owner.workspaceId, userId: member.userId } });
  });

  it('closes access at once and schedules the purge in 30 days', async () => {
    const fixture = await register('del-ok');
    const before = Date.now();
    const response = await requestDeletion(fixture, { password });

    expect(response.statusCode).toBe(202);
    const purgeAfter = new Date(response.json<{ purgeAfter: string }>().purgeAfter).getTime();
    expect(purgeAfter).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(purgeAfter).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);
    expect(String(response.headers['set-cookie'])).toMatch(/harmofin_session=;/);

    const me = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `harmofin_session=${encodeURIComponent(fixture.cookie)}` },
    });
    expect(me.statusCode).toBe(401);
    expect((await login(fixture)).statusCode).toBe(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
    expect(user.status).toBe('PENDING_DELETION');
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: fixture.workspaceId } })).status).toBe('ARCHIVED');
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: fixture.budgetId } })).status).toBe('ARCHIVED');
    expect(await prisma.session.count({ where: { userId: fixture.userId, revokedAt: null } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: fixture.userId, revokedReason: 'ACCOUNT_DELETED' } })).toBeGreaterThan(0);
    const deletion = await prisma.accountDeletion.findFirstOrThrow({ where: { userId: fixture.userId } });
    expect(deletion).toMatchObject({ archivedWorkspaceIds: [fixture.workspaceId], archivedBudgetIds: [fixture.budgetId], restoredAt: null, purgedAt: null });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { actorUserId: fixture.userId, action: 'ACCOUNT_DELETION_REQUESTED' } });
    expect(JSON.stringify(audit.newValues)).not.toContain(fixture.email);
  });
});
```

`afterAll` импортирует `purgeUserData` из Task 5; до Task 5 временно заменить тело цикла `afterAll` на удаление `accountDeletion` и пропуск остального — в Task 5 Step 1 вернуть код выше.

- [ ] **Step 13: Запустить интеграционный тест**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/account-deletion.integration.test.ts -t "wrong password|CSRF|another active member|closes access"`
Expected: PASS (4 теста). Тест OpenAPI упадёт до Task 4 — это ожидаемо.

- [ ] **Step 14: Typecheck и lint**

Run: `pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Expected: PASS.

- [ ] **Step 15: Commit (после разрешения владельца)**

```bash
git add apps/api/src/auth/auth-http.ts apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.module.ts apps/api/src/account-deletion apps/api/src/app.module.ts apps/api/test/account-deletion.integration.test.ts
git commit -m "feat(api): запрос удаления аккаунта с отложенной очисткой"
```

---

### Task 4: Отмена удаления — `POST /api/v1/auth/deletion/cancel`

**Files:**
- Modify: `apps/api/src/account-deletion/account-deletion.repository.ts`
- Modify: `apps/api/src/account-deletion/account-deletion.application.service.ts`
- Modify: `apps/api/src/account-deletion/account-deletion.controller.ts`
- Modify: `apps/api/src/auth/auth-rate-limit.guard.ts`
- Test: `apps/api/src/auth/auth-rate-limit.guard.test.ts`
- Test: `apps/api/src/account-deletion/account-deletion.application.service.test.ts`
- Test: `apps/api/test/account-deletion.integration.test.ts`

**Interfaces:**
- Consumes: `AccountDeletionRepository.transaction`, `.audit` (Task 3).
- Produces: `AccountDeletionApplicationService.cancelDeletion(input: { token: string }, meta: { requestId?: string }): Promise<void>`; HTTP `POST /api/v1/auth/deletion/cancel` → `204`.

- [ ] **Step 1: Падающий тест лимита в `apps/api/src/auth/auth-rate-limit.guard.test.ts` (внутри `describe`)**

```ts
  it('limits account restore attempts with the recovery budget', () => {
    const guard = new AuthRateLimitGuard({
      rateLimit: { windowSeconds: 900, loginMax: 5, recoveryMax: 1 },
    } as never);
    const context = contextFor({
      method: 'POST',
      url: '/api/v1/auth/deletion/cancel',
      ip: '127.0.0.1',
    });

    expect(guard.canActivate(context)).toBe(true);
    expectRateLimited(() => guard.canActivate(context));
  });
```

Run: `pnpm --filter @harmofin/api exec vitest run src/auth/auth-rate-limit.guard.test.ts`
Expected: FAIL.

- [ ] **Step 2: Добавить путь в `maximumFor`**

```ts
  private maximumFor(url: string): number | null {
    if (url.startsWith('/api/v1/auth/login')) return this.config.rateLimit.loginMax;
    if (url.startsWith('/api/v1/auth/recovery/request')) return this.config.rateLimit.recoveryMax;
    if (url.startsWith('/api/v1/auth/deletion/cancel')) return this.config.rateLimit.recoveryMax;
    return null;
  }
```

Run: та же команда. Expected: PASS.

- [ ] **Step 3: Методы отмены в repository (добавить в класс)**

```ts
  /** Locks the open, not yet expired request matching the token hash. */
  async lockOpenDeletionByTokenHash(tx: Tx, tokenHash: string, now: Date) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        userId: string;
        purgeAfter: Date;
        archivedWorkspaceIds: string[];
        archivedBudgetIds: string[];
        deactivatedMembershipIds: string[];
      }>
    >`
      SELECT "id", "user_id" AS "userId", "purge_after" AS "purgeAfter",
             "archived_workspace_ids" AS "archivedWorkspaceIds",
             "archived_budget_ids" AS "archivedBudgetIds",
             "deactivated_membership_ids" AS "deactivatedMembershipIds"
      FROM "account_deletions"
      WHERE "restore_token_hash" = ${tokenHash}
        AND "restored_at" IS NULL
        AND "purged_at" IS NULL
        AND "purge_after" > ${now}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async reactivateUser(tx: Tx, userId: string): Promise<boolean> {
    const result = await tx.user.updateMany({
      where: { id: userId, status: 'PENDING_DELETION' },
      data: { status: 'ACTIVE' },
    });
    return result.count === 1;
  }

  /** Restores only what the request archived; anything archived earlier stays archived. */
  async restoreScope(
    tx: Tx,
    scope: { archivedWorkspaceIds: string[]; archivedBudgetIds: string[]; deactivatedMembershipIds: string[] },
  ): Promise<void> {
    if (scope.archivedWorkspaceIds.length > 0)
      await tx.workspace.updateMany({
        where: { id: { in: scope.archivedWorkspaceIds }, status: 'ARCHIVED' },
        data: { status: 'ACTIVE' },
      });
    if (scope.archivedBudgetIds.length > 0)
      await tx.budget.updateMany({
        where: { id: { in: scope.archivedBudgetIds }, status: 'ARCHIVED' },
        data: { status: 'ACTIVE' },
      });
    if (scope.deactivatedMembershipIds.length > 0)
      await tx.workspaceMembership.updateMany({
        where: { id: { in: scope.deactivatedMembershipIds }, isActive: false },
        data: { isActive: true, removedAt: null },
      });
  }

  async markRestored(tx: Tx, deletionId: string, now: Date): Promise<void> {
    await tx.accountDeletion.update({ where: { id: deletionId }, data: { restoredAt: now } });
  }
```

- [ ] **Step 4: Падающие unit-тесты отмены (добавить в `account-deletion.application.service.test.ts`)**

В `setup` добавить в `repository`:

```ts
    lockOpenDeletionByTokenHash: vi.fn().mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      purgeAfter: new Date(NOW.getTime() + 1_000),
      archivedWorkspaceIds: ['w1'],
      archivedBudgetIds: ['b1'],
      deactivatedMembershipIds: [],
    }),
    reactivateUser: vi.fn().mockResolvedValue(true),
    restoreScope: vi.fn().mockResolvedValue(undefined),
    markRestored: vi.fn().mockResolvedValue(undefined),
```

Новый блок:

```ts
describe('AccountDeletionApplicationService.cancelDeletion', () => {
  it('restores the user and the archived scope by token hash', async () => {
    const { service, repository } = setup();

    await service.cancelDeletion({ token: 'raw-token' }, {});

    expect(repository.lockOpenDeletionByTokenHash).toHaveBeenCalledWith(expect.anything(), 'hash:raw-token', NOW);
    expect(repository.reactivateUser).toHaveBeenCalledWith(expect.anything(), 'u1');
    expect(repository.restoreScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ archivedWorkspaceIds: ['w1'], archivedBudgetIds: ['b1'] }),
    );
    expect(repository.markRestored).toHaveBeenCalledWith(expect.anything(), 'd1', NOW);
    expect(repository.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'ACCOUNT_DELETION_CANCELLED', userId: 'u1' }),
    );
  });

  it('rejects an unknown, used or expired token with one generic error', async () => {
    const { service, repository } = setup();
    repository.lockOpenDeletionByTokenHash.mockResolvedValue(null);

    await expect(service.cancelDeletion({ token: 'nope' }, {})).rejects.toMatchObject({
      response: { code: 'ACCOUNT_RESTORE_TOKEN_INVALID' },
    });
    expect(repository.reactivateUser).not.toHaveBeenCalled();
  });

  it('rejects when the user is no longer pending deletion', async () => {
    const { service, repository } = setup();
    repository.reactivateUser.mockResolvedValue(false);

    await expect(service.cancelDeletion({ token: 'raw-token' }, {})).rejects.toMatchObject({
      response: { code: 'ACCOUNT_RESTORE_TOKEN_INVALID' },
    });
    expect(repository.markRestored).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @harmofin/api exec vitest run src/account-deletion`
Expected: FAIL — `cancelDeletion is not a function`.

- [ ] **Step 5: Реализовать `cancelDeletion` в сервисе**

Импорт типа: `import type { CancelDeletionInput, RequestDeletionInput } from './account-deletion.schemas.js';`. Метод в класс:

```ts
  async cancelDeletion(input: CancelDeletionInput, meta: { requestId?: string }): Promise<void> {
    const now = this.clock();
    await this.repository.transaction(async (tx) => {
      const deletion = await this.repository.lockOpenDeletionByTokenHash(
        tx,
        this.tokenService.digest(input.token),
        now,
      );
      if (!deletion) throw invalidRestoreToken();
      if (!(await this.repository.reactivateUser(tx, deletion.userId))) throw invalidRestoreToken();
      await this.repository.restoreScope(tx, deletion);
      await this.repository.markRestored(tx, deletion.id, now);
      await this.repository.audit(tx, {
        userId: deletion.userId,
        workspaceId: deletion.archivedWorkspaceIds[0] ?? null,
        action: 'ACCOUNT_DELETION_CANCELLED',
        purgeAfter: deletion.purgeAfter,
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      });
    });
  }
```

Функция рядом с остальными фабриками ошибок:

```ts
function invalidRestoreToken(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'ACCOUNT_RESTORE_TOKEN_INVALID',
    detail: 'Ссылка недействительна или устарела.',
  });
}
```

Run: `pnpm --filter @harmofin/api exec vitest run src/account-deletion`
Expected: PASS (8 тестов).

- [ ] **Step 6: Эндпоинт в controller**

Добавить импорты `ApiNoContentResponse`, `AuthRateLimitGuard` (`../auth/auth-rate-limit.guard.js`), `CancelAccountDeletionRequest`, `cancelDeletionSchema`, `CancelDeletionInput`, `FastifyRequest` (type из `fastify`). Метод:

```ts
  @Post('auth/deletion/cancel')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard)
  @ApiBody({ type: CancelAccountDeletionRequest })
  @ApiNoContentResponse({ description: 'Удаление отменено. Войдите обычным способом.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async cancelDeletion(
    @Body(new ZodValidationPipe(cancelDeletionSchema)) input: CancelDeletionInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const meta = requestMeta(request);
    await this.service.cancelDeletion(input, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
  }
```

- [ ] **Step 7: Интеграционные тесты отмены (добавить в `describe` файла `account-deletion.integration.test.ts`)**

```ts
  async function deleteWithKnownToken(fixture: Fixture, rawToken: string) {
    expect((await requestDeletion(fixture, { password })).statusCode).toBe(202);
    await prisma.accountDeletion.updateMany({
      where: { userId: fixture.userId, restoredAt: null, purgedAt: null },
      data: { restoreTokenHash: digest(rawToken) },
    });
  }

  function cancel(token: string) {
    return server.inject({
      method: 'POST',
      url: '/api/v1/auth/deletion/cancel',
      headers: { origin },
      payload: { token },
    });
  }

  it('restores access by a valid token exactly once', async () => {
    const fixture = await register('del-restore');
    const rawToken = `restore-${randomUUID()}`;
    await deleteWithKnownToken(fixture, rawToken);

    expect((await cancel(rawToken)).statusCode).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe('ACTIVE');
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: fixture.workspaceId } })).status).toBe('ACTIVE');
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: fixture.budgetId } })).status).toBe('ACTIVE');
    expect((await login(fixture)).statusCode).toBe(200);

    const reused = await cancel(rawToken);
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ code: 'ACCOUNT_RESTORE_TOKEN_INVALID' });
  });

  it('rejects an unknown token and an expired one', async () => {
    expect((await cancel(`unknown-${randomUUID()}`)).statusCode).toBe(422);

    const fixture = await register('del-expired');
    const rawToken = `expired-${randomUUID()}`;
    await deleteWithKnownToken(fixture, rawToken);
    await prisma.accountDeletion.updateMany({
      where: { userId: fixture.userId },
      data: { purgeAfter: new Date(Date.now() - 1_000) },
    });

    expect((await cancel(rawToken)).statusCode).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).status).toBe('PENDING_DELETION');
  });

  it('does not reactivate a budget that was archived before the request', async () => {
    const fixture = await register('del-prearchived');
    const oldBudgetId = randomUUID();
    await prisma.budget.create({
      data: { id: oldBudgetId, workspaceId: fixture.workspaceId, name: 'Старый бюджет', status: 'ARCHIVED' },
    });
    const rawToken = `pre-${randomUUID()}`;
    await deleteWithKnownToken(fixture, rawToken);

    expect((await cancel(rawToken)).statusCode).toBe(204);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: oldBudgetId } })).status).toBe('ARCHIVED');
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: fixture.budgetId } })).status).toBe('ACTIVE');
  });
```

Если `prisma.budget.create` требует дополнительных обязательных полей — взять их из `newBudgetModelData` (`apps/api/src/common/plan-model/new-budget-model.ts`).

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/account-deletion.integration.test.ts`
Expected: PASS (все тесты, включая OpenAPI).

- [ ] **Step 8: Регенерировать OpenAPI и проверить контракт**

Run: `pnpm --filter @harmofin/api build && node scripts/openapi/generate.mjs && node scripts/openapi/check.mjs`
Expected: в `git diff --stat openapi.json` — только добавленные пути `/api/v1/me/deletion`, `/api/v1/auth/deletion/cancel` и схемы `RequestAccountDeletionRequest`, `AccountDeletionScheduledResponse`, `CancelAccountDeletionRequest`; проверка breaking changes без ошибок.

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/v2-openapi.integration.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit (после разрешения владельца)**

```bash
git add apps/api/src/account-deletion apps/api/src/auth/auth-rate-limit.guard.ts apps/api/src/auth/auth-rate-limit.guard.test.ts apps/api/test/account-deletion.integration.test.ts openapi.json
git commit -m "feat(api): отмена удаления аккаунта по ссылке из письма"
```

---

### Task 5: Очистка в worker — `PURGE_DELETED_ACCOUNTS`

**Files:**
- Create: `apps/worker/src/account-purge.ts`
- Create: `apps/worker/src/account-purge.handler.ts`
- Test: `apps/worker/src/account-purge.handler.test.ts`
- Modify: `apps/worker/src/job.repository.ts:11-14`
- Modify: `apps/worker/src/job-runner.ts:98-101`
- Test: `apps/worker/src/job-runner.test.ts`
- Modify: `apps/worker/src/main.ts:26-29`
- Test: `apps/api/test/account-deletion.integration.test.ts`

**Interfaces:**
- Consumes: `prisma.accountDeletion`, `UserStatus.PENDING_DELETION`, `WorkerJobType.PURGE_DELETED_ACCOUNTS` (Task 1).
- Produces: `purgeUserData(tx: Prisma.TransactionClient, userId: string): Promise<void>`; `AccountPurgeCoverageError`; `class AccountPurgeHandler implements WorkerJobHandler { execute(now: Date): Promise<void>; purgeOne(deletionId: string, now: Date): Promise<boolean> }`.

- [ ] **Step 1: SQL-очистка `apps/worker/src/account-purge.ts`**

```ts
import { Prisma } from '@prisma/client';

/**
 * Children before parents: every FK is ON DELETE RESTRICT. Order mirrors
 * docs/runbooks/budget-reset.sql, except audit_events are deleted, not detached.
 * Legacy model-1 tables (transfer_parts, income_allocations, envelope_reallocations) are included.
 */
const BUDGET_TABLES_IN_DELETE_ORDER = [
  'plan_payments',
  'notifications',
  'envelope_assignments',
  'envelope_movements',
  'envelope_periods',
  'envelope_funding_rules',
  'envelope_reallocations',
  'income_allocations',
  'transfer_parts',
  'transfers',
  'plan_occurrences',
  'regular_plans',
  'transactions',
  'idempotency_records',
  'audit_events',
  'budget_cycle_revisions',
  'envelopes',
] as const;

export class AccountPurgeCoverageError extends Error {
  override readonly name = 'AccountPurgeCoverageError';

  constructor(readonly tableName: string) {
    super(`Table ${tableName} still holds rows of a purged scope.`);
  }
}

/** Physically deletes everything the user owns and anonymizes the user row. Run inside one transaction. */
export async function purgeUserData(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const workspaceIds = (
    await tx.workspace.findMany({ where: { ownerId: userId }, select: { id: true } })
  ).map((workspace) => workspace.id);
  const budgetIds =
    workspaceIds.length === 0
      ? []
      : (
          await tx.budget.findMany({
            where: { workspaceId: { in: workspaceIds } },
            select: { id: true },
          })
        ).map((budget) => budget.id);

  if (budgetIds.length > 0) {
    await tx.$executeRaw`
      UPDATE "budgets"
      SET "income_allocation_source_category_id" = NULL, "income_allocation_target_envelope_id" = NULL
      WHERE "id" = ANY(${budgetIds}::uuid[])`;
    for (const table of BUDGET_TABLES_IN_DELETE_ORDER) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "budget_id" = ANY($1::uuid[])`, budgetIds);
    }
    // categories reference their parent with ON DELETE RESTRICT: delete leaves layer by layer.
    for (;;) {
      const deleted = await tx.$executeRaw`
        DELETE FROM "categories" c
        WHERE c."budget_id" = ANY(${budgetIds}::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM "categories" ch WHERE ch."budget_id" = c."budget_id" AND ch."parent_id" = c."id"
          )`;
      if (deleted === 0) break;
    }
    await tx.$executeRaw`DELETE FROM "accounts" WHERE "budget_id" = ANY(${budgetIds}::uuid[])`;
    await assertNoRowsLeft(tx, 'budget_id', budgetIds);
    await tx.$executeRaw`DELETE FROM "budgets" WHERE "id" = ANY(${budgetIds}::uuid[])`;
  }

  if (workspaceIds.length > 0) {
    await tx.$executeRaw`DELETE FROM "notifications" WHERE "workspace_id" = ANY(${workspaceIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM "audit_events" WHERE "workspace_id" = ANY(${workspaceIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM "workspace_memberships" WHERE "workspace_id" = ANY(${workspaceIds}::uuid[])`;
    await assertNoRowsLeft(tx, 'workspace_id', workspaceIds);
    await tx.$executeRaw`DELETE FROM "workspaces" WHERE "id" = ANY(${workspaceIds}::uuid[])`;
  }

  await tx.$executeRaw`DELETE FROM "sessions" WHERE "user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "recovery_tokens" WHERE "user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "idempotency_records" WHERE "actor_user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "notifications" WHERE "user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "audit_events" WHERE "actor_user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "workspace_memberships" WHERE "user_id" = ${userId}::uuid`;
  await tx.$executeRaw`
    UPDATE "users"
    SET "email" = 'deleted-' || "id"::text || '@invalid',
        "password_hash" = '',
        "display_name" = NULL,
        "email_verified_at" = NULL,
        "status" = 'DELETED',
        "updated_at" = now()
    WHERE "id" = ${userId}::uuid`;
}

/** Guard against a new table silently surviving the purge: every table with the column must be empty for the scope. */
async function assertNoRowsLeft(
  tx: Prisma.TransactionClient,
  column: 'budget_id' | 'workspace_id',
  ids: string[],
): Promise<void> {
  const tables = await tx.$queryRaw<Array<{ tableName: string }>>`
    SELECT DISTINCT c.table_name AS "tableName"
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = current_schema() AND c.column_name = ${column} AND t.table_type = 'BASE TABLE'`;
  for (const { tableName } of tables) {
    const quoted = `"${tableName.replaceAll('"', '""')}"`;
    const rows = await tx.$queryRawUnsafe<Array<{ remaining: bigint }>>(
      `SELECT count(*) AS "remaining" FROM ${quoted} WHERE "${column}" = ANY($1::uuid[])`,
      ids,
    );
    if ((rows[0]?.remaining ?? 0n) > 0n) throw new AccountPurgeCoverageError(tableName);
  }
}
```

Вернуть полный `afterAll` в `apps/api/test/account-deletion.integration.test.ts` (код из Task 3 Step 12).

- [ ] **Step 2: Написать падающий unit-тест `apps/worker/src/account-purge.handler.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('./account-purge.js', () => ({ purgeUserData: vi.fn().mockResolvedValue(undefined) }));

import { purgeUserData } from './account-purge.js';
import { AccountPurgeHandler } from './account-purge.handler.js';

const NOW = new Date('2026-11-18T00:00:00.000Z');

function setup(locked: Array<{ userId: string }>) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(locked),
    accountDeletion: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    accountDeletion: { findMany: vi.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]) },
    $transaction: vi.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
  };
  return { handler: new AccountPurgeHandler(prisma as never), prisma, tx };
}

describe('AccountPurgeHandler', () => {
  it('selects only due, open requests and purges each in its own transaction', async () => {
    const { handler, prisma, tx } = setup([{ userId: 'u1' }]);

    await handler.execute(NOW);

    expect(prisma.accountDeletion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { purgeAfter: { lte: NOW }, restoredAt: null, purgedAt: null },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(purgeUserData).toHaveBeenCalledWith(tx, 'u1');
    expect(tx.accountDeletion.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { purgedAt: NOW } });
  });

  it('skips a request that was restored or purged after selection', async () => {
    vi.mocked(purgeUserData).mockClear();
    const { handler, tx } = setup([]);

    await expect(handler.purgeOne('d1', NOW)).resolves.toBe(false);
    expect(purgeUserData).not.toHaveBeenCalled();
    expect(tx.accountDeletion.update).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run src/account-purge.handler.test.ts`
Expected: FAIL — `account-purge.handler.js` не найден.

- [ ] **Step 3: Handler `apps/worker/src/account-purge.handler.ts`**

```ts
import { PrismaClient } from '@prisma/client';

import { purgeUserData } from './account-purge.js';
import type { WorkerJobHandler } from './job-runner.js';

const PURGE_BATCH_SIZE = 20;
const PURGE_TRANSACTION_TIMEOUT_MS = 60_000;

export class AccountPurgeHandler implements WorkerJobHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(now: Date): Promise<void> {
    const due = await this.prisma.accountDeletion.findMany({
      where: { purgeAfter: { lte: now }, restoredAt: null, purgedAt: null },
      select: { id: true },
      orderBy: { purgeAfter: 'asc' },
      take: PURGE_BATCH_SIZE,
    });
    for (const { id } of due) await this.purgeOne(id, now);
  }

  /** Re-checks the request under a row lock, so a concurrent restore cannot interleave. */
  purgeOne(deletionId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ userId: string }>>`
          SELECT d."user_id" AS "userId"
          FROM "account_deletions" d
          JOIN "users" u ON u."id" = d."user_id"
          WHERE d."id" = ${deletionId}::uuid
            AND d."restored_at" IS NULL
            AND d."purged_at" IS NULL
            AND d."purge_after" <= ${now}
            AND u."status" = 'PENDING_DELETION'
          FOR UPDATE OF d`;
        const target = locked[0];
        if (!target) return false;
        await purgeUserData(tx, target.userId);
        await tx.accountDeletion.update({ where: { id: deletionId }, data: { purgedAt: now } });
        return true;
      },
      { timeout: PURGE_TRANSACTION_TIMEOUT_MS },
    );
  }
}
```

Run: `pnpm --filter @harmofin/worker exec vitest run src/account-purge.handler.test.ts`
Expected: PASS.

- [ ] **Step 4: Падающий тест суточного интервала (добавить в `apps/worker/src/job-runner.test.ts`)**

```ts
it('reschedules the account purge job one day later', async () => {
  const now = new Date('2026-10-18T00:00:00.000Z');
  const repository = {
    ensureRecurringJobs: vi.fn().mockResolvedValue(undefined),
    claimDue: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'job-1', jobType: 'PURGE_DELETED_ACCOUNTS', attempts: 1 }])
      .mockResolvedValue([]),
    completeRecurring: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
  };
  const runner = new JobRunner(
    repository as never,
    { PURGE_DELETED_ACCOUNTS: { execute: vi.fn().mockResolvedValue(undefined) } },
    { pollIntervalMs: 60_000, concurrency: 1, leaseSeconds: 60, now: () => now },
  );

  await runner.start();
  await runner.stop();

  expect(repository.completeRecurring).toHaveBeenCalledWith(
    'job-1',
    new Date('2026-10-19T00:00:00.000Z'),
  );
});
```

(Импортировать `vi` и `JobRunner`, если их ещё нет в файле.)

Run: `pnpm --filter @harmofin/worker exec vitest run src/job-runner.test.ts`
Expected: FAIL — ожидалось `2026-10-19`, получено `2026-10-18T00:15:00`.

- [ ] **Step 5: Интервалы в `apps/worker/src/job-runner.ts` (заменить функцию `nextRunAt`)**

```ts
const RECURRING_DELAY_MS: Record<WorkerJobType, number> = {
  MATERIALIZE_PLAN_OCCURRENCES: 300_000,
  EVALUATE_BUDGET_NOTIFICATIONS: 900_000,
  PURGE_DELETED_ACCOUNTS: 86_400_000,
};

function nextRunAt(jobType: WorkerJobType, now: Date): Date {
  return new Date(now.getTime() + RECURRING_DELAY_MS[jobType]);
}
```

Run: `pnpm --filter @harmofin/worker exec vitest run src/job-runner.test.ts`
Expected: PASS (все тесты файла).

- [ ] **Step 6: Регистрация задания**

`apps/worker/src/job.repository.ts`:

```ts
const recurringJobs: Array<{ jobKey: string; jobType: WorkerJobType }> = [
  { jobKey: 'plans:materialize-v1', jobType: 'MATERIALIZE_PLAN_OCCURRENCES' },
  { jobKey: 'notifications:evaluate-budget-v1', jobType: 'EVALUATE_BUDGET_NOTIFICATIONS' },
  { jobKey: 'accounts:purge-deleted-v1', jobType: 'PURGE_DELETED_ACCOUNTS' },
];
```

`apps/worker/src/main.ts`: импорт `import { AccountPurgeHandler } from './account-purge.handler.js';` и в объект handlers:

```ts
    PURGE_DELETED_ACCOUNTS: new AccountPurgeHandler(database),
```

- [ ] **Step 7: Интеграционные тесты очистки (добавить в `apps/api/test/account-deletion.integration.test.ts`)**

Импорт вверху: `import { AccountPurgeHandler } from '../../worker/src/account-purge.handler.js';`

```ts
  async function makeDue(userId: string) {
    await prisma.accountDeletion.updateMany({
      where: { userId, restoredAt: null, purgedAt: null },
      data: { purgeAfter: new Date(Date.now() - 1_000) },
    });
  }

  it('purges every row of the owned scope and anonymizes the user, leaving others intact', async () => {
    const target = await register('del-purge');
    const bystander = await register('del-bystander');
    await prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId: target.budgetId,
        name: 'Карта',
        accountType: 'BANK_ACCOUNT',
        currency: 'RUB',
        scale: 2,
        startingBalanceMinor: 100_000n,
        accountingStartDate: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    expect((await requestDeletion(target, { password })).statusCode).toBe(202);
    await makeDue(target.userId);

    await new AccountPurgeHandler(prisma).execute(new Date());

    expect(await prisma.budget.count({ where: { workspaceId: target.workspaceId } })).toBe(0);
    expect(await prisma.workspace.count({ where: { id: target.workspaceId } })).toBe(0);
    expect(await prisma.account.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.category.count({ where: { budgetId: target.budgetId } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: target.userId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { actorUserId: target.userId } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(user).toMatchObject({
      email: `deleted-${target.userId}@invalid`,
      passwordHash: '',
      displayName: null,
      status: 'DELETED',
    });
    expect((await prisma.accountDeletion.findFirstOrThrow({ where: { userId: target.userId } })).purgedAt).not.toBeNull();

    expect(await prisma.budget.count({ where: { id: bystander.budgetId, status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.category.count({ where: { budgetId: bystander.budgetId } })).toBeGreaterThan(0);
  });

  it('skips restored and not yet due requests and is safe to re-run', async () => {
    const restored = await register('del-skip-restored');
    const rawToken = `skip-${randomUUID()}`;
    await deleteWithKnownToken(restored, rawToken);
    await makeDue(restored.userId);
    // A restore after the deadline is rejected, so restore first, then make the row due.
    await prisma.accountDeletion.updateMany({ where: { userId: restored.userId }, data: { restoredAt: new Date() } });
    await prisma.user.update({ where: { id: restored.userId }, data: { status: 'ACTIVE' } });

    const pending = await register('del-skip-pending');
    expect((await requestDeletion(pending, { password })).statusCode).toBe(202);

    const handler = new AccountPurgeHandler(prisma);
    await handler.execute(new Date());
    await handler.execute(new Date());

    expect(await prisma.budget.count({ where: { id: restored.budgetId } })).toBe(1);
    expect(await prisma.budget.count({ where: { id: pending.budgetId } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pending.userId } })).status).toBe('PENDING_DELETION');
  });
```

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/account-deletion.integration.test.ts`
Expected: PASS. Если падает `AccountPurgeCoverageError` с именем таблицы — добавить таблицу в `BUDGET_TABLES_IN_DELETE_ORDER` в позицию до её родителей и повторить.

- [ ] **Step 8: Полные проверки worker и API**

Run: `pnpm --filter @harmofin/worker exec vitest run && pnpm --filter @harmofin/worker typecheck && pnpm --filter @harmofin/api exec vitest run --config vitest.integration.config.ts test/worker-job-concurrency.integration.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit (после разрешения владельца)**

```bash
git add apps/worker/src/account-purge.ts apps/worker/src/account-purge.handler.ts apps/worker/src/account-purge.handler.test.ts apps/worker/src/job.repository.ts apps/worker/src/job-runner.ts apps/worker/src/job-runner.test.ts apps/worker/src/main.ts apps/api/test/account-deletion.integration.test.ts
git commit -m "feat(worker): физическая очистка аккаунтов после окна отмены"
```

---

### Task 6: Web — удаление из настроек

**Files:**
- Modify: `apps/web/app/composables/useAuth.ts`
- Create: `apps/web/app/pages/app/settings/delete-account.vue`
- Test: `apps/web/app/pages/app/settings/delete-account.test.ts`
- Modify: `apps/web/app/pages/app/settings/index.vue` (карточка «Аккаунт», после ссылки «Сессии»)
- Test: `apps/web/app/pages/app/settings/index.test.ts`

**Interfaces:**
- Consumes: `POST /api/v1/me/deletion` → `{ purgeAfter: string }` (Task 3).
- Produces: `useAuth().requestAccountDeletion(password: string): Promise<{ purgeAfter: string }>` (очищает `currentUser`, `currentData`); `useAuth().cancelAccountDeletion(token: string): Promise<void>` (используется в Task 7); маршрут `/account-deleted?until=<ISO>`.

- [ ] **Step 1: Методы в `useAuth.ts` (после `revokeAllSessions`, добавить в `return`)**

```ts
  async function requestAccountDeletion(password: string): Promise<{ purgeAfter: string }> {
    const result = await api.request<{ purgeAfter: string }>('/api/v1/me/deletion', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    currentUser.value = null;
    currentData.value = null;
    return result;
  }

  async function cancelAccountDeletion(token: string): Promise<void> {
    await api.request('/api/v1/auth/deletion/cancel', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }
```

- [ ] **Step 2: Написать падающий тест `apps/web/app/pages/app/settings/delete-account.test.ts`**

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({ requestAccountDeletion: vi.fn(), navigateTo: vi.fn() }));

vi.mock('#imports', () => ({ definePageMeta: () => undefined, navigateTo: mocks.navigateTo }));
vi.mock('../../../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../../../composables/useAuth.js')>(
    '../../../composables/useAuth.js',
  );
  return { ...actual, useAuth: () => ({ requestAccountDeletion: mocks.requestAccountDeletion }) };
});

import DeleteAccountPage from './delete-account.vue';

function mountPage() {
  return mount(DeleteAccountPage, {
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
}

describe('settings delete account page', () => {
  beforeEach(() => {
    mocks.requestAccountDeletion.mockReset();
    mocks.navigateTo.mockReset();
  });

  it('explains the 30-day window and links to the export first', () => {
    const wrapper = mountPage();

    expect(wrapper.text()).toContain('через 30 дней');
    expect(wrapper.text()).toContain('Сначала выгрузите данные');
  });

  it('keeps the button disabled until the password and the confirmation are given', async () => {
    const wrapper = mountPage();
    const button = () => wrapper.get('button[type="submit"]');

    expect(button().attributes('disabled')).toBeDefined();
    await wrapper.get('[name="password"]').setValue('correct-password-10');
    expect(button().attributes('disabled')).toBeDefined();
    await wrapper.get('[name="confirm"]').setValue(true);
    expect(button().attributes('disabled')).toBeUndefined();
  });

  it('deletes and moves to the confirmation page with the purge date', async () => {
    mocks.requestAccountDeletion.mockResolvedValue({ purgeAfter: '2026-11-17T09:00:00.000Z' });
    const wrapper = mountPage();

    await wrapper.get('[name="password"]').setValue('correct-password-10');
    await wrapper.get('[name="confirm"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith('correct-password-10');
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      '/account-deleted?until=2026-11-17T09%3A00%3A00.000Z',
      { replace: true },
    );
  });

  it('shows the password field error next to the control', async () => {
    mocks.requestAccountDeletion.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'CURRENT_PASSWORD_INVALID',
        detail: 'Пароль неверен.',
        fieldErrors: [{ field: 'password', message: 'Пароль неверен.', code: 'invalid' }],
      } as never),
    );
    const wrapper = mountPage();

    await wrapper.get('[name="password"]').setValue('wrong-password');
    await wrapper.get('[name="confirm"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[name="password"]').attributes('aria-invalid')).toBe('true');
    expect(wrapper.text()).toContain('Пароль неверен.');
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/delete-account.test.ts`
Expected: FAIL — файл `delete-account.vue` не найден.

- [ ] **Step 3: Страница `apps/web/app/pages/app/settings/delete-account.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { definePageMeta, navigateTo } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiInput from '../../../components/ui/Input.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { errorMessage, useAuth } from '../../../composables/useAuth.js';

defineOptions({ name: 'AppSettingsDeleteAccountPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { requestAccountDeletion } = useAuth();
const password = ref('');
const confirmed = ref(false);
const deleting = ref(false);
const summary = ref('');
const fieldErrors = ref<Record<string, string>>({});
const canSubmit = computed(() => password.value.length > 0 && confirmed.value && !deleting.value);

async function remove() {
  if (!canSubmit.value) return;
  summary.value = '';
  fieldErrors.value = {};
  deleting.value = true;
  try {
    const { purgeAfter } = await requestAccountDeletion(password.value);
    password.value = '';
    await navigateTo(`/account-deleted?until=${encodeURIComponent(purgeAfter)}`, { replace: true });
  } catch (error) {
    const mapped = errorMessage(error);
    summary.value = mapped.summary;
    fieldErrors.value = mapped.fields;
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Удаление аккаунта</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiCard as="section" aria-labelledby="delete-account-title">
        <template #header><h2 id="delete-account-title">Что произойдёт</h2></template>
        <ul class="delete-account__facts">
          <li>Вход в аккаунт закроется сразу, все сессии завершатся.</li>
          <li>Аккаунт и все данные бюджета удалятся безвозвратно через 30 дней.</li>
          <li>До этого срока удаление можно отменить по ссылке из письма.</li>
        </ul>
        <p class="delete-account__export">
          <NuxtLink to="/app/operations">Сначала выгрузите данные</NuxtLink> — экспорт операций в
          CSV доступен в журнале операций.
        </p>
        <UiStatus v-if="summary" :label="summary" tone="danger" aria-live="polite" />
        <form class="delete-account__form" @submit.prevent="remove">
          <UiInput
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            label="Текущий пароль"
            :error="fieldErrors.password"
            required
          />
          <label class="delete-account__confirm">
            <input v-model="confirmed" name="confirm" type="checkbox" />
            <span>Понимаю, что данные удалятся безвозвратно через 30 дней</span>
          </label>
          <UiButton type="submit" variant="danger" :loading="deleting" :disabled="!canSubmit">
            Удалить аккаунт
          </UiButton>
        </form>
      </UiCard>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.delete-account__facts {
  display: grid;
  gap: var(--hf-space-2);
  margin: var(--hf-space-4) 0;
  padding-left: var(--hf-space-5);
  color: var(--hf-color-text);
}

.delete-account__export {
  margin: 0 0 var(--hf-space-5);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.delete-account__form {
  display: grid;
  gap: var(--hf-space-5);
  max-width: 28rem;
  margin-top: var(--hf-space-4);
}

.delete-account__confirm {
  display: flex;
  align-items: flex-start;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.delete-account__confirm input {
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.125rem;
  accent-color: var(--hf-color-action-danger);
}
</style>
```


Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/delete-account.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 4: Строка в хабе — падающий тест в `apps/web/app/pages/app/settings/index.test.ts`**

Добавить тест по образцу существующих тестов файла (тот же `mountPage`/моки):

```ts
  it('links to account deletion from the account card', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const link = wrapper.find('a[href="/app/settings/delete-account"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Удаление аккаунта');
    wrapper.unmount();
  });
```

`mountPage` и заглушка `NuxtLink`, передающая `to` в `href`, уже есть в файле.

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings/index.test.ts`
Expected: FAIL.

- [ ] **Step 5: Строка в карточке «Аккаунт» `index.vue` (после ссылки «Сессии»)**

```vue
          <NuxtLink to="/app/settings/delete-account" class="settings-page__row">
            <span>Удаление аккаунта</span>
            <span class="settings-page__row-link">Перейти →</span>
          </NuxtLink>
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/app/settings`
Expected: PASS.

- [ ] **Step 6: Typecheck и lint**

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS.

- [ ] **Step 7: Commit (после разрешения владельца)**

```bash
git add apps/web/app/composables/useAuth.ts apps/web/app/pages/app/settings/delete-account.vue apps/web/app/pages/app/settings/delete-account.test.ts apps/web/app/pages/app/settings/index.vue apps/web/app/pages/app/settings/index.test.ts
git commit -m "feat(web): удаление аккаунта в настройках"
```

---

### Task 7: Web — публичные страницы подтверждения и отмены

**Files:**
- Create: `apps/web/app/pages/account-deleted.vue`
- Test: `apps/web/app/pages/account-deleted.test.ts`
- Create: `apps/web/app/pages/restore-account.vue`
- Test: `apps/web/app/pages/restore-account.test.ts`

**Interfaces:**
- Consumes: `useAuth().cancelAccountDeletion(token)` (Task 6), `AuthForm` (`components/auth/AuthForm.vue`, props `title, subtitle, submitLabel, onSubmit, loading?, summary?`, слот `footer`).
- Produces: маршруты `/account-deleted`, `/restore-account?token=`.

- [ ] **Step 1: Падающий тест `apps/web/app/pages/account-deleted.test.ts`**

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ query: { until: '2026-11-17T09:00:00.000Z' } as Record<string, unknown> }));
vi.mock('#app', () => ({ useRoute: () => route, navigateTo: vi.fn() }));

import AccountDeletedPage from './account-deleted.vue';

// AuthForm is auto-imported by Nuxt; unit tests stub it with the props the page passes.
const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  AuthForm: {
    props: ['title', 'subtitle', 'submitLabel', 'onSubmit'],
    template: '<main><h1>{{ title }}</h1><p>{{ subtitle }}</p><slot name="footer" /></main>',
  },
};

describe('account deleted page', () => {
  it('shows the purge date and where the restore link went', () => {
    const wrapper = mount(AccountDeletedPage, { global: { stubs } });

    expect(wrapper.text()).toContain('17.11.2026');
    expect(wrapper.text()).toContain('письмо со ссылкой для отмены');
  });

  it('falls back to the 30-day wording without a valid date', () => {
    route.query = {};
    const wrapper = mount(AccountDeletedPage, { global: { stubs } });

    expect(wrapper.text()).toContain('через 30 дней');
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/account-deleted.test.ts`
Expected: FAIL.

- [ ] **Step 2: Страница `apps/web/app/pages/account-deleted.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo, useRoute } from '#app';

const route = useRoute();

const purgeDate = computed(() => {
  const raw = typeof route.query.until === 'string' ? new Date(route.query.until) : null;
  if (!raw || Number.isNaN(raw.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(raw);
});

const subtitle = computed(() =>
  purgeDate.value
    ? `Аккаунт и данные будут удалены безвозвратно ${purgeDate.value}. Мы отправили письмо со ссылкой для отмены.`
    : 'Аккаунт и данные будут удалены безвозвратно через 30 дней. Мы отправили письмо со ссылкой для отмены.',
);

function toLanding() {
  return navigateTo('/');
}
</script>

<template>
  <AuthForm
    title="Аккаунт удаляется"
    :subtitle="subtitle"
    submit-label="На главную"
    :on-submit="toLanding"
  >
    <template #footer>
      <p class="form-links">Письмо не пришло? Проверьте папку «Спам».</p>
    </template>
  </AuthForm>
</template>
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/account-deleted.test.ts`
Expected: PASS.

- [ ] **Step 3: Падающий тест `apps/web/app/pages/restore-account.test.ts`**

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({
  cancelAccountDeletion: vi.fn(),
  route: { query: { token: 'raw-token' } as Record<string, unknown> },
}));
vi.mock('#app', () => ({ useRoute: () => mocks.route, navigateTo: vi.fn() }));
vi.mock('../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../composables/useAuth.js')>('../composables/useAuth.js');
  return { ...actual, useAuth: () => ({ cancelAccountDeletion: mocks.cancelAccountDeletion }) };
});

import RestoreAccountPage from './restore-account.vue';

const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  AuthForm: {
    props: ['title', 'subtitle', 'submitLabel', 'onSubmit', 'summary'],
    template:
      '<main><h1>{{ title }}</h1><p>{{ subtitle }}</p><p role="status">{{ summary }}</p><form @submit.prevent="onSubmit()"><button type="submit">{{ submitLabel }}</button></form><slot name="footer" /></main>',
  },
};

describe('restore account page', () => {
  beforeEach(() => {
    mocks.cancelAccountDeletion.mockReset();
    mocks.route.query = { token: 'raw-token' };
    window.history.replaceState(null, '', '/restore-account?token=raw-token');
  });

  it('removes the token from the address bar on load', () => {
    mount(RestoreAccountPage, { global: { stubs } });

    expect(window.location.search).toBe('');
  });

  it('cancels the deletion and offers to sign in', async () => {
    mocks.cancelAccountDeletion.mockResolvedValue(undefined);
    const wrapper = mount(RestoreAccountPage, { global: { stubs } });

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.cancelAccountDeletion).toHaveBeenCalledWith('raw-token');
    expect(wrapper.text()).toContain('Удаление отменено');
    expect(wrapper.text()).toContain('Войти');
  });

  it('shows the server message for an invalid or expired link', async () => {
    mocks.cancelAccountDeletion.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'ACCOUNT_RESTORE_TOKEN_INVALID',
        detail: 'Ссылка недействительна или устарела.',
      } as never),
    );
    const wrapper = mount(RestoreAccountPage, { global: { stubs } });

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Ссылка недействительна или устарела.');
  });

  it('does not call the API without a token', async () => {
    mocks.route.query = {};
    const wrapper = mount(RestoreAccountPage, { global: { stubs } });

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.cancelAccountDeletion).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ссылка недействительна или устарела.');
  });
});
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/restore-account.test.ts`
Expected: FAIL.

- [ ] **Step 4: Страница `apps/web/app/pages/restore-account.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from '#app';

import { errorMessage, useAuth } from '../composables/useAuth.js';

const INVALID_LINK = 'Ссылка недействительна или устарела.';

const route = useRoute();
// Read once: the token is removed from the address bar right after mount.
const token = typeof route.query.token === 'string' ? route.query.token : '';
const loading = ref(false);
const summary = ref('');
const restored = ref(false);
const { cancelAccountDeletion } = useAuth();

onMounted(() => {
  window.history.replaceState(window.history.state, '', window.location.pathname);
});

async function submit() {
  if (restored.value) return;
  summary.value = '';
  if (!token) {
    summary.value = INVALID_LINK;
    return;
  }
  loading.value = true;
  try {
    await cancelAccountDeletion(token);
    restored.value = true;
    summary.value = 'Удаление отменено. Войдите в аккаунт как обычно.';
  } catch (error) {
    summary.value = errorMessage(error).summary || INVALID_LINK;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthForm
    title="Отмена удаления"
    subtitle="Аккаунт и данные бюджета вернутся в том виде, в котором были на момент удаления."
    submit-label="Отменить удаление"
    :loading="loading"
    :summary="summary"
    :on-submit="submit"
  >
    <template #footer>
      <p class="form-links"><NuxtLink to="/login">Войти</NuxtLink></p>
    </template>
  </AuthForm>
</template>
```

Run: `pnpm --filter @harmofin/web exec vitest run app/pages/restore-account.test.ts app/pages/account-deleted.test.ts`
Expected: PASS.

- [ ] **Step 5: Публичность маршрутов**

Проверить `apps/web/app/middleware/auth.ts`: middleware подключается только через `definePageMeta({ middleware: 'auth' })`, а новые страницы его не объявляют. Если в проекте есть глобальный список публичных путей (`grep -rn "reset-password" apps/web/app apps/web/nuxt.config.ts`) — добавить туда `/restore-account` и `/account-deleted` рядом с `/reset-password`.

- [ ] **Step 6: Typecheck и lint**

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS.

- [ ] **Step 7: Commit (после разрешения владельца)**

```bash
git add apps/web/app/pages/account-deleted.vue apps/web/app/pages/account-deleted.test.ts apps/web/app/pages/restore-account.vue apps/web/app/pages/restore-account.test.ts
git commit -m "feat(web): страницы подтверждения и отмены удаления аккаунта"
```

---

### Task 8: E2E-сценарий (CI) и документация

**Files:**
- Create: `e2e/account-deletion.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-30-family-budget-development-spec.md` (раздел «Логическое удаление», около строки 660)
- Modify: `docs/runbooks/account-data-request.md` (раздел «Процедура удаления аккаунта»)

**Interfaces:**
- Consumes: UI из Task 6-7, письмо из Task 2, `mailpitOrigin` из `e2e/env.ts`.

- [ ] **Step 1: E2E `e2e/account-deletion.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import { mailpitOrigin } from './env';

const password = 'e2e-password-10';

test('deletes the account, blocks sign-in, then restores it through the Mailpit link', async ({ page, request }) => {
  // Registration, deletion and sign-in each pay for real Argon2id hashing.
  test.setTimeout(90_000);
  const email = `e2e-delete-${Date.now()}@harmofin.test`;

  await page.goto('/register');
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Удаление аккаунта' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/delete-account$/);
  await page.getByLabel('Текущий пароль').fill(password);
  await page.getByLabel('Понимаю, что данные удалятся безвозвратно через 30 дней').check();
  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
  await expect(page).toHaveURL(/\/account-deleted\?until=/);
  await expect(page.getByRole('heading', { name: 'Аккаунт удаляется' })).toBeVisible();

  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/login$/);

  let restorePath = '';
  await expect
    .poll(async () => {
      const messages = await request.get(`${mailpitOrigin}/api/v1/messages`).then((response) => response.json());
      const message = messages.messages.find(
        (item: { To: Array<{ Address: string }>; Subject: string }) =>
          item.Subject === 'Аккаунт HarmoFin будет удалён' &&
          item.To.some((recipient) => recipient.Address === email),
      ) as { ID: string } | undefined;
      if (!message) return '';
      const full = await request.get(`${mailpitOrigin}/api/v1/message/${message.ID}`).then((response) => response.json());
      restorePath = (full.Text as string).match(/(\/restore-account\?token=[^\s]+)/)?.[1] ?? '';
      return restorePath;
    })
    .not.toBe('');

  await page.goto(restorePath);
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Отменить удаление' }).click();
  await expect(page.getByText('Удаление отменено')).toBeVisible();

  await page.getByRole('link', { name: 'Войти' }).click();
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}
```

Run: `pnpm --filter @harmofin/web exec tsc --noEmit -p ../../e2e` только если у `e2e/` есть свой `tsconfig`; иначе `pnpm lint`. Локально Playwright **не запускать** — сценарий выполнит CI.

- [ ] **Step 2: Исключение в development spec**

После списка «Логическое удаление записывает: ...» (около строки 660) добавить:

```markdown
Исключение — удаление аккаунта по требованию владельца ([дизайн](2026-10-18-account-deletion-design.md)). После 30-дневного окна отмены worker (`PURGE_DELETED_ACCOUNTS`) физически удаляет все данные рабочих пространств пользователя, включая финансовые записи и события аудита, а строку `users` анонимизирует. Неперсональный след — таблица `account_deletions`. Других сценариев физического удаления финансовых записей нет.

Эндпоинты: `POST /api/v1/me/deletion` (сессия, CSRF, пароль) и `POST /api/v1/auth/deletion/cancel` (одноразовый токен из письма).
```

- [ ] **Step 3: Runbook `docs/runbooks/account-data-request.md`**

В начало раздела «## Процедура удаления аккаунта» вставить:

```markdown
> С 18.10.2026 удаление выполняется самим пользователем: «Настройки → Аккаунт → Удаление аккаунта». Ручная SQL-процедура ниже устарела (неверные имена таблиц) и не применяется. Через 30 дней данные стирает worker-задание `PURGE_DELETED_ACCOUNTS` (`apps/worker/src/account-purge.ts`).

### Операции поддержки

- **Статус запроса:** `SELECT id, requested_at, purge_after, restored_at, purged_at FROM account_deletions WHERE user_id = '<user-id>';`
- **Письмо не дошло, пользователь хочет отменить:** после верификации личности (см. «Верификация личности») выполнить в одной транзакции: `UPDATE users SET status = 'ACTIVE' WHERE id = '<user-id>' AND status = 'PENDING_DELETION';`, вернуть `status = 'ACTIVE'` рабочим пространствам и бюджетам из `archived_workspace_ids` / `archived_budget_ids`, `is_active = true, removed_at = NULL` членствам из `deactivated_membership_ids`, затем `UPDATE account_deletions SET restored_at = now() WHERE id = '<deletion-id>';`. Пользователь входит обычным способом.
- **Ускорить очистку:** `UPDATE account_deletions SET purge_after = now() WHERE id = '<deletion-id>' AND restored_at IS NULL AND purged_at IS NULL;` — worker удалит данные при следующем запуске задания (не позже чем через сутки) либо сразу после перезапуска worker.
- **Ошибка `AccountPurgeCoverageError` в логах worker:** в схеме появилась таблица с `budget_id`/`workspace_id`, которой нет в `BUDGET_TABLES_IN_DELETE_ORDER`. Транзакция откатилась, данные целы; добавить таблицу в список и выпустить worker.
- **Резервные копии:** строки удалённых аккаунтов остаются в backup до истечения их срока хранения (см. `database-restore.md`); при восстановлении из backup повторно выполнить очистку для `account_deletions` с `purged_at IS NOT NULL`.
```

- [ ] **Step 4: Финальные проверки**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

Run: `pnpm test:integration`
Expected: PASS (локальная БД поднята `pnpm infra:up`).

- [ ] **Step 5: Commit (после разрешения владельца)**

```bash
git add e2e/account-deletion.spec.ts docs/superpowers/specs/2026-08-30-family-budget-development-spec.md docs/runbooks/account-data-request.md
git commit -m "docs: исключение для удаления аккаунта, runbook поддержки и e2e-сценарий"
```

---

## Ревью по матрице

После Task 5 и после Task 8: Security (сессии, токены, изоляция очистки), Financial (физическое удаление финансовых данных, транзакционность), API (контракт, `openapi.json`), backend (миграция, worker), UI/UX (Task 6-7: danger-кнопка, ошибки полей, фокус, текст не только цветом), QA, final.
