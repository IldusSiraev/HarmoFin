import { describe, expect, it, vi } from 'vitest';

import { TransactionRepository } from './transaction.repository.js';

describe('TransactionRepository', () => {
  it('locks account and envelope before checking confirmed expense capacity', async () => {
    const queryRaw = vi.fn();
    const balances = {
      accountBalance: vi.fn().mockResolvedValue(10_000n),
      envelopeBalance: vi.fn().mockResolvedValue(10_000n),
    };
    const repository = new TransactionRepository({} as never, balances as never);

    await expect(
      repository.assertConfirmedExpenseCapacity(
        { $queryRaw: queryRaw } as never,
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
        10_000n,
      ),
    ).resolves.toBe(true);

    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
