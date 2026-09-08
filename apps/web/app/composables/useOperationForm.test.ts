import { describe, expect, it } from 'vitest';

import { createOperationForm, toUpdateTransactionInput } from './useOperationForm.js';

const transaction = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  transactionType: 'EXPENSE' as const,
  status: 'CONFIRMED' as const,
  amountMinor: '125000',
  currency: 'RUB' as const,
  scale: 2 as const,
  occurredOn: '2026-09-05',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: 'Магазин',
  isPlanned: false,
  comment: null,
  confirmedAt: '2026-09-05T00:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  accountCurrentBalanceMinor: '0',
  envelopeCurrentBalanceMinor: '0',
  unallocatedMinor: '0',
  allocationProposal: null,
};

describe('useOperationForm', () => {
  it('preloads editable transaction values and confirms confirmed edit', () => {
    const model = createOperationForm(transaction);

    expect(model).toMatchObject({
      transactionType: 'EXPENSE',
      amount: '1250.00',
      occurredOn: '2026-09-05',
      accountId: 'account-id',
      categoryId: 'category-id',
      envelopeId: 'envelope-id',
      merchantName: 'Магазин',
    });
    expect(toUpdateTransactionInput(model, true)).toEqual({
      amount: '1250.00',
      occurredOn: '2026-09-05',
      accountId: 'account-id',
      categoryId: 'category-id',
      envelopeId: 'envelope-id',
      merchantName: 'Магазин',
      isPlanned: false,
      confirm: true,
    });
  });
});
