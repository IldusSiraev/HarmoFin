# Уведомления на почту — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Участник семьи включает в настройках уведомления на почту, подтверждает адрес и получает срочные письма (просроченный платёж, напоминание календаря) и ежедневный или еженедельный дайджест событий семьи; суммы — только по согласию; отписка по ссылке из письма.

**Architecture:** Три новые таблицы: настройки канала на пользователя, очередь отправки (outbox) и токены подтверждения почты. API (`/api/v1`) отдаёт и меняет настройки, подтверждает почту и отписывает по токену. Воркер ставит срочные письма в очередь в той же транзакции, что и уведомление в приложении, раз в 15 минут ставит дайджесты на 08:00–11:59 по часовому поясу бюджета, раз в минуту отправляет очередь через SMTP с повторами и перепроверкой прав. Текст письма и суммы собираются только в момент отправки и нигде не хранятся.

**Tech Stack:** TypeScript strict, NestJS 11 + Fastify, Prisma 6 + PostgreSQL 18, zod 4, nodemailer 10.1.0, Vitest 4, Nuxt 4 / Vue 3.5, Playwright (только CI).

**Spec:** [docs/superpowers/specs/2026-10-31-email-notifications-design.md](../specs/2026-10-31-email-notifications-design.md) — читать целиком перед первой задачей. При расхождении плана и спецификации прав дизайн; расхождение сообщить координатору.

## Как выполнять этот план (для другой сессии)

- Ветка `feat/email-notifications` от свежего `main` (на ней закоммичены дизайн, правка функциональной спецификации и этот план). Перед каждым коммитом проверять `git branch --show-current`.
- Работа делится на 3 PR: задачи 1–3 — PR 1 (данные и API), 4–6 — PR 2 (воркер), 7–9 — PR 3 (веб). После последней задачи PR координатор останавливается и спрашивает владельца, открывать ли PR. Следующий PR начинается от свежего `main` после мержа предыдущего (`feat/email-notifications-worker`, `feat/email-notifications-web`), без worktree.
- Subagent-driven development: один writer на задачу; writer только индексирует изменения (`git add <пути>`), коммит делает координирующая сессия после review по таблице в конце плана. Если review вернул `BLOCK` — исправляет тот же writer, review повторяется.
- Ход выполнения вести в этом файле, в разделе «Ход выполнения» (задача, коммит, review, решения). Это единственный источник состояния для следующей сессии.

## Global Constraints

- Письма уходят только на подтверждённый адрес (`users.email_verified_at IS NOT NULL`) активного пользователя (`users.status = 'ACTIVE'`), который на момент отправки — активный участник рабочего пространства бюджета (`workspace_memberships.is_active`), в активном бюджете с `planModelVersion = 2`.
- Канал по умолчанию выключен (`enabled = false`), «срочные» по умолчанию включены (`urgentEnabled = true`), дайджест по умолчанию `DAILY`, суммы по умолчанию выключены. Значения по умолчанию действуют, пока строки настроек нет.
- Срочные письма — только `PLAN_OVERDUE` и `CALENDAR_REMINDER`. Дайджест — сводка по 16 видам ленты, без своих действий получателя и действий без автора, плюс платежи на сегодня.
- Суммы в письме — только при `includeAmounts = true`; включение требует `amountsConsent: true` в запросе (иначе 422 `AMOUNTS_CONSENT_REQUIRED`), время согласия хранится в `amountsConsentAt`, при выключении сбрасывается в `null`.
- Текст письма, суммы, адреса, токены не попадают в логи, метрики, аудит и строки очереди. `last_error` — только код/класс ошибки, до 200 символов.
- Токен отписки создаёт воркер для каждого письма: 32 случайных байта `base64url`; в `notification_deliveries.unsubscribe_token_hash` — SHA-256 hex. Токен подтверждения почты создаёт API через `TokenService` (HMAC, как `recovery_tokens`), живёт 24 часа.
- Новые эндпоинты — в `/api/v1` (аккаунт, не бюджет): `GET`/`PUT /api/v1/me/notification-settings/email`, `POST /api/v1/me/email-verification`, `POST /api/v1/auth/email-verification/confirm`, `POST /api/v1/notifications/unsubscribe`. Только добавление; все тела, ответы и ошибки описаны в OpenAPI. Тесты `/api/v2` (`v2-openapi.integration.test.ts`) эти пути не затрагивают.
- `List-Unsubscribe: <${WEB_BASE_URL}/unsubscribe?token=…>`; `List-Unsubscribe-Post` не ставится.
- Миграция только аддитивная, бэкфилла нет. Никогда не запускать `pnpm db:migrate:dev`, reset или откат на данных владельца (`harmofin`).
- UI-тексты и письма на русском, идентификаторы на английском. Calm Fintech: только существующие токены и компоненты, без новых цветов; статус — текстом, не только цветом.
- Local Playwright не запускать (только CI). Не создавать worktree. Не трогать `identity/logo_description.png`. Субагенты не запускают `pnpm infra:down` и не трогают dev-процессы владельца.
- Интеграционные тесты: весь набор — только `pnpm test:integration` (одноразовая БД `harmofin_v22_test`); один файл — `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts <файл>`. Перед первым запуском одного файла после новой миграции один раз прогнать `pnpm test:integration` — он применяет миграции к одноразовой БД.
- Интеграционные тесты обработчиков воркера живут в `apps/api/test/` и импортируют `../../worker/src/...` (так уже сделано для `NotificationRuleHandler`).
- `pnpm db:generate` может падать с EPERM, пока у владельца запущены dev-процессы (Windows держит движок Prisma). Процессы не трогать — сообщить координатору.
- `openapi.json` обновлять командой `node scripts/openapi/generate.mjs` после изменений контроллеров и DTO; затем `pnpm exec prettier --write openapi.json`.

## Уточнения к дизайну, найденные при подготовке плана

Дизайн уже обновлён этими правками; здесь — сводка для writer.

1. Подтверждения почты в коде не было: поле `users.email_verified_at` есть, но нигде не заполняется. Подтверждение по запросу входит в PR 1 (решение владельца 31.10.2026).
2. Хеш токена отписки нельзя хранить в настройках: воркеру нужен сам токен для ссылки. Токен создаётся на каждое письмо, хеш хранится в строке очереди.
3. Глобальный `OriginGuard` (`apps/api/src/common/security/origin.guard.ts`) отклоняет `POST` без `Origin`, поэтому отписка в один клик (RFC 8058) не поставлена; ссылка ведёт на страницу `/unsubscribe` в вебе, которая делает `POST` с origin веба.
4. Инварианты `v2-openapi.integration.test.ts` (каждая операция v2 — в пути бюджета, с `Idempotency-Key`, с 404/409) не подходят настройкам аккаунта и публичной отписке, поэтому пути — `/api/v1`.
5. Дайджест ставится в окне 08:00–11:59 местного времени: так он не уходит сразу, если пользователь включил его днём, и переживает простой воркера до 4 часов.
6. E2E в CI не запускает воркер (`e2e/playwright.config.ts` поднимает только API и веб). Путь «очередь → письмо» проверяется интеграционным тестом с подменённым отправителем.
7. Воркер без настроек SMTP (`SMTP_HOST` не задан) не регистрирует задачи доставки и дайджеста — так не ломаются текущие деплой и тесты конфига. В production compose переменные обязательны.
8. Удаление аккаунта (`apps/worker/src/account-purge.ts`) и сброс бюджета (`docs/runbooks/budget-reset.sql`) должны знать новые таблицы: `account-purge.coverage.test.ts` падает на неклассифицированной модели.

## Карта файлов

PR 1 — данные и API:

- `prisma/schema.prisma` — 4 enum, 3 модели, обратные связи, 2 значения `WorkerJobType`.
- `prisma/migrations/20261101000000_email_notifications/migration.sql` — новая миграция.
- `apps/worker/src/account-purge.ts`, `apps/worker/src/job-runner.ts` — новые таблицы в удалении аккаунта; задержки новых задач.
- `docs/runbooks/budget-reset.sql` — очистка очереди бюджета.
- `apps/api/test/helpers/family-app.ts` — очистка новых строк.
- `apps/api/test/email-notifications-schema.integration.test.ts` — ограничения схемы.
- `apps/api/src/auth/email-sender.ts`, `smtp-email.sender.ts` — письмо подтверждения.
- `apps/api/src/auth/email-verification.application.service.ts` (+ `.test.ts`), `email-verification.controller.ts`, `email-verification.dto.ts`, `email-verification.schemas.ts`; `auth.module.ts`, `auth-rate-limit.guard.ts` (+ тест).
- `apps/api/test/email-verification.integration.test.ts`.
- `apps/api/src/notification-settings/` — `notification-settings.schemas.ts`, `.dto.ts`, `.repository.ts`, `.application.service.ts` (+ `.test.ts`), `.controller.ts`, `.module.ts`, `mask-email.ts` (+ тест), `unsubscribe-token.ts`; `apps/api/src/app.module.ts`.
- `apps/api/test/notification-settings.integration.test.ts`.
- `openapi.json`.

PR 2 — воркер:

- `apps/worker/package.json` — `nodemailer`, `@types/nodemailer`.
- `apps/worker/src/config.ts` (+ тест) — почтовые переменные.
- `apps/worker/src/mail/format.ts`, `templates.ts`, `mailer.ts` (+ тесты).
- `apps/worker/src/delivery/delivery.repository.ts`, `eligibility.ts`, `urgent-content.ts`, `digest-content.ts`, `digest-sources.ts`, `deliver.handler.ts` (+ тесты).
- `apps/worker/src/delivery/enqueue.ts`, `digest-schedule.ts`, `build-digests.handler.ts` (+ тесты).
- `apps/worker/src/notification.handler.ts`, `calendar-reminder.handler.ts` (+ их тесты) — постановка срочных писем.
- `apps/worker/src/job.repository.ts`, `main.ts`, `logger.ts`, `observability/observability.ts`.
- `apps/api/test/email-delivery.integration.test.ts`, `apps/api/test/email-digest.integration.test.ts`.
- `infra/compose/production.yml`, `infra/env/staging.example`.

PR 3 — веб:

- `apps/web/app/composables/useNotificationSettings.ts` (+ тест), `useApiClient.ts` (+ тест).
- `apps/web/app/pages/app/settings/notifications.vue` (+ тест), `settings/index.vue`.
- `apps/web/app/pages/verify-email.vue`, `unsubscribe.vue` (+ тесты).
- `e2e/email-notifications.spec.ts`.
- `CLAUDE.md`, `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md` (статус в 18.6).

---

## PR 1 — данные и API

### Task 1: Схема, миграция, удаление аккаунта и сброс бюджета

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261101000000_email_notifications/migration.sql`
- Modify: `apps/worker/src/account-purge.ts`, `apps/worker/src/job-runner.ts`
- Modify: `docs/runbooks/budget-reset.sql`
- Modify: `apps/api/test/helpers/family-app.ts`
- Create: `apps/api/test/email-notifications-schema.integration.test.ts`

**Interfaces:**
- Produces: Prisma-модели `NotificationChannelSetting` (`notificationChannelSetting`), `NotificationDelivery` (`notificationDelivery`), `EmailVerificationToken` (`emailVerificationToken`); enum `NotificationChannel { EMAIL }`, `DigestFrequency { OFF DAILY WEEKLY }`, `DeliveryKind { URGENT DIGEST }`, `DeliveryStatus { PENDING SENT FAILED CANCELLED }`; составной уникальный ключ `userId_channel`; `WorkerJobType` + `DELIVER_NOTIFICATIONS`, `BUILD_EMAIL_DIGESTS`.

- [ ] **Step 1: Написать падающий тест схемы**

Create `apps/api/test/email-notifications-schema.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let other: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  other = await env.register();
});

afterAll(async () => {
  await env.stop();
});

function delivery(actor: FamilyActor, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    budgetId: actor.budgetId,
    userId: actor.user.id,
    channel: 'EMAIL' as const,
    kind: 'DIGEST' as const,
    dedupeKey: `digest:DAILY:${randomUUID()}`,
    nextAttemptAt: new Date(),
    ...overrides,
  };
}

describe('notification_channel_settings', () => {
  it('has safe defaults and one row per user and channel', async () => {
    const row = await env.prisma.notificationChannelSetting.create({
      data: { id: randomUUID(), userId: creator.user.id, channel: 'EMAIL' },
    });
    expect(row).toMatchObject({
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
    });
    await expect(
      env.prisma.notificationChannelSetting.create({
        data: { id: randomUUID(), userId: creator.user.id, channel: 'EMAIL' },
      }),
    ).rejects.toThrow();
  });
});

describe('notification_deliveries', () => {
  it('rejects a duplicate dedupe key for the same budget, user and channel', async () => {
    const first = delivery(creator);
    await env.prisma.notificationDelivery.create({ data: first });
    await expect(
      env.prisma.notificationDelivery.create({
        data: delivery(creator, { dedupeKey: first.dedupeKey }),
      }),
    ).rejects.toThrow();
  });

  it('defaults to PENDING with zero attempts', async () => {
    const row = await env.prisma.notificationDelivery.create({ data: delivery(creator) });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 0, unsubscribeTokenHash: null });
  });

  it('rejects a budget that belongs to another workspace', async () => {
    await expect(
      env.prisma.notificationDelivery.create({
        data: delivery(creator, { budgetId: other.budgetId }),
      }),
    ).rejects.toThrow();
  });
});

describe('email_verification_tokens', () => {
  it('stores a unique token hash', async () => {
    const tokenHash = 'a'.repeat(64);
    await env.prisma.emailVerificationToken.create({
      data: {
        id: randomUUID(),
        userId: creator.user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      env.prisma.emailVerificationToken.create({
        data: {
          id: randomUUID(),
          userId: other.user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Убедиться, что тест не компилируется**

Run: `pnpm --filter @harmofin/api typecheck`
Expected: FAIL — `Property 'notificationChannelSetting' does not exist on type 'PrismaClient'`.

- [ ] **Step 3: Добавить модели в схему**

В `prisma/schema.prisma`:

В `enum WorkerJobType` дописать два значения после `EVALUATE_CALENDAR_REMINDERS`:

```prisma
  DELIVER_NOTIFICATIONS
  BUILD_EMAIL_DIGESTS
```

После `enum NotificationType { … }` добавить:

```prisma
enum NotificationChannel {
  EMAIL
}

enum DigestFrequency {
  OFF
  DAILY
  WEEKLY
}

enum DeliveryKind {
  URGENT
  DIGEST
}

enum DeliveryStatus {
  PENDING
  SENT
  FAILED
  CANCELLED
}
```

После `model Notification { … }` добавить:

```prisma
model NotificationChannelSetting {
  id               String              @id @db.Uuid
  userId           String              @map("user_id") @db.Uuid
  channel          NotificationChannel
  enabled          Boolean             @default(false)
  urgentEnabled    Boolean             @default(true) @map("urgent_enabled")
  digestFrequency  DigestFrequency     @default(DAILY) @map("digest_frequency")
  includeAmounts   Boolean             @default(false) @map("include_amounts")
  amountsConsentAt DateTime?           @map("amounts_consent_at") @db.Timestamptz(3)
  createdAt        DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime            @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([userId, channel])
  @@index([channel, enabled])
  @@map("notification_channel_settings")
}

model NotificationDelivery {
  id                   String              @id @db.Uuid
  workspaceId          String              @map("workspace_id") @db.Uuid
  budgetId             String              @map("budget_id") @db.Uuid
  userId               String              @map("user_id") @db.Uuid
  channel              NotificationChannel
  kind                 DeliveryKind
  notificationId       String?             @map("notification_id") @db.Uuid
  digestPeriodStart    DateTime?           @map("digest_period_start") @db.Timestamptz(3)
  digestPeriodEnd      DateTime?           @map("digest_period_end") @db.Timestamptz(3)
  dedupeKey            String              @map("dedupe_key") @db.VarChar(255)
  status               DeliveryStatus      @default(PENDING)
  attempts             Int                 @default(0)
  nextAttemptAt        DateTime            @map("next_attempt_at") @db.Timestamptz(3)
  sentAt               DateTime?           @map("sent_at") @db.Timestamptz(3)
  lastError            String?             @map("last_error") @db.VarChar(200)
  unsubscribeTokenHash String?             @unique @map("unsubscribe_token_hash") @db.Char(64)
  createdAt            DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt            DateTime            @updatedAt @map("updated_at") @db.Timestamptz(3)

  workspace    Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  budget       Budget        @relation(fields: [budgetId, workspaceId], references: [id, workspaceId], onDelete: Restrict, onUpdate: Cascade)
  user         User          @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  notification Notification? @relation(fields: [notificationId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([budgetId, userId, channel, dedupeKey])
  @@index([status, nextAttemptAt])
  @@index([userId, budgetId, kind, digestPeriodEnd])
  @@map("notification_deliveries")
}
```

После `model RecoveryToken { … }` добавить:

```prisma
model EmailVerificationToken {
  id         String    @id @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  tokenHash  String    @unique @map("token_hash") @db.Char(64)
  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(3)
  consumedAt DateTime? @map("consumed_at") @db.Timestamptz(3)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([userId, consumedAt, expiresAt])
  @@map("email_verification_tokens")
}
```

Обратные связи (имена полей — ровно такие):
- в `model User`: `notificationChannelSettings NotificationChannelSetting[]`, `notificationDeliveries NotificationDelivery[]`, `emailVerificationTokens EmailVerificationToken[]`;
- в `model Workspace`: `notificationDeliveries NotificationDelivery[]`;
- в `model Budget`: `notificationDeliveries NotificationDelivery[]`;
- в `model Notification`: `deliveries NotificationDelivery[]`.

Run: `pnpm --filter @harmofin/api exec prisma format --schema ../../prisma/schema.prisma` и `pnpm db:generate`.

- [ ] **Step 4: Написать миграцию**

Create `prisma/migrations/20261101000000_email_notifications/migration.sql`:

```sql
-- Email notifications: per-user channel settings, delivery outbox, email verification tokens.
-- Additive: new enums, new tables, two new worker job types; no backfill.

-- AlterEnum
ALTER TYPE "WorkerJobType" ADD VALUE IF NOT EXISTS 'DELIVER_NOTIFICATIONS';
ALTER TYPE "WorkerJobType" ADD VALUE IF NOT EXISTS 'BUILD_EMAIL_DIGESTS';

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');
CREATE TYPE "DigestFrequency" AS ENUM ('OFF', 'DAILY', 'WEEKLY');
CREATE TYPE "DeliveryKind" AS ENUM ('URGENT', 'DIGEST');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "notification_channel_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "urgent_enabled" BOOLEAN NOT NULL DEFAULT true,
    "digest_frequency" "DigestFrequency" NOT NULL DEFAULT 'DAILY',
    "include_amounts" BOOLEAN NOT NULL DEFAULT false,
    "amounts_consent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notification_channel_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "kind" "DeliveryKind" NOT NULL,
    "notification_id" UUID,
    "digest_period_start" TIMESTAMPTZ(3),
    "digest_period_end" TIMESTAMPTZ(3),
    "dedupe_key" VARCHAR(255) NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(200),
    "unsubscribe_token_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_channel_settings_user_id_channel_key" ON "notification_channel_settings"("user_id", "channel");
CREATE INDEX "notification_channel_settings_channel_enabled_idx" ON "notification_channel_settings"("channel", "enabled");
CREATE UNIQUE INDEX "notification_deliveries_unsubscribe_token_hash_key" ON "notification_deliveries"("unsubscribe_token_hash");
CREATE UNIQUE INDEX "notification_deliveries_budget_id_user_id_channel_dedupe_key_key" ON "notification_deliveries"("budget_id", "user_id", "channel", "dedupe_key");
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");
CREATE INDEX "notification_deliveries_user_id_budget_id_kind_digest_period_end_idx" ON "notification_deliveries"("user_id", "budget_id", "kind", "digest_period_end");
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE INDEX "email_verification_tokens_user_id_consumed_at_expires_at_idx" ON "email_verification_tokens"("user_id", "consumed_at", "expires_at");

-- AddForeignKey
ALTER TABLE "notification_channel_settings" ADD CONSTRAINT "notification_channel_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_budget_id_workspace_id_fkey" FOREIGN KEY ("budget_id", "workspace_id") REFERENCES "budgets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Проверить, что схема и миграция совпадают (пустой вывод = совпадают; команда не трогает данные владельца — сравнивает с одноразовой БД после применения миграций):

Run: `pnpm test:integration` (применит миграции к одноразовой `harmofin_v22_test`), затем
`pnpm --filter @harmofin/api exec prisma migrate diff --from-url 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' --to-schema-datamodel ../../prisma/schema.prisma --script`
Expected: вывод без `CREATE`/`ALTER` (только комментарий о пустой миграции). Если есть разница — поправить SQL до совпадения с именами, которые генерирует Prisma.

- [ ] **Step 5: Задержки новых задач воркера**

`RECURRING_DELAY_MS` в `apps/worker/src/job-runner.ts` типизирован `Record<WorkerJobType, number>` и без новых ключей не компилируется. Дописать:

```ts
  DELIVER_NOTIFICATIONS: 60_000,
  BUILD_EMAIL_DIGESTS: 900_000,
```

Регистрацию задач в `recurringJobs` и обработчики добавят задачи 5 и 6.

- [ ] **Step 6: Удаление аккаунта знает новые таблицы**

Run: `pnpm --filter @harmofin/worker test -- account-purge.coverage`
Expected: FAIL — в списке неклассифицированных `NotificationDelivery -> notification_deliveries`, `NotificationChannelSetting -> notification_channel_settings`, `EmailVerificationToken -> email_verification_tokens`.

В `apps/worker/src/account-purge.ts`:

- `BUDGET_TABLES_IN_DELETE_ORDER`: вставить `'notification_deliveries',` строкой перед `'notifications',` (очередь ссылается на уведомления);
- `WORKSPACE_SCOPE_TABLES`: вставить `'notification_deliveries',` первым элементом;
- `USER_OWNED_TABLES`: дописать `'notification_channel_settings', 'email_verification_tokens', 'notification_deliveries',`;
- в `purgeUserData`, в блоке `if (workspaceIds.length > 0)`, первой строкой:

```ts
    await tx.$executeRaw`DELETE FROM "notification_deliveries" WHERE "workspace_id" = ANY(${workspaceIds}::uuid[])`;
```

- после строки удаления `activity_feed_cursors` по `user_id`:

```ts
  // The user's own mail queue and email settings: personal state, never shared history.
  await tx.$executeRaw`DELETE FROM "notification_deliveries" WHERE "user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "notification_channel_settings" WHERE "user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "email_verification_tokens" WHERE "user_id" = ${userId}::uuid`;
```

Если `SCOPE_COVERED_TABLES` собирается не из списков выше, а перечнем — дописать в него `notification_deliveries`.

Run: `pnpm --filter @harmofin/worker test -- account-purge`
Expected: PASS.

- [ ] **Step 7: Сброс бюджета и очистка тестов**

В `docs/runbooks/budget-reset.sql` перед блоком `DELETE FROM notifications WHERE budget_id = v_budget_id;` вставить:

```sql
  DELETE FROM notification_deliveries WHERE budget_id = v_budget_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('notification_deliveries', v_n);

```

Если `apps/api/test/budget-reset-script.integration.test.ts` сверяет полный список ключей `deletedRows` или таблиц в `counts()` — дописать туда `notification_deliveries` в том же порядке.

В `apps/api/test/helpers/family-app.ts`, метод `cleanup`, первой строкой после вычисления `byBudget`:

```ts
    await this.prisma.notificationDelivery.deleteMany({ where: { workspaceId: { in: ids } } });
```

и в цикле `for (const userId of this.userIds)` перед удалением сессий:

```ts
      await this.prisma.notificationDelivery.deleteMany({ where: { userId } });
      await this.prisma.notificationChannelSetting.deleteMany({ where: { userId } });
      await this.prisma.emailVerificationToken.deleteMany({ where: { userId } });
```

- [ ] **Step 8: Прогнать проверки**

Run: `pnpm test:integration`
Expected: PASS, включая `email-notifications-schema`, `budget-reset-script`, `account-deletion`.

Run: `pnpm typecheck && pnpm --filter @harmofin/worker test`
Expected: PASS.

- [ ] **Step 9: Проиндексировать**

```bash
git add prisma/schema.prisma prisma/migrations/20261101000000_email_notifications apps/worker/src/account-purge.ts apps/worker/src/job-runner.ts docs/runbooks/budget-reset.sql apps/api/test/helpers/family-app.ts apps/api/test/email-notifications-schema.integration.test.ts apps/api/test/budget-reset-script.integration.test.ts
```

Коммит (делает координатор): `feat(db): таблицы настроек почты, очереди писем и подтверждения адреса`.

---

### Task 2: Подтверждение почты

**Files:**
- Modify: `apps/api/src/auth/email-sender.ts`, `apps/api/src/auth/smtp-email.sender.ts`, `apps/api/src/auth/smtp-email.sender.test.ts`
- Create: `apps/api/src/auth/email-verification.schemas.ts`, `email-verification.dto.ts`, `email-verification.application.service.ts`, `email-verification.application.service.test.ts`, `email-verification.controller.ts`
- Modify: `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/auth-rate-limit.guard.ts`, `apps/api/src/auth/auth-rate-limit.guard.test.ts`
- Modify: `apps/api/src/account-deletion/account-deletion.application.service.test.ts` (фейк `EmailSender`)
- Create: `apps/api/test/email-verification.integration.test.ts`
- Modify: `openapi.json`

**Interfaces:**
- Consumes: `EmailVerificationToken` из задачи 1; `TokenService` (`createRawToken(): string`, `digest(raw): string`); `EMAIL_SENDER`; `createUuidV7(now?: Date)` из `apps/api/src/common/identifiers/uuid-v7.js`; `requestMeta`, `requiredContext`, `AuthenticatedRequest` из `apps/api/src/auth/auth-http.js`.
- Produces: `POST /api/v1/me/email-verification` → 204; `POST /api/v1/auth/email-verification/confirm` `{ token }` → 204 / 422 `EMAIL_VERIFICATION_TOKEN_INVALID`; `EmailSender.sendEmailVerification(input: { recipient: string; verifyUrl: string }): Promise<void>`; аудит `entityType: 'auth'`, `action: 'EMAIL_VERIFICATION_REQUESTED' | 'EMAIL_VERIFIED'`.

- [ ] **Step 1: Написать падающий юнит-тест сервиса**

Create `apps/api/src/auth/email-verification.application.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { EmailVerificationApplicationService } from './email-verification.application.service.js';
import { TokenService } from './token.service.js';

const tokens = new TokenService('test-only-secret-with-at-least-32-bytes');
const config = { mail: { webBaseUrl: 'https://app.example.test' } };

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    emailVerificationToken: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
    },
    user: { update: vi.fn().mockResolvedValue({}) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

function makeService(user: unknown, tx = makeTx()) {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    $transaction: vi.fn((callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  };
  const sender = { sendEmailVerification: vi.fn().mockResolvedValue(undefined) };
  const service = new EmailVerificationApplicationService(
    prisma as never,
    tokens,
    sender as never,
    config as never,
  );
  return { service, prisma, sender, tx };
}

describe('EmailVerificationApplicationService.request', () => {
  it('stores only the token digest and mails a link with the raw token', async () => {
    const { service, sender, tx } = makeService({
      email: 'anna@example.test',
      status: 'ACTIVE',
      emailVerifiedAt: null,
    });

    await service.request('user-1', {});

    const created = tx.emailVerificationToken.create.mock.calls[0]![0].data;
    const link = new URL(sender.sendEmailVerification.mock.calls[0]![0].verifyUrl);
    expect(link.origin + link.pathname).toBe('https://app.example.test/verify-email');
    const raw = link.searchParams.get('token')!;
    expect(created.tokenHash).toBe(tokens.digest(raw));
    expect(created.tokenHash).not.toContain(raw);
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(tx.emailVerificationToken.updateMany).toHaveBeenCalled();
    expect(tx.auditEvent.create.mock.calls[0]![0].data).toMatchObject({
      action: 'EMAIL_VERIFICATION_REQUESTED',
      entityType: 'auth',
    });
    expect(JSON.stringify(tx.auditEvent.create.mock.calls)).not.toContain('anna@example.test');
  });

  it('does nothing for an already verified address', async () => {
    const { service, sender, prisma } = makeService({
      email: 'anna@example.test',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });

    await service.request('user-1', {});

    expect(sender.sendEmailVerification).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('EmailVerificationApplicationService.confirm', () => {
  it('consumes the token and marks the address verified', async () => {
    const tx = makeTx();
    tx.emailVerificationToken.findFirst.mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      user: { status: 'ACTIVE' },
    });
    const { service } = makeService(null, tx);

    await service.confirm('raw-token', {});

    expect(tx.emailVerificationToken.findFirst.mock.calls[0]![0].where.tokenHash).toBe(
      tokens.digest('raw-token'),
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerifiedAt: expect.any(Date) },
    });
    expect(tx.auditEvent.create.mock.calls[0]![0].data.action).toBe('EMAIL_VERIFIED');
  });

  it('rejects an unknown, used or expired token with 422', async () => {
    const tx = makeTx();
    tx.emailVerificationToken.findFirst.mockResolvedValue(null);
    const { service } = makeService(null, tx);

    await expect(service.confirm('bad', {})).rejects.toMatchObject({
      status: 422,
      response: { code: 'EMAIL_VERIFICATION_TOKEN_INVALID' },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @harmofin/api test -- email-verification.application`
Expected: FAIL — `Cannot find module './email-verification.application.service.js'`.

- [ ] **Step 3: Отправитель письма**

В `apps/api/src/auth/email-sender.ts` в интерфейс `EmailSender` дописать:

```ts
  sendEmailVerification(input: { recipient: string; verifyUrl: string }): Promise<void>;
```

В `apps/api/src/auth/smtp-email.sender.ts` дописать метод в класс:

```ts
  async sendEmailVerification(input: { recipient: string; verifyUrl: string }): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.mail.from,
      to: input.recipient,
      subject: 'Подтвердите почту в HarmoFin',
      text: [
        'Чтобы получать уведомления HarmoFin на эту почту, подтвердите адрес по ссылке:',
        input.verifyUrl,
        '',
        'Ссылка действует 24 часа. Если вы не запрашивали подтверждение, просто проигнорируйте письмо.',
      ].join('\n'),
    });
  }
```

В `smtp-email.sender.test.ts` добавить тест по образцу соседних (проверить `to`, `subject`, что `text` содержит `verifyUrl`). В фейке `EmailSender` в `account-deletion.application.service.test.ts` дописать `sendEmailVerification: vi.fn()`. Найти другие фейки: `grep -rn "sendFamilyInvitation:" apps/api --include=*.ts` — дописать туда так же.

- [ ] **Step 4: Схема, DTO и сервис**

Create `apps/api/src/auth/email-verification.schemas.ts`:

```ts
import { z } from 'zod';

export const emailVerificationConfirmSchema = z
  .object({ token: z.string().min(1).max(256) })
  .strict();

export type EmailVerificationConfirmInput = z.infer<typeof emailVerificationConfirmSchema>;
```

Create `apps/api/src/auth/email-verification.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class EmailVerificationConfirmRequest {
  @ApiProperty({ description: 'Токен из ссылки письма подтверждения.', maxLength: 256 })
  token!: string;
}
```

Create `apps/api/src/auth/email-verification.application.service.ts`:

```ts
import { UnprocessableEntityException } from '@nestjs/common';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { ApiConfig } from '../config/env.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { EmailSender } from './email-sender.js';
import type { TokenService } from './token.service.js';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;

type Meta = { requestId?: string };

/**
 * On-demand email confirmation, the prerequisite for email notifications. Mirrors password
 * recovery: only the HMAC digest of the token is stored, a new request voids the previous unused
 * tokens, and the address and the token never reach the audit trail.
 */
export class EmailVerificationApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly emailSender: EmailSender,
    private readonly config: Pick<ApiConfig, 'mail'>,
  ) {}

  async request(userId: string, meta: Meta): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true, emailVerifiedAt: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) return;

    const rawToken = this.tokens.createRawToken();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      await tx.emailVerificationToken.create({
        data: {
          id: createUuidV7(now),
          userId,
          tokenHash: this.tokens.digest(rawToken),
          expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: userId,
          entityType: 'auth',
          entityId: userId,
          action: 'EMAIL_VERIFICATION_REQUESTED',
          source: 'API',
          requestId: meta.requestId ?? null,
        },
      });
    });

    const verifyUrl = new URL('/verify-email', this.config.mail.webBaseUrl);
    verifyUrl.searchParams.set('token', rawToken);
    await this.emailSender.sendEmailVerification({
      recipient: user.email,
      verifyUrl: verifyUrl.toString(),
    });
  }

  async confirm(token: string, meta: Meta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const row = await tx.emailVerificationToken.findFirst({
        where: { tokenHash: this.tokens.digest(token), consumedAt: null, expiresAt: { gt: now } },
        select: { id: true, userId: true, user: { select: { status: true } } },
      });
      if (!row || row.user.status !== 'ACTIVE') throw invalidToken();
      const consumed = await tx.emailVerificationToken.updateMany({
        where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw invalidToken();
      await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: row.userId,
          entityType: 'auth',
          entityId: row.userId,
          action: 'EMAIL_VERIFIED',
          source: 'API',
          requestId: meta.requestId ?? null,
        },
      });
    });
  }
}

function invalidToken(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'EMAIL_VERIFICATION_TOKEN_INVALID',
    detail: 'Ссылка подтверждения недействительна или устарела. Запросите новую в настройках.',
  });
}
```

Run: `pnpm --filter @harmofin/api test -- email-verification.application`
Expected: PASS.

- [ ] **Step 5: Контроллер, модуль, ограничение частоты**

Create `apps/api/src/auth/email-verification.controller.ts`:

```ts
import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { requestMeta, requiredContext, type AuthenticatedRequest } from './auth-http.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { EmailVerificationApplicationService } from './email-verification.application.service.js';
import { EmailVerificationConfirmRequest } from './email-verification.dto.js';
import {
  emailVerificationConfirmSchema,
  type EmailVerificationConfirmInput,
} from './email-verification.schemas.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@ApiTags('auth')
@Controller()
export class EmailVerificationController {
  constructor(
    @Inject(EmailVerificationApplicationService)
    private readonly service: EmailVerificationApplicationService,
  ) {}

  @Post('me/email-verification')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard, AuthRateLimitGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Отправить письмо подтверждения почты',
    description:
      'Гасит прежние неиспользованные ссылки и отправляет новую на 24 часа. Если почта уже подтверждена — 204 без письма. Коды: 401, 403 CSRF_INVALID/ORIGIN_REQUIRED, 429 AUTH_RATE_LIMITED.',
  })
  @ApiNoContentResponse({ description: 'Запрос принят.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async request(@Req() request: AuthenticatedRequest): Promise<void> {
    const meta = requestMeta(request);
    await this.service.request(requiredContext(request).userId, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
  }

  @Post('auth/email-verification/confirm')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({
    summary: 'Подтвердить почту по ссылке из письма',
    description:
      'Публичный: открывается из письма, возможно без входа. Без сессии и CSRF; глобальный OriginGuard требует origin веба. Коды: 400 VALIDATION_FAILED, 403 ORIGIN_REQUIRED, 422 EMAIL_VERIFICATION_TOKEN_INVALID, 429 AUTH_RATE_LIMITED.',
  })
  @ApiBody({ type: EmailVerificationConfirmRequest })
  @ApiNoContentResponse({ description: 'Почта подтверждена.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async confirm(
    @Body(new ZodValidationPipe(emailVerificationConfirmSchema))
    input: EmailVerificationConfirmInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const meta = requestMeta(request);
    await this.service.confirm(input.token, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
  }
}
```

В `apps/api/src/auth/auth.module.ts`: `controllers: [AuthController, EmailVerificationController]`; в `providers` добавить:

```ts
        {
          provide: EmailVerificationApplicationService,
          useFactory: (prisma: PrismaService, tokens: TokenService, emailSender: EmailSender) =>
            new EmailVerificationApplicationService(prisma, tokens, emailSender, config),
          inject: [PrismaService, TokenService, EMAIL_SENDER],
        },
```

(импорт `type EmailSender` из `./email-sender.js`).

В `apps/api/src/auth/auth-rate-limit.guard.ts`, метод `maximumFor`, перед `return null;`:

```ts
    if (url.startsWith('/api/v1/me/email-verification')) return this.config.rateLimit.recoveryMax;
    if (url.startsWith('/api/v1/auth/email-verification/confirm'))
      return this.config.rateLimit.recoveryMax;
    if (url.startsWith('/api/v1/notifications/unsubscribe'))
      return this.config.rateLimit.recoveryMax;
```

В `auth-rate-limit.guard.test.ts` добавить тест по образцу соседних: шестой `POST /api/v1/auth/email-verification/confirm` с одного IP при `recoveryMax: 5` → 429, `/api/v1/notifications/unsubscribe` — так же.

- [ ] **Step 6: Интеграционный тест**

Create `apps/api/test/email-verification.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TokenService } from '../src/auth/token.service.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const tokens = new TokenService('test-only-secret-with-at-least-32-bytes');
const origin = 'http://localhost:3000';
let actor: FamilyActor;

async function plantToken(userId: string, raw: string, expiresInMs = 60_000) {
  await env.prisma.emailVerificationToken.create({
    data: {
      id: randomUUID(),
      userId,
      tokenHash: tokens.digest(raw),
      expiresAt: new Date(Date.now() + expiresInMs),
    },
  });
}

const confirm = (token: string) =>
  env.server.inject({
    method: 'POST',
    url: '/api/v1/auth/email-verification/confirm',
    headers: { origin },
    payload: { token },
  });

beforeAll(async () => {
  await env.start();
  actor = await env.register();
});

afterAll(async () => {
  await env.stop();
});

describe('email verification', () => {
  it('requires a session and CSRF to request a letter', async () => {
    const anonymous = await env.server.inject({
      method: 'POST',
      url: '/api/v1/me/email-verification',
      headers: { origin },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('stores a hashed token on request', async () => {
    const response = await env.inject('POST', '/api/v1/me/email-verification', actor);
    expect(response.statusCode).toBe(204);
    const rows = await env.prisma.emailVerificationToken.findMany({
      where: { userId: actor.user.id, consumedAt: null },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('confirms with a valid token once', async () => {
    await plantToken(actor.user.id, 'valid-token');
    expect((await confirm('valid-token')).statusCode).toBe(204);
    const user = await env.prisma.user.findUniqueOrThrow({ where: { id: actor.user.id } });
    expect(user.emailVerifiedAt).not.toBeNull();

    const again = await confirm('valid-token');
    expect(again.statusCode).toBe(422);
    expect(again.json()).toMatchObject({ code: 'EMAIL_VERIFICATION_TOKEN_INVALID' });
  });

  it('rejects an expired token', async () => {
    const other = await env.register();
    await plantToken(other.user.id, 'expired-token', -1_000);
    expect((await confirm('expired-token')).statusCode).toBe(422);
  });

  it('sends nothing and stores nothing once verified', async () => {
    const before = await env.prisma.emailVerificationToken.count({
      where: { userId: actor.user.id },
    });
    expect((await env.inject('POST', '/api/v1/me/email-verification', actor)).statusCode).toBe(204);
    expect(
      await env.prisma.emailVerificationToken.count({ where: { userId: actor.user.id } }),
    ).toBe(before);
  });

  it('writes audit without the address', async () => {
    const audits = await env.prisma.auditEvent.findMany({
      where: { entityId: actor.user.id, action: { in: ['EMAIL_VERIFICATION_REQUESTED', 'EMAIL_VERIFIED'] } },
    });
    expect(audits.map((item) => item.action).sort()).toEqual([
      'EMAIL_VERIFICATION_REQUESTED',
      'EMAIL_VERIFIED',
    ]);
    expect(JSON.stringify(audits)).not.toContain(actor.user.email);
  });
});
```

Тест запроса письма шлёт реальное SMTP на `127.0.0.1:1025` (Mailpit поднят `pnpm infra:up` локально и сервисом в CI) — так же, как существующие тесты восстановления пароля.

Run: `pnpm test:integration -- email-verification`
Expected: PASS.

- [ ] **Step 7: OpenAPI и проверки**

Run: `node scripts/openapi/generate.mjs && pnpm exec prettier --write openapi.json`
Run: `pnpm --filter @harmofin/api test && pnpm typecheck && pnpm lint`
Expected: PASS; в `openapi.json` появились оба пути с 204 и описанными ошибками.

- [ ] **Step 8: Проиндексировать**

```bash
git add apps/api/src/auth apps/api/src/account-deletion/account-deletion.application.service.test.ts apps/api/test/email-verification.integration.test.ts openapi.json
```

Коммит: `feat(api): подтверждение почты по ссылке из письма`.

---

### Task 3: Настройки уведомлений на почту и отписка

**Files:**
- Create: `apps/api/src/notification-settings/mask-email.ts`, `mask-email.test.ts`, `unsubscribe-token.ts`, `notification-settings.schemas.ts`, `notification-settings.dto.ts`, `notification-settings.repository.ts`, `notification-settings.application.service.ts`, `notification-settings.application.service.test.ts`, `notification-settings.controller.ts`, `notification-settings.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/notification-settings.integration.test.ts`
- Modify: `openapi.json`

**Interfaces:**
- Consumes: модели задачи 1; `AuthRateLimitGuard` с путём `/api/v1/notifications/unsubscribe` (задача 2).
- Produces:
  - `GET /api/v1/me/notification-settings/email` → `EmailNotificationSettingsResponse`:
    `{ email: string; emailVerified: boolean; enabled: boolean; urgentEnabled: boolean; digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY'; includeAmounts: boolean; amountsConsentAt: string | null }`;
  - `PUT` то же тело без `email`, `emailVerified`, `amountsConsentAt` и с `amountsConsent?: boolean` → тот же ответ; 409 `EMAIL_NOT_VERIFIED`; 422 `AMOUNTS_CONSENT_REQUIRED` с `fieldErrors[0].field = 'includeAmounts'`;
  - `POST /api/v1/notifications/unsubscribe` `{ token }` → 204 всегда (неизвестный токен тоже);
  - `hashUnsubscribeToken(raw: string): string` — SHA-256 hex (воркер в задаче 5 использует тот же алгоритм);
  - аудит `entityType: 'notification_settings'`, `action: 'UPDATED' | 'AMOUNTS_CONSENT_GRANTED' | 'AMOUNTS_CONSENT_REVOKED' | 'UNSUBSCRIBED'`, `newValues` без адреса.

- [ ] **Step 1: Падающие юнит-тесты**

Create `apps/api/src/notification-settings/mask-email.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { maskEmail } from './mask-email.js';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('anna.petrova@example.test')).toBe('a***@example.test');
  });

  it('masks a one-letter local part', () => {
    expect(maskEmail('a@example.test')).toBe('a***@example.test');
  });
});
```

Create `apps/api/src/notification-settings/notification-settings.application.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { NotificationSettingsApplicationService } from './notification-settings.application.service.js';
import { hashUnsubscribeToken } from './unsubscribe-token.js';

const verifiedUser = { email: 'anna@example.test', emailVerifiedAt: new Date('2026-10-01') };

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback({})),
    findUser: vi.fn().mockResolvedValue(verifiedUser),
    findEmailSetting: vi.fn().mockResolvedValue(null),
    upsertEmailSetting: vi.fn(async (_tx: unknown, _userId: string, values: object) => ({
      id: 'setting-1',
      ...values,
    })),
    audit: vi.fn().mockResolvedValue(undefined),
    findDeliveryByTokenHash: vi.fn().mockResolvedValue(null),
    disableChannel: vi.fn().mockResolvedValue({ id: 'setting-1', changed: true }),
    ...overrides,
  };
}

const input = {
  enabled: true,
  urgentEnabled: true,
  digestFrequency: 'DAILY' as const,
  includeAmounts: false,
};

describe('NotificationSettingsApplicationService', () => {
  it('returns defaults with a masked address when nothing is stored', async () => {
    const service = new NotificationSettingsApplicationService(makeRepository() as never);
    await expect(service.getEmail('user-1')).resolves.toEqual({
      email: 'a***@example.test',
      emailVerified: true,
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
    });
  });

  it('refuses to enable the channel for an unverified address', async () => {
    const repository = makeRepository({
      findUser: vi.fn().mockResolvedValue({ email: 'a@x.test', emailVerifiedAt: null }),
    });
    const service = new NotificationSettingsApplicationService(repository as never);
    await expect(service.updateEmail('user-1', input, {})).rejects.toMatchObject({
      status: 409,
      response: { code: 'EMAIL_NOT_VERIFIED' },
    });
    expect(repository.upsertEmailSetting).not.toHaveBeenCalled();
  });

  it('allows disabling the channel for an unverified address', async () => {
    const repository = makeRepository({
      findUser: vi.fn().mockResolvedValue({ email: 'a@x.test', emailVerifiedAt: null }),
    });
    const service = new NotificationSettingsApplicationService(repository as never);
    await service.updateEmail('user-1', { ...input, enabled: false }, {});
    expect(repository.upsertEmailSetting).toHaveBeenCalled();
  });

  it('requires explicit consent to turn amounts on and records the moment', async () => {
    const repository = makeRepository();
    const service = new NotificationSettingsApplicationService(repository as never);
    await expect(
      service.updateEmail('user-1', { ...input, includeAmounts: true }, {}),
    ).rejects.toMatchObject({ status: 422, response: { code: 'AMOUNTS_CONSENT_REQUIRED' } });

    await service.updateEmail('user-1', { ...input, includeAmounts: true, amountsConsent: true }, {});
    const values = repository.upsertEmailSetting.mock.calls[0]![2];
    expect(values.amountsConsentAt).toBeInstanceOf(Date);
    expect(repository.audit.mock.calls.map((call) => call[2].action)).toEqual([
      'UPDATED',
      'AMOUNTS_CONSENT_GRANTED',
    ]);
  });

  it('keeps the original consent moment while amounts stay on and clears it when turned off', async () => {
    const consentAt = new Date('2026-10-20T10:00:00.000Z');
    const repository = makeRepository({
      findEmailSetting: vi.fn().mockResolvedValue({
        id: 'setting-1',
        enabled: true,
        urgentEnabled: true,
        digestFrequency: 'DAILY',
        includeAmounts: true,
        amountsConsentAt: consentAt,
      }),
    });
    const service = new NotificationSettingsApplicationService(repository as never);

    await service.updateEmail('user-1', { ...input, includeAmounts: true }, {});
    expect(repository.upsertEmailSetting.mock.calls[0]![2].amountsConsentAt).toBe(consentAt);

    await service.updateEmail('user-1', { ...input, includeAmounts: false }, {});
    expect(repository.upsertEmailSetting.mock.calls[1]![2].amountsConsentAt).toBeNull();
    expect(repository.audit.mock.calls.at(-1)![2].action).toBe('AMOUNTS_CONSENT_REVOKED');
  });

  it('unsubscribes by the hash of the token and ignores unknown tokens', async () => {
    const repository = makeRepository({
      findDeliveryByTokenHash: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'user-1', channel: 'EMAIL' }),
    });
    const service = new NotificationSettingsApplicationService(repository as never);

    await service.unsubscribe('unknown', {});
    expect(repository.disableChannel).not.toHaveBeenCalled();

    await service.unsubscribe('raw-token', {});
    expect(repository.findDeliveryByTokenHash.mock.calls[1]![1]).toBe(
      hashUnsubscribeToken('raw-token'),
    );
    expect(repository.disableChannel).toHaveBeenCalledWith({}, 'user-1', 'EMAIL');
    expect(repository.audit.mock.calls.at(-1)![2].action).toBe('UNSUBSCRIBED');
  });
});
```

Run: `pnpm --filter @harmofin/api test -- notification-settings mask-email`
Expected: FAIL — модули не найдены.

- [ ] **Step 2: Вспомогательные функции и схемы**

Create `apps/api/src/notification-settings/mask-email.ts`:

```ts
/** Shows enough of the address to recognize it without exposing it in full on screen. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
```

Create `apps/api/src/notification-settings/unsubscribe-token.ts`:

```ts
import { createHash } from 'node:crypto';

/**
 * The worker mints a random 32-byte token per letter and stores this digest on the delivery row
 * (apps/worker/src/delivery/deliver.handler.ts). Plain SHA-256 is enough for a random token, and
 * the worker has no access to AUTH_TOKEN_HASH_SECRET.
 */
export function hashUnsubscribeToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
```

Create `apps/api/src/notification-settings/notification-settings.schemas.ts`:

```ts
import { z } from 'zod';

export const updateEmailSettingsSchema = z
  .object({
    enabled: z.boolean(),
    urgentEnabled: z.boolean(),
    digestFrequency: z.enum(['OFF', 'DAILY', 'WEEKLY']),
    includeAmounts: z.boolean(),
    amountsConsent: z.boolean().optional(),
  })
  .strict();

export const unsubscribeSchema = z.object({ token: z.string().min(1).max(256) }).strict();

export type UpdateEmailSettingsInput = z.infer<typeof updateEmailSettingsSchema>;
export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>;
```

Create `apps/api/src/notification-settings/notification-settings.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

const FREQUENCIES = ['OFF', 'DAILY', 'WEEKLY'] as const;

export class EmailNotificationSettingsResponse {
  @ApiProperty({ description: 'Адрес аккаунта, частично скрыт: a***@example.com.' })
  email!: string;

  @ApiProperty({ description: 'Адрес подтверждён; без этого канал не включить.' })
  emailVerified!: boolean;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ description: 'Просроченный платёж и напоминание календаря.' })
  urgentEnabled!: boolean;

  @ApiProperty({ enum: FREQUENCIES, description: 'В 08:00 по часовому поясу бюджета.' })
  digestFrequency!: (typeof FREQUENCIES)[number];

  @ApiProperty()
  includeAmounts!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  amountsConsentAt!: string | null;
}

export class UpdateEmailNotificationSettingsRequest {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  urgentEnabled!: boolean;

  @ApiProperty({ enum: FREQUENCIES })
  digestFrequency!: (typeof FREQUENCIES)[number];

  @ApiProperty()
  includeAmounts!: boolean;

  @ApiProperty({
    required: false,
    description: 'Обязательно true, когда includeAmounts включается впервые.',
  })
  amountsConsent?: boolean;
}

export class UnsubscribeRequest {
  @ApiProperty({ description: 'Токен из ссылки «Отписаться» в письме.', maxLength: 256 })
  token!: string;
}
```

- [ ] **Step 3: Репозиторий**

Create `apps/api/src/notification-settings/notification-settings.repository.ts`:

```ts
import type { DigestFrequency, NotificationChannel, Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { PrismaService } from '../database/prisma.service.js';

type Tx = Prisma.TransactionClient;

export type EmailSettingValues = {
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsentAt: Date | null;
};

export type StoredEmailSetting = EmailSettingValues & { id: string };

export class NotificationSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  findUser(tx: Tx, userId: string) {
    return tx.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
  }

  findEmailSetting(tx: Tx, userId: string): Promise<StoredEmailSetting | null> {
    return tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId, channel: 'EMAIL' } },
      select: {
        id: true,
        enabled: true,
        urgentEnabled: true,
        digestFrequency: true,
        includeAmounts: true,
        amountsConsentAt: true,
      },
    });
  }

  upsertEmailSetting(tx: Tx, userId: string, values: EmailSettingValues): Promise<StoredEmailSetting> {
    return tx.notificationChannelSetting.upsert({
      where: { userId_channel: { userId, channel: 'EMAIL' } },
      create: { id: createUuidV7(), userId, channel: 'EMAIL', ...values },
      update: values,
      select: {
        id: true,
        enabled: true,
        urgentEnabled: true,
        digestFrequency: true,
        includeAmounts: true,
        amountsConsentAt: true,
      },
    });
  }

  findDeliveryByTokenHash(tx: Tx, tokenHash: string) {
    return tx.notificationDelivery.findUnique({
      where: { unsubscribeTokenHash: tokenHash },
      select: { userId: true, channel: true },
    });
  }

  /** Turns the channel off; `changed` is false when it was already off or never stored. */
  async disableChannel(
    tx: Tx,
    userId: string,
    channel: NotificationChannel,
  ): Promise<{ id: string; changed: boolean } | null> {
    const setting = await tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId, channel } },
      select: { id: true, enabled: true },
    });
    if (!setting) return null;
    if (!setting.enabled) return { id: setting.id, changed: false };
    await tx.notificationChannelSetting.update({
      where: { id: setting.id },
      data: { enabled: false },
    });
    return { id: setting.id, changed: true };
  }

  async audit(
    tx: Tx,
    userId: string,
    entry: { settingId: string; action: string; values: Record<string, unknown>; requestId?: string },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        entityType: 'notification_settings',
        entityId: entry.settingId,
        action: entry.action,
        newValues: entry.values as Prisma.InputJsonValue,
        source: 'API',
        requestId: entry.requestId ?? null,
      },
    });
  }
}
```

Сигнатура `audit` в юнит-тесте задачи читается как `call[2].action` — третий аргумент `entry`.

- [ ] **Step 4: Сервис**

Create `apps/api/src/notification-settings/notification-settings.application.service.ts`:

```ts
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { maskEmail } from './mask-email.js';
import type {
  EmailSettingValues,
  NotificationSettingsRepository,
  StoredEmailSetting,
} from './notification-settings.repository.js';
import type { UpdateEmailSettingsInput } from './notification-settings.schemas.js';
import { hashUnsubscribeToken } from './unsubscribe-token.js';

type Meta = { requestId?: string };

export type EmailSettingsView = {
  email: string;
  emailVerified: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
  includeAmounts: boolean;
  amountsConsentAt: string | null;
};

const DEFAULTS: EmailSettingValues = {
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY',
  includeAmounts: false,
  amountsConsentAt: null,
};

/**
 * Email channel settings of the signed-in user and the public unsubscribe link. Settings are per
 * user, not per budget (one family budget per user in v1). Amounts in letters need an explicit,
 * timestamped consent; the address itself never reaches audit values.
 */
export class NotificationSettingsApplicationService {
  constructor(private readonly repository: NotificationSettingsRepository) {}

  getEmail(userId: string): Promise<EmailSettingsView> {
    return this.repository.transaction(async (tx) => {
      const user = await this.repository.findUser(tx, userId);
      if (!user) throw userMissing();
      const setting = await this.repository.findEmailSetting(tx, userId);
      return view(user, setting ?? DEFAULTS);
    });
  }

  updateEmail(userId: string, input: UpdateEmailSettingsInput, meta: Meta): Promise<EmailSettingsView> {
    return this.repository.transaction(async (tx) => {
      const user = await this.repository.findUser(tx, userId);
      if (!user) throw userMissing();
      if (input.enabled && !user.emailVerifiedAt) {
        throw new ConflictException({
          code: 'EMAIL_NOT_VERIFIED',
          detail: 'Сначала подтвердите почту.',
        });
      }
      const current = await this.repository.findEmailSetting(tx, userId);
      const hadAmounts = current?.includeAmounts ?? false;
      const grantsAmounts = input.includeAmounts && !hadAmounts;
      if (grantsAmounts && input.amountsConsent !== true) {
        throw new UnprocessableEntityException({
          code: 'AMOUNTS_CONSENT_REQUIRED',
          detail: 'Подтвердите согласие на показ сумм в письмах.',
          fieldErrors: [
            {
              field: 'includeAmounts',
              message: 'Подтвердите согласие на показ сумм в письмах.',
              code: 'custom',
            },
          ],
        });
      }
      const values: EmailSettingValues = {
        enabled: input.enabled,
        urgentEnabled: input.urgentEnabled,
        digestFrequency: input.digestFrequency,
        includeAmounts: input.includeAmounts,
        amountsConsentAt: !input.includeAmounts
          ? null
          : grantsAmounts
            ? new Date()
            : (current?.amountsConsentAt ?? new Date()),
      };
      const saved = await this.repository.upsertEmailSetting(tx, userId, values);
      const requestId = meta.requestId ? { requestId: meta.requestId } : {};
      await this.repository.audit(tx, userId, {
        settingId: saved.id,
        action: 'UPDATED',
        values: {
          channel: 'EMAIL',
          enabled: values.enabled,
          urgentEnabled: values.urgentEnabled,
          digestFrequency: values.digestFrequency,
          includeAmounts: values.includeAmounts,
        },
        ...requestId,
      });
      if (grantsAmounts || (hadAmounts && !input.includeAmounts)) {
        await this.repository.audit(tx, userId, {
          settingId: saved.id,
          action: grantsAmounts ? 'AMOUNTS_CONSENT_GRANTED' : 'AMOUNTS_CONSENT_REVOKED',
          values: { channel: 'EMAIL' },
          ...requestId,
        });
      }
      return view(user, saved);
    });
  }

  /** Always resolves: an unknown token must look exactly like a valid one. */
  async unsubscribe(rawToken: string, meta: Meta): Promise<void> {
    await this.repository.transaction(async (tx) => {
      const delivery = await this.repository.findDeliveryByTokenHash(
        tx,
        hashUnsubscribeToken(rawToken),
      );
      if (!delivery) return;
      const result = await this.repository.disableChannel(tx, delivery.userId, delivery.channel);
      if (!result?.changed) return;
      await this.repository.audit(tx, delivery.userId, {
        settingId: result.id,
        action: 'UNSUBSCRIBED',
        values: { channel: delivery.channel, via: 'link' },
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      });
    });
  }
}

function view(
  user: { email: string; emailVerifiedAt: Date | null },
  setting: EmailSettingValues | StoredEmailSetting,
): EmailSettingsView {
  return {
    email: maskEmail(user.email),
    emailVerified: user.emailVerifiedAt !== null,
    enabled: setting.enabled,
    urgentEnabled: setting.urgentEnabled,
    digestFrequency: setting.digestFrequency,
    includeAmounts: setting.includeAmounts,
    amountsConsentAt: setting.amountsConsentAt?.toISOString() ?? null,
  };
}

function userMissing(): NotFoundException {
  return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Пользователь не найден.' });
}
```

В юнит-тесте `disableChannel` возвращает `{ id, changed: true }`, поэтому аудит `UNSUBSCRIBED` пишется.

Run: `pnpm --filter @harmofin/api test -- notification-settings mask-email`
Expected: PASS.

- [ ] **Step 5: Контроллер и модуль**

Create `apps/api/src/notification-settings/notification-settings.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { NotificationSettingsApplicationService } from './notification-settings.application.service.js';
import {
  EmailNotificationSettingsResponse,
  UnsubscribeRequest,
  UpdateEmailNotificationSettingsRequest,
} from './notification-settings.dto.js';
import {
  unsubscribeSchema,
  updateEmailSettingsSchema,
  type UnsubscribeInput,
  type UpdateEmailSettingsInput,
} from './notification-settings.schemas.js';

const metaOf = (request: FastifyRequest) => {
  const meta = requestMeta(request);
  return meta.requestId ? { requestId: meta.requestId } : {};
};

@ApiTags('notification-settings')
@Controller()
export class NotificationSettingsController {
  constructor(
    @Inject(NotificationSettingsApplicationService)
    private readonly service: NotificationSettingsApplicationService,
  ) {}

  @Get('me/notification-settings/email')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Настройки уведомлений на почту',
    description:
      'Настройки текущего пользователя; если не сохранялись — значения по умолчанию (выключено). Адрес частично скрыт. Коды: 401.',
  })
  @ApiOkResponse({ type: EmailNotificationSettingsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  get(@Req() request: AuthenticatedRequest) {
    return this.service.getEmail(requiredContext(request).userId);
  }

  @Put('me/notification-settings/email')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Изменить настройки уведомлений на почту',
    description:
      'Включить канал можно только с подтверждённой почтой. Включение сумм требует amountsConsent: true; время согласия сохраняется, при выключении сбрасывается. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 EMAIL_NOT_VERIFIED, 422 AMOUNTS_CONSENT_REQUIRED.',
  })
  @ApiBody({ type: UpdateEmailNotificationSettingsRequest })
  @ApiOkResponse({ type: EmailNotificationSettingsResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  update(
    @Body(new ZodValidationPipe(updateEmailSettingsSchema)) input: UpdateEmailSettingsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateEmail(requiredContext(request).userId, input, metaOf(request));
  }

  @Post('notifications/unsubscribe')
  @HttpCode(204)
  @UseGuards(AuthRateLimitGuard)
  @ApiOperation({
    summary: 'Отписаться от писем по ссылке',
    description:
      'Публичный: открывается из письма без входа. Без сессии и CSRF; глобальный OriginGuard требует origin веба. Выключает канал получателю письма. Неизвестный токен — тот же ответ 204. Коды: 400 VALIDATION_FAILED, 403 ORIGIN_REQUIRED, 429 AUTH_RATE_LIMITED.',
  })
  @ApiBody({ type: UnsubscribeRequest })
  @ApiNoContentResponse({ description: 'Готово.' })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  async unsubscribe(
    @Body(new ZodValidationPipe(unsubscribeSchema)) input: UnsubscribeInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.service.unsubscribe(input.token, metaOf(request));
  }
}
```

Create `apps/api/src/notification-settings/notification-settings.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { NotificationSettingsApplicationService } from './notification-settings.application.service.js';
import { NotificationSettingsController } from './notification-settings.controller.js';
import { NotificationSettingsRepository } from './notification-settings.repository.js';

@Module({})
export class NotificationSettingsModule {
  static register(): DynamicModule {
    return {
      module: NotificationSettingsModule,
      controllers: [NotificationSettingsController],
      providers: [
        {
          provide: NotificationSettingsApplicationService,
          useFactory: (prisma: PrismaService) =>
            new NotificationSettingsApplicationService(new NotificationSettingsRepository(prisma)),
          inject: [PrismaService],
        },
      ],
    };
  }
}
```

В `apps/api/src/app.module.ts` после `NotificationsModule.register(),` добавить `NotificationSettingsModule.register(),` (+ импорт). Если `apps/api/src/di-explicit-inject.test.ts` требует явный `@Inject` — он уже есть в конструкторе контроллера.

- [ ] **Step 6: Интеграционный тест**

Create `apps/api/test/notification-settings.integration.test.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const origin = 'http://localhost:3000';
const path = '/api/v1/me/notification-settings/email';
let anna: FamilyActor;
let boris: FamilyActor;

const body = {
  enabled: true,
  urgentEnabled: true,
  digestFrequency: 'WEEKLY',
  includeAmounts: false,
};

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  boris = await env.register();
});

afterAll(async () => {
  await env.stop();
});

describe('email notification settings', () => {
  it('returns defaults and a masked address', async () => {
    const response = await env.inject('GET', path, anna);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      emailVerified: false,
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
    });
    expect(response.json().email).toMatch(/^f\*\*\*@harmofin\.test$/);
  });

  it('refuses to enable before the address is verified', async () => {
    const response = await env.inject('PUT', path, anna, body);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('requires CSRF', async () => {
    const response = await env.server.inject({
      method: 'PUT',
      url: path,
      headers: { origin },
      cookies: { harmofin_session: anna.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(403);
  });

  it('saves settings once verified and asks for consent before amounts', async () => {
    await env.prisma.user.update({
      where: { id: anna.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    const saved = await env.inject('PUT', path, anna, body);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ enabled: true, digestFrequency: 'WEEKLY' });

    const noConsent = await env.inject('PUT', path, anna, { ...body, includeAmounts: true });
    expect(noConsent.statusCode).toBe(422);
    expect(noConsent.json().fieldErrors[0].field).toBe('includeAmounts');

    const consent = await env.inject('PUT', path, anna, {
      ...body,
      includeAmounts: true,
      amountsConsent: true,
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.json().amountsConsentAt).not.toBeNull();
  });

  it('keeps settings per user', async () => {
    expect((await env.inject('GET', path, boris)).json().enabled).toBe(false);
  });

  it('unsubscribes by a token from a letter and answers 204 to unknown tokens', async () => {
    const raw = `token-${randomUUID()}`;
    await env.prisma.notificationDelivery.create({
      data: {
        id: randomUUID(),
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        userId: anna.user.id,
        channel: 'EMAIL',
        kind: 'DIGEST',
        dedupeKey: `digest:DAILY:${randomUUID()}`,
        nextAttemptAt: new Date(),
        status: 'SENT',
        unsubscribeTokenHash: createHash('sha256').update(raw).digest('hex'),
      },
    });
    const post = (token: string) =>
      env.server.inject({
        method: 'POST',
        url: '/api/v1/notifications/unsubscribe',
        headers: { origin },
        payload: { token },
      });

    expect((await post('unknown-token')).statusCode).toBe(204);
    expect((await env.inject('GET', path, anna)).json().enabled).toBe(true);

    expect((await post(raw)).statusCode).toBe(204);
    expect((await env.inject('GET', path, anna)).json().enabled).toBe(false);

    const audits = await env.prisma.auditEvent.findMany({
      where: { actorUserId: anna.user.id, entityType: 'notification_settings' },
    });
    expect(audits.map((item) => item.action)).toEqual(
      expect.arrayContaining(['UPDATED', 'AMOUNTS_CONSENT_GRANTED', 'UNSUBSCRIBED']),
    );
    expect(JSON.stringify(audits)).not.toContain(anna.user.email);
  });

  it('rejects an unsubscribe without the web origin', async () => {
    const response = await env.server.inject({
      method: 'POST',
      url: '/api/v1/notifications/unsubscribe',
      payload: { token: 'any' },
    });
    expect(response.statusCode).toBe(403);
  });
});
```

`FamilyTestApp.register()` создаёт адреса вида `family-<uuid>@harmofin.test`, поэтому маска — `f***@harmofin.test`.

Run: `pnpm test:integration -- notification-settings`
Expected: PASS.

- [ ] **Step 7: OpenAPI и проверки**

Run: `node scripts/openapi/generate.mjs && pnpm exec prettier --write openapi.json`
Run: `pnpm test:integration && pnpm --filter @harmofin/api test && pnpm typecheck && pnpm lint`
Expected: PASS; `v2-openapi.integration.test.ts` не изменился и проходит (новые пути — `/api/v1`).

- [ ] **Step 8: Проиндексировать**

```bash
git add apps/api/src/notification-settings apps/api/src/app.module.ts apps/api/test/notification-settings.integration.test.ts openapi.json
```

Коммит: `feat(api): настройки уведомлений на почту и отписка по ссылке`.

После задачи 3 — конец PR 1: координатор спрашивает владельца об открытии PR.

---

## PR 2 — воркер

PR 2 начинается от свежего `main` после мержа PR 1, ветка `feat/email-notifications-worker`.

### Task 4: Почтовый конфиг воркера, отправитель и шаблоны писем

**Files:**
- Modify: `apps/worker/package.json` (+ `pnpm-lock.yaml`)
- Modify: `apps/worker/src/config.ts`, `apps/worker/src/config.test.ts`
- Create: `apps/worker/src/mail/format.ts`, `format.test.ts`, `templates.ts`, `templates.test.ts`, `mailer.ts`
- Modify: `infra/compose/production.yml`, `infra/env/staging.example`

**Interfaces:**
- Produces:
  - `WorkerConfig.mail: WorkerMailConfig | undefined`, где `WorkerMailConfig = { smtpHost: string; smtpPort: number; smtpUser?: string; smtpPassword?: string; from: string; webBaseUrl: string }`;
  - `interface MailMessage { to: string; subject: string; text: string; html: string; headers: Record<string, string> }`, `interface Mailer { send(message: MailMessage): Promise<void> }`, `class SmtpMailer implements Mailer`;
  - `formatMinor(amountMinor: bigint, currency: string): string`, `escapeHtml(value: string): string`, `pluralRu(count: number, one: string, few: string, many: string): string`;
  - `type DigestGroup = 'operations' | 'transfers' | 'envelopes' | 'plans' | 'calendar' | 'family'`;
  - `type DigestContent = { frequency: 'DAILY' | 'WEEKLY'; periodLabel: string; people: DigestPerson[]; payments: DigestPayment[] }`, `DigestPerson = { name: string; counts: Partial<Record<DigestGroup, number>> }`, `DigestPayment = { name: string; amount: string | null }`;
  - `type UrgentContent = { subject: string; lines: string[]; actionPath: string }`, `type MailLinks = { webBaseUrl: string; unsubscribeToken: string }`, `type RenderedMail = Omit<MailMessage, 'to'>`;
  - `renderDigest(content: DigestContent, links: MailLinks): RenderedMail`, `renderUrgent(content: UrgentContent, links: MailLinks): RenderedMail`, `personLine(person: DigestPerson): string`.

- [ ] **Step 1: Зависимость**

Run: `pnpm --filter @harmofin/worker add nodemailer@10.1.0 && pnpm --filter @harmofin/worker add -D @types/nodemailer@8.0.2`
Expected: версии совпадают с `apps/api/package.json`; `pnpm-lock.yaml` обновлён.

- [ ] **Step 2: Падающие тесты конфига**

В `apps/worker/src/config.test.ts`: во всех ожиданиях `toEqual({...})` полного конфига дописать поле `mail: undefined`. Добавить тесты:

```ts
  it('enables mail only with a complete SMTP configuration', () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '587',
        SMTP_USER: 'mailer',
        SMTP_PASSWORD: 'secret',
        MAIL_FROM: 'no-reply@example.test',
        WEB_BASE_URL: 'https://app.example.test',
      }).mail,
    ).toEqual({
      smtpHost: 'smtp.example.test',
      smtpPort: 587,
      smtpUser: 'mailer',
      smtpPassword: 'secret',
      from: 'no-reply@example.test',
      webBaseUrl: 'https://app.example.test',
    });
  });

  it('keeps mail off without SMTP_HOST, including an empty value', () => {
    expect(
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        SMTP_HOST: '',
      }).mail,
    ).toBeUndefined();
  });

  it('rejects a partial SMTP configuration', () => {
    expect(() =>
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        SMTP_HOST: 'smtp.example.test',
      }),
    ).toThrow(/SMTP_PORT, MAIL_FROM, WEB_BASE_URL/);
    expect(() =>
      loadWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '587',
        SMTP_USER: 'mailer',
        MAIL_FROM: 'no-reply@example.test',
        WEB_BASE_URL: 'https://app.example.test',
      }),
    ).toThrow(/SMTP_USER, SMTP_PASSWORD/);
  });
```

Run: `pnpm --filter @harmofin/worker test -- config`
Expected: FAIL — `mail` отсутствует.

- [ ] **Step 3: Конфиг**

В `apps/worker/src/config.ts`:

```ts
const optionalNonEmpty = z
  .literal('')
  .transform(() => undefined)
  .or(z.string().min(1).optional());
```

В `workerEnvironmentSchema` дописать:

```ts
  SMTP_HOST: optionalNonEmpty,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SMTP_USER: optionalNonEmpty,
  SMTP_PASSWORD: optionalNonEmpty,
  MAIL_FROM: optionalNonEmpty,
  WEB_BASE_URL: optionalHttpUrl,
```

Типы и сборка:

```ts
export interface WorkerMailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  from: string;
  webBaseUrl: string;
}
```

В `WorkerConfig` — поле `mail: WorkerMailConfig | undefined;`. В `loadWorkerConfig` — `mail: mailConfig(result.data),` и функция:

```ts
/** Mail is optional: without SMTP_HOST the worker skips the delivery and digest jobs entirely. */
function mailConfig(data: z.infer<typeof workerEnvironmentSchema>): WorkerMailConfig | undefined {
  if (!data.SMTP_HOST) return undefined;
  const missing = [
    data.SMTP_PORT ? null : 'SMTP_PORT',
    data.MAIL_FROM ? null : 'MAIL_FROM',
    data.WEB_BASE_URL ? null : 'WEB_BASE_URL',
    Boolean(data.SMTP_USER) === Boolean(data.SMTP_PASSWORD) ? null : 'SMTP_USER, SMTP_PASSWORD',
  ].filter((item): item is string => item !== null);
  if (missing.length > 0) throw new Error(`Invalid worker configuration: ${missing.join(', ')}`);
  return {
    smtpHost: data.SMTP_HOST,
    smtpPort: data.SMTP_PORT!,
    ...(data.SMTP_USER ? { smtpUser: data.SMTP_USER, smtpPassword: data.SMTP_PASSWORD! } : {}),
    from: data.MAIL_FROM!,
    webBaseUrl: data.WEB_BASE_URL!,
  };
}
```

Run: `pnpm --filter @harmofin/worker test -- config`
Expected: PASS.

- [ ] **Step 4: Падающие тесты форматирования и шаблонов**

Create `apps/worker/src/mail/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { escapeHtml, formatMinor, pluralRu } from './format.js';

describe('formatMinor', () => {
  it('formats minor units without floating point', () => {
    expect(formatMinor(123_456n, 'RUB')).toMatch(/^1\s234,56\s₽$/u);
    expect(formatMinor(5n, 'RUB')).toMatch(/^0,05\s₽$/u);
    expect(formatMinor(900_719_925_474_099_312n, 'RUB')).toMatch(/,12\s₽$/u);
  });

  it('keeps an unknown currency code as is', () => {
    expect(formatMinor(100n, 'USD')).toMatch(/^1,00\sUSD$/u);
  });
});

describe('pluralRu', () => {
  it.each([
    [1, 'операция'],
    [2, 'операции'],
    [5, 'операций'],
    [11, 'операций'],
    [21, 'операция'],
    [22, 'операции'],
    [112, 'операций'],
  ])('%i → %s', (count, expected) => {
    expect(pluralRu(count, 'операция', 'операции', 'операций')).toBe(expected);
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml(`<b a="1">'&'</b>`)).toBe('&lt;b a=&quot;1&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;');
  });
});
```

Create `apps/worker/src/mail/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { personLine, renderDigest, renderUrgent } from './templates.js';

const links = { webBaseUrl: 'https://app.example.test', unsubscribeToken: 'tok_123' };

describe('personLine', () => {
  it('lists non-empty groups in a fixed order with Russian plurals', () => {
    expect(
      personLine({ name: 'Анна', counts: { calendar: 1, operations: 3, envelopes: 2, family: 0 } }),
    ).toBe('Анна: 3 операции, 2 действия с конвертами, 1 событие календаря');
  });
});

describe('renderDigest', () => {
  const content = {
    frequency: 'DAILY' as const,
    periodLabel: '30 октября',
    people: [{ name: 'Анна <script>', counts: { operations: 1 } }],
    payments: [
      { name: 'Ипотека', amount: '45 000,00 ₽' },
      { name: 'Интернет', amount: null },
    ],
  };

  it('builds subject, text and escaped html with the feed link', () => {
    const mail = renderDigest(content, links);
    expect(mail.subject).toBe('HarmoFin: что нового в семье за 30 октября');
    expect(mail.text).toContain('Анна <script>: 1 операция');
    expect(mail.text).toContain('Ипотека — 45 000,00 ₽');
    expect(mail.text).toContain('Интернет');
    expect(mail.text).toContain('https://app.example.test/app/activity');
    expect(mail.html).toContain('Анна &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
  });

  it('uses the weekly subject', () => {
    expect(renderDigest({ ...content, frequency: 'WEEKLY' }, links).subject).toBe(
      'HarmoFin: что нового в семье за неделю',
    );
  });

  it('adds the settings and unsubscribe links and the List-Unsubscribe header only', () => {
    const mail = renderDigest(content, links);
    const unsubscribe = 'https://app.example.test/unsubscribe?token=tok_123';
    expect(mail.text).toContain('https://app.example.test/app/settings/notifications');
    expect(mail.text).toContain(unsubscribe);
    expect(mail.headers).toEqual({ 'List-Unsubscribe': `<${unsubscribe}>` });
  });
});

describe('renderUrgent', () => {
  it('links to the notification target', () => {
    const mail = renderUrgent(
      {
        subject: 'Просрочен платёж «Ипотека»',
        lines: ['План «Ипотека» просрочен с 2026-10-25.', 'Сумма по плану: 45 000,00 ₽.'],
        actionPath: '/app/plans?occurrence=occ-1',
      },
      links,
    );
    expect(mail.subject).toBe('Просрочен платёж «Ипотека»');
    expect(mail.text).toContain('План «Ипотека» просрочен с 2026-10-25.');
    expect(mail.text).toContain('Сумма по плану: 45 000,00 ₽.');
    expect(mail.text).toContain('https://app.example.test/app/plans?occurrence=occ-1');
    expect(mail.html).toContain('href="https://app.example.test/app/plans?occurrence=occ-1"');
  });
});
```

Run: `pnpm --filter @harmofin/worker test -- mail`
Expected: FAIL — модули не найдены.

- [ ] **Step 5: Форматирование**

Create `apps/worker/src/mail/format.ts`:

```ts
const GROUPING = new Intl.NumberFormat('ru-RU', { useGrouping: true, maximumFractionDigits: 0 });

/**
 * Minor units (scale 2) to "1 234,56 ₽" with integer arithmetic only: bigint never goes through a
 * float. The amount is shown as stored; nothing is calculated here.
 */
export function formatMinor(amountMinor: bigint, currency: string): string {
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const whole = GROUPING.format(absolute / 100n);
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  const symbol = currency === 'RUB' ? '₽' : currency;
  return `${negative ? '−' : ''}${whole},${fraction} ${symbol}`;
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
```

- [ ] **Step 6: Шаблоны и отправитель**

Create `apps/worker/src/mail/mailer.ts`:

```ts
import nodemailer from 'nodemailer';

import type { WorkerMailConfig } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transporter;

  constructor(private readonly config: WorkerMailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      ...(config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPassword } } : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.config.from, ...message });
  }
}
```

Create `apps/worker/src/mail/templates.ts`:

```ts
import { escapeHtml, pluralRu } from './format.js';
import type { MailMessage } from './mailer.js';

export type DigestGroup = 'operations' | 'transfers' | 'envelopes' | 'plans' | 'calendar' | 'family';
export type DigestPerson = { name: string; counts: Partial<Record<DigestGroup, number>> };
export type DigestPayment = { name: string; amount: string | null };
export type DigestContent = {
  frequency: 'DAILY' | 'WEEKLY';
  periodLabel: string;
  people: DigestPerson[];
  payments: DigestPayment[];
};
export type UrgentContent = { subject: string; lines: string[]; actionPath: string };
export type MailLinks = { webBaseUrl: string; unsubscribeToken: string };
export type RenderedMail = Omit<MailMessage, 'to'>;

const GROUP_ORDER: readonly DigestGroup[] = [
  'operations',
  'transfers',
  'envelopes',
  'plans',
  'calendar',
  'family',
];

const GROUP_FORMS: Record<DigestGroup, readonly [string, string, string]> = {
  operations: ['операция', 'операции', 'операций'],
  transfers: ['перевод', 'перевода', 'переводов'],
  envelopes: ['действие с конвертами', 'действия с конвертами', 'действий с конвертами'],
  plans: ['действие с планами', 'действия с планами', 'действий с планами'],
  calendar: ['событие календаря', 'события календаря', 'событий календаря'],
  family: ['изменение в семье', 'изменения в семье', 'изменений в семье'],
};

// Calm Fintech light palette (apps/web/app/assets/styles/tokens.css), inlined: mail clients drop
// <style> blocks and CSS variables.
const COLOR = {
  text: '#0d1b2a',
  muted: '#5b6b78',
  primary: '#2c5b8a',
  soft: '#e8eef3',
  surface: '#ffffff',
  border: '#e6e8eb',
};

type Section = { heading: string | null; items: string[] };

export function personLine(person: DigestPerson): string {
  const parts = GROUP_ORDER.filter((group) => (person.counts[group] ?? 0) > 0).map((group) => {
    const count = person.counts[group]!;
    const [one, few, many] = GROUP_FORMS[group];
    return `${count} ${pluralRu(count, one, few, many)}`;
  });
  return `${person.name}: ${parts.join(', ')}`;
}

export function renderDigest(content: DigestContent, links: MailLinks): RenderedMail {
  const weekly = content.frequency === 'WEEKLY';
  const sections: Section[] = [];
  if (content.people.length > 0) {
    sections.push({ heading: 'Что сделали в семье', items: content.people.map(personLine) });
  }
  if (content.payments.length > 0) {
    sections.push({
      heading: 'Платежи сегодня',
      items: content.payments.map((payment) =>
        payment.amount ? `${payment.name} — ${payment.amount}` : payment.name,
      ),
    });
  }
  return compose({
    subject: weekly
      ? 'HarmoFin: что нового в семье за неделю'
      : `HarmoFin: что нового в семье за ${content.periodLabel}`,
    intro: weekly
      ? 'Что произошло в семейном бюджете за неделю.'
      : `Что произошло в семейном бюджете за ${content.periodLabel}.`,
    sections,
    action: { url: absolute('/app/activity', links), label: 'Открыть ленту' },
    links,
  });
}

export function renderUrgent(content: UrgentContent, links: MailLinks): RenderedMail {
  const [intro = '', ...rest] = content.lines;
  return compose({
    subject: content.subject,
    intro,
    sections: rest.length > 0 ? [{ heading: null, items: rest }] : [],
    action: { url: absolute(content.actionPath, links), label: 'Открыть' },
    links,
  });
}

function absolute(path: string, links: MailLinks): string {
  return new URL(path, links.webBaseUrl).toString();
}

function compose(mail: {
  subject: string;
  intro: string;
  sections: Section[];
  action: { url: string; label: string };
  links: MailLinks;
}): RenderedMail {
  const settingsUrl = absolute('/app/settings/notifications', mail.links);
  const unsubscribe = new URL('/unsubscribe', mail.links.webBaseUrl);
  unsubscribe.searchParams.set('token', mail.links.unsubscribeToken);
  const unsubscribeUrl = unsubscribe.toString();
  const why = 'Вы получили письмо, потому что включили уведомления на почту в HarmoFin.';

  const text = [
    mail.intro,
    ...mail.sections.flatMap((section) => [
      '',
      ...(section.heading ? [section.heading] : []),
      ...section.items.map((item) => `• ${item}`),
    ]),
    '',
    `${mail.action.label}: ${mail.action.url}`,
    '',
    '—',
    why,
    `Настроить уведомления: ${settingsUrl}`,
    `Отписаться: ${unsubscribeUrl}`,
  ].join('\n');

  const sectionsHtml = mail.sections
    .map(
      (section) =>
        `${section.heading ? `<h2 style="margin:24px 0 8px;font-size:16px;color:${COLOR.text};">${escapeHtml(section.heading)}</h2>` : ''}` +
        `<ul style="margin:0;padding-left:20px;color:${COLOR.text};">${section.items
          .map((item) => `<li style="margin:4px 0;">${escapeHtml(item)}</li>`)
          .join('')}</ul>`,
    )
    .join('');

  const html =
    `<!doctype html><html lang="ru"><body style="margin:0;padding:24px;background:${COLOR.soft};font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px;background:${COLOR.surface};border:1px solid ${COLOR.border};border-radius:12px;">` +
    `<p style="margin:0 0 4px;color:${COLOR.muted};font-size:13px;">HarmoFin</p>` +
    `<p style="margin:0;color:${COLOR.text};">${escapeHtml(mail.intro)}</p>` +
    sectionsHtml +
    `<p style="margin:24px 0 0;"><a href="${escapeHtml(mail.action.url)}" style="display:inline-block;padding:10px 18px;background:${COLOR.primary};color:#ffffff;border-radius:8px;text-decoration:none;">${escapeHtml(mail.action.label)}</a></p>` +
    `<p style="margin:24px 0 0;color:${COLOR.muted};font-size:13px;">${escapeHtml(why)}<br>` +
    `<a href="${escapeHtml(settingsUrl)}" style="color:${COLOR.primary};">Настроить уведомления</a> · ` +
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:${COLOR.primary};">Отписаться</a></p>` +
    `</div></body></html>`;

  return {
    subject: mail.subject,
    text,
    html,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
  };
}
```

Run: `pnpm --filter @harmofin/worker test -- mail`
Expected: PASS. Если `formatMinor` даёт другой пробел-разделитель — тесты допускают любой `\s`.

- [ ] **Step 7: Переменные окружения деплоя**

В `infra/compose/production.yml`, сервис `worker`, `environment`, после `OTEL_EXPORTER_OTLP_ENDPOINT`:

```yaml
      SMTP_HOST: ${SMTP_HOST:?SMTP_HOST is required}
      SMTP_PORT: ${SMTP_PORT:?SMTP_PORT is required}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASSWORD: ${SMTP_PASSWORD:-}
      MAIL_FROM: ${MAIL_FROM:?MAIL_FROM is required}
      WEB_BASE_URL: ${WEB_BASE_URL:?WEB_BASE_URL is required}
```

Те же переменные уже передаются сервису `api` и есть в `infra/env/staging.example`; в `staging.example` дописать комментарий над блоком SMTP: `# SMTP is shared by api and worker (worker sends notification letters).` Если staging использует отдельный compose — найти `grep -rn "WORKER_POLL_INTERVAL_MS" infra` и добавить туда же. `.env.example` уже содержит `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `WEB_BASE_URL` — локальный воркер читает их через `--env-file-if-exists=../../.env`.

- [ ] **Step 8: Проверки и индексация**

Run: `pnpm --filter @harmofin/worker test && pnpm --filter @harmofin/worker typecheck && pnpm --filter @harmofin/worker lint`
Expected: PASS.

```bash
git add apps/worker/package.json pnpm-lock.yaml apps/worker/src/config.ts apps/worker/src/config.test.ts apps/worker/src/mail infra/compose/production.yml infra/env/staging.example
```

Коммит: `feat(worker): почтовый конфиг, отправитель и шаблоны писем`.

---

### Task 5: Очередь отправки и задача `DELIVER_NOTIFICATIONS`

**Files:**
- Create: `apps/worker/src/delivery/delivery.repository.ts`, `delivery.repository.test.ts`, `eligibility.ts`, `eligibility.test.ts`, `digest-sources.ts`, `urgent-content.ts`, `urgent-content.test.ts`, `digest-content.ts`, `digest-content.test.ts`, `deliver.handler.ts`
- Modify: `apps/worker/src/job.repository.ts`, `apps/worker/src/main.ts`, `apps/worker/src/logger.ts`, `apps/worker/src/observability/observability.ts`
- Create: `apps/api/test/email-delivery.integration.test.ts`

**Interfaces:**
- Consumes: `Mailer`, `MailMessage`, `renderDigest`, `renderUrgent`, `DigestContent`, `UrgentContent`, `DigestGroup`, `formatMinor` (задача 4); `utcToLocal(instant, timezone): { date: string; time: string }` из `apps/worker/src/zoned-time.ts`; модели задачи 1.
- Produces:
  - `type ClaimedDelivery = { id; workspaceId; budgetId; userId; kind: 'URGENT' | 'DIGEST'; notificationId: string | null; digestPeriodStart: Date | null; digestPeriodEnd: Date | null; dedupeKey: string; attempts: number }`;
  - `class DeliveryRepository { claim(limit, now, budgetId?): Promise<ClaimedDelivery[]>; prepareToken(id, tokenHash): Promise<void>; markSent(id, now): Promise<void>; cancel(id, reason): Promise<void>; retryOrFail(id, attempts, now, error): Promise<boolean> }` (`true` — письмо помечено `FAILED`);
  - `retryDelayMs(attempts: number): number | null`, `MAX_DELIVERY_ATTEMPTS = 5`;
  - `DIGEST_SOURCES: ReadonlyArray<{ entityType: string; action: string; group: DigestGroup }>`, `groupOf(entityType, action): DigestGroup | null`;
  - `class DeliverNotificationsHandler implements WorkerJobHandler` с `execute(now: Date, budgetId?: string)`;
  - `hashUnsubscribeToken(raw: string): string` (SHA-256 hex, как в API).

- [ ] **Step 1: Падающие юнит-тесты чистых функций**

Create `apps/worker/src/delivery/delivery.repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MAX_DELIVERY_ATTEMPTS, retryDelayMs } from './delivery.repository.js';

describe('retryDelayMs', () => {
  it('backs off 1 min, 5 min, 30 min, 2 h and then gives up', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
    expect(retryDelayMs(MAX_DELIVERY_ATTEMPTS)).toBeNull();
  });
});
```

Create `apps/worker/src/delivery/eligibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { cancelReason, type DeliveryFacts } from './eligibility.js';

const ok: DeliveryFacts = {
  user: { email: 'a@x.test', status: 'ACTIVE', emailVerifiedAt: new Date() },
  setting: { enabled: true, urgentEnabled: true, digestFrequency: 'DAILY', includeAmounts: false },
  activeMember: true,
  budgetActive: true,
  notification: { resolvedAt: null, readAt: null },
};

describe('cancelReason', () => {
  it('passes a deliverable letter', () => {
    expect(cancelReason('URGENT', ok)).toBeNull();
    expect(cancelReason('DIGEST', { ...ok, notification: null })).toBeNull();
  });

  it.each([
    ['USER_INACTIVE', { user: { ...ok.user!, status: 'DELETION_PENDING' } }, 'DIGEST'],
    ['EMAIL_NOT_VERIFIED', { user: { ...ok.user!, emailVerifiedAt: null } }, 'DIGEST'],
    ['CHANNEL_DISABLED', { setting: { ...ok.setting!, enabled: false } }, 'DIGEST'],
    ['CHANNEL_DISABLED', { setting: null }, 'URGENT'],
    ['URGENT_DISABLED', { setting: { ...ok.setting!, urgentEnabled: false } }, 'URGENT'],
    ['DIGEST_DISABLED', { setting: { ...ok.setting!, digestFrequency: 'OFF' } }, 'DIGEST'],
    ['BUDGET_INACTIVE', { budgetActive: false }, 'DIGEST'],
    ['NOT_A_MEMBER', { activeMember: false }, 'DIGEST'],
    ['NOTIFICATION_CLOSED', { notification: { resolvedAt: new Date(), readAt: null } }, 'URGENT'],
    ['NOTIFICATION_CLOSED', { notification: { resolvedAt: null, readAt: new Date() } }, 'URGENT'],
    ['NOTIFICATION_CLOSED', { notification: null }, 'URGENT'],
  ] as const)('%s', (reason, patch, kind) => {
    expect(cancelReason(kind, { ...ok, ...patch } as DeliveryFacts)).toBe(reason);
  });

  it('keeps urgent off from affecting the digest', () => {
    expect(
      cancelReason('DIGEST', { ...ok, setting: { ...ok.setting!, urgentEnabled: false } }),
    ).toBeNull();
  });
});
```

Create `apps/worker/src/delivery/urgent-content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { urgentContentOf } from './urgent-content.js';

const overdue = {
  notificationType: 'PLAN_OVERDUE' as const,
  title: 'Просроченный план',
  body: 'План «Ипотека» просрочен с 2026-10-25.',
  actionPath: '/app/plans?occurrence=occ-1',
  occurrence: { planName: 'Ипотека', amountMinor: 4_500_000n },
  budget: { primaryCurrency: 'RUB' },
};

describe('urgentContentOf', () => {
  it('shows no amount without consent', () => {
    const content = urgentContentOf(overdue, false)!;
    expect(content.subject).toBe('Просрочен платёж «Ипотека»');
    expect(content.lines).toEqual(['План «Ипотека» просрочен с 2026-10-25.']);
    expect(JSON.stringify(content)).not.toMatch(/45/);
  });

  it('adds the planned amount with consent', () => {
    expect(urgentContentOf(overdue, true)!.lines[1]).toMatch(/^Сумма по плану: 45\s000,00\s₽\.$/u);
  });

  it('builds a calendar reminder', () => {
    expect(
      urgentContentOf(
        {
          ...overdue,
          notificationType: 'CALENDAR_REMINDER',
          title: 'Родительское собрание',
          body: 'Сегодня в 18:00.',
          occurrence: null,
        },
        true,
      ),
    ).toEqual({
      subject: 'Напоминание: «Родительское собрание»',
      lines: ['Сегодня в 18:00.'],
      actionPath: '/app/plans?occurrence=occ-1',
    });
  });

  it('ignores other notification types', () => {
    expect(urgentContentOf({ ...overdue, notificationType: 'PLAN_TODAY' }, true)).toBeNull();
  });
});
```

Create `apps/worker/src/delivery/digest-content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { dayLabel, personName } from './digest-content.js';
import { DIGEST_SOURCES, groupOf } from './digest-sources.js';

describe('digest sources', () => {
  it('covers the 16 feed pairs', () => {
    expect(DIGEST_SOURCES).toHaveLength(16);
    expect(groupOf('transaction', 'RESTORED')).toBe('operations');
    expect(groupOf('workspace_invitation', 'ACCEPTED')).toBe('family');
    expect(groupOf('notification', 'CREATED')).toBeNull();
  });
});

describe('personName', () => {
  it('labels people like the feed', () => {
    expect(personName('Алия', true)).toBe('Алия');
    expect(personName('Алия', false)).toBe('Алия (не в семье)');
    expect(personName(null, true)).toBe('Участник');
    expect(personName('  ', false)).toBe('Участник (не в семье)');
  });
});

describe('dayLabel', () => {
  it('formats the local day of the window start', () => {
    // 21:30 UTC on 30 Oct is already 31 Oct in Moscow.
    expect(dayLabel(new Date('2026-10-30T21:30:00.000Z'), 'Europe/Moscow')).toBe('31 октября');
    expect(dayLabel(new Date('2026-10-30T21:30:00.000Z'), 'UTC')).toBe('30 октября');
  });
});
```

Run: `pnpm --filter @harmofin/worker test -- delivery`
Expected: FAIL — модули не найдены.

- [ ] **Step 2: Репозиторий очереди**

Create `apps/worker/src/delivery/delivery.repository.ts`:

```ts
import { Prisma, type PrismaClient } from '@prisma/client';

export type ClaimedDelivery = {
  id: string;
  workspaceId: string;
  budgetId: string;
  userId: string;
  kind: 'URGENT' | 'DIGEST';
  notificationId: string | null;
  digestPeriodStart: Date | null;
  digestPeriodEnd: Date | null;
  dedupeKey: string;
  attempts: number;
};

/** A claimed letter is hidden for this long; a crashed run is retried after the lease. */
export const DELIVERY_LEASE_MS = 600_000;
export const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const;

export function retryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
}

export class DeliveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Claims due letters with SKIP LOCKED, like worker_jobs: two workers never take the same row.
   * The attempt is counted and the row is leased by pushing next_attempt_at forward. `budgetId`
   * narrows the claim to one budget, as NotificationRuleHandler does (used by tests).
   */
  claim(limit: number, now: Date, budgetId?: string): Promise<ClaimedDelivery[]> {
    const scope = budgetId ? Prisma.sql`AND "budget_id" = ${budgetId}::uuid` : Prisma.empty;
    const leaseUntil = new Date(now.getTime() + DELIVERY_LEASE_MS);
    return this.prisma.$transaction(
      (tx) =>
        tx.$queryRaw<ClaimedDelivery[]>`
        WITH selected AS (
          SELECT "id"
          FROM "notification_deliveries"
          WHERE "status" = 'PENDING'
            AND "channel" = 'EMAIL'
            AND "next_attempt_at" <= ${now}
            ${scope}
          ORDER BY "next_attempt_at" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "notification_deliveries" AS delivery
        SET
          "attempts" = delivery."attempts" + 1,
          "next_attempt_at" = ${leaseUntil},
          "updated_at" = ${now}
        FROM selected
        WHERE delivery."id" = selected."id"
        RETURNING
          delivery."id" AS "id",
          delivery."workspace_id" AS "workspaceId",
          delivery."budget_id" AS "budgetId",
          delivery."user_id" AS "userId",
          delivery."kind"::text AS "kind",
          delivery."notification_id" AS "notificationId",
          delivery."digest_period_start" AS "digestPeriodStart",
          delivery."digest_period_end" AS "digestPeriodEnd",
          delivery."dedupe_key" AS "dedupeKey",
          delivery."attempts" AS "attempts"
      `,
    );
  }

  /** Stored before sending, so the link in a delivered letter works even if markSent fails. */
  async prepareToken(id: string, tokenHash: string): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id },
      data: { unsubscribeTokenHash: tokenHash },
    });
  }

  async markSent(id: string, now: Date): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'SENT', sentAt: now, lastError: null },
    });
  }

  async cancel(id: string, reason: string): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: reason.slice(0, 200) },
    });
  }

  /** Returns true when the letter reached its last attempt and is now FAILED. */
  async retryOrFail(id: string, attempts: number, now: Date, error: string): Promise<boolean> {
    const delay = retryDelayMs(attempts);
    await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data:
        delay === null
          ? { status: 'FAILED', lastError: error.slice(0, 200) }
          : { nextAttemptAt: new Date(now.getTime() + delay), lastError: error.slice(0, 200) },
    });
    return delay === null;
  }
}
```

- [ ] **Step 3: Проверка прав перед отправкой**

Create `apps/worker/src/delivery/eligibility.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

import type { ClaimedDelivery } from './delivery.repository.js';

export type DeliveryFacts = {
  user: { email: string; status: string; emailVerifiedAt: Date | null } | null;
  setting: {
    enabled: boolean;
    urgentEnabled: boolean;
    digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
    includeAmounts: boolean;
  } | null;
  activeMember: boolean;
  budgetActive: boolean;
  notification: { resolvedAt: Date | null; readAt: Date | null } | null;
};

export type CancelReason =
  | 'USER_INACTIVE'
  | 'EMAIL_NOT_VERIFIED'
  | 'CHANNEL_DISABLED'
  | 'URGENT_DISABLED'
  | 'DIGEST_DISABLED'
  | 'BUDGET_INACTIVE'
  | 'NOT_A_MEMBER'
  | 'NOTIFICATION_CLOSED';

/**
 * Rights are re-checked at send time, not at enqueue time: a member who left, an address that is no
 * longer confirmed, a switched-off channel or an already handled notification cancel the letter.
 */
export function cancelReason(kind: 'URGENT' | 'DIGEST', facts: DeliveryFacts): CancelReason | null {
  if (!facts.user || facts.user.status !== 'ACTIVE') return 'USER_INACTIVE';
  if (!facts.user.emailVerifiedAt) return 'EMAIL_NOT_VERIFIED';
  if (!facts.setting?.enabled) return 'CHANNEL_DISABLED';
  if (kind === 'URGENT' && !facts.setting.urgentEnabled) return 'URGENT_DISABLED';
  if (kind === 'DIGEST' && facts.setting.digestFrequency === 'OFF') return 'DIGEST_DISABLED';
  if (!facts.budgetActive) return 'BUDGET_INACTIVE';
  if (!facts.activeMember) return 'NOT_A_MEMBER';
  if (kind === 'URGENT') {
    const notification = facts.notification;
    if (!notification || notification.resolvedAt || notification.readAt) {
      return 'NOTIFICATION_CLOSED';
    }
  }
  return null;
}

export async function loadDeliveryFacts(
  prisma: PrismaClient,
  delivery: ClaimedDelivery,
): Promise<DeliveryFacts> {
  const [user, setting, membership, budget, notification] = await Promise.all([
    prisma.user.findUnique({
      where: { id: delivery.userId },
      select: { email: true, status: true, emailVerifiedAt: true },
    }),
    prisma.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId: delivery.userId, channel: 'EMAIL' } },
      select: { enabled: true, urgentEnabled: true, digestFrequency: true, includeAmounts: true },
    }),
    prisma.workspaceMembership.findFirst({
      where: { workspaceId: delivery.workspaceId, userId: delivery.userId, isActive: true },
      select: { id: true },
    }),
    prisma.budget.findFirst({
      where: {
        id: delivery.budgetId,
        workspaceId: delivery.workspaceId,
        status: 'ACTIVE',
        planModelVersion: 2,
        workspace: { status: 'ACTIVE' },
      },
      select: { id: true },
    }),
    delivery.notificationId
      ? prisma.notification.findFirst({
          where: {
            id: delivery.notificationId,
            budgetId: delivery.budgetId,
            userId: delivery.userId,
          },
          select: { resolvedAt: true, readAt: true },
        })
      : Promise.resolve(null),
  ]);
  return {
    user,
    setting,
    activeMember: membership !== null,
    budgetActive: budget !== null,
    notification,
  };
}
```

- [ ] **Step 4: Содержимое писем**

Create `apps/worker/src/delivery/digest-sources.ts`:

```ts
import type { DigestGroup } from '../mail/templates.js';

/**
 * Copy of the activity feed whitelist (apps/api/src/activity-feed/feed-kinds.ts, FEED_SOURCES),
 * grouped for the digest. The worker does not import API code; apps/api/test/email-digest
 * .integration.test.ts checks that both lists hold the same 16 pairs. Change them together.
 */
export const DIGEST_SOURCES: ReadonlyArray<{
  entityType: string;
  action: string;
  group: DigestGroup;
}> = [
  { entityType: 'transaction', action: 'CREATED', group: 'operations' },
  { entityType: 'transaction', action: 'UPDATED', group: 'operations' },
  { entityType: 'transaction', action: 'DELETED', group: 'operations' },
  { entityType: 'transaction', action: 'RESTORED', group: 'operations' },
  { entityType: 'transfer', action: 'CREATED', group: 'transfers' },
  { entityType: 'transfer', action: 'DELETED', group: 'transfers' },
  { entityType: 'envelope-assignment', action: 'CREATED', group: 'envelopes' },
  { entityType: 'envelope-movement', action: 'CREATED', group: 'envelopes' },
  { entityType: 'plan_occurrence', action: 'COMPLETED', group: 'plans' },
  { entityType: 'regular_plan', action: 'CREATED', group: 'plans' },
  { entityType: 'calendar_event', action: 'CREATED', group: 'calendar' },
  { entityType: 'calendar_event', action: 'UPDATED', group: 'calendar' },
  { entityType: 'calendar_event', action: 'DELETED', group: 'calendar' },
  { entityType: 'workspace_invitation', action: 'ACCEPTED', group: 'family' },
  { entityType: 'workspace_membership', action: 'LEFT', group: 'family' },
  { entityType: 'workspace_membership', action: 'REMOVED', group: 'family' },
];

export function groupOf(entityType: string, action: string): DigestGroup | null {
  return (
    DIGEST_SOURCES.find((source) => source.entityType === entityType && source.action === action)
      ?.group ?? null
  );
}
```

Create `apps/worker/src/delivery/urgent-content.ts`:

```ts
import type { NotificationType, PrismaClient } from '@prisma/client';

import { formatMinor } from '../mail/format.js';
import type { UrgentContent } from '../mail/templates.js';
import type { ClaimedDelivery } from './delivery.repository.js';

type UrgentSource = {
  notificationType: NotificationType;
  title: string;
  body: string;
  actionPath: string | null;
  occurrence: { planName: string; amountMinor: bigint } | null;
  budget: { primaryCurrency: string };
};

/** Only the title, body and date the in-app notification already shows; the amount only with consent. */
export function urgentContentOf(source: UrgentSource, includeAmounts: boolean): UrgentContent | null {
  const actionPath = source.actionPath ?? '/app/notifications';
  if (source.notificationType === 'PLAN_OVERDUE') {
    const name = source.occurrence?.planName ?? source.title;
    const lines = [source.body];
    if (includeAmounts && source.occurrence) {
      lines.push(
        `Сумма по плану: ${formatMinor(source.occurrence.amountMinor, source.budget.primaryCurrency)}.`,
      );
    }
    return { subject: `Просрочен платёж «${name}»`, lines, actionPath };
  }
  if (source.notificationType === 'CALENDAR_REMINDER') {
    return { subject: `Напоминание: «${source.title}»`, lines: [source.body], actionPath };
  }
  return null;
}

export async function loadUrgentContent(
  prisma: PrismaClient,
  delivery: ClaimedDelivery,
  includeAmounts: boolean,
): Promise<UrgentContent | null> {
  if (!delivery.notificationId) return null;
  const source = await prisma.notification.findFirst({
    where: { id: delivery.notificationId, budgetId: delivery.budgetId, userId: delivery.userId },
    select: {
      notificationType: true,
      title: true,
      body: true,
      actionPath: true,
      occurrence: { select: { planName: true, amountMinor: true } },
      budget: { select: { primaryCurrency: true } },
    },
  });
  return source ? urgentContentOf(source, includeAmounts) : null;
}
```

Create `apps/worker/src/delivery/digest-content.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

import { formatMinor } from '../mail/format.js';
import type { DigestContent, DigestGroup, DigestPerson } from '../mail/templates.js';
import { utcToLocal } from '../zoned-time.js';
import type { ClaimedDelivery } from './delivery.repository.js';
import { DIGEST_SOURCES, groupOf } from './digest-sources.js';

export function personName(displayName: string | null, isActiveMember: boolean): string {
  const name = displayName?.trim() || 'Участник';
  return isActiveMember ? name : `${name} (не в семье)`;
}

export function dayLabel(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: timezone }).format(
    instant,
  );
}

/**
 * Digest body, built at send time from the budget's own rows only: counts of others' actions in the
 * window (same 16 pairs as the feed, never the recipient's own, never rows without an author) and
 * today's open plan payments. Returns null when there is nothing to tell.
 */
export async function loadDigestContent(
  prisma: PrismaClient,
  delivery: ClaimedDelivery,
  includeAmounts: boolean,
): Promise<DigestContent | null> {
  const start = delivery.digestPeriodStart;
  const end = delivery.digestPeriodEnd;
  if (!start || !end) return null;
  const budget = await prisma.budget.findFirst({
    where: { id: delivery.budgetId, workspaceId: delivery.workspaceId },
    select: { timezone: true, primaryCurrency: true },
  });
  if (!budget) return null;

  const rows = await prisma.auditEvent.groupBy({
    by: ['actorUserId', 'entityType', 'action'],
    where: {
      budgetId: delivery.budgetId,
      createdAt: { gte: start, lt: end },
      AND: [{ actorUserId: { not: null } }, { actorUserId: { not: delivery.userId } }],
      OR: DIGEST_SOURCES.map(({ entityType, action }) => ({ entityType, action })),
    },
    _count: { _all: true },
  });

  const counts = new Map<string, Partial<Record<DigestGroup, number>>>();
  for (const row of rows) {
    const group = groupOf(row.entityType, row.action);
    if (!group || !row.actorUserId) continue;
    const current = counts.get(row.actorUserId) ?? {};
    current[group] = (current[group] ?? 0) + row._count._all;
    counts.set(row.actorUserId, current);
  }
  const actorIds = [...counts.keys()];
  const [users, members] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } }),
    prisma.workspaceMembership.findMany({
      where: { workspaceId: delivery.workspaceId, userId: { in: actorIds }, isActive: true },
      select: { userId: true },
    }),
  ]);
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  const active = new Set(members.map((member) => member.userId));
  const total = (value: Partial<Record<DigestGroup, number>>) =>
    Object.values(value).reduce((sum, count) => sum + (count ?? 0), 0);
  const people: DigestPerson[] = actorIds
    .map((id) => ({ name: personName(names.get(id) ?? null, active.has(id)), counts: counts.get(id)! }))
    .sort((a, b) => total(b.counts) - total(a.counts) || a.name.localeCompare(b.name, 'ru'));

  const today = utcToLocal(end, budget.timezone).date;
  const occurrences = await prisma.planOccurrence.findMany({
    where: {
      budgetId: delivery.budgetId,
      scheduledOn: new Date(`${today}T00:00:00.000Z`),
      status: { in: ['PENDING', 'DUE'] },
    },
    select: { planName: true, amountMinor: true },
    orderBy: [{ planName: 'asc' }, { id: 'asc' }],
  });
  const payments = occurrences.map((occurrence) => ({
    name: occurrence.planName,
    amount: includeAmounts ? formatMinor(occurrence.amountMinor, budget.primaryCurrency) : null,
  }));

  if (people.length === 0 && payments.length === 0) return null;
  return {
    frequency: delivery.dedupeKey.startsWith('digest:WEEKLY:') ? 'WEEKLY' : 'DAILY',
    periodLabel: dayLabel(start, budget.timezone),
    people,
    payments,
  };
}
```

Run: `pnpm --filter @harmofin/worker test -- delivery`
Expected: PASS.

- [ ] **Step 5: Обработчик отправки**

Create `apps/worker/src/delivery/deliver.handler.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import type { WorkerJobHandler } from '../job-runner.js';
import type { Mailer } from '../mail/mailer.js';
import { renderDigest, renderUrgent, type MailLinks, type RenderedMail } from '../mail/templates.js';
import type { ClaimedDelivery, DeliveryRepository } from './delivery.repository.js';
import { loadDigestContent } from './digest-content.js';
import { cancelReason, loadDeliveryFacts } from './eligibility.js';
import { loadUrgentContent } from './urgent-content.js';

export type DeliveryOutcome = 'sent' | 'cancelled' | 'retried' | 'failed';
export type DeliveryFailure = { deliveryId: string; errorName: string };

/** Same digest as apps/api/src/notification-settings/unsubscribe-token.ts. */
export function hashUnsubscribeToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function errorName(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code.slice(0, 64);
  return error instanceof Error ? error.name : 'Unknown error';
}

/**
 * Sends the email outbox. Every letter is re-checked right before sending, its text (and amounts,
 * only with consent) is built at that moment and never stored. A failure of one letter schedules a
 * retry for that letter only and the run moves on; the job itself completes. Only the delivery id
 * and the error class reach logs.
 */
export class DeliverNotificationsHandler implements WorkerJobHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DeliveryRepository,
    private readonly mailer: Mailer,
    private readonly webBaseUrl: string,
    private readonly hooks: {
      onOutcome?: (kind: string, outcome: DeliveryOutcome) => void;
      onFailure?: (failure: DeliveryFailure) => void;
    } = {},
    private readonly batchSize = 20,
  ) {}

  async execute(now: Date, budgetId?: string): Promise<void> {
    const batch = await this.repository.claim(this.batchSize, now, budgetId);
    for (const delivery of batch) {
      try {
        this.hooks.onOutcome?.(delivery.kind, await this.deliver(delivery, now));
      } catch (error) {
        const name = errorName(error);
        const failed = await this.repository.retryOrFail(delivery.id, delivery.attempts, now, name);
        this.hooks.onOutcome?.(delivery.kind, failed ? 'failed' : 'retried');
        this.hooks.onFailure?.({ deliveryId: delivery.id, errorName: name });
      }
    }
  }

  private async deliver(delivery: ClaimedDelivery, now: Date): Promise<'sent' | 'cancelled'> {
    const facts = await loadDeliveryFacts(this.prisma, delivery);
    const reason = cancelReason(delivery.kind, facts);
    if (reason) {
      await this.repository.cancel(delivery.id, reason);
      return 'cancelled';
    }
    const token = randomBytes(32).toString('base64url');
    const links: MailLinks = { webBaseUrl: this.webBaseUrl, unsubscribeToken: token };
    const mail = await this.render(delivery, facts.setting!.includeAmounts, links);
    if (!mail) {
      await this.repository.cancel(
        delivery.id,
        delivery.kind === 'DIGEST' ? 'DIGEST_EMPTY' : 'NOTIFICATION_MISSING',
      );
      return 'cancelled';
    }
    await this.repository.prepareToken(delivery.id, hashUnsubscribeToken(token));
    await this.mailer.send({ to: facts.user!.email, ...mail });
    await this.repository.markSent(delivery.id, now);
    return 'sent';
  }

  private async render(
    delivery: ClaimedDelivery,
    includeAmounts: boolean,
    links: MailLinks,
  ): Promise<RenderedMail | null> {
    if (delivery.kind === 'URGENT') {
      const content = await loadUrgentContent(this.prisma, delivery, includeAmounts);
      return content ? renderUrgent(content, links) : null;
    }
    const content = await loadDigestContent(this.prisma, delivery, includeAmounts);
    return content ? renderDigest(content, links) : null;
  }
}
```

- [ ] **Step 6: Регистрация задачи, лог и метрики**

`apps/worker/src/job.repository.ts`, `recurringJobs`: дописать

```ts
  { jobKey: 'notifications:deliver-email-v1', jobType: 'DELIVER_NOTIFICATIONS' },
```

`apps/worker/src/observability/observability.ts`, класс `MetricsRegistry`:

```ts
  recordDelivery(kind: string, outcome: 'sent' | 'cancelled' | 'retried' | 'failed'): void {
    this.increment('worker_deliveries_total', { kind, outcome });
  }
```

`apps/worker/src/logger.ts`: в интерфейс `WorkerEventLogger` и в `PinoWorkerLogger`:

```ts
  deliveryFailure(fields: { deliveryId: string; errorName: string }): void;
  mailDisabled(): void;
```

```ts
  deliveryFailure(fields: { deliveryId: string; errorName: string }): void {
    this.logger.error({ event: 'notification_delivery_failure', ...fields }, 'Letter delivery failed');
  }

  mailDisabled(): void {
    this.logger.info({ event: 'mail_disabled' }, 'SMTP is not configured: letters are not sent');
  }
```

Если в `logger.test.ts`/`observability.test.ts` есть проверка полного набора методов — дописать туда.

`apps/worker/src/main.ts`: импорты `DeliverNotificationsHandler`, `DeliveryRepository`, `SmtpMailer`; перед созданием `JobRunner`:

```ts
const mailHandlers = config.mail
  ? {
      DELIVER_NOTIFICATIONS: new DeliverNotificationsHandler(
        database,
        new DeliveryRepository(database),
        new SmtpMailer(config.mail),
        config.mail.webBaseUrl,
        {
          onOutcome: (kind, outcome) => metrics.recordDelivery(kind, outcome),
          onFailure: (failure) => {
            logger.deliveryFailure(failure);
            void errorReporter.report(new Error('Letter delivery failed'), {
              errorName: failure.errorName,
            });
          },
        },
      ),
    }
  : {};
if (!config.mail) logger.mailDisabled();
```

и в объект обработчиков `JobRunner` — `...mailHandlers,` последней строкой.

- [ ] **Step 7: Интеграционный тест отправки**

Create `apps/api/test/email-delivery.integration.test.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeliveryRepository } from '../../worker/src/delivery/delivery.repository.js';
import { DeliverNotificationsHandler } from '../../worker/src/delivery/deliver.handler.js';
import type { MailMessage } from '../../worker/src/mail/mailer.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const origin = 'http://localhost:3000';
const sent: MailMessage[] = [];
const mailer = { send: async (message: MailMessage) => void sent.push(message) };
let anna: FamilyActor;
let boris: FamilyActor;
let stranger: FamilyActor;

const handler = () =>
  new DeliverNotificationsHandler(env.prisma, new DeliveryRepository(env.prisma), mailer, origin);

async function enableEmail(actor: FamilyActor, includeAmounts = false) {
  await env.prisma.user.update({
    where: { id: actor.user.id },
    data: { emailVerifiedAt: new Date() },
  });
  await env.prisma.notificationChannelSetting.upsert({
    where: { userId_channel: { userId: actor.user.id, channel: 'EMAIL' } },
    create: {
      id: randomUUID(),
      userId: actor.user.id,
      channel: 'EMAIL',
      enabled: true,
      includeAmounts,
      amountsConsentAt: includeAmounts ? new Date() : null,
    },
    update: { enabled: true, includeAmounts, amountsConsentAt: includeAmounts ? new Date() : null },
  });
}

async function overdueNotification(actor: FamilyActor) {
  const planId = randomUUID();
  const occurrenceId = randomUUID();
  await env.prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      ownerUserId: actor.user.id,
      name: 'Ипотека',
      planType: 'EXPENSE',
      amountMinor: 4_500_000n,
      anchorOn: new Date('2026-10-01T00:00:00.000Z'),
      startOn: new Date('2026-10-01T00:00:00.000Z'),
      recurrence: 'MONTHLY',
      createdByUserId: actor.user.id,
      updatedByUserId: actor.user.id,
    },
  });
  await env.prisma.planOccurrence.create({
    data: {
      id: occurrenceId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      planId,
      scheduledOn: new Date('2026-10-25T00:00:00.000Z'),
      planName: 'Ипотека',
      planType: 'EXPENSE',
      amountMinor: 4_500_000n,
      status: 'DUE',
    },
  });
  const notificationId = randomUUID();
  await env.prisma.notification.create({
    data: {
      id: notificationId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      userId: actor.user.id,
      notificationType: 'PLAN_OVERDUE',
      occurrenceId,
      title: 'Просроченный план',
      body: 'План «Ипотека» просрочен с 2026-10-25.',
      actionPath: `/app/plans?occurrence=${occurrenceId}`,
      notificationKey: `occurrence:${occurrenceId}:PLAN_OVERDUE`,
    },
  });
  return notificationId;
}

async function queue(actor: FamilyActor, data: Record<string, unknown>) {
  const id = randomUUID();
  await env.prisma.notificationDelivery.create({
    data: {
      id,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      userId: actor.user.id,
      channel: 'EMAIL',
      kind: 'URGENT',
      dedupeKey: `test:${id}`,
      nextAttemptAt: new Date(Date.now() - 1_000),
      ...data,
    },
  });
  return id;
}

const statusOf = async (id: string) =>
  (await env.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  boris = await env.join(anna, await env.register(), 'EDITOR');
  stranger = await env.register();
});

beforeEach(async () => {
  sent.length = 0;
  // Integration files run in parallel: every claim below is scoped to this file's budgets.
  await env.prisma.notificationDelivery.updateMany({
    where: { status: 'PENDING', budgetId: { in: [anna.budgetId, stranger.budgetId] } },
    data: { status: 'CANCELLED' },
  });
});

afterAll(async () => {
  await env.stop();
});

describe('DELIVER_NOTIFICATIONS', () => {
  it('sends an urgent letter without amounts and a working unsubscribe link', async () => {
    await enableEmail(anna);
    const id = await queue(anna, { notificationId: await overdueNotification(anna) });

    await handler().execute(new Date(), anna.budgetId);

    expect(await statusOf(id)).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(anna.user.email);
    expect(sent[0]!.subject).toBe('Просрочен платёж «Ипотека»');
    expect(sent[0]!.text).not.toMatch(/45\s000/u);
    const link = /<(.+)>/.exec(sent[0]!.headers['List-Unsubscribe']!)![1]!;
    const token = new URL(link).searchParams.get('token')!;
    const row = await env.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    expect(row.unsubscribeTokenHash).toBe(createHash('sha256').update(token).digest('hex'));

    const response = await env.server.inject({
      method: 'POST',
      url: '/api/v1/notifications/unsubscribe',
      headers: { origin },
      payload: { token },
    });
    expect(response.statusCode).toBe(204);
    const setting = await env.prisma.notificationChannelSetting.findUniqueOrThrow({
      where: { userId_channel: { userId: anna.user.id, channel: 'EMAIL' } },
    });
    expect(setting.enabled).toBe(false);
  });

  it('adds the amount only with consent', async () => {
    await enableEmail(anna, true);
    await queue(anna, { notificationId: await overdueNotification(anna) });
    await handler().execute(new Date(), anna.budgetId);
    expect(sent[0]!.text).toMatch(/Сумма по плану: 45\s000,00\s₽\./u);
  });

  it('cancels a letter for a disabled channel, a read notification and a former member', async () => {
    await enableEmail(anna);
    const read = await overdueNotification(anna);
    await env.prisma.notification.update({ where: { id: read }, data: { readAt: new Date() } });
    const readId = await queue(anna, { notificationId: read });

    await enableEmail(boris);
    const borisId = await queue(boris, {
      kind: 'DIGEST',
      dedupeKey: `digest:DAILY:${randomUUID()}`,
      digestPeriodStart: new Date(Date.now() - 86_400_000),
      digestPeriodEnd: new Date(),
    });
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: anna.workspaceId, userId: boris.user.id },
      data: { isActive: false },
    });

    const strangerId = await queue(stranger, {
      kind: 'DIGEST',
      dedupeKey: `digest:DAILY:${randomUUID()}`,
      digestPeriodStart: new Date(Date.now() - 86_400_000),
      digestPeriodEnd: new Date(),
    });

    await handler().execute(new Date(), anna.budgetId);

    await handler().execute(new Date(), stranger.budgetId);

    expect(sent).toHaveLength(0);
    expect(await statusOf(readId)).toBe('CANCELLED');
    expect(await statusOf(borisId)).toBe('CANCELLED');
    expect(await statusOf(strangerId)).toBe('CANCELLED');
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: anna.workspaceId, userId: boris.user.id },
      data: { isActive: true },
    });
  });

  it('builds a digest from others actions only, inside the budget and the window', async () => {
    await enableEmail(anna);
    const start = new Date(Date.now() - 3_600_000);
    const audit = (actor: FamilyActor | null, budget: FamilyActor, at: Date, entityType = 'transaction') =>
      env.prisma.auditEvent.create({
        data: {
          id: randomUUID(),
          actorUserId: actor?.user.id ?? null,
          workspaceId: budget.workspaceId,
          budgetId: budget.budgetId,
          entityType,
          entityId: randomUUID(),
          action: 'CREATED',
          source: 'API',
          createdAt: at,
        },
      });
    const inside = new Date(Date.now() - 600_000);
    await audit(boris, anna, inside);
    await audit(boris, anna, inside);
    await audit(boris, anna, inside, 'calendar_event');
    await audit(anna, anna, inside); // own action
    await audit(null, anna, inside); // no author
    await audit(boris, anna, new Date(start.getTime() - 60_000)); // before the window
    await audit(boris, anna, inside, 'category'); // not a feed pair
    await audit(stranger, stranger, inside); // other budget

    const id = await queue(anna, {
      kind: 'DIGEST',
      dedupeKey: `digest:DAILY:${randomUUID()}`,
      digestPeriodStart: start,
      digestPeriodEnd: new Date(),
    });
    await handler().execute(new Date(), anna.budgetId);

    expect(await statusOf(id)).toBe('SENT');
    const borisName = (await env.prisma.user.findUniqueOrThrow({ where: { id: boris.user.id } }))
      .displayName!;
    expect(sent[0]!.text).toContain(`${borisName}: 2 операции, 1 событие календаря`);
    expect(sent[0]!.text).not.toContain('Участник:');
  });

  it('cancels an empty digest', async () => {
    await enableEmail(anna);
    const id = await queue(anna, {
      kind: 'DIGEST',
      dedupeKey: `digest:DAILY:${randomUUID()}`,
      digestPeriodStart: new Date(Date.now() - 60_000),
      digestPeriodEnd: new Date(),
    });
    await handler().execute(new Date(), anna.budgetId);
    expect(await statusOf(id)).toBe('CANCELLED');
  });

  it('retries a failing letter and gives up after five attempts', async () => {
    await enableEmail(anna);
    const id = await queue(anna, { notificationId: await overdueNotification(anna) });
    const broken = new DeliverNotificationsHandler(
      env.prisma,
      new DeliveryRepository(env.prisma),
      { send: async () => Promise.reject(Object.assign(new Error('down'), { code: 'ECONNECTION' })) },
      origin,
    );
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await env.prisma.notificationDelivery.update({
        where: { id },
        data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      });
      await broken.execute(new Date(), anna.budgetId);
    }
    const row = await env.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'ECONNECTION' });
  });

  it('never hands the same letter to two concurrent runs', async () => {
    await enableEmail(anna);
    await queue(anna, { notificationId: await overdueNotification(anna) });
    const repository = new DeliveryRepository(env.prisma);
    const [first, second] = await Promise.all([
      repository.claim(20, new Date(), anna.budgetId),
      repository.claim(20, new Date(), anna.budgetId),
    ]);
    expect(first.length + second.length).toBe(1);
  });
});
```

`audit` в тесте — локальная функция создания записи аудита. Каждый вызов обработчика ограничен бюджетом этого файла (`execute(now, budgetId)`): интеграционные файлы vitest запускает параллельно, а очередь общая. Записи с `entityType: 'category'` и в чужом бюджете не должны попасть в письмо.

Run: `pnpm test:integration -- email-delivery` (или весь `pnpm test:integration`)
Expected: PASS.

- [ ] **Step 8: Проверки и индексация**

Run: `pnpm --filter @harmofin/worker test && pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add apps/worker/src/delivery apps/worker/src/job.repository.ts apps/worker/src/main.ts apps/worker/src/logger.ts apps/worker/src/observability/observability.ts apps/api/test/email-delivery.integration.test.ts
```

Коммит: `feat(worker): очередь писем и отправка с повторами и перепроверкой прав`.

---

### Task 6: Постановка срочных писем и дайджестов

**Files:**
- Create: `apps/worker/src/delivery/enqueue.ts`, `digest-schedule.ts`, `digest-schedule.test.ts`, `build-digests.handler.ts`
- Modify: `apps/worker/src/notification.handler.ts`, `apps/worker/src/notification.handler.test.ts`
- Modify: `apps/worker/src/calendar-reminder.handler.ts`, `apps/worker/src/calendar-reminder.handler.test.ts`
- Modify: `apps/worker/src/job.repository.ts`, `apps/worker/src/main.ts`
- Create: `apps/api/test/email-digest.integration.test.ts`

**Interfaces:**
- Consumes: модели задачи 1; `DIGEST_SOURCES` (задача 5); `FEED_SOURCES` из `apps/api/src/activity-feed/feed-kinds.ts`; `utcToLocal`.
- Produces:
  - `enqueueUrgentEmail(tx: Prisma.TransactionClient, input: { notificationId: string; workspaceId: string; budgetId: string; userId: string; now: Date }): Promise<void>`;
  - `digestSlot(now: Date, timezone: string, frequency: 'DAILY' | 'WEEKLY'): string | null` — локальная дата слота или `null`;
  - `digestWindowStart(now: Date, frequency: 'DAILY' | 'WEEKLY', previousEnd: Date | null): Date`;
  - `digestDedupeKey(frequency, localDate): string` — `digest:<frequency>:<YYYY-MM-DD>`;
  - `class BuildEmailDigestsHandler implements WorkerJobHandler` с `execute(now: Date, budgetId?: string)` (параметр — только для тестов, как у `NotificationRuleHandler`); `DELIVERY_RETENTION_MS = 90 дней`.

- [ ] **Step 1: Падающий тест расписания**

Create `apps/worker/src/delivery/digest-schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { digestDedupeKey, digestSlot, digestWindowStart } from './digest-schedule.js';

const DAY = 86_400_000;

describe('digestSlot', () => {
  it('is due from 08:00 to 11:59 local time', () => {
    // Moscow is UTC+3 all year.
    expect(digestSlot(new Date('2026-10-31T04:59:00.000Z'), 'Europe/Moscow', 'DAILY')).toBeNull();
    expect(digestSlot(new Date('2026-10-31T05:00:00.000Z'), 'Europe/Moscow', 'DAILY')).toBe(
      '2026-10-31',
    );
    expect(digestSlot(new Date('2026-10-31T08:59:00.000Z'), 'Europe/Moscow', 'DAILY')).toBe(
      '2026-10-31',
    );
    expect(digestSlot(new Date('2026-10-31T09:00:00.000Z'), 'Europe/Moscow', 'DAILY')).toBeNull();
  });

  it('sends the weekly digest on Monday only', () => {
    // 2026-11-02 is a Monday.
    expect(digestSlot(new Date('2026-11-02T06:00:00.000Z'), 'Europe/Moscow', 'WEEKLY')).toBe(
      '2026-11-02',
    );
    expect(digestSlot(new Date('2026-11-03T06:00:00.000Z'), 'Europe/Moscow', 'WEEKLY')).toBeNull();
  });

  it('follows daylight saving time', () => {
    // Berlin: UTC+2 until 25 Oct 2026, UTC+1 after.
    expect(digestSlot(new Date('2026-10-24T06:00:00.000Z'), 'Europe/Berlin', 'DAILY')).toBe(
      '2026-10-24',
    );
    expect(digestSlot(new Date('2026-10-26T06:00:00.000Z'), 'Europe/Berlin', 'DAILY')).toBeNull();
    expect(digestSlot(new Date('2026-10-26T07:00:00.000Z'), 'Europe/Berlin', 'DAILY')).toBe(
      '2026-10-26',
    );
  });
});

describe('digestWindowStart', () => {
  const now = new Date('2026-10-31T05:00:00.000Z');

  it('continues from the previous digest', () => {
    const previous = new Date('2026-10-30T05:10:00.000Z');
    expect(digestWindowStart(now, 'DAILY', previous)).toEqual(previous);
  });

  it('never looks back further than the frequency allows', () => {
    expect(digestWindowStart(now, 'DAILY', null)).toEqual(new Date(now.getTime() - DAY));
    expect(digestWindowStart(now, 'WEEKLY', new Date('2026-09-01T00:00:00.000Z'))).toEqual(
      new Date(now.getTime() - 7 * DAY),
    );
  });
});

describe('digestDedupeKey', () => {
  it('names the frequency and the local date', () => {
    expect(digestDedupeKey('WEEKLY', '2026-11-02')).toBe('digest:WEEKLY:2026-11-02');
  });
});
```

Run: `pnpm --filter @harmofin/worker test -- digest-schedule`
Expected: FAIL — модуль не найден.

- [ ] **Step 2: Расписание и постановка**

Create `apps/worker/src/delivery/digest-schedule.ts`:

```ts
import { utcToLocal } from '../zoned-time.js';

const DAY_MS = 86_400_000;

/**
 * Local date of the digest slot, or null outside it. The slot is 08:00–11:59 local time (Monday only
 * for WEEKLY): a digest switched on in the afternoon waits for the next morning, and a worker outage
 * of up to four hours still sends it. A missed slot is not caught up.
 */
export function digestSlot(now: Date, timezone: string, frequency: 'DAILY' | 'WEEKLY'): string | null {
  const local = utcToLocal(now, timezone);
  if (local.time < '08:00' || local.time >= '12:00') return null;
  if (frequency === 'WEEKLY' && new Date(`${local.date}T00:00:00.000Z`).getUTCDay() !== 1) {
    return null;
  }
  return local.date;
}

export function digestWindowStart(
  now: Date,
  frequency: 'DAILY' | 'WEEKLY',
  previousEnd: Date | null,
): Date {
  const floor = new Date(now.getTime() - (frequency === 'DAILY' ? DAY_MS : 7 * DAY_MS));
  return previousEnd && previousEnd > floor ? previousEnd : floor;
}

export function digestDedupeKey(frequency: 'DAILY' | 'WEEKLY', localDate: string): string {
  return `digest:${frequency}:${localDate}`;
}
```

Create `apps/worker/src/delivery/enqueue.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

/**
 * Called inside the transaction that has just created the in-app notification, so the letter is
 * queued exactly when the notification exists. The settings are read here only to avoid queueing
 * letters nobody wants; the sender re-checks everything before sending.
 */
export async function enqueueUrgentEmail(
  tx: Prisma.TransactionClient,
  input: { notificationId: string; workspaceId: string; budgetId: string; userId: string; now: Date },
): Promise<void> {
  const setting = await tx.notificationChannelSetting.findUnique({
    where: { userId_channel: { userId: input.userId, channel: 'EMAIL' } },
    select: { enabled: true, urgentEnabled: true },
  });
  if (!setting?.enabled || !setting.urgentEnabled) return;
  await tx.notificationDelivery.createMany({
    data: {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      budgetId: input.budgetId,
      userId: input.userId,
      channel: 'EMAIL',
      kind: 'URGENT',
      notificationId: input.notificationId,
      dedupeKey: `urgent:${input.notificationId}`,
      nextAttemptAt: input.now,
    },
    skipDuplicates: true,
  });
}
```

Create `apps/worker/src/delivery/build-digests.handler.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import type { WorkerJobHandler } from '../job-runner.js';
import { digestDedupeKey, digestSlot, digestWindowStart } from './digest-schedule.js';

export const DELIVERY_RETENTION_MS = 90 * 86_400_000;

/**
 * Queues one digest per user and budget per slot. The unique dedupe key makes reruns and overlapping
 * runs no-ops. Only the window is stored; the content is built when the letter is sent. Also drops
 * finished queue rows older than 90 days (their unsubscribe links expire with them). `budgetId`
 * narrows the run to one budget (tests); the cleanup then runs for that budget only.
 */
export class BuildEmailDigestsHandler implements WorkerJobHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(now: Date, budgetId?: string): Promise<void> {
    const settings = await this.prisma.notificationChannelSetting.findMany({
      where: {
        channel: 'EMAIL',
        enabled: true,
        digestFrequency: { not: 'OFF' },
        user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
      },
      select: { userId: true, digestFrequency: true },
    });

    for (const setting of settings) {
      const frequency = setting.digestFrequency === 'WEEKLY' ? 'WEEKLY' : 'DAILY';
      const memberships = await this.prisma.workspaceMembership.findMany({
        where: { userId: setting.userId, isActive: true, workspace: { status: 'ACTIVE' } },
        select: {
          workspaceId: true,
          workspace: {
            select: {
              budgets: {
                where: {
                  status: 'ACTIVE',
                  planModelVersion: 2,
                  ...(budgetId ? { id: budgetId } : {}),
                },
                select: { id: true, timezone: true },
              },
            },
          },
        },
      });
      for (const membership of memberships) {
        for (const budget of membership.workspace.budgets) {
          const localDate = digestSlot(now, budget.timezone, frequency);
          if (!localDate) continue;
          const previous = await this.prisma.notificationDelivery.findFirst({
            where: {
              userId: setting.userId,
              budgetId: budget.id,
              kind: 'DIGEST',
              status: { in: ['SENT', 'CANCELLED'] },
            },
            orderBy: { digestPeriodEnd: 'desc' },
            select: { digestPeriodEnd: true },
          });
          await this.prisma.notificationDelivery.createMany({
            data: {
              id: randomUUID(),
              workspaceId: membership.workspaceId,
              budgetId: budget.id,
              userId: setting.userId,
              channel: 'EMAIL',
              kind: 'DIGEST',
              digestPeriodStart: digestWindowStart(now, frequency, previous?.digestPeriodEnd ?? null),
              digestPeriodEnd: now,
              dedupeKey: digestDedupeKey(frequency, localDate),
              nextAttemptAt: now,
            },
            skipDuplicates: true,
          });
        }
      }
    }

    await this.prisma.notificationDelivery.deleteMany({
      where: {
        status: { in: ['SENT', 'CANCELLED', 'FAILED'] },
        updatedAt: { lt: new Date(now.getTime() - DELIVERY_RETENTION_MS) },
        ...(budgetId ? { budgetId } : {}),
      },
    });
  }
}
```

Run: `pnpm --filter @harmofin/worker test -- digest-schedule`
Expected: PASS.

- [ ] **Step 3: Срочные письма из существующих обработчиков**

`apps/worker/src/notification.handler.ts`, функция `createOccurrenceNotification`, после `if (result.count === 0) return;` и до аудита:

```ts
  if (type === 'PLAN_OVERDUE') {
    await enqueueUrgentEmail(tx, {
      notificationId,
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      userId,
      now: new Date(),
    });
  }
```

`apps/worker/src/calendar-reminder.handler.ts`, метод `createReminder`, после `if (result.count !== 1) return;`:

```ts
    await enqueueUrgentEmail(tx, {
      notificationId,
      workspaceId: event.workspaceId,
      budgetId: event.budgetId,
      userId: values.userId,
      now: new Date(),
    });
```

Импорт в обоих файлах: `import { enqueueUrgentEmail } from './delivery/enqueue.js';`. Дописать в JSDoc обоих классов одну строку: «Срочное письмо ставится в очередь в той же транзакции, только для только что созданного уведомления».

В фейках транзакции юнит-тестов (`makeTx` в `calendar-reminder.handler.test.ts` и аналог в `notification.handler.test.ts`) дописать:

```ts
    notificationChannelSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
```

и тесты.

В `apps/worker/src/calendar-reminder.handler.test.ts`:

```ts
  it('queues an urgent letter for each newly created reminder of a subscriber', async () => {
    const tx = makeTx({
      notificationChannelSetting: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true, urgentEnabled: true }),
      },
      notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    });
    const prisma = makePrisma([weeklyEvent()], tx);
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-03T13:05:00Z'));

    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(2);
    expect(tx.notificationDelivery.createMany.mock.calls[0]![0]).toMatchObject({
      data: { kind: 'URGENT', channel: 'EMAIL', budgetId: 'budget-1', workspaceId: 'workspace-1' },
      skipDuplicates: true,
    });
  });

  it('queues nothing for a reminder the unique key skipped', async () => {
    const tx = makeTx({
      notification: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      notificationChannelSetting: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true, urgentEnabled: true }),
      },
      notificationDelivery: { createMany: vi.fn() },
    });
    const prisma = makePrisma([weeklyEvent()], tx);
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-03T13:05:00Z'));

    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });
```

В `apps/worker/src/notification.handler.test.ts`:

```ts
  it('queues an urgent letter for a new overdue notification only', async () => {
    const tx = makeTx({
      notificationChannelSetting: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true, urgentEnabled: true }),
      },
      notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    });
    tx.planOccurrence.findMany.mockResolvedValue([
      occurrence('occ-late', '2026-09-09', 100n),
      occurrence('occ-today', '2026-09-10', 100n),
    ]);
    const handler = new NotificationRuleHandler(makePrisma([budget()], tx) as never);
    await handler.execute(now);

    // PLAN_TODAY is not urgent: one letter, for the overdue occurrence.
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(1);
    expect(tx.notificationDelivery.createMany.mock.calls[0]![0]).toMatchObject({
      data: { kind: 'URGENT', userId: 'owner-1', budgetId: 'budget-1' },
    });

    tx.notification.createMany.mockResolvedValue({ count: 0 });
    await handler.execute(now);
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(1);
  });

  it('queues nothing when the owner has not subscribed', async () => {
    const tx = makeTx();
    tx.planOccurrence.findMany.mockResolvedValue([occurrence('occ-late', '2026-09-09', 100n)]);
    await new NotificationRuleHandler(makePrisma([budget()], tx) as never).execute(now);
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });
```

Run: `pnpm --filter @harmofin/worker test`
Expected: PASS.

- [ ] **Step 4: Регистрация задачи**

`apps/worker/src/job.repository.ts`, `recurringJobs`:

```ts
  { jobKey: 'notifications:build-email-digests-v1', jobType: 'BUILD_EMAIL_DIGESTS' },
```

`apps/worker/src/main.ts`: в объект `mailHandlers` (задача 5) дописать `BUILD_EMAIL_DIGESTS: new BuildEmailDigestsHandler(database),`.

- [ ] **Step 5: Интеграционный тест**

Create `apps/api/test/email-digest.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FEED_SOURCES } from '../src/activity-feed/feed-kinds.js';
import { BuildEmailDigestsHandler } from '../../worker/src/delivery/build-digests.handler.js';
import { DIGEST_SOURCES } from '../../worker/src/delivery/digest-sources.js';
import { CalendarReminderHandler } from '../../worker/src/calendar-reminder.handler.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let anna: FamilyActor;
let boris: FamilyActor;

// 2026-11-02 is a Monday; 09:00 in UTC.
const mondayMorning = new Date('2026-11-02T09:00:00.000Z');

async function subscribe(actor: FamilyActor, digestFrequency: 'DAILY' | 'WEEKLY' | 'OFF') {
  await env.prisma.user.update({
    where: { id: actor.user.id },
    data: { emailVerifiedAt: new Date() },
  });
  await env.prisma.notificationChannelSetting.upsert({
    where: { userId_channel: { userId: actor.user.id, channel: 'EMAIL' } },
    create: { id: randomUUID(), userId: actor.user.id, channel: 'EMAIL', enabled: true, digestFrequency },
    update: { enabled: true, digestFrequency },
  });
}

const digests = (actor: FamilyActor) =>
  env.prisma.notificationDelivery.findMany({
    where: { userId: actor.user.id, kind: 'DIGEST' },
    orderBy: { createdAt: 'asc' },
  });

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  boris = await env.join(anna, await env.register(), 'VIEWER');
  await env.prisma.budget.update({ where: { id: anna.budgetId }, data: { timezone: 'UTC' } });
});

afterAll(async () => {
  await env.stop();
});

describe('digest sources', () => {
  it('match the activity feed whitelist', () => {
    const pairs = (items: ReadonlyArray<{ entityType: string; action: string }>) =>
      items.map((item) => `${item.entityType}:${item.action}`).sort();
    expect(pairs(DIGEST_SOURCES)).toEqual(pairs(FEED_SOURCES));
  });
});

describe('BUILD_EMAIL_DIGESTS', () => {
  it('queues one digest per slot, also for a viewer, and none outside the slot', async () => {
    await subscribe(anna, 'DAILY');
    await subscribe(boris, 'WEEKLY');
    const handler = new BuildEmailDigestsHandler(env.prisma);

    await handler.execute(new Date('2026-11-02T07:59:00.000Z'), anna.budgetId);
    expect(await digests(anna)).toHaveLength(0);

    await handler.execute(mondayMorning, anna.budgetId);
    await handler.execute(new Date(mondayMorning.getTime() + 15 * 60_000), anna.budgetId);

    const annaRows = await digests(anna);
    expect(annaRows).toHaveLength(1);
    expect(annaRows[0]).toMatchObject({
      dedupeKey: 'digest:DAILY:2026-11-02',
      budgetId: anna.budgetId,
      status: 'PENDING',
    });
    expect(annaRows[0]!.digestPeriodStart).toEqual(new Date(mondayMorning.getTime() - 86_400_000));
    expect((await digests(boris))[0]).toMatchObject({ dedupeKey: 'digest:WEEKLY:2026-11-02' });
  });

  it('continues the window from the last finished digest', async () => {
    const [first] = await digests(anna);
    await env.prisma.notificationDelivery.update({
      where: { id: first!.id },
      data: { status: 'SENT' },
    });
    const tuesday = new Date('2026-11-03T08:30:00.000Z');
    await new BuildEmailDigestsHandler(env.prisma).execute(tuesday, anna.budgetId);
    const second = (await digests(anna)).find((row) => row.dedupeKey === 'digest:DAILY:2026-11-03')!;
    expect(second.digestPeriodStart).toEqual(first!.digestPeriodEnd);
  });

  it('skips users with the digest off, an unverified address or the channel off', async () => {
    const carol = await env.join(anna, await env.register(), 'EDITOR');
    await subscribe(carol, 'OFF');
    const dave = await env.join(anna, await env.register(), 'EDITOR');
    await env.prisma.notificationChannelSetting.create({
      data: { id: randomUUID(), userId: dave.user.id, channel: 'EMAIL', enabled: true },
    });
    await new BuildEmailDigestsHandler(env.prisma).execute(mondayMorning, anna.budgetId);
    expect(await digests(carol)).toHaveLength(0);
    expect(await digests(dave)).toHaveLength(0);
  });

  it('drops finished rows older than 90 days', async () => {
    const id = randomUUID();
    await env.prisma.notificationDelivery.create({
      data: {
        id,
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        userId: anna.user.id,
        channel: 'EMAIL',
        kind: 'DIGEST',
        dedupeKey: `digest:DAILY:old-${id}`,
        nextAttemptAt: new Date(),
        status: 'SENT',
      },
    });
    await env.prisma.$executeRaw`
      UPDATE "notification_deliveries" SET "updated_at" = now() - interval '91 days' WHERE "id" = ${id}::uuid`;
    await new BuildEmailDigestsHandler(env.prisma).execute(new Date(), anna.budgetId);
    expect(await env.prisma.notificationDelivery.findUnique({ where: { id } })).toBeNull();
  });
});

describe('urgent letters', () => {
  it('are queued with a new calendar reminder for a subscriber only', async () => {
    await subscribe(anna, 'OFF');
    const eventId = randomUUID();
    // Reminder 60 min ahead of a start in 45 min: due 15 min ago, inside the 30-min window.
    const startsAt = new Date(Date.now() + 45 * 60_000);
    await env.prisma.calendarEvent.create({
      data: {
        id: eventId,
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        createdByUserId: anna.user.id,
        title: 'Родительское собрание',
        allDay: false,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        recurrence: 'NONE',
        interval: 1,
        weekdays: [],
        reminderMinutes: 60,
      },
    });
    const handler = new CalendarReminderHandler(env.prisma);
    await handler.execute(new Date());
    await handler.execute(new Date());

    const rows = await env.prisma.notificationDelivery.findMany({
      where: { userId: anna.user.id, kind: 'URGENT' },
      include: { notification: { select: { relatedEntityId: true } } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.notification?.relatedEntityId).toBe(eventId);
    expect(rows[0]!.dedupeKey).toBe(`urgent:${rows[0]!.notificationId}`);
  });
});
```

Если `CalendarEvent` требует ещё обязательных полей — взять их из `apps/api/test/calendar-events.integration.test.ts`. Тест «срочного» для `PLAN_OVERDUE` уже покрыт юнит-тестом шага 3; интеграционный по образцу `v2-notifications.integration.test.ts` добавить, если хватает времени, не обязательно.

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 6: Проверки и индексация**

Run: `pnpm --filter @harmofin/worker test && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

```bash
git add apps/worker/src/delivery apps/worker/src/notification.handler.ts apps/worker/src/notification.handler.test.ts apps/worker/src/calendar-reminder.handler.ts apps/worker/src/calendar-reminder.handler.test.ts apps/worker/src/job.repository.ts apps/worker/src/main.ts apps/api/test/email-digest.integration.test.ts
```

Коммит: `feat(worker): срочные письма и дайджест по расписанию бюджета`.

После задачи 6 — конец PR 2: координатор спрашивает владельца об открытии PR.

---

## PR 3 — веб

PR 3 начинается от свежего `main` после мержа PR 2, ветка `feat/email-notifications-web`. Перед любой визуальной правкой прочитать [Calm Fintech](../specs/2026-09-17-calm-fintech-visual-guidelines.md).

### Task 7: Клиент API и страница «Уведомления на почту»

**Files:**
- Create: `apps/web/app/composables/useNotificationSettings.ts`, `useNotificationSettings.test.ts`
- Modify: `apps/web/app/composables/useApiClient.ts`, `useApiClient.test.ts`
- Create: `apps/web/app/pages/app/settings/notifications.vue`, `notifications.test.ts`
- Modify: `apps/web/app/pages/app/settings/index.vue`, `index.test.ts`

**Interfaces:**
- Consumes: эндпоинты задач 2 и 3; `useApiClient().request<T>(path, init)`; `errorMessage(error): { summary; fields }` из `useAuth.js`; `UiConfirmDialog` (`open`, `title`, `description`, `confirmLabel`, `cancelLabel`, `variant`, события `confirm`/`cancel`), `UiSelect` (`modelValue`, `options`, `name`, `label`, `hint`, `error`), `UiStatus` (`label`, `tone`), `UiCard`, `UiButton`, `ReferencePageLayout`.
- Produces:
  - `type DigestFrequency = 'OFF' | 'DAILY' | 'WEEKLY'`;
  - `interface EmailNotificationSettings { email; emailVerified; enabled; urgentEnabled; digestFrequency; includeAmounts; amountsConsentAt: string | null }`;
  - `interface EmailNotificationSettingsInput { enabled; urgentEnabled; digestFrequency; includeAmounts; amountsConsent?: boolean }`;
  - `useNotificationSettings(): { getEmail(); saveEmail(input); requestEmailVerification(); confirmEmailVerification(token); unsubscribe(token) }`.

- [ ] **Step 1: Падающие тесты клиента**

Create `apps/web/app/composables/useNotificationSettings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('./useApiClient.js', () => ({ useApiClient: () => ({ request }) }));

import { useNotificationSettings } from './useNotificationSettings.js';

describe('useNotificationSettings', () => {
  beforeEach(() => request.mockReset().mockResolvedValue(undefined));

  it('reads and saves the email settings', async () => {
    const api = useNotificationSettings();
    await api.getEmail();
    await api.saveEmail({
      enabled: true,
      urgentEnabled: false,
      digestFrequency: 'WEEKLY',
      includeAmounts: true,
      amountsConsent: true,
    });
    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/me/notification-settings/email');
    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/me/notification-settings/email', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        urgentEnabled: false,
        digestFrequency: 'WEEKLY',
        includeAmounts: true,
        amountsConsent: true,
      }),
    });
  });

  it('posts verification, confirmation and unsubscribe requests', async () => {
    const api = useNotificationSettings();
    await api.requestEmailVerification();
    await api.confirmEmailVerification('raw-1');
    await api.unsubscribe('raw-2');
    expect(request.mock.calls).toEqual([
      ['/api/v1/me/email-verification', { method: 'POST' }],
      [
        '/api/v1/auth/email-verification/confirm',
        { method: 'POST', body: JSON.stringify({ token: 'raw-1' }) },
      ],
      ['/api/v1/notifications/unsubscribe', { method: 'POST', body: JSON.stringify({ token: 'raw-2' }) }],
    ]);
  });
});
```

В `apps/web/app/composables/useApiClient.test.ts` добавить тест по образцу существующего для `/api/v1/auth/deletion/cancel`: `POST /api/v1/auth/email-verification/confirm` и `POST /api/v1/notifications/unsubscribe` уходят без запроса `/api/v1/auth/csrf` и без заголовка `X-CSRF-Token`.

Run: `pnpm --filter @harmofin/web test -- useNotificationSettings useApiClient`
Expected: FAIL.

- [ ] **Step 2: Клиент и исключения CSRF**

Create `apps/web/app/composables/useNotificationSettings.ts`:

```ts
import { useApiClient } from './useApiClient.js';

// Thin typed client over the account-level email notification endpoints (/api/v1).

export type DigestFrequency = 'OFF' | 'DAILY' | 'WEEKLY';

export interface EmailNotificationSettings {
  email: string;
  emailVerified: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsentAt: string | null;
}

export interface EmailNotificationSettingsInput {
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsent?: boolean;
}

const SETTINGS = '/api/v1/me/notification-settings/email';

export function useNotificationSettings() {
  const api = useApiClient();
  return {
    getEmail: () => api.request<EmailNotificationSettings>(SETTINGS),
    saveEmail: (input: EmailNotificationSettingsInput) =>
      api.request<EmailNotificationSettings>(SETTINGS, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    requestEmailVerification: () =>
      api.request<void>('/api/v1/me/email-verification', { method: 'POST' }),
    confirmEmailVerification: (token: string) =>
      api.request<void>('/api/v1/auth/email-verification/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    unsubscribe: (token: string) =>
      api.request<void>('/api/v1/notifications/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
  };
}
```

В `apps/web/app/composables/useApiClient.ts`, функция `requiresCsrf`, перед закрывающей скобкой условия:

```ts
    // Opened from a letter, possibly signed out: confirmation and unsubscribe carry their own token.
    path !== '/api/v1/auth/email-verification/confirm' &&
    path !== '/api/v1/notifications/unsubscribe' &&
```

(вставить перед строкой `path !== '/api/v1/invitations/preview'`, сохранив `&&` между условиями).

Run: `pnpm --filter @harmofin/web test -- useNotificationSettings useApiClient`
Expected: PASS.

- [ ] **Step 3: Падающий тест страницы**

Create `apps/web/app/pages/app/settings/notifications.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const api = vi.hoisted(() => ({
  getEmail: vi.fn(),
  saveEmail: vi.fn(),
  requestEmailVerification: vi.fn(),
}));
vi.mock('../../../composables/useNotificationSettings.js', () => ({
  useNotificationSettings: () => api,
}));

import NotificationsSettingsPage from './notifications.vue';

const verified = {
  email: 'a***@example.test',
  emailVerified: true,
  enabled: true,
  urgentEnabled: true,
  digestFrequency: 'DAILY',
  includeAmounts: false,
  amountsConsentAt: null,
};

const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  UiConfirmDialog: {
    props: ['open', 'title', 'description', 'confirmLabel', 'cancelLabel'],
    emits: ['confirm', 'cancel'],
    template:
      '<div v-if="open" role="dialog"><p>{{ title }}</p><p>{{ description }}</p><button data-test="consent-yes" @click="$emit(\'confirm\')">{{ confirmLabel }}</button><button data-test="consent-no" @click="$emit(\'cancel\')">{{ cancelLabel }}</button></div>',
  },
};

async function mountPage() {
  const wrapper = mount(NotificationsSettingsPage, { global: { stubs } });
  await flushPromises();
  return wrapper;
}

describe('settings notifications page', () => {
  beforeEach(() => {
    api.getEmail.mockReset().mockResolvedValue({ ...verified });
    api.saveEmail.mockReset().mockImplementation(async (input) => ({ ...verified, ...input }));
    api.requestEmailVerification.mockReset().mockResolvedValue(undefined);
  });

  it('shows the masked address and the current settings', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('a***@example.test');
    expect((wrapper.get('[name="enabled"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain('В 08:00 по времени бюджета');
  });

  it('offers to verify an unconfirmed address and keeps the channel switch disabled', async () => {
    api.getEmail.mockResolvedValue({ ...verified, emailVerified: false, enabled: false });
    const wrapper = await mountPage();
    expect(wrapper.get('[name="enabled"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-action="request-verification"]').trigger('click');
    await flushPromises();
    expect(api.requestEmailVerification).toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ссылка действует 24 часа');
  });

  it('asks for consent before showing amounts and sends it with the save', async () => {
    const wrapper = await mountPage();
    const amounts = wrapper.get('[name="includeAmounts"]');
    await amounts.setValue(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect((amounts.element as HTMLInputElement).checked).toBe(false);

    await wrapper.get('[data-test="consent-yes"]').trigger('click');
    expect((amounts.element as HTMLInputElement).checked).toBe(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(api.saveEmail).toHaveBeenCalledWith({
      enabled: true,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: true,
      amountsConsent: true,
    });
    expect(wrapper.text()).toContain('Настройки сохранены.');
  });

  it('keeps amounts off when consent is declined', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[name="includeAmounts"]').setValue(true);
    await wrapper.get('[data-test="consent-no"]').trigger('click');
    expect((wrapper.get('[name="includeAmounts"]').element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('shows a server error', async () => {
    api.saveEmail.mockRejectedValue(
      new ApiRequestError(409, { code: 'EMAIL_NOT_VERIFIED', detail: 'Сначала подтвердите почту.' }),
    );
    const wrapper = await mountPage();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Сначала подтвердите почту.');
  });
});
```

Run: `pnpm --filter @harmofin/web test -- settings/notifications`
Expected: FAIL — `notifications.vue` не найден.

- [ ] **Step 4: Страница**

Create `apps/web/app/pages/app/settings/notifications.vue`:

```vue
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiCard from '../../../components/ui/Card.vue';
import UiConfirmDialog from '../../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import UiSelect from '../../../components/ui/Select.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { errorMessage } from '../../../composables/useAuth.js';
import {
  type DigestFrequency,
  type EmailNotificationSettings,
  useNotificationSettings,
} from '../../../composables/useNotificationSettings.js';

defineOptions({ name: 'AppSettingsNotificationsPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const api = useNotificationSettings();
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const summary = ref('');
const summaryTone = ref<'success' | 'danger'>('success');
const fieldErrors = ref<Record<string, string>>({});
const settings = ref<EmailNotificationSettings | null>(null);
const form = reactive({
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY' as DigestFrequency,
  includeAmounts: false,
});
// Consent given in the dialog during this edit; sent with the next save only.
const consentGiven = ref(false);
const consentOpen = ref(false);
const verifying = ref(false);
const verificationSent = ref(false);

const digestOptions = [
  { value: 'OFF', label: 'Не присылать' },
  { value: 'DAILY', label: 'Каждый день' },
  { value: 'WEEKLY', label: 'Раз в неделю' },
];

function sync(next: EmailNotificationSettings) {
  settings.value = next;
  form.enabled = next.enabled;
  form.urgentEnabled = next.urgentEnabled;
  form.digestFrequency = next.digestFrequency;
  form.includeAmounts = next.includeAmounts;
  consentGiven.value = false;
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    sync(await api.getEmail());
  } catch {
    loadError.value = 'Не удалось загрузить настройки уведомлений. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

function onAmountsChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.checked && !settings.value?.includeAmounts && !consentGiven.value) {
    input.checked = false;
    consentOpen.value = true;
    return;
  }
  form.includeAmounts = input.checked;
}

function confirmConsent() {
  consentGiven.value = true;
  form.includeAmounts = true;
  consentOpen.value = false;
}

function cancelConsent() {
  consentOpen.value = false;
}

async function save() {
  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};
  try {
    sync(
      await api.saveEmail({
        enabled: form.enabled,
        urgentEnabled: form.urgentEnabled,
        digestFrequency: form.digestFrequency,
        includeAmounts: form.includeAmounts,
        ...(consentGiven.value && form.includeAmounts ? { amountsConsent: true } : {}),
      }),
    );
    summary.value = 'Настройки сохранены.';
    summaryTone.value = 'success';
  } catch (error) {
    const mapped = errorMessage(error);
    summary.value = mapped.summary;
    fieldErrors.value = mapped.fields;
    summaryTone.value = 'danger';
  } finally {
    saving.value = false;
  }
}

async function requestVerification() {
  verifying.value = true;
  try {
    await api.requestEmailVerification();
    verificationSent.value = true;
  } catch (error) {
    summary.value = errorMessage(error).summary;
    summaryTone.value = 'danger';
  } finally {
    verifying.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Уведомления на почту</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiStatus v-if="loading" label="Загрузка настроек…" tone="info" aria-live="polite" />
      <UiEmptyState v-else-if="loadError" title="Настройки недоступны" :description="loadError">
        <template #action>
          <UiButton @click="load">Повторить</UiButton>
        </template>
      </UiEmptyState>
      <UiCard v-else-if="settings" as="section" aria-labelledby="email-settings-title">
        <template #header><h2 id="email-settings-title">Почта</h2></template>
        <p class="email-settings__address">{{ settings.email }}</p>
        <div v-if="!settings.emailVerified" class="email-settings__verify">
          <UiStatus
            :label="
              verificationSent
                ? 'Письмо со ссылкой отправлено. Ссылка действует 24 часа.'
                : 'Почта не подтверждена. Пока она не подтверждена, письма не отправляются.'
            "
            tone="info"
            aria-live="polite"
          />
          <UiButton
            variant="secondary"
            size="sm"
            data-action="request-verification"
            :loading="verifying"
            @click="requestVerification"
          >
            {{ verificationSent ? 'Отправить ещё раз' : 'Подтвердить почту' }}
          </UiButton>
        </div>

        <UiStatus v-if="summary" :label="summary" :tone="summaryTone" aria-live="polite" />

        <form class="email-settings__form" @submit.prevent="save">
          <label class="email-settings__checkbox">
            <input
              v-model="form.enabled"
              name="enabled"
              type="checkbox"
              :disabled="!settings.emailVerified && !form.enabled"
            />
            <span>Присылать уведомления на почту</span>
          </label>

          <fieldset v-if="form.enabled" class="email-settings__options">
            <legend class="email-settings__legend">Что присылать</legend>
            <label class="email-settings__checkbox">
              <input v-model="form.urgentEnabled" name="urgentEnabled" type="checkbox" />
              <span>Срочные письма</span>
            </label>
            <p class="email-settings__hint">
              Сразу сообщим о просроченном платеже и напомним о событии календаря.
            </p>

            <UiSelect
              v-model="form.digestFrequency"
              name="digestFrequency"
              label="Дайджест событий семьи"
              hint="В 08:00 по времени бюджета. Если ничего не произошло, письма не будет."
              :options="digestOptions"
              :error="fieldErrors.digestFrequency"
            />

            <label class="email-settings__checkbox">
              <input
                name="includeAmounts"
                type="checkbox"
                :checked="form.includeAmounts"
                :aria-invalid="fieldErrors.includeAmounts ? 'true' : undefined"
                :aria-describedby="fieldErrors.includeAmounts ? 'include-amounts-error' : 'include-amounts-hint'"
                @change="onAmountsChange"
              />
              <span>Показывать суммы в письмах</span>
            </label>
            <p id="include-amounts-hint" class="email-settings__hint">
              Без этого в письмах только имена, названия и даты.
            </p>
            <p v-if="fieldErrors.includeAmounts" id="include-amounts-error" class="field-error">
              {{ fieldErrors.includeAmounts }}
            </p>
          </fieldset>

          <UiButton type="submit" :loading="saving">Сохранить</UiButton>
        </form>

        <UiConfirmDialog
          :open="consentOpen"
          title="Показывать суммы в письмах?"
          :description="`Суммы операций и платежей появятся в письмах на ${settings.email}. Письма хранятся у почтового сервиса, на который HarmoFin не влияет. Согласие можно отозвать, сняв этот пункт.`"
          confirm-label="Согласен"
          cancel-label="Отмена"
          variant="primary"
          @confirm="confirmConsent"
          @cancel="cancelConsent"
        />
      </UiCard>
    </template>
  </ReferencePageLayout>
</template>

<style scoped>
.email-settings__address {
  margin: 0 0 var(--hf-space-3);
  color: var(--hf-color-text);
}

.email-settings__verify {
  display: grid;
  gap: var(--hf-space-3);
  justify-items: start;
  margin-bottom: var(--hf-space-4);
}

.email-settings__form,
.email-settings__options {
  display: grid;
  gap: var(--hf-space-4);
  max-width: 32rem;
  margin-top: var(--hf-space-4);
}

.email-settings__options {
  padding: 0;
  border: 0;
}

.email-settings__legend {
  margin-bottom: var(--hf-space-2);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.email-settings__checkbox {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
  color: var(--hf-color-text);
}

.email-settings__checkbox input {
  width: 1.25rem;
  height: 1.25rem;
}

.email-settings__hint {
  margin: calc(-1 * var(--hf-space-2)) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>
```

Если класс `field-error` в приложении не глобальный — взять разметку ошибки поля из `apps/web/app/components/ui/Input.vue`. Если `UiCard` не принимает слот `header` с `aria-labelledby` — сделать как в `settings/index.vue`.

В `apps/web/app/pages/app/settings/index.vue`, в карточке «Аккаунт», после ссылки «Сессии»:

```vue
          <NuxtLink to="/app/settings/notifications" class="settings-page__row">
            <span>Уведомления на почту</span>
            <span class="settings-page__row-link">Настроить →</span>
          </NuxtLink>
```

В `index.test.ts` добавить проверку, что ссылка «Уведомления на почту» ведёт на `/app/settings/notifications` (по образцу проверок соседних ссылок).

Run: `pnpm --filter @harmofin/web test -- settings`
Expected: PASS.

- [ ] **Step 5: Проверки и индексация**

Run: `pnpm --filter @harmofin/web test && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS (в т. ч. `tokens.test.ts` — только существующие токены).

```bash
git add apps/web/app/composables/useNotificationSettings.ts apps/web/app/composables/useNotificationSettings.test.ts apps/web/app/composables/useApiClient.ts apps/web/app/composables/useApiClient.test.ts apps/web/app/pages/app/settings/notifications.vue apps/web/app/pages/app/settings/notifications.test.ts apps/web/app/pages/app/settings/index.vue apps/web/app/pages/app/settings/index.test.ts
```

Коммит: `feat(web): страница «Уведомления на почту» с подтверждением адреса и согласием на суммы`.

---

### Task 8: Страницы подтверждения почты и отписки

**Files:**
- Create: `apps/web/app/pages/verify-email.vue`, `verify-email.test.ts`, `unsubscribe.vue`, `unsubscribe.test.ts`

**Interfaces:**
- Consumes: `useNotificationSettings().confirmEmailVerification(token)`, `.unsubscribe(token)` (задача 7); `AuthForm` (`title`, `subtitle`, `submitLabel`, `loading`, `summary`, `onSubmit`, слот `footer`) — как на `restore-account.vue`.
- Produces: страницы `/verify-email?token=…` и `/unsubscribe?token=…`. Открытие страницы ничего не меняет; действие — по кнопке. Токен убирается из адресной строки сразу после загрузки.

- [ ] **Step 1: Падающие тесты**

Create `apps/web/app/pages/verify-email.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({
  confirmEmailVerification: vi.fn(),
  route: { query: { token: 'raw-token' } as Record<string, unknown> },
}));
const navigateTo = vi.hoisted(() => vi.fn());
vi.mock('#app', () => ({ useRoute: () => mocks.route, navigateTo }));
vi.mock('../composables/useNotificationSettings.js', () => ({
  useNotificationSettings: () => ({ confirmEmailVerification: mocks.confirmEmailVerification }),
}));

import VerifyEmailPage from './verify-email.vue';

const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  AuthForm: {
    props: ['title', 'subtitle', 'submitLabel', 'onSubmit', 'summary'],
    template:
      '<main><h1>{{ title }}</h1><p role="status">{{ summary }}</p><form @submit.prevent="onSubmit()"><button type="submit">{{ submitLabel }}</button></form><slot name="footer" /></main>',
  },
};

describe('verify email page', () => {
  beforeEach(() => {
    mocks.confirmEmailVerification.mockReset();
    navigateTo.mockReset();
    mocks.route.query = { token: 'raw-token' };
    window.history.replaceState(null, '', '/verify-email?token=raw-token');
  });

  it('removes the token from the address bar and does nothing until the button', () => {
    mount(VerifyEmailPage, { global: { stubs } });
    expect(window.location.search).toBe('');
    expect(mocks.confirmEmailVerification).not.toHaveBeenCalled();
  });

  it('confirms and offers the notification settings', async () => {
    mocks.confirmEmailVerification.mockResolvedValue(undefined);
    const wrapper = mount(VerifyEmailPage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.confirmEmailVerification).toHaveBeenCalledWith('raw-token');
    expect(wrapper.text()).toContain('Почта подтверждена.');
    expect(wrapper.get('button').text()).toBe('Перейти к настройкам');

    await wrapper.get('form').trigger('submit');
    expect(navigateTo).toHaveBeenCalledWith('/app/settings/notifications');
    expect(mocks.confirmEmailVerification).toHaveBeenCalledTimes(1);
  });

  it('shows the server message for an invalid link', async () => {
    mocks.confirmEmailVerification.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'EMAIL_VERIFICATION_TOKEN_INVALID',
        detail: 'Ссылка подтверждения недействительна или устарела. Запросите новую в настройках.',
      }),
    );
    const wrapper = mount(VerifyEmailPage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Запросите новую в настройках');
  });

  it('reports a link without a token without calling the API', async () => {
    mocks.route.query = {};
    const wrapper = mount(VerifyEmailPage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.confirmEmailVerification).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ссылка недействительна или устарела.');
  });
});
```

Create `apps/web/app/pages/unsubscribe.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  route: { query: { token: 'raw-token' } as Record<string, unknown> },
}));
vi.mock('#app', () => ({ useRoute: () => mocks.route }));
vi.mock('../composables/useNotificationSettings.js', () => ({
  useNotificationSettings: () => ({ unsubscribe: mocks.unsubscribe }),
}));

import UnsubscribePage from './unsubscribe.vue';

const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  AuthForm: {
    props: ['title', 'subtitle', 'submitLabel', 'onSubmit', 'summary'],
    template:
      '<main><h1>{{ title }}</h1><p role="status">{{ summary }}</p><form @submit.prevent="onSubmit()"><button type="submit">{{ submitLabel }}</button></form><slot name="footer" /></main>',
  },
};

describe('unsubscribe page', () => {
  beforeEach(() => {
    mocks.unsubscribe.mockReset();
    mocks.route.query = { token: 'raw-token' };
    window.history.replaceState(null, '', '/unsubscribe?token=raw-token');
  });

  it('does not unsubscribe on opening', () => {
    mount(UnsubscribePage, { global: { stubs } });
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('unsubscribes by the button and confirms it', async () => {
    mocks.unsubscribe.mockResolvedValue(undefined);
    const wrapper = mount(UnsubscribePage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.unsubscribe).toHaveBeenCalledWith('raw-token');
    expect(wrapper.text()).toContain('Письма больше не будут приходить.');
    expect(wrapper.text()).toContain('Включить снова можно в настройках');
  });

  it('reports a link without a token', async () => {
    mocks.route.query = {};
    const wrapper = mount(UnsubscribePage, { global: { stubs } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Ссылка недействительна или устарела.');
  });
});
```

Run: `pnpm --filter @harmofin/web test -- verify-email unsubscribe`
Expected: FAIL.

- [ ] **Step 2: Страницы**

Create `apps/web/app/pages/verify-email.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { navigateTo, useRoute } from '#app';

import { errorMessage } from '../composables/useAuth.js';
import { useNotificationSettings } from '../composables/useNotificationSettings.js';

const INVALID_LINK = 'Ссылка недействительна или устарела.';

const route = useRoute();
// Read once: the token is removed from the address bar right after mount.
const token = typeof route.query.token === 'string' ? route.query.token : '';
const loading = ref(false);
const summary = ref('');
const confirmed = ref(false);
const { confirmEmailVerification } = useNotificationSettings();

onMounted(() => {
  window.history.replaceState(window.history.state, '', window.location.pathname);
});

async function submit() {
  if (confirmed.value) {
    await navigateTo('/app/settings/notifications');
    return;
  }
  summary.value = '';
  if (!token) {
    summary.value = INVALID_LINK;
    return;
  }
  loading.value = true;
  try {
    await confirmEmailVerification(token);
    confirmed.value = true;
    summary.value = 'Почта подтверждена. Теперь можно включить уведомления на почту.';
  } catch (error) {
    summary.value = errorMessage(error).summary || INVALID_LINK;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthForm
    title="Подтверждение почты"
    subtitle="Подтвердите, что это ваш адрес: на него будут приходить уведомления HarmoFin."
    :submit-label="confirmed ? 'Перейти к настройкам' : 'Подтвердить'"
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

Create `apps/web/app/pages/unsubscribe.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from '#app';

import { errorMessage } from '../composables/useAuth.js';
import { useNotificationSettings } from '../composables/useNotificationSettings.js';

const INVALID_LINK = 'Ссылка недействительна или устарела.';

const route = useRoute();
// Opening the page changes nothing (mail scanners follow links); the button does.
const token = typeof route.query.token === 'string' ? route.query.token : '';
const loading = ref(false);
const summary = ref('');
const done = ref(false);
const { unsubscribe } = useNotificationSettings();

onMounted(() => {
  window.history.replaceState(window.history.state, '', window.location.pathname);
});

async function submit() {
  if (done.value) return;
  summary.value = '';
  if (!token) {
    summary.value = INVALID_LINK;
    return;
  }
  loading.value = true;
  try {
    await unsubscribe(token);
    done.value = true;
    summary.value =
      'Готово. Письма больше не будут приходить. Включить снова можно в настройках уведомлений.';
  } catch (error) {
    summary.value = errorMessage(error).summary || INVALID_LINK;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthForm
    title="Отписаться от писем"
    subtitle="HarmoFin перестанет присылать уведомления на эту почту. Уведомления в приложении останутся."
    :submit-label="done ? 'Готово' : 'Отписаться'"
    :loading="loading"
    :summary="summary"
    :on-submit="submit"
  >
    <template #footer>
      <p class="form-links">
        <NuxtLink to="/app/settings/notifications">Настройки уведомлений</NuxtLink>
      </p>
    </template>
  </AuthForm>
</template>
```

Проверить, что глобальный middleware не уводит неавторизованного с `/verify-email` и `/unsubscribe` на `/login` (как не уводит с `/restore-account`): `grep -rn "restore-account" apps/web/app/middleware apps/web/app/plugins`. Если там список публичных путей — дописать оба.

Run: `pnpm --filter @harmofin/web test -- verify-email unsubscribe`
Expected: PASS.

- [ ] **Step 3: Проверки и индексация**

Run: `pnpm --filter @harmofin/web test && pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: PASS.

```bash
git add apps/web/app/pages/verify-email.vue apps/web/app/pages/verify-email.test.ts apps/web/app/pages/unsubscribe.vue apps/web/app/pages/unsubscribe.test.ts
```

(плюс файл middleware, если его пришлось менять).

Коммит: `feat(web): страницы подтверждения почты и отписки по ссылке`.

---

### Task 9: E2E и документация

**Files:**
- Create: `e2e/email-notifications.spec.ts`
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`

**Interfaces:**
- Consumes: всё из задач 2, 3, 7, 8; `mailpitOrigin` из `e2e/env.ts`; регистрация — как в `e2e/settings.spec.ts` (`registerAndReachApp`).

- [ ] **Step 1: E2E-сценарий**

Create `e2e/email-notifications.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

import { mailpitOrigin } from './env';

const password = 'e2e-password-10';

async function register(page: Page): Promise<string> {
  const email = `e2e-mail-${Date.now()}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

test('confirms the address from a Mailpit letter and enables email notifications', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = await register(page);

  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Уведомления на почту' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/notifications$/);
  await expect(page.getByLabel('Присылать уведомления на почту')).toBeDisabled();

  await page.getByRole('button', { name: 'Подтвердить почту' }).click();
  await expect(page.getByText('Ссылка действует 24 часа.')).toBeVisible();

  let verifyPath = '';
  await expect
    .poll(async () => {
      const messages = await request
        .get(`${mailpitOrigin}/api/v1/messages`)
        .then((response) => response.json());
      const message = messages.messages.find(
        (item: { To: Array<{ Address: string }>; Subject: string }) =>
          item.Subject === 'Подтвердите почту в HarmoFin' &&
          item.To.some((recipient) => recipient.Address === email),
      ) as { Snippet: string } | undefined;
      verifyPath = message?.Snippet.match(/(\/verify-email\?token=[^\s]+)/)?.[1] ?? '';
      return verifyPath;
    })
    .not.toBe('');

  await page.goto(verifyPath);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Почта подтверждена.')).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к настройкам' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/notifications$/);

  await page.getByLabel('Присылать уведомления на почту').check();
  await page.getByLabel('Дайджест событий семьи').selectOption('WEEKLY');
  await page.getByLabel('Показывать суммы в письмах').check();
  await expect(page.getByRole('dialog', { name: 'Показывать суммы в письмах?' })).toBeVisible();
  await page.getByRole('button', { name: 'Согласен' }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Присылать уведомления на почту')).toBeChecked();
  await expect(page.getByLabel('Показывать суммы в письмах')).toBeChecked();
});

test('the unsubscribe page changes nothing until the button is pressed', async ({ page }) => {
  await page.goto('/unsubscribe?token=unknown-token');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await expect(page).toHaveURL(/\/unsubscribe$/);
  await page.getByRole('button', { name: 'Отписаться' }).click();
  await expect(page.getByText('Письма больше не будут приходить.')).toBeVisible();
});
```

`UiSelect` может быть не нативным `<select>`: если `selectOption` не работает, выбрать вариант так же, как в `e2e/settings.spec.ts` выбирают часовой пояс. Если `role="dialog"` у `UiConfirmDialog` не получает имя по заголовку — искать `page.getByRole('dialog')` и проверять текст.

Локально Playwright не запускать. Проверить, что спек компилируется:

Run: `pnpm exec tsc --noEmit -p e2e` (если в `e2e` нет `tsconfig.json` — `pnpm lint`)
Expected: PASS. Сам сценарий проходит в CI (`pnpm test:e2e`, сервис Mailpit в `ci.yml`).

- [ ] **Step 2: Документация**

`docs/superpowers/specs/2026-08-30-family-budget-app-spec.md`, раздел 18.6, строка про email-дайджест: заменить «— перенесён в объём 31.10.2026» на «— реализован (подтверждение почты, срочные письма, дайджест, отписка)», ссылку на дизайн оставить.

`CLAUDE.md`, абзац о исключениях v1: фразу `Telegram or external notification delivery` заменить на `Telegram, web push and other external notification delivery (email notifications are implemented: see the [email notifications design](docs/superpowers/specs/2026-10-31-email-notifications-design.md))`. В абзаце «The functional domain is implemented: …» после `notifications,` дописать `email notifications with on-demand address confirmation,`.

Политика обработки ПД: найти текст политики (`grep -rn "Цели обработки" apps/web/app apps/api/src/legal`) и проверить, есть ли цель «уведомления на почту» и передача сумм в письмах при согласии. Текст юридического документа writer не меняет: если цели нет, координатор сообщает владельцу до открытия PR 3 (смена версии документа требует нового согласия пользователей, см. [юридический дизайн](../specs/2026-10-18-legal-documents-design.md)).

- [ ] **Step 3: Проверки и индексация**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: PASS.

```bash
git add e2e/email-notifications.spec.ts CLAUDE.md docs/superpowers/specs/2026-08-30-family-budget-app-spec.md
```

Коммит: `test(e2e): подтверждение почты и настройки уведомлений; docs: статус email-уведомлений`.

После задачи 9 — конец PR 3: координатор спрашивает владельца об открытии PR. E2E проходит только в CI.

---

## Review по задачам

| Задача | Обязательные review |
|---|---|
| 1. Схема и миграция | backend (миграция, индексы, FK), security (изоляция, удаление аккаунта), QA, final |
| 2. Подтверждение почты | security (токены, rate limit, аудит без адреса), API (OpenAPI, коды), QA, final |
| 3. Настройки и отписка | security (публичная отписка, согласие на суммы, аудит), API, QA, final |
| 4. Конфиг, отправитель, шаблоны | security (секреты SMTP, экранирование HTML, нет сумм без согласия), release (compose), QA, final |
| 5. Очередь и отправка | backend (SKIP LOCKED, повторы), security (перепроверка прав, логи без содержимого), QA, final |
| 6. Постановка срочных и дайджестов | backend (расписание, часовой пояс, дубли), security (изоляция бюджета в дайджесте), QA, final |
| 7. Страница настроек | UI/UX (Calm Fintech, доступность, диалог согласия), QA, final |
| 8. Страницы подтверждения и отписки | UI/UX, security (токен не остаётся в адресе, нет действия при открытии), QA, final |
| 9. E2E и документация | QA, final |

Financial review не нужен: финансовые данные не меняются, суммы только читаются и форматируются из minor units.

## Ход выполнения

| Задача | Коммит | Review | Решения |
|---|---|---|---|
| 1. Схема и миграция | 7edd96f | security/QA/final APPROVE; backend BLOCK (FK notification_id без бюджета) — принят как в плане, DB-hardening вынесен владельцу в отчёт | integration 69f/720t PASS, worker 86/86, typecheck PASS; имена 2 индексов — Prisma-truncation (план 424 разрешает); фикстура budget-reset дополнена delivery; задачи 5/6 пишут delivery только в той же транзакции, что notification (одинаковый бюджет), тест плана это покрывает |
| 2. Подтверждение почты | 8cb734a + fe5b3e3 (fix по QA) | security/API/final APPROVE; QA BLOCK (слабые assertions) → исправлен, re-check APPROVE | API-сьют 377 passed, интеграция email-verification 7 passed, typecheck PASS; OpenAPI пересобран (2 пути, minLength); DTO +type/minLength (иначе генерация падает); afterAll-чистка auth-аудита (паттерн auth.integration.test.ts) |
| 3. Настройки и отписка | 5ea401c | security/API/QA/final APPROVE все | units 8 passed, интеграция settings 7 passed, полная integration 71f/734t (71 files/734 tests) PASS, typecheck/lint PASS; OpenAPI пересобран (2 новых пути); DTO +явный type (требование генератора); family-app cleanup account-аудита (необходимо, RESTRICT FK) |
| 4. Worker SMTP/шаблоны | 3caa5cd | security/release/QA/final APPROVE все | worker config 9, format 10, templates 5 passed; полный worker 16f/104t PASS; root typecheck/lint PASS; секреты только env, экранирование HTML в шаблонах. Non-blocker от security: (а) absolute() в templates.ts не проверяет origin — фикс в задаче 5; (б) mailer без requireTLS = то же задокументированное ограничение, что у API (runbook bootstrap:114), план verbatim — вопрос владельцу в отчёт |
| 5. Очередь доставки | bd7ce1e | backend/security/QA/final APPROVE все; два отступления writer приняты (plan-баг hooks optional-call; retryDelayMs clamp — эквивалентно) | worker 128/128 PASS, интеграция email-delivery 7/7 PASS, typecheck/lint PASS; SKIP LOCKED claim, условные переходы статусов, eligibility-перепроверка перед send, токен 32б SHA-256; доп. фикс absolute() origin-check с тестами — в коммите; known: at-least-once окно (план) |
| 6. Постановка в очередь | f7fbf63 + 37b47f3 + 6939fb8 (test-fix QA-замечаний) | backend/security/QA/final APPROVE; QA BLOCK (дубли cleanup) снят re-check | digest интеграция 6/6, worker 139/139, полная integration 72f/747t PASS; enqueue в транзакции уведомления, дедуп @@unique, DST-тесты дайджеста; helper family-app чистит calendar events (инлайн-обходы удалены); writer не коммитил (оставил staged) — коммит собрал оркестратор |
| 7. Web настройки | 593b1b7 | QA/final APPROVE; UI/UX ESCALATE: текст success/danger в общем Status.vue #22a06b/#d14343 = контраст 2.9–3.9:1 (гайдлайн требует text-success/text-danger) — фикс меняет статусы всего приложения, решение владельца в отчёт; сам коммит чист | web 209f/1737t PASS (TDD), typecheck/lint PASS; CSRF-исключения с тестами; отступления приняты (UiSelect cast по паттерну CalendarEventForm, scoped field-error разрешён планом 4637) |
| 8. Web confirm/unsubscribe | cb234bd (prettier ветки) + 640b532 + f118518 (fix UI/UX BLOCK тон успеха) | security/final APPROVE; UI/UX BLOCK (успех в danger-стилях AuthForm) → исправлено summaryTone (default error — существующие страницы не затронуты), re-check APPROVE; QA ESCALATE (доказательство format-only cb234bd) → diff проверен оркестратором (чистый перенос строк), re-check APPROVE | web 1744/1744 PASS (TDD 7 сценариев страниц), typecheck/lint PASS; format:check красный только pre-existing manifest.webmanifest (owner-debt .gitattributes eol, CI-Linear зелёный); токен: POST body, replaceState из URL, не логируется/DOM/storage; open-redirect нет; non-blocker: restore-account остался danger-уроком успеха (owner backlog) |
| 9. E2E и документация | c40ebb5 + af0dc5d (fix QA/final BLOCK: check→click на consent-guard чекбоксе, getByLabel→getByRole('combobox') для UiSelect) | QA/final APPROVE после fix; отступления приняты (UiSelect click+option — план 5062; Mailpit токен из /api/v1/message/\${ID} — паттерн account-deletion.spec.ts); эскалация владельцу: PdConsentText.vue не содержит цели «уведомления на почту»/суммы в письмах — смена текста требует новой версии согласия, решить до PR | Playwright не запускался (запрет владельца; прогон = CI с Mailpit-сервисом); prettier spec PASS, tsc --noEmit 0; селекторы сверены с компонентами обоими ревьюерами |
