# Задача 1: колонка смещений напоминаний

Перед началом прочитать [README](README.md). Ветка — `feat/calendar-multiple-reminders`.

**Files:**
- Create: `prisma/migrations/20261105000000_calendar_multiple_reminders/migration.sql`
- Modify: `prisma/schema.prisma` — поле `reminderOffsets` у `CalendarEvent`.
- Modify: `apps/api/test/calendar-schema.integration.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces (используют задачи 2 и 3):
  - Prisma-поле `CalendarEvent.reminderOffsets: number[]`, по умолчанию `[]`;
  - БД отвергает больше трёх значений, значения вне списка, повторы, неупорядоченный массив, `NULL` в массиве и сам `NULL`;
  - `reminder_minutes` принимает те же девять значений или `NULL`;
  - частичный индекс `calendar_events_reminders_idx` по `budget_id` для событий с напоминаниями.

---

- [ ] **Step 1: Падающие тесты ограничений**

В `apps/api/test/calendar-schema.integration.test.ts` три правки.

1. Импорты в начале файла заменить на:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createUuidV7 } from '../src/common/identifiers/uuid-v7.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';
```

2. В тесте `rejects an unsupported reminder and an interval out of range` строку

```ts
    await rejects(base({ reminderMinutes: 30 }));
```

заменить на

```ts
    await rejects(base({ reminderMinutes: 45 }));
```

3. В конец блока `describe('calendar_events constraints', () => { ... })`, перед его закрывающей `});`, добавить:

```ts
  it('stores up to three ascending reminder offsets and widens reminder_minutes', async () => {
    await env.prisma.calendarEvent.create({
      data: base({ reminderOffsets: [0, 60, 10080], reminderMinutes: 0 }),
    });
    await env.prisma.calendarEvent.create({
      data: base({ reminderOffsets: [5, 30], reminderMinutes: 5 }),
    });
    const plain = await env.prisma.calendarEvent.create({ data: base() });
    expect(plain.reminderOffsets).toEqual([]);
  });

  it('rejects four offsets, an offset outside the list, repeats and a wrong order', async () => {
    await rejects(base({ reminderOffsets: [0, 5, 15, 30] }));
    await rejects(base({ reminderOffsets: [45] }));
    await rejects(base({ reminderOffsets: [60, 60] }));
    await rejects(base({ reminderOffsets: [60, 15] }));
    await rejects(base({ reminderOffsets: [5, 60, 15] }));
  });

  it('rejects a NULL offset array and a NULL element', async () => {
    const id = createUuidV7();
    await env.prisma.calendarEvent.create({ data: base({ id }) });
    await expect(
      env.prisma.$executeRawUnsafe(
        `UPDATE "calendar_events" SET "reminder_offsets" = NULL WHERE "id" = '${id}'`,
      ),
    ).rejects.toMatchObject({ meta: { code: '23514' } });
    await expect(
      env.prisma.$executeRawUnsafe(
        `UPDATE "calendar_events" SET "reminder_offsets" = ARRAY[5, NULL]::INTEGER[] WHERE "id" = '${id}'`,
      ),
    ).rejects.toMatchObject({ meta: { code: '23514' } });
  });

  it('the backfill statement of the migration copies reminder_minutes into the offsets', async () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          '../../../prisma/migrations/20261105000000_calendar_multiple_reminders/migration.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    const backfill = migration
      .split(';')
      .map((statement) => statement.replace(/--.*$/gm, '').trim())
      .find((statement) => statement.startsWith('UPDATE "calendar_events"'));
    expect(backfill).toBeDefined();

    const id = createUuidV7();
    await env.prisma.calendarEvent.create({ data: base({ id, reminderMinutes: 1440 }) });
    await env.prisma.$executeRawUnsafe(`${backfill} AND "id" = '${id}'`);
    const row = await env.prisma.calendarEvent.findUniqueOrThrow({ where: { id } });
    expect(row.reminderOffsets).toEqual([1440]);
  });
```

Почему `meta.code` у двух тестов с `$executeRawUnsafe`: для сырых запросов Prisma кладёт SQLSTATE в `meta.code`, а не в `message` (см. комментарий у `rejects` в этом же файле).

- [ ] **Step 2: Запустить тест и увидеть падение**

```bash
cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@127.0.0.1:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/calendar-schema.integration.test.ts
```

Ожидается: TypeScript или Prisma не знает `reminderOffsets`, новые тесты FAIL. Тест с `reminderMinutes: 45` проходит, потому что 45 недопустимо и сейчас.

- [ ] **Step 3: Миграция**

Создать `prisma/migrations/20261105000000_calendar_multiple_reminders/migration.sql`:

```sql
-- Calendar: up to three reminders per event. Additive: one array column filled from
-- reminder_minutes, which stays as the smallest offset so the previous release keeps working.

-- AlterTable: same form as "weekdays" (Prisma lists carry no NOT NULL); the check below forbids NULL.
ALTER TABLE "calendar_events" ADD COLUMN "reminder_offsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Backfill
UPDATE "calendar_events" SET "reminder_offsets" = ARRAY["reminder_minutes"] WHERE "reminder_minutes" IS NOT NULL;

-- Checks
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_reminder_minutes";
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_reminder_minutes" CHECK (
  "reminder_minutes" IS NULL OR "reminder_minutes" IN (0, 5, 15, 30, 60, 120, 1440, 2880, 10080)
);
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_reminder_offsets" CHECK (
  "reminder_offsets" IS NOT NULL
  AND array_position("reminder_offsets", NULL) IS NULL
  AND cardinality("reminder_offsets") <= 3
  AND "reminder_offsets" <@ ARRAY[0, 5, 15, 30, 60, 120, 1440, 2880, 10080]
  AND (cardinality("reminder_offsets") < 2 OR "reminder_offsets"[1] < "reminder_offsets"[2])
  AND (cardinality("reminder_offsets") < 3 OR "reminder_offsets"[2] < "reminder_offsets"[3])
);

-- Index: the worker reads only events that have reminders.
DROP INDEX "calendar_events_reminders_idx";
CREATE INDEX "calendar_events_reminders_idx" ON "calendar_events"("budget_id") WHERE cardinality("reminder_offsets") > 0 AND "deleted_at" IS NULL;
```

- [ ] **Step 4: Схема Prisma**

В `prisma/schema.prisma`, в `model CalendarEvent`, сразу после строки

```prisma
  reminderMinutes Int?               @map("reminder_minutes")
```

добавить строку

```prisma
  reminderOffsets Int[]              @default([]) @map("reminder_offsets")
```

Затем:

```bash
pnpm exec prisma format
git diff prisma/schema.prisma
pnpm db:generate
```

`git diff` должен показать только одну добавленную строку. Если `prisma format` выровнял соседние строки, это допустимо: это форматирование.

- [ ] **Step 5: Применить миграцию и проверить**

```bash
DATABASE_URL='postgresql://harmofin_local:harmofin_local@127.0.0.1:5432/harmofin_v22_test' pnpm test:integration
```

Прогон применяет миграцию к одноразовой БД и запускает весь набор. Ожидается: всё зелёное, включая новые тесты `calendar-schema.integration.test.ts`.

Затем проверить, что схема и миграции совпадают:

```bash
DATABASE_URL='postgresql://harmofin_local:harmofin_local@127.0.0.1:5432/harmofin_v22_test' pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

Ожидается: `-- This is an empty migration.` Если diff не пустой, остановиться и записать вывод в «Ход выполнения».

```bash
pnpm typecheck
pnpm --filter @harmofin/worker test
```

Ожидается: PASS. Код ещё не использует новое поле, поэтому всё остальное не меняется.

- [ ] **Step 6: Stage**

```bash
git add prisma/migrations/20261105000000_calendar_multiple_reminders/migration.sql prisma/schema.prisma apps/api/test/calendar-schema.integration.test.ts
git status --short
```

**Review:** backend (миграция аддитивная, backfill, ограничения, индекс, совместимость с откатом), QA (тесты ограничений и backfill), final.

**Commit (оркестратор):**

```bash
git branch --show-current
git commit -m "feat(calendar): колонка нескольких напоминаний на событие"
```
