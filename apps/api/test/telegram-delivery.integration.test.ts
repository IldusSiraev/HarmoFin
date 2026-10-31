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
    nextResult = {
      ok: false,
      status: 403,
      description: 'Forbidden: bot was blocked by the user',
      retryAfter: null,
    };
    await handler().execute(new Date(), anna.budgetId);
    expect(await row(id)).toMatchObject({
      status: 'CANCELLED',
      lastError: 'TELEGRAM_CHAT_UNAVAILABLE',
    });
    expect(
      await env.prisma.telegramLink.findUnique({ where: { userId: anna.user.id } }),
    ).toBeNull();
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
    nextResult = {
      ok: false,
      status: 400,
      description: "Bad Request: can't parse entities",
      retryAfter: null,
    };
    await handler().execute(new Date(), anna.budgetId);
    expect(await row(bad)).toMatchObject({ status: 'FAILED', lastError: 'TELEGRAM_400' });

    const flaky = await queueUrgent();
    nextResult = { ok: false, status: 502, description: '', retryAfter: null };
    await handler().execute(new Date(), anna.budgetId);
    expect(await row(flaky)).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastError: 'TELEGRAM_502',
    });
  });
});

describe('purgeStaleLinkCodes', () => {
  it('drops codes older than a day and keeps fresh ones', async () => {
    const old = randomUUID();
    const fresh = randomUUID();
    const base = { userId: anna.user.id, consentedAt: new Date(), expiresAt: new Date() };
    await env.prisma.telegramLinkCode.create({
      data: {
        id: old,
        codeHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        createdAt: new Date(Date.now() - 2 * 86_400_000),
        ...base,
      },
    });
    await env.prisma.telegramLinkCode.create({
      data: {
        id: fresh,
        codeHash: randomUUID().replaceAll('-', '').padEnd(64, '1'),
        ...base,
      },
    });
    await purgeStaleLinkCodes(env.prisma, new Date());
    expect(await env.prisma.telegramLinkCode.findUnique({ where: { id: old } })).toBeNull();
    expect(await env.prisma.telegramLinkCode.findUnique({ where: { id: fresh } })).not.toBeNull();
  });
});
