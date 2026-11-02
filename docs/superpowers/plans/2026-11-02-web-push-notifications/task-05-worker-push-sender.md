# Задача 5: воркер — отправка push

Перед началом: прочитать [README](README.md). Задачи 1–4 закоммичены.

**Files:**
- Modify: `apps/worker/package.json`, `pnpm-lock.yaml` — зависимость `web-push`, devDependency `@types/web-push`.
- Modify: `apps/worker/src/config.ts` — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, поле `push`.
- Create: `apps/worker/src/config.push.test.ts`
- Create: `apps/worker/src/push/payload.ts`, `apps/worker/src/push/payload.test.ts`
- Create: `apps/worker/src/push/summary.ts`, `apps/worker/src/push/summary.test.ts`
- Create: `apps/worker/src/push/web-push-transport.ts`, `apps/worker/src/push/web-push-transport.test.ts`
- Create: `apps/worker/src/push/push-sender.ts`
- Modify: `apps/worker/src/main.ts` — отправитель `PUSH`, каналы дайджеста.
- Create: `apps/api/test/push-delivery.integration.test.ts`

**Interfaces:**
- Consumes (задача 4): `DeliveryChannel` (с `'PUSH'`), `DigestChannel`; `activeSessionWhere(now)`, `removePushSubscriptions(prisma, ids, reason)` из `push/subscriptions.ts`; `cancelReason` с `TYPE_DISABLED`.
- Consumes (существующее): `ChannelSender`, `SendResult`, `RetryLaterError(retryAt, code)`, `PermanentSendError(code)` из `delivery/channel-sender.ts`; `ClaimedDelivery`, `DeliveryRepository`; `DeliveryFacts`; `DeliverNotificationsHandler(prisma, repository, senders, hooks?, batchSize?)`; `loadUrgentContent(prisma, delivery, includeAmounts)` из `delivery/urgent-content.ts`; тип `UrgentContent = { subject: string; lines: string[]; actionPath: string }` из `mail/templates.ts`.
- Consumes (задачи 3–4, тесты): `vapidPublicKey`, `addSubscription`, `currentSessionId`, `revokedSessionId`, `overdueNotification` из `apps/api/test/helpers/push.ts`.
- Produces (использует задача 8): переменные воркера `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — все три или ни одной.

---

- [ ] **Step 1: Зависимость**

```bash
pnpm view web-push version
pnpm view @types/web-push version
```

Ожидается мажорная версия 3 для обоих пакетов. Если мажорная версия другая, остановиться и спросить владельца. Подставить выведенные версии (в примере 3.6.7 и 3.6.4):

```bash
pnpm --filter @harmofin/worker add --save-exact web-push@3.6.7
pnpm --filter @harmofin/worker add --save-exact -D @types/web-push@3.6.4
```

Expected: в `apps/worker/package.json` появились `"web-push": "3.6.7"` в `dependencies` и `"@types/web-push": "3.6.4"` в `devDependencies`, обновился `pnpm-lock.yaml`. Других изменений в `package.json` нет.

- [ ] **Step 2: Тест конфига (падает)**

Файл `apps/worker/src/config.push.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { loadWorkerConfig } from './config.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
};
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
const privateKey = Buffer.alloc(32, 9).toString('base64url');
const vapid = {
  VAPID_PUBLIC_KEY: publicKey,
  VAPID_PRIVATE_KEY: privateKey,
  VAPID_SUBJECT: 'mailto:admin@harmofin.example',
};

describe('loadWorkerConfig push', () => {
  it('has no push without VAPID variables', () => {
    expect(loadWorkerConfig(base).push).toBeUndefined();
    expect(
      loadWorkerConfig({ ...base, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' })
        .push,
    ).toBeUndefined();
  });

  it('maps all three variables', () => {
    expect(loadWorkerConfig({ ...base, ...vapid }).push).toEqual({
      publicKey,
      privateKey,
      subject: 'mailto:admin@harmofin.example',
    });
    expect(
      loadWorkerConfig({ ...base, ...vapid, VAPID_SUBJECT: 'https://harmofin.example' }).push
        ?.subject,
    ).toBe('https://harmofin.example');
  });

  it('requires the three variables together', () => {
    expect(() => loadWorkerConfig({ ...base, VAPID_PUBLIC_KEY: publicKey })).toThrow(
      /VAPID_PRIVATE_KEY, VAPID_SUBJECT/,
    );
  });

  it('rejects malformed values without echoing them', () => {
    const bad = { ...base, ...vapid, VAPID_PRIVATE_KEY: 'short-secret', VAPID_SUBJECT: 'admin' };
    expect(() => loadWorkerConfig(bad)).toThrow(/VAPID_PRIVATE_KEY, VAPID_SUBJECT/);
    try {
      loadWorkerConfig(bad);
    } catch (error) {
      expect(String(error)).not.toContain('short-secret');
    }
    expect(() => loadWorkerConfig({ ...base, ...vapid, VAPID_PUBLIC_KEY: 'abc' })).toThrow(
      /VAPID_PUBLIC_KEY/,
    );
  });
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/config.push.test.ts`
Expected: FAIL.

- [ ] **Step 3: Конфиг воркера**

В `apps/worker/src/config.ts`:

1. В `workerEnvironmentSchema` после строки `TELEGRAM_API_BASE_URL: httpUrl.default('https://api.telegram.org'),` добавить:

```ts
  VAPID_PUBLIC_KEY: optionalNonEmpty,
  VAPID_PRIVATE_KEY: optionalNonEmpty,
  VAPID_SUBJECT: optionalNonEmpty,
```

2. После `interface WorkerTelegramConfig { ... }` добавить:

```ts
export interface WorkerPushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}
```

3. В `interface WorkerConfig` после строки `telegram: WorkerTelegramConfig | undefined;` добавить `push: WorkerPushConfig | undefined;`.

4. В `return { ... }` функции `loadWorkerConfig` после строки `telegram: telegramConfig(result.data),` добавить `push: pushConfig(result.data),`.

5. В конец файла добавить:

```ts
/**
 * Push is optional: without the VAPID key pair the worker sends no pushes and PUSH rows wait in
 * the queue. The private key never leaves the worker; errors name variables, never values.
 */
function pushConfig(data: z.infer<typeof workerEnvironmentSchema>): WorkerPushConfig | undefined {
  const values = [
    ['VAPID_PUBLIC_KEY', data.VAPID_PUBLIC_KEY],
    ['VAPID_PRIVATE_KEY', data.VAPID_PRIVATE_KEY],
    ['VAPID_SUBJECT', data.VAPID_SUBJECT],
  ] as const;
  const missing = values.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length === values.length) return undefined;
  if (missing.length > 0) throw new Error(`Invalid worker configuration: ${missing.join(', ')}`);
  const publicKey = data.VAPID_PUBLIC_KEY!;
  const privateKey = data.VAPID_PRIVATE_KEY!;
  const subject = data.VAPID_SUBJECT!;
  const invalid = [
    /^[A-Za-z0-9_-]{87}$/.test(publicKey) && Buffer.from(publicKey, 'base64url')[0] === 4
      ? null
      : 'VAPID_PUBLIC_KEY',
    /^[A-Za-z0-9_-]{43}$/.test(privateKey) ? null : 'VAPID_PRIVATE_KEY',
    /^(mailto:|https:\/\/)\S+$/.test(subject) ? null : 'VAPID_SUBJECT',
  ].filter((name): name is string => name !== null);
  if (invalid.length > 0) throw new Error(`Invalid worker configuration: ${invalid.join(', ')}`);
  return { publicKey, privateKey, subject };
}
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/config.push.test.ts src/config.test.ts src/config.telegram.test.ts`
Expected: PASS.

- [ ] **Step 4: Тест payload (падает)**

Файл `apps/worker/src/push/payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pushTopic, renderPushPayload } from './payload.js';

const id = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';

describe('renderPushPayload', () => {
  it('builds title, body, path and a tag from the urgent content', () => {
    expect(
      renderPushPayload(
        {
          subject: 'Просрочен платёж «Ипотека»',
          lines: ['План «Ипотека» просрочен с 2026-10-25.'],
          actionPath: '/app/plans?occurrence=1',
        },
        id,
      ),
    ).toEqual({
      title: 'Просрочен платёж «Ипотека»',
      body: 'План «Ипотека» просрочен с 2026-10-25.',
      path: '/app/plans?occurrence=1',
      tag: `notification:${id}`,
    });
  });

  it('cuts a long body to 200 characters', () => {
    const payload = renderPushPayload(
      { subject: 'Напоминание: «Собрание»', lines: ['а'.repeat(500)], actionPath: '/app' },
      id,
    );
    expect(payload.body).toHaveLength(200);
    expect(payload.body.endsWith('…')).toBe(true);
  });

  it('stays well under the 4 KB push limit', () => {
    const payload = renderPushPayload(
      { subject: 'я'.repeat(300), lines: ['я'.repeat(500)], actionPath: '/app/notifications' },
      id,
    );
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(3_000);
  });
});

describe('pushTopic', () => {
  it('is the id without dashes, 32 URL-safe characters', () => {
    expect(pushTopic(id)).toBe('0192f3a45b6c7d8e9f0123456789abcd');
    expect(pushTopic(id)).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/push/payload.test.ts`
Expected: FAIL (`Cannot find module './payload.js'`).

- [ ] **Step 5: Payload**

Файл `apps/worker/src/push/payload.ts`:

```ts
import type { UrgentContent } from '../mail/templates.js';

/** What the service worker reads in its `push` handler (apps/web/public/sw.js). */
export type PushPayload = { title: string; body: string; path: string; tag: string };

const MAX_BODY = 200;
const MAX_TITLE = 120;

function cut(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/** Built from the urgent content without amounts; the tag makes a retried push replace the first. */
export function renderPushPayload(content: UrgentContent, notificationId: string): PushPayload {
  return {
    title: cut(content.subject, MAX_TITLE),
    body: cut(content.lines.join(' '), MAX_BODY),
    path: content.actionPath,
    tag: `notification:${notificationId}`,
  };
}

/** Topic header: up to 32 URL-safe characters; the push service keeps only the latest per topic. */
export function pushTopic(notificationId: string): string {
  return notificationId.replaceAll('-', '').slice(0, 32);
}
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/push/payload.test.ts`
Expected: PASS.

- [ ] **Step 6: Тест итога по устройствам (падает)**

Файл `apps/worker/src/push/summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { summarizePush } from './summary.js';

const now = new Date('2026-11-02T09:00:00.000Z');
const ok = { status: 201, retryAfterSeconds: null };

describe('summarizePush', () => {
  it('counts delivered devices', () => {
    expect(
      summarizePush(
        [
          { id: 'a', result: ok },
          { id: 'b', result: { status: 200, retryAfterSeconds: null } },
        ],
        now,
      ),
    ).toEqual({ delivered: ['a', 'b'], gone: [], transient: null, permanent: null, retryAt: null });
  });

  it('marks 404, 410 and 403 as gone', () => {
    const summary = summarizePush(
      [404, 410, 403].map((status, index) => ({
        id: String(index),
        result: { status, retryAfterSeconds: null },
      })),
      now,
    );
    expect(summary.gone).toEqual(['0', '1', '2']);
    expect(summary.delivered).toEqual([]);
  });

  it('waits for the latest Retry-After of 429 answers, 60 seconds by default', () => {
    const summary = summarizePush(
      [
        { id: 'a', result: { status: 429, retryAfterSeconds: 120 } },
        { id: 'b', result: { status: 429, retryAfterSeconds: null } },
      ],
      now,
    );
    expect(summary.retryAt).toEqual(new Date(now.getTime() + 120_000));
  });

  it('treats 5xx and network errors as transient and other 4xx as permanent', () => {
    expect(
      summarizePush([{ id: 'a', result: { status: 503, retryAfterSeconds: null } }], now).transient,
    ).toBe('PUSH_503');
    expect(summarizePush([{ id: 'a', result: 'network' }], now).transient).toBe('PUSH_NETWORK');
    expect(
      summarizePush([{ id: 'a', result: { status: 413, retryAfterSeconds: null } }], now).permanent,
    ).toBe('PUSH_413');
  });
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/push/summary.test.ts`
Expected: FAIL.

- [ ] **Step 7: Итог по устройствам**

Файл `apps/worker/src/push/summary.ts`:

```ts
export type PushTransportResult = { status: number; retryAfterSeconds: number | null };

export type DeviceOutcome = { id: string; result: PushTransportResult | 'network' };

export type PushSummary = {
  delivered: string[];
  gone: string[];
  transient: string | null;
  permanent: string | null;
  retryAt: Date | null;
};

const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * Sorts the push service answers per device: 2xx delivered; 404/410 (expired) and 403 (VAPID key
 * mismatch) gone; 429 wait for Retry-After; 5xx or network transient; other 4xx permanent.
 */
export function summarizePush(outcomes: readonly DeviceOutcome[], now: Date): PushSummary {
  const summary: PushSummary = {
    delivered: [],
    gone: [],
    transient: null,
    permanent: null,
    retryAt: null,
  };
  for (const { id, result } of outcomes) {
    if (result === 'network') {
      summary.transient = 'PUSH_NETWORK';
      continue;
    }
    const { status } = result;
    if (status >= 200 && status < 300) {
      summary.delivered.push(id);
    } else if (status === 404 || status === 410 || status === 403) {
      summary.gone.push(id);
    } else if (status === 429) {
      const seconds = result.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
      const at = new Date(now.getTime() + seconds * 1_000);
      if (!summary.retryAt || at > summary.retryAt) summary.retryAt = at;
    } else if (status >= 500) {
      summary.transient = `PUSH_${status}`;
    } else {
      summary.permanent = `PUSH_${status}`;
    }
  }
  return summary;
}
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/push/summary.test.ts`
Expected: PASS.

- [ ] **Step 8: Тест транспорта (падает)**

Файл `apps/worker/src/push/web-push-transport.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.hoisted(() => vi.fn());
vi.mock('web-push', () => ({ default: { sendNotification } }));

import { retryAfterSeconds, WebPushTransport } from './web-push-transport.js';

const vapid = {
  publicKey: 'public-key',
  privateKey: 'private-key',
  subject: 'mailto:admin@harmofin.example',
};
const target = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/x',
  keys: { p256dh: 'p', auth: 'a' },
};
const options = { ttlSeconds: 43_200, topic: 'topic' };

describe('WebPushTransport', () => {
  beforeEach(() => {
    sendNotification.mockReset();
  });

  it('sends with VAPID, TTL, urgency, topic and a timeout', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    await expect(new WebPushTransport(vapid).send(target, '{}', options)).resolves.toEqual({
      status: 201,
      retryAfterSeconds: null,
    });
    expect(sendNotification).toHaveBeenCalledWith(target, '{}', {
      vapidDetails: {
        subject: 'mailto:admin@harmofin.example',
        publicKey: 'public-key',
        privateKey: 'private-key',
      },
      TTL: 43_200,
      urgency: 'high',
      topic: 'topic',
      timeout: 10_000,
    });
  });

  it('turns a push service error into its status and Retry-After', async () => {
    sendNotification.mockRejectedValue(
      Object.assign(new Error('Received unexpected response code'), {
        statusCode: 429,
        headers: { 'retry-after': '30' },
        body: '',
      }),
    );
    await expect(new WebPushTransport(vapid).send(target, '{}', options)).resolves.toEqual({
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it('reports a network failure without the endpoint or keys', async () => {
    sendNotification.mockRejectedValue(new Error(`connect ECONNREFUSED ${target.endpoint}`));
    const error = await new WebPushTransport(vapid).send(target, '{}', options).catch((e) => e);
    expect(error).toMatchObject({ code: 'PUSH_NETWORK' });
    expect(String(error.message)).not.toContain('fcm.googleapis.com');
  });
});

describe('retryAfterSeconds', () => {
  it('reads seconds and HTTP dates', () => {
    const now = Date.parse('2026-11-02T09:00:00.000Z');
    expect(retryAfterSeconds('120', now)).toBe(120);
    expect(retryAfterSeconds('Mon, 02 Nov 2026 09:01:00 GMT', now)).toBe(60);
    expect(retryAfterSeconds(undefined, now)).toBeNull();
    expect(retryAfterSeconds('soon', now)).toBeNull();
  });
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/push/web-push-transport.test.ts`
Expected: FAIL.

- [ ] **Step 9: Транспорт**

Файл `apps/worker/src/push/web-push-transport.ts`:

```ts
import webpush from 'web-push';

import type { WorkerPushConfig } from '../config.js';
import type { PushTransportResult } from './summary.js';

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushSendOptions = { ttlSeconds: number; topic: string };

export interface PushTransport {
  send(target: PushTarget, payload: string, options: PushSendOptions): Promise<PushTransportResult>;
}

const TIMEOUT_MS = 10_000;

/** Retry-After is either seconds or an HTTP date. */
export function retryAfterSeconds(value: unknown, now = Date.now()): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1_000));
}

/**
 * Encrypts the payload for the device (RFC 8291) and signs the request with VAPID (RFC 8292) via
 * the web-push package. A push service answer becomes a status; anything else is a network error
 * whose message never carries the endpoint or keys.
 */
export class WebPushTransport implements PushTransport {
  constructor(private readonly vapid: WorkerPushConfig) {}

  async send(
    target: PushTarget,
    payload: string,
    options: PushSendOptions,
  ): Promise<PushTransportResult> {
    try {
      const response = await webpush.sendNotification(target, payload, {
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
        TTL: options.ttlSeconds,
        urgency: 'high',
        topic: options.topic,
        timeout: TIMEOUT_MS,
      });
      return { status: response.statusCode, retryAfterSeconds: null };
    } catch (error) {
      const status = (error as { statusCode?: unknown } | null)?.statusCode;
      if (typeof status === 'number') {
        const headers = (error as { headers?: Record<string, unknown> }).headers ?? {};
        return { status, retryAfterSeconds: retryAfterSeconds(headers['retry-after']) };
      }
      throw Object.assign(new Error('Push network error'), { code: 'PUSH_NETWORK' });
    }
  }
}
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/push/web-push-transport.test.ts`
Expected: PASS.

Run: `pnpm --filter @harmofin/worker typecheck`
Expected: PASS. Если TypeScript не принимает `import webpush from 'web-push'` (нет default export), заменить на `import * as webpush from 'web-push';`, а в тесте — `vi.mock('web-push', () => ({ sendNotification, default: { sendNotification } }))`. Записать это в «Ход выполнения».

- [ ] **Step 10: Отправитель**

Файл `apps/worker/src/push/push-sender.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

import {
  PermanentSendError,
  RetryLaterError,
  type ChannelSender,
  type SendResult,
} from '../delivery/channel-sender.js';
import type { ClaimedDelivery } from '../delivery/delivery.repository.js';
import type { DeliveryFacts } from '../delivery/eligibility.js';
import { loadUrgentContent } from '../delivery/urgent-content.js';
import { pushTopic, renderPushPayload } from './payload.js';
import { activeSessionWhere, removePushSubscriptions } from './subscriptions.js';
import { summarizePush, type DeviceOutcome } from './summary.js';
import type { PushTransport } from './web-push-transport.js';

const TTL_SECONDS = 43_200;

/**
 * One urgent notification to every device of the user's active sessions, never with amounts.
 * Devices subscribed with another VAPID key, or answered 404/410/403, are removed. Any transient
 * failure retries the whole row: a retried push carries the same tag, so a device that already
 * shows it replaces it silently.
 */
export class PushSender implements ChannelSender {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly transport: PushTransport,
    private readonly vapidPublicKey: string,
  ) {}

  async send(delivery: ClaimedDelivery, _facts: DeliveryFacts, now: Date): Promise<SendResult> {
    if (delivery.kind !== 'URGENT' || !delivery.notificationId) {
      return { outcome: 'cancelled', reason: 'DIGEST_DISABLED' };
    }
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: delivery.userId, session: activeSessionWhere(now) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, endpoint: true, p256dh: true, auth: true, applicationServerKey: true },
    });
    await removePushSubscriptions(
      this.prisma,
      subscriptions.filter((row) => row.applicationServerKey !== this.vapidPublicKey).map((row) => row.id),
      'key',
    );
    const targets = subscriptions.filter((row) => row.applicationServerKey === this.vapidPublicKey);
    if (targets.length === 0) return { outcome: 'cancelled', reason: 'PUSH_NO_DEVICES' };

    const content = await loadUrgentContent(this.prisma, delivery, false);
    if (!content) return { outcome: 'cancelled', reason: 'NOTIFICATION_MISSING' };
    const payload = JSON.stringify(renderPushPayload(content, delivery.notificationId));
    const options = { ttlSeconds: TTL_SECONDS, topic: pushTopic(delivery.notificationId) };

    const outcomes: DeviceOutcome[] = [];
    for (const target of targets) {
      try {
        const result = await this.transport.send(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          options,
        );
        outcomes.push({ id: target.id, result });
      } catch {
        outcomes.push({ id: target.id, result: 'network' });
      }
    }
    const summary = summarizePush(outcomes, now);
    if (summary.delivered.length > 0) {
      await this.prisma.pushSubscription.updateMany({
        where: { id: { in: summary.delivered } },
        data: { lastSuccessAt: now },
      });
    }
    await removePushSubscriptions(this.prisma, summary.gone, 'gone');

    if (summary.transient) {
      throw Object.assign(new Error('Push service error'), { code: summary.transient });
    }
    if (summary.retryAt) throw new RetryLaterError(summary.retryAt, 'PUSH_429');
    if (summary.delivered.length > 0) return { outcome: 'sent' };
    if (summary.permanent) throw new PermanentSendError(summary.permanent);
    return { outcome: 'cancelled', reason: 'PUSH_NO_DEVICES' };
  }
}
```

- [ ] **Step 11: Wiring в `main.ts`**

В `apps/worker/src/main.ts`:

1. После строки `import { TelegramSender } from './telegram/telegram-sender.js';` добавить:

```ts
import { PushSender } from './push/push-sender.js';
import { WebPushTransport } from './push/web-push-transport.js';
```

2. В объекте `senders` после блока `...(config.telegram ? { TELEGRAM: ... } : {}),` добавить:

```ts
  ...(config.push
    ? {
        PUSH: new PushSender(database, new WebPushTransport(config.push), config.push.publicKey),
      }
    : {}),
```

3. Заменить строку

```ts
const deliveryChannels = (['EMAIL', 'TELEGRAM'] as const).filter((channel) => senders[channel]);
```

на

```ts
const deliveryChannels = (['EMAIL', 'TELEGRAM', 'PUSH'] as const).filter(
  (channel) => senders[channel],
);
// Push has no digest; the digest job still runs for its cleanup of push devices.
const digestChannels = (['EMAIL', 'TELEGRAM'] as const).filter((channel) => senders[channel]);
```

4. Заменить `BUILD_EMAIL_DIGESTS: new BuildEmailDigestsHandler(database, deliveryChannels),` на `BUILD_EMAIL_DIGESTS: new BuildEmailDigestsHandler(database, digestChannels),`.

Run: `pnpm --filter @harmofin/worker typecheck`
Expected: PASS.

- [ ] **Step 12: Интеграционный тест отправки**

Файл `apps/api/test/push-delivery.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeliverNotificationsHandler } from '../../worker/src/delivery/deliver.handler.js';
import { DeliveryRepository } from '../../worker/src/delivery/delivery.repository.js';
import { PushSender } from '../../worker/src/push/push-sender.js';
import type { PushTransportResult } from '../../worker/src/push/summary.js';
import type { PushSendOptions, PushTarget } from '../../worker/src/push/web-push-transport.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';
import {
  addSubscription,
  currentSessionId,
  overdueNotification,
  revokedSessionId,
  vapidPublicKey,
} from './helpers/push.js';

const env = new FamilyTestApp();
const sent: Array<{ target: PushTarget; payload: string; options: PushSendOptions }> = [];
const answers = new Map<string, PushTransportResult>();
const transport = {
  send: async (target: PushTarget, payload: string, options: PushSendOptions) => {
    sent.push({ target, payload, options });
    return answers.get(target.endpoint) ?? { status: 201, retryAfterSeconds: null };
  },
};
let anna: FamilyActor;
let sessionId: string;

const handler = () =>
  new DeliverNotificationsHandler(env.prisma, new DeliveryRepository(env.prisma), {
    PUSH: new PushSender(env.prisma, transport, vapidPublicKey),
  });

async function pushSetting(planOverdueEnabled = true) {
  await env.prisma.notificationChannelSetting.create({
    data: {
      id: randomUUID(),
      userId: anna.user.id,
      channel: 'PUSH',
      enabled: true,
      digestFrequency: 'OFF',
      planOverdueEnabled,
    },
  });
}

async function queuePush(): Promise<{ id: string; occurrenceId: string; notificationId: string }> {
  const { notificationId, occurrenceId } = await overdueNotification(env.prisma, anna);
  const id = randomUUID();
  await env.prisma.notificationDelivery.create({
    data: {
      id,
      workspaceId: anna.workspaceId,
      budgetId: anna.budgetId,
      userId: anna.user.id,
      channel: 'PUSH',
      kind: 'URGENT',
      notificationId,
      dedupeKey: `urgent:${notificationId}`,
      nextAttemptAt: new Date(Date.now() - 1_000),
    },
  });
  return { id, occurrenceId, notificationId };
}

const row = (id: string) => env.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  sessionId = await currentSessionId(env.prisma, anna.user.id);
});

afterAll(async () => {
  await env.stop();
});

beforeEach(async () => {
  sent.length = 0;
  answers.clear();
  await env.prisma.notificationDelivery.deleteMany({ where: { userId: anna.user.id } });
  await env.prisma.pushSubscription.deleteMany({ where: { userId: anna.user.id } });
  await env.prisma.notificationChannelSetting.deleteMany({ where: { userId: anna.user.id } });
});

describe('PushSender', () => {
  it('sends the overdue push without amounts to every active device', async () => {
    await pushSetting();
    const phone = await addSubscription(env.prisma, { userId: anna.user.id, sessionId });
    const laptop = await addSubscription(env.prisma, { userId: anna.user.id, sessionId });
    const queued = await queuePush();

    await handler().execute(new Date(), anna.budgetId);

    expect(sent.map((item) => item.target.endpoint).sort()).toEqual(
      [phone.endpoint, laptop.endpoint].sort(),
    );
    expect(JSON.parse(sent[0]!.payload)).toEqual({
      title: 'Просрочен платёж «Ипотека»',
      body: 'План «Ипотека» просрочен с 2026-10-25.',
      path: `/app/plans?occurrence=${queued.occurrenceId}`,
      tag: `notification:${queued.notificationId}`,
    });
    expect(sent[0]!.payload).not.toMatch(/45\s?000/);
    expect(sent[0]!.options).toEqual({
      ttlSeconds: 43_200,
      topic: queued.notificationId.replaceAll('-', ''),
    });
    expect(await row(queued.id)).toMatchObject({ status: 'SENT' });
    const device = await env.prisma.pushSubscription.findUniqueOrThrow({ where: { id: phone.id } });
    expect(device.lastSuccessAt).not.toBeNull();
  });

  it('removes a gone device and switches the channel off when none is left', async () => {
    await pushSetting();
    const phone = await addSubscription(env.prisma, { userId: anna.user.id, sessionId });
    answers.set(phone.endpoint, { status: 410, retryAfterSeconds: null });
    const queued = await queuePush();

    await handler().execute(new Date(), anna.budgetId);

    expect(await env.prisma.pushSubscription.findUnique({ where: { id: phone.id } })).toBeNull();
    expect(await row(queued.id)).toMatchObject({ status: 'CANCELLED', lastError: 'PUSH_NO_DEVICES' });
    const setting = await env.prisma.notificationChannelSetting.findFirstOrThrow({
      where: { userId: anna.user.id, channel: 'PUSH' },
    });
    expect(setting.enabled).toBe(false);
    const audit = await env.prisma.auditEvent.findFirst({
      where: { entityId: phone.id, action: 'PUSH_UNSUBSCRIBED' },
    });
    expect(audit?.newValues).toEqual({ reason: 'gone' });
  });

  it('skips devices of revoked sessions', async () => {
    await pushSetting();
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await revokedSessionId(env.prisma, anna.user.id),
    });
    const queued = await queuePush();

    await handler().execute(new Date(), anna.budgetId);

    expect(sent).toHaveLength(0);
    expect(await row(queued.id)).toMatchObject({ status: 'CANCELLED', lastError: 'PUSH_NO_DEVICES' });
  });

  it('cancels when the type is switched off', async () => {
    await pushSetting(false);
    await addSubscription(env.prisma, { userId: anna.user.id, sessionId });
    const queued = await queuePush();

    await handler().execute(new Date(), anna.budgetId);

    expect(sent).toHaveLength(0);
    expect(await row(queued.id)).toMatchObject({ status: 'CANCELLED', lastError: 'TYPE_DISABLED' });
  });

  it('retries on a server error and waits for Retry-After on 429', async () => {
    await pushSetting();
    const phone = await addSubscription(env.prisma, { userId: anna.user.id, sessionId });
    answers.set(phone.endpoint, { status: 503, retryAfterSeconds: null });
    const failing = await queuePush();
    const startedAt = Date.now();

    await handler().execute(new Date(), anna.budgetId);
    expect(await row(failing.id)).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastError: 'PUSH_503',
    });

    await env.prisma.notificationDelivery.deleteMany({ where: { userId: anna.user.id } });
    answers.set(phone.endpoint, { status: 429, retryAfterSeconds: 120 });
    const limited = await queuePush();
    await handler().execute(new Date(), anna.budgetId);
    const postponed = await row(limited.id);
    expect(postponed).toMatchObject({ status: 'PENDING', attempts: 0, lastError: 'PUSH_429' });
    expect(postponed.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(startedAt + 119_000);
  });

  it('removes devices subscribed with another VAPID key without sending to them', async () => {
    await pushSetting();
    const stale = await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId,
      applicationServerKey: 'old-key',
    });
    const current = await addSubscription(env.prisma, { userId: anna.user.id, sessionId });
    const queued = await queuePush();

    await handler().execute(new Date(), anna.budgetId);

    expect(sent.map((item) => item.target.endpoint)).toEqual([current.endpoint]);
    expect(await env.prisma.pushSubscription.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await row(queued.id)).toMatchObject({ status: 'SENT' });
  });
});
```

Run: `pnpm test:integration`
Expected: PASS, включая `push-delivery.integration.test.ts` (6 тестов).

- [ ] **Step 13: Прогнать проверки**

Run: `pnpm --filter @harmofin/worker test`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, 0 errors.

Run: `pnpm exec prettier --write apps/worker/src/config.ts apps/worker/src/config.push.test.ts apps/worker/src/push apps/worker/src/main.ts apps/api/test/push-delivery.integration.test.ts`
Если prettier что-то поменял, повторить `pnpm --filter @harmofin/worker test`.

Run: `pnpm --filter @harmofin/worker build`
Expected: PASS (сборка воркера с `web-push`).

- [ ] **Step 14: Review по чек-листу**

```bash
git add apps/worker/package.json pnpm-lock.yaml apps/worker/src/config.ts apps/worker/src/config.push.test.ts apps/worker/src/push apps/worker/src/main.ts apps/api/test/push-delivery.integration.test.ts
git diff --staged
```

Чек-лист:

- security:
  - приватный ключ есть только в конфиге воркера и не попадает в ошибки;
  - `last_error` содержит только `PUSH_<код>` или `PUSH_NETWORK`;
  - сетевая ошибка не несёт endpoint;
  - payload собирается с `includeAmounts = false`;
  - отправка идёт только на устройства активных сессий с текущим VAPID-ключом.
- backend:
  - итог записи соответствует таблице дизайна: временный сбой → повтор, 429 → `RetryLaterError`, доставлено → `SENT`, постоянная ошибка → `FAILED`, нет устройств → `CANCELLED`;
  - `lastSuccessAt` обновляется;
  - дайджест не строится для `PUSH`.
- QA: юниты покрывают конфиг, payload, итог и транспорт; интеграция покрывает два устройства, 410, отозванную сессию, выключенный тип, 503, 429 и старый ключ.
- final: новых зависимостей, кроме `web-push` и `@types/web-push`, нет; только файлы из списка Files.

- [ ] **Step 15: Commit**

```bash
git branch --show-current
git commit -m "feat(push): отправка push через web-push в воркере"
```

Строку в «Ход выполнения» — как в README.
