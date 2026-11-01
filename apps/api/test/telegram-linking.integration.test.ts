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
    expect(
      codes.some((code) => code.codeHash.includes(first) || code.codeHash.includes(second)),
    ).toBe(false);
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
    await bare.start({
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_BOT_USERNAME: '',
      TELEGRAM_WEBHOOK_SECRET: '',
    });
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
