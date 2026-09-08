import { describe, expect, it, vi } from 'vitest';

import { TransactionApplicationService } from './transaction.application.service.js';
import type { TransactionRecord } from './transaction.repository.js';
import type { CreateTransactionInput } from './transaction.schemas.js';

describe('TransactionApplicationService', () => {
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const editorId = '00000000-0000-4000-8000-000000000002';
  const viewerId = '00000000-0000-4000-8000-000000000003';
  const budgetId = '00000000-0000-4000-8000-000000000004';
  const transactionId = '00000000-0000-4000-8000-000000000005';
  const accountId = '00000000-0000-4000-8000-000000000006';
  const envelopeId = '00000000-0000-4000-8000-000000000007';
  const incomeCategoryId = '00000000-0000-4000-8000-000000000008';
  const expenseCategoryId = '00000000-0000-4000-8000-000000000009';

  it('does not change financial projection when creating a draft expense', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findActiveReferences.mockResolvedValue(activeExpenseReferences());
    repository.create.mockResolvedValue(transaction({ status: 'DRAFT' }));
    const service = createService(repository);

    await service.create(ownerId, budgetId, expenseInput({ status: 'DRAFT' }), 'draft-key');

    expect(repository.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'DRAFT', amountMinor: 12_345n }),
      expect.anything(),
      undefined,
    );
    expect(repository.assertConfirmedExpenseCapacity).not.toHaveBeenCalled();
  });

  it('blocks confirmation when account or envelope would become negative', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findForMutation.mockResolvedValue(transaction({ status: 'DRAFT' }));
    repository.assertConfirmedExpenseCapacity.mockResolvedValue(false);
    const service = createService(repository);

    await expect(
      service.confirm(ownerId, budgetId, transactionId, 'confirm-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }),
    });
  });

  it('requires active same-budget references with category matching operation type', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findActiveReferences.mockResolvedValue({
      account: activeAccount,
      category: activeIncomeCategory,
      envelope: null,
    });
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, expenseInput(), 'reference-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });
  });

  it('permits editor and denies viewer financial mutations', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('EDITOR'));
    repository.findActiveReferences.mockResolvedValue(activeExpenseReferences());
    repository.create.mockResolvedValue(transaction({ status: 'DRAFT' }));
    const service = createService(repository);

    await expect(
      service.create(editorId, budgetId, expenseInput(), 'editor-key'),
    ).resolves.toMatchObject({
      status: 'DRAFT',
    });

    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('VIEWER'));
    await expect(
      service.create(viewerId, budgetId, expenseInput(), 'viewer-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FORBIDDEN' }),
    });
  });

  it('allows draft confirmation, draft cancellation and confirmed logical deletion', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findForMutation.mockResolvedValueOnce(transaction({ status: 'DRAFT' }));
    repository.updateLifecycle.mockResolvedValueOnce(transaction({ status: 'CONFIRMED' }));
    repository.findForMutation.mockResolvedValueOnce(transaction({ status: 'DRAFT' }));
    repository.updateLifecycle.mockResolvedValueOnce(transaction({ status: 'CANCELLED' }));
    repository.findForMutation.mockResolvedValueOnce(transaction({ status: 'CONFIRMED' }));
    repository.updateLifecycle.mockResolvedValueOnce(transaction({ status: 'DELETED' }));
    const service = createService(repository);

    await expect(
      service.confirm(ownerId, budgetId, transactionId, 'confirm-key'),
    ).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    await expect(
      service.cancel(ownerId, budgetId, transactionId, 'cancel-key'),
    ).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    await expect(
      service.delete(ownerId, budgetId, transactionId, 'delete-key'),
    ).resolves.toMatchObject({
      status: 'DELETED',
    });
  });

  it('denies confirmation from cancelled state and updates of deleted transaction', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findForMutation.mockResolvedValueOnce(transaction({ status: 'CANCELLED' }));
    repository.findForMutation.mockResolvedValueOnce(transaction({ status: 'DELETED' }));
    const service = createService(repository);

    await expect(
      service.confirm(ownerId, budgetId, transactionId, 'cancelled-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TRANSACTION_STATE_INVALID' }),
    });
    await expect(
      service.update(ownerId, budgetId, transactionId, { occurredOn: '2026-09-04' }, 'deleted-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TRANSACTION_STATE_INVALID' }),
    });
  });

  it('restores deleted confirmed transaction only for owner', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findActiveReferences.mockResolvedValue(activeExpenseReferences());
    repository.findForMutation.mockResolvedValue({
      ...transaction({
        status: 'DELETED',
        deletedAt: new Date('2026-09-05T12:00:00.000Z'),
      }),
      preDeleteStatus: 'CONFIRMED',
    } as TransactionRecord & { preDeleteStatus: 'CONFIRMED' });
    repository.restoreLifecycle.mockResolvedValue(transaction({ status: 'CONFIRMED' }));
    const service = createService(repository) as unknown as {
      restore(
        userId: string,
        budgetId: string,
        transactionId: string,
        key: string,
      ): Promise<unknown>;
    };

    await expect(
      service.restore(ownerId, budgetId, transactionId, 'restore-key'),
    ).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    expect(repository.restoreLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'DELETED', preDeleteStatus: 'CONFIRMED' }),
      'CONFIRMED',
      ownerId,
      undefined,
    );
  });

  it('requires allocation resolution before deleting confirmed income', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget('OWNER'));
    repository.findForMutation.mockResolvedValue(
      transaction({ transactionType: 'INCOME', status: 'CONFIRMED', envelopeId: null }),
    );
    repository.findConfirmedAllocationsForIncome.mockResolvedValue([{ id: 'allocation-id' }]);
    repository.updateLifecycle.mockResolvedValue(transaction({ status: 'DELETED' }));
    const service = createService(repository);

    await expect(
      service.delete(ownerId, budgetId, transactionId, 'delete-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INCOME_HAS_CONFIRMED_ALLOCATIONS' }),
    });
    expect(repository.updateLifecycle).not.toHaveBeenCalled();
  });
  it('serializes bigint financial consequences as canonical strings', () => {
    const service = createService(repositoryDouble());

    expect(
      service.toView(
        transaction({
          amountMinor: 9_007_199_254_740_993n,
          accountCurrentBalanceMinor: 9_007_199_254_740_994n,
          envelopeCurrentBalanceMinor: -9_007_199_254_740_995n,
        }),
      ),
    ).toMatchObject({
      amountMinor: '9007199254740993',
      accountCurrentBalanceMinor: '9007199254740994',
      envelopeCurrentBalanceMinor: '-9007199254740995',
    });
  });

  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new TransactionApplicationService(
      repository as never,
      {
        execute: async (_tx: unknown, _input: unknown, write: () => Promise<unknown>) => write(),
      } as never,
    );
  }

  function repositoryDouble() {
    return {
      findAccessibleWithRole: vi.fn(),
      runTransaction: vi.fn(async (write: (tx: object) => Promise<unknown>) => write({})),
      findActiveReferences: vi.fn(),
      assertConfirmedExpenseCapacity: vi.fn().mockResolvedValue(true),
      create: vi.fn(),
      findForMutation: vi.fn(),
      findConfirmedAllocationsForIncome: vi.fn(),
      updateLifecycle: vi.fn(),
      restoreLifecycle: vi.fn(),
      update: vi.fn(),
    };
  }

  function accessibleBudget(role: 'OWNER' | 'EDITOR' | 'VIEWER') {
    return { id: budgetId, allowNegativeBalance: false, workspace: { memberships: [{ role }] } };
  }

  const activeAccount = { id: accountId, budgetId, archivedAt: null, currency: 'RUB', scale: 2 };
  const activeIncomeCategory = {
    id: incomeCategoryId,
    budgetId,
    archivedAt: null,
    categoryType: 'INCOME',
  };

  function activeExpenseReferences() {
    return {
      account: activeAccount,
      category: { ...activeIncomeCategory, id: expenseCategoryId, categoryType: 'EXPENSE' },
      envelope: { id: envelopeId, budgetId, archivedAt: null, currency: 'RUB', scale: 2 },
    };
  }

  function expenseInput(overrides: Partial<CreateTransactionInput> = {}): CreateTransactionInput {
    return {
      transactionType: 'EXPENSE',
      status: 'DRAFT',
      amount: '123.45',
      occurredOn: '2026-09-04',
      accountId,
      categoryId: expenseCategoryId,
      envelopeId,
      merchantName: 'Магазин',
      isPlanned: false,
      ...overrides,
    };
  }

  function transaction(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
    return {
      id: transactionId,
      budgetId,
      transactionType: 'EXPENSE',
      status: 'DRAFT',
      amountMinor: 12_345n,
      currency: 'RUB',
      scale: 2,
      occurredOn: new Date('2026-09-04T00:00:00.000Z'),
      accountId,
      categoryId: expenseCategoryId,
      envelopeId,
      sourceDescription: null,
      merchantName: 'Магазин',
      isPlanned: false,
      comment: null,
      confirmedAt: null,
      cancelledAt: null,
      deletedAt: null,
      preDeleteStatus: null,
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
      accountCurrentBalanceMinor: 0n,
      envelopeCurrentBalanceMinor: 0n,
      ...overrides,
    };
  }
});
