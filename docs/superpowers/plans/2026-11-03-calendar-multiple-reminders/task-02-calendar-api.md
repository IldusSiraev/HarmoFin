# Задача 2: поле `reminders` в API календаря

Перед началом прочитать [README](README.md). Ветка — `feat/calendar-multiple-reminders`. Задача 1 закоммичена.

**Files:**
- Modify (полная замена): `apps/api/src/calendar/calendar.schemas.ts`
- Modify: `apps/api/src/calendar/calendar-event.mapper.ts`
- Modify: `apps/api/src/calendar/calendar.repository.ts` — `eventSelect`.
- Modify: `apps/api/src/calendar/calendar.application.service.ts` — правка, аудит, ответ.
- Modify: `apps/api/src/calendar/calendar.dto.ts`
- Modify: `apps/api/src/calendar/calendar.schemas.test.ts`
- Modify: `apps/api/src/calendar/calendar-event.mapper.test.ts`
- Modify: `apps/api/test/calendar-events.integration.test.ts`
- Modify: `openapi.json` (генерируется).

**Interfaces:**
- Consumes (задача 1): Prisma-поле `CalendarEvent.reminderOffsets: number[]`.
- Produces (используют задачи 3 и 5):
  - `REMINDER_OFFSETS = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080]`, `MAX_REMINDERS = 3` из `calendar.schemas.ts`;
  - `resolveReminders(reminders: number[] | undefined, reminderMinutes: number | null | undefined): number[] | null` — `null` значит «не передано»;
  - `CalendarEventInput.reminders: number[] | null` (поля `reminderMinutes` в выходе схемы больше нет);
  - `CalendarEventData.reminderOffsets: number[]` и `reminderMinutes: number | null` (всегда `reminderOffsets[0] ?? null`);
  - `toEventData(input, timezone, currentOffsets = [])`;
  - ответ события: `reminders: number[]` по возрастанию и `reminderMinutes: number | null` (`deprecated`);
  - тело `POST` и `PATCH`: необязательные `reminders: number[]` и `reminderMinutes: number | null` (`deprecated`);
  - аудит события (`newValues` и `oldValues`) получает `reminders`.

Бот (`apps/api/src/telegram/bot/telegram-command.service.ts`) передаёт в схему `reminderMinutes` и после этой задачи создаёт событие с `reminders = [x]` или `[]`. Код бота не меняется.

---

- [ ] **Step 1: Падающие unit-тесты схемы**

В `apps/api/src/calendar/calendar.schemas.test.ts`:

1. Строку импорта заменить на

```ts
import {
  calendarEventInputSchema,
  calendarFeedQuerySchema,
  resolveReminders,
} from './calendar.schemas.js';
```

2. В тесте `accepts a timed weekly event and fills defaults` строку `      reminderMinutes: null,` заменить на `      reminders: null,`.

3. В тесте `checks weekdays, repeatUntil, interval and reminder` строку

```ts
    expect(fields({ ...timed, reminderMinutes: 30 })).toContain('reminderMinutes');
```

заменить на

```ts
    expect(fields({ ...timed, reminderMinutes: 45 })).toContain('reminderMinutes');
```

4. Перед строкой `describe('calendarFeedQuerySchema', () => {` добавить:

```ts
describe('calendar reminders', () => {
  const messages = (value: unknown): string[] => {
    const result = calendarEventInputSchema.safeParse(value);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };

  it('sorts the reminders and accepts every offset of the list', () => {
    expect(calendarEventInputSchema.parse({ ...timed, reminders: [1440, 0, 60] }).reminders).toEqual(
      [0, 60, 1440],
    );
    for (const minutes of [0, 5, 15, 30, 60, 120, 1440, 2880, 10080]) {
      expect(fields({ ...timed, reminders: [minutes] })).toEqual([]);
      expect(fields({ ...timed, reminderMinutes: minutes })).toEqual([]);
    }
  });

  it('maps the deprecated reminderMinutes onto reminders', () => {
    expect(calendarEventInputSchema.parse({ ...timed, reminderMinutes: 60 }).reminders).toEqual([60]);
    expect(calendarEventInputSchema.parse({ ...timed, reminderMinutes: null }).reminders).toEqual([]);
    expect(calendarEventInputSchema.parse(timed)).not.toHaveProperty('reminderMinutes');
  });

  it('accepts both fields when reminderMinutes is the smallest reminder', () => {
    expect(
      calendarEventInputSchema.parse({ ...timed, reminders: [60, 15], reminderMinutes: 15 }).reminders,
    ).toEqual([15, 60]);
    expect(
      calendarEventInputSchema.parse({ ...timed, reminders: [], reminderMinutes: null }).reminders,
    ).toEqual([]);
  });

  it('rejects four reminders, an unknown offset, repeats and disagreeing fields', () => {
    expect(fields({ ...timed, reminders: [0, 5, 15, 30] })).toEqual(['reminders']);
    expect(messages({ ...timed, reminders: [0, 5, 15, 30] })).toEqual([
      'Можно выбрать до трёх напоминаний.',
    ]);
    expect(fields({ ...timed, reminders: [45] })).toEqual(['reminders.0']);
    expect(messages({ ...timed, reminders: [45] })).toEqual(['Выберите напоминание из списка.']);
    expect(messages({ ...timed, reminders: [60, 60] })).toEqual([
      'Напоминания не должны повторяться.',
    ]);
    expect(messages({ ...timed, reminders: [15, 60], reminderMinutes: 60 })).toEqual([
      'Напоминания не совпадают с reminderMinutes.',
    ]);
    expect(messages({ ...timed, reminders: [], reminderMinutes: 60 })).toEqual([
      'Напоминания не совпадают с reminderMinutes.',
    ]);
  });
});

describe('resolveReminders', () => {
  it('prefers reminders, then reminderMinutes, and says null when neither is given', () => {
    expect(resolveReminders([60, 5], 5)).toEqual([5, 60]);
    expect(resolveReminders(undefined, 1440)).toEqual([1440]);
    expect(resolveReminders(undefined, null)).toEqual([]);
    expect(resolveReminders(undefined, undefined)).toBeNull();
  });
});
```

В `apps/api/src/calendar/calendar-event.mapper.test.ts`:

1. В первом тесте (`stores a timed event as UTC instants of the budget time zone`) в объекте `toMatchObject` после строки `      reminderMinutes: 60,` добавить строку `      reminderOffsets: [60],`.

2. В конец блока `describe('calendar event mapper', () => { ... })`, перед его закрывающей `});`, добавить:

```ts
  it('keeps the smallest reminder as reminderMinutes and the stored ones when none are given', () => {
    const input = (extra: Record<string, unknown>) =>
      calendarEventInputSchema.parse({
        title: 'Врач',
        allDay: true,
        date: '2026-11-05',
        recurrence: 'NONE',
        participantUserIds: [],
        ...extra,
      });
    expect(toEventData(input({ reminders: [1440, 0] }), tz)).toMatchObject({
      reminderOffsets: [0, 1440],
      reminderMinutes: 0,
    });
    expect(toEventData(input({}), tz)).toMatchObject({ reminderOffsets: [], reminderMinutes: null });
    expect(toEventData(input({}), tz, [15, 60])).toMatchObject({
      reminderOffsets: [15, 60],
      reminderMinutes: 15,
    });
    expect(toEventData(input({ reminders: [] }), tz, [15, 60])).toMatchObject({
      reminderOffsets: [],
      reminderMinutes: null,
    });
  });
```

- [ ] **Step 2: Запустить и увидеть падение**

```bash
cd apps/api && pnpm exec vitest run src/calendar
```

Ожидается: FAIL — нет `resolveReminders`, у схемы нет `reminders`, у маппера нет `reminderOffsets`.

- [ ] **Step 3: Схема (полная замена файла)**

`apps/api/src/calendar/calendar.schemas.ts`:

```ts
import { z } from 'zod';

export const REMINDER_OFFSETS = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080] as const;
export const MAX_REMINDERS = 3;
export const MAX_FEED_DAYS = 62;
const MAX_ALL_DAY_SPAN_DAYS = 30;

const date = z.string().date('Укажите дату в формате ГГГГ-ММ-ДД.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Укажите время в формате ЧЧ:ММ.');
const uuid = z.string().uuid();
const reminderOffset = z
  .number()
  .int()
  .refine((value) => (REMINDER_OFFSETS as readonly number[]).includes(value), {
    message: 'Выберите напоминание из списка.',
  });

export const calendarUuidSchema = uuid;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * One rule for both reminder fields: `reminders` wins; the deprecated `reminderMinutes` means one
 * reminder or none; null means neither was given, so an update keeps the stored reminders.
 */
export function resolveReminders(
  reminders: number[] | undefined,
  reminderMinutes: number | null | undefined,
): number[] | null {
  if (reminders !== undefined) return [...reminders].sort((a, b) => a - b);
  if (reminderMinutes !== undefined) return reminderMinutes === null ? [] : [reminderMinutes];
  return null;
}

export const calendarEventInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Введите название.').max(200, 'Не длиннее 200 символов.'),
    description: z.string().trim().max(2000, 'Не длиннее 2000 символов.').nullable().optional(),
    allDay: z.boolean(),
    date,
    endDate: date.nullable().optional(),
    startTime: time.nullable().optional(),
    endTime: time.nullable().optional(),
    recurrence: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    interval: z.number().int().min(1, 'От 1 до 99.').max(99, 'От 1 до 99.').default(1),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    repeatUntil: date.nullable().optional(),
    participantUserIds: z.array(uuid).max(50).default([]),
    reminders: z
      .array(reminderOffset)
      .max(MAX_REMINDERS, 'Можно выбрать до трёх напоминаний.')
      .optional(),
    reminderMinutes: reminderOffset.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (value.allDay) {
      if (value.startTime) issue('startTime', 'У события на весь день нет времени начала.');
      if (value.endTime) issue('endTime', 'У события на весь день нет времени конца.');
      if (value.endDate && value.endDate < value.date) {
        issue('endDate', 'Дата окончания не может быть раньше даты начала.');
      } else if (value.endDate && daysBetween(value.date, value.endDate) > MAX_ALL_DAY_SPAN_DAYS) {
        issue('endDate', 'Событие может длиться не больше 31 дня.');
      }
    } else {
      if (!value.startTime) issue('startTime', 'Укажите время начала.');
      if (!value.endTime) issue('endTime', 'Укажите время конца.');
      if (value.endDate) issue('endDate', 'Дата окончания — только у события на весь день.');
      if (value.startTime && value.endTime && value.endTime < value.startTime) {
        issue('endTime', 'Конец не может быть раньше начала.');
      }
    }
    if (value.recurrence === 'WEEKLY' && value.weekdays.length === 0) {
      issue('weekdays', 'Выберите хотя бы один день недели.');
    }
    if (value.recurrence !== 'WEEKLY' && value.weekdays.length > 0) {
      issue('weekdays', 'Дни недели — только у еженедельного повтора.');
    }
    if (new Set(value.weekdays).size !== value.weekdays.length) {
      issue('weekdays', 'Дни недели не должны повторяться.');
    }
    if (value.repeatUntil && value.recurrence === 'NONE') {
      issue('repeatUntil', 'Дата окончания повтора — только у повторяющегося события.');
    } else if (value.repeatUntil && value.repeatUntil < value.date) {
      issue('repeatUntil', 'Повтор не может закончиться раньше начала.');
    }
    if (value.reminders) {
      if (new Set(value.reminders).size !== value.reminders.length) {
        issue('reminders', 'Напоминания не должны повторяться.');
      } else if (value.reminderMinutes !== undefined) {
        const smallest = value.reminders.length > 0 ? Math.min(...value.reminders) : null;
        if (smallest !== value.reminderMinutes) {
          issue('reminders', 'Напоминания не совпадают с reminderMinutes.');
        }
      }
    }
  })
  .transform(({ reminders, reminderMinutes, ...value }) => ({
    ...value,
    description: value.description ? value.description : null,
    endDate: value.endDate ?? null,
    startTime: value.startTime ?? null,
    endTime: value.endTime ?? null,
    repeatUntil: value.repeatUntil ?? null,
    reminders: resolveReminders(reminders, reminderMinutes),
    weekdays: [...value.weekdays].sort((a, b) => a - b),
    participantUserIds: [...new Set(value.participantUserIds)],
  }));

export type CalendarEventInput = z.output<typeof calendarEventInputSchema>;

export const calendarFeedQuerySchema = z
  .object({
    from: date,
    to: date,
    participantUserId: uuid.optional(),
    includePlans: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Конец диапазона раньше начала.' });
    } else if (daysBetween(value.from, value.to) + 1 > MAX_FEED_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Диапазон — не больше 62 дней.' });
    }
  });

export type CalendarFeedQuery = z.output<typeof calendarFeedQuerySchema>;
```

`REMINDER_MINUTES` удалён: его импортировал только этот файл. Проверка: `grep -rn "REMINDER_MINUTES" apps/api/src` должен ничего не найти.

- [ ] **Step 4: Маппер**

В `apps/api/src/calendar/calendar-event.mapper.ts`:

1. В `interface CalendarEventData` строку `  reminderMinutes: number | null;` заменить на:

```ts
  /** Mirror of the smallest offset for the previous release; always reminderOffsets[0] ?? null. */
  reminderMinutes: number | null;
  /** Minutes before the start, ascending, at most three. */
  reminderOffsets: number[];
```

2. Сигнатуру и начало `toEventData` заменить. Было:

```ts
export function toEventData(input: CalendarEventInput, timezone: string): CalendarEventData {
  const repeating = input.recurrence !== 'NONE';
  const common = {
```

Стало:

```ts
/** `currentOffsets` are the stored reminders: an update without reminder fields keeps them. */
export function toEventData(
  input: CalendarEventInput,
  timezone: string,
  currentOffsets: readonly number[] = [],
): CalendarEventData {
  const repeating = input.recurrence !== 'NONE';
  const reminderOffsets = input.reminders ?? [...currentOffsets];
  const common = {
```

3. В объекте `common` строку `    reminderMinutes: input.reminderMinutes,` заменить на:

```ts
    reminderOffsets,
    reminderMinutes: reminderOffsets[0] ?? null,
```

- [ ] **Step 5: Репозиторий**

В `apps/api/src/calendar/calendar.repository.ts`, в `eventSelect`, после строки `  reminderMinutes: true,` добавить строку `  reminderOffsets: true,`.

- [ ] **Step 6: Сервис**

В `apps/api/src/calendar/calendar.application.service.ts`:

1. В `interface CalendarEventView` строку `  reminderMinutes: number | null;` заменить на:

```ts
  reminders: number[];
  reminderMinutes: number | null;
```

2. В `auditValues` после строки `    reminderMinutes: event.reminderMinutes,` добавить строку `    reminders: event.reminderOffsets,`.

3. В `updateEvent` вызов

```ts
          toEventData(input, timezone),
```

заменить на

```ts
          toEventData(input, timezone, current.reminderOffsets),
```

В `createEvent` вызов `...toEventData(input, timezone),` остаётся без изменений: новое событие без полей напоминаний получает `[]`.

4. В `view` строку `      reminderMinutes: event.reminderMinutes,` заменить на:

```ts
      reminders: [...event.reminderOffsets],
      reminderMinutes: event.reminderOffsets[0] ?? null,
```

- [ ] **Step 7: DTO**

В `apps/api/src/calendar/calendar.dto.ts`:

1. Строку `const REMINDERS = [15, 60, 1440, 10080];` заменить на `const REMINDERS = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080];`.

2. В `CalendarEventBody` блок

```ts
  @ApiPropertyOptional({
    type: Number,
    enum: REMINDERS,
    nullable: true,
    description: 'Минуты до начала; у события на весь день — от 09:00.',
  })
  reminderMinutes?: number | null;
```

заменить на

```ts
  @ApiPropertyOptional({
    type: Number,
    isArray: true,
    enum: REMINDERS,
    maxItems: 3,
    description:
      'До трёх напоминаний, минуты до начала, без повторов; у события на весь день — от 09:00. ' +
      'Если не передано ни это поле, ни reminderMinutes: при создании — без напоминаний, при правке — без изменений.',
  })
  reminders?: number[];

  @ApiPropertyOptional({
    type: Number,
    enum: REMINDERS,
    nullable: true,
    deprecated: true,
    description:
      'Устарело: одно напоминание, используйте reminders. Если переданы оба поля, должно быть равно наименьшему из reminders.',
  })
  reminderMinutes?: number | null;
```

3. В `CalendarEventResponse` строки

```ts
  @ApiProperty({ type: Number, enum: REMINDERS, nullable: true })
  reminderMinutes!: number | null;
```

заменить на

```ts
  @ApiProperty({
    type: Number,
    isArray: true,
    enum: REMINDERS,
    description: 'Напоминания по возрастанию, минуты до начала.',
  })
  reminders!: number[];

  @ApiProperty({
    type: Number,
    enum: REMINDERS,
    nullable: true,
    deprecated: true,
    description: 'Устарело: наименьшее из reminders или null.',
  })
  reminderMinutes!: number | null;
```

- [ ] **Step 8: Unit-тесты зелёные**

```bash
cd apps/api && pnpm exec vitest run src/calendar src/telegram
pnpm typecheck
```

Ожидается: PASS. Тесты бота проходят без изменений.

- [ ] **Step 9: Интеграционные тесты**

В `apps/api/test/calendar-events.integration.test.ts`:

1. В тесте `a member creates an event; it comes back in local time with people refs` после строки `      reminderMinutes: 60,` (внутри `toMatchObject`) добавить строку `      reminders: [60],`.

2. В конец файла добавить:

```ts
// The same weekly body without either reminder field.
function withoutReminders(): Record<string, unknown> {
  const body: Record<string, unknown> = { ...weekly() };
  delete body.reminderMinutes;
  return body;
}

describe('calendar events: reminders', () => {
  it('stores up to three reminders ascending and mirrors the smallest one', async () => {
    const created = await create(editor, { ...withoutReminders(), reminders: [1440, 0, 60] });
    const response = await env.inject('GET', `${base(editor)}/${created.id}`, editor);
    expect(response.json()).toMatchObject({ reminders: [0, 60, 1440], reminderMinutes: 0 });
    const row = await env.prisma.calendarEvent.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ reminderOffsets: [0, 60, 1440], reminderMinutes: 0 });

    const audit = await env.prisma.auditEvent.findFirst({
      where: { entityType: 'calendar_event', entityId: created.id, action: 'CREATED' },
    });
    expect(audit?.newValues).toMatchObject({ reminders: [0, 60, 1440], reminderMinutes: 0 });
  });

  it('an event without reminder fields has none', async () => {
    const created = await create(editor, withoutReminders());
    const response = await env.inject('GET', `${base(editor)}/${created.id}`, editor);
    expect(response.json()).toMatchObject({ reminders: [], reminderMinutes: null });
  });

  it('PATCH without reminder fields keeps them, with an empty list clears them', async () => {
    const created = await create(editor, { ...withoutReminders(), reminders: [15, 1440] });
    const kept = await env.inject('PATCH', `${base(editor)}/${created.id}`, editor, {
      ...withoutReminders(),
      title: 'Кружок лепки',
    });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json()).toMatchObject({ title: 'Кружок лепки', reminders: [15, 1440] });

    const cleared = await env.inject('PATCH', `${base(editor)}/${created.id}`, editor, {
      ...withoutReminders(),
      reminders: [],
    });
    expect(cleared.json()).toMatchObject({ reminders: [], reminderMinutes: null });
    const row = await env.prisma.calendarEvent.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ reminderOffsets: [], reminderMinutes: null });
  });

  it('PATCH with only the deprecated field replaces the reminders with one', async () => {
    const created = await create(editor, { ...withoutReminders(), reminders: [15, 1440] });
    const response = await env.inject('PATCH', `${base(editor)}/${created.id}`, editor, {
      ...withoutReminders(),
      reminderMinutes: 120,
    });
    expect(response.json()).toMatchObject({ reminders: [120], reminderMinutes: 120 });
  });

  it('refuses four reminders, an unknown offset, repeats and disagreeing fields', async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ reminders: [0, 5, 15, 30] }, 'reminders', 'Можно выбрать до трёх напоминаний.'],
      [{ reminders: [45] }, 'reminders.0', 'Выберите напоминание из списка.'],
      [{ reminders: [60, 60] }, 'reminders', 'Напоминания не должны повторяться.'],
      [
        { reminders: [15, 60], reminderMinutes: 60 },
        'reminders',
        'Напоминания не совпадают с reminderMinutes.',
      ],
    ];
    for (const [extra, field, message] of cases) {
      const response = await env.inject('POST', base(editor), editor, {
        ...withoutReminders(),
        ...extra,
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: expect.arrayContaining([expect.objectContaining({ field, message })]),
      });
    }
  });
});
```

Запустить:

```bash
cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@127.0.0.1:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/calendar-events.integration.test.ts test/calendar-feed.integration.test.ts test/calendar-schema.integration.test.ts test/telegram-bot-dialogs.integration.test.ts
```

Ожидается: PASS. Бот (`telegram-bot-dialogs`) продолжает создавать событие с `reminderMinutes: 60`.

`ZodValidationPipe` (`apps/api/src/common/validation/zod-validation.pipe.ts`) отвечает 400 `VALIDATION_FAILED` и склеивает путь через точку, поэтому у ошибки элемента поле — `reminders.0`.

- [ ] **Step 10: OpenAPI**

```bash
node scripts/openapi/generate.mjs
pnpm exec prettier --write openapi.json
node scripts/openapi/check.mjs openapi.json
git diff --stat openapi.json
```

Ожидается: `check.mjs` без `lint:`; в diff — `reminders` в теле и ответе события, `deprecated: true` у `reminderMinutes`, расширенный `enum`.

- [ ] **Step 11: Общие проверки и stage**

```bash
pnpm --filter @harmofin/api test
pnpm typecheck
pnpm lint
cd apps/api && pnpm exec prettier --check src/calendar test/calendar-events.integration.test.ts && cd ../..
git add apps/api/src/calendar openapi.json apps/api/test/calendar-events.integration.test.ts
git status --short
```

**Review:** API (совместимость тела и ответа, `deprecated`, правило объединения, коды ошибок), security (фильтр `budgetId` и проверка автора не изменились, в аудите нет названий), QA (все ветки `resolveReminders`, правка без полей), final.

**Commit (оркестратор):**

```bash
git branch --show-current
git commit -m "feat(calendar): несколько напоминаний в API событий"
```
