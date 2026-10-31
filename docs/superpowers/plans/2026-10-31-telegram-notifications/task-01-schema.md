# Задача 1: схема и миграция

Перед началом: прочитать [README](README.md) (правила, Global Constraints). Ветка `feat/telegram-notifications`.

**Files:**
- Modify: `prisma/schema.prisma` — значение `TELEGRAM` в `NotificationChannel`, модели `TelegramLink`, `TelegramLinkCode`, обратные связи в `User`.
- Create: `prisma/migrations/20261102000000_telegram_notifications/migration.sql`
- Modify: `apps/worker/src/account-purge.ts` — новые таблицы в удалении аккаунта.
- Modify: `apps/api/test/helpers/family-app.ts` — очистка новых строк после тестов.
- Create: `apps/api/test/telegram-schema.integration.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces (используют задачи 3–6):
  - Prisma-модель `telegramLink`: `id: string`, `userId: string` (unique), `chatId: bigint` (unique), `consentedAt: Date`, `linkedAt: Date`, `createdAt`, `updatedAt`.
  - Prisma-модель `telegramLinkCode`: `id`, `userId`, `codeHash: string` (unique, 64 hex), `consentedAt: Date`, `expiresAt: Date`, `consumedAt: Date | null`, `createdAt`.
  - Enum `NotificationChannel` = `'EMAIL' | 'TELEGRAM'`.
  - Связи `User.telegramLink` (одна или null) и `User.telegramLinkCodes`.

---

- [ ] **Step 1: Изменить enum в `prisma/schema.prisma`**

Найти:

```prisma
enum NotificationChannel {
  EMAIL
}
```

Заменить на:

```prisma
enum NotificationChannel {
  EMAIL
  TELEGRAM
}
```

- [ ] **Step 2: Добавить обратные связи в `model User`**

В `model User` после строки `emailVerificationTokens     EmailVerificationToken[]` добавить две строки (выравнивание поправит `prisma format`):

```prisma
  telegramLink                TelegramLink?
  telegramLinkCodes           TelegramLinkCode[]
```

- [ ] **Step 3: Добавить модели после `model EmailVerificationToken { ... }`**

```prisma
model TelegramLink {
  id          String   @id @db.Uuid
  userId      String   @unique @map("user_id") @db.Uuid
  chatId      BigInt   @unique @map("chat_id")
  consentedAt DateTime @map("consented_at") @db.Timestamptz(3)
  linkedAt    DateTime @map("linked_at") @db.Timestamptz(3)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@map("telegram_links")
}

model TelegramLinkCode {
  id          String    @id @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  codeHash    String    @unique @map("code_hash") @db.Char(64)
  consentedAt DateTime  @map("consented_at") @db.Timestamptz(3)
  expiresAt   DateTime  @map("expires_at") @db.Timestamptz(3)
  consumedAt  DateTime? @map("consumed_at") @db.Timestamptz(3)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([userId, consumedAt, expiresAt])
  @@map("telegram_link_codes")
}
```

- [ ] **Step 4: Отформатировать схему и сгенерировать клиент**

Run: `pnpm --filter @harmofin/api exec prisma format --schema ../../prisma/schema.prisma`
Run: `pnpm db:generate`
Expected: оба без ошибок. При EPERM — см. Global Constraints (не трогать процессы, сообщить владельцу).

- [ ] **Step 5: Создать миграцию**

Файл `prisma/migrations/20261102000000_telegram_notifications/migration.sql`:

```sql
-- Telegram notifications: per-user private chat link and one-time link codes.
-- Additive: one enum value, two new tables; no backfill.

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'TELEGRAM';

-- CreateTable
CREATE TABLE "telegram_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "linked_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_link_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_user_id_key" ON "telegram_links"("user_id");
CREATE UNIQUE INDEX "telegram_links_chat_id_key" ON "telegram_links"("chat_id");
CREATE UNIQUE INDEX "telegram_link_codes_code_hash_key" ON "telegram_link_codes"("code_hash");
CREATE INDEX "telegram_link_codes_user_id_consumed_at_expires_at_idx" ON "telegram_link_codes"("user_id", "consumed_at", "expires_at");

-- AddForeignKey
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 6: Удаление аккаунта**

В `apps/worker/src/account-purge.ts` в массиве `USER_OWNED_TABLES` после `'notification_deliveries',` добавить:

```ts
  'telegram_links',
  'telegram_link_codes',
```

Там же, после строки

```ts
  await tx.$executeRaw`DELETE FROM "email_verification_tokens" WHERE "user_id" = ${userId}::uuid`;
```

добавить:

```ts
  await tx.$executeRaw`DELETE FROM "telegram_links" WHERE "user_id" = ${userId}::uuid`;
  await tx.$executeRaw`DELETE FROM "telegram_link_codes" WHERE "user_id" = ${userId}::uuid`;
```

- [ ] **Step 7: Очистка в тестовом помощнике**

В `apps/api/test/helpers/family-app.ts` после строки

```ts
      await this.prisma.emailVerificationToken.deleteMany({ where: { userId } });
```

добавить:

```ts
      await this.prisma.telegramLink.deleteMany({ where: { userId } });
      await this.prisma.telegramLinkCode.deleteMany({ where: { userId } });
```

- [ ] **Step 8: Тест схемы**

Файл `apps/api/test/telegram-schema.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let anna: FamilyActor;
let boris: FamilyActor;

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  boris = await env.register();
});

afterAll(async () => {
  await env.stop();
});

const chatId = () => BigInt(Math.floor(Math.random() * 1_000_000_000_000));

function link(userId: string, chat: bigint) {
  const now = new Date();
  return { id: randomUUID(), userId, chatId: chat, consentedAt: now, linkedAt: now };
}

describe('telegram_links', () => {
  it('keeps one chat per user and one user per chat', async () => {
    const chat = chatId();
    await env.prisma.telegramLink.create({ data: link(anna.user.id, chat) });
    await expect(
      env.prisma.telegramLink.create({ data: link(anna.user.id, chatId()) }),
    ).rejects.toThrow();
    await expect(env.prisma.telegramLink.create({ data: link(boris.user.id, chat) })).rejects.toThrow();
  });

  it('stores chat ids beyond 32 bits', async () => {
    const big = 9_007_199_254_740_000n;
    await env.prisma.telegramLink.create({ data: link(boris.user.id, big) });
    const row = await env.prisma.telegramLink.findUniqueOrThrow({ where: { userId: boris.user.id } });
    expect(row.chatId).toBe(big);
  });
});

describe('telegram_link_codes', () => {
  it('rejects a duplicate code hash', async () => {
    const codeHash = 'a'.repeat(64);
    const data = {
      userId: anna.user.id,
      codeHash,
      consentedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
    };
    await env.prisma.telegramLinkCode.create({ data: { id: randomUUID(), ...data } });
    await expect(
      env.prisma.telegramLinkCode.create({ data: { id: randomUUID(), ...data } }),
    ).rejects.toThrow();
  });
});

describe('notification channel TELEGRAM', () => {
  it('is accepted by settings and the delivery queue', async () => {
    await env.prisma.notificationChannelSetting.create({
      data: { id: randomUUID(), userId: anna.user.id, channel: 'TELEGRAM' },
    });
    await env.prisma.notificationDelivery.create({
      data: {
        id: randomUUID(),
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        userId: anna.user.id,
        channel: 'TELEGRAM',
        kind: 'DIGEST',
        dedupeKey: `digest:DAILY:${randomUUID()}`,
        nextAttemptAt: new Date(),
      },
    });
    const count = await env.prisma.notificationDelivery.count({
      where: { userId: anna.user.id, channel: 'TELEGRAM' },
    });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 9: Прогнать проверки**

Run: `pnpm test:integration`
Expected: PASS, включая `telegram-schema.integration.test.ts` (4 теста). Миграция применилась к `harmofin_v22_test`.

Run: `pnpm --filter @harmofin/worker test`
Expected: PASS, включая `account-purge.coverage.test.ts`.

Run: `pnpm --filter @harmofin/api exec prisma migrate diff --from-url 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' --to-schema-datamodel ../../prisma/schema.prisma --script`
Expected: пустой скрипт (`-- This is an empty migration.`) или только расхождения, которые были и до этой задачи. Если в выводе есть `telegram` — миграция не совпадает со схемой, исправить SQL.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Review по чек-листу**

`git add prisma/schema.prisma prisma/migrations/20261102000000_telegram_notifications apps/worker/src/account-purge.ts apps/api/test/helpers/family-app.ts apps/api/test/telegram-schema.integration.test.ts` и `git diff --staged`:

- backend: миграция только добавляет (нет `DROP`, `ALTER COLUMN`, `UPDATE`); имена индексов совпадают с Prisma; `chat_id` — `BIGINT`.
- security: в таблицах нет username, имени, текста; код хранится только хешем (`CHAR(64)`); новые таблицы удаляются при удалении аккаунта.
- QA: тесты проверяют обе уникальности, `BIGINT` больше 32 бит и новое значение enum в обеих таблицах.
- final: в diff нет посторонних файлов, `identity/logo_description.png` не тронут.

- [ ] **Step 11: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): схема привязки чата и канал TELEGRAM"
```

Добавить строку в «Ход выполнения» README и закоммитить её вместе со следующей задачей (или отдельным `docs(telegram): ход выполнения`).
