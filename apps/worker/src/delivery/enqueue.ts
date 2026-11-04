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
 * queued exactly when the notification exists: one row per channel with the channel, urgent
 * messages and this notification type on. Push also needs a device of an active session. The
 * settings are read here only to avoid queueing messages nobody wants; the sender re-checks
 * everything.
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
    if (!typeEnabled(input.type, setting)) continue;
    if (channel === 'PUSH' && !(await hasPushDevice(tx, input))) continue;
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

function typeEnabled(type: UrgentNotificationType, setting: ChannelSetting): boolean {
  return type === 'PLAN_OVERDUE' ? setting.planOverdueEnabled : setting.calendarReminderEnabled;
}

async function hasPushDevice(tx: Prisma.TransactionClient, input: UrgentInput): Promise<boolean> {
  const devices = await tx.pushSubscription.count({
    where: { userId: input.userId, session: activeSessionWhere(input.now) },
  });
  return devices > 0;
}
