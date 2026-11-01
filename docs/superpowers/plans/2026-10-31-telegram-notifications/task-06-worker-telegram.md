# Задача 6: воркер — отправка в Telegram

Перед началом: прочитать [README](README.md). Задачи 1–5 закоммичены.

**Files:**
- Modify: `apps/worker/src/config.ts` — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_BASE_URL`, поле `telegram`.
- Create: `apps/worker/src/config.telegram.test.ts`
- Create: `apps/worker/src/telegram/bot-api.ts`, `apps/worker/src/telegram/bot-api.test.ts`
- Create: `apps/worker/src/telegram/templates.ts`, `apps/worker/src/telegram/templates.test.ts`
- Create: `apps/worker/src/telegram/unlink.ts`
- Create: `apps/worker/src/telegram/telegram-sender.ts`
- Create: `apps/worker/src/telegram/link-codes.ts`
- Modify: `apps/worker/src/delivery/build-digests.handler.ts` — очистка старых кодов привязки.
- Modify: `apps/worker/src/main.ts` — отправители по конфигу.
- Create: `apps/api/test/telegram-delivery.integration.test.ts`

**Interfaces:**
- Consumes (задача 5): `ChannelSender`, `SendResult`, `ChannelSenders`, `DeliveryChannel`, `RetryLaterError(retryAt, code)`, `PermanentSendError(code)` из `delivery/channel-sender.ts`; `ClaimedDelivery` (с `channel`), `DeliveryRepository`; `DeliveryFacts` (`setting.includeAmounts`); `DeliverNotificationsHandler(prisma, repository, senders, hooks?, batchSize?)`; `EmailSender(prisma, repository, mailer, webBaseUrl)`; `BuildEmailDigestsHandler(prisma, channels)`.
- Consumes (существующее): `loadUrgentContent(prisma, delivery, includeAmounts)` из `delivery/urgent-content.ts`, `loadDigestContent(prisma, delivery, includeAmounts)` из `delivery/digest-content.ts`, типы `UrgentContent`, `DigestContent` и функция `personLine(person)` из `mail/templates.ts`, `escapeHtml` из `mail/format.ts`.
- Produces (использует задача 8): переменные воркера `TELEGRAM_BOT_TOKEN` (необязательная) и `TELEGRAM_API_BASE_URL` (по умолчанию `https://api.telegram.org`); с токеном обязателен `WEB_BASE_URL`.

---

- [ ] **Step 1: Тест конфига (падает)**

Файл `apps/worker/src/config.telegram.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { loadWorkerConfig } from './config.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
};

describe('loadWorkerConfig telegram', () => {
  it('has no telegram without a bot token', () => {
    expect(loadWorkerConfig(base).telegram).toBeUndefined();
    expect(loadWorkerConfig({ ...base, TELEGRAM_BOT_TOKEN: '' }).telegram).toBeUndefined();
  });

  it('maps the token with the default API base URL and the web address', () => {
    expect(
      loadWorkerConfig({
        ...base,
        TELEGRAM_BOT_TOKEN: '123456:worker-token',
        WEB_BASE_URL: 'https://harmofin.example',
      }).telegram,
    ).toEqual({
      botToken: '123456:worker-token',
      apiBaseUrl: 'https://api.telegram.org',
      webBaseUrl: 'https://harmofin.example',
    });
  });

  it('strips a trailing slash from a custom API base URL', () => {
    const config = loadWorkerConfig({
      ...base,
      TELEGRAM_BOT_TOKEN: '123456:worker-token',
      TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9/',
      WEB_BASE_URL: 'http://localhost:3000',
    });
    expect(config.telegram?.apiBaseUrl).toBe('http://127.0.0.1:9');
  });

  it('requires WEB_BASE_URL with a bot token', () => {
    expect(() => loadWorkerConfig({ ...base, TELEGRAM_BOT_TOKEN: '123456:worker-token' })).toThrow(
      /WEB_BASE_URL/,
    );
  });
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/config.telegram.test.ts`
Expected: FAIL.

- [ ] **Step 2: Конфиг воркера**

В `apps/worker/src/config.ts`:

1. В `workerEnvironmentSchema` после `WEB_BASE_URL: optionalHttpUrl,` добавить:

```ts
  TELEGRAM_BOT_TOKEN: optionalNonEmpty,
  TELEGRAM_API_BASE_URL: httpUrl.default('https://api.telegram.org'),
```

2. После `export interface WorkerMailConfig { ... }` добавить:

```ts
export interface WorkerTelegramConfig {
  botToken: string;
  apiBaseUrl: string;
  webBaseUrl: string;
}
```

3. В `interface WorkerConfig` после `mail: WorkerMailConfig | undefined;` добавить `telegram: WorkerTelegramConfig | undefined;`.

4. В `loadWorkerConfig` после `mail: mailConfig(result.data),` добавить `telegram: telegramConfig(result.data),`.

5. В конец файла добавить:

```ts
/** Telegram is optional: without a bot token the worker sends no Telegram messages. */
function telegramConfig(
  data: z.infer<typeof workerEnvironmentSchema>,
): WorkerTelegramConfig | undefined {
  if (!data.TELEGRAM_BOT_TOKEN) return undefined;
  if (!data.WEB_BASE_URL) throw new Error('Invalid worker configuration: WEB_BASE_URL');
  return {
    botToken: data.TELEGRAM_BOT_TOKEN,
    apiBaseUrl: data.TELEGRAM_API_BASE_URL.replace(/\/+$/, ''),
    webBaseUrl: data.WEB_BASE_URL,
  };
}
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/config.test.ts src/config.telegram.test.ts`
Expected: PASS (старый `config.test.ts` сравнивает через `toEqual`, поле `telegram: undefined` ему не мешает).

- [ ] **Step 3: Клиент Bot API — тест (падает)**

Файл `apps/worker/src/telegram/bot-api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { TelegramBotApi } from './bot-api.js';

const token = '123456:worker-secret-token';
const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('TelegramBotApi.sendMessage', () => {
  it('posts HTML with url buttons and reports success', async () => {
    const fetchImpl = reply(200, { ok: true, result: {} });
    const api = new TelegramBotApi(token, 'https://api.telegram.org', fetchImpl);
    const result = await api.sendMessage(77n, {
      text: '<b>Тест</b>',
      buttons: [{ text: 'Открыть', url: 'https://x.test/app' }],
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '77',
      text: '<b>Тест</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'Открыть', url: 'https://x.test/app' }]] },
    });
  });

  it('returns retry_after on 429', async () => {
    const api = new TelegramBotApi(
      token,
      'https://api.telegram.org',
      reply(429, {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 7',
        parameters: { retry_after: 7 },
      }),
    );
    await expect(api.sendMessage(1n, { text: 'x', buttons: [] })).resolves.toEqual({
      ok: false,
      status: 429,
      description: 'Too Many Requests: retry after 7',
      retryAfter: 7,
    });
  });

  it('reports a non-JSON error body by status only', async () => {
    const fetchImpl = vi.fn(async () => new Response('Bad Gateway', { status: 502 }));
    const api = new TelegramBotApi(token, 'https://api.telegram.org', fetchImpl);
    await expect(api.sendMessage(1n, { text: 'x', buttons: [] })).resolves.toEqual({
      ok: false,
      status: 502,
      description: '',
      retryAfter: null,
    });
  });
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/telegram/bot-api.test.ts`
Expected: FAIL.

- [ ] **Step 4: Клиент Bot API — реализация**

Файл `apps/worker/src/telegram/bot-api.ts`:

```ts
export type TelegramButton = { text: string; url: string };
export type TelegramMessage = { text: string; buttons: TelegramButton[] };

export type BotApiResult =
  | { ok: true }
  | { ok: false; status: number; description: string; retryAfter: number | null };

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * sendMessage over plain fetch. The request URL contains the bot token, so it never appears in
 * results or errors; network errors and timeouts are thrown as they are (their names only reach
 * logs) and retried by the delivery handler.
 */
export class TelegramBotApi {
  constructor(
    private readonly botToken: string,
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendMessage(chatId: bigint, message: TelegramMessage): Promise<BotApiResult> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        text: message.text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(message.buttons.length > 0
          ? { reply_markup: { inline_keyboard: message.buttons.map((button) => [button]) } }
          : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let body: {
      ok?: boolean;
      description?: unknown;
      parameters?: { retry_after?: unknown };
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Not JSON (proxy error page): the status is enough.
    }
    if (response.ok && body.ok !== false) return { ok: true };
    const retryAfter = body.parameters?.retry_after;
    return {
      ok: false,
      status: response.status,
      description: typeof body.description === 'string' ? body.description.slice(0, 200) : '',
      retryAfter: typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : null,
    };
  }
}
```

Run: тест из Step 3. Expected: PASS.

- [ ] **Step 5: Шаблоны — тест (падает)**

Файл `apps/worker/src/telegram/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { renderTelegramDigest, renderTelegramUrgent } from './templates.js';

const https = 'https://harmofin.example';

describe('renderTelegramUrgent', () => {
  it('escapes HTML and links the action path', () => {
    const message = renderTelegramUrgent(
      {
        subject: 'Просрочен платёж «<Ипотека>»',
        lines: ['План «<Ипотека>» просрочен с 2026-10-25.'],
        actionPath: '/app/plans?occurrence=1',
      },
      https,
    );
    expect(message.text).toContain('<b>Просрочен платёж «&lt;Ипотека&gt;»</b>');
    expect(message.text).not.toContain('<Ипотека>');
    expect(message.text).toContain('/stop');
    expect(message.buttons).toEqual([
      { text: 'Открыть', url: 'https://harmofin.example/app/plans?occurrence=1' },
    ]);
  });

  it('has no buttons on a non-https web address', () => {
    const message = renderTelegramUrgent(
      { subject: 'Напоминание', lines: ['Сегодня'], actionPath: '/app/calendar' },
      'http://localhost:3000',
    );
    expect(message.buttons).toEqual([]);
  });

  it('refuses a link outside the web origin', () => {
    expect(() =>
      renderTelegramUrgent({ subject: 's', lines: [], actionPath: '//evil.example/x' }, https),
    ).toThrow();
  });
});

describe('renderTelegramDigest', () => {
  it('lists people and payments with feed and settings buttons', () => {
    const message = renderTelegramDigest(
      {
        frequency: 'DAILY',
        periodLabel: '2 ноября',
        people: [{ name: 'Анна & Ко', counts: { operations: 3, calendar: 1 } }],
        payments: [
          { name: 'Ипотека', amount: '45 000,00 ₽' },
          { name: 'Интернет', amount: null },
        ],
      },
      https,
    );
    expect(message.text).toContain('<b>Что нового в семье за 2 ноября</b>');
    expect(message.text).toContain('• Анна &amp; Ко: 3 операции, 1 событие календаря');
    expect(message.text).toContain('<b>Платежи сегодня</b>');
    expect(message.text).toContain('• Ипотека — 45 000,00 ₽');
    expect(message.text).toContain('• Интернет');
    expect(message.buttons.map((button) => button.text)).toEqual(['Открыть ленту', 'Настройки']);
    expect(message.buttons[1]!.url).toBe('https://harmofin.example/app/settings/telegram');
  });

  it('titles a weekly digest by the week', () => {
    const message = renderTelegramDigest(
      { frequency: 'WEEKLY', periodLabel: 'неделю', people: [], payments: [{ name: 'A', amount: null }] },
      https,
    );
    expect(message.text).toContain('<b>Что нового в семье за неделю</b>');
  });
});
```

Run: `pnpm --filter @harmofin/worker exec vitest run --config vitest.config.ts src/telegram/templates.test.ts`
Expected: FAIL.

- [ ] **Step 6: Шаблоны — реализация**

Файл `apps/worker/src/telegram/templates.ts`:

```ts
import { escapeHtml } from '../mail/format.js';
import { personLine, type DigestContent, type UrgentContent } from '../mail/templates.js';
import type { TelegramButton, TelegramMessage } from './bot-api.js';

const FOOTER = 'Отключить: /stop или в настройках HarmoFin.';

/**
 * Telegram HTML: only <b> and escaped text. The content (and amounts, only with consent) comes from
 * the same loaders as email. Buttons only on an https web address: Telegram rejects other URLs.
 */
export function renderTelegramUrgent(content: UrgentContent, webBaseUrl: string): TelegramMessage {
  const text = [
    `<b>${escapeHtml(content.subject)}</b>`,
    ...content.lines.map(escapeHtml),
    '',
    FOOTER,
  ].join('\n');
  return { text, buttons: buttons(webBaseUrl, [['Открыть', content.actionPath]]) };
}

export function renderTelegramDigest(content: DigestContent, webBaseUrl: string): TelegramMessage {
  const title =
    content.frequency === 'WEEKLY'
      ? 'Что нового в семье за неделю'
      : `Что нового в семье за ${content.periodLabel}`;
  const lines = [`<b>${escapeHtml(title)}</b>`];
  if (content.people.length > 0) {
    lines.push('', ...content.people.map((person) => `• ${escapeHtml(personLine(person))}`));
  }
  if (content.payments.length > 0) {
    lines.push(
      '',
      '<b>Платежи сегодня</b>',
      ...content.payments.map(
        (payment) =>
          `• ${escapeHtml(payment.amount ? `${payment.name} — ${payment.amount}` : payment.name)}`,
      ),
    );
  }
  lines.push('', FOOTER);
  return {
    text: lines.join('\n'),
    buttons: buttons(webBaseUrl, [
      ['Открыть ленту', '/app/activity'],
      ['Настройки', '/app/settings/telegram'],
    ]),
  };
}

function buttons(
  webBaseUrl: string,
  items: ReadonlyArray<readonly [string, string]>,
): TelegramButton[] {
  const base = new URL(webBaseUrl);
  return items.flatMap(([text, path]) => {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new Error('Telegram link must be a path on the web origin');
    }
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new Error('Telegram link leaves the web origin');
    return base.protocol === 'https:' ? [{ text, url: url.toString() }] : [];
  });
}
```

Run: тест из Step 5. Expected: PASS.

- [ ] **Step 7: Отвязка, отправитель, очистка кодов**

Файл `apps/worker/src/telegram/unlink.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

/**
 * The bot was blocked or the chat is gone: the same unlink as /stop in the API, from the worker.
 * Looks the link up by chat, so a user who has meanwhile linked another chat keeps it.
 */
export async function unlinkUnavailableChat(prisma: PrismaClient, chatId: bigint): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const link = await tx.telegramLink.findUnique({
      where: { chatId },
      select: { id: true, userId: true },
    });
    if (!link) return;
    await tx.telegramLink.delete({ where: { id: link.id } });
    await tx.notificationChannelSetting.updateMany({
      where: { userId: link.userId, channel: 'TELEGRAM' },
      data: { enabled: false },
    });
    await tx.notificationDelivery.updateMany({
      where: { userId: link.userId, channel: 'TELEGRAM', status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: 'TELEGRAM_CHAT_UNAVAILABLE' },
    });
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: link.userId,
        entityType: 'telegram_link',
        entityId: link.id,
        action: 'TELEGRAM_UNLINKED',
        newValues: { reason: 'blocked' },
        source: 'WORKER',
        requestId: null,
      },
    });
  });
}
```

Файл `apps/worker/src/telegram/telegram-sender.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

import {
  PermanentSendError,
  RetryLaterError,
  type ChannelSender,
  type SendResult,
} from '../delivery/channel-sender.js';
import type { ClaimedDelivery } from '../delivery/delivery.repository.js';
import { loadDigestContent } from '../delivery/digest-content.js';
import type { DeliveryFacts } from '../delivery/eligibility.js';
import { loadUrgentContent } from '../delivery/urgent-content.js';
import type { TelegramBotApi, TelegramMessage } from './bot-api.js';
import { renderTelegramDigest, renderTelegramUrgent } from './templates.js';
import { unlinkUnavailableChat } from './unlink.js';

const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * Messages to the linked private chat. Bot API answers: 429 waits for retry_after without spending
 * an attempt; 403 or "chat not found" unlinks the chat and cancels; other 4xx fail at once; 5xx and
 * network errors are retried by the handler.
 */
export class TelegramSender implements ChannelSender {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly api: Pick<TelegramBotApi, 'sendMessage'>,
    private readonly webBaseUrl: string,
  ) {}

  async send(delivery: ClaimedDelivery, facts: DeliveryFacts, now: Date): Promise<SendResult> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { userId: delivery.userId },
      select: { chatId: true },
    });
    if (!link) return { outcome: 'cancelled', reason: 'TELEGRAM_NOT_LINKED' };
    const message = await this.render(delivery, facts.setting!.includeAmounts);
    if (!message) {
      return {
        outcome: 'cancelled',
        reason: delivery.kind === 'DIGEST' ? 'DIGEST_EMPTY' : 'NOTIFICATION_MISSING',
      };
    }

    const result = await this.api.sendMessage(link.chatId, message);
    if (result.ok) return { outcome: 'sent' };
    if (result.status === 429) {
      const seconds = result.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS;
      throw new RetryLaterError(new Date(now.getTime() + seconds * 1_000), 'TELEGRAM_429');
    }
    if (
      result.status === 403 ||
      (result.status === 400 && /chat not found/i.test(result.description))
    ) {
      await unlinkUnavailableChat(this.prisma, link.chatId);
      return { outcome: 'cancelled', reason: 'TELEGRAM_CHAT_UNAVAILABLE' };
    }
    if (result.status >= 400 && result.status < 500) {
      throw new PermanentSendError(`TELEGRAM_${result.status}`);
    }
    throw Object.assign(new Error('Telegram server error'), { code: `TELEGRAM_${result.status}` });
  }

  private async render(
    delivery: ClaimedDelivery,
    includeAmounts: boolean,
  ): Promise<TelegramMessage | null> {
    if (delivery.kind === 'URGENT') {
      const content = await loadUrgentContent(this.prisma, delivery, includeAmounts);
      return content ? renderTelegramUrgent(content, this.webBaseUrl) : null;
    }
    const content = await loadDigestContent(this.prisma, delivery, includeAmounts);
    return content ? renderTelegramDigest(content, this.webBaseUrl) : null;
  }
}
```

Файл `apps/worker/src/telegram/link-codes.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

const CODE_RETENTION_MS = 86_400_000;

/** Link codes live 15 minutes; anything older than a day is used or expired and is dropped. */
export async function purgeStaleLinkCodes(prisma: PrismaClient, now: Date): Promise<void> {
  await prisma.telegramLinkCode.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - CODE_RETENTION_MS) } },
  });
}
```

В `apps/worker/src/delivery/build-digests.handler.ts`:
- после импорта `digest-schedule.js` добавить `import { purgeStaleLinkCodes } from '../telegram/link-codes.js';`;
- в конце `execute`, после `await this.prisma.notificationDelivery.deleteMany({ ... });`, добавить:

```ts
    // Codes have no budget: a run scoped to one budget (tests) leaves them alone.
    if (!budgetId) await purgeStaleLinkCodes(this.prisma, now);
```

- [ ] **Step 8: Wiring в `main.ts`**

В `apps/worker/src/main.ts`:

1. Импорты: после `import { EmailSender } from './delivery/email-sender.js';` добавить:

```ts
import type { ChannelSenders } from './delivery/channel-sender.js';
import { TelegramBotApi } from './telegram/bot-api.js';
import { TelegramSender } from './telegram/telegram-sender.js';
```

2. Блок от строки `const mailHandlers = config.mail` до строки `if (!config.mail) logger.mailDisabled();` включительно заменить на:

```ts
const deliveryRepository = new DeliveryRepository(database);
const senders: ChannelSenders = {
  ...(config.mail
    ? {
        EMAIL: new EmailSender(
          database,
          deliveryRepository,
          new SmtpMailer(config.mail),
          config.mail.webBaseUrl,
        ),
      }
    : {}),
  ...(config.telegram
    ? {
        TELEGRAM: new TelegramSender(
          database,
          new TelegramBotApi(config.telegram.botToken, config.telegram.apiBaseUrl),
          config.telegram.webBaseUrl,
        ),
      }
    : {}),
};
const deliveryChannels = (['EMAIL', 'TELEGRAM'] as const).filter((channel) => senders[channel]);
// Without any configured channel the delivery and digest jobs are not registered at all.
const deliveryHandlers =
  deliveryChannels.length > 0
    ? {
        DELIVER_NOTIFICATIONS: new DeliverNotificationsHandler(
          database,
          deliveryRepository,
          senders,
          {
            onOutcome: (kind, outcome) => metrics.recordDelivery(kind, outcome),
            onFailure: (failure) => {
              logger.deliveryFailure(failure);
              void errorReporter.report(new Error('Notification delivery failed'), {
                errorName: failure.errorName,
              });
            },
          },
        ),
        BUILD_EMAIL_DIGESTS: new BuildEmailDigestsHandler(database, deliveryChannels),
      }
    : {};
if (!config.mail) logger.mailDisabled();
```

3. Строку `...mailHandlers,` заменить на `...deliveryHandlers,`.

Run: `pnpm --filter @harmofin/worker typecheck`
Expected: PASS.

- [ ] **Step 9: Интеграционный тест отправки**

Файл `apps/api/test/telegram-delivery.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeliverNotificationsHandler } from '../../worker/src/delivery/deliver.handler.js';
import { DeliveryRepository } from '../../worker/src/delivery/delivery.repository.js';
import { formatMinor } from '../../worker/src/mail/format.js';
import type { BotApiResult, TelegramMessage } from '../../worker/src/telegram/bot-api.js';
import { purgeStaleLinkCodes } from '../../worker/src/telegram/link-codes.js';
import { TelegramSender } from '../../worker/src/telegram/telegram-sender.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const sent: Array<{ chatId: bigint; message: TelegramMessage }> = [];
let nextResult: BotApiResult = { ok: true };
const api = {
  sendMessage: async (chatId: bigint, message: TelegramMessage) => {
    sent.push({ chatId, message });
    return nextResult;
  },
};
let anna: FamilyActor;
let chatId: bigint;

const handler = () =>
  new DeliverNotificationsHandler(env.prisma, new DeliveryRepository(env.prisma), {
    TELEGRAM: new TelegramSender(env.prisma, api, 'https://harmofin.example'),
  });

async function subscribe(includeAmounts = false) {
  await env.prisma.notificationChannelSetting.upsert({
    where: { userId_channel: { userId: anna.user.id, channel: 'TELEGRAM' } },
    create: {
      id: randomUUID(),
      userId: anna.user.id,
      channel: 'TELEGRAM',
      enabled: true,
      includeAmounts,
      amountsConsentAt: includeAmounts ? new Date() : null,
    },
    update: { enabled: true, includeAmounts, amountsConsentAt: includeAmounts ? new Date() : null },
  });
  chatId = BigInt(1_000_000 + Math.floor(Math.random() * 1_000_000_000));
  await env.prisma.telegramLink.deleteMany({ where: { userId: anna.user.id } });
  await env.prisma.telegramLink.create({
    data: {
      id: randomUUID(),
      userId: anna.user.id,
      chatId,
      consentedAt: new Date(),
      linkedAt: new Date(),
    },
  });
}

async function overdueNotification(): Promise<string> {
  const planId = randomUUID();
  const occurrenceId = randomUUID();
  await env.prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: anna.workspaceId,
      budgetId: anna.budgetId,
      ownerUserId: anna.user.id,
      name: 'Ипотека',
      planType: 'EXPENSE',
      amountMinor: 4_500_000n,
      anchorOn: new Date('2026-10-01T00:00:00.000Z'),
      startOn: new Date('2026-10-01T00:00:00.000Z'),
      recurrence: 'MONTHLY',
      createdByUserId: anna.user.id,
      updatedByUserId: anna.user.id,
    },
  });
  await env.prisma.planOccurrence.create({
    data: {
      id: occurrenceId,
      workspaceId: anna.workspaceId,
      budgetId: anna.budgetId,
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
      workspaceId: anna.workspaceId,
      budgetId: anna.budgetId,
      userId: anna.user.id,
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

async function queueUrgent(): Promise<string> {
  const notificationId = await overdueNotification();
  const id = randomUUID();
  await env.prisma.notificationDelivery.create({
    data: {
      id,
      workspaceId: anna.workspaceId,
      budgetId: anna.budgetId,
      userId: anna.user.id,
      channel: 'TELEGRAM',
      kind: 'URGENT',
      notificationId,
      dedupeKey: `urgent:${notificationId}`,
      nextAttemptAt: new Date(Date.now() - 1_000),
    },
  });
  return id;
}

const row = (id: string) => env.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await env.start();
  anna = await env.register();
});

afterAll(async () => {
  await env.stop();
});

beforeEach(() => {
  sent.length = 0;
  nextResult = { ok: true };
});

describe('TelegramSender', () => {
  it('sends an urgent message without the amount and with an https button', async () => {
    await subscribe(false);
    const id = await queueUrgent();
    await handler().execute(new Date(), anna.budgetId);
    expect((await row(id)).status).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe(chatId);
    expect(sent[0]!.message.text).toContain('Ипотека');
    expect(sent[0]!.message.text).not.toContain('45');
    expect(sent[0]!.message.buttons[0]!.url).toMatch(
      /^https:\/\/harmofin\.example\/app\/plans\?occurrence=/,
    );
  });

  it('adds the amount only with consent', async () => {
    await subscribe(true);
    await queueUrgent();
    await handler().execute(new Date(), anna.budgetId);
    expect(sent[0]!.message.text).toContain(formatMinor(4_500_000n, 'RUB'));
  });

  it('unlinks and cancels when the bot is blocked', async () => {
    await subscribe(false);
    const id = await queueUrgent();
    nextResult = { ok: false, status: 403, description: 'Forbidden: bot was blocked by the user', retryAfter: null };
    await handler().execute(new Date(), anna.budgetId);
    expect(await row(id)).toMatchObject({
      status: 'CANCELLED',
      lastError: 'TELEGRAM_CHAT_UNAVAILABLE',
    });
    expect(await env.prisma.telegramLink.findUnique({ where: { userId: anna.user.id } })).toBeNull();
    const setting = await env.prisma.notificationChannelSetting.findUniqueOrThrow({
      where: { userId_channel: { userId: anna.user.id, channel: 'TELEGRAM' } },
    });
    expect(setting.enabled).toBe(false);
    const audit = await env.prisma.auditEvent.findFirst({
      where: { actorUserId: anna.user.id, action: 'TELEGRAM_UNLINKED', source: 'WORKER' },
    });
    expect(audit?.newValues).toEqual({ reason: 'blocked' });
  });

  it('waits for retry_after on 429 without spending an attempt', async () => {
    await subscribe(false);
    const id = await queueUrgent();
    nextResult = { ok: false, status: 429, description: 'Too Many Requests', retryAfter: 30 };
    const now = new Date();
    await handler().execute(now, anna.budgetId);
    expect(await row(id)).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(now.getTime() + 30_000),
      lastError: 'TELEGRAM_429',
    });
  });

  it('fails at once on another client error and retries a server error', async () => {
    await subscribe(false);
    const bad = await queueUrgent();
    nextResult = { ok: false, status: 400, description: "Bad Request: can't parse entities", retryAfter: null };
    await handler().execute(new Date(), anna.budgetId);
    expect(await row(bad)).toMatchObject({ status: 'FAILED', lastError: 'TELEGRAM_400' });

    const flaky = await queueUrgent();
    nextResult = { ok: false, status: 502, description: '', retryAfter: null };
    await handler().execute(new Date(), anna.budgetId);
    expect(await row(flaky)).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'TELEGRAM_502' });
  });
});

describe('purgeStaleLinkCodes', () => {
  it('drops codes older than a day and keeps fresh ones', async () => {
    const old = randomUUID();
    const fresh = randomUUID();
    const base = { userId: anna.user.id, consentedAt: new Date(), expiresAt: new Date() };
    await env.prisma.telegramLinkCode.create({
      data: { id: old, codeHash: randomUUID().replaceAll('-', '').padEnd(64, '0'), createdAt: new Date(Date.now() - 2 * 86_400_000), ...base },
    });
    await env.prisma.telegramLinkCode.create({
      data: { id: fresh, codeHash: randomUUID().replaceAll('-', '').padEnd(64, '1'), ...base },
    });
    await purgeStaleLinkCodes(env.prisma, new Date());
    expect(await env.prisma.telegramLinkCode.findUnique({ where: { id: old } })).toBeNull();
    expect(await env.prisma.telegramLinkCode.findUnique({ where: { id: fresh } })).not.toBeNull();
  });
});
```

Run: `pnpm test:integration`
Expected: PASS весь набор, включая `telegram-delivery.integration.test.ts` (6 тестов).


- [ ] **Step 10: Общие проверки**

Run: `pnpm --filter @harmofin/worker test && pnpm typecheck && pnpm lint && pnpm exec prettier --check apps/worker apps/api/test`
Expected: PASS, 0 errors (иначе `pnpm exec prettier --write <файлы>`).

- [ ] **Step 11: Review по чек-листу**

`git add apps/worker/src apps/api/test/telegram-delivery.integration.test.ts` и `git diff --staged`:

- security: токен бота только в URL запроса, нигде не логируется и не попадает в `last_error` (только `TELEGRAM_<status>` или имя ошибки); текст и суммы собираются при отправке; суммы только с согласием Telegram; HTML экранирован; кнопки только на origin веба и только `https`; отвязка по `chat_id`, а не по пользователю.
- backend: 429 не тратит попытку; 403/`chat not found` отвязывает в одной транзакции; задачи доставки регистрируются, если настроен хотя бы один канал; очистка кодов не трогает строки при прогоне по одному бюджету.
- QA: юнит-тесты конфига, клиента, шаблонов; интеграция — отправка, суммы, 403, 429, 400, 502, очистка кодов.
- final: новых зависимостей нет; `main.ts` без SMTP и без бота ведёт себя как раньше (задачи не регистрируются).

- [ ] **Step 12: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): отправка уведомлений в Telegram из воркера"
```

Добавить строку в «Ход выполнения» README.
