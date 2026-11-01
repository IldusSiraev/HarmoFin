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
