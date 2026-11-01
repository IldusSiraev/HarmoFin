# Задача 5: воркер — очередь по каналам, `ChannelSender`, `EmailSender`

Перед началом: прочитать [README](README.md). Задачи 1–4 закоммичены.

Цель: очередь, перепроверка и дайджест перестают быть «только email». Поведение email не меняется — все существующие тесты должны остаться зелёными (меняются только конструкторы в трёх местах тестов и моки `findUnique` в двух юнит-тестах). Telegram-отправителя в этой задаче ещё нет: он появится в задаче 6.

**Files:**
- Create: `apps/worker/src/delivery/channel-sender.ts`
- Create: `apps/worker/src/delivery/email-sender.ts`
- Modify (заменить целиком): `apps/worker/src/delivery/deliver.handler.ts`
- Modify: `apps/worker/src/delivery/delivery.repository.ts` — `channel` в `ClaimedDelivery`, фильтр каналов в `claim`, `postpone`, `fail`.
- Modify: `apps/worker/src/delivery/eligibility.ts` — перепроверка по каналу.
- Modify: `apps/worker/src/delivery/eligibility.test.ts`
- Modify (заменить целиком): `apps/worker/src/delivery/enqueue.ts`, `apps/worker/src/delivery/enqueue.test.ts`
- Modify: `apps/worker/src/notification.handler.ts`, `apps/worker/src/calendar-reminder.handler.ts` — новое имя функции.
- Modify: `apps/worker/src/notification.handler.test.ts`, `apps/worker/src/calendar-reminder.handler.test.ts` — моки по каналу.
- Modify: `apps/worker/src/delivery/build-digests.handler.ts` — каналы.
- Modify: `apps/worker/src/main.ts` — новый конструктор обработчика.
- Modify: `apps/api/test/email-delivery.integration.test.ts` — новый конструктор.
- Create: `apps/api/test/delivery-channels.integration.test.ts`

**Interfaces:**
- Consumes (задача 1): канал `'TELEGRAM'`, модель `telegramLink` (`userId` unique).
- Produces (использует задача 6):
  - `type DeliveryChannel = 'EMAIL' | 'TELEGRAM'` и `interface ChannelSender { send(delivery: ClaimedDelivery, facts: DeliveryFacts, now: Date): Promise<SendResult> }`, `type SendResult = { outcome: 'sent' } | { outcome: 'cancelled'; reason: string }`, `type ChannelSenders = Partial<Record<DeliveryChannel, ChannelSender>>`, классы `RetryLaterError(retryAt: Date, code: string)` и `PermanentSendError(code: string)` — из `delivery/channel-sender.ts`.
  - `new DeliverNotificationsHandler(prisma, repository, senders: ChannelSenders, hooks?, batchSize?)`.
  - `new EmailSender(prisma, repository, mailer, webBaseUrl)` из `delivery/email-sender.ts`.
  - `ClaimedDelivery.channel: DeliveryChannel`; `DeliveryRepository.claim(limit, now, budgetId?, channels = ['EMAIL'])`, `postpone(id, at, error)`, `fail(id, error)`.
  - `DeliveryFacts.telegramLinked: boolean`; `cancelReason(kind, facts, channel = 'EMAIL')` с новой причиной `'TELEGRAM_NOT_LINKED'`.
  - `enqueueUrgent(tx, input)` из `delivery/enqueue.ts` (ставит запись на каждый включённый канал).
  - `new BuildEmailDigestsHandler(prisma, channels: readonly DeliveryChannel[] = ['EMAIL'])`.

---

- [ ] **Step 1: Типы отправителя**

Файл `apps/worker/src/delivery/channel-sender.ts`:

```ts
import type { ClaimedDelivery } from './delivery.repository.js';
import type { DeliveryFacts } from './eligibility.js';

export type DeliveryChannel = 'EMAIL' | 'TELEGRAM';

export type SendResult = { outcome: 'sent' } | { outcome: 'cancelled'; reason: string };

/**
 * Builds and sends one message of its channel. Called only after the common re-check passed.
 * Returns `cancelled` when there is nothing to send; throws to retry (see the error classes).
 */
export interface ChannelSender {
  send(delivery: ClaimedDelivery, facts: DeliveryFacts, now: Date): Promise<SendResult>;
}

export type ChannelSenders = Partial<Record<DeliveryChannel, ChannelSender>>;

/** Try again at `retryAt` without spending an attempt (Telegram 429 with retry_after). */
export class RetryLaterError extends Error {
  constructor(
    readonly retryAt: Date,
    readonly code: string,
  ) {
    super(code);
    this.name = 'RetryLaterError';
  }
}

/** The message can never be delivered as is (Telegram 4xx): fail at once, no retries. */
export class PermanentSendError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermanentSendError';
  }
}
```

- [ ] **Step 2: Репозиторий очереди**

В `apps/worker/src/delivery/delivery.repository.ts`:

1. Импорт: строку `import { Prisma, type PrismaClient } from '@prisma/client';` оставить; добавить ниже `import type { DeliveryChannel } from './channel-sender.js';`.

2. В `export type ClaimedDelivery = { ... }` после `userId: string;` добавить `channel: DeliveryChannel;`.

3. Сигнатуру `claim(limit: number, now: Date, budgetId?: string): Promise<ClaimedDelivery[]> {` заменить на:

```ts
  claim(
    limit: number,
    now: Date,
    budgetId?: string,
    channels: readonly DeliveryChannel[] = ['EMAIL'],
  ): Promise<ClaimedDelivery[]> {
```

4. В теле `claim` перед `return this.prisma.$transaction(` добавить:

```ts
    if (channels.length === 0) return Promise.resolve([]);
    const channelFilter = Prisma.join(channels.map((channel) => Prisma.sql`${channel}`));
```

5. В SQL строку `AND "channel" = 'EMAIL'` заменить на `AND "channel"::text IN (${channelFilter})`.

6. В `RETURNING` после строки `delivery."user_id" AS "userId",` добавить строку `delivery."channel"::text AS "channel",`.

7. В конец класса (после `retryOrFail`) добавить:

```ts
  /** Moves the next attempt to `at` and gives back the attempt the claim counted. */
  async postpone(id: string, at: Date, error: string): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data: { nextAttemptAt: at, attempts: { decrement: 1 }, lastError: error.slice(0, 200) },
    });
  }

  async fail(id: string, error: string): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'FAILED', lastError: error.slice(0, 200) },
    });
  }
```

Комментарий над `claim` дополнить одной строкой: `` `channels` limits the claim to channels this worker can send; other rows wait in the queue. ``

- [ ] **Step 3: Перепроверка по каналу — тесты (падают)**

В `apps/worker/src/delivery/eligibility.test.ts`:

1. В объекте `ok` после `notification: { resolvedAt: null, readAt: null },` добавить `telegramLinked: false,`.

2. Перед последней закрывающей `});` файла добавить:

```ts
  it('checks the address only for email and the link only for telegram', () => {
    const unverified = { ...ok, user: { ...ok.user!, emailVerifiedAt: null } };
    expect(cancelReason('DIGEST', unverified, 'TELEGRAM')).toBe('TELEGRAM_NOT_LINKED');
    expect(cancelReason('DIGEST', { ...unverified, telegramLinked: true }, 'TELEGRAM')).toBeNull();
    expect(cancelReason('DIGEST', { ...ok, telegramLinked: true }, 'EMAIL')).toBeNull();
    expect(cancelReason('DIGEST', unverified, 'EMAIL')).toBe('EMAIL_NOT_VERIFIED');
  });
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/delivery/eligibility.test.ts`
Expected: FAIL (тип и третий аргумент не поддерживаются).

- [ ] **Step 4: Перепроверка по каналу — реализация**

В `apps/worker/src/delivery/eligibility.ts`:

1. После `import type { ClaimedDelivery } from './delivery.repository.js';` добавить `import type { DeliveryChannel } from './channel-sender.js';`.

2. В `export type DeliveryFacts = { ... }` после `notification: { ... } | null;` добавить `telegramLinked: boolean;`.

3. В `export type CancelReason =` после `| 'EMAIL_NOT_VERIFIED'` добавить строку `| 'TELEGRAM_NOT_LINKED'`.

4. Функцию `cancelReason` заменить на:

```ts
export function cancelReason(
  kind: 'URGENT' | 'DIGEST',
  facts: DeliveryFacts,
  channel: DeliveryChannel = 'EMAIL',
): CancelReason | null {
  if (!facts.user || facts.user.status !== 'ACTIVE') return 'USER_INACTIVE';
  if (channel === 'EMAIL' && !facts.user.emailVerifiedAt) return 'EMAIL_NOT_VERIFIED';
  if (channel === 'TELEGRAM' && !facts.telegramLinked) return 'TELEGRAM_NOT_LINKED';
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
```

5. В `loadDeliveryFacts`:
   - строку `const [user, setting, membership, budget, notification] = await Promise.all([` заменить на `const [user, setting, membership, budget, notification, telegramLink] = await Promise.all([`;
   - в запросе настроек `where: { userId_channel: { userId: delivery.userId, channel: 'EMAIL' } },` заменить на `where: { userId_channel: { userId: delivery.userId, channel: delivery.channel } },`;
   - последним элементом массива `Promise.all` (после запроса `notification`) добавить:

```ts
    delivery.channel === 'TELEGRAM'
      ? prisma.telegramLink.findUnique({ where: { userId: delivery.userId }, select: { id: true } })
      : Promise.resolve(null),
```

   - в возвращаемом объекте после `notification,` добавить `telegramLinked: telegramLink !== null,`.

Run: тест из Step 3. Expected: PASS.

- [ ] **Step 5: `EmailSender`**

Файл `apps/worker/src/delivery/email-sender.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import type { Mailer } from '../mail/mailer.js';
import {
  renderDigest,
  renderUrgent,
  type MailLinks,
  type RenderedMail,
} from '../mail/templates.js';
import type { ChannelSender, SendResult } from './channel-sender.js';
import type { ClaimedDelivery, DeliveryRepository } from './delivery.repository.js';
import { loadDigestContent } from './digest-content.js';
import type { DeliveryFacts } from './eligibility.js';
import { loadUrgentContent } from './urgent-content.js';

/** Same digest as apps/api/src/notification-settings/unsubscribe-token.ts. */
export function hashUnsubscribeToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Letters over SMTP. A fresh unsubscribe token is minted per letter; only its SHA-256 is stored,
 * before sending, so the link in a delivered letter works even if the status write fails.
 */
export class EmailSender implements ChannelSender {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DeliveryRepository,
    private readonly mailer: Mailer,
    private readonly webBaseUrl: string,
  ) {}

  async send(delivery: ClaimedDelivery, facts: DeliveryFacts): Promise<SendResult> {
    const token = randomBytes(32).toString('base64url');
    const links: MailLinks = { webBaseUrl: this.webBaseUrl, unsubscribeToken: token };
    const mail = await this.render(delivery, facts.setting!.includeAmounts, links);
    if (!mail) {
      return {
        outcome: 'cancelled',
        reason: delivery.kind === 'DIGEST' ? 'DIGEST_EMPTY' : 'NOTIFICATION_MISSING',
      };
    }
    await this.repository.prepareToken(delivery.id, hashUnsubscribeToken(token));
    await this.mailer.send({ to: facts.user!.email, ...mail });
    return { outcome: 'sent' };
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

- [ ] **Step 6: Обработчик доставки**

Файл `apps/worker/src/delivery/deliver.handler.ts` заменить целиком:

```ts
import type { PrismaClient } from '@prisma/client';

import type { WorkerJobHandler } from '../job-runner.js';
import {
  PermanentSendError,
  RetryLaterError,
  type ChannelSenders,
  type DeliveryChannel,
} from './channel-sender.js';
import type { ClaimedDelivery, DeliveryRepository } from './delivery.repository.js';
import { cancelReason, loadDeliveryFacts } from './eligibility.js';

export { hashUnsubscribeToken } from './email-sender.js';

export type DeliveryOutcome = 'sent' | 'cancelled' | 'retried' | 'failed';
export type DeliveryFailure = { deliveryId: string; errorName: string };

function errorName(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code.slice(0, 64);
  return error instanceof Error ? error.name : 'Unknown error';
}

/**
 * Sends the outbox through the sender of each row's channel. Only channels with a configured sender
 * are claimed. Every message is re-checked right before sending; its text (and amounts, only with
 * consent) is built at that moment and never stored. A failure of one message schedules a retry for
 * that message only and the run moves on. Only the delivery id and the error class reach logs.
 */
export class DeliverNotificationsHandler implements WorkerJobHandler {
  private readonly channels: DeliveryChannel[];

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: DeliveryRepository,
    private readonly senders: ChannelSenders,
    private readonly hooks: {
      onOutcome?: (kind: string, outcome: DeliveryOutcome) => void;
      onFailure?: (failure: DeliveryFailure) => void;
    } = {},
    private readonly batchSize = 20,
  ) {
    this.channels = (['EMAIL', 'TELEGRAM'] as const).filter((channel) => senders[channel]);
  }

  async execute(now: Date, budgetId?: string): Promise<void> {
    if (this.channels.length === 0) return;
    const batch = await this.repository.claim(this.batchSize, now, budgetId, this.channels);
    for (const delivery of batch) {
      try {
        const outcome = await this.deliver(delivery, now);
        this.hooks.onOutcome?.(delivery.kind, outcome);
      } catch (error) {
        const outcome = await this.handleError(delivery, error, now);
        this.hooks.onOutcome?.(delivery.kind, outcome);
      }
    }
  }

  private async deliver(delivery: ClaimedDelivery, now: Date): Promise<'sent' | 'cancelled'> {
    const sender = this.senders[delivery.channel];
    if (!sender) {
      await this.repository.cancel(delivery.id, 'CHANNEL_UNAVAILABLE');
      return 'cancelled';
    }
    const facts = await loadDeliveryFacts(this.prisma, delivery);
    const reason = cancelReason(delivery.kind, facts, delivery.channel);
    if (reason) {
      await this.repository.cancel(delivery.id, reason);
      return 'cancelled';
    }
    const result = await sender.send(delivery, facts, now);
    if (result.outcome === 'cancelled') {
      await this.repository.cancel(delivery.id, result.reason);
      return 'cancelled';
    }
    await this.markSentAfterSend(delivery.id, now);
    return 'sent';
  }

  private async handleError(
    delivery: ClaimedDelivery,
    error: unknown,
    now: Date,
  ): Promise<DeliveryOutcome> {
    const name = errorName(error);
    if (error instanceof RetryLaterError) {
      await this.repository.postpone(delivery.id, error.retryAt, name);
      return 'retried';
    }
    this.hooks.onFailure?.({ deliveryId: delivery.id, errorName: name });
    if (error instanceof PermanentSendError) {
      await this.repository.fail(delivery.id, name);
      return 'failed';
    }
    const failed = await this.repository.retryOrFail(delivery.id, delivery.attempts, now, name);
    return failed ? 'failed' : 'retried';
  }

  /**
   * The message is already out: a failing status write must not schedule a retry, or the recipient
   * gets a duplicate (and for email the first letter's unsubscribe link is overwritten). One more
   * write is tried; if that fails too, the failure is reported and the row is left to its lease.
   */
  private async markSentAfterSend(id: string, now: Date): Promise<void> {
    try {
      await this.repository.markSent(id, now);
    } catch {
      try {
        await this.repository.markSent(id, now);
      } catch (error) {
        this.hooks.onFailure?.({ deliveryId: id, errorName: errorName(error) });
      }
    }
  }
}
```

Обратите внимание: порядок `onOutcome` и `onFailure` по сравнению со старым кодом поменялся (теперь `onFailure` раньше). Существующие тесты на это не опираются; если какой-то опирается — записать в «Ход выполнения» и поправить ожидание в тесте, не код.

- [ ] **Step 7: Постановка срочных — тест (падает)**

Файл `apps/worker/src/delivery/enqueue.test.ts` заменить целиком:

```ts
import { describe, expect, it, vi } from 'vitest';

import { enqueueUrgent } from './enqueue.js';

type Setting = { enabled: boolean; urgentEnabled: boolean } | null;

function makeTx(settings: { EMAIL?: Setting; TELEGRAM?: Setting }) {
  return {
    notificationChannelSetting: {
      findUnique: vi.fn(
        async ({ where }: { where: { userId_channel: { channel: 'EMAIL' | 'TELEGRAM' } } }) =>
          settings[where.userId_channel.channel] ?? null,
      ),
    },
    notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

const input = {
  notificationId: 'n-1',
  workspaceId: 'w-1',
  budgetId: 'b-1',
  userId: 'u-1',
  now: new Date('2026-11-02T09:00:00.000Z'),
};

describe('enqueueUrgent', () => {
  it('queues nothing when the e-mail channel is off but urgent mail is on', async () => {
    const tx = makeTx({ EMAIL: { enabled: false, urgentEnabled: true } });
    await enqueueUrgent(tx as never, input);
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('queues one row per enabled channel with the same dedupe key', async () => {
    const tx = makeTx({
      EMAIL: { enabled: true, urgentEnabled: true },
      TELEGRAM: { enabled: true, urgentEnabled: true },
    });
    await enqueueUrgent(tx as never, input);
    const rows = tx.notificationDelivery.createMany.mock.calls.map(
      (call) => (call[0] as { data: { channel: string; dedupeKey: string } }).data,
    );
    expect(rows.map((row) => row.channel)).toEqual(['EMAIL', 'TELEGRAM']);
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
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/delivery/enqueue.test.ts`
Expected: FAIL (`enqueueUrgent` не экспортируется).

- [ ] **Step 8: Постановка срочных — реализация**

Файл `apps/worker/src/delivery/enqueue.ts` заменить целиком:

```ts
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import type { DeliveryChannel } from './channel-sender.js';

const URGENT_CHANNELS: readonly DeliveryChannel[] = ['EMAIL', 'TELEGRAM'];

/**
 * Called inside the transaction that has just created the in-app notification, so the message is
 * queued exactly when the notification exists: one row per channel with the channel and urgent
 * messages on. The settings are read here only to avoid queueing messages nobody wants; the sender
 * re-checks everything before sending.
 */
export async function enqueueUrgent(
  tx: Prisma.TransactionClient,
  input: {
    notificationId: string;
    workspaceId: string;
    budgetId: string;
    userId: string;
    now: Date;
  },
): Promise<void> {
  for (const channel of URGENT_CHANNELS) {
    const setting = await tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId: input.userId, channel } },
      select: { enabled: true, urgentEnabled: true },
    });
    if (!setting?.enabled || !setting.urgentEnabled) continue;
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
```

В `apps/worker/src/notification.handler.ts` и `apps/worker/src/calendar-reminder.handler.ts`:
- `import { enqueueUrgentEmail } from './delivery/enqueue.js';` → `import { enqueueUrgent } from './delivery/enqueue.js';`;
- `await enqueueUrgentEmail(tx, {` → `await enqueueUrgent(tx, {`.

В `apps/worker/src/notification.handler.test.ts` (1 место) и `apps/worker/src/calendar-reminder.handler.test.ts` (2 места) заменить **каждое** вхождение блока

```ts
      notificationChannelSetting: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true, urgentEnabled: true }),
      },
```

на

```ts
      notificationChannelSetting: {
        findUnique: vi.fn(async ({ where }: { where: { userId_channel: { channel: string } } }) =>
          where.userId_channel.channel === 'EMAIL' ? { enabled: true, urgentEnabled: true } : null,
        ),
      },
```

(подписан только email, поэтому счётчики `createMany` в этих тестах не меняются).

Run: `pnpm --filter @harmofin/worker test`
Expected: PASS весь воркер.

- [ ] **Step 9: Дайджест по каналам**

В `apps/worker/src/delivery/build-digests.handler.ts`:

1. После `import type { WorkerJobHandler } from '../job-runner.js';` добавить `import type { DeliveryChannel } from './channel-sender.js';`.

2. Строку `constructor(private readonly prisma: PrismaClient) {}` заменить на:

```ts
  constructor(
    private readonly prisma: PrismaClient,
    private readonly channels: readonly DeliveryChannel[] = ['EMAIL'],
  ) {}
```

3. Запрос `const settings = await this.prisma.notificationChannelSetting.findMany({ ... });` заменить целиком на:

```ts
    const reachable = {
      EMAIL: { channel: 'EMAIL' as const, user: { status: 'ACTIVE' as const, emailVerifiedAt: { not: null } } },
      TELEGRAM: { channel: 'TELEGRAM' as const, user: { status: 'ACTIVE' as const, telegramLink: { isNot: null } } },
    };
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

4. В запросе прошлого дайджеста `where: { userId: setting.userId, budgetId: budget.id, kind: 'DIGEST', status: { in: ['SENT', 'CANCELLED'] } }` добавить поле `channel: setting.channel,` (после `budgetId: budget.id,`).

5. В `createMany` строку `channel: 'EMAIL',` заменить на `channel: setting.channel,`.

6. Комментарий класса: первую строку `Queues one digest per user and budget per slot.` заменить на `Queues one digest per user, budget and channel per slot.`

Внимание: `return` при пустых каналах стоит до очистки — это нормально, без каналов воркер эту задачу не регистрирует (задача 6).

- [ ] **Step 10: Wiring в `main.ts` и конструктор в тестах**

В `apps/worker/src/main.ts`:
- после `import { DeliveryRepository } from './delivery/delivery.repository.js';` добавить `import { EmailSender } from './delivery/email-sender.js';`;
- в блоке `DELIVER_NOTIFICATIONS: new DeliverNotificationsHandler(` аргументы

```ts
        database,
        new DeliveryRepository(database),
        new SmtpMailer(config.mail),
        config.mail.webBaseUrl,
        {
```

заменить на

```ts
        database,
        new DeliveryRepository(database),
        {
          EMAIL: new EmailSender(
            database,
            new DeliveryRepository(database),
            new SmtpMailer(config.mail),
            config.mail.webBaseUrl,
          ),
        },
        {
```

(остальное в `main.ts` не трогать — задача 6 перепишет этот блок).

В `apps/api/test/email-delivery.integration.test.ts`:
- после строки `import { DeliverNotificationsHandler } from '../../worker/src/delivery/deliver.handler.js';` добавить `import { EmailSender } from '../../worker/src/delivery/email-sender.js';`;
- `handler` заменить на:

```ts
const handler = () => {
  const repository = new DeliveryRepository(env.prisma);
  return new DeliverNotificationsHandler(env.prisma, repository, {
    EMAIL: new EmailSender(env.prisma, repository, mailer, origin),
  });
};
```

- в тесте «retries a failing letter…» конструктор `broken` заменить на:

```ts
    const brokenRepository = new DeliveryRepository(env.prisma);
    const broken = new DeliverNotificationsHandler(env.prisma, brokenRepository, {
      EMAIL: new EmailSender(
        env.prisma,
        brokenRepository,
        {
          send: async () =>
            Promise.reject(Object.assign(new Error('down'), { code: 'ECONNECTION' })),
        },
        origin,
      ),
    });
```

- в тесте «does not retry a letter that was sent…» три строки

```ts
    const run = new DeliverNotificationsHandler(env.prisma, repository, mailer, origin, {
      onFailure: (failure) => failures.push(failure.deliveryId),
    });
```

  заменить на

```ts
    const run = new DeliverNotificationsHandler(
      env.prisma,
      repository,
      { EMAIL: new EmailSender(env.prisma, repository, mailer, origin) },
      { onFailure: (failure) => failures.push(failure.deliveryId) },
    );
```

- [ ] **Step 11: Интеграционный тест каналов**

Файл `apps/api/test/delivery-channels.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BuildEmailDigestsHandler } from '../../worker/src/delivery/build-digests.handler.js';
import {
  PermanentSendError,
  RetryLaterError,
  type ChannelSender,
} from '../../worker/src/delivery/channel-sender.js';
import { DeliverNotificationsHandler } from '../../worker/src/delivery/deliver.handler.js';
import { DeliveryRepository } from '../../worker/src/delivery/delivery.repository.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let anna: FamilyActor;
const calls: Array<{ channel: string; id: string }> = [];

const recorder = (channel: string): ChannelSender => ({
  send: async (delivery) => {
    calls.push({ channel, id: delivery.id });
    return { outcome: 'sent' };
  },
});

async function enable(channel: 'EMAIL' | 'TELEGRAM') {
  await env.prisma.notificationChannelSetting.upsert({
    where: { userId_channel: { userId: anna.user.id, channel } },
    create: { id: randomUUID(), userId: anna.user.id, channel, enabled: true },
    update: { enabled: true },
  });
}

async function queue(channel: 'EMAIL' | 'TELEGRAM') {
  const id = randomUUID();
  await env.prisma.notificationDelivery.create({
    data: {
      id,
      workspaceId: anna.workspaceId,
      budgetId: anna.budgetId,
      userId: anna.user.id,
      channel,
      kind: 'DIGEST',
      digestPeriodStart: new Date(Date.now() - 86_400_000),
      digestPeriodEnd: new Date(),
      dedupeKey: `test:${id}`,
      nextAttemptAt: new Date(Date.now() - 1_000),
    },
  });
  return id;
}

const row = (id: string) => env.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  await env.prisma.user.update({
    where: { id: anna.user.id },
    data: { emailVerifiedAt: new Date() },
  });
  await env.prisma.budget.update({ where: { id: anna.budgetId }, data: { timezone: 'UTC' } });
  await enable('EMAIL');
  await enable('TELEGRAM');
});

afterAll(async () => {
  await env.stop();
});

beforeEach(async () => {
  calls.length = 0;
  await env.prisma.notificationDelivery.deleteMany({ where: { userId: anna.user.id } });
  await env.prisma.telegramLink.upsert({
    where: { userId: anna.user.id },
    create: {
      id: randomUUID(),
      userId: anna.user.id,
      chatId: BigInt(1_000_000 + Math.floor(Math.random() * 1_000_000_000)),
      consentedAt: new Date(),
      linkedAt: new Date(),
    },
    update: {},
  });
});

describe('DELIVER_NOTIFICATIONS by channel', () => {
  it('hands each row to the sender of its channel', async () => {
    const email = await queue('EMAIL');
    const telegram = await queue('TELEGRAM');
    const repository = new DeliveryRepository(env.prisma);
    await new DeliverNotificationsHandler(env.prisma, repository, {
      EMAIL: recorder('EMAIL'),
      TELEGRAM: recorder('TELEGRAM'),
    }).execute(new Date(), anna.budgetId);
    expect(calls).toEqual(
      expect.arrayContaining([
        { channel: 'EMAIL', id: email },
        { channel: 'TELEGRAM', id: telegram },
      ]),
    );
    expect((await row(email)).status).toBe('SENT');
    expect((await row(telegram)).status).toBe('SENT');
  });

  it('leaves rows of a channel without a sender in the queue', async () => {
    const telegram = await queue('TELEGRAM');
    await new DeliverNotificationsHandler(env.prisma, new DeliveryRepository(env.prisma), {
      EMAIL: recorder('EMAIL'),
    }).execute(new Date(), anna.budgetId);
    expect(await row(telegram)).toMatchObject({ status: 'PENDING', attempts: 0 });
  });

  it('cancels a telegram row when the chat is no longer linked', async () => {
    await env.prisma.telegramLink.deleteMany({ where: { userId: anna.user.id } });
    const telegram = await queue('TELEGRAM');
    await new DeliverNotificationsHandler(env.prisma, new DeliveryRepository(env.prisma), {
      TELEGRAM: recorder('TELEGRAM'),
    }).execute(new Date(), anna.budgetId);
    expect(await row(telegram)).toMatchObject({
      status: 'CANCELLED',
      lastError: 'TELEGRAM_NOT_LINKED',
    });
    expect(calls).toHaveLength(0);
  });

  it('postpones without spending an attempt on RetryLaterError', async () => {
    const telegram = await queue('TELEGRAM');
    const retryAt = new Date(Date.now() + 30_000);
    await new DeliverNotificationsHandler(env.prisma, new DeliveryRepository(env.prisma), {
      TELEGRAM: { send: async () => Promise.reject(new RetryLaterError(retryAt, 'TELEGRAM_429')) },
    }).execute(new Date(), anna.budgetId);
    expect(await row(telegram)).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: retryAt,
      lastError: 'TELEGRAM_429',
    });
  });

  it('fails at once on PermanentSendError', async () => {
    const telegram = await queue('TELEGRAM');
    await new DeliverNotificationsHandler(env.prisma, new DeliveryRepository(env.prisma), {
      TELEGRAM: { send: async () => Promise.reject(new PermanentSendError('TELEGRAM_400')) },
    }).execute(new Date(), anna.budgetId);
    expect(await row(telegram)).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastError: 'TELEGRAM_400',
    });
  });
});

describe('BUILD_EMAIL_DIGESTS by channel', () => {
  // 2026-11-02 is a Monday; 09:00 UTC is inside the 08:00–11:59 slot of a UTC budget.
  const mondayMorning = new Date('2026-11-02T09:00:00.000Z');
  const digests = () =>
    env.prisma.notificationDelivery.findMany({
      where: { userId: anna.user.id, kind: 'DIGEST' },
      select: { channel: true, dedupeKey: true },
      orderBy: { channel: 'asc' },
    });

  it('queues one digest per channel with the same dedupe key', async () => {
    await new BuildEmailDigestsHandler(env.prisma, ['EMAIL', 'TELEGRAM']).execute(
      mondayMorning,
      anna.budgetId,
    );
    expect(await digests()).toEqual([
      { channel: 'EMAIL', dedupeKey: 'digest:DAILY:2026-11-02' },
      { channel: 'TELEGRAM', dedupeKey: 'digest:DAILY:2026-11-02' },
    ]);
  });

  it('skips telegram without a linked chat and keeps the default email-only mode', async () => {
    await env.prisma.telegramLink.deleteMany({ where: { userId: anna.user.id } });
    await new BuildEmailDigestsHandler(env.prisma, ['EMAIL', 'TELEGRAM']).execute(
      mondayMorning,
      anna.budgetId,
    );
    expect((await digests()).map((digest) => digest.channel)).toEqual(['EMAIL']);

    await env.prisma.notificationDelivery.deleteMany({ where: { userId: anna.user.id } });
    await new BuildEmailDigestsHandler(env.prisma).execute(mondayMorning, anna.budgetId);
    expect((await digests()).map((digest) => digest.channel)).toEqual(['EMAIL']);
  });
});
```

Run: `pnpm test:integration`
Expected: PASS весь набор, включая `email-delivery`, `email-digest` и новый `delivery-channels`.

- [ ] **Step 12: Общие проверки**

Run: `pnpm --filter @harmofin/worker test && pnpm typecheck && pnpm lint`
Expected: PASS, 0 errors.
Run: `pnpm exec prettier --check apps/worker apps/api/test`
Expected: PASS (иначе `pnpm exec prettier --write` по изменённым файлам).

- [ ] **Step 13: Review по чек-листу**

`git add apps/worker/src apps/api/test/email-delivery.integration.test.ts apps/api/test/delivery-channels.integration.test.ts` и `git diff --staged`:

- backend: SQL `claim` по-прежнему `FOR UPDATE SKIP LOCKED`, фильтр каналов параметризован (`Prisma.join`), без конкатенации строк; `postpone` возвращает попытку; переходы статусов только из `PENDING`.
- security: перепроверка перед отправкой для `TELEGRAM` требует привязки; для `EMAIL` — подтверждённого адреса, как раньше; поиск прошлого дайджеста теперь учитывает канал; в `last_error` только коды.
- QA: все прежние тесты почты зелёные без изменения ожиданий; новые тесты — маршрутизация по каналу, канал без отправителя, отмена без привязки, 429-подобная отсрочка, постоянная ошибка, дайджест по двум каналам.
- final: поведение email не изменилось; нет Telegram-кода отправки (это задача 6).

- [ ] **Step 14: Commit**

```bash
git branch --show-current
git commit -m "refactor(delivery): очередь уведомлений по каналам и отправитель email"
```

Добавить строку в «Ход выполнения» README.
