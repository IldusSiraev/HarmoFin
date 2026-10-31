import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let anna: FamilyActor;
let boris: FamilyActor;

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  boris = await env.register();
});

afterAll(async () => {
  await env.stop();
});

const chatId = () => BigInt(Math.floor(Math.random() * 1_000_000_000_000));

function link(userId: string, chat: bigint) {
  const now = new Date();
  return { id: randomUUID(), userId, chatId: chat, consentedAt: now, linkedAt: now };
}

describe('telegram_links', () => {
  it('keeps one chat per user and one user per chat', async () => {
    const chat = chatId();
    await env.prisma.telegramLink.create({ data: link(anna.user.id, chat) });
    await expect(
      env.prisma.telegramLink.create({ data: link(anna.user.id, chatId()) }),
    ).rejects.toThrow();
    await expect(env.prisma.telegramLink.create({ data: link(boris.user.id, chat) })).rejects.toThrow();
  });

  it('stores chat ids beyond 32 bits', async () => {
    const big = 9_007_199_254_740_000n;
    await env.prisma.telegramLink.create({ data: link(boris.user.id, big) });
    const row = await env.prisma.telegramLink.findUniqueOrThrow({ where: { userId: boris.user.id } });
    expect(row.chatId).toBe(big);
  });
});

describe('telegram_link_codes', () => {
  it('rejects a duplicate code hash', async () => {
    const codeHash = 'a'.repeat(64);
    const data = {
      userId: anna.user.id,
      codeHash,
      consentedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
    };
    await env.prisma.telegramLinkCode.create({ data: { id: randomUUID(), ...data } });
    await expect(
      env.prisma.telegramLinkCode.create({ data: { id: randomUUID(), ...data } }),
    ).rejects.toThrow();
  });
});

describe('notification channel TELEGRAM', () => {
  it('is accepted by settings and the delivery queue', async () => {
    await env.prisma.notificationChannelSetting.create({
      data: { id: randomUUID(), userId: anna.user.id, channel: 'TELEGRAM' },
    });
    await env.prisma.notificationDelivery.create({
      data: {
        id: randomUUID(),
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        userId: anna.user.id,
        channel: 'TELEGRAM',
        kind: 'DIGEST',
        dedupeKey: `digest:DAILY:${randomUUID()}`,
        nextAttemptAt: new Date(),
      },
    });
    const count = await env.prisma.notificationDelivery.count({
      where: { userId: anna.user.id, channel: 'TELEGRAM' },
    });
    expect(count).toBe(1);
  });
});
