import { describe, expect, it, vi } from 'vitest';

import { NotificationSettingsApplicationService } from './notification-settings.application.service.js';
import type { EmailSettingValues } from './notification-settings.repository.js';
import { hashUnsubscribeToken } from './unsubscribe-token.js';

const verifiedUser = { email: 'anna@example.test', emailVerifiedAt: new Date('2026-10-01') };

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback({})),
    findUser: vi.fn().mockResolvedValue(verifiedUser),
    findEmailSetting: vi.fn().mockResolvedValue(null),
    upsertEmailSetting: vi.fn(
      async (_tx: unknown, _userId: string, values: EmailSettingValues) => ({
        id: 'setting-1',
        ...values,
      }),
    ),
    audit: vi.fn().mockResolvedValue(undefined),
    findDeliveryByTokenHash: vi.fn().mockResolvedValue(null),
    disableChannel: vi.fn().mockResolvedValue({ id: 'setting-1', changed: true }),
    ...overrides,
  };
}

const input = {
  enabled: true,
  urgentEnabled: true,
  digestFrequency: 'DAILY' as const,
  includeAmounts: false,
};

describe('NotificationSettingsApplicationService', () => {
  it('returns defaults with a masked address when nothing is stored', async () => {
    const service = new NotificationSettingsApplicationService(makeRepository() as never);
    await expect(service.getEmail('user-1')).resolves.toEqual({
      email: 'a***@example.test',
      emailVerified: true,
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
    });
  });

  it('refuses to enable the channel for an unverified address', async () => {
    const repository = makeRepository({
      findUser: vi.fn().mockResolvedValue({ email: 'a@x.test', emailVerifiedAt: null }),
    });
    const service = new NotificationSettingsApplicationService(repository as never);
    await expect(service.updateEmail('user-1', input, {})).rejects.toMatchObject({
      status: 409,
      response: { code: 'EMAIL_NOT_VERIFIED' },
    });
    expect(repository.upsertEmailSetting).not.toHaveBeenCalled();
  });

  it('allows disabling the channel for an unverified address', async () => {
    const repository = makeRepository({
      findUser: vi.fn().mockResolvedValue({ email: 'a@x.test', emailVerifiedAt: null }),
    });
    const service = new NotificationSettingsApplicationService(repository as never);
    await service.updateEmail('user-1', { ...input, enabled: false }, {});
    expect(repository.upsertEmailSetting).toHaveBeenCalled();
  });

  it('requires explicit consent to turn amounts on and records the moment', async () => {
    const repository = makeRepository();
    const service = new NotificationSettingsApplicationService(repository as never);
    await expect(
      service.updateEmail('user-1', { ...input, includeAmounts: true }, {}),
    ).rejects.toMatchObject({ status: 422, response: { code: 'AMOUNTS_CONSENT_REQUIRED' } });

    await service.updateEmail(
      'user-1',
      { ...input, includeAmounts: true, amountsConsent: true },
      {},
    );
    const values = repository.upsertEmailSetting.mock.calls[0]![2];
    expect(values.amountsConsentAt).toBeInstanceOf(Date);
    expect(repository.audit.mock.calls.map((call) => call[2].action)).toEqual([
      'UPDATED',
      'AMOUNTS_CONSENT_GRANTED',
    ]);
  });

  it('keeps the original consent moment while amounts stay on and clears it when turned off', async () => {
    const consentAt = new Date('2026-10-20T10:00:00.000Z');
    const repository = makeRepository({
      findEmailSetting: vi.fn().mockResolvedValue({
        id: 'setting-1',
        enabled: true,
        urgentEnabled: true,
        digestFrequency: 'DAILY',
        includeAmounts: true,
        amountsConsentAt: consentAt,
      }),
    });
    const service = new NotificationSettingsApplicationService(repository as never);

    await service.updateEmail('user-1', { ...input, includeAmounts: true }, {});
    expect(repository.upsertEmailSetting.mock.calls[0]![2].amountsConsentAt).toBe(consentAt);

    await service.updateEmail('user-1', { ...input, includeAmounts: false }, {});
    expect(repository.upsertEmailSetting.mock.calls[1]![2].amountsConsentAt).toBeNull();
    expect(repository.audit.mock.calls.at(-1)![2].action).toBe('AMOUNTS_CONSENT_REVOKED');
  });

  it('unsubscribes by the hash of the token and ignores unknown tokens', async () => {
    const repository = makeRepository({
      findDeliveryByTokenHash: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'user-1', channel: 'EMAIL' }),
    });
    const service = new NotificationSettingsApplicationService(repository as never);

    await service.unsubscribe('unknown', {});
    expect(repository.disableChannel).not.toHaveBeenCalled();

    await service.unsubscribe('raw-token', {});
    expect(repository.findDeliveryByTokenHash.mock.calls[1]![1]).toBe(
      hashUnsubscribeToken('raw-token'),
    );
    expect(repository.disableChannel).toHaveBeenCalledWith({}, 'user-1', 'EMAIL');
    expect(repository.audit.mock.calls.at(-1)![2].action).toBe('UNSUBSCRIBED');
  });
});
