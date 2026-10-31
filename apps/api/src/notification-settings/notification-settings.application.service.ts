import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { maskEmail } from './mask-email.js';
import type {
  EmailSettingValues,
  NotificationSettingsRepository,
  StoredEmailSetting,
} from './notification-settings.repository.js';
import type { UpdateEmailSettingsInput } from './notification-settings.schemas.js';
import { hashUnsubscribeToken } from './unsubscribe-token.js';

type Meta = { requestId?: string };

export type EmailSettingsView = {
  email: string;
  emailVerified: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
  includeAmounts: boolean;
  amountsConsentAt: string | null;
};

const DEFAULTS: EmailSettingValues = {
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY',
  includeAmounts: false,
  amountsConsentAt: null,
};

/**
 * Email channel settings of the signed-in user and the public unsubscribe link. Settings are per
 * user, not per budget (one family budget per user in v1). Amounts in letters need an explicit,
 * timestamped consent; the address itself never reaches audit values.
 */
export class NotificationSettingsApplicationService {
  constructor(private readonly repository: NotificationSettingsRepository) {}

  getEmail(userId: string): Promise<EmailSettingsView> {
    return this.repository.transaction(async (tx) => {
      const user = await this.repository.findUser(tx, userId);
      if (!user) throw userMissing();
      const setting = await this.repository.findEmailSetting(tx, userId);
      return view(user, setting ?? DEFAULTS);
    });
  }

  updateEmail(
    userId: string,
    input: UpdateEmailSettingsInput,
    meta: Meta,
  ): Promise<EmailSettingsView> {
    return this.repository.transaction(async (tx) => {
      const user = await this.repository.findUser(tx, userId);
      if (!user) throw userMissing();
      if (input.enabled && !user.emailVerifiedAt) {
        throw new ConflictException({
          code: 'EMAIL_NOT_VERIFIED',
          detail: 'Сначала подтвердите почту.',
        });
      }
      const current = await this.repository.findEmailSetting(tx, userId);
      const hadAmounts = current?.includeAmounts ?? false;
      const grantsAmounts = input.includeAmounts && !hadAmounts;
      if (grantsAmounts && input.amountsConsent !== true) {
        throw new UnprocessableEntityException({
          code: 'AMOUNTS_CONSENT_REQUIRED',
          detail: 'Подтвердите согласие на показ сумм в письмах.',
          fieldErrors: [
            {
              field: 'includeAmounts',
              message: 'Подтвердите согласие на показ сумм в письмах.',
              code: 'custom',
            },
          ],
        });
      }
      const values: EmailSettingValues = {
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
      const saved = await this.repository.upsertEmailSetting(tx, userId, values);
      const requestId = meta.requestId ? { requestId: meta.requestId } : {};
      await this.repository.audit(tx, userId, {
        settingId: saved.id,
        action: 'UPDATED',
        values: {
          channel: 'EMAIL',
          enabled: values.enabled,
          urgentEnabled: values.urgentEnabled,
          digestFrequency: values.digestFrequency,
          includeAmounts: values.includeAmounts,
        },
        ...requestId,
      });
      if (grantsAmounts || (hadAmounts && !input.includeAmounts)) {
        await this.repository.audit(tx, userId, {
          settingId: saved.id,
          action: grantsAmounts ? 'AMOUNTS_CONSENT_GRANTED' : 'AMOUNTS_CONSENT_REVOKED',
          values: { channel: 'EMAIL' },
          ...requestId,
        });
      }
      return view(user, saved);
    });
  }

  /** Always resolves: an unknown token must look exactly like a valid one. */
  async unsubscribe(rawToken: string, meta: Meta): Promise<void> {
    await this.repository.transaction(async (tx) => {
      const delivery = await this.repository.findDeliveryByTokenHash(
        tx,
        hashUnsubscribeToken(rawToken),
      );
      if (!delivery) return;
      const result = await this.repository.disableChannel(tx, delivery.userId, delivery.channel);
      if (!result?.changed) return;
      await this.repository.audit(tx, delivery.userId, {
        settingId: result.id,
        action: 'UNSUBSCRIBED',
        values: { channel: delivery.channel, via: 'link' },
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
      });
    });
  }
}

function view(
  user: { email: string; emailVerifiedAt: Date | null },
  setting: EmailSettingValues | StoredEmailSetting,
): EmailSettingsView {
  return {
    email: maskEmail(user.email),
    emailVerified: user.emailVerifiedAt !== null,
    enabled: setting.enabled,
    urgentEnabled: setting.urgentEnabled,
    digestFrequency: setting.digestFrequency,
    includeAmounts: setting.includeAmounts,
    amountsConsentAt: setting.amountsConsentAt?.toISOString() ?? null,
  };
}

function userMissing(): NotFoundException {
  return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Пользователь не найден.' });
}
