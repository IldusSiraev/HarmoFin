import { useApiClient } from './useApiClient.js';

// Thin typed client over the account-level email notification endpoints (/api/v1).

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

const SETTINGS = '/api/v1/me/notification-settings/email';

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
  };
}
