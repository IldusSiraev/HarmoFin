import { describe, expect, it } from 'vitest';

import {
  decodeJournalCursor,
  encodeJournalCursor,
  TransactionRepository,
} from './transaction.repository.js';

describe('TransactionRepository', () => {
  it('does not expose v1 capacity or physical envelope balance helpers', () => {
    const repository = new TransactionRepository({} as never, {} as never);
    expect('assertConfirmedExpenseCapacity' in repository).toBe(false);
    expect('listForExport' in repository).toBe(false);
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
