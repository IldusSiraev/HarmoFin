import { describe, expect, it, vi } from 'vitest';

import { enqueueUrgent } from './enqueue.js';

type Setting = {
  enabled: boolean;
  urgentEnabled: boolean;
  planOverdueEnabled?: boolean;
  calendarReminderEnabled?: boolean;
} | null;
type Channel = 'EMAIL' | 'TELEGRAM' | 'PUSH';

function makeTx(settings: Partial<Record<Channel, Setting>>, pushDevices = 0) {
  return {
    notificationChannelSetting: {
      findUnique: vi.fn(async ({ where }: { where: { userId_channel: { channel: Channel } } }) => {
        const setting = settings[where.userId_channel.channel];
        return setting
          ? { planOverdueEnabled: true, calendarReminderEnabled: true, ...setting }
          : null;
      }),
    },
    pushSubscription: { count: vi.fn().mockResolvedValue(pushDevices) },
    notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

const input = {
  notificationId: 'n-1',
  workspaceId: 'w-1',
  budgetId: 'b-1',
  userId: 'u-1',
  type: 'PLAN_OVERDUE' as const,
  now: new Date('2026-11-02T09:00:00.000Z'),
};

const queuedChannels = (tx: ReturnType<typeof makeTx>) =>
  tx.notificationDelivery.createMany.mock.calls.map(
    (call) => (call[0] as { data: { channel: string } }).data.channel,
  );

describe('enqueueUrgent', () => {
  it('queues nothing when the e-mail channel is off but urgent mail is on', async () => {
    const tx = makeTx({ EMAIL: { enabled: false, urgentEnabled: true } });
    await enqueueUrgent(tx as never, input);
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('queues one row per enabled channel with the same dedupe key', async () => {
    const tx = makeTx(
      {
        EMAIL: { enabled: true, urgentEnabled: true },
        TELEGRAM: { enabled: true, urgentEnabled: true },
        PUSH: { enabled: true, urgentEnabled: true },
      },
      1,
    );
    await enqueueUrgent(tx as never, input);
    const rows = tx.notificationDelivery.createMany.mock.calls.map(
      (call) => (call[0] as { data: { channel: string; dedupeKey: string } }).data,
    );
    expect(rows.map((row) => row.channel)).toEqual(['EMAIL', 'TELEGRAM', 'PUSH']);
    expect(rows.every((row) => row.dedupeKey === 'urgent:n-1')).toBe(true);
  });

  it('skips a channel with urgent messages off', async () => {
    const tx = makeTx({
      EMAIL: { enabled: true, urgentEnabled: false },
      TELEGRAM: { enabled: true, urgentEnabled: true },
    });
    await enqueueUrgent(tx as never, input);
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(1);
    expect(tx.notificationDelivery.createMany.mock.calls[0]![0]).toMatchObject({
      data: { channel: 'TELEGRAM' },
      skipDuplicates: true,
    });
  });

  it('skips push when the type is switched off', async () => {
    const tx = makeTx(
      { PUSH: { enabled: true, urgentEnabled: true, planOverdueEnabled: false } },
      1,
    );
    await enqueueUrgent(tx as never, input);
    expect(queuedChannels(tx)).toEqual([]);

    const reminder = makeTx(
      { PUSH: { enabled: true, urgentEnabled: true, planOverdueEnabled: false } },
      1,
    );
    await enqueueUrgent(reminder as never, { ...input, type: 'CALENDAR_REMINDER' });
    expect(queuedChannels(reminder)).toEqual(['PUSH']);
  });

  it('skips push without a device of an active session', async () => {
    const tx = makeTx({ PUSH: { enabled: true, urgentEnabled: true } }, 0);
    await enqueueUrgent(tx as never, input);
    expect(queuedChannels(tx)).toEqual([]);
    expect(tx.pushSubscription.count).toHaveBeenCalledWith({
      where: {
        userId: 'u-1',
        session: {
          revokedAt: null,
          idleExpiresAt: { gt: input.now },
          absoluteExpiresAt: { gt: input.now },
        },
      },
    });
  });
});
