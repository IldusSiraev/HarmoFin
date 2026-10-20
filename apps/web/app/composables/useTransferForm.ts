import type {
  CreateDirectTransferRequest,
  TransferJournalItem,
  UpdateDirectTransferRequest,
} from './useEnvelopePlanV2.js';

// Envelope Plan v2.2: a transfer only moves money between two different
// accounts, so the form carries an amount, a date, the two accounts and a note.
export type TransferFormModel = {
  total: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
  comment: string;
};

export function createTransferForm(sourceAccountId = ''): TransferFormModel {
  return {
    total: '',
    occurredOn: new Date().toISOString().slice(0, 10),
    sourceAccountId,
    destinationAccountId: '',
    comment: '',
  };
}

export function transferFormFrom(item: TransferJournalItem): TransferFormModel {
  return {
    total: minorToDecimal(item.amountMinor),
    occurredOn: item.occurredOn,
    sourceAccountId: item.sourceAccountId,
    destinationAccountId: item.destinationAccountId,
    comment: item.comment ?? '',
  };
}

export function toDirectTransferInput(model: TransferFormModel): CreateDirectTransferRequest {
  const comment = model.comment.trim();
  return {
    sourceAccountId: model.sourceAccountId,
    destinationAccountId: model.destinationAccountId,
    amount: normalizeDecimal(model.total),
    occurredOn: model.occurredOn,
    ...(comment ? { comment } : {}),
  };
}

/** Only the fields that differ from the saved transfer; the server confirms the rest. */
export function toTransferPatch(
  original: TransferJournalItem,
  model: TransferFormModel,
): UpdateDirectTransferRequest {
  const patch: UpdateDirectTransferRequest = {};
  const amount = normalizeDecimal(model.total);
  if (decimalToMinor(amount) !== original.amountMinor) patch.amount = withCents(amount);
  if (model.occurredOn !== original.occurredOn) patch.occurredOn = model.occurredOn;
  if (model.sourceAccountId !== original.sourceAccountId)
    patch.sourceAccountId = model.sourceAccountId;
  if (model.destinationAccountId !== original.destinationAccountId) {
    patch.destinationAccountId = model.destinationAccountId;
  }
  const comment = model.comment.trim() || null;
  if (comment !== original.comment) patch.comment = comment;
  return patch;
}

function normalizeDecimal(value: string): string {
  return value.replaceAll(/(?:\s|\xA0)/g, '').replace(',', '.');
}

// String arithmetic only: money never goes through floating point.
function decimalToMinor(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  return minor === '' ? '0' : minor;
}

function withCents(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function minorToDecimal(minor: string): string {
  const padded = minor.padStart(3, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}
