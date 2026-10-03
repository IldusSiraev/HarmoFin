import { describe, expect, it } from 'vitest';

import { createTransferForm, toDirectTransferInput } from './useTransferForm.js';

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
