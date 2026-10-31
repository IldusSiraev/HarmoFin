import { useApiClient } from './useApiClient.js';

// Thin typed client over the account-level notification endpoints (/api/v1): email and Telegram.

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
}

export type TelegramNotificationSettingsInput = EmailNotificationSettingsInput;

export interface TelegramLink {
  url: string;
  expiresAt: string;
}

const SETTINGS = '/api/v1/me/notification-settings/email';
const TELEGRAM_SETTINGS = '/api/v1/me/notification-settings/telegram';
const TELEGRAM_LINK = '/api/v1/me/telegram/link';

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
  };
}
