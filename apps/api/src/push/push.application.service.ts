import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { deviceLabel } from './device-label.js';
import { isAllowedPushEndpoint } from './push-endpoint.js';
import type { CreatePushSubscriptionInput, UpdatePushSettingsInput } from './push.schemas.js';
import type { PushRepository, PushSettingValues } from './push.repository.js';

type Tx = Prisma.TransactionClient;
type Meta = { requestId?: string; userAgent?: string };

export const MAX_PUSH_DEVICES = 10;

export type PushDeviceView = {
  id: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  current: boolean;
};

export type PushSettingsView = {
  available: boolean;
  vapidPublicKey: string | null;
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
  devices: PushDeviceView[];
};

const DEFAULTS: PushSettingValues = {
  enabled: false,
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
};

const ENDPOINT_MESSAGE = 'Этот адрес push-сервиса не поддерживается.';

/**
 * Push channel of the signed-in user: the device list (subscriptions bound to sessions) and the
 * per-type switches. Only devices of active sessions are shown or counted. The first device switches
 * the channel on, removing the last one switches it off.
 */
export class PushApplicationService {
  constructor(
    private readonly repository: PushRepository,
    private readonly vapidPublicKey: string | null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get(userId: string, sessionId: string): Promise<PushSettingsView> {
    return this.repository.transaction((tx) => this.view(tx, userId, sessionId, this.clock()));
  }

  update(
    userId: string,
    sessionId: string,
    input: UpdatePushSettingsInput,
    meta: Meta,
  ): Promise<PushSettingsView> {
    return this.repository.transaction(async (tx) => {
      const now = this.clock();
      const devices = await this.repository.listActiveDevices(tx, userId, now);
      if (input.enabled && devices.length === 0) {
        throw new ConflictException({
          code: 'PUSH_NO_DEVICES',
          detail: 'Сначала включите уведомления на устройстве.',
        });
      }
      const saved = await this.repository.upsertSetting(tx, userId, input);
      await this.repository.audit(tx, userId, {
        entityType: 'notification_settings',
        entityId: saved.id,
        action: 'UPDATED',
        values: { channel: 'PUSH', ...input },
        ...this.requestIdOf(meta),
      });
      return this.view(tx, userId, sessionId, now);
    });
  }

  async subscribe(
    userId: string,
    sessionId: string,
    input: CreatePushSubscriptionInput,
    meta: Meta,
  ): Promise<PushSettingsView> {
    const vapidPublicKey = this.vapidPublicKey;
    if (!vapidPublicKey) {
      throw new ConflictException({
        code: 'PUSH_UNAVAILABLE',
        detail: 'Push-уведомления не настроены на сервере.',
      });
    }
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw new UnprocessableEntityException({
        code: 'PUSH_ENDPOINT_NOT_ALLOWED',
        detail: ENDPOINT_MESSAGE,
        fieldErrors: [{ field: 'endpoint', message: ENDPOINT_MESSAGE, code: 'custom' }],
      });
    }
    return this.repository.transaction(async (tx) => {
      const now = this.clock();
      const data = {
        sessionId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        applicationServerKey: vapidPublicKey,
        label: deviceLabel(meta.userAgent),
      };
      const existing = await this.repository.findByEndpoint(tx, input.endpoint);
      if (existing && existing.userId === userId) {
        await this.repository.update(tx, existing.id, data);
      } else {
        if (existing) await this.removeDevice(tx, existing.userId, existing.id, 'replaced', meta);
        const id = await this.repository.create(tx, {
          ...data,
          userId,
          endpoint: input.endpoint,
          now,
        });
        await this.repository.audit(tx, userId, {
          entityType: 'push_subscription',
          entityId: id,
          action: 'PUSH_SUBSCRIBED',
          ...this.requestIdOf(meta),
        });
      }
      const ids = await this.repository.idsNewestFirst(tx, userId);
      for (const extra of ids.slice(MAX_PUSH_DEVICES)) {
        await this.removeDevice(tx, userId, extra, 'limit', meta);
      }
      const current = await this.repository.findSetting(tx, userId);
      await this.repository.upsertSetting(tx, userId, {
        enabled: true,
        planOverdueEnabled: current?.planOverdueEnabled ?? DEFAULTS.planOverdueEnabled,
        calendarReminderEnabled:
          current?.calendarReminderEnabled ?? DEFAULTS.calendarReminderEnabled,
      });
      return this.view(tx, userId, sessionId, now);
    });
  }

  unsubscribe(userId: string, subscriptionId: string, meta: Meta): Promise<void> {
    return this.repository.transaction(async (tx) => {
      const own = await this.repository.findOwn(tx, userId, subscriptionId);
      if (!own) return;
      await this.removeDevice(tx, userId, own.id, 'web', meta);
    });
  }

  /** Deletes one device of `ownerId`; without devices left the owner's channel is switched off. */
  private async removeDevice(
    tx: Tx,
    ownerId: string,
    subscriptionId: string,
    reason: 'web' | 'replaced' | 'limit',
    meta: Meta,
  ): Promise<void> {
    await this.repository.remove(tx, subscriptionId);
    await this.repository.audit(tx, ownerId, {
      entityType: 'push_subscription',
      entityId: subscriptionId,
      action: 'PUSH_UNSUBSCRIBED',
      values: { reason },
      ...this.requestIdOf(meta),
    });
    if ((await this.repository.count(tx, ownerId)) === 0) {
      await this.repository.disableChannel(tx, ownerId);
    }
  }

  private async view(
    tx: Tx,
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<PushSettingsView> {
    const setting = (await this.repository.findSetting(tx, userId)) ?? DEFAULTS;
    const devices = await this.repository.listActiveDevices(tx, userId, now);
    return {
      available: this.vapidPublicKey !== null,
      vapidPublicKey: this.vapidPublicKey,
      enabled: setting.enabled,
      planOverdueEnabled: setting.planOverdueEnabled,
      calendarReminderEnabled: setting.calendarReminderEnabled,
      devices: devices.map((device) => ({
        id: device.id,
        label: device.label,
        createdAt: device.createdAt.toISOString(),
        lastSuccessAt: device.lastSuccessAt?.toISOString() ?? null,
        current: device.sessionId === sessionId,
      })),
    };
  }

  private requestIdOf(meta: Meta): { requestId?: string } {
    return meta.requestId ? { requestId: meta.requestId } : {};
  }
}
