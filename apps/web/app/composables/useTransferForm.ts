import type { CreateDirectTransferRequest } from './useEnvelopePlanV2.js';

// Envelope Plan v2.2: a transfer only moves money between two different
// accounts, so the form carries only an amount, a date and the two accounts.
export type TransferFormModel = {
  total: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
};

export function createTransferForm(sourceAccountId = ''): TransferFormModel {
  return {
    total: '',
    occurredOn: new Date().toISOString().slice(0, 10),
    sourceAccountId,
    destinationAccountId: '',
  };
}

export function toDirectTransferInput(model: TransferFormModel): CreateDirectTransferRequest {
  return {
    sourceAccountId: model.sourceAccountId,
    destinationAccountId: model.destinationAccountId,
    amount: normalizeDecimal(model.total),
    occurredOn: model.occurredOn,
  };
}

function normalizeDecimal(value: string): string {
  return value.replaceAll(/(?:\s|\xA0)/g, '').replace(',', '.');
}
