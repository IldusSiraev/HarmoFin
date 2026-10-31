import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FEED_SOURCES } from '../src/activity-feed/feed-kinds.js';
import { BuildEmailDigestsHandler } from '../../worker/src/delivery/build-digests.handler.js';
import { DIGEST_SOURCES } from '../../worker/src/delivery/digest-sources.js';
import { CalendarReminderHandler } from '../../worker/src/calendar-reminder.handler.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let anna: FamilyActor;
let boris: FamilyActor;

// 2026-11-02 is a Monday; 09:00 in UTC.
const mondayMorning = new Date('2026-11-02T09:00:00.000Z');

async function subscribe(actor: FamilyActor, digestFrequency: 'DAILY' | 'WEEKLY' | 'OFF') {
  await env.prisma.user.update({
    where: { id: actor.user.id },
    data: { emailVerifiedAt: new Date() },
  });
  await env.prisma.notificationChannelSetting.upsert({
    where: { userId_channel: { userId: actor.user.id, channel: 'EMAIL' } },
    create: {
      id: randomUUID(),
      userId: actor.user.id,
      channel: 'EMAIL',
      enabled: true,
      digestFrequency,
    },
    update: { enabled: true, digestFrequency },
  });
}

const digests = (actor: FamilyActor) =>
  env.prisma.notificationDelivery.findMany({
    where: { userId: actor.user.id, kind: 'DIGEST' },
    orderBy: { createdAt: 'asc' },
  });

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  boris = await env.join(anna, await env.register(), 'VIEWER');
  await env.prisma.budget.update({ where: { id: anna.budgetId }, data: { timezone: 'UTC' } });
});

afterAll(async () => {
  await env.stop();
});

describe('digest sources', () => {
  it('match the activity feed whitelist', () => {
    const pairs = (items: ReadonlyArray<{ entityType: string; action: string }>) =>
      items.map((item) => `${item.entityType}:${item.action}`).sort();
    expect(pairs(DIGEST_SOURCES)).toEqual(pairs(FEED_SOURCES));
  });
});

describe('BUILD_EMAIL_DIGESTS', () => {
  it('queues one digest per slot, also for a viewer, and none outside the slot', async () => {
    await subscribe(anna, 'DAILY');
    await subscribe(boris, 'WEEKLY');
    const handler = new BuildEmailDigestsHandler(env.prisma);

    await handler.execute(new Date('2026-11-02T07:59:00.000Z'), anna.budgetId);
    expect(await digests(anna)).toHaveLength(0);

    await handler.execute(mondayMorning, anna.budgetId);
    await handler.execute(new Date(mondayMorning.getTime() + 15 * 60_000), anna.budgetId);

    const annaRows = await digests(anna);
    expect(annaRows).toHaveLength(1);
    expect(annaRows[0]).toMatchObject({
      dedupeKey: 'digest:DAILY:2026-11-02',
      budgetId: anna.budgetId,
      status: 'PENDING',
    });
    expect(annaRows[0]!.digestPeriodStart).toEqual(new Date(mondayMorning.getTime() - 86_400_000));
    expect((await digests(boris))[0]).toMatchObject({ dedupeKey: 'digest:WEEKLY:2026-11-02' });
  });

  it('continues the window from the last finished digest', async () => {
    const [first] = await digests(anna);
    await env.prisma.notificationDelivery.update({
      where: { id: first!.id },
      data: { status: 'SENT' },
    });
    const tuesday = new Date('2026-11-03T08:30:00.000Z');
    await new BuildEmailDigestsHandler(env.prisma).execute(tuesday, anna.budgetId);
    const second = (await digests(anna)).find((row) => row.dedupeKey === 'digest:DAILY:2026-11-03')!;
    expect(second.digestPeriodStart).toEqual(first!.digestPeriodEnd);
  });

  it('skips users with the digest off, an unverified address or the channel off', async () => {
    const carol = await env.join(anna, await env.register(), 'EDITOR');
    await subscribe(carol, 'OFF');
    const dave = await env.join(anna, await env.register(), 'EDITOR');
    await env.prisma.notificationChannelSetting.create({
      data: { id: randomUUID(), userId: dave.user.id, channel: 'EMAIL', enabled: true },
    });
    // Verified, digest on, but the e-mail channel is switched off.
    const eve = await env.join(anna, await env.register(), 'EDITOR');
    await env.prisma.user.update({
      where: { id: eve.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    await env.prisma.notificationChannelSetting.create({
      data: {
        id: randomUUID(),
        userId: eve.user.id,
        channel: 'EMAIL',
        enabled: false,
        digestFrequency: 'DAILY',
      },
    });
    await new BuildEmailDigestsHandler(env.prisma).execute(mondayMorning, anna.budgetId);
    expect(await digests(carol)).toHaveLength(0);
    expect(await digests(dave)).toHaveLength(0);
    expect(await digests(eve)).toHaveLength(0);
  });

  it('drops finished rows older than 90 days', async () => {
    const id = randomUUID();
    await env.prisma.notificationDelivery.create({
      data: {
        id,
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        userId: anna.user.id,
        channel: 'EMAIL',
        kind: 'DIGEST',
        dedupeKey: `digest:DAILY:old-${id}`,
        nextAttemptAt: new Date(),
        status: 'SENT',
      },
    });
    await env.prisma.$executeRaw`
      UPDATE "notification_deliveries" SET "updated_at" = now() - interval '91 days' WHERE "id" = ${id}::uuid`;
    await new BuildEmailDigestsHandler(env.prisma).execute(new Date(), anna.budgetId);
    expect(await env.prisma.notificationDelivery.findUnique({ where: { id } })).toBeNull();
  });
});

describe('urgent letters', () => {
  it('are queued with a new calendar reminder for a subscriber only', async () => {
    await subscribe(anna, 'OFF');
    const eventId = randomUUID();
    // Reminder 60 min ahead of a start in 45 min: due 15 min ago, inside the 30-min window.
    const startsAt = new Date(Date.now() + 45 * 60_000);
    await env.prisma.calendarEvent.create({
      data: {
        id: eventId,
        workspaceId: anna.workspaceId,
        budgetId: anna.budgetId,
        createdByUserId: anna.user.id,
        title: 'Родительское собрание',
        allDay: false,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        recurrence: 'NONE',
        interval: 1,
        weekdays: [],
        reminderMinutes: 60,
      },
    });
    const handler = new CalendarReminderHandler(env.prisma);
    await handler.execute(new Date());
    await handler.execute(new Date());

    const rows = await env.prisma.notificationDelivery.findMany({
      where: { userId: anna.user.id, kind: 'URGENT' },
      include: { notification: { select: { relatedEntityId: true } } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.notification?.relatedEntityId).toBe(eventId);
    expect(rows[0]!.dedupeKey).toBe(`urgent:${rows[0]!.notificationId}`);
  });
});
