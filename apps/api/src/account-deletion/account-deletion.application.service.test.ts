import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_DELETION_GRACE_MS,
  AccountDeletionApplicationService,
} from './account-deletion.application.service.js';

const NOW = new Date('2026-10-18T09:00:00.000Z');

function setup(overrides: { passwordOk?: boolean; otherMembers?: number; claimed?: boolean } = {}) {
  const tx = {
    notification: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const repository = {
    transaction: vi.fn((callback: (t: unknown) => unknown) => callback(tx)),
    findUserCredentials: vi.fn().mockResolvedValue({
      id: 'u1',
      email: 'owner@harmofin.test',
      displayName: null,
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
    deactivateForeignMemberships: vi
      .fn()
      .mockResolvedValue([{ id: 'm9', workspaceId: 'w-foreign', ownerId: 'creator-1' }]),
    findActiveBudgetId: vi.fn().mockResolvedValue('b-foreign'),
    archiveScope: vi.fn().mockResolvedValue(undefined),
    revokeCredentials: vi.fn().mockResolvedValue(undefined),
    createDeletion: vi.fn().mockResolvedValue(undefined),
    audit: vi.fn().mockResolvedValue(undefined),
    lockOpenDeletionByTokenHash: vi.fn().mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      purgeAfter: new Date(NOW.getTime() + 1_000),
      archivedWorkspaceIds: ['w1'],
      archivedBudgetIds: ['b1'],
      deactivatedMembershipIds: [],
    }),
    reactivateUser: vi.fn().mockResolvedValue(true),
    restoreScope: vi.fn().mockResolvedValue(undefined),
    markRestored: vi.fn().mockResolvedValue(undefined),
  };
  const passwordService = { verify: vi.fn().mockResolvedValue(overrides.passwordOk ?? true) };
  const tokenService = {
    createRawToken: () => 'raw-token',
    digest: (raw: string) => `hash:${raw}`,
  };
  const emailSender = {
    sendPasswordRecovery: vi.fn(),
    sendAccountDeletionScheduled: vi.fn().mockResolvedValue(undefined),
    sendFamilyInvitation: vi.fn().mockResolvedValue(undefined),
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
  return { service, repository, emailSender, tx };
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

  it('resolves the deleted member notifications in foreign families and notifies each creator', async () => {
    const { service, repository, tx } = setup();

    await service.requestDeletion('u1', { password: 'correct-password' }, {});

    expect(repository.findActiveBudgetId).toHaveBeenCalledWith(expect.anything(), 'w-foreign');
    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w-foreign', userId: 'u1', resolvedAt: null },
      data: { resolvedAt: NOW },
    });
    expect(tx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: 'w-foreign',
          budgetId: 'b-foreign',
          userId: 'creator-1',
          notificationType: 'MEMBER_LEFT',
          notificationKey: `access:MEMBER_LEFT:m9:${NOW.toISOString()}`,
        }),
      }),
    );
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

describe('AccountDeletionApplicationService.cancelDeletion', () => {
  it('restores the user and the archived scope by token hash', async () => {
    const { service, repository } = setup();

    await service.cancelDeletion({ token: 'raw-token' }, {});

    expect(repository.lockOpenDeletionByTokenHash).toHaveBeenCalledWith(
      expect.anything(),
      'hash:raw-token',
      NOW,
    );
    expect(repository.reactivateUser).toHaveBeenCalledWith(expect.anything(), 'u1');
    expect(repository.restoreScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ archivedWorkspaceIds: ['w1'], archivedBudgetIds: ['b1'] }),
    );
    expect(repository.markRestored).toHaveBeenCalledWith(expect.anything(), 'd1', NOW);
    expect(repository.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'ACCOUNT_DELETION_CANCELLED', userId: 'u1' }),
    );
  });

  it('rejects an unknown, used or expired token with one generic error', async () => {
    const { service, repository } = setup();
    repository.lockOpenDeletionByTokenHash.mockResolvedValue(null);

    await expect(service.cancelDeletion({ token: 'nope' }, {})).rejects.toMatchObject({
      response: { code: 'ACCOUNT_RESTORE_TOKEN_INVALID' },
    });
    expect(repository.reactivateUser).not.toHaveBeenCalled();
  });

  it('rejects when the user is no longer pending deletion', async () => {
    const { service, repository } = setup();
    repository.reactivateUser.mockResolvedValue(false);

    await expect(service.cancelDeletion({ token: 'raw-token' }, {})).rejects.toMatchObject({
      response: { code: 'ACCOUNT_RESTORE_TOKEN_INVALID' },
    });
    expect(repository.markRestored).not.toHaveBeenCalled();
  });
});
