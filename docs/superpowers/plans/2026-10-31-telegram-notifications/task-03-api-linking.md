# Задача 3: API — привязка чата, отвязка, webhook

Перед началом: прочитать [README](README.md). Задачи 1–2 закоммичены.

**Files:**
- Create: `apps/api/src/telegram/telegram.repository.ts`
- Create: `apps/api/src/telegram/telegram-link.application.service.ts`
- Create: `apps/api/src/telegram/telegram.schemas.ts`
- Create: `apps/api/src/telegram/telegram.dto.ts`
- Create: `apps/api/src/telegram/telegram-link.controller.ts`
- Create: `apps/api/src/telegram/telegram-webhook.controller.ts`
- Create: `apps/api/src/telegram/telegram.module.ts`
- Modify: `apps/api/src/app.module.ts` — регистрация `TelegramModule`.
- Modify: `apps/api/src/auth/auth-rate-limit.guard.ts` — лимит на выдачу ссылки.
- Modify: `apps/api/test/helpers/family-app.ts` — `start(overrides)`.
- Create: `apps/api/test/telegram-linking.integration.test.ts`
- Modify: `openapi.json` (генерация).

**Interfaces:**
- Consumes (задача 2): `ApiConfig.telegram?: { botToken; botUsername; webhookSecret; apiBaseUrl }`; `ExternalWebhook()`; `TELEGRAM_BOT_CLIENT`, `TelegramBotClient`, `HttpTelegramBotClient`, `TelegramButton`, `webButton(webBaseUrl, text, path)`; `parseTelegramUpdate(update)`, `webhookSecretMatches(received, expected)`. `TokenService` (`createRawToken()`, `digest(raw)`) из `apps/api/src/auth/token.service.ts` — глобальный провайдер `AuthModule`.
- Consumes (задача 1): Prisma-модели `telegramLink`, `telegramLinkCode`, канал `'TELEGRAM'`.
- Produces (используют задачи 4, 7, 8):
  - `class TelegramRepository` с методами `transaction`, `findUserStatus`, `replaceOpenCodes`, `findOpenCode`, `consumeCode`, `findLinkByChat`, `findLinkByUser`, `createLink`, `refreshLink`, `removeLink`, `audit` (сигнатуры — в коде ниже). Задача 4 добавит в него методы настроек.
  - `type UnlinkReason = 'web' | 'stop' | 'blocked' | 'replaced'`.
  - `class TelegramLinkApplicationService` с `available: boolean`, `issueLink`, `unlinkFromWeb`, `webhookSecretValid`, `handleUpdate`; константа `BOT_REPLIES`.
  - `class TelegramModule` с `static register(config: ApiConfig)`.
  - HTTP: `POST /api/v1/me/telegram/link` → 200 `{url, expiresAt}`; `DELETE /api/v1/me/telegram/link` → 204; `POST /api/v1/telegram/webhook` → 200 / 401 / 404.
  - `FamilyTestApp.start(overrides?: Record<string, string>)`.

---

- [ ] **Step 1: `FamilyTestApp.start` с переопределениями env**

В `apps/api/test/helpers/family-app.ts` строку `async start(): Promise<void> {` заменить на `async start(overrides: Record<string, string> = {}): Promise<void> {`, а внутри вызова `loadApiConfig({ ... })` после строки `LOG_LEVEL: 'silent',` добавить строку `...overrides,`.

- [ ] **Step 2: Интеграционный тест (падает)**

Файл `apps/api/test/telegram-linking.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const SECRET = 'webhook-secret-with-at-least-32-chars_';
const telegramEnv = {
  TELEGRAM_BOT_TOKEN: '123456:integration-test-token',
  TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_API_BASE_URL: 'https://telegram.invalid',
  RATE_LIMIT_LOGIN_MAX: '100',
};

const replies: Array<{ chatId: string; text: string }> = [];
const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
  replies.push({ chatId: body.chat_id, text: body.text });
  return new Response('{"ok":true,"result":{}}', { status: 200 });
});

const env = new FamilyTestApp();
let anna: FamilyActor;
let boris: FamilyActor;

const newChatId = () => 1_000_000 + Math.floor(Math.random() * 1_000_000_000);

function webhook(update: unknown, secret: string | null = SECRET) {
  return env.server.inject({
    method: 'POST',
    url: '/api/v1/telegram/webhook',
    headers: {
      'content-type': 'application/json',
      ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }),
    },
    payload: JSON.stringify(update),
  });
}

const startUpdate = (chatId: number, code: string, type = 'private') => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type }, text: `/start ${code}` },
});

async function issueCode(actor: FamilyActor): Promise<string> {
  const response = await env.inject('POST', '/api/v1/me/telegram/link', actor, { consent: true });
  expect(response.statusCode).toBe(200);
  const { url } = response.json<{ url: string; expiresAt: string }>();
  expect(url).toMatch(/^https:\/\/t\.me\/harmofin_test_bot\?start=[A-Za-z0-9_-]{43}$/);
  return new URL(url).searchParams.get('start')!;
}

async function linkChat(actor: FamilyActor): Promise<number> {
  const chatId = newChatId();
  expect((await webhook(startUpdate(chatId, await issueCode(actor)))).statusCode).toBe(200);
  return chatId;
}

const linkOf = (actor: FamilyActor) =>
  env.prisma.telegramLink.findUnique({ where: { userId: actor.user.id } });
const lastReplyTo = (chatId: number) =>
  replies.filter((reply) => reply.chatId === String(chatId)).at(-1)?.text;

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch);
  await env.start(telegramEnv);
  anna = await env.register();
  boris = await env.register();
});

afterAll(async () => {
  await env.stop();
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  replies.length = 0;
  for (const actor of [anna, boris]) {
    await env.prisma.telegramLink.deleteMany({ where: { userId: actor.user.id } });
  }
});

describe('POST /api/v1/me/telegram/link', () => {
  it('requires consent', async () => {
    const response = await env.inject('POST', '/api/v1/me/telegram/link', anna, {
      consent: false,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'TELEGRAM_CONSENT_REQUIRED' });
  });

  it('requires CSRF', async () => {
    const response = await env.server.inject({
      method: 'POST',
      url: '/api/v1/me/telegram/link',
      headers: { origin: 'http://localhost:3000' },
      cookies: { harmofin_session: anna.cookie },
      payload: { consent: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it('stores only a hash of the code and voids the previous code', async () => {
    const first = await issueCode(anna);
    const second = await issueCode(anna);
    const codes = await env.prisma.telegramLinkCode.findMany({
      where: { userId: anna.user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(codes.every((code) => code.codeHash.length === 64)).toBe(true);
    expect(codes.some((code) => code.codeHash.includes(first) || code.codeHash.includes(second))).toBe(
      false,
    );
    expect(codes.filter((code) => code.consumedAt === null)).toHaveLength(1);

    const chatId = newChatId();
    await webhook(startUpdate(chatId, first));
    expect(await linkOf(anna)).toBeNull();
    expect(lastReplyTo(chatId)).toContain('Ссылка устарела');
  });
});

describe('POST /api/v1/telegram/webhook', () => {
  it('links a private chat by a fresh code without an Origin header', async () => {
    const chatId = await linkChat(anna);
    const link = await linkOf(anna);
    expect(link?.chatId).toBe(BigInt(chatId));
    expect(link?.consentedAt).toBeInstanceOf(Date);
    expect(lastReplyTo(chatId)).toContain('Аккаунт HarmoFin привязан');
    const audit = await env.prisma.auditEvent.findFirst({
      where: { actorUserId: anna.user.id, action: 'TELEGRAM_LINKED' },
    });
    expect(audit?.entityType).toBe('telegram_link');
    expect(JSON.stringify(audit)).not.toContain(String(chatId));
  });

  it('rejects a reused code', async () => {
    const code = await issueCode(anna);
    const chatId = newChatId();
    await webhook(startUpdate(chatId, code));
    await env.prisma.telegramLink.deleteMany({ where: { userId: anna.user.id } });
    await webhook(startUpdate(chatId, code));
    expect(await linkOf(anna)).toBeNull();
    expect(lastReplyTo(chatId)).toContain('Ссылка устарела');
  });

  it('rejects an expired code', async () => {
    const code = await issueCode(anna);
    await env.prisma.telegramLinkCode.updateMany({
      where: { userId: anna.user.id, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const chatId = newChatId();
    await webhook(startUpdate(chatId, code));
    expect(await linkOf(anna)).toBeNull();
    expect(lastReplyTo(chatId)).toContain('Ссылка устарела');
  });

  it('refuses a chat already linked to another user', async () => {
    const chatId = await linkChat(anna);
    await webhook(startUpdate(chatId, await issueCode(boris)));
    expect(await linkOf(boris)).toBeNull();
    expect((await linkOf(anna))?.chatId).toBe(BigInt(chatId));
    expect(lastReplyTo(chatId)).toContain('уже привязан к другому аккаунту');
  });

  it('replaces the previous chat of the same user', async () => {
    await linkChat(anna);
    const second = await linkChat(anna);
    expect((await linkOf(anna))?.chatId).toBe(BigInt(second));
    const replaced = await env.prisma.auditEvent.findFirst({
      where: { actorUserId: anna.user.id, action: 'TELEGRAM_UNLINKED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(replaced?.newValues).toEqual({ reason: 'replaced' });
  });

  it('ignores group chats without replying', async () => {
    const chatId = -newChatId();
    await webhook(startUpdate(chatId, await issueCode(anna), 'group'));
    expect(await linkOf(anna)).toBeNull();
    expect(lastReplyTo(chatId)).toBeUndefined();
  });

  it('unlinks on /stop, switches the channel off and cancels pending messages', async () => {
    const chatId = await linkChat(anna);
    await env.prisma.notificationChannelSetting.upsert({
      where: { userId_channel: { userId: anna.user.id, channel: 'TELEGRAM' } },
      create: { id: randomUUID(), userId: anna.user.id, channel: 'TELEGRAM', enabled: true },
      update: { enabled: true },
    });
    const deliveryId = randomUUID();
    await env.prisma.notificationDelivery.create({
      data: {
        id: deliveryId,
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        userId: anna.user.id,
        channel: 'TELEGRAM',
        kind: 'DIGEST',
        dedupeKey: `test:${deliveryId}`,
        nextAttemptAt: new Date(),
      },
    });

    await webhook({
      update_id: 5,
      message: { message_id: 2, chat: { id: chatId, type: 'private' }, text: '/stop' },
    });

    expect(await linkOf(anna)).toBeNull();
    const setting = await env.prisma.notificationChannelSetting.findUniqueOrThrow({
      where: { userId_channel: { userId: anna.user.id, channel: 'TELEGRAM' } },
    });
    expect(setting.enabled).toBe(false);
    const delivery = await env.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    expect(delivery).toMatchObject({ status: 'CANCELLED', lastError: 'TELEGRAM_UNLINKED' });
    expect(lastReplyTo(chatId)).toContain('Уведомления отключены');
  });

  it('unlinks silently when the bot is blocked', async () => {
    const chatId = await linkChat(anna);
    replies.length = 0;
    await webhook({
      update_id: 6,
      my_chat_member: {
        chat: { id: chatId, type: 'private' },
        new_chat_member: { status: 'kicked' },
      },
    });
    expect(await linkOf(anna)).toBeNull();
    expect(replies).toHaveLength(0);
  });

  it('answers other messages with help', async () => {
    const chatId = newChatId();
    const response = await webhook({
      update_id: 7,
      message: { message_id: 3, chat: { id: chatId, type: 'private' }, text: 'привет' },
    });
    expect(response.statusCode).toBe(200);
    expect(lastReplyTo(chatId)).toContain('/stop');
  });

  it('answers 401 without or with a wrong secret', async () => {
    expect((await webhook({ update_id: 8 }, null)).statusCode).toBe(401);
    expect((await webhook({ update_id: 8 }, `${SECRET}x`)).statusCode).toBe(401);
  });

  it('keeps the link when the reply fails', async () => {
    fakeFetch.mockImplementationOnce(async () => new Response('{"ok":false}', { status: 500 }));
    const chatId = newChatId();
    const response = await webhook(startUpdate(chatId, await issueCode(anna)));
    expect(response.statusCode).toBe(200);
    expect((await linkOf(anna))?.chatId).toBe(BigInt(chatId));
  });
});

describe('DELETE /api/v1/me/telegram/link', () => {
  it('unlinks from the web and answers 204 even without a link', async () => {
    await linkChat(anna);
    expect((await env.inject('DELETE', '/api/v1/me/telegram/link', anna)).statusCode).toBe(204);
    expect(await linkOf(anna)).toBeNull();
    expect((await env.inject('DELETE', '/api/v1/me/telegram/link', anna)).statusCode).toBe(204);
  });
});

describe('without a configured bot', () => {
  const bare = new FamilyTestApp();
  let carol: FamilyActor;

  beforeAll(async () => {
    // Empty values override TELEGRAM_* that may be set in the local .env.
    await bare.start({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_BOT_USERNAME: '', TELEGRAM_WEBHOOK_SECRET: '' });
    carol = await bare.register();
  });

  afterAll(async () => {
    await bare.stop();
  });

  it('answers 404 on the webhook and 409 on a link request', async () => {
    const response = await bare.server.inject({
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      payload: '{}',
    });
    expect(response.statusCode).toBe(404);
    const link = await bare.inject('POST', '/api/v1/me/telegram/link', carol, { consent: true });
    expect(link.statusCode).toBe(409);
    expect(link.json()).toMatchObject({ code: 'TELEGRAM_UNAVAILABLE' });
  });
});
```

Run: `cd apps/api && DATABASE_URL='postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test' pnpm exec vitest run --config vitest.integration.config.ts test/telegram-linking.integration.test.ts`
Expected: FAIL (маршрутов нет, 404).


- [ ] **Step 3: Репозиторий**

Файл `apps/api/src/telegram/telegram.repository.ts`:

```ts
import type { Prisma, UserStatus } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { PrismaService } from '../database/prisma.service.js';

type Tx = Prisma.TransactionClient;

export type UnlinkReason = 'web' | 'stop' | 'blocked' | 'replaced';
export type TelegramAuditSource = 'API' | 'TELEGRAM';

/**
 * Telegram link, one-time link codes and (task 4) Telegram channel settings. The chat id never
 * reaches audit values; codes are stored only as an HMAC digest.
 */
export class TelegramRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  findUserStatus(tx: Tx, userId: string): Promise<{ status: UserStatus } | null> {
    return tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  }

  /** Voids the user's unused codes and stores the new one. */
  async replaceOpenCodes(
    tx: Tx,
    input: { userId: string; codeHash: string; consentedAt: Date; expiresAt: Date },
  ): Promise<void> {
    await tx.telegramLinkCode.updateMany({
      where: { userId: input.userId, consumedAt: null, expiresAt: { gt: input.consentedAt } },
      data: { consumedAt: input.consentedAt },
    });
    await tx.telegramLinkCode.create({ data: { id: createUuidV7(input.consentedAt), ...input } });
  }

  findOpenCode(tx: Tx, codeHash: string, now: Date) {
    return tx.telegramLinkCode.findFirst({
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true, consentedAt: true, user: { select: { status: true } } },
    });
  }

  async consumeCode(tx: Tx, id: string, now: Date): Promise<boolean> {
    const result = await tx.telegramLinkCode.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    return result.count === 1;
  }

  findLinkByChat(tx: Tx, chatId: bigint) {
    return tx.telegramLink.findUnique({ where: { chatId }, select: { id: true, userId: true } });
  }

  findLinkByUser(tx: Tx, userId: string) {
    return tx.telegramLink.findUnique({ where: { userId }, select: { id: true } });
  }

  createLink(tx: Tx, input: { userId: string; chatId: bigint; consentedAt: Date; now: Date }) {
    return tx.telegramLink.create({
      data: {
        id: createUuidV7(input.now),
        userId: input.userId,
        chatId: input.chatId,
        consentedAt: input.consentedAt,
        linkedAt: input.now,
      },
      select: { id: true },
    });
  }

  async refreshLink(tx: Tx, id: string, consentedAt: Date, now: Date): Promise<void> {
    await tx.telegramLink.update({ where: { id }, data: { consentedAt, linkedAt: now } });
  }

  /**
   * Removes the user's link. Unless the link is being replaced by a new chat, the Telegram channel
   * is switched off and its pending messages are cancelled. Returns false when there was no link.
   */
  async removeLink(
    tx: Tx,
    userId: string,
    entry: { reason: UnlinkReason; source: TelegramAuditSource; requestId?: string },
  ): Promise<boolean> {
    const link = await tx.telegramLink.findUnique({ where: { userId }, select: { id: true } });
    if (!link) return false;
    await tx.telegramLink.delete({ where: { id: link.id } });
    if (entry.reason !== 'replaced') {
      await tx.notificationChannelSetting.updateMany({
        where: { userId, channel: 'TELEGRAM' },
        data: { enabled: false },
      });
      await tx.notificationDelivery.updateMany({
        where: { userId, channel: 'TELEGRAM', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'TELEGRAM_UNLINKED' },
      });
    }
    await this.audit(tx, userId, {
      entityType: 'telegram_link',
      entityId: link.id,
      action: 'TELEGRAM_UNLINKED',
      values: { reason: entry.reason },
      source: entry.source,
      ...(entry.requestId ? { requestId: entry.requestId } : {}),
    });
    return true;
  }

  async audit(
    tx: Tx,
    userId: string,
    entry: {
      entityType: string;
      entityId: string;
      action: string;
      values?: Record<string, unknown>;
      source: string;
      requestId?: string;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        ...(entry.values ? { newValues: entry.values as Prisma.InputJsonValue } : {}),
        source: entry.source,
        requestId: entry.requestId ?? null,
      },
    });
  }
}
```

- [ ] **Step 4: Сервис привязки**

Файл `apps/api/src/telegram/telegram-link.application.service.ts`:

```ts
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { TokenService } from '../auth/token.service.js';
import type { ApiConfig } from '../config/env.js';
import { webButton, type TelegramBotClient, type TelegramButton } from './telegram-bot.client.js';
import type { TelegramRepository } from './telegram.repository.js';
import { parseTelegramUpdate, webhookSecretMatches } from './telegram-update.js';

const LINK_CODE_TTL_MS = 15 * 60_000;

type Meta = { requestId?: string };
type LinkOutcome = 'linked' | 'invalid' | 'taken';

export const BOT_REPLIES = {
  linked: 'Аккаунт HarmoFin привязан. Включите уведомления в настройках приложения.',
  invalid: 'Ссылка устарела. Получите новую в настройках HarmoFin.',
  taken: 'Этот чат уже привязан к другому аккаунту HarmoFin.',
  help: 'Чтобы подключить уведомления, откройте настройки HarmoFin. Отключить — /stop.',
  stopped: 'Уведомления отключены. Подключить снова можно в настройках HarmoFin.',
} as const;

const CONSENT_MESSAGE = 'Подтвердите согласие на отправку уведомлений через Telegram.';

/**
 * Links a private Telegram chat to the account through a one-time t.me deep link, and handles the
 * bot's webhook updates (/start <code>, /stop, blocked bot). Only the HMAC digest of a code is
 * stored; the chat id never reaches audit values or logs.
 */
export class TelegramLinkApplicationService {
  constructor(
    private readonly repository: TelegramRepository,
    private readonly tokens: TokenService,
    private readonly bot: TelegramBotClient | null,
    private readonly config: Pick<ApiConfig, 'telegram' | 'mail'>,
  ) {}

  get available(): boolean {
    return this.config.telegram !== undefined && this.bot !== null;
  }

  webhookSecretValid(received: string | undefined): boolean {
    const telegram = this.config.telegram;
    return telegram !== undefined && webhookSecretMatches(received, telegram.webhookSecret);
  }

  async issueLink(
    userId: string,
    consent: boolean,
    meta: Meta,
  ): Promise<{ url: string; expiresAt: string }> {
    const telegram = this.config.telegram;
    if (!telegram) {
      throw new ConflictException({
        code: 'TELEGRAM_UNAVAILABLE',
        detail: 'Telegram-бот не подключён на сервере.',
      });
    }
    if (!consent) {
      throw new UnprocessableEntityException({
        code: 'TELEGRAM_CONSENT_REQUIRED',
        detail: CONSENT_MESSAGE,
        fieldErrors: [{ field: 'consent', message: CONSENT_MESSAGE, code: 'custom' }],
      });
    }
    const rawCode = this.tokens.createRawToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
    await this.repository.transaction(async (tx) => {
      const user = await this.repository.findUserStatus(tx, userId);
      if (!user || user.status !== 'ACTIVE') {
        throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Пользователь не найден.' });
      }
      await this.repository.replaceOpenCodes(tx, {
        userId,
        codeHash: this.tokens.digest(rawCode),
        consentedAt: now,
        expiresAt,
      });
      await this.repository.audit(tx, userId, {
        entityType: 'telegram_link',
        entityId: userId,
        action: 'TELEGRAM_LINK_REQUESTED',
        source: 'API',
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      });
    });
    const url = new URL(`https://t.me/${telegram.botUsername}`);
    url.searchParams.set('start', rawCode);
    return { url: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  async unlinkFromWeb(userId: string, meta: Meta): Promise<void> {
    await this.repository.transaction((tx) =>
      this.repository.removeLink(tx, userId, {
        reason: 'web',
        source: 'API',
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      }),
    );
  }

  async handleUpdate(update: unknown): Promise<void> {
    const action = parseTelegramUpdate(update);
    switch (action.kind) {
      case 'start': {
        if (action.code === null) return this.reply(action.chatId, BOT_REPLIES.help);
        const outcome = await this.linkChat(action.chatId, action.code);
        const buttons =
          outcome === 'linked'
            ? webButton(this.config.mail.webBaseUrl, 'Настройки', '/app/settings/telegram')
            : [];
        return this.reply(action.chatId, BOT_REPLIES[outcome], buttons);
      }
      case 'stop':
        await this.unlinkChat(action.chatId, 'stop');
        return this.reply(action.chatId, BOT_REPLIES.stopped);
      case 'blocked':
        await this.unlinkChat(action.chatId, 'blocked');
        return;
      case 'help':
        return this.reply(action.chatId, BOT_REPLIES.help);
      case 'ignore':
        return;
    }
  }

  private async linkChat(chatId: bigint, code: string): Promise<LinkOutcome> {
    try {
      return await this.repository.transaction(async (tx) => {
        const now = new Date();
        const row = await this.repository.findOpenCode(tx, this.tokens.digest(code), now);
        if (!row || row.user.status !== 'ACTIVE') return 'invalid';
        const holder = await this.repository.findLinkByChat(tx, chatId);
        if (holder && holder.userId !== row.userId) return 'taken';
        if (!(await this.repository.consumeCode(tx, row.id, now))) return 'invalid';
        if (holder) {
          await this.repository.refreshLink(tx, holder.id, row.consentedAt, now);
          return 'linked';
        }
        await this.repository.removeLink(tx, row.userId, { reason: 'replaced', source: 'TELEGRAM' });
        const link = await this.repository.createLink(tx, {
          userId: row.userId,
          chatId,
          consentedAt: row.consentedAt,
          now,
        });
        await this.repository.audit(tx, row.userId, {
          entityType: 'telegram_link',
          entityId: link.id,
          action: 'TELEGRAM_LINKED',
          source: 'TELEGRAM',
        });
        return 'linked';
      });
    } catch (error) {
      // Two /start updates racing for the same chat: the unique chat_id decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'taken';
      }
      throw error;
    }
  }

  private async unlinkChat(chatId: bigint, reason: 'stop' | 'blocked'): Promise<void> {
    await this.repository.transaction(async (tx) => {
      const link = await this.repository.findLinkByChat(tx, chatId);
      if (link) await this.repository.removeLink(tx, link.userId, { reason, source: 'TELEGRAM' });
    });
  }

  /** Best effort: a failed reply (rate limit, network) never undoes the link. */
  private async reply(chatId: bigint, text: string, buttons: TelegramButton[] = []): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.sendMessage(chatId, text, buttons);
    } catch {
      // Only the bot's reply is lost; the error may carry nothing worth logging.
    }
  }
}
```

- [ ] **Step 5: Схема тела, DTO**

Файл `apps/api/src/telegram/telegram.schemas.ts`:

```ts
import { z } from 'zod';

export const createTelegramLinkSchema = z.object({ consent: z.boolean() }).strict();

export type CreateTelegramLinkInput = z.infer<typeof createTelegramLinkSchema>;
```

Файл `apps/api/src/telegram/telegram.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class CreateTelegramLinkRequest {
  @ApiProperty({
    type: Boolean,
    description:
      'Согласие на отправку уведомлений через серверы Telegram (сторонний сервис). Должно быть true.',
  })
  consent!: boolean;
}

export class TelegramLinkResponse {
  @ApiProperty({
    type: String,
    description: 'Ссылка https://t.me/<бот>?start=<код>. Код одноразовый.',
  })
  url!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Через 15 минут после выдачи.' })
  expiresAt!: string;
}
```

- [ ] **Step 6: Контроллеры**

Файл `apps/api/src/telegram/telegram-link.controller.ts`:

```ts
import { Body, Controller, Delete, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TelegramLinkApplicationService } from './telegram-link.application.service.js';
import { CreateTelegramLinkRequest, TelegramLinkResponse } from './telegram.dto.js';
import { createTelegramLinkSchema, type CreateTelegramLinkInput } from './telegram.schemas.js';

const metaOf = (request: AuthenticatedRequest) => {
  const meta = requestMeta(request);
  return meta.requestId ? { requestId: meta.requestId } : {};
};

@ApiTags('telegram')
@Controller()
export class TelegramLinkController {
  constructor(
    @Inject(TelegramLinkApplicationService)
    private readonly service: TelegramLinkApplicationService,
  ) {}

  @Post('me/telegram/link')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, CsrfGuard, AuthRateLimitGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Получить ссылку привязки Telegram',
    description:
      'Выдаёт одноразовую ссылку на бота на 15 минут и гасит прежние неиспользованные. Требует согласия. Коды: 400 VALIDATION_FAILED, 401, 403 CSRF_INVALID, 409 TELEGRAM_UNAVAILABLE, 422 TELEGRAM_CONSENT_REQUIRED, 429 AUTH_RATE_LIMITED.',
  })
  @ApiBody({ type: CreateTelegramLinkRequest })
  @ApiOkResponse({ type: TelegramLinkResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  @ApiResponse({ status: 429, type: ProblemDetailsResponse })
  create(
    @Body(new ZodValidationPipe(createTelegramLinkSchema)) input: CreateTelegramLinkInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.issueLink(requiredContext(request).userId, input.consent, metaOf(request));
  }

  @Delete('me/telegram/link')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Отвязать Telegram',
    description:
      'Удаляет привязку чата, выключает канал Telegram и отменяет неотправленные сообщения. Без привязки — тоже 204. Коды: 401, 403 CSRF_INVALID.',
  })
  @ApiNoContentResponse({ description: 'Готово.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  async remove(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.service.unlinkFromWeb(requiredContext(request).userId, metaOf(request));
  }
}
```

Файл `apps/api/src/telegram/telegram-webhook.controller.ts`:

```ts
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { ExternalWebhook } from '../common/security/external-webhook.decorator.js';
import { TelegramLinkApplicationService } from './telegram-link.application.service.js';

@ApiTags('telegram')
@Controller()
export class TelegramWebhookController {
  constructor(
    @Inject(TelegramLinkApplicationService)
    private readonly service: TelegramLinkApplicationService,
  ) {}

  @Post('telegram/webhook')
  @HttpCode(200)
  @ExternalWebhook()
  @ApiOperation({
    summary: 'Webhook Telegram-бота',
    description:
      'Вызывается серверами Telegram без сессии, CSRF и Origin; вызывающий проверяется заголовком X-Telegram-Bot-Api-Secret-Token. Нераспознанные обновления тоже получают 200. Коды: 401 TELEGRAM_WEBHOOK_UNAUTHORIZED, 404 RESOURCE_NOT_FOUND (бот не настроен).',
  })
  @ApiHeader({ name: 'X-Telegram-Bot-Api-Secret-Token', required: true })
  @ApiBody({ schema: { type: 'object', description: 'Update из Telegram Bot API.' } })
  @ApiOkResponse({ description: 'Обновление принято.' })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  async receive(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: unknown,
  ): Promise<void> {
    if (!this.service.available) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Ресурс не найден.' });
    }
    if (!this.service.webhookSecretValid(secret)) {
      throw new UnauthorizedException({
        code: 'TELEGRAM_WEBHOOK_UNAUTHORIZED',
        detail: 'Неверный секрет webhook.',
      });
    }
    await this.service.handleUpdate(update);
  }
}
```

- [ ] **Step 7: Модуль и регистрация**

Файл `apps/api/src/telegram/telegram.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';

import { TokenService } from '../auth/token.service.js';
import type { ApiConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  HttpTelegramBotClient,
  TELEGRAM_BOT_CLIENT,
  type TelegramBotClient,
} from './telegram-bot.client.js';
import { TelegramLinkApplicationService } from './telegram-link.application.service.js';
import { TelegramLinkController } from './telegram-link.controller.js';
import { TelegramWebhookController } from './telegram-webhook.controller.js';
import { TelegramRepository } from './telegram.repository.js';

@Module({})
export class TelegramModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: TelegramModule,
      controllers: [TelegramLinkController, TelegramWebhookController],
      providers: [
        {
          provide: TelegramRepository,
          useFactory: (prisma: PrismaService) => new TelegramRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: TELEGRAM_BOT_CLIENT,
          useFactory: (): TelegramBotClient | null =>
            config.telegram
              ? new HttpTelegramBotClient(config.telegram.botToken, config.telegram.apiBaseUrl)
              : null,
        },
        {
          provide: TelegramLinkApplicationService,
          useFactory: (
            repository: TelegramRepository,
            tokens: TokenService,
            bot: TelegramBotClient | null,
          ) => new TelegramLinkApplicationService(repository, tokens, bot, config),
          inject: [TelegramRepository, TokenService, TELEGRAM_BOT_CLIENT],
        },
      ],
      exports: [TelegramRepository],
    };
  }
}
```

В `apps/api/src/app.module.ts`:
- после строки `import { NotificationSettingsModule } from './notification-settings/notification-settings.module.js';` добавить `import { TelegramModule } from './telegram/telegram.module.js';`;
- после строки `NotificationSettingsModule.register(),` добавить `TelegramModule.register(config),`.

В `apps/api/src/auth/auth-rate-limit.guard.ts` в `maximumFor` перед последним `return null;` добавить:

```ts
    if (url.startsWith('/api/v1/me/telegram/link') && method === 'POST')
      return this.config.rateLimit.loginMax;
```

- [ ] **Step 8: Тест проходит**

Run: та же команда, что в Step 2.
Expected: PASS, все тесты файла.

Если тест «links a private chat…» получает 403 `ORIGIN_REQUIRED` — проверить, что в `app.ts` передан `app.get(Reflector)` (задача 2) и что декоратор `@ExternalWebhook()` стоит на методе.

- [ ] **Step 9: OpenAPI и общие проверки**

Run: `node scripts/openapi/generate.mjs && pnpm exec prettier --write openapi.json && node scripts/openapi/check.mjs openapi.json`
Expected: в `openapi.json` появились пути `/api/v1/me/telegram/link` (post, delete) и `/api/v1/telegram/webhook` (post); `check.mjs` без строк `lint:`.

Run: `pnpm --filter @harmofin/api test && pnpm --filter @harmofin/api typecheck && pnpm --filter @harmofin/api lint`
Expected: PASS, 0 errors.

Run: `pnpm test:integration`
Expected: PASS (весь набор: проверяем, что `start(overrides)` и новый модуль ничего не сломали).

- [ ] **Step 10: Review по чек-листу**

`git add apps/api/src/telegram apps/api/src/app.module.ts apps/api/src/auth/auth-rate-limit.guard.ts apps/api/test/helpers/family-app.ts apps/api/test/telegram-linking.integration.test.ts openapi.json` и `git diff --staged`:

- security: webhook без секрета — 401, без бота — 404; кроме webhook, все новые маршруты под `SessionAuthGuard` + `CsrfGuard`; код хранится HMAC, в URL ответа — только сырой код; `chat_id` нет в аудите (тест проверяет); группы игнорируются; чужой чат не перехватывается; ответ бота не логирует ошибку и не падает.
- API: три пути в OpenAPI с телами, ответами и кодами ошибок; существующие пути не изменились.
- backend: все изменения привязки в одной транзакции; гонка `P2002` превращается в `taken`.
- QA: тесты покрывают повтор кода, просрочку, чужой чат, замену, группу, `/stop` с отменой очереди, `kicked`, 401, сбой ответа, DELETE, режим без бота.
- final: только перечисленные файлы.

- [ ] **Step 11: Commit**

```bash
git branch --show-current
git commit -m "feat(telegram): привязка чата одноразовой ссылкой и webhook бота"
```

Добавить строку в «Ход выполнения» README.
