import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

export type PushRemovalReason = 'gone' | 'session' | 'key';

const PURGE_BATCH = 1_000;

/** A push device is usable only while the session it was created in is alive (same as the API). */
export function activeSessionWhere(now: Date): Prisma.SessionWhereInput {
  return { revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } };
}

/**
 * Deletes subscriptions with an audit entry each. A user left without devices gets the PUSH channel
 * switched off and the unsent pushes cancelled, as when the last device is removed in the web.
 */
export async function removePushSubscriptions(
  prisma: PrismaClient,
  ids: readonly string[],
  reason: PushRemovalReason,
): Promise<void> {
  if (ids.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const rows = await tx.pushSubscription.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, userId: true },
    });
    if (rows.length === 0) return;
    await tx.pushSubscription.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    for (const row of rows) {
      await tx.auditEvent.create({
        data: {
          id: randomUUID(),
          actorUserId: row.userId,
          entityType: 'push_subscription',
          entityId: row.id,
          action: 'PUSH_UNSUBSCRIBED',
          newValues: { reason },
          source: 'WORKER',
          requestId: null,
        },
      });
    }
    for (const userId of new Set(rows.map((row) => row.userId))) {
      if ((await tx.pushSubscription.count({ where: { userId } })) > 0) continue;
      await tx.notificationChannelSetting.updateMany({
        where: { userId, channel: 'PUSH' },
        data: { enabled: false },
      });
      await tx.notificationDelivery.updateMany({
        where: { userId, channel: 'PUSH', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'PUSH_NO_DEVICES' },
      });
    }
  });
}

/** A revoked or expired session never comes back, so its devices can never receive a push again. */
export async function purgeInactivePushSubscriptions(
  prisma: PrismaClient,
  now: Date,
): Promise<void> {
  const rows = await prisma.pushSubscription.findMany({
    where: {
      session: {
        OR: [
          { revokedAt: { not: null } },
          { idleExpiresAt: { lte: now } },
          { absoluteExpiresAt: { lte: now } },
        ],
      },
    },
    select: { id: true },
    take: PURGE_BATCH,
  });
  await removePushSubscriptions(
    prisma,
    rows.map((row) => row.id),
    'session',
  );
}
