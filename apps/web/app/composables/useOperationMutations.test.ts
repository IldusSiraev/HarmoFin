import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  confirmTransaction: vi.fn(),
  cancelTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  restoreTransaction: vi.fn(),
  deleteTransactionWithAllocations: vi.fn(),
};

vi.mock('./useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import { ApiRequestError } from './useApiClient.js';
import { useOperationMutations } from './useOperationMutations.js';
import { useToast } from './useToast.js';
import type { TransactionDto } from './useBudgetReferenceData.js';

const transaction = { id: 'transaction-id', status: 'DRAFT' } as unknown as TransactionDto;

beforeEach(() => {
  vi.clearAllMocks();
  useToast().clear();
});

describe('useOperationMutations', () => {
  it('confirms an operation and announces it', async () => {
    api.confirmTransaction.mockResolvedValue({ ...transaction, status: 'CONFIRMED' });
    const { confirm } = useOperationMutations();

    const result = await confirm('budget-id', transaction);

    expect(api.confirmTransaction).toHaveBeenCalledWith(
      'budget-id',
      'transaction-id',
      expect.any(String),
    );
    expect(result?.status).toBe('CONFIRMED');
    expect(useToast().toasts.value.at(-1)?.title).toBe('Операция подтверждена');
  });

  it('reuses one idempotency key while the same action keeps failing', async () => {
    api.confirmTransaction.mockRejectedValue(new Error('network'));
    const { confirm } = useOperationMutations();

    await confirm('budget-id', transaction);
    await confirm('budget-id', transaction);

    const firstKey = api.confirmTransaction.mock.calls[0]?.[2];
    const secondKey = api.confirmTransaction.mock.calls[1]?.[2];
    expect(firstKey).toBe(secondKey);
  });

  it('takes a fresh key for the next action after a success', async () => {
    api.confirmTransaction.mockResolvedValue(transaction);
    const { confirm } = useOperationMutations();

    await confirm('budget-id', transaction);
    await confirm('budget-id', transaction);

    expect(api.confirmTransaction.mock.calls[0]?.[2]).not.toBe(
      api.confirmTransaction.mock.calls[1]?.[2],
    );
  });

  it('announces a failure instead of throwing', async () => {
    api.deleteTransaction.mockRejectedValue(new Error('network'));
    const { remove } = useOperationMutations();

    const result = await remove('budget-id', transaction);

    expect(result).toBeNull();
    expect(useToast().toasts.value.at(-1)?.tone).toBe('error');
    expect(useToast().toasts.value.at(-1)?.title).toBe('Не удалось удалить операцию');
  });

  it('keeps the rejection so a caller can act on the server code', async () => {
    const failure = new Error('network');
    api.deleteTransaction.mockRejectedValue(failure);
    const { remove, lastError } = useOperationMutations();

    await remove('budget-id', transaction);

    expect(lastError.value).toBe(failure);
  });

  it('leaves an income with allocations to the caller instead of announcing a failure', async () => {
    const failure = new ApiRequestError(409, {
      code: 'INCOME_HAS_CONFIRMED_ALLOCATIONS',
      detail: 'У дохода есть подтверждённые распределения.',
    });
    api.deleteTransaction.mockRejectedValue(failure);
    const { remove, lastError } = useOperationMutations();

    const result = await remove('budget-id', transaction);

    expect(result).toBeNull();
    expect(lastError.value).toBe(failure);
    expect(useToast().toasts.value).toHaveLength(0);
  });

  it('resolves an income deletion with its allocations', async () => {
    api.deleteTransactionWithAllocations.mockResolvedValue({ ...transaction, status: 'DELETED' });
    const { removeWithAllocations } = useOperationMutations();

    await removeWithAllocations('budget-id', transaction, 'CANCEL');

    expect(api.deleteTransactionWithAllocations).toHaveBeenCalledWith(
      'budget-id',
      'transaction-id',
      { allocationResolution: 'CANCEL' },
      expect.any(String),
    );
  });

  it('offers only the actions the status allows', () => {
    const { availableActions } = useOperationMutations();

    expect(availableActions('DRAFT')).toEqual(['confirm', 'cancel', 'delete']);
    expect(availableActions('CONFIRMED')).toEqual(['delete']);
    expect(availableActions('CANCELLED')).toEqual(['delete']);
    expect(availableActions('DELETED')).toEqual(['restore']);
  });
});
