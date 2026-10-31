import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import type { UpdateEmailSettingsInput } from '../notification-settings/notification-settings.schemas.js';
import type {
  StoredTelegramSetting,
  TelegramRepository,
  TelegramSettingValues,
} from './telegram.repository.js';

type Meta = { requestId?: string };

export type TelegramSettingsView = {
  available: boolean;
  linked: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
  includeAmounts: boolean;
  amountsConsentAt: string | null;
};

const DEFAULTS: TelegramSettingValues = {
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY',
  includeAmounts: false,
  amountsConsentAt: null,
};

const AMOUNTS_CONSENT_MESSAGE = 'Подтвердите согласие на показ сумм в сообщениях Telegram.';

/**
 * Telegram channel settings of the signed-in user. Same rules as the email channel, with its own
 * amounts consent: the email consent does not cover Telegram. The channel can be switched on only
 * with a linked chat.
 */
export class TelegramSettingsApplicationService {
  constructor(
    private readonly repository: TelegramRepository,
    private readonly available: boolean,
  ) {}

  get(userId: string): Promise<TelegramSettingsView> {
    return this.repository.transaction(async (tx) => {
      const link = await this.repository.findLinkByUser(tx, userId);
      const setting = await this.repository.findTelegramSetting(tx, userId);
      return this.view(link !== null, setting ?? DEFAULTS);
    });
  }

  update(
    userId: string,
    input: UpdateEmailSettingsInput,
    meta: Meta,
  ): Promise<TelegramSettingsView> {
    return this.repository.transaction(async (tx) => {
      const link = await this.repository.findLinkByUser(tx, userId);
      if (input.enabled && (!this.available || !link)) {
        throw new ConflictException({
          code: 'TELEGRAM_NOT_LINKED',
          detail: 'Сначала подключите Telegram.',
        });
      }
      const current = await this.repository.findTelegramSetting(tx, userId);
      const hadAmounts = current?.includeAmounts ?? false;
      const grantsAmounts = input.includeAmounts && !hadAmounts;
      if (grantsAmounts && input.amountsConsent !== true) {
        throw new UnprocessableEntityException({
          code: 'AMOUNTS_CONSENT_REQUIRED',
          detail: AMOUNTS_CONSENT_MESSAGE,
          fieldErrors: [
            { field: 'includeAmounts', message: AMOUNTS_CONSENT_MESSAGE, code: 'custom' },
          ],
        });
      }
      const values: TelegramSettingValues = {
        enabled: input.enabled,
        urgentEnabled: input.urgentEnabled,
        digestFrequency: input.digestFrequency,
        includeAmounts: input.includeAmounts,
        amountsConsentAt: !input.includeAmounts
          ? null
          : grantsAmounts
            ? new Date()
            : (current?.amountsConsentAt ?? new Date()),
      };
      const saved = await this.repository.upsertTelegramSetting(tx, userId, values);
      const requestId = meta.requestId ? { requestId: meta.requestId } : {};
      await this.repository.audit(tx, userId, {
        entityType: 'notification_settings',
        entityId: saved.id,
        action: 'UPDATED',
        values: {
          channel: 'TELEGRAM',
          enabled: values.enabled,
          urgentEnabled: values.urgentEnabled,
          digestFrequency: values.digestFrequency,
          includeAmounts: values.includeAmounts,
        },
        source: 'API',
        ...requestId,
      });
      if (grantsAmounts || (hadAmounts && !input.includeAmounts)) {
        await this.repository.audit(tx, userId, {
          entityType: 'notification_settings',
          entityId: saved.id,
          action: grantsAmounts ? 'AMOUNTS_CONSENT_GRANTED' : 'AMOUNTS_CONSENT_REVOKED',
          values: { channel: 'TELEGRAM' },
          source: 'API',
          ...requestId,
        });
      }
      return this.view(link !== null, saved);
    });
  }

  private view(
    linked: boolean,
    setting: TelegramSettingValues | StoredTelegramSetting,
  ): TelegramSettingsView {
    return {
      available: this.available,
      linked,
      enabled: setting.enabled,
      urgentEnabled: setting.urgentEnabled,
      digestFrequency: setting.digestFrequency,
      includeAmounts: setting.includeAmounts,
      amountsConsentAt: setting.amountsConsentAt?.toISOString() ?? null,
    };
  }
}
