import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_DELETION_GRACE_MS,
  AccountDeletionApplicationService,
} from './account-deletion.application.service.js';

const NOW = new Date('2026-10-18T09:00:00.000Z');

function setup(overrides: { passwordOk?: boolean; otherMembers?: number; claimed?: boolean } = {}) {
  const tx = {};
  const repository = {
    transaction: vi.fn((callback: (t: unknown) => unknown) => callback(tx)),
    findUserCredentials: vi.fn().mockResolvedValue({
      id: 'u1',
      email: 'owner@harmofin.test',
      passwordHash: 'hash',
      status: 'ACTIVE',
    }),
    claimActiveUser: vi.fn().mockResolvedValue(overrides.claimed ?? true),
    findOwnedActiveWorkspaces: vi.fn().mockResolvedValue([
      {
        id: 'w1',
        timezone: 'Europe/Moscow',
        activeBudgetIds: ['b1'],
        otherActiveMemberCount: overrides.otherMembers ?? 0,
      },
    ]),
    deactivateForeignMemberships: vi.fn().mockResolvedValue(['m9']),
    archiveScope: vi.fn().mockResolvedValue(undefined),
    revokeCredentials: vi.fn().mockResolvedValue(undefined),
    createDeletion: vi.fn().mockResolvedValue(undefined),
    audit: vi.fn().mockResolvedValue(undefined),
  };
  const passwordService = { verify: vi.fn().mockResolvedValue(overrides.passwordOk ?? true) };
  const tokenService = { createRawToken: () => 'raw-token', digest: (raw: string) => `hash:${raw}` };
  const emailSender = {
    sendPasswordRecovery: vi.fn(),
    sendAccountDeletionScheduled: vi.fn().mockResolvedValue(undefined),
  };
  const config = { mail: { webBaseUrl: 'http://localhost:3000' } };
  const service = new AccountDeletionApplicationService(
    repository as never,
    passwordService as never,
    tokenService as never,
    emailSender as never,
    config as never,
    () => NOW,
  );
  return { service, repository, emailSender };
}

describe('AccountDeletionApplicationService.requestDeletion', () => {
  it('schedules the purge 30 days ahead, archives owned scope and mails the restore link', async () => {
    const { service, repository, emailSender } = setup();

    const result = await service.requestDeletion('u1', { password: 'correct-password' }, {});

    const purgeAfter = new Date(NOW.getTime() + ACCOUNT_DELETION_GRACE_MS);
    expect(result).toEqual({ purgeAfter });
    expect(repository.archiveScope).toHaveBeenCalledWith(expect.anything(), ['w1'], ['b1']);
    expect(repository.revokeCredentials).toHaveBeenCalledWith(expect.anything(), 'u1', NOW);
    expect(repository.createDeletion).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      requestedAt: NOW,
      purgeAfter,
      restoreTokenHash: 'hash:raw-token',
      archivedWorkspaceIds: ['w1'],
      archivedBudgetIds: ['b1'],
      deactivatedMembershipIds: ['m9'],
    });
    expect(emailSender.sendAccountDeletionScheduled).toHaveBeenCalledWith({
      recipient: 'owner@harmofin.test',
      restoreUrl: 'http://localhost:3000/restore-account?token=raw-token',
      purgeDateLabel: '17.11.2026',
    });
  });

  it('rejects a wrong password with a field error and changes nothing', async () => {
    const { service, repository } = setup({ passwordOk: false });

    await expect(service.requestDeletion('u1', { password: 'wrong' }, {})).rejects.toMatchObject({
      response: {
        code: 'CURRENT_PASSWORD_INVALID',
        fieldErrors: [expect.objectContaining({ field: 'password' })],
      },
    });
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it('refuses when an owned workspace has other active members', async () => {
    const { service, repository } = setup({ otherMembers: 1 });

    await expect(
      service.requestDeletion('u1', { password: 'correct-password' }, {}),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_DELETION_HAS_MEMBERS' } });
    expect(repository.createDeletion).not.toHaveBeenCalled();
  });

  it('treats a lost race (user no longer ACTIVE) as an invalid session', async () => {
    const { service } = setup({ claimed: false });

    await expect(
      service.requestDeletion('u1', { password: 'correct-password' }, {}),
    ).rejects.toMatchObject({ response: { code: 'SESSION_INVALID' } });
  });

  it('keeps the deletion when the email cannot be sent', async () => {
    const { service, emailSender } = setup();
    emailSender.sendAccountDeletionScheduled.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.requestDeletion('u1', { password: 'correct-password' }, {}),
    ).resolves.toEqual({ purgeAfter: new Date(NOW.getTime() + ACCOUNT_DELETION_GRACE_MS) });
  });
});
