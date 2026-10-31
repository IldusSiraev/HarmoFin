import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeliveryRepository } from '../../worker/src/delivery/delivery.repository.js';
import { DeliverNotificationsHandler } from '../../worker/src/delivery/deliver.handler.js';
import type { MailMessage } from '../../worker/src/mail/mailer.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
const origin = 'http://localhost:3000';
const sent: MailMessage[] = [];
const mailer = { send: async (message: MailMessage) => void sent.push(message) };
let anna: FamilyActor;
let boris: FamilyActor;
let stranger: FamilyActor;

const handler = () =>
  new DeliverNotificationsHandler(env.prisma, new DeliveryRepository(env.prisma), mailer, origin);

async function enableEmail(actor: FamilyActor, includeAmounts = false) {
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
      includeAmounts,
      amountsConsentAt: includeAmounts ? new Date() : null,
    },
    update: { enabled: true, includeAmounts, amountsConsentAt: includeAmounts ? new Date() : null },
  });
}

async function overdueNotification(actor: FamilyActor) {
  const planId = randomUUID();
  const occurrenceId = randomUUID();
  await env.prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      ownerUserId: actor.user.id,
      name: 'Ипотека',
      planType: 'EXPENSE',
      amountMinor: 4_500_000n,
      anchorOn: new Date('2026-10-01T00:00:00.000Z'),
      startOn: new Date('2026-10-01T00:00:00.000Z'),
      recurrence: 'MONTHLY',
      createdByUserId: actor.user.id,
      updatedByUserId: actor.user.id,
    },
  });
  await env.prisma.planOccurrence.create({
    data: {
      id: occurrenceId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
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
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      userId: actor.user.id,
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

async function queue(actor: FamilyActor, data: Record<string, unknown>) {
  const id = randomUUID();
  await env.prisma.notificationDelivery.create({
    data: {
      id,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      userId: actor.user.id,
      channel: 'EMAIL',
      kind: 'URGENT',
      dedupeKey: `test:${id}`,
      nextAttemptAt: new Date(Date.now() - 1_000),
      ...data,
    },
  });
  return id;
}

const statusOf = async (id: string) =>
  (await env.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  await env.start();
  anna = await env.register();
  boris = await env.join(anna, await env.register(), 'EDITOR');
  stranger = await env.register();
});

beforeEach(async () => {
  sent.length = 0;
  // Integration files run in parallel: every claim below is scoped to this file's budgets.
  await env.prisma.notificationDelivery.updateMany({
    where: { status: 'PENDING', budgetId: { in: [anna.budgetId, stranger.budgetId] } },
    data: { status: 'CANCELLED' },
  });
});

afterAll(async () => {
  await env.stop();
});

describe('DELIVER_NOTIFICATIONS', () => {
  it('sends an urgent letter without amounts and a working unsubscribe link', async () => {
    await enableEmail(anna);
    const id = await queue(anna, { notificationId: await overdueNotification(anna) });

    await handler().execute(new Date(), anna.budgetId);

    expect(await statusOf(id)).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(anna.user.email);
    expect(sent[0]!.subject).toBe('Просрочен платёж «Ипотека»');
    expect(sent[0]!.text).not.toMatch(/45\s000/u);
    const link = /<(.+)>/.exec(sent[0]!.headers['List-Unsubscribe']!)![1]!;
    const token = new URL(link).searchParams.get('token')!;
    const row = await env.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    expect(row.unsubscribeTokenHash).toBe(createHash('sha256').update(token).digest('hex'));

    const response = await env.server.inject({
      method: 'POST',
      url: '/api/v1/notifications/unsubscribe',
      headers: { origin },
      payload: { token },
    });
    expect(response.statusCode).toBe(204);
    const setting = await env.prisma.notificationChannelSetting.findUniqueOrThrow({
      where: { userId_channel: { userId: anna.user.id, channel: 'EMAIL' } },
    });
    expect(setting.enabled).toBe(false);
  });

  it('adds the amount only with consent', async () => {
    await enableEmail(anna, true);
    await queue(anna, { notificationId: await overdueNotification(anna) });
    await handler().execute(new Date(), anna.budgetId);
    expect(sent[0]!.text).toMatch(/Сумма по плану: 45\s000,00\s₽\./u);
  });

  it('cancels a letter for a disabled channel, a read notification and a former member', async () => {
    await enableEmail(anna);
    const read = await overdueNotification(anna);
    await env.prisma.notification.update({ where: { id: read }, data: { readAt: new Date() } });
    const readId = await queue(anna, { notificationId: read });

    await enableEmail(boris);
    const borisId = await queue(boris, {
      kind: 'DIGEST',
      dedupeKey: `digest:DAILY:${randomUUID()}`,
      digestPeriodStart: new Date(Date.now() - 86_400_000),
      digestPeriodEnd: new Date(),
    });
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: anna.workspaceId, userId: boris.user.id },
      data: { isActive: false },
    });

    const strangerId = await queue(stranger, {
      kind: 'DIGEST',
      dedupeKey: `digest:DAILY:${randomUUID()}`,
      digestPeriodStart: new Date(Date.now() - 86_400_000),
      digestPeriodEnd: new Date(),
    });

    await handler().execute(new Date(), anna.budgetId);

    await handler().execute(new Date(), stranger.budgetId);

    expect(sent).toHaveLength(0);
    expect(await statusOf(readId)).toBe('CANCELLED');
    expect(await statusOf(borisId)).toBe('CANCELLED');
    expect(await statusOf(strangerId)).toBe('CANCELLED');
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: anna.workspaceId, userId: boris.user.id },
      data: { isActive: true },
    });
  });

  it('builds a digest from others actions only, inside the budget and the window', async () => {
    await enableEmail(anna);
    const start = new Date(Date.now() - 3_600_000);
    const audit = (actor: FamilyActor | null, budget: FamilyActor, at: Date, entityType = 'transaction') =>
      env.prisma.auditEvent.create({
        data: {
          id: randomUUID(),
          actorUserId: actor?.user.id ?? null,
          workspaceId: budget.workspaceId,
          budgetId: budget.budgetId,
          entityType,
          entityId: randomUUID(),
          action: 'CREATED',
          source: 'API',
          createdAt: at,
        },
      });
    const inside = new Date(Date.now() - 600_000);
    await audit(boris, anna, inside);
    await audit(boris, anna, inside);
    await audit(boris, anna, inside, 'calendar_event');
    await audit(anna, anna, inside); // own action
    await audit(null, anna, inside); // no author
    await audit(boris, anna, new Date(start.getTime() - 60_000)); // before the window
    await audit(boris, anna, inside, 'category'); // not a feed pair
    await audit(stranger, stranger, inside); // other budget

    const id = await queue(anna, {
      kind: 'DIGEST',
      dedupeKey: `digest:DAILY:${randomUUID()}`,
      digestPeriodStart: start,
      digestPeriodEnd: new Date(),
    });
    await handler().execute(new Date(), anna.budgetId);

    expect(await statusOf(id)).toBe('SENT');
    const borisName = (await env.prisma.user.findUniqueOrThrow({ where: { id: boris.user.id } }))
      .displayName!;
    expect(sent[0]!.text).toContain(`${borisName}: 2 операции, 1 событие календаря`);
    expect(sent[0]!.text).not.toContain('Участник:');
  });

  it('cancels an empty digest', async () => {
    await enableEmail(anna);
    const id = await queue(anna, {
      kind: 'DIGEST',
      dedupeKey: `digest:DAILY:${randomUUID()}`,
      digestPeriodStart: new Date(Date.now() - 60_000),
      digestPeriodEnd: new Date(),
    });
    await handler().execute(new Date(), anna.budgetId);
    expect(await statusOf(id)).toBe('CANCELLED');
  });

  it('retries a failing letter and gives up after five attempts', async () => {
    await enableEmail(anna);
    const id = await queue(anna, { notificationId: await overdueNotification(anna) });
    const broken = new DeliverNotificationsHandler(
      env.prisma,
      new DeliveryRepository(env.prisma),
      { send: async () => Promise.reject(Object.assign(new Error('down'), { code: 'ECONNECTION' })) },
      origin,
    );
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await env.prisma.notificationDelivery.update({
        where: { id },
        data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      });
      await broken.execute(new Date(), anna.budgetId);
    }
    const row = await env.prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'ECONNECTION' });
  });

  it('never hands the same letter to two concurrent runs', async () => {
    await enableEmail(anna);
    await queue(anna, { notificationId: await overdueNotification(anna) });
    const repository = new DeliveryRepository(env.prisma);
    const [first, second] = await Promise.all([
      repository.claim(20, new Date(), anna.budgetId),
      repository.claim(20, new Date(), anna.budgetId),
    ]);
    expect(first.length + second.length).toBe(1);
  });
});
