import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  updateTransfer: vi.fn(),
  deleteTransfer: vi.fn(),
  restoreTransfer: vi.fn(),
};
const push = vi.fn();

vi.mock('./useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => api }));
vi.mock('./useToast.js', () => ({ useToast: () => ({ push }) }));

import { useTransferMutations } from './useTransferMutations.js';
import type { TransferJournalItem } from './useEnvelopePlanV2.js';

const transfer: TransferJournalItem = {
  kind: 'TRANSFER', id: 't1', budgetId: 'b1', status: 'CONFIRMED', amountMinor: '10000', currency: 'RUB',
  occurredOn: '2026-10-20', sourceAccountId: 'a', destinationAccountId: 'b', comment: null,
  createdAt: '2026-10-20T10:00:00.000Z', deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTransferMutations', () => {
  it('reuses the idempotency key when the same edit is retried', async () => {
    api.updateTransfer.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(transfer);
    const { update } = useTransferMutations();

    await expect(update('b1', 't1', { comment: 'x' })).rejects.toThrow('network');
    await update('b1', 't1', { comment: 'x' });

    const [first, second] = api.updateTransfer.mock.calls;
    expect(first?.[3]).toBe(second?.[3]);
  });

  it('uses a new key for a different edit', async () => {
    api.updateTransfer.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(transfer);
    const { update } = useTransferMutations();

    await expect(update('b1', 't1', { comment: 'x' })).rejects.toThrow();
    await update('b1', 't1', { comment: 'y' });

    const [first, second] = api.updateTransfer.mock.calls;
    expect(first?.[3]).not.toBe(second?.[3]);
  });

  it('shows a toast on delete and returns the deleted transfer', async () => {
    api.deleteTransfer.mockResolvedValueOnce({ ...transfer, status: 'DELETED' });
    const { remove } = useTransferMutations();

    const result = await remove('b1', transfer);

    expect(result?.status).toBe('DELETED');
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success', title: 'Перевод удалён' }));
  });

  it('explains an insufficient balance on restore', async () => {
    const { ApiRequestError } = await import('./useApiClient.js');
    api.restoreTransfer.mockRejectedValueOnce(
      new ApiRequestError(409, {
        code: 'INSUFFICIENT_BALANCE',
        detail: 'x',
        status: 409,
        title: 'Conflict',
      } as never),
    );
    const { restore } = useTransferMutations();

    expect(await restore('b1', { ...transfer, status: 'DELETED' })).toBeNull();
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'error',
        title: 'Не удалось восстановить перевод',
        description: 'На счёте недостаточно средств для этого изменения.',
      }),
    );
  });
});
