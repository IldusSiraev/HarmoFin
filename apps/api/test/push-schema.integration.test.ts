import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

async function extraSession(userId: string): Promise<string> {
  const id = randomUUID();
  const future = new Date(Date.now() + 86_400_000);
  await env.prisma.session.create({
    data: {
      id,
      userId,
      tokenHash: randomBytes(32).toString('hex'),
      csrfTokenHash: randomBytes(32).toString('hex'),
      idleExpiresAt: future,
      absoluteExpiresAt: future,
    },
  });
  return id;
}

function subscription(userId: string, sessionId: string, endpoint: string) {
  return {
    id: randomUUID(),
    userId,
    sessionId,
    endpoint,
    p256dh: 'p'.repeat(87),
    auth: 'a'.repeat(22),
    applicationServerKey: 'k'.repeat(87),
    label: 'Chrome, Android',
  };
}

describe('push_subscriptions', () => {
  it('rejects a duplicate endpoint', async () => {
    const sessionId = await extraSession(anna.user.id);
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    await env.prisma.pushSubscription.create({
      data: subscription(anna.user.id, sessionId, endpoint),
    });
    await expect(
      env.prisma.pushSubscription.create({ data: subscription(anna.user.id, sessionId, endpoint) }),
    ).rejects.toThrow();
  });

  it('is deleted together with its session', async () => {
    const sessionId = await extraSession(anna.user.id);
    const row = subscription(anna.user.id, sessionId, `https://fcm.googleapis.com/${randomUUID()}`);
    await env.prisma.pushSubscription.create({ data: row });
    await env.prisma.session.delete({ where: { id: sessionId } });
    expect(await env.prisma.pushSubscription.findUnique({ where: { id: row.id } })).toBeNull();
  });
});

describe('notification channel PUSH', () => {
  it('stores settings with both type switches on by default', async () => {
    const saved = await env.prisma.notificationChannelSetting.create({
      data: { id: randomUUID(), userId: anna.user.id, channel: 'PUSH', digestFrequency: 'OFF' },
    });
    expect(saved.planOverdueEnabled).toBe(true);
    expect(saved.calendarReminderEnabled).toBe(true);
    expect(saved.enabled).toBe(false);
  });

  it('is accepted by the delivery queue', async () => {
    await env.prisma.notificationDelivery.create({
      data: {
        id: randomUUID(),
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        userId: anna.user.id,
        channel: 'PUSH',
        kind: 'URGENT',
        dedupeKey: `urgent:${randomUUID()}`,
        nextAttemptAt: new Date(),
      },
    });
    const count = await env.prisma.notificationDelivery.count({
      where: { userId: anna.user.id, channel: 'PUSH' },
    });
    expect(count).toBe(1);
  });
});
