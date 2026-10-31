import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import type { DeliveryChannel } from './channel-sender.js';

const URGENT_CHANNELS: readonly DeliveryChannel[] = ['EMAIL', 'TELEGRAM'];

/**
 * Called inside the transaction that has just created the in-app notification, so the message is
 * queued exactly when the notification exists: one row per channel with the channel and urgent
 * messages on. The settings are read here only to avoid queueing messages nobody wants; the sender
 * re-checks everything before sending.
 */
export async function enqueueUrgent(
  tx: Prisma.TransactionClient,
  input: {
    notificationId: string;
    workspaceId: string;
    budgetId: string;
    userId: string;
    now: Date;
  },
): Promise<void> {
  for (const channel of URGENT_CHANNELS) {
    const setting = await tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId: input.userId, channel } },
      select: { enabled: true, urgentEnabled: true },
    });
    if (!setting?.enabled || !setting.urgentEnabled) continue;
    await tx.notificationDelivery.createMany({
      data: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        budgetId: input.budgetId,
        userId: input.userId,
        channel,
        kind: 'URGENT',
        notificationId: input.notificationId,
        dedupeKey: `urgent:${input.notificationId}`,
        nextAttemptAt: input.now,
      },
      skipDuplicates: true,
    });
  }
}
