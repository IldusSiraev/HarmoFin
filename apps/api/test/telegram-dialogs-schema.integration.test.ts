import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { purgeStaleDialogs } from '../../worker/src/telegram/link-codes.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let anna: FamilyActor;

beforeAll(async () => {
  await env.start();
  anna = await env.register();
});

afterAll(async () => {
  await env.stop();
});

const newChatId = () => BigInt(1_000_000 + Math.floor(Math.random() * 1_000_000_000));

async function linkAnna(): Promise<bigint> {
  await env.prisma.telegramLink.deleteMany({ where: { userId: anna.user.id } });
  const chatId = newChatId();
  const now = new Date();
  await env.prisma.telegramLink.create({
    data: { id: randomUUID(), userId: anna.user.id, chatId, consentedAt: now, linkedAt: now },
  });
  return chatId;
}

function dialog(chatId: bigint, expiresAt = new Date(Date.now() + 1_800_000)) {
  return {
    id: randomUUID(),
    chatId,
    userId: anna.user.id,
    budgetId: anna.budgetId,
    kind: 'EXPENSE',
    step: 'amount',
    expiresAt,
  };
}

describe('telegram_links commands columns', () => {
  it('are empty for a new link', async () => {
    const chatId = await linkAnna();
    const link = await env.prisma.telegramLink.findUniqueOrThrow({ where: { chatId } });
    expect(link.commandsEnabledAt).toBeNull();
    expect(link.commandsConsentAt).toBeNull();
  });
});

describe('telegram_dialogs', () => {
  it('keeps one dialog per chat with version 1 and empty data', async () => {
    const chatId = await linkAnna();
    const created = await env.prisma.telegramDialog.create({ data: dialog(chatId) });
    expect(created.version).toBe(1);
    expect(created.data).toEqual({});
    await expect(env.prisma.telegramDialog.create({ data: dialog(chatId) })).rejects.toThrow();
  });

  it('needs a linked chat and disappears with the link', async () => {
    await expect(env.prisma.telegramDialog.create({ data: dialog(newChatId()) })).rejects.toThrow();
    const chatId = await linkAnna();
    await env.prisma.telegramDialog.create({ data: dialog(chatId) });
    await env.prisma.telegramLink.delete({ where: { chatId } });
    expect(await env.prisma.telegramDialog.findUnique({ where: { chatId } })).toBeNull();
  });
});

describe('purgeStaleDialogs', () => {
  it('drops dialogs expired more than a day ago and keeps the rest', async () => {
    const chatId = await linkAnna();
    const stale = await env.prisma.telegramDialog.create({
      data: dialog(chatId, new Date(Date.now() - 2 * 86_400_000)),
    });
    await purgeStaleDialogs(env.prisma, new Date());
    expect(await env.prisma.telegramDialog.findUnique({ where: { id: stale.id } })).toBeNull();

    const fresh = await env.prisma.telegramDialog.create({
      data: dialog(chatId, new Date(Date.now() - 60_000)),
    });
    await purgeStaleDialogs(env.prisma, new Date());
    expect(await env.prisma.telegramDialog.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});
