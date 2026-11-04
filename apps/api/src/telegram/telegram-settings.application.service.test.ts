import { describe, expect, it, vi } from 'vitest';

import { TelegramSettingsApplicationService } from './telegram-settings.application.service.js';
import type { TelegramSettingValues } from './telegram.repository.js';

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback({})),
    findLinkByUser: vi.fn().mockResolvedValue({ id: 'link-1' }),
    findTelegramSetting: vi.fn().mockResolvedValue(null),
    upsertTelegramSetting: vi.fn(
      async (_tx: unknown, _userId: string, values: TelegramSettingValues) => ({
        id: 'setting-1',
        ...values,
      }),
    ),
    audit: vi.fn().mockResolvedValue(undefined),
    setCommands: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const input = {
  enabled: true,
  urgentEnabled: true,
  digestFrequency: 'DAILY' as const,
  includeAmounts: false,
};

describe('TelegramSettingsApplicationService', () => {
  it('returns defaults with availability and link state', async () => {
    const service = new TelegramSettingsApplicationService(makeRepository() as never, true);
    await expect(service.get('user-1')).resolves.toEqual({
      available: true,
      linked: true,
      enabled: false,
      urgentEnabled: true,
      digestFrequency: 'DAILY',
      includeAmounts: false,
      amountsConsentAt: null,
      planOverdueEnabled: true,
      calendarReminderEnabled: true,
      commandsEnabled: false,
    });
  });

  it('refuses to enable the channel without a link', async () => {
    const repository = makeRepository({ findLinkByUser: vi.fn().mockResolvedValue(null) });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(service.update('user-1', input, {})).rejects.toMatchObject({
      response: { code: 'TELEGRAM_NOT_LINKED' },
    });
    expect(repository.upsertTelegramSetting).not.toHaveBeenCalled();
  });

  it('refuses to enable the channel when the bot is not configured', async () => {
    const service = new TelegramSettingsApplicationService(makeRepository() as never, false);
    await expect(service.update('user-1', input, {})).rejects.toMatchObject({
      response: { code: 'TELEGRAM_NOT_LINKED' },
    });
  });

  it('allows switching the channel off without a link', async () => {
    const repository = makeRepository({ findLinkByUser: vi.fn().mockResolvedValue(null) });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(service.update('user-1', { ...input, enabled: false }, {})).resolves.toMatchObject(
      {
        enabled: false,
        linked: false,
      },
    );
  });

  it('asks for consent before amounts and audits the grant', async () => {
    const repository = makeRepository();
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(
      service.update('user-1', { ...input, includeAmounts: true }, {}),
    ).rejects.toMatchObject({ response: { code: 'AMOUNTS_CONSENT_REQUIRED' } });

    const saved = await service.update(
      'user-1',
      { ...input, includeAmounts: true, amountsConsent: true },
      {},
    );
    expect(saved.amountsConsentAt).not.toBeNull();
    const actions = repository.audit.mock.calls.map(
      (call) => (call[2] as { action: string }).action,
    );
    expect(actions).toEqual(['UPDATED', 'AMOUNTS_CONSENT_GRANTED']);
    expect((repository.audit.mock.calls[0]![2] as { values: object }).values).toMatchObject({
      channel: 'TELEGRAM',
    });
  });

  it('clears the consent time when amounts are switched off', async () => {
    const repository = makeRepository({
      findTelegramSetting: vi.fn().mockResolvedValue({
        id: 'setting-1',
        enabled: true,
        urgentEnabled: true,
        digestFrequency: 'DAILY',
        includeAmounts: true,
        amountsConsentAt: new Date('2026-10-01'),
        planOverdueEnabled: true,
        calendarReminderEnabled: true,
      }),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    const saved = await service.update('user-1', input, {});
    expect(saved.amountsConsentAt).toBeNull();
    const actions = repository.audit.mock.calls.map(
      (call) => (call[2] as { action: string }).action,
    );
    expect(actions).toEqual(['UPDATED', 'AMOUNTS_CONSENT_REVOKED']);
  });

  it('saves the per-type switches when given and keeps the stored ones when omitted', async () => {
    const repository = makeRepository({
      findTelegramSetting: vi.fn().mockResolvedValue({
        id: 'setting-1',
        enabled: true,
        urgentEnabled: true,
        digestFrequency: 'DAILY',
        includeAmounts: false,
        amountsConsentAt: null,
        planOverdueEnabled: false,
        calendarReminderEnabled: true,
      }),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);

    const kept = await service.update('user-1', input, {});
    expect(kept).toMatchObject({ planOverdueEnabled: false, calendarReminderEnabled: true });

    await service.update('user-1', { ...input, calendarReminderEnabled: false }, {});
    expect(repository.upsertTelegramSetting.mock.calls[1]![2]).toMatchObject({
      planOverdueEnabled: false,
      calendarReminderEnabled: false,
    });
    const audits = repository.audit.mock.calls.map((call) => call[2] as { values?: unknown });
    expect(audits.at(-1)?.values).toMatchObject({
      channel: 'TELEGRAM',
      planOverdueEnabled: false,
      calendarReminderEnabled: false,
    });
  });
});

describe('TelegramSettingsApplicationService.setCommands', () => {
  const enabledLink = { id: 'link-1', commandsEnabledAt: new Date('2026-11-01') };

  it('refuses when the bot is not configured', async () => {
    const service = new TelegramSettingsApplicationService(makeRepository() as never, false);
    await expect(
      service.setCommands('user-1', { enabled: true, consent: true }, {}),
    ).rejects.toMatchObject({ response: { code: 'TELEGRAM_UNAVAILABLE' } });
  });

  it('refuses without a linked chat', async () => {
    const repository = makeRepository({ findLinkByUser: vi.fn().mockResolvedValue(null) });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(
      service.setCommands('user-1', { enabled: true, consent: true }, {}),
    ).rejects.toMatchObject({ response: { code: 'TELEGRAM_NOT_LINKED' } });
  });

  it('asks for consent before switching commands on', async () => {
    const repository = makeRepository({
      findLinkByUser: vi.fn().mockResolvedValue({ id: 'link-1', commandsEnabledAt: null }),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    await expect(service.setCommands('user-1', { enabled: true }, {})).rejects.toMatchObject({
      response: {
        code: 'TELEGRAM_COMMANDS_CONSENT_REQUIRED',
        fieldErrors: [{ field: 'consent' }],
      },
    });
    expect(repository.setCommands).not.toHaveBeenCalled();
  });

  it('switches commands on with consent and audits it', async () => {
    const repository = makeRepository({
      findLinkByUser: vi.fn().mockResolvedValue({ id: 'link-1', commandsEnabledAt: null }),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    const view = await service.setCommands(
      'user-1',
      { enabled: true, consent: true },
      { requestId: 'req-1' },
    );
    expect(view.commandsEnabled).toBe(true);
    const values = repository.setCommands.mock.calls[0]![2] as {
      commandsEnabledAt: Date;
      commandsConsentAt: Date;
    };
    expect(values.commandsEnabledAt).toBeInstanceOf(Date);
    expect(values.commandsConsentAt).toEqual(values.commandsEnabledAt);
    expect(repository.audit.mock.calls[0]![2]).toEqual({
      entityType: 'telegram_link',
      entityId: 'link-1',
      action: 'TELEGRAM_COMMANDS_ENABLED',
      source: 'API',
      requestId: 'req-1',
    });
  });

  it('keeps enabled commands as they are without a new consent', async () => {
    const repository = makeRepository({
      findLinkByUser: vi.fn().mockResolvedValue(enabledLink),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    const view = await service.setCommands('user-1', { enabled: true }, {});
    expect(view.commandsEnabled).toBe(true);
    expect(repository.setCommands).not.toHaveBeenCalled();
    expect(repository.audit).not.toHaveBeenCalled();
  });

  it('switches commands off and clears both times', async () => {
    const repository = makeRepository({
      findLinkByUser: vi.fn().mockResolvedValue(enabledLink),
    });
    const service = new TelegramSettingsApplicationService(repository as never, true);
    const view = await service.setCommands('user-1', { enabled: false }, {});
    expect(view.commandsEnabled).toBe(false);
    expect(repository.setCommands.mock.calls[0]![2]).toEqual({
      commandsEnabledAt: null,
      commandsConsentAt: null,
    });
    expect((repository.audit.mock.calls[0]![2] as { action: string }).action).toBe(
      'TELEGRAM_COMMANDS_DISABLED',
    );
  });
});
