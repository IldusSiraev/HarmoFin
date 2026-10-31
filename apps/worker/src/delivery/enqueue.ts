import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

/**
 * Called inside the transaction that has just created the in-app notification, so the letter is
 * queued exactly when the notification exists. The settings are read here only to avoid queueing
 * letters nobody wants; the sender re-checks everything before sending.
 */
export async function enqueueUrgentEmail(
  tx: Prisma.TransactionClient,
  input: {
    notificationId: string;
    workspaceId: string;
    budgetId: string;
    userId: string;
    now: Date;
  },
): Promise<void> {
  const setting = await tx.notificationChannelSetting.findUnique({
    where: { userId_channel: { userId: input.userId, channel: 'EMAIL' } },
    select: { enabled: true, urgentEnabled: true },
  });
  if (!setting?.enabled || !setting.urgentEnabled) return;
  await tx.notificationDelivery.createMany({
    data: {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      budgetId: input.budgetId,
      userId: input.userId,
      channel: 'EMAIL',
      kind: 'URGENT',
      notificationId: input.notificationId,
      dedupeKey: `urgent:${input.notificationId}`,
      nextAttemptAt: input.now,
    },
    skipDuplicates: true,
  });
}
