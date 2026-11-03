import type { PrismaClient } from '@prisma/client';

const CODE_RETENTION_MS = 86_400_000;

/** Link codes live 15 minutes; anything older than a day is used or expired and is dropped. */
export async function purgeStaleLinkCodes(prisma: PrismaClient, now: Date): Promise<void> {
  await prisma.telegramLinkCode.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - CODE_RETENTION_MS) } },
  });
}

const DIALOG_RETENTION_MS = 86_400_000;

/** Bot dialogs expire 30 minutes after the last step; a day later the leftover row is dropped. */
export async function purgeStaleDialogs(prisma: PrismaClient, now: Date): Promise<void> {
  await prisma.telegramDialog.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - DIALOG_RETENTION_MS) } },
  });
}
