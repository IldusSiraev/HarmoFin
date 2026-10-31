import { describe, expect, it, vi } from 'vitest';

import { enqueueUrgent } from './enqueue.js';

type Setting = { enabled: boolean; urgentEnabled: boolean } | null;

function makeTx(settings: { EMAIL?: Setting; TELEGRAM?: Setting }) {
  return {
    notificationChannelSetting: {
      findUnique: vi.fn(
        async ({ where }: { where: { userId_channel: { channel: 'EMAIL' | 'TELEGRAM' } } }) =>
          settings[where.userId_channel.channel] ?? null,
      ),
    },
    notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

const input = {
  notificationId: 'n-1',
  workspaceId: 'w-1',
  budgetId: 'b-1',
  userId: 'u-1',
  now: new Date('2026-11-02T09:00:00.000Z'),
};

describe('enqueueUrgent', () => {
  it('queues nothing when the e-mail channel is off but urgent mail is on', async () => {
    const tx = makeTx({ EMAIL: { enabled: false, urgentEnabled: true } });
    await enqueueUrgent(tx as never, input);
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('queues one row per enabled channel with the same dedupe key', async () => {
    const tx = makeTx({
      EMAIL: { enabled: true, urgentEnabled: true },
      TELEGRAM: { enabled: true, urgentEnabled: true },
    });
    await enqueueUrgent(tx as never, input);
    const rows = tx.notificationDelivery.createMany.mock.calls.map(
      (call) => (call[0] as { data: { channel: string; dedupeKey: string } }).data,
    );
    expect(rows.map((row) => row.channel)).toEqual(['EMAIL', 'TELEGRAM']);
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
});
