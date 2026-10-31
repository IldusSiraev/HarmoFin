import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('./useApiClient.js', () => ({ useApiClient: () => ({ request }) }));

import { useNotificationSettings } from './useNotificationSettings.js';

describe('useNotificationSettings', () => {
  beforeEach(() => request.mockReset().mockResolvedValue(undefined));

  it('reads and saves the email settings', async () => {
    const api = useNotificationSettings();
    await api.getEmail();
    await api.saveEmail({
      enabled: true,
      urgentEnabled: false,
      digestFrequency: 'WEEKLY',
      includeAmounts: true,
      amountsConsent: true,
    });
    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/me/notification-settings/email');
    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/me/notification-settings/email', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        urgentEnabled: false,
        digestFrequency: 'WEEKLY',
        includeAmounts: true,
        amountsConsent: true,
      }),
    });
  });

  it('posts verification, confirmation and unsubscribe requests', async () => {
    const api = useNotificationSettings();
    await api.requestEmailVerification();
    await api.confirmEmailVerification('raw-1');
    await api.unsubscribe('raw-2');
    expect(request.mock.calls).toEqual([
      ['/api/v1/me/email-verification', { method: 'POST' }],
      [
        '/api/v1/auth/email-verification/confirm',
        { method: 'POST', body: JSON.stringify({ token: 'raw-1' }) },
      ],
      [
        '/api/v1/notifications/unsubscribe',
        { method: 'POST', body: JSON.stringify({ token: 'raw-2' }) },
      ],
    ]);
  });
});
