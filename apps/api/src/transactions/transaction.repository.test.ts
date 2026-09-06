import { describe, expect, it, vi } from 'vitest';

import {
  decodeJournalCursor,
  encodeJournalCursor,
  TransactionRepository,
} from './transaction.repository.js';

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

  it('rejects malformed and mismatched journal cursors', () => {
    const amountCursor = encodeJournalCursor({
      v: 1,
      sortBy: 'amount',
      sortDirection: 'asc',
      value: '1000',
      createdAt: '2026-09-05T00:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000001',
    });

    for (const [value, sortBy, sortDirection] of [
      ['not-a-cursor', 'occurredOn', 'desc'],
      [amountCursor, 'occurredOn', 'desc'],
    ] as const) {
      try {
        decodeJournalCursor(value, sortBy, sortDirection);
        throw new Error('Expected cursor validation failure.');
      } catch (error) {
        expect(error).toMatchObject({
          response: { code: 'VALIDATION_FAILED', detail: 'Некорректный курсор журнала.' },
        });
      }
    }
  });
});
