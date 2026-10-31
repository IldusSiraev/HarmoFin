import { describe, expect, it, vi } from 'vitest';

import { enqueueUrgentEmail } from './enqueue.js';

function makeTx(setting: { enabled: boolean; urgentEnabled: boolean } | null) {
  return {
    notificationChannelSetting: { findUnique: vi.fn().mockResolvedValue(setting) },
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

describe('enqueueUrgentEmail', () => {
  it('queues nothing when the e-mail channel is off but urgent mail is on', async () => {
    const tx = makeTx({ enabled: false, urgentEnabled: true });
    await enqueueUrgentEmail(tx as never, input);
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });
});
