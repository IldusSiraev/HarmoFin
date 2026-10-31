import { describe, expect, it, vi } from 'vitest';

import { CalendarReminderHandler } from './calendar-reminder.handler.js';

const eventSelect = {
  id: true,
  workspaceId: true,
  budgetId: true,
  createdByUserId: true,
  title: true,
  allDay: true,
  startsOn: true,
  endsOn: true,
  startsAt: true,
  endsAt: true,
  recurrence: true,
  interval: true,
  weekdays: true,
  repeatUntil: true,
  reminderMinutes: true,
  budget: { select: { timezone: true } },
  participants: { select: { userId: true } },
};

function weeklyEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    workspaceId: 'workspace-1',
    budgetId: 'budget-1',
    createdByUserId: 'user-a',
    title: 'Кружок',
    allDay: false,
    startsOn: null,
    endsOn: null,
    // 2026-09-01 is a Tuesday; 17:00 Moscow = 14:00 UTC (no DST in Europe/Moscow).
    startsAt: new Date('2026-09-01T14:00:00.000Z'),
    endsAt: new Date('2026-09-01T15:30:00.000Z'),
    recurrence: 'WEEKLY' as const,
    interval: 1,
    weekdays: [2],
    repeatUntil: null,
    reminderMinutes: 60,
    budget: { timezone: 'Europe/Moscow' },
    participants: [{ userId: 'user-b' }, { userId: 'user-c' }],
    ...overrides,
  };
}

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    notification: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    notificationChannelSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ...overrides,
  };
}

function makePrisma(
  events: unknown[],
  tx: ReturnType<typeof makeTx>,
  overrides: Record<string, unknown> = {},
) {
  return {
    calendarEvent: { findMany: vi.fn().mockResolvedValue(events) },
    workspaceMembership: {
      findMany: vi.fn().mockResolvedValue([{ userId: 'user-a' }, { userId: 'user-b' }]),
    },
    // The handler never writes through the root client directly; every insert and audit goes
    // through the callback's `tx`. These spies stay unused unless that invariant breaks.
    notification: { createMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    ...overrides,
  };
}

describe('CalendarReminderHandler', () => {
  it('queries only non-deleted events of active plan-model-2 budgets', async () => {
    const tx = makeTx();
    const prisma = makePrisma([], tx);
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-03T13:05:00Z'));

    expect(prisma.calendarEvent.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        reminderMinutes: { not: null },
        budget: { status: 'ACTIVE', planModelVersion: 2, workspace: { status: 'ACTIVE' } },
      },
      select: eventSelect,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it('reminds the author and active participants of a weekly timed event, skipping an inactive member', async () => {
    const tx = makeTx();
    const prisma = makePrisma([weeklyEvent()], tx);
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-03T13:05:00Z'));

    expect(prisma.workspaceMembership.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        userId: { in: ['user-a', 'user-b', 'user-c'] },
        isActive: true,
      },
      select: { userId: true },
    });

    const calls = tx.notification.createMany.mock.calls.map(
      ([args]) => (args as { data: Record<string, unknown>; skipDuplicates: boolean }).data,
    );
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((data) => data.userId))).toEqual(new Set(['user-a', 'user-b']));
    for (const data of calls) {
      expect(data).toMatchObject({
        workspaceId: 'workspace-1',
        budgetId: 'budget-1',
        notificationType: 'CALENDAR_REMINDER',
        title: 'Кружок',
        body: 'Сегодня в 17:00',
        notificationKey: 'calendar:event-1:2026-11-03:60',
        relatedEntityType: 'calendar_event',
        relatedEntityId: 'event-1',
        actionPath: '/app/calendar?date=2026-11-03',
      });
    }
    expect(
      tx.notification.createMany.mock.calls.every(
        ([args]) => (args as { skipDuplicates: boolean }).skipDuplicates,
      ),
    ).toBe(true);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(2);
    // all writes went through the single per-event transaction, never the root client
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not create a second row on a rerun with the same or a close now, relying on the dedupe key', async () => {
    const tx = makeTx();
    const prisma = makePrisma([weeklyEvent()], tx);
    const handler = new CalendarReminderHandler(prisma as never);

    await handler.execute(new Date('2026-11-03T13:05:00Z'));
    tx.notification.createMany.mockResolvedValue({ count: 0 });
    await handler.execute(new Date('2026-11-03T13:10:00Z'));

    const keys = tx.notification.createMany.mock.calls.map(
      ([args]) => (args as { data: { notificationKey: string } }).data.notificationKey,
    );
    expect(new Set(keys)).toEqual(new Set(['calendar:event-1:2026-11-03:60']));
    // Only the first run's inserts (count: 1) produced an audit event.
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(2);
  });

  it('is silent just before and just after the thirty-minute due window', async () => {
    const beforeTx = makeTx();
    const before = makePrisma([weeklyEvent()], beforeTx);
    await new CalendarReminderHandler(before as never).execute(new Date('2026-11-03T12:59:00Z'));
    expect(before.$transaction).not.toHaveBeenCalled();
    expect(beforeTx.notification.createMany).not.toHaveBeenCalled();

    const afterTx = makeTx();
    const after = makePrisma([weeklyEvent()], afterTx);
    await new CalendarReminderHandler(after as never).execute(new Date('2026-11-03T13:31:00Z'));
    expect(after.$transaction).not.toHaveBeenCalled();
    expect(afterTx.notification.createMany).not.toHaveBeenCalled();
  });

  it('writes relative copy for an all-day event reminded a day ahead', async () => {
    const tx = makeTx();
    const prisma = makePrisma(
      [
        weeklyEvent({
          id: 'event-2',
          allDay: true,
          startsAt: null,
          endsAt: null,
          startsOn: new Date('2026-11-05T00:00:00.000Z'),
          endsOn: new Date('2026-11-05T00:00:00.000Z'),
          recurrence: 'NONE',
          weekdays: [],
          reminderMinutes: 1440,
          participants: [],
        }),
      ],
      tx,
      { workspaceMembership: { findMany: vi.fn().mockResolvedValue([{ userId: 'user-a' }]) } },
    );
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-04T06:10:00Z'));

    const calls = tx.notification.createMany.mock.calls.map(
      ([args]) => (args as { data: Record<string, unknown> }).data,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      userId: 'user-a',
      body: 'Завтра, весь день',
      notificationKey: 'calendar:event-2:2026-11-05:1440',
      actionPath: '/app/calendar?date=2026-11-05',
    });
  });

  it('does not remind an occurrence past the series repeatUntil', async () => {
    const tx = makeTx();
    const prisma = makePrisma(
      [weeklyEvent({ repeatUntil: new Date('2026-10-01T00:00:00.000Z') })],
      tx,
    );
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-03T13:05:00Z'));

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it('rolls back the whole event when the audit write fails, never committing outside the transaction', async () => {
    const tx = makeTx();
    tx.auditEvent.create.mockRejectedValue(new Error('audit insert failed'));
    const prisma = makePrisma([weeklyEvent()], tx);
    const onFailure = vi.fn();

    await expect(
      new CalendarReminderHandler(prisma as never, onFailure).execute(
        new Date('2026-11-03T13:05:00Z'),
      ),
    ).resolves.toBeUndefined();

    // The insert attempt happened inside the (now rejected) transaction, never on the root client.
    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith({ eventId: 'event-1', errorName: 'Error' });
  });

  it('isolates a failing event: reports it without its text and still reminds the next event', async () => {
    const failingTx = makeTx();
    failingTx.notification.createMany.mockRejectedValue(new TypeError('insert failed'));
    const tx = makeTx();
    const prisma = makePrisma(
      [
        weeklyEvent({ id: 'event-a', title: 'Секретное событие' }),
        weeklyEvent({ id: 'event-b', title: 'Кружок' }),
      ],
      tx,
      {
        $transaction: vi
          .fn()
          .mockImplementationOnce(async (callback: (client: unknown) => unknown) =>
            callback(failingTx),
          )
          .mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx)),
      },
    );
    const onFailure = vi.fn();

    await new CalendarReminderHandler(prisma as never, onFailure).execute(
      new Date('2026-11-03T13:05:00Z'),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledTimes(1);
    // Only the id and the error class name are reported: no title, description or message.
    expect(onFailure).toHaveBeenCalledWith({ eventId: 'event-a', errorName: 'TypeError' });
    const created = tx.notification.createMany.mock.calls.map(
      ([args]) => (args as { data: Record<string, unknown> }).data,
    );
    expect(created).toHaveLength(2);
    expect(created.every((data) => data.relatedEntityId === 'event-b')).toBe(true);
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(2);
  });

  it('continues with the next event when the recipient lookup of one event fails', async () => {
    const tx = makeTx();
    const prisma = makePrisma(
      [weeklyEvent({ id: 'event-a' }), weeklyEvent({ id: 'event-b' })],
      tx,
      {
        workspaceMembership: {
          findMany: vi
            .fn()
            .mockRejectedValueOnce(new Error('lookup failed'))
            .mockResolvedValue([{ userId: 'user-a' }]),
        },
      },
    );
    const onFailure = vi.fn();

    await new CalendarReminderHandler(prisma as never, onFailure).execute(
      new Date('2026-11-03T13:05:00Z'),
    );

    expect(onFailure).toHaveBeenCalledWith({ eventId: 'event-a', errorName: 'Error' });
    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
    expect(tx.notification.createMany.mock.calls[0]?.[0]).toMatchObject({
      data: { relatedEntityId: 'event-b', userId: 'user-a' },
    });
  });

  it('still rejects when the event query itself fails, so the job is retried', async () => {
    const prisma = makePrisma([], makeTx(), {
      calendarEvent: { findMany: vi.fn().mockRejectedValue(new Error('query failed')) },
    });

    await expect(
      new CalendarReminderHandler(prisma as never, vi.fn()).execute(
        new Date('2026-11-03T13:05:00Z'),
      ),
    ).rejects.toThrow('query failed');
  });

  it('queues an urgent letter for each newly created reminder of a subscriber', async () => {
    const tx = makeTx({
      notificationChannelSetting: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true, urgentEnabled: true }),
      },
      notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    });
    const prisma = makePrisma([weeklyEvent()], tx);
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-03T13:05:00Z'));

    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(2);
    expect(tx.notificationDelivery.createMany.mock.calls[0]![0]).toMatchObject({
      data: { kind: 'URGENT', channel: 'EMAIL', budgetId: 'budget-1', workspaceId: 'workspace-1' },
      skipDuplicates: true,
    });
  });

  it('queues nothing for a reminder the unique key skipped', async () => {
    const tx = makeTx({
      notification: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      notificationChannelSetting: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true, urgentEnabled: true }),
      },
      notificationDelivery: { createMany: vi.fn() },
    });
    const prisma = makePrisma([weeklyEvent()], tx);
    await new CalendarReminderHandler(prisma as never).execute(new Date('2026-11-03T13:05:00Z'));

    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });
});
