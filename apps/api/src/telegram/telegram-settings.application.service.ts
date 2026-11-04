import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import type { UpdateEmailSettingsInput } from '../notification-settings/notification-settings.schemas.js';
import type { UpdateTelegramCommandsInput } from './telegram.schemas.js';
import type {
  StoredTelegramSetting,
  TelegramRepository,
  TelegramSettingValues,
} from './telegram.repository.js';

type Meta = { requestId?: string };
type LinkState = { id: string; commandsEnabledAt: Date | null } | null;

export type TelegramSettingsView = {
  available: boolean;
  linked: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: 'OFF' | 'DAILY' | 'WEEKLY';
  includeAmounts: boolean;
  amountsConsentAt: string | null;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
  commandsEnabled: boolean;
};

const DEFAULTS: TelegramSettingValues = {
  enabled: false,
  urgentEnabled: true,
  digestFrequency: 'DAILY',
  includeAmounts: false,
  amountsConsentAt: null,
  planOverdueEnabled: true,
  calendarReminderEnabled: true,
};

const AMOUNTS_CONSENT_MESSAGE = 'Подтвердите согласие на показ сумм в сообщениях Telegram.';
const COMMANDS_CONSENT_MESSAGE = 'Подтвердите согласие на включение команд бота.';

/**
 * Telegram channel settings of the signed-in user. Same rules as the email channel, with its own
 * amounts consent: the email consent does not cover Telegram. The channel can be switched on only
 * with a linked chat. Bot commands have a separate switch and consent stored on the link itself,
 * so a new chat always starts with commands off.
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
      return this.view(link, setting ?? DEFAULTS);
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
        planOverdueEnabled:
          input.planOverdueEnabled ?? current?.planOverdueEnabled ?? DEFAULTS.planOverdueEnabled,
        calendarReminderEnabled:
          input.calendarReminderEnabled ??
          current?.calendarReminderEnabled ??
          DEFAULTS.calendarReminderEnabled,
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
          planOverdueEnabled: values.planOverdueEnabled,
          calendarReminderEnabled: values.calendarReminderEnabled,
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
      return this.view(link, saved);
    });
  }

  /** Bot commands need a linked chat; switching them on the first time needs consent: true. */
  setCommands(
    userId: string,
    input: UpdateTelegramCommandsInput,
    meta: Meta,
  ): Promise<TelegramSettingsView> {
    return this.repository.transaction(async (tx) => {
      if (!this.available) {
        throw new ConflictException({
          code: 'TELEGRAM_UNAVAILABLE',
          detail: 'Telegram-бот не подключён на сервере.',
        });
      }
      const link = await this.repository.findLinkByUser(tx, userId);
      if (!link) {
        throw new ConflictException({
          code: 'TELEGRAM_NOT_LINKED',
          detail: 'Сначала подключите Telegram.',
        });
      }
      const wasEnabled = link.commandsEnabledAt !== null;
      if (input.enabled && !wasEnabled && input.consent !== true) {
        throw new UnprocessableEntityException({
          code: 'TELEGRAM_COMMANDS_CONSENT_REQUIRED',
          detail: COMMANDS_CONSENT_MESSAGE,
          fieldErrors: [{ field: 'consent', message: COMMANDS_CONSENT_MESSAGE, code: 'custom' }],
        });
      }
      let next: LinkState = link;
      if (input.enabled !== wasEnabled) {
        const now = new Date();
        const values = input.enabled
          ? { commandsEnabledAt: now, commandsConsentAt: now }
          : { commandsEnabledAt: null, commandsConsentAt: null };
        await this.repository.setCommands(tx, link.id, values);
        await this.repository.audit(tx, userId, {
          entityType: 'telegram_link',
          entityId: link.id,
          action: input.enabled ? 'TELEGRAM_COMMANDS_ENABLED' : 'TELEGRAM_COMMANDS_DISABLED',
          source: 'API',
          ...(meta.requestId ? { requestId: meta.requestId } : {}),
        });
        next = { id: link.id, commandsEnabledAt: values.commandsEnabledAt };
      }
      const setting = await this.repository.findTelegramSetting(tx, userId);
      return this.view(next, setting ?? DEFAULTS);
    });
  }

  private view(
    link: LinkState,
    setting: TelegramSettingValues | StoredTelegramSetting,
  ): TelegramSettingsView {
    return {
      available: this.available,
      linked: link !== null,
      enabled: setting.enabled,
      urgentEnabled: setting.urgentEnabled,
      digestFrequency: setting.digestFrequency,
      includeAmounts: setting.includeAmounts,
      amountsConsentAt: setting.amountsConsentAt?.toISOString() ?? null,
      planOverdueEnabled: setting.planOverdueEnabled,
      calendarReminderEnabled: setting.calendarReminderEnabled,
      commandsEnabled: (link?.commandsEnabledAt ?? null) !== null,
    };
  }
}
