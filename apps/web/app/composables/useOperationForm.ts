import type { CreateTransactionInput } from './useBudgetReferenceData.js';
import type { TransactionJournalV2Item, UpdateTransactionV2Request } from './useEnvelopePlanV2.js';

export type OperationFormModel = {
  transactionType: 'INCOME' | 'EXPENSE';
  amount: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
  sourceDescription: string;
  merchantName: string;
  isPlanned: boolean;
};

export interface OneTimePayEntry {
  name: string;
  amount: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  comment?: string;
}

export function createOperationForm(): OperationFormModel {
  return {
    transactionType: 'EXPENSE',
    amount: '',
    occurredOn: new Date().toISOString().slice(0, 10),
    accountId: '',
    categoryId: '',
    envelopeId: '',
    sourceDescription: '',
    merchantName: '',
    isPlanned: false,
  };
}

// The journal edit form: the fields the v2 PATCH accepts, as form strings.
export type OperationEditModel = {
  amount: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
  comment: string;
};

export function createOperationEditForm(current: TransactionJournalV2Item): OperationEditModel {
  return {
    amount: minorToDecimal(current.amountMinor),
    occurredOn: current.occurredOn,
    accountId: current.accountId,
    categoryId: current.categoryId,
    envelopeId: current.envelopeId ?? '',
    comment: current.comment ?? '',
  };
}

// Only what changed is sent: a comment edit must not re-validate the money, the
// account or an archived category the operation already points at.
export function toUpdateTransactionV2Input(
  model: OperationEditModel,
  original: OperationEditModel,
  transactionType: 'INCOME' | 'EXPENSE',
): UpdateTransactionV2Request {
  const input: UpdateTransactionV2Request = {};
  if (model.amount !== original.amount) input.amount = normalizeDecimal(model.amount);
  if (model.occurredOn !== original.occurredOn) input.occurredOn = model.occurredOn;
  if (model.accountId !== original.accountId) input.accountId = model.accountId;
  if (model.categoryId !== original.categoryId) input.categoryId = model.categoryId;
  if (transactionType === 'EXPENSE' && model.envelopeId !== original.envelopeId) {
    input.envelopeId = model.envelopeId === '' ? null : model.envelopeId;
  }
  if (model.comment !== original.comment) {
    input.comment = model.comment.trim() === '' ? null : model.comment;
  }
  return input;
}

export function toTransactionInput(
  model: OperationFormModel,
  status: 'DRAFT' | 'CONFIRMED',
): CreateTransactionInput {
  return {
    transactionType: model.transactionType,
    status,
    amount: normalizeDecimal(model.amount),
    occurredOn: model.occurredOn,
    accountId: model.accountId,
    categoryId: model.categoryId,
    ...(model.transactionType === 'EXPENSE'
      ? { envelopeId: model.envelopeId, merchantName: model.merchantName || undefined }
      : { sourceDescription: model.sourceDescription || undefined }),
    isPlanned: model.isPlanned,
  };
}

export function normalizeDecimal(value: string): string {
  return value.replaceAll(/(?:\s|\xA0)/g, '').replace(',', '.');
}

function minorToDecimal(value: string): string {
  const parsed = BigInt(value);
  const sign = parsed < 0n ? '-' : '';
  const digits = (parsed < 0n ? -parsed : parsed).toString().padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
