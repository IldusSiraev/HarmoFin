import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { activeSessionWhere } from '../push/subscriptions.js';
import type { DeliveryChannel } from './channel-sender.js';

const URGENT_CHANNELS: readonly DeliveryChannel[] = ['EMAIL', 'TELEGRAM', 'PUSH'];

export type UrgentNotificationType = 'PLAN_OVERDUE' | 'CALENDAR_REMINDER';

type ChannelSetting = {
  enabled: boolean;
  urgentEnabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
};

type UrgentInput = {
  notificationId: string;
  workspaceId: string;
  budgetId: string;
  userId: string;
  type: UrgentNotificationType;
  now: Date;
};

/**
 * Called inside the transaction that has just created the in-app notification, so the message is
 * queued exactly when the notification exists: one row per channel with the channel and urgent
 * messages on. Push also needs its per-type switch and a device of an active session. The settings
 * are read here only to avoid queueing messages nobody wants; the sender re-checks everything.
 */
export async function enqueueUrgent(
  tx: Prisma.TransactionClient,
  input: UrgentInput,
): Promise<void> {
  for (const channel of URGENT_CHANNELS) {
    const setting = await tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId: input.userId, channel } },
      select: {
        enabled: true,
        urgentEnabled: true,
        planOverdueEnabled: true,
        calendarReminderEnabled: true,
      },
    });
    if (!setting?.enabled || !setting.urgentEnabled) continue;
    if (channel === 'PUSH' && !(await wantsPush(tx, input, setting))) continue;
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

async function wantsPush(
  tx: Prisma.TransactionClient,
  input: UrgentInput,
  setting: ChannelSetting,
): Promise<boolean> {
  const typeOn =
    input.type === 'PLAN_OVERDUE' ? setting.planOverdueEnabled : setting.calendarReminderEnabled;
  if (!typeOn) return false;
  const devices = await tx.pushSubscription.count({
    where: { userId: input.userId, session: activeSessionWhere(input.now) },
  });
  return devices > 0;
}
