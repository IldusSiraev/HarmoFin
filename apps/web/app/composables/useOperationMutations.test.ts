import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  deleteTransaction: vi.fn(),
  restoreTransaction: vi.fn(),
};

vi.mock('./useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => api,
}));

import { ApiRequestError } from './useApiClient.js';
import type { TransactionJournalV2Item } from './useEnvelopePlanV2.js';
import { canEditTransaction, useOperationMutations } from './useOperationMutations.js';
import { useToast } from './useToast.js';

const transaction = {
  id: 'transaction-id',
  status: 'CONFIRMED',
  accountingModelVersion: 2,
  transactionType: 'EXPENSE',
} as unknown as TransactionJournalV2Item;

const lifecycle = (status: string, warnings: Array<{ code: string; detail: string }> = []) => ({
  id: 'transaction-id',
  status,
  warnings,
  occurrences: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  useToast().clear();
});

describe('useOperationMutations (v2)', () => {
  it('deletes through the v2 client with one key and announces it', async () => {
    api.deleteTransaction.mockResolvedValue(lifecycle('DELETED'));
    const { remove } = useOperationMutations();

    const result = await remove('budget-id', transaction);

    expect(api.deleteTransaction).toHaveBeenCalledWith(
      'budget-id',
      'transaction-id',
      expect.any(String),
    );
    expect(result?.status).toBe('DELETED');
    expect(useToast().toasts.value.at(-1)?.title).toBe('Операция удалена');
  });

  it('restores through the v2 client', async () => {
    api.restoreTransaction.mockResolvedValue(lifecycle('CONFIRMED'));
    const { restore } = useOperationMutations();

    await restore('budget-id', { ...transaction, status: 'DELETED' });

    expect(api.restoreTransaction).toHaveBeenCalledWith(
      'budget-id',
      'transaction-id',
      expect.any(String),
    );
    expect(useToast().toasts.value.at(-1)?.title).toBe('Операция восстановлена');
  });

  it('shows server warnings next to the success message', async () => {
    api.restoreTransaction.mockResolvedValue(
      lifecycle('CONFIRMED', [
        { code: 'ENVELOPE_BALANCE_INSUFFICIENT', detail: 'Конверт в минусе.' },
      ]),
    );
    const { restore } = useOperationMutations();

    await restore('budget-id', transaction);

    expect(useToast().toasts.value.at(-1)?.description).toBe('Конверт в минусе.');
  });

  it('reuses one key while the same action keeps failing, then takes a fresh one', async () => {
    api.deleteTransaction.mockRejectedValueOnce(new Error('network'));
    api.deleteTransaction.mockRejectedValueOnce(new Error('network'));
    api.deleteTransaction.mockResolvedValueOnce(lifecycle('DELETED'));
    api.deleteTransaction.mockResolvedValueOnce(lifecycle('DELETED'));
    const { remove } = useOperationMutations();

    await remove('budget-id', transaction);
    await remove('budget-id', transaction);
    await remove('budget-id', transaction);
    await remove('budget-id', transaction);

    const keys = api.deleteTransaction.mock.calls.map((call) => call[2]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
    expect(keys[3]).not.toBe(keys[2]);
  });

  it('ignores a second call while the first one is in flight', async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.deleteTransaction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { remove } = useOperationMutations();

    const first = remove('budget-id', transaction);
    const second = await remove('budget-id', transaction);
    finish(lifecycle('DELETED'));
    await first;

    expect(second).toBeNull();
    expect(api.deleteTransaction).toHaveBeenCalledTimes(1);
  });

  it('announces a failure in Russian instead of throwing and keeps the rejection', async () => {
    const failure = new ApiRequestError(409, {
      code: 'TRANSACTION_NOT_EDITABLE',
      detail: 'technical',
    });
    api.deleteTransaction.mockRejectedValue(failure);
    const { remove, lastError } = useOperationMutations();

    const result = await remove('budget-id', transaction);

    const toast = useToast().toasts.value.at(-1);
    expect(result).toBeNull();
    expect(lastError.value).toBe(failure);
    expect(toast?.tone).toBe('error');
    expect(toast?.title).toBe('Не удалось удалить операцию');
    expect(toast?.description).toContain('нельзя изменить');
    expect(toast?.description).not.toContain('technical');
  });

  it('words an income blocked by assignments for this screen, not for funding', async () => {
    api.deleteTransaction.mockRejectedValue(
      new ApiRequestError(409, { code: 'SOURCE_EXHAUSTED', detail: 'technical' }),
    );
    const { remove } = useOperationMutations();

    await remove('budget-id', { ...transaction, transactionType: 'INCOME' });

    expect(useToast().toasts.value.at(-1)?.description).toContain(
      'Деньги этого дохода распределены по конвертам',
    );
  });

  it('words a missing operation for the journal', async () => {
    api.deleteTransaction.mockRejectedValue(
      new ApiRequestError(404, { code: 'RESOURCE_NOT_FOUND', detail: 'technical' }),
    );
    const { remove } = useOperationMutations();

    await remove('budget-id', transaction);

    expect(useToast().toasts.value.at(-1)?.description).toBe(
      'Операция не найдена. Обновите журнал.',
    );
  });

  it('offers only the actions the row allows', () => {
    const { availableActions } = useOperationMutations();

    expect(availableActions(transaction)).toEqual(['delete']);
    expect(availableActions({ ...transaction, status: 'DRAFT' })).toEqual(['delete']);
    expect(availableActions({ ...transaction, status: 'DELETED' })).toEqual(['restore']);
  });

  it('allows editing only drafts and confirmed operations', () => {
    expect(canEditTransaction(transaction)).toBe(true);
    expect(canEditTransaction({ ...transaction, status: 'DRAFT' })).toBe(true);
    expect(canEditTransaction({ ...transaction, status: 'CANCELLED' })).toBe(false);
    expect(canEditTransaction({ ...transaction, status: 'DELETED' })).toBe(false);
  });

  it('allows editing through the author check only for the author itself', () => {
    const withAuthor = {
      ...transaction,
      createdBy: { userId: 'author-id', displayName: 'Алия', isActiveMember: true },
    } as unknown as typeof transaction;

    expect(canEditTransaction(withAuthor, 'author-id')).toBe(true);
    expect(canEditTransaction(withAuthor, 'someone-else')).toBe(false);
    // A row without an author (older response) is never editable by anybody.
    expect(canEditTransaction(transaction, 'author-id')).toBe(false);
    // Without the author argument the helper keeps its status-only behaviour.
    expect(canEditTransaction(withAuthor)).toBe(true);
  });
});
