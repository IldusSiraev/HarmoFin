import { AccountType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { AccountApplicationService } from './account.application.service.js';
import type { AccountRecord, AccountRepository } from './account.repository.js';
import type { CreateAccountInput } from './account.schemas.js';

describe('AccountApplicationService', () => {
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const budgetId = '00000000-0000-4000-8000-000000000002';
  const workspaceId = '00000000-0000-4000-8000-000000000003';

  it('uses signed starting balance only when settings allow it', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(
      ownerBudget({ allowNegativeBalance: false }),
    );

    await expect(
      service.create(ownerId, budgetId, accountInput({ startingBalance: '-1.00' })),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VALIDATION_FAILED' }) });

    repository.findAccessibleWithRole.mockResolvedValue(
      ownerBudget({ allowNegativeBalance: true }),
    );
    repository.create.mockResolvedValue(account({ startingBalanceMinor: -100n }));

    await service.create(ownerId, budgetId, accountInput({ startingBalance: '-1.00' }));

    expect(repository.create).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({ budgetId, startingBalanceMinor: -100n }),
      undefined,
      undefined, // v1 budget (planModelVersion !== 2): no unbacked-money guard
      expect.any(Function), // ownership/writer authorize callback
    );
  });

  it('runs the ownership authorize callback before writing an update', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.update.mockResolvedValue(account());

    await service.update(ownerId, budgetId, 'account-id', { name: 'Переименован' });

    expect(repository.update).toHaveBeenCalledTimes(1);
    const authorize = repository.update.mock.calls[0]![6];
    expect(authorize).toBeTypeOf('function');
  });

  it('maps invalid starting balance to a field error', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());

    await expect(
      service.update(ownerId, budgetId, 'account-id', { startingBalance: '1.234' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VALIDATION_FAILED',
        fieldErrors: [
          expect.objectContaining({ field: 'startingBalance', message: expect.any(String) }),
        ],
      }),
    });
  });

  it('maps current balance from server projection without losing precision', () => {
    const service = createService(repositoryDouble());

    expect(
      service.toView(
        account({
          startingBalanceMinor: 9_007_199_254_740_993n,
          currentBalanceMinor: 9_007_199_254_740_994n,
        }),
      ),
    ).toMatchObject({
      startingBalanceMinor: '9007199254740993',
      currentBalanceMinor: '9007199254740994',
    });
  });

  it('sums the balances it hands to the list and counts the rows', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.list.mockResolvedValue([
      account({ currentBalanceMinor: 120050n }),
      account({ currentBalanceMinor: -20050n }),
    ]);

    await expect(service.summary(ownerId, budgetId, 'active')).resolves.toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '100000',
      count: 2,
    });
    expect(repository.list).toHaveBeenCalledWith(ownerId, budgetId, 'active', undefined);
  });

  it('reports zero for a budget without accounts', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(ownerBudget());
    repository.list.mockResolvedValue([]);

    await expect(service.summary(ownerId, budgetId, 'all')).resolves.toEqual({
      currency: 'RUB',
      scale: 2,
      totalMinor: '0',
      count: 0,
    });
  });

  it('hides the summary of a budget the user cannot reach', async () => {
    const repository = repositoryDouble();
    const service = createService(repository);
    repository.findAccessibleWithRole.mockResolvedValue(null);

    await expect(service.summary(ownerId, budgetId, 'active')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
    });
    expect(repository.list).not.toHaveBeenCalled();
  });

  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new AccountApplicationService(repository as unknown as AccountRepository);
  }

  function repositoryDouble() {
    return {
      findAccessibleWithRole: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      restore: vi.fn(),
      find: vi.fn(),
      list: vi.fn(),
      personRefs: vi.fn().mockResolvedValue(new Map()),
    };
  }

  function ownerBudget(overrides: Partial<{ allowNegativeBalance: boolean }> = {}) {
    return {
      id: budgetId,
      workspaceId,
      allowNegativeBalance: false,
      planModelVersion: 1,
      workspace: { memberships: [{ role: 'OWNER' }] },
      ...overrides,
    };
  }

  function accountInput(overrides: Partial<CreateAccountInput> = {}): CreateAccountInput {
    return {
      name: '�������� ����',
      accountType: 'BANK_ACCOUNT',
      bankName: '����',
      lastFourDigits: '1234',
      currency: 'RUB',
      startingBalance: '0.00',
      accountingStartDate: '2026-09-01',
      comment: '�� ������ � �����',
      ...overrides,
    };
  }

  function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
    return {
      id: '00000000-0000-4000-8000-000000000004',
      budgetId,
      ownerUserId: ownerId,
      name: '�������� ����',
      accountType: AccountType.BANK_ACCOUNT,
      bankName: '����',
      lastFourDigits: '1234',
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: 0n,
      accountingStartDate: new Date('2026-09-01T00:00:00.000Z'),
      comment: '�� ������ � �����',
      archivedAt: null,
      currentBalanceMinor: 0n,
      ...overrides,
    };
  }
});
