import type { PushSubscriptionInput } from '../pwa/push.js';
import { useApiClient } from './useApiClient.js';

// Thin typed client over the account-level notification endpoints (/api/v1): email, Telegram, push.

export type DigestFrequency = 'OFF' | 'DAILY' | 'WEEKLY';

export interface EmailNotificationSettings {
  email: string;
  emailVerified: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsentAt: string | null;
}

export interface EmailNotificationSettingsInput {
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsent?: boolean;
}

export interface TelegramNotificationSettings {
  available: boolean;
  linked: boolean;
  enabled: boolean;
  urgentEnabled: boolean;
  digestFrequency: DigestFrequency;
  includeAmounts: boolean;
  amountsConsentAt: string | null;
  commandsEnabled: boolean;
}

export type TelegramNotificationSettingsInput = EmailNotificationSettingsInput;

export interface TelegramCommandsInput {
  enabled: boolean;
  consent?: boolean;
}

export interface TelegramLink {
  url: string;
  expiresAt: string;
}

export interface PushDevice {
  id: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  current: boolean;
}

export interface PushNotificationSettings {
  available: boolean;
  vapidPublicKey: string | null;
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
  devices: PushDevice[];
}

export interface PushNotificationSettingsInput {
  enabled: boolean;
  planOverdueEnabled: boolean;
  calendarReminderEnabled: boolean;
}

const SETTINGS = '/api/v1/me/notification-settings/email';
const TELEGRAM_SETTINGS = '/api/v1/me/notification-settings/telegram';
const TELEGRAM_LINK = '/api/v1/me/telegram/link';
const TELEGRAM_COMMANDS = '/api/v1/me/notification-settings/telegram/commands';
const PUSH_SETTINGS = '/api/v1/me/notification-settings/push';
const PUSH_SUBSCRIPTIONS = '/api/v1/me/push/subscriptions';

export function useNotificationSettings() {
  const api = useApiClient();
  return {
    getEmail: () => api.request<EmailNotificationSettings>(SETTINGS),
    saveEmail: (input: EmailNotificationSettingsInput) =>
      api.request<EmailNotificationSettings>(SETTINGS, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    requestEmailVerification: () =>
      api.request<void>('/api/v1/me/email-verification', { method: 'POST' }),
    confirmEmailVerification: (token: string) =>
      api.request<void>('/api/v1/auth/email-verification/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    unsubscribe: (token: string) =>
      api.request<void>('/api/v1/notifications/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    getTelegram: () => api.request<TelegramNotificationSettings>(TELEGRAM_SETTINGS),
    saveTelegram: (input: TelegramNotificationSettingsInput) =>
      api.request<TelegramNotificationSettings>(TELEGRAM_SETTINGS, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    createTelegramLink: () =>
      api.request<TelegramLink>(TELEGRAM_LINK, {
        method: 'POST',
        body: JSON.stringify({ consent: true }),
      }),
    unlinkTelegram: () => api.request<void>(TELEGRAM_LINK, { method: 'DELETE' }),
    setTelegramCommands: (input: TelegramCommandsInput) =>
      api.request<TelegramNotificationSettings>(TELEGRAM_COMMANDS, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    getPush: () => api.request<PushNotificationSettings>(PUSH_SETTINGS),
    savePush: (input: PushNotificationSettingsInput) =>
      api.request<PushNotificationSettings>(PUSH_SETTINGS, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    addPushSubscription: (input: PushSubscriptionInput) =>
      api.request<PushNotificationSettings>(PUSH_SUBSCRIPTIONS, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    removePushSubscription: (id: string) =>
      api.request<void>(`${PUSH_SUBSCRIPTIONS}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}
