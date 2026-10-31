import type { DigestFrequency, NotificationChannel, Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { PrismaService } from '../database/prisma.service.js';

type Tx = Prisma.TransactionClient;

export type EmailSettingValues = {
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsentAt: Date | null;
};

export type StoredEmailSetting = EmailSettingValues & { id: string };

export class NotificationSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  findUser(tx: Tx, userId: string) {
    return tx.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
  }

  findEmailSetting(tx: Tx, userId: string): Promise<StoredEmailSetting | null> {
    return tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId, channel: 'EMAIL' } },
      select: {
        id: true,
        enabled: true,
        urgentEnabled: true,
        digestFrequency: true,
        includeAmounts: true,
        amountsConsentAt: true,
      },
    });
  }

  upsertEmailSetting(
    tx: Tx,
    userId: string,
    values: EmailSettingValues,
  ): Promise<StoredEmailSetting> {
    return tx.notificationChannelSetting.upsert({
      where: { userId_channel: { userId, channel: 'EMAIL' } },
      create: { id: createUuidV7(), userId, channel: 'EMAIL', ...values },
      update: values,
      select: {
        id: true,
        enabled: true,
        urgentEnabled: true,
        digestFrequency: true,
        includeAmounts: true,
        amountsConsentAt: true,
      },
    });
  }

  findDeliveryByTokenHash(tx: Tx, tokenHash: string) {
    return tx.notificationDelivery.findUnique({
      where: { unsubscribeTokenHash: tokenHash },
      select: { userId: true, channel: true },
    });
  }

  /** Turns the channel off; `changed` is false when it was already off or never stored. */
  async disableChannel(
    tx: Tx,
    userId: string,
    channel: NotificationChannel,
  ): Promise<{ id: string; changed: boolean } | null> {
    const setting = await tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId, channel } },
      select: { id: true, enabled: true },
    });
    if (!setting) return null;
    if (!setting.enabled) return { id: setting.id, changed: false };
    await tx.notificationChannelSetting.update({
      where: { id: setting.id },
      data: { enabled: false },
    });
    return { id: setting.id, changed: true };
  }

  async audit(
    tx: Tx,
    userId: string,
    entry: {
      settingId: string;
      action: string;
      values: Record<string, unknown>;
      requestId?: string;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        entityType: 'notification_settings',
        entityId: entry.settingId,
        action: entry.action,
        newValues: entry.values as Prisma.InputJsonValue,
        source: 'API',
        requestId: entry.requestId ?? null,
      },
    });
  }
}
