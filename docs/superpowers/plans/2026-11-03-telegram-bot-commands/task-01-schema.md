# Задача 1: схема и миграция

Перед началом прочитать [README](README.md): правила и Global Constraints. Ветка — `feat/telegram-bot-commands`.

**Files:**
- Modify: `prisma/schema.prisma` — колонки команд в `TelegramLink`, модель `TelegramDialog`.
- Create: `prisma/migrations/20261104000000_telegram_bot_commands/migration.sql`
- Modify: `apps/worker/src/account-purge.ts` — новая таблица в удалении аккаунта.
- Modify: `apps/worker/src/telegram/link-codes.ts` — `purgeStaleDialogs`.
- Modify: `apps/worker/src/delivery/build-digests.handler.ts` — вызов очистки.
- Create: `apps/api/test/telegram-dialogs-schema.integration.test.ts`

**Interfaces:**
- Consumes: существующая модель `TelegramLink` (`id`, `userId` unique, `chatId: bigint` unique, `consentedAt`, `linkedAt`).
- Produces (используют задачи 3, 5, 6):
  - `telegramLink.commandsEnabledAt: Date | null`, `telegramLink.commandsConsentAt: Date | null`;
  - Prisma-модель `telegramDialog`:
    - `id: string` — UUIDv7;
    - `chatId: bigint` — unique, FK на `telegram_links.chat_id` с `on delete cascade`;
    - `userId: string`, `budgetId: string`;
    - `kind: string` — `EXPENSE`, `INCOME`, `TRANSFER` или `EVENT`;
    - `step: string`;
    - `version: number` — по умолчанию 1;
    - `data: Prisma.JsonValue` — по умолчанию `{}`;
    - `messageId: number | null`;
    - `expiresAt: Date`;
    - `createdAt`, `updatedAt`;
  - `purgeStaleDialogs(prisma: PrismaClient, now: Date): Promise<void>` из `apps/worker/src/telegram/link-codes.ts`.

---

- [ ] **Step 1: Поля и связь в `model TelegramLink`**

В `prisma/schema.prisma` найти:

```prisma
  linkedAt    DateTime @map("linked_at") @db.Timestamptz(3)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@map("telegram_links")
}
```

Заменить на:

```prisma
  linkedAt    DateTime @map("linked_at") @db.Timestamptz(3)
  commandsEnabledAt DateTime? @map("commands_enabled_at") @db.Timestamptz(3)
  commandsConsentAt DateTime? @map("commands_consent_at") @db.Timestamptz(3)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  user   User            @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  dialog TelegramDialog?

  @@map("telegram_links")
}

model TelegramDialog {
  id        String   @id @db.Uuid
  chatId    BigInt   @unique @map("chat_id")
  userId    String   @map("user_id") @db.Uuid
  budgetId  String   @map("budget_id") @db.Uuid
  kind      String   @db.VarChar(16)
  step      String   @db.VarChar(32)
  version   Int      @default(1)
  data      Json     @default("{}")
  messageId Int?     @map("message_id")
  expiresAt DateTime @map("expires_at") @db.Timestamptz(3)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  link TelegramLink @relation(fields: [chatId], references: [chatId], onDelete: Cascade, onUpdate: Cascade)

  @@index([expiresAt])
  @@map("telegram_dialogs")
}
```

У `TelegramDialog` нет Prisma-связи с `User` и `Budget`, только колонки. Строка исчезает вместе с привязкой (cascade), удалением аккаунта (шаг 6) и очисткой в воркере (шаг 7).

- [ ] **Step 2: Отформатировать схему и сгенерировать клиент**

Run: `pnpm --filter @harmofin/api exec prisma format --schema ../../prisma/schema.prisma`
Run: `pnpm db:generate`
Expected: обе команды проходят без ошибок. Prettier схемы выровняет колонки `TelegramLink`. При EPERM действовать по Global Constraints.

- [ ] **Step 3: Создать миграцию**

Файл `prisma/migrations/20261104000000_telegram_bot_commands/migration.sql`:

```sql
-- Telegram bot commands: per-chat switch with consent and the state of one step-by-step dialog.
-- Additive: two nullable columns, one new table; no backfill.

-- AlterTable
ALTER TABLE "telegram_links" ADD COLUMN "commands_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN "commands_consent_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "telegram_dialogs" (
    "id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "user_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "step" VARCHAR(32) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL DEFAULT '{}',
    "message_id" INTEGER,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "telegram_dialogs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_dialogs_chat_id_key" ON "telegram_dialogs"("chat_id");
CREATE INDEX "telegram_dialogs_expires_at_idx" ON "telegram_dialogs"("expires_at");

-- AddForeignKey
ALTER TABLE "telegram_dialogs" ADD CONSTRAINT "telegram_dialogs_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "telegram_links"("chat_id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Текст миграции копируется дословно. Владелец уже применял её к своей одноразовой тестовой БД, и Prisma сверяет контрольную сумму файла.

- [ ] **Step 4: Удаление аккаунта**

В `apps/worker/src/account-purge.ts` три правки.

1. Первым элементом `BUDGET_TABLES_IN_DELETE_ORDER` поставить `telegram_dialogs`, потому что у модели есть `budgetId`, а `account-purge.coverage.test.ts` требует классифицировать каждую такую модель:

```ts
export const BUDGET_TABLES_IN_DELETE_ORDER = [
  'telegram_dialogs',
  'activity_feed_cursors',
```

2. В `USER_OWNED_TABLES` перед `'telegram_links',` добавить:

```ts
  'telegram_dialogs',
```

3. Перед строкой

```ts
  await tx.$executeRaw`DELETE FROM "telegram_links" WHERE "user_id" = ${userId}::uuid`;
```

добавить:

```ts
  await tx.$executeRaw`DELETE FROM "telegram_dialogs" WHERE "user_id" = ${userId}::uuid`;
```

- [ ] **Step 5: Функция очистки в воркере**

В конец `apps/worker/src/telegram/link-codes.ts` добавить:

```ts

const DIALOG_RETENTION_MS = 86_400_000;

/** Bot dialogs expire 30 minutes after the last step; a day later the leftover row is dropped. */
export async function purgeStaleDialogs(prisma: PrismaClient, now: Date): Promise<void> {
  await prisma.telegramDialog.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - DIALOG_RETENTION_MS) } },
  });
}
```

- [ ] **Step 6: Вызов очистки**

В `apps/worker/src/delivery/build-digests.handler.ts` строку импорта

```ts
import { purgeStaleLinkCodes } from '../telegram/link-codes.js';
```

заменить на:

```ts
import { purgeStaleDialogs, purgeStaleLinkCodes } from '../telegram/link-codes.js';
```

Блок

```ts
    // Codes and push devices have no budget: a run scoped to one budget (tests) leaves them alone.
    if (!budgetId) {
      await purgeStaleLinkCodes(this.prisma, now);
      await purgeInactivePushSubscriptions(this.prisma, now);
    }
```

заменить на:

```ts
    // Codes, bot dialogs and push devices: a run scoped to one budget (tests) leaves them alone.
    if (!budgetId) {
      await purgeStaleLinkCodes(this.prisma, now);
      await purgeStaleDialogs(this.prisma, now);
      await purgeInactivePushSubscriptions(this.prisma, now);
    }
```

Помощник тестов `apps/api/test/helpers/family-app.ts` не меняется: он удаляет привязки, а диалоги уходят вместе с ними каскадом.

- [ ] **Step 7: Тест схемы**

Файл `apps/api/test/telegram-dialogs-schema.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { purgeStaleDialogs } from '../../worker/src/telegram/link-codes.js';
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

const newChatId = () => BigInt(1_000_000 + Math.floor(Math.random() * 1_000_000_000));

async function linkAnna(): Promise<bigint> {
  await env.prisma.telegramLink.deleteMany({ where: { userId: anna.user.id } });
  const chatId = newChatId();
  const now = new Date();
  await env.prisma.telegramLink.create({
    data: { id: randomUUID(), userId: anna.user.id, chatId, consentedAt: now, linkedAt: now },
  });
  return chatId;
}

function dialog(chatId: bigint, expiresAt = new Date(Date.now() + 1_800_000)) {
  return {
    id: randomUUID(),
    chatId,
    userId: anna.user.id,
    budgetId: anna.budgetId,
    kind: 'EXPENSE',
    step: 'amount',
    expiresAt,
  };
}

describe('telegram_links commands columns', () => {
  it('are empty for a new link', async () => {
    const chatId = await linkAnna();
    const link = await env.prisma.telegramLink.findUniqueOrThrow({ where: { chatId } });
    expect(link.commandsEnabledAt).toBeNull();
    expect(link.commandsConsentAt).toBeNull();
  });
});

describe('telegram_dialogs', () => {
  it('keeps one dialog per chat with version 1 and empty data', async () => {
    const chatId = await linkAnna();
    const created = await env.prisma.telegramDialog.create({ data: dialog(chatId) });
    expect(created.version).toBe(1);
    expect(created.data).toEqual({});
    await expect(env.prisma.telegramDialog.create({ data: dialog(chatId) })).rejects.toThrow();
  });

  it('needs a linked chat and disappears with the link', async () => {
    await expect(
      env.prisma.telegramDialog.create({ data: dialog(newChatId()) }),
    ).rejects.toThrow();
    const chatId = await linkAnna();
    await env.prisma.telegramDialog.create({ data: dialog(chatId) });
    await env.prisma.telegramLink.delete({ where: { chatId } });
    expect(await env.prisma.telegramDialog.findUnique({ where: { chatId } })).toBeNull();
  });
});

describe('purgeStaleDialogs', () => {
  it('drops dialogs expired more than a day ago and keeps the rest', async () => {
    const chatId = await linkAnna();
    const stale = await env.prisma.telegramDialog.create({
      data: dialog(chatId, new Date(Date.now() - 2 * 86_400_000)),
    });
    await purgeStaleDialogs(env.prisma, new Date());
    expect(await env.prisma.telegramDialog.findUnique({ where: { id: stale.id } })).toBeNull();

    const fresh = await env.prisma.telegramDialog.create({
      data: dialog(chatId, new Date(Date.now() - 60_000)),
    });
    await purgeStaleDialogs(env.prisma, new Date());
    expect(await env.prisma.telegramDialog.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});
```

- [ ] **Step 8: Прогнать проверки**

Run: `pnpm test:integration`
Expected: PASS, включая `telegram-dialogs-schema.integration.test.ts` (4 теста). Миграция применилась к `harmofin_v22_test`.

Run: `pnpm --filter @harmofin/worker test`
Expected: PASS, включая `account-purge.coverage.test.ts`.

Run: `cd apps/api && pnpm exec prisma migrate diff --from-url 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' --to-schema-datamodel ../../prisma/schema.prisma --script`
Expected: `-- This is an empty migration.` Если в выводе есть `telegram`, значит SQL не совпадает со схемой, и его нужно исправить.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Review по чек-листу**

Выполнить `git add prisma/schema.prisma prisma/migrations/20261104000000_telegram_bot_commands apps/worker/src/account-purge.ts apps/worker/src/telegram/link-codes.ts apps/worker/src/delivery/build-digests.handler.ts apps/api/test/telegram-dialogs-schema.integration.test.ts`, затем просмотреть `git diff --staged`.

- **backend:**
  - миграция только добавляет: нет `DROP`, `ALTER COLUMN TYPE`, `UPDATE`;
  - имена индексов и FK совпадают с Prisma;
  - FK на `chat_id` с `ON DELETE CASCADE`.
- **security:**
  - в `telegram_dialogs` нет данных профиля Telegram;
  - таблица удаляется при удалении аккаунта: и по `user_id`, и по `budget_id` бюджетов владельца;
  - при отвязке чата диалог исчезает.
- **QA:** тесты проверяют пустые колонки команд, уникальность чата, каскад и очистку старше суток.
- **final:** в diff нет посторонних файлов, `identity/logo_description.png` не тронут.

- [ ] **Step 10: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): таблица диалогов и переключатель команд бота в схеме"
```

Добавить строку в «Ход выполнения» README. Закоммитить её вместе со следующей задачей или отдельным коммитом `docs(telegram): ход выполнения`.
