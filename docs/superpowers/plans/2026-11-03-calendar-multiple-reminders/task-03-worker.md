# Задача 3: несколько смещений в worker и тип во всех каналах

Перед началом прочитать [README](README.md). Ветка — `feat/calendar-multiple-reminders`. Задачи 1–2 закоммичены.

**Files:**
- Modify: `apps/worker/src/calendar-reminder.handler.ts`
- Modify: `apps/worker/src/calendar-reminder.handler.test.ts`
- Modify: `apps/worker/src/delivery/enqueue.ts`
- Modify: `apps/worker/src/delivery/enqueue.test.ts`
- Modify: `apps/worker/src/delivery/eligibility.ts`
- Modify: `apps/worker/src/delivery/eligibility.test.ts`

**Interfaces:**
- Consumes (задача 1): Prisma-поле `CalendarEvent.reminderOffsets: number[]`, по возрастанию, не больше трёх.
- Consumes (уже есть): `reminderWindow(now, minutes, tz)`, `reminderMoment(occurrence, minutes, tz)`, `isReminderDue(moment, now)`, `reminderKey(eventId, date, minutes)` из `calendar-reminder.ts` — не меняются.
- Produces:
  - `CalendarReminderHandler` выбирает события с `reminderOffsets: { isEmpty: false }` и создаёт уведомление на каждую пару «вхождение, смещение», у которой подошёл момент;
  - `enqueueUrgent` пропускает канал, у которого выключен тип (`planOverdueEnabled` для `PLAN_OVERDUE`, `calendarReminderEnabled` для `CALENDAR_REMINDER`), — в EMAIL, TELEGRAM и PUSH;
  - `cancelReason('URGENT', facts, channel)` возвращает `TYPE_DISABLED` при выключенном типе в любом канале; push по-прежнему не отправляет другие типы.

Правила (из спецификации):
- окно разворота вхождений — по наибольшему смещению события;
- `0` — момент начала, для «весь день» — 09:00 дня события;
- два смещения одного вхождения, сработавшие в одном запуске, дают два уведомления;
- ключ, получатели, тексты и правило «простой дольше 30 минут» не меняются.

---

- [ ] **Step 1: Падающие тесты обработчика**

В `apps/worker/src/calendar-reminder.handler.test.ts`:

1. В `eventSelect` строку `  reminderMinutes: true,` заменить на `  reminderOffsets: true,`.
2. В `weeklyEvent` строку `    reminderMinutes: 60,` заменить на `    reminderOffsets: [60],`.
3. В тесте `queries only non-deleted events of active plan-model-2 budgets` строку `        reminderMinutes: { not: null },` заменить на `        reminderOffsets: { isEmpty: false },`.
4. В тесте `writes relative copy for an all-day event reminded a day ahead` строку `          reminderMinutes: 1440,` заменить на `          reminderOffsets: [1440],`.
5. В конец блока `describe('CalendarReminderHandler', () => { ... })`, перед его закрывающей `});`, добавить:

```ts
  const keysOf = (tx: ReturnType<typeof makeTx>) =>
    new Set(
      tx.notification.createMany.mock.calls.map(
        ([args]) => (args as { data: { notificationKey: string } }).data.notificationKey,
      ),
    );

  it('reminds at each offset of the event only when its own moment comes', async () => {
    // 2026-11-03 17:00 Moscow = 14:00 UTC: 60 minutes before is 13:00, the start is 14:00.
    const event = weeklyEvent({ reminderOffsets: [0, 60, 1440] });

    const hourTx = makeTx();
    await new CalendarReminderHandler(makePrisma([event], hourTx) as never).execute(
      new Date('2026-11-03T13:05:00Z'),
    );
    expect(keysOf(hourTx)).toEqual(new Set(['calendar:event-1:2026-11-03:60']));

    const startTx = makeTx();
    await new CalendarReminderHandler(makePrisma([event], startTx) as never).execute(
      new Date('2026-11-03T14:05:00Z'),
    );
    expect(keysOf(startTx)).toEqual(new Set(['calendar:event-1:2026-11-03:0']));
  });

  it('expands the window by the longest offset of the event', async () => {
    // A week before the 2026-11-10 occurrence is the start of the 2026-11-03 one.
    const tx = makeTx();
    const prisma = makePrisma([weeklyEvent({ reminderOffsets: [0, 10080] })], tx);
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-03T14:05:00Z'));
    expect(keysOf(tx)).toEqual(
      new Set(['calendar:event-1:2026-11-03:0', 'calendar:event-1:2026-11-10:10080']),
    );
    // Both reminders of both recipients in one transaction.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.notification.createMany).toHaveBeenCalledTimes(4);
  });

  it('creates both reminders when two offsets come due in the same run', async () => {
    // 15 minutes before is 13:45, 5 minutes before is 13:55: both lie in (13:28, 13:58].
    const tx = makeTx();
    const prisma = makePrisma([weeklyEvent({ reminderOffsets: [5, 15] })], tx);
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-03T13:58:00Z'));
    expect(keysOf(tx)).toEqual(
      new Set(['calendar:event-1:2026-11-03:5', 'calendar:event-1:2026-11-03:15']),
    );
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(4);
  });

  it('reminds an all-day event at 09:00 of its day for the start offset', async () => {
    const tx = makeTx();
    const prisma = makePrisma(
      [
        weeklyEvent({
          id: 'event-2',
          allDay: true,
          startsAt: null,
          endsAt: null,
          startsOn: new Date('2026-11-05T00:00:00.000Z'),
          endsOn: new Date('2026-11-05T00:00:00.000Z'),
          recurrence: 'NONE',
          weekdays: [],
          reminderOffsets: [0],
          participants: [],
        }),
      ],
      tx,
      { workspaceMembership: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-a' }]) } },
    );
    // 09:00 Moscow = 06:00 UTC.
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-05T06:10:00Z'));
    const calls = tx.notification.createMany.mock.calls.map(
      ([args]) => (args as { data: Record<string, unknown> }).data,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      body: 'Сегодня, весь день',
      notificationKey: 'calendar:event-2:2026-11-05:0',
    });
  });

  it('does not repeat any of several offsets on a rerun', async () => {
    const tx = makeTx();
    const handler = new CalendarReminderHandler(
      makePrisma([weeklyEvent({ reminderOffsets: [5, 15] })], tx) as never,
    );
    await handler.execute(new Date('2026-11-03T13:58:00Z'));
    tx.notification.createMany.mockResolvedValue({ count: 0 });
    await handler.execute(new Date('2026-11-03T14:00:00Z'));
    expect(keysOf(tx)).toEqual(
      new Set(['calendar:event-1:2026-11-03:5', 'calendar:event-1:2026-11-03:15']),
    );
    // Only the first run's inserts produced audits and deliveries.
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(4);
  });
```

- [ ] **Step 2: Падающие тесты доставки**

В `apps/worker/src/delivery/enqueue.test.ts` тест `skips push when the type is switched off` целиком заменить на:

```ts
  it('skips every channel whose type is switched off', async () => {
    const on = { enabled: true, urgentEnabled: true };
    const tx = makeTx(
      {
        EMAIL: { ...on, planOverdueEnabled: false },
        TELEGRAM: { ...on, planOverdueEnabled: false },
        PUSH: { ...on, planOverdueEnabled: false },
      },
      1,
    );
    await enqueueUrgent(tx as never, input);
    expect(queuedChannels(tx)).toEqual([]);

    const reminder = makeTx(
      {
        EMAIL: { ...on, planOverdueEnabled: false },
        TELEGRAM: { ...on, calendarReminderEnabled: false },
        PUSH: { ...on, planOverdueEnabled: false },
      },
      1,
    );
    await enqueueUrgent(reminder as never, { ...input, type: 'CALENDAR_REMINDER' });
    expect(queuedChannels(reminder)).toEqual(['EMAIL', 'PUSH']);
  });
```

В `apps/worker/src/delivery/eligibility.test.ts` тест `checks the per-type switch only for push` целиком заменить на:

```ts
  it('checks the per-type switch on every channel', () => {
    const overdueOff = { ...ok, setting: { ...ok.setting!, planOverdueEnabled: false } };
    expect(cancelReason('URGENT', overdueOff, 'PUSH')).toBe('TYPE_DISABLED');
    expect(cancelReason('URGENT', overdueOff, 'EMAIL')).toBe('TYPE_DISABLED');
    expect(
      cancelReason('URGENT', { ...overdueOff, telegramLinked: true }, 'TELEGRAM'),
    ).toBe('TYPE_DISABLED');

    const reminder = {
      ...overdueOff,
      notification: { resolvedAt: null, readAt: null, notificationType: 'CALENDAR_REMINDER' },
    };
    expect(cancelReason('URGENT', reminder, 'PUSH')).toBeNull();
    expect(cancelReason('URGENT', reminder, 'EMAIL')).toBeNull();
    const reminderOff = {
      ...reminder,
      setting: { ...reminder.setting, calendarReminderEnabled: false },
    };
    expect(cancelReason('URGENT', reminderOff, 'PUSH')).toBe('TYPE_DISABLED');
    expect(cancelReason('URGENT', reminderOff, 'EMAIL')).toBe('TYPE_DISABLED');
    // The type switch never touches the digest.
    expect(cancelReason('DIGEST', { ...reminderOff, notification: null }, 'EMAIL')).toBeNull();
  });
```

Тест `never sends a push for other notification types or as a digest` не меняется.

- [ ] **Step 3: Запустить и увидеть падение**

```bash
pnpm --filter @harmofin/worker exec vitest run src/calendar-reminder.handler.test.ts src/delivery/enqueue.test.ts src/delivery/eligibility.test.ts
```

Ожидается: FAIL в изменённых и новых тестах.

- [ ] **Step 4: Обработчик**

В `apps/worker/src/calendar-reminder.handler.ts`:

1. В `reminderEventSelect` строку `  reminderMinutes: true,` заменить на `  reminderOffsets: true,`.

2. В `execute` строку `        reminderMinutes: { not: null },` заменить на `        reminderOffsets: { isEmpty: false },`.

3. Начало `remindEvent` — от строки `  private async remindEvent(event: ReminderEvent, now: Date): Promise<void> {` до строки `    if (due.length === 0) return;` включительно — заменить на:

```ts
  private async remindEvent(event: ReminderEvent, now: Date): Promise<void> {
    const offsets = event.reminderOffsets;
    if (offsets.length === 0) return;
    const timezone = event.budget.timezone;
    // The longest offset reaches furthest ahead: one expansion covers every offset.
    const occurrences = expandOccurrences(
      toRule(event, timezone),
      reminderWindow(now, Math.max(...offsets), timezone),
      timezone,
    );
    const due = occurrences.flatMap((occurrence) =>
      offsets
        .filter((minutes) => isReminderDue(reminderMoment(occurrence, minutes, timezone), now))
        .map((minutes) => ({ occurrence, minutes })),
    );
    if (due.length === 0) return;
```

4. В транзакции цикл

```ts
      for (const occurrence of due) {
        const body = reminderBody(occurrence, now, timezone);
        const notificationKey = reminderKey(event.id, occurrence.occurrenceDate, minutes);
```

заменить на

```ts
      for (const { occurrence, minutes } of due) {
        const body = reminderBody(occurrence, now, timezone);
        const notificationKey = reminderKey(event.id, occurrence.occurrenceDate, minutes);
```

Остальная часть цикла (`actionPath`, перебор получателей, `createReminder`) не меняется.

5. В комментарии над классом после первого абзаца (он заканчивается словами `no participant names.`) добавить абзац:

```ts
 *
 * An event has up to three offsets (minutes before the start; for an all-day event, before 09:00
 * of its day). Each offset is its own reminder with its own key, so adding an offset never repeats
 * the ones already sent.
```

- [ ] **Step 5: Постановка в очередь**

В `apps/worker/src/delivery/enqueue.ts`:

1. Комментарий над `enqueueUrgent` заменить на:

```ts
/**
 * Called inside the transaction that has just created the in-app notification, so the message is
 * queued exactly when the notification exists: one row per channel with the channel, urgent
 * messages and this notification type on. Push also needs a device of an active session. The
 * settings are read here only to avoid queueing messages nobody wants; the sender re-checks
 * everything.
 */
```

2. Строку

```ts
    if (channel === 'PUSH' && !(await wantsPush(tx, input, setting))) continue;
```

заменить на

```ts
    if (!typeEnabled(input.type, setting)) continue;
    if (channel === 'PUSH' && !(await hasPushDevice(tx, input))) continue;
```

3. Функцию `wantsPush` целиком заменить на:

```ts
function typeEnabled(type: UrgentNotificationType, setting: ChannelSetting): boolean {
  return type === 'PLAN_OVERDUE' ? setting.planOverdueEnabled : setting.calendarReminderEnabled;
}

async function hasPushDevice(tx: Prisma.TransactionClient, input: UrgentInput): Promise<boolean> {
  const devices = await tx.pushSubscription.count({
    where: { userId: input.userId, session: activeSessionWhere(input.now) },
  });
  return devices > 0;
}
```

- [ ] **Step 6: Повторная проверка при отправке**

В `apps/worker/src/delivery/eligibility.ts`:

1. Строку

```ts
    if (channel === 'PUSH' && !pushTypeEnabled(notification.notificationType, facts.setting)) {
```

заменить на

```ts
    if (!typeEnabled(notification.notificationType, facts.setting, channel)) {
```

2. Функцию `pushTypeEnabled` вместе с комментарием над ней заменить на:

```ts
/** Every channel has its own switch per urgent type; push sends no other type at all. */
function typeEnabled(
  type: string,
  setting: NonNullable<DeliveryFacts['setting']>,
  channel: DeliveryChannel,
): boolean {
  if (type === 'PLAN_OVERDUE') return setting.planOverdueEnabled;
  if (type === 'CALENDAR_REMINDER') return setting.calendarReminderEnabled;
  return channel !== 'PUSH';
}
```

Если в комментарии над `cancelReason` говорится, что тип проверяется только для push, поправить это предложение: тип проверяется во всех каналах.

- [ ] **Step 7: Проверки**

```bash
pnpm --filter @harmofin/worker test
pnpm typecheck
pnpm lint
pnpm exec prettier --check apps/worker/src
DATABASE_URL='postgresql://harmofin_local:harmofin_local@127.0.0.1:5432/harmofin_v22_test' pnpm test:integration
```

Ожидается: всё PASS. Интеграционный набор нужен ради `email-delivery`, `telegram-delivery`, `push-delivery` и `delivery-channels`: в них у типов значение `true` по умолчанию, поэтому они не должны измениться.

- [ ] **Step 8: Stage**

```bash
git add apps/worker/src/calendar-reminder.handler.ts apps/worker/src/calendar-reminder.handler.test.ts apps/worker/src/delivery/enqueue.ts apps/worker/src/delivery/enqueue.test.ts apps/worker/src/delivery/eligibility.ts apps/worker/src/delivery/eligibility.test.ts
git status --short
```

**Review:** backend (окно по наибольшему смещению, одна транзакция на событие, ключи прежние, тип во всех каналах при постановке и отправке), QA (смещение 0, «весь день», два смещения в одном запуске, повтор без дублей), final.

**Commit (оркестратор):**

```bash
git branch --show-current
git commit -m "feat(worker): несколько напоминаний на событие и тип уведомления во всех каналах"
```
