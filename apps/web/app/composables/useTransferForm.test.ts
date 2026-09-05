import { describe, expect, it } from 'vitest';

import {
  addTransferPart,
  createTransferForm,
  removeTransferPart,
  toCreateTransferInput,
} from './useTransferForm.js';

describe('useTransferForm', () => {
  it('serializes transfer parts as canonical decimal request input', () => {
    expect(
      toCreateTransferInput({
        ...createTransferForm(),
        total: '1 000,00',
        sourceAccountId: 'source-id',
        destinationAccountId: 'destination-id',
        parts: [
          {
            sourceEnvelopeId: 'envelope-id',
            destinationEnvelopeId: '',
            amount: '1 000,00',
            comment: '',
          },
        ],
      }),
    ).toEqual({
      status: 'DRAFT',
      total: '1000.00',
      occurredOn: expect.any(String),
      sourceAccountId: 'source-id',
      destinationAccountId: 'destination-id',
      parts: [{ sourceEnvelopeId: 'envelope-id', amount: '1000.00' }],
    });
  });

  it('adds and removes transfer parts without dropping last part', () => {
    const model = createTransferForm();
    addTransferPart(model);
    expect(model.parts).toHaveLength(2);
    removeTransferPart(model, 0);
    removeTransferPart(model, 0);
    expect(model.parts).toHaveLength(1);
  });
});
