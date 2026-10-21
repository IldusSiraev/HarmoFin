import { describe, expect, it } from 'vitest';

import {
  createTransferForm,
  toDirectTransferInput,
  toTransferPatch,
  transferFormFrom,
} from './useTransferForm.js';

describe('useTransferForm', () => {
  it('serializes an account-to-account transfer without envelopes or parts', () => {
    const input = toDirectTransferInput({
      ...createTransferForm('source-id'),
      total: '1 000,00',
      destinationAccountId: 'destination-id',
    });

    expect(input).toEqual({
      sourceAccountId: 'source-id',
      destinationAccountId: 'destination-id',
      amount: '1000.00',
      occurredOn: expect.any(String),
    });
    expect(input).not.toHaveProperty('parts');
  });
});

const item = {
  kind: 'TRANSFER' as const,
  id: 't1',
  budgetId: 'b1',
  status: 'CONFIRMED' as const,
  amountMinor: '150050',
  currency: 'RUB',
  occurredOn: '2026-10-20',
  sourceAccountId: 'a',
  destinationAccountId: 'b',
  comment: null,
  createdAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
};

describe('transfer edit form', () => {
  it('fills the form from a journal transfer', () => {
    expect(transferFormFrom(item)).toEqual({
      total: '1500.50',
      occurredOn: '2026-10-20',
      sourceAccountId: 'a',
      destinationAccountId: 'b',
      comment: '',
    });
  });

  it('sends only the changed fields', () => {
    const model = { ...transferFormFrom(item), total: '1 600,00', comment: 'Отпуск' };
    expect(toTransferPatch(item, model)).toEqual({ amount: '1600.00', comment: 'Отпуск' });
  });

  it('clears a comment with null', () => {
    const model = { ...transferFormFrom({ ...item, comment: 'x' }), comment: '  ' };
    expect(toTransferPatch({ ...item, comment: 'x' }, model)).toEqual({ comment: null });
  });

  it('treats an equal amount written differently as unchanged', () => {
    const model = { ...transferFormFrom(item), total: '1500,5' };
    expect(toTransferPatch(item, model)).toEqual({});
  });
});
