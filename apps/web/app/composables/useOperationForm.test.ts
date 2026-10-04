import { describe, expect, it } from 'vitest';

import { createOperationEditForm, toUpdateTransactionV2Input } from './useOperationForm.js';
import type { TransactionJournalV2Item } from './useEnvelopePlanV2.js';

const transaction: TransactionJournalV2Item = {
  id: 'transaction-id',
  budgetId: 'budget-id',
  accountingModelVersion: 2,
  transactionType: 'EXPENSE',
  status: 'CONFIRMED',
  amountMinor: '125000',
  currency: 'RUB',
  occurredOn: '2026-09-05',
  accountId: 'account-id',
  categoryId: 'category-id',
  envelopeId: 'envelope-id',
  sourceDescription: null,
  merchantName: 'Магазин',
  comment: null,
  planOccurrenceIds: [],
  confirmedAt: '2026-09-05T00:00:00.000Z',
  cancelledAt: null,
  deletedAt: null,
  createdAt: '2026-09-05T00:00:00.000Z',
};

describe('operation edit form', () => {
  it('preloads the editable values with the amount as a decimal string', () => {
    expect(createOperationEditForm(transaction)).toEqual({
      amount: '1250.00',
      occurredOn: '2026-09-05',
      accountId: 'account-id',
      categoryId: 'category-id',
      envelopeId: 'envelope-id',
      comment: '',
    });
  });

  it('sends nothing when nothing changed', () => {
    const model = createOperationEditForm(transaction);

    expect(
      toUpdateTransactionV2Input(model, createOperationEditForm(transaction), 'EXPENSE'),
    ).toEqual({});
  });

  it('sends only the changed fields so a comment edit does not touch the money', () => {
    const original = createOperationEditForm(transaction);

    expect(
      toUpdateTransactionV2Input({ ...original, comment: 'Заметка' }, original, 'EXPENSE'),
    ).toEqual({ comment: 'Заметка' });
  });

  it('normalizes a typed amount and clears an emptied comment or envelope to null', () => {
    const original = createOperationEditForm({ ...transaction, comment: 'Старый' });

    expect(
      toUpdateTransactionV2Input(
        { ...original, amount: '1 300,5', comment: '', envelopeId: '' },
        original,
        'EXPENSE',
      ),
    ).toEqual({ amount: '1300.5', comment: null, envelopeId: null });
  });

  it('never sends an envelope for an income', () => {
    const income = { ...transaction, transactionType: 'INCOME' as const, envelopeId: null };
    const original = createOperationEditForm(income);

    expect(
      toUpdateTransactionV2Input(
        { ...original, envelopeId: 'envelope-id', accountId: 'other-account' },
        original,
        'INCOME',
      ),
    ).toEqual({ accountId: 'other-account' });
  });
});
