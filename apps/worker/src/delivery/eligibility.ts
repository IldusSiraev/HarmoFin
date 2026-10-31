import type { PrismaClient } from '@prisma/client';

import type { ClaimedDelivery } from './delivery.repository.js';
import type { DeliveryChannel } from './channel-sender.js';

export type DeliveryFacts = {
  user: { email: string; status: string; emailVerifiedAt: Date | null } | null;
  setting: {
    enabled: boolean;
    urgentEnabled: boolean;
    digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
    includeAmounts: boolean;
  } | null;
  activeMember: boolean;
  budgetActive: boolean;
  notification: { resolvedAt: Date | null; readAt: Date | null } | null;
  telegramLinked: boolean;
};

export type CancelReason =
  | 'USER_INACTIVE'
  | 'EMAIL_NOT_VERIFIED'
  | 'TELEGRAM_NOT_LINKED'
  | 'CHANNEL_DISABLED'
  | 'URGENT_DISABLED'
  | 'DIGEST_DISABLED'
  | 'BUDGET_INACTIVE'
  | 'NOT_A_MEMBER'
  | 'NOTIFICATION_CLOSED';

/**
 * Rights are re-checked at send time, not at enqueue time: a member who left, an address that is no
 * longer confirmed, a switched-off channel or an already handled notification cancel the letter.
 */
export function cancelReason(
  kind: 'URGENT' | 'DIGEST',
  facts: DeliveryFacts,
  channel: DeliveryChannel = 'EMAIL',
): CancelReason | null {
  if (!facts.user || facts.user.status !== 'ACTIVE') return 'USER_INACTIVE';
  if (channel === 'EMAIL' && !facts.user.emailVerifiedAt) return 'EMAIL_NOT_VERIFIED';
  if (channel === 'TELEGRAM' && !facts.telegramLinked) return 'TELEGRAM_NOT_LINKED';
  if (!facts.setting?.enabled) return 'CHANNEL_DISABLED';
  if (kind === 'URGENT' && !facts.setting.urgentEnabled) return 'URGENT_DISABLED';
  if (kind === 'DIGEST' && facts.setting.digestFrequency === 'OFF') return 'DIGEST_DISABLED';
  if (!facts.budgetActive) return 'BUDGET_INACTIVE';
  if (!facts.activeMember) return 'NOT_A_MEMBER';
  if (kind === 'URGENT') {
    const notification = facts.notification;
    if (!notification || notification.resolvedAt || notification.readAt) {
      return 'NOTIFICATION_CLOSED';
    }
  }
  return null;
}

export async function loadDeliveryFacts(
  prisma: PrismaClient,
  delivery: ClaimedDelivery,
): Promise<DeliveryFacts> {
  const [user, setting, membership, budget, notification, telegramLink] = await Promise.all([
    prisma.user.findUnique({
      where: { id: delivery.userId },
      select: { email: true, status: true, emailVerifiedAt: true },
    }),
    prisma.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId: delivery.userId, channel: delivery.channel } },
      select: { enabled: true, urgentEnabled: true, digestFrequency: true, includeAmounts: true },
    }),
    prisma.workspaceMembership.findFirst({
      where: { workspaceId: delivery.workspaceId, userId: delivery.userId, isActive: true },
      select: { id: true },
    }),
    prisma.budget.findFirst({
      where: {
        id: delivery.budgetId,
        workspaceId: delivery.workspaceId,
        status: 'ACTIVE',
        planModelVersion: 2,
        workspace: { status: 'ACTIVE' },
      },
      select: { id: true },
    }),
    delivery.notificationId
      ? prisma.notification.findFirst({
          where: {
            id: delivery.notificationId,
            budgetId: delivery.budgetId,
            userId: delivery.userId,
          },
          select: { resolvedAt: true, readAt: true },
        })
      : Promise.resolve(null),
    delivery.channel === 'TELEGRAM'
      ? prisma.telegramLink.findUnique({ where: { userId: delivery.userId }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  return {
    user,
    setting,
    activeMember: membership !== null,
    budgetActive: budget !== null,
    notification,
    telegramLinked: telegramLink !== null,
  };
}
