import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BuildEmailDigestsHandler } from '../../worker/src/delivery/build-digests.handler.js';
import { enqueueUrgent } from '../../worker/src/delivery/enqueue.js';
import { purgeInactivePushSubscriptions } from '../../worker/src/push/subscriptions.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';
import {
  addSubscription,
  currentSessionId,
  overdueNotification,
  revokedSessionId,
} from './helpers/push.js';

const env = new FamilyTestApp();
let anna: FamilyActor;

async function pushSetting(values: {
  planOverdueEnabled?: boolean;
  digestFrequency?: 'OFF' | 'DAILY';
}) {
  await env.prisma.notificationChannelSetting.create({
    data: {
      id: randomUUID(),
      userId: anna.user.id,
      channel: 'PUSH',
      enabled: true,
      digestFrequency: values.digestFrequency ?? 'OFF',
      planOverdueEnabled: values.planOverdueEnabled ?? true,
    },
  });
}

async function enqueue(notificationId: string) {
  await env.prisma.$transaction((tx) =>
    enqueueUrgent(tx, {
      notificationId,
      workspaceId: anna.workspaceId,
      budgetId: anna.budgetId,
      userId: anna.user.id,
      type: 'PLAN_OVERDUE',
      now: new Date(),
    }),
  );
}

const pushRows = () =>
  env.prisma.notificationDelivery.findMany({ where: { userId: anna.user.id, channel: 'PUSH' } });

beforeAll(async () => {
  await env.start();
  anna = await env.register();
});

afterAll(async () => {
  await env.stop();
});

beforeEach(async () => {
  await env.prisma.notificationDelivery.deleteMany({ where: { userId: anna.user.id } });
  await env.prisma.pushSubscription.deleteMany({ where: { userId: anna.user.id } });
  await env.prisma.notificationChannelSetting.deleteMany({ where: { userId: anna.user.id } });
});

describe('push in the delivery queue', () => {
  it('queues an urgent push for a device of the active session', async () => {
    await pushSetting({});
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await currentSessionId(env.prisma, anna.user.id),
    });
    const { notificationId } = await overdueNotification(env.prisma, anna);
    await enqueue(notificationId);
    const rows = await pushRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'URGENT', dedupeKey: `urgent:${notificationId}` });
  });

  it('does not queue with the type switched off or only a revoked device', async () => {
    await pushSetting({ planOverdueEnabled: false });
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await currentSessionId(env.prisma, anna.user.id),
    });
    await enqueue((await overdueNotification(env.prisma, anna)).notificationId);
    expect(await pushRows()).toHaveLength(0);

    await env.prisma.notificationChannelSetting.updateMany({
      where: { userId: anna.user.id, channel: 'PUSH' },
      data: { planOverdueEnabled: true },
    });
    await env.prisma.pushSubscription.deleteMany({ where: { userId: anna.user.id } });
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await revokedSessionId(env.prisma, anna.user.id),
    });
    await enqueue((await overdueNotification(env.prisma, anna)).notificationId);
    expect(await pushRows()).toHaveLength(0);
  });

  it('never builds a push digest', async () => {
    await pushSetting({ digestFrequency: 'DAILY' });
    await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await currentSessionId(env.prisma, anna.user.id),
    });
    const handler = new BuildEmailDigestsHandler(env.prisma, ['EMAIL', 'TELEGRAM']);
    await handler.execute(new Date('2026-11-02T05:00:00.000Z'), anna.budgetId);
    expect(await pushRows()).toHaveLength(0);
  });
});

describe('purgeInactivePushSubscriptions', () => {
  it('removes devices of revoked sessions and switches the channel off without devices', async () => {
    await pushSetting({});
    const live = await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await currentSessionId(env.prisma, anna.user.id),
    });
    const dead = await addSubscription(env.prisma, {
      userId: anna.user.id,
      sessionId: await revokedSessionId(env.prisma, anna.user.id),
    });

    await purgeInactivePushSubscriptions(env.prisma, new Date());
    expect(await env.prisma.pushSubscription.findUnique({ where: { id: dead.id } })).toBeNull();
    expect(await env.prisma.pushSubscription.findUnique({ where: { id: live.id } })).not.toBeNull();
    const audit = await env.prisma.auditEvent.findFirst({
      where: { entityId: dead.id, action: 'PUSH_UNSUBSCRIBED' },
    });
    expect(audit?.newValues).toEqual({ reason: 'session' });
    const setting = await env.prisma.notificationChannelSetting.findFirstOrThrow({
      where: { userId: anna.user.id, channel: 'PUSH' },
    });
    expect(setting.enabled).toBe(true);

    await env.prisma.pushSubscription.update({
      where: { id: live.id },
      data: { sessionId: await revokedSessionId(env.prisma, anna.user.id) },
    });
    await purgeInactivePushSubscriptions(env.prisma, new Date());
    const after = await env.prisma.notificationChannelSetting.findFirstOrThrow({
      where: { userId: anna.user.id, channel: 'PUSH' },
    });
    expect(after.enabled).toBe(false);
  });
});
