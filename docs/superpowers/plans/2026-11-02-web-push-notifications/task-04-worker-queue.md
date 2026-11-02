# Задача 4: воркер — канал PUSH в очереди

Перед началом: прочитать [README](README.md). Задачи 1–3 закоммичены.

**Files:**
- Modify: `apps/worker/src/delivery/channel-sender.ts` — `PUSH` в `DeliveryChannel`, тип `DigestChannel`.
- Create: `apps/worker/src/push/subscriptions.ts` — активная сессия, удаление подписок, очистка.
- Modify: `apps/worker/src/delivery/enqueue.ts`, `apps/worker/src/delivery/enqueue.test.ts` — тип уведомления и правила `PUSH`.
- Modify: `apps/worker/src/notification.handler.ts`, `apps/worker/src/calendar-reminder.handler.ts` — передать тип.
- Modify: `apps/worker/src/delivery/eligibility.ts`, `apps/worker/src/delivery/eligibility.test.ts` — флажки типов.
- Modify: `apps/worker/src/delivery/deliver.handler.ts` — `PUSH` в списке каналов.
- Modify: `apps/worker/src/delivery/build-digests.handler.ts` — только каналы дайджеста, очистка подписок.
- Modify: `apps/api/test/helpers/push.ts` — помощник `overdueNotification`.
- Create: `apps/api/test/push-queue.integration.test.ts`

**Interfaces:**
- Consumes (задача 1): Prisma-модель `pushSubscription` со связью `session`; `notificationChannelSetting.planOverdueEnabled`, `calendarReminderEnabled`.
- Consumes (задача 3, тесты): `vapidPublicKey`, `addSubscription`, `currentSessionId`, `revokedSessionId` из `apps/api/test/helpers/push.ts`.
- Consumes (существующее): `DeliveryRepository`, `ClaimedDelivery`, `BuildEmailDigestsHandler(prisma, channels)`, `enqueueUrgent(tx, input)`.
- Produces (использует задача 5):
  - `DeliveryChannel = 'EMAIL' | 'TELEGRAM' | 'PUSH'`, `DigestChannel = 'EMAIL' | 'TELEGRAM'` из `delivery/channel-sender.ts`.
  - `activeSessionWhere(now: Date): Prisma.SessionWhereInput`, `removePushSubscriptions(prisma, ids: readonly string[], reason: 'gone' | 'session' | 'key'): Promise<void>`, `purgeInactivePushSubscriptions(prisma, now): Promise<void>` из `push/subscriptions.ts`.
  - `enqueueUrgent(tx, { notificationId, workspaceId, budgetId, userId, type: 'PLAN_OVERDUE' | 'CALENDAR_REMINDER', now })`.
  - `CancelReason` с новым значением `'TYPE_DISABLED'`; `DeliveryFacts.setting.planOverdueEnabled`, `calendarReminderEnabled`; `DeliveryFacts.notification.notificationType: string`.
  - `BuildEmailDigestsHandler(prisma, channels: readonly DigestChannel[] = ['EMAIL'])`.
  - Тестовый помощник `overdueNotification(prisma, actor): Promise<{ notificationId: string; occurrenceId: string }>`.

---

- [ ] **Step 1: Типы каналов**

В `apps/worker/src/delivery/channel-sender.ts` заменить строку

```ts
export type DeliveryChannel = 'EMAIL' | 'TELEGRAM';
```

на

```ts
export type DeliveryChannel = 'EMAIL' | 'TELEGRAM' | 'PUSH';

/** Channels that receive the family digest; push carries urgent notifications only. */
export type DigestChannel = Exclude<DeliveryChannel, 'PUSH'>;
```

- [ ] **Step 2: Подписки в воркере**

Файл `apps/worker/src/push/subscriptions.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

export type PushRemovalReason = 'gone' | 'session' | 'key';

const PURGE_BATCH = 1_000;

/** A push device is usable only while the session it was created in is alive (same as the API). */
export function activeSessionWhere(now: Date): Prisma.SessionWhereInput {
  return { revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } };
}

/**
 * Deletes subscriptions with an audit entry each. A user left without devices gets the PUSH channel
 * switched off and the unsent pushes cancelled, as when the last device is removed in the web.
 */
export async function removePushSubscriptions(
  prisma: PrismaClient,
  ids: readonly string[],
  reason: PushRemovalReason,
): Promise<void> {
  if (ids.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const rows = await tx.pushSubscription.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, userId: true },
    });
    if (rows.length === 0) return;
    await tx.pushSubscription.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    for (const row of rows) {
      await tx.auditEvent.create({
        data: {
          id: randomUUID(),
          actorUserId: row.userId,
          entityType: 'push_subscription',
          entityId: row.id,
          action: 'PUSH_UNSUBSCRIBED',
          newValues: { reason },
          source: 'WORKER',
          requestId: null,
        },
      });
    }
    for (const userId of new Set(rows.map((row) => row.userId))) {
      if ((await tx.pushSubscription.count({ where: { userId } })) > 0) continue;
      await tx.notificationChannelSetting.updateMany({
        where: { userId, channel: 'PUSH' },
        data: { enabled: false },
      });
      await tx.notificationDelivery.updateMany({
        where: { userId, channel: 'PUSH', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'PUSH_NO_DEVICES' },
      });
    }
  });
}

/** A revoked or expired session never comes back, so its devices can never receive a push again. */
export async function purgeInactivePushSubscriptions(prisma: PrismaClient, now: Date): Promise<void> {
  const rows = await prisma.pushSubscription.findMany({
    where: {
      session: {
        OR: [
          { revokedAt: { not: null } },
          { idleExpiresAt: { lte: now } },
          { absoluteExpiresAt: { lte: now } },
        ],
      },
    },
    select: { id: true },
    take: PURGE_BATCH,
  });
  await removePushSubscriptions(
    prisma,
    rows.map((row) => row.id),
    'session',
  );
}
```

- [ ] **Step 3: Тест постановки в очередь (падает)**

Заменить **всё** содержимое `apps/worker/src/delivery/enqueue.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { enqueueUrgent } from './enqueue.js';

type Setting = {
  enabled: boolean;
  urgentEnabled: boolean;
  planOverdueEnabled?: boolean;
  calendarReminderEnabled?: boolean;
} | null;
type Channel = 'EMAIL' | 'TELEGRAM' | 'PUSH';

function makeTx(settings: Partial<Record<Channel, Setting>>, pushDevices = 0) {
  return {
    notificationChannelSetting: {
      findUnique: vi.fn(async ({ where }: { where: { userId_channel: { channel: Channel } } }) => {
        const setting = settings[where.userId_channel.channel];
        return setting
          ? { planOverdueEnabled: true, calendarReminderEnabled: true, ...setting }
          : null;
      }),
    },
    pushSubscription: { count: vi.fn().mockResolvedValue(pushDevices) },
    notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

const input = {
  notificationId: 'n-1',
  workspaceId: 'w-1',
  budgetId: 'b-1',
  userId: 'u-1',
  type: 'PLAN_OVERDUE' as const,
  now: new Date('2026-11-02T09:00:00.000Z'),
};

const queuedChannels = (tx: ReturnType<typeof makeTx>) =>
  tx.notificationDelivery.createMany.mock.calls.map(
    (call) => (call[0] as { data: { channel: string } }).data.channel,
  );

describe('enqueueUrgent', () => {
  it('queues nothing when the e-mail channel is off but urgent mail is on', async () => {
    const tx = makeTx({ EMAIL: { enabled: false, urgentEnabled: true } });
    await enqueueUrgent(tx as never, input);
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('queues one row per enabled channel with the same dedupe key', async () => {
    const tx = makeTx(
      {
        EMAIL: { enabled: true, urgentEnabled: true },
        TELEGRAM: { enabled: true, urgentEnabled: true },
        PUSH: { enabled: true, urgentEnabled: true },
      },
      1,
    );
    await enqueueUrgent(tx as never, input);
    const rows = tx.notificationDelivery.createMany.mock.calls.map(
      (call) => (call[0] as { data: { channel: string; dedupeKey: string } }).data,
    );
    expect(rows.map((row) => row.channel)).toEqual(['EMAIL', 'TELEGRAM', 'PUSH']);
    expect(rows.every((row) => row.dedupeKey === 'urgent:n-1')).toBe(true);
  });

  it('skips a channel with urgent messages off', async () => {
    const tx = makeTx({
      EMAIL: { enabled: true, urgentEnabled: false },
      TELEGRAM: { enabled: true, urgentEnabled: true },
    });
    await enqueueUrgent(tx as never, input);
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(1);
    expect(tx.notificationDelivery.createMany.mock.calls[0]![0]).toMatchObject({
      data: { channel: 'TELEGRAM' },
      skipDuplicates: true,
    });
  });

  it('skips push when the type is switched off', async () => {
    const tx = makeTx({ PUSH: { enabled: true, urgentEnabled: true, planOverdueEnabled: false } }, 1);
    await enqueueUrgent(tx as never, input);
    expect(queuedChannels(tx)).toEqual([]);

    const reminder = makeTx(
      { PUSH: { enabled: true, urgentEnabled: true, planOverdueEnabled: false } },
      1,
    );
    await enqueueUrgent(reminder as never, { ...input, type: 'CALENDAR_REMINDER' });
    expect(queuedChannels(reminder)).toEqual(['PUSH']);
  });

  it('skips push without a device of an active session', async () => {
    const tx = makeTx({ PUSH: { enabled: true, urgentEnabled: true } }, 0);
    await enqueueUrgent(tx as never, input);
    expect(queuedChannels(tx)).toEqual([]);
    expect(tx.pushSubscription.count).toHaveBeenCalledWith({
      where: {
        userId: 'u-1',
        session: {
          revokedAt: null,
          idleExpiresAt: { gt: input.now },
          absoluteExpiresAt: { gt: input.now },
        },
      },
    });
  });
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/delivery/enqueue.test.ts`
Expected: FAIL (`PUSH` не ставится).

- [ ] **Step 4: Постановка в очередь**

Заменить **всё** содержимое `apps/worker/src/delivery/enqueue.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { activeSessionWhere } from '../push/subscriptions.js';
import type { DeliveryChannel } from './channel-sender.js';

const URGENT_CHANNELS: readonly DeliveryChannel[] = ['EMAIL', 'TELEGRAM', 'PUSH'];

export type UrgentNotificationType = 'PLAN_OVERDUE' | 'CALENDAR_REMINDER';

type ChannelSetting = {
  enabled: boolean;
  urgentEnabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
};

type UrgentInput = {
  notificationId: string;
  workspaceId: string;
  budgetId: string;
  userId: string;
  type: UrgentNotificationType;
  now: Date;
};

/**
 * Called inside the transaction that has just created the in-app notification, so the message is
 * queued exactly when the notification exists: one row per channel with the channel and urgent
 * messages on. Push also needs its per-type switch and a device of an active session. The settings
 * are read here only to avoid queueing messages nobody wants; the sender re-checks everything.
 */
export async function enqueueUrgent(tx: Prisma.TransactionClient, input: UrgentInput): Promise<void> {
  for (const channel of URGENT_CHANNELS) {
    const setting = await tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId: input.userId, channel } },
      select: {
        enabled: true,
        urgentEnabled: true,
        planOverdueEnabled: true,
        calendarReminderEnabled: true,
      },
    });
    if (!setting?.enabled || !setting.urgentEnabled) continue;
    if (channel === 'PUSH' && !(await wantsPush(tx, input, setting))) continue;
    await tx.notificationDelivery.createMany({
      data: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        budgetId: input.budgetId,
        userId: input.userId,
        channel,
        kind: 'URGENT',
        notificationId: input.notificationId,
        dedupeKey: `urgent:${input.notificationId}`,
        nextAttemptAt: input.now,
      },
      skipDuplicates: true,
    });
  }
}

async function wantsPush(
  tx: Prisma.TransactionClient,
  input: UrgentInput,
  setting: ChannelSetting,
): Promise<boolean> {
  const typeOn =
    input.type === 'PLAN_OVERDUE' ? setting.planOverdueEnabled : setting.calendarReminderEnabled;
  if (!typeOn) return false;
  const devices = await tx.pushSubscription.count({
    where: { userId: input.userId, session: activeSessionWhere(input.now) },
  });
  return devices > 0;
}
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/delivery/enqueue.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 5: Места вызова**

В `apps/worker/src/notification.handler.ts` найти вызов

```ts
    await enqueueUrgent(tx, {
      notificationId,
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      userId,
      now: new Date(),
    });
```

и заменить на

```ts
    await enqueueUrgent(tx, {
      notificationId,
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      userId,
      type: 'PLAN_OVERDUE',
      now: new Date(),
    });
```

В `apps/worker/src/calendar-reminder.handler.ts` найти вызов

```ts
    await enqueueUrgent(tx, {
      notificationId,
      workspaceId: event.workspaceId,
      budgetId: event.budgetId,
      userId: values.userId,
      now: new Date(),
    });
```

и заменить на

```ts
    await enqueueUrgent(tx, {
      notificationId,
      workspaceId: event.workspaceId,
      budgetId: event.budgetId,
      userId: values.userId,
      type: 'CALENDAR_REMINDER',
      now: new Date(),
    });
```

- [ ] **Step 6: Тест перепроверки (падает)**

В `apps/worker/src/delivery/eligibility.test.ts`:

1. Заменить литерал `ok` на:

```ts
const ok: DeliveryFacts = {
  user: { email: 'a@x.test', status: 'ACTIVE', emailVerifiedAt: new Date() },
  setting: {
    enabled: true,
    urgentEnabled: true,
    digestFrequency: 'DAILY',
    includeAmounts: false,
    planOverdueEnabled: true,
    calendarReminderEnabled: true,
  },
  activeMember: true,
  budgetActive: true,
  notification: { resolvedAt: null, readAt: null, notificationType: 'PLAN_OVERDUE' },
  telegramLinked: false,
};
```

2. В таблице `it.each` три строки с `notification: { ... }` дополнить полем `notificationType: 'PLAN_OVERDUE'`:

```ts
    [
      'NOTIFICATION_CLOSED',
      { notification: { resolvedAt: new Date(), readAt: null, notificationType: 'PLAN_OVERDUE' } },
      'URGENT',
    ],
    [
      'NOTIFICATION_CLOSED',
      { notification: { resolvedAt: null, readAt: new Date(), notificationType: 'PLAN_OVERDUE' } },
      'URGENT',
    ],
```

(строку `['NOTIFICATION_CLOSED', { notification: null }, 'URGENT'],` оставить как есть).

3. В конец `describe('cancelReason', ...)` (перед последней `});`) добавить:

```ts
  it('checks the per-type switch only for push', () => {
    const overdueOff = { ...ok, setting: { ...ok.setting!, planOverdueEnabled: false } };
    expect(cancelReason('URGENT', overdueOff, 'PUSH')).toBe('TYPE_DISABLED');
    expect(cancelReason('URGENT', overdueOff, 'EMAIL')).toBeNull();

    const reminder = {
      ...overdueOff,
      notification: { resolvedAt: null, readAt: null, notificationType: 'CALENDAR_REMINDER' },
    };
    expect(cancelReason('URGENT', reminder, 'PUSH')).toBeNull();
    expect(
      cancelReason(
        'URGENT',
        { ...reminder, setting: { ...reminder.setting, calendarReminderEnabled: false } },
        'PUSH',
      ),
    ).toBe('TYPE_DISABLED');
  });

  it('never sends a push for other notification types or as a digest', () => {
    const other = {
      ...ok,
      notification: { resolvedAt: null, readAt: null, notificationType: 'PLAN_TODAY' },
    };
    expect(cancelReason('URGENT', other, 'PUSH')).toBe('TYPE_DISABLED');
    expect(
      cancelReason('DIGEST', { ...ok, setting: { ...ok.setting!, digestFrequency: 'OFF' } }, 'PUSH'),
    ).toBe('DIGEST_DISABLED');
  });
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/delivery/eligibility.test.ts`
Expected: FAIL (`TYPE_DISABLED` не возвращается).

- [ ] **Step 7: Перепроверка**

В `apps/worker/src/delivery/eligibility.ts`:

1. Тип `DeliveryFacts` заменить на:

```ts
export type DeliveryFacts = {
  user: { email: string; status: string; emailVerifiedAt: Date | null } | null;
  setting: {
    enabled: boolean;
    urgentEnabled: boolean;
    digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
    includeAmounts: boolean;
    planOverdueEnabled: boolean;
    calendarReminderEnabled: boolean;
  } | null;
  activeMember: boolean;
  budgetActive: boolean;
  notification: { resolvedAt: Date | null; readAt: Date | null; notificationType: string } | null;
  telegramLinked: boolean;
};
```

2. В union `CancelReason` после строки `  | 'NOTIFICATION_CLOSED';` заменить `;` так, чтобы получилось:

```ts
  | 'NOTIFICATION_CLOSED'
  | 'TYPE_DISABLED';
```

3. В `cancelReason` найти блок

```ts
  if (kind === 'URGENT') {
    const notification = facts.notification;
    if (!notification || notification.resolvedAt || notification.readAt) {
      return 'NOTIFICATION_CLOSED';
    }
  }
  return null;
}
```

и заменить на

```ts
  if (kind === 'URGENT') {
    const notification = facts.notification;
    if (!notification || notification.resolvedAt || notification.readAt) {
      return 'NOTIFICATION_CLOSED';
    }
    if (channel === 'PUSH' && !pushTypeEnabled(notification.notificationType, facts.setting)) {
      return 'TYPE_DISABLED';
    }
  }
  return null;
}

/** Push has its own switch per type; any other type is never pushed. */
function pushTypeEnabled(type: string, setting: NonNullable<DeliveryFacts['setting']>): boolean {
  if (type === 'PLAN_OVERDUE') return setting.planOverdueEnabled;
  if (type === 'CALENDAR_REMINDER') return setting.calendarReminderEnabled;
  return false;
}
```

4. В `loadDeliveryFacts`:
   - в запросе настройки заменить `select: { enabled: true, urgentEnabled: true, digestFrequency: true, includeAmounts: true },` на

```ts
      select: {
        enabled: true,
        urgentEnabled: true,
        digestFrequency: true,
        includeAmounts: true,
        planOverdueEnabled: true,
        calendarReminderEnabled: true,
      },
```

   - в запросе уведомления заменить `select: { resolvedAt: true, readAt: true },` на

```ts
          select: { resolvedAt: true, readAt: true, notificationType: true },
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/delivery/eligibility.test.ts`
Expected: PASS.

- [ ] **Step 8: Каналы обработчика доставки**

В `apps/worker/src/delivery/deliver.handler.ts` заменить строку

```ts
    this.channels = (['EMAIL', 'TELEGRAM'] as const).filter((channel) => senders[channel]);
```

на

```ts
    this.channels = (['EMAIL', 'TELEGRAM', 'PUSH'] as const).filter((channel) => senders[channel]);
```

- [ ] **Step 9: Задача дайджеста**

В `apps/worker/src/delivery/build-digests.handler.ts`:

1. Заменить импорт `import type { DeliveryChannel } from './channel-sender.js';` на `import type { DigestChannel } from './channel-sender.js';`, а после строки `import { purgeStaleLinkCodes } from '../telegram/link-codes.js';` добавить:

```ts
import { purgeInactivePushSubscriptions } from '../push/subscriptions.js';
```

2. В конструкторе заменить `private readonly channels: readonly DeliveryChannel[] = ['EMAIL'],` на `private readonly channels: readonly DigestChannel[] = ['EMAIL'],`.

3. Найти

```ts
    if (this.channels.length === 0) return;
    const settings = await this.prisma.notificationChannelSetting.findMany({
      where: {
        enabled: true,
        digestFrequency: { not: 'OFF' },
        OR: this.channels.map((channel) => reachable[channel]),
      },
      select: { userId: true, channel: true, digestFrequency: true },
    });
```

и заменить на

```ts
    // With push as the only channel there are no digests to build, but the cleanup below still runs.
    const settings =
      this.channels.length === 0
        ? []
        : await this.prisma.notificationChannelSetting.findMany({
            where: {
              enabled: true,
              digestFrequency: { not: 'OFF' },
              OR: this.channels.map((channel) => reachable[channel]),
            },
            select: { userId: true, channel: true, digestFrequency: true },
          });
```

4. Найти в конце `execute`

```ts
    // Codes have no budget: a run scoped to one budget (tests) leaves them alone.
    if (!budgetId) await purgeStaleLinkCodes(this.prisma, now);
```

и заменить на

```ts
    // Codes and push devices have no budget: a run scoped to one budget (tests) leaves them alone.
    if (!budgetId) {
      await purgeStaleLinkCodes(this.prisma, now);
      await purgeInactivePushSubscriptions(this.prisma, now);
    }
```

Run: `pnpm --filter @harmofin/worker typecheck`
Expected: PASS. Если TypeScript ругается на `reachable[channel]`, проверить, что тип `channels` — `readonly DigestChannel[]`.

- [ ] **Step 10: Помощник для интеграционных тестов**

В конец `apps/api/test/helpers/push.ts` добавить:

```ts
/** An overdue plan occurrence of the actor's budget and its in-app notification. */
export async function overdueNotification(
  prisma: PrismaClient,
  actor: { user: { id: string }; workspaceId: string; budgetId: string },
): Promise<{ notificationId: string; occurrenceId: string }> {
  const planId = randomUUID();
  const occurrenceId = randomUUID();
  await prisma.regularPlan.create({
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
  await prisma.planOccurrence.create({
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
  await prisma.notification.create({
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
  return { notificationId, occurrenceId };
}
```

- [ ] **Step 11: Интеграционный тест очереди**

Файл `apps/api/test/push-queue.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BuildEmailDigestsHandler } from '../../worker/src/delivery/build-digests.handler.js';
import { enqueueUrgent } from '../../worker/src/delivery/enqueue.js';
import { purgeInactivePushSubscriptions } from '../../worker/src/push/subscriptions.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';
import {
  addSubscription,
  currentSessionId,
  overdueNotification,
  revokedSessionId,
} from './helpers/push.js';

const env = new FamilyTestApp();
let anna: FamilyActor;

async function pushSetting(values: { planOverdueEnabled?: boolean; digestFrequency?: 'OFF' | 'DAILY' }) {
  await env.prisma.notificationChannelSetting.create({
    data: {
      id: randomUUID(),
      userId: anna.user.id,
      channel: 'PUSH',
      enabled: true,
      digestFrequency: values.digestFrequency ?? 'OFF',
      planOverdueEnabled: values.planOverdueEnabled ?? true,
    },
  });
}

async function enqueue(notificationId: string) {
  await env.prisma.$transaction((tx) =>
    enqueueUrgent(tx, {
      notificationId,
      workspaceId: anna.workspaceId,
      budgetId: anna.budgetId,
      userId: anna.user.id,
      type: 'PLAN_OVERDUE',
      now: new Date(),
    }),
  );
}

const pushRows = () =>
  env.prisma.notificationDelivery.findMany({ where: { userId: anna.user.id, channel: 'PUSH' } });

beforeAll(async () => {
  await env.start();
  anna = await env.register();
});

afterAll(async () => {
  await env.stop();
});

beforeEach(async () => {
  await env.prisma.notificationDelivery.deleteMany({ where: { userId: anna.user.id } });
  await env.prisma.pushSubscription.deleteMany({ where: { userId: anna.user.id } });
  await env.prisma.notificationChannelSetting.deleteMany({ where: { userId: anna.user.id } });
});

describe('push in the delivery queue', () => {
  it('queues an urgent push for a device of the active session', async () => {
    await pushSetting({});
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await currentSessionId(env.prisma, anna.user.id),
    });
    const { notificationId } = await overdueNotification(env.prisma, anna);
    await enqueue(notificationId);
    const rows = await pushRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'URGENT', dedupeKey: `urgent:${notificationId}` });
  });

  it('does not queue with the type switched off or only a revoked device', async () => {
    await pushSetting({ planOverdueEnabled: false });
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await currentSessionId(env.prisma, anna.user.id),
    });
    await enqueue((await overdueNotification(env.prisma, anna)).notificationId);
    expect(await pushRows()).toHaveLength(0);

    await env.prisma.notificationChannelSetting.updateMany({
      where: { userId: anna.user.id, channel: 'PUSH' },
      data: { planOverdueEnabled: true },
    });
    await env.prisma.pushSubscription.deleteMany({ where: { userId: anna.user.id } });
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await revokedSessionId(env.prisma, anna.user.id),
    });
    await enqueue((await overdueNotification(env.prisma, anna)).notificationId);
    expect(await pushRows()).toHaveLength(0);
  });

  it('never builds a push digest', async () => {
    await pushSetting({ digestFrequency: 'DAILY' });
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await currentSessionId(env.prisma, anna.user.id),
    });
    const handler = new BuildEmailDigestsHandler(env.prisma, ['EMAIL', 'TELEGRAM']);
    await handler.execute(new Date('2026-11-02T05:00:00.000Z'), anna.budgetId);
    expect(await pushRows()).toHaveLength(0);
  });
});

describe('purgeInactivePushSubscriptions', () => {
  it('removes devices of revoked sessions and switches the channel off without devices', async () => {
    await pushSetting({});
    const live = await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await currentSessionId(env.prisma, anna.user.id),
    });
    const dead = await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await revokedSessionId(env.prisma, anna.user.id),
    });

    await purgeInactivePushSubscriptions(env.prisma, new Date());
    expect(await env.prisma.pushSubscription.findUnique({ where: { id: dead.id } })).toBeNull();
    expect(await env.prisma.pushSubscription.findUnique({ where: { id: live.id } })).not.toBeNull();
    const audit = await env.prisma.auditEvent.findFirst({
      where: { entityId: dead.id, action: 'PUSH_UNSUBSCRIBED' },
    });
    expect(audit?.newValues).toEqual({ reason: 'session' });
    const setting = await env.prisma.notificationChannelSetting.findFirstOrThrow({
      where: { userId: anna.user.id, channel: 'PUSH' },
    });
    expect(setting.enabled).toBe(true);

    await env.prisma.pushSubscription.update({
      where: { id: live.id },
      data: { sessionId: await revokedSessionId(env.prisma, anna.user.id) },
    });
    await purgeInactivePushSubscriptions(env.prisma, new Date());
    const after = await env.prisma.notificationChannelSetting.findFirstOrThrow({
      where: { userId: anna.user.id, channel: 'PUSH' },
    });
    expect(after.enabled).toBe(false);
  });
});
```

Run: `pnpm test:integration`
Expected: PASS, включая `push-queue.integration.test.ts` (4 теста) и прежние `telegram-delivery`, `email-delivery`, `email-digest`, `delivery-channels`.

- [ ] **Step 12: Прогнать проверки**

Run: `pnpm --filter @harmofin/worker test`
Expected: PASS (в том числе `notification.handler.test.ts` и `calendar-reminder.handler.test.ts`: если в них есть ожидание точного объекта аргументов `enqueueUrgent`, добавить туда `type`, и только это).

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, 0 errors.

Run: `pnpm exec prettier --write apps/worker/src/delivery apps/worker/src/push apps/worker/src/notification.handler.ts apps/worker/src/calendar-reminder.handler.ts apps/api/test/helpers/push.ts apps/api/test/push-queue.integration.test.ts`
Если prettier что-то поменял, повторить `pnpm --filter @harmofin/worker test`.

- [ ] **Step 13: Review по чек-листу**

```bash
git add apps/worker/src/delivery apps/worker/src/push apps/worker/src/notification.handler.ts apps/worker/src/calendar-reminder.handler.ts apps/api/test/helpers/push.ts apps/api/test/push-queue.integration.test.ts
git diff --staged
```

Чек-лист:

- backend:
  - `PUSH` ставится только при включённом канале, включённом типе и устройстве активной сессии;
  - правила `EMAIL` и `TELEGRAM` не изменились;
  - дайджест строится только для `DigestChannel`;
  - очистка подписок идёт и без каналов дайджеста.
- security: перепроверка при отправке учитывает тип (`TYPE_DISABLED`); другие типы уведомлений в push не уходят; в аудите только причина, без endpoint.
- QA:
  - юнит-тесты покрывают оба типа, отсутствие устройства и запрет дайджеста;
  - интеграция покрывает очередь, отозванную сессию, дайджест и очистку;
  - зафиксированы падения шагов 3 и 6 до реализации.
- final: только файлы из списка Files (плюс точечные правки ожиданий `enqueueUrgent` в тестах обработчиков, если понадобились).

- [ ] **Step 14: Commit**

```bash
git branch --show-current
git commit -m "feat(push): канал PUSH в очереди уведомлений и очистка подписок"
```

Строку в «Ход выполнения» — как в README.
