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
    expect(await row(queued.id)).toMatchObject({
      status: 'CANCELLED',
      lastError: 'PUSH_NO_DEVICES',
    });
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
    expect(await row(queued.id)).toMatchObject({
      status: 'CANCELLED',
      lastError: 'PUSH_NO_DEVICES',
    });
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
