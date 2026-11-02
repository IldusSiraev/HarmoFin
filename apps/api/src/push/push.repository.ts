import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { PrismaService } from '../database/prisma.service.js';

type Tx = Prisma.TransactionClient;

export type PushSettingValues = {
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
};

export type StoredPushSetting = PushSettingValues & { id: string };

export type PushDeviceRow = {
  id: string;
  sessionId: string;
  label: string;
  createdAt: Date;
  lastSuccessAt: Date | null;
};

export type PushSubscriptionData = {
  sessionId: string;
  p256dh: string;
  auth: string;
  applicationServerKey: string;
  label: string;
};

const SETTING_SELECT = {
  id: true,
  enabled: true,
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
} as const;

/** A push device is usable only while the session it was created in is alive. */
export function activeSessionWhere(now: Date): Prisma.SessionWhereInput {
  return { revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } };
}

/**
 * Push subscriptions (one per browser) and the PUSH channel settings. Endpoints and device keys
 * never reach audit values or API responses.
 */
export class PushRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  findSetting(tx: Tx, userId: string): Promise<StoredPushSetting | null> {
    return tx.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId, channel: 'PUSH' } },
      select: SETTING_SELECT,
    });
  }

  /** The PUSH row never carries a digest or amounts. */
  upsertSetting(tx: Tx, userId: string, values: PushSettingValues): Promise<StoredPushSetting> {
    return tx.notificationChannelSetting.upsert({
      where: { userId_channel: { userId, channel: 'PUSH' } },
      create: {
        id: createUuidV7(),
        userId,
        channel: 'PUSH',
        digestFrequency: 'OFF',
        includeAmounts: false,
        ...values,
      },
      update: values,
      select: SETTING_SELECT,
    });
  }

  listActiveDevices(tx: Tx, userId: string, now: Date): Promise<PushDeviceRow[]> {
    return tx.pushSubscription.findMany({
      where: { userId, session: activeSessionWhere(now) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, sessionId: true, label: true, createdAt: true, lastSuccessAt: true },
    });
  }

  findByEndpoint(tx: Tx, endpoint: string) {
    return tx.pushSubscription.findUnique({
      where: { endpoint },
      select: { id: true, userId: true },
    });
  }

  findOwn(tx: Tx, userId: string, id: string) {
    return tx.pushSubscription.findFirst({ where: { id, userId }, select: { id: true } });
  }

  async create(
    tx: Tx,
    input: PushSubscriptionData & { userId: string; endpoint: string; now: Date },
  ): Promise<string> {
    const id = createUuidV7(input.now);
    await tx.pushSubscription.create({
      data: {
        id,
        userId: input.userId,
        sessionId: input.sessionId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        applicationServerKey: input.applicationServerKey,
        label: input.label,
      },
    });
    return id;
  }

  async update(tx: Tx, id: string, data: PushSubscriptionData): Promise<void> {
    await tx.pushSubscription.update({ where: { id }, data });
  }

  async remove(tx: Tx, id: string): Promise<void> {
    await tx.pushSubscription.deleteMany({ where: { id } });
  }

  async idsNewestFirst(tx: Tx, userId: string): Promise<string[]> {
    const rows = await tx.pushSubscription.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  count(tx: Tx, userId: string): Promise<number> {
    return tx.pushSubscription.count({ where: { userId } });
  }

  /** No devices left: the channel is switched off and its unsent pushes are cancelled. */
  async disableChannel(tx: Tx, userId: string): Promise<void> {
    await tx.notificationChannelSetting.updateMany({
      where: { userId, channel: 'PUSH' },
      data: { enabled: false },
    });
    await tx.notificationDelivery.updateMany({
      where: { userId, channel: 'PUSH', status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: 'PUSH_NO_DEVICES' },
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
        source: 'API',
        requestId: entry.requestId ?? null,
      },
    });
  }
}
