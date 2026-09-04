import type { CreateTransactionInput, TransactionDto } from './useBudgetReferenceData.js';

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

export function createOperationForm(current?: TransactionDto): OperationFormModel {
  return {
    transactionType: current?.transactionType ?? 'EXPENSE',
    amount: current ? minorToDecimal(current.amountMinor) : '',
    occurredOn: current?.occurredOn ?? new Date().toISOString().slice(0, 10),
    accountId: current?.accountId ?? '',
    categoryId: current?.categoryId ?? '',
    envelopeId: current?.envelopeId ?? '',
    sourceDescription: current?.sourceDescription ?? '',
    merchantName: current?.merchantName ?? '',
    isPlanned: current?.isPlanned ?? false,
  };
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
  return value.replaceAll(/[\s ]/g, '').replace(',', '.');
}

function minorToDecimal(value: string): string {
  const parsed = BigInt(value);
  const sign = parsed < 0n ? '-' : '';
  const digits = (parsed < 0n ? -parsed : parsed).toString().padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
