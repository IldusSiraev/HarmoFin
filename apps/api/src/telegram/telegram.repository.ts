import type { DigestFrequency, Prisma, UserStatus } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { PrismaService } from '../database/prisma.service.js';

type Tx = Prisma.TransactionClient;

export type UnlinkReason = 'web' | 'stop' | 'blocked' | 'replaced';
export type TelegramAuditSource = 'API' | 'TELEGRAM';

export type TelegramSettingValues = {
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsentAt: Date | null;
};

export type StoredTelegramSetting = TelegramSettingValues & { id: string };

const SETTING_SELECT = {
  id: true,
  enabled: true,
  urgentEnabled: true,
  digestFrequency: true,
  includeAmounts: true,
  amountsConsentAt: true,
} as const;

/**
 * Telegram link, one-time link codes and (task 4) Telegram channel settings. The chat id never
 * reaches audit values; codes are stored only as an HMAC digest.
 */
export class TelegramRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  findUserStatus(tx: Tx, userId: string): Promise<{ status: UserStatus } | null> {
    return tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  }

  /** Voids the user's unused codes and stores the new one. */
  async replaceOpenCodes(
    tx: Tx,
    input: { userId: string; codeHash: string; consentedAt: Date; expiresAt: Date },
  ): Promise<void> {
    await tx.telegramLinkCode.updateMany({
      where: { userId: input.userId, consumedAt: null, expiresAt: { gt: input.consentedAt } },
      data: { consumedAt: input.consentedAt },
    });
    await tx.telegramLinkCode.create({ data: { id: createUuidV7(input.consentedAt), ...input } });
  }

  findOpenCode(tx: Tx, codeHash: string, now: Date) {
    return tx.telegramLinkCode.findFirst({
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true, consentedAt: true, user: { select: { status: true } } },
    });
  }

  async consumeCode(tx: Tx, id: string, now: Date): Promise<boolean> {
    const result = await tx.telegramLinkCode.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    return result.count === 1;
  }

  findLinkByChat(tx: Tx, chatId: bigint) {
    return tx.telegramLink.findUnique({ where: { chatId }, select: { id: true, userId: true } });
  }

  findLinkByUser(tx: Tx, userId: string) {
    return tx.telegramLink.findUnique({
      where: { userId },
      select: { id: true, commandsEnabledAt: true },
    });
  }

  /** Switches bot commands on (with the consent time) or off; switching off ends the open dialog. */
  async setCommands(
    tx: Tx,
    linkId: string,
    values: { commandsEnabledAt: Date | null; commandsConsentAt: Date | null },
  ): Promise<void> {
    const link = await tx.telegramLink.update({
      where: { id: linkId },
      data: values,
      select: { chatId: true },
    });
    if (values.commandsEnabledAt === null) {
      await tx.telegramDialog.deleteMany({ where: { chatId: link.chatId } });
    }
  }

  createLink(tx: Tx, input: { userId: string; chatId: bigint; consentedAt: Date; now: Date }) {
    return tx.telegramLink.create({
      data: {
        id: createUuidV7(input.now),
        userId: input.userId,
        chatId: input.chatId,
        consentedAt: input.consentedAt,
        linkedAt: input.now,
      },
      select: { id: true },
    });
  }

  async refreshLink(tx: Tx, id: string, consentedAt: Date, now: Date): Promise<void> {
    await tx.telegramLink.update({ where: { id }, data: { consentedAt, linkedAt: now } });
  }

  /**
   * Removes the user's link. Unless the link is being replaced by a new chat, the Telegram channel
   * is switched off and its pending messages are cancelled. Returns false when there was no link.
   */
  async removeLink(
    tx: Tx,
    userId: string,
    entry: { reason: UnlinkReason; source: TelegramAuditSource; requestId?: string },
  ): Promise<boolean> {
    const link = await tx.telegramLink.findUnique({ where: { userId }, select: { id: true } });
    if (!link) return false;
    await tx.telegramLink.delete({ where: { id: link.id } });
    if (entry.reason !== 'replaced') {
      await tx.notificationChannelSetting.updateMany({
        where: { userId, channel: 'TELEGRAM' },
        data: { enabled: false },
      });
      await tx.notificationDelivery.updateMany({
        where: { userId, channel: 'TELEGRAM', status: 'PENDING' },
        data: { status: 'CANCELLED', lastError: 'TELEGRAM_UNLINKED' },
      });
    }
    await this.audit(tx, userId, {
      entityType: 'telegram_link',
      entityId: link.id,
      action: 'TELEGRAM_UNLINKED',
      values: { reason: entry.reason },
      source: entry.source,
      ...(entry.requestId ? { requestId: entry.requestId } : {}),
    });
    return true;
  }

  findTelegramSetting(tx: Tx, userId: string): Promise<StoredTelegramSetting | null> {
    return tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId, channel: 'TELEGRAM' } },
      select: SETTING_SELECT,
    });
  }

  upsertTelegramSetting(
    tx: Tx,
    userId: string,
    values: TelegramSettingValues,
  ): Promise<StoredTelegramSetting> {
    return tx.notificationChannelSetting.upsert({
      where: { userId_channel: { userId, channel: 'TELEGRAM' } },
      create: { id: createUuidV7(), userId, channel: 'TELEGRAM', ...values },
      update: values,
      select: SETTING_SELECT,
    });
  }

  async audit(
    tx: Tx,
    userId: string,
    entry: {
      entityType: string;
      entityId: string;
      action: string;
      values?: Record<string, unknown>;
      source: string;
      requestId?: string;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        ...(entry.values ? { newValues: entry.values as Prisma.InputJsonValue } : {}),
        source: entry.source,
        requestId: entry.requestId ?? null,
      },
    });
  }
}
