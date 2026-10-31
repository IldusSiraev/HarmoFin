import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

/**
 * The bot was blocked or the chat is gone: the same unlink as /stop in the API, from the worker.
 * Looks the link up by chat, so a user who has meanwhile linked another chat keeps it.
 */
export async function unlinkUnavailableChat(prisma: PrismaClient, chatId: bigint): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const link = await tx.telegramLink.findUnique({
      where: { chatId },
      select: { id: true, userId: true },
    });
    if (!link) return;
    await tx.telegramLink.delete({ where: { id: link.id } });
    await tx.notificationChannelSetting.updateMany({
      where: { userId: link.userId, channel: 'TELEGRAM' },
      data: { enabled: false },
    });
    await tx.notificationDelivery.updateMany({
      where: { userId: link.userId, channel: 'TELEGRAM', status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: 'TELEGRAM_CHAT_UNAVAILABLE' },
    });
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: link.userId,
        entityType: 'telegram_link',
        entityId: link.id,
        action: 'TELEGRAM_UNLINKED',
        newValues: { reason: 'blocked' },
        source: 'WORKER',
        requestId: null,
      },
    });
  });
}
