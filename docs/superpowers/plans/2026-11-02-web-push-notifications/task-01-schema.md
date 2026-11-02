# Задача 1: схема и миграция

Перед началом: прочитать [README](README.md) (правила, Global Constraints). Ветка `feat/web-push`.

**Files:**
- Modify: `prisma/schema.prisma` — значение `PUSH` в `NotificationChannel`, две колонки в `NotificationChannelSetting`, модель `PushSubscription`, обратные связи в `User` и `Session`.
- Create: `prisma/migrations/20261103000000_web_push_notifications/migration.sql`
- Modify: `apps/worker/src/account-purge.ts` — новая таблица в удалении аккаунта.
- Modify: `apps/api/test/helpers/family-app.ts` — очистка новых строк после тестов.
- Create: `apps/api/test/push-schema.integration.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces (используют задачи 3–5):
  - Prisma-модель `pushSubscription`: `id: string`, `userId: string`, `sessionId: string`, `endpoint: string` (unique), `p256dh: string`, `auth: string`, `applicationServerKey: string`, `label: string`, `lastSuccessAt: Date | null`, `createdAt`, `updatedAt`; связи `user`, `session`.
  - `notificationChannelSetting.planOverdueEnabled: boolean` и `calendarReminderEnabled: boolean` (по умолчанию `true`).
  - Enum `NotificationChannel` = `'EMAIL' | 'TELEGRAM' | 'PUSH'`.
  - Связи `User.pushSubscriptions` и `Session.pushSubscriptions`.

---

- [ ] **Step 1: Изменить enum в `prisma/schema.prisma`**

Найти:

```prisma
enum NotificationChannel {
  EMAIL
  TELEGRAM
}
```

Заменить на:

```prisma
enum NotificationChannel {
  EMAIL
  TELEGRAM
  PUSH
}
```

- [ ] **Step 2: Колонки флажков в `model NotificationChannelSetting`**

В `model NotificationChannelSetting` после строки

```prisma
  amountsConsentAt DateTime?           @map("amounts_consent_at") @db.Timestamptz(3)
```

добавить (выравнивание поправит `prisma format` в шаге 6):

```prisma
  planOverdueEnabled      Boolean     @default(true) @map("plan_overdue_enabled")
  calendarReminderEnabled Boolean     @default(true) @map("calendar_reminder_enabled")
```

- [ ] **Step 3: Обратные связи в `model User` и `model Session`**

В `model User` после строки `telegramLinkCodes           TelegramLinkCode[]` добавить:

```prisma
  pushSubscriptions           PushSubscription[]
```

В `model Session` после строки

```prisma
  user User @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
```

добавить:

```prisma
  pushSubscriptions PushSubscription[]
```

- [ ] **Step 4: Модель после `model TelegramLinkCode { ... }`**

```prisma
// One browser or installed PWA of a user. Lives only while its session is active.
model PushSubscription {
  id                   String    @id @db.Uuid
  userId               String    @map("user_id") @db.Uuid
  sessionId            String    @map("session_id") @db.Uuid
  endpoint             String    @unique @db.VarChar(2048)
  p256dh               String    @db.VarChar(128)
  auth                 String    @db.VarChar(64)
  applicationServerKey String    @map("application_server_key") @db.VarChar(128)
  label                String    @db.VarChar(80)
  lastSuccessAt        DateTime? @map("last_success_at") @db.Timestamptz(3)
  createdAt            DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt            DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  user    User    @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([userId])
  @@index([sessionId])
  @@map("push_subscriptions")
}
```

- [ ] **Step 5: Миграция**

Файл `prisma/migrations/20261103000000_web_push_notifications/migration.sql`:

```sql
-- Web push notifications: per-device subscriptions bound to a session, and per-type switches.
-- Additive: one enum value, two columns with defaults, one new table; no backfill.

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'PUSH';

-- AlterTable
ALTER TABLE "notification_channel_settings"
    ADD COLUMN "plan_overdue_enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "calendar_reminder_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "endpoint" VARCHAR(2048) NOT NULL,
    "p256dh" VARCHAR(128) NOT NULL,
    "auth" VARCHAR(64) NOT NULL,
    "application_server_key" VARCHAR(128) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "last_success_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");
CREATE INDEX "push_subscriptions_session_id_idx" ON "push_subscriptions"("session_id");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 6: Форматирование схемы и клиент Prisma**

Run: `pnpm --filter @harmofin/api exec prisma format --schema ../../prisma/schema.prisma`
Expected: `Formatted ... schema.prisma`.

Run: `pnpm db:generate`
Expected: `Generated Prisma Client`. При EPERM — см. Global Constraints.

- [ ] **Step 7: Удаление аккаунта**

В `apps/worker/src/account-purge.ts` в массиве `USER_OWNED_TABLES` после `'telegram_link_codes',` добавить:

```ts
  'push_subscriptions',
```

Там же найти строку

```ts
  await tx.$executeRaw`DELETE FROM "sessions" WHERE "user_id" = ${userId}::uuid`;
```

и **перед** ней добавить:

```ts
  // Push devices die with the sessions anyway (FK cascade); deleted first to keep the order explicit.
  await tx.$executeRaw`DELETE FROM "push_subscriptions" WHERE "user_id" = ${userId}::uuid`;
```

- [ ] **Step 8: Очистка в тестовом помощнике**

В `apps/api/test/helpers/family-app.ts` после строки

```ts
      await this.prisma.telegramLinkCode.deleteMany({ where: { userId } });
```

добавить:

```ts
      await this.prisma.pushSubscription.deleteMany({ where: { userId } });
```

- [ ] **Step 9: Тест схемы**

Файл `apps/api/test/push-schema.integration.test.ts`:

```ts
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let anna: FamilyActor;

beforeAll(async () => {
  await env.start();
  anna = await env.register();
});

afterAll(async () => {
  await env.stop();
});

async function extraSession(userId: string): Promise<string> {
  const id = randomUUID();
  const future = new Date(Date.now() + 86_400_000);
  await env.prisma.session.create({
    data: {
      id,
      userId,
      tokenHash: randomBytes(32).toString('hex'),
      csrfTokenHash: randomBytes(32).toString('hex'),
      idleExpiresAt: future,
      absoluteExpiresAt: future,
    },
  });
  return id;
}

function subscription(userId: string, sessionId: string, endpoint: string) {
  return {
    id: randomUUID(),
    userId,
    sessionId,
    endpoint,
    p256dh: 'p'.repeat(87),
    auth: 'a'.repeat(22),
    applicationServerKey: 'k'.repeat(87),
    label: 'Chrome, Android',
  };
}

describe('push_subscriptions', () => {
  it('rejects a duplicate endpoint', async () => {
    const sessionId = await extraSession(anna.user.id);
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    await env.prisma.pushSubscription.create({
      data: subscription(anna.user.id, sessionId, endpoint),
    });
    await expect(
      env.prisma.pushSubscription.create({ data: subscription(anna.user.id, sessionId, endpoint) }),
    ).rejects.toThrow();
  });

  it('is deleted together with its session', async () => {
    const sessionId = await extraSession(anna.user.id);
    const row = subscription(anna.user.id, sessionId, `https://fcm.googleapis.com/${randomUUID()}`);
    await env.prisma.pushSubscription.create({ data: row });
    await env.prisma.session.delete({ where: { id: sessionId } });
    expect(await env.prisma.pushSubscription.findUnique({ where: { id: row.id } })).toBeNull();
  });
});

describe('notification channel PUSH', () => {
  it('stores settings with both type switches on by default', async () => {
    const saved = await env.prisma.notificationChannelSetting.create({
      data: { id: randomUUID(), userId: anna.user.id, channel: 'PUSH', digestFrequency: 'OFF' },
    });
    expect(saved.planOverdueEnabled).toBe(true);
    expect(saved.calendarReminderEnabled).toBe(true);
    expect(saved.enabled).toBe(false);
  });

  it('is accepted by the delivery queue', async () => {
    await env.prisma.notificationDelivery.create({
      data: {
        id: randomUUID(),
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        userId: anna.user.id,
        channel: 'PUSH',
        kind: 'URGENT',
        dedupeKey: `urgent:${randomUUID()}`,
        nextAttemptAt: new Date(),
      },
    });
    const count = await env.prisma.notificationDelivery.count({
      where: { userId: anna.user.id, channel: 'PUSH' },
    });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 10: Прогнать проверки**

Run: `pnpm test:integration`
Expected: PASS, включая `push-schema.integration.test.ts` (4 теста). Миграция применилась к `harmofin_v22_test`.

Run: `pnpm --filter @harmofin/worker test`
Expected: PASS, включая `account-purge.coverage.test.ts`.

Run: `pnpm --filter @harmofin/api exec prisma migrate diff --from-url 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' --to-schema-datamodel ../../prisma/schema.prisma --script`
Expected: пустой скрипт (`-- This is an empty migration.`) или только расхождения, которые были и до этой задачи. Если в выводе есть `push` или `plan_overdue`, миграция не совпадает со схемой — исправить SQL.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 11: Review по чек-листу**

Добавить файлы в индекс и посмотреть `git diff --staged`:

```bash
git add prisma/schema.prisma prisma/migrations/20261103000000_web_push_notifications apps/worker/src/account-purge.ts apps/api/test/helpers/family-app.ts apps/api/test/push-schema.integration.test.ts
```

Чек-лист:

- backend: миграция только добавляет (нет `DROP`, `ALTER COLUMN ... TYPE`, `UPDATE`); у новых колонок `DEFAULT true`; имена индексов совпадают с Prisma; FK сессии — `CASCADE`, FK пользователя — `RESTRICT`.
- security: в таблице нет полного `User-Agent`; подписки удаляются при удалении аккаунта.
- QA: тесты проверяют уникальность endpoint, каскад от сессии, значения по умолчанию флажков и новое значение enum в очереди.
- final: в diff нет посторонних файлов; `identity/logo_description.png` не тронут.

- [ ] **Step 12: Commit**

```bash
git branch --show-current
git commit -m "feat(push): схема подписок устройств и канал PUSH"
```

Добавить строку в «Ход выполнения» README и закоммитить её вместе со следующей задачей (или отдельным коммитом `docs(push): ход выполнения`).
