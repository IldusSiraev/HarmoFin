import { AccountType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { RolePolicy } from '../common/policies/role-policy.js';
import { AccountApplicationService } from './account.application.service.js';
import type { AccountRecord, AccountRepository } from './account.repository.js';
import type { CreateAccountInput } from './account.schemas.js';

describe('AccountApplicationService', () => {
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const budgetId = '00000000-0000-4000-8000-000000000002';

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
    );
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

  it('maps current balance from server starting balance', () => {
    const service = createService(repositoryDouble());

    expect(service.toView(account({ startingBalanceMinor: 9_007_199_254_740_993n }))).toMatchObject(
      {
        startingBalanceMinor: '9007199254740993',
        currentBalanceMinor: '9007199254740993',
      },
    );
  });

  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new AccountApplicationService(
      repository as unknown as AccountRepository,
      new RolePolicy(),
    );
  }

  function repositoryDouble() {
    return {
      findAccessibleWithRole: vi.fn(),
      create: vi.fn(),
    };
  }

  function ownerBudget(overrides: Partial<{ allowNegativeBalance: boolean }> = {}) {
    return {
      id: budgetId,
      workspaceId: '00000000-0000-4000-8000-000000000003',
      allowNegativeBalance: false,
      workspace: { memberships: [{ role: 'OWNER' }] },
      ...overrides,
    };
  }

  function accountInput(overrides: Partial<CreateAccountInput> = {}): CreateAccountInput {
    return {
      name: 'Основной счёт',
      accountType: 'BANK_ACCOUNT',
      bankName: 'Банк',
      lastFourDigits: '1234',
      currency: 'RUB',
      startingBalance: '0.00',
      accountingStartDate: '2026-09-01',
      comment: 'Не попадёт в аудит',
      ...overrides,
    };
  }

  function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
    return {
      id: '00000000-0000-4000-8000-000000000004',
      budgetId,
      name: 'Основной счёт',
      accountType: AccountType.BANK_ACCOUNT,
      bankName: 'Банк',
      lastFourDigits: '1234',
      currency: 'RUB',
      scale: 2,
      startingBalanceMinor: 0n,
      accountingStartDate: new Date('2026-09-01T00:00:00.000Z'),
      comment: 'Не попадёт в аудит',
      archivedAt: null,
      ...overrides,
    };
  }
});
