import type { CreateTransferInput, TransferDto } from './useBudgetReferenceData.js';

export type TransferPartFormModel = {
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amount: string;
  comment: string;
};

export type TransferFormModel = {
  total: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
  comment: string;
  parts: TransferPartFormModel[];
};

export function createTransferForm(sourceAccountId = ''): TransferFormModel {
  return {
    total: '',
    occurredOn: new Date().toISOString().slice(0, 10),
    sourceAccountId,
    destinationAccountId: '',
    comment: '',
    parts: [createTransferPart()],
  };
}

export function createTransferPart(): TransferPartFormModel {
  return { sourceEnvelopeId: '', destinationEnvelopeId: '', amount: '', comment: '' };
}

export function addTransferPart(model: TransferFormModel): void {
  model.parts.push(createTransferPart());
}

export function removeTransferPart(model: TransferFormModel, index: number): void {
  if (model.parts.length > 1) model.parts.splice(index, 1);
}

export function toCreateTransferInput(
  model: TransferFormModel,
  status: 'DRAFT' | 'CONFIRMED' = 'DRAFT',
): CreateTransferInput {
  return {
    status,
    total: normalizeDecimal(model.total),
    occurredOn: model.occurredOn,
    sourceAccountId: model.sourceAccountId,
    destinationAccountId: model.destinationAccountId,
    parts: model.parts.map((part) => ({
      sourceEnvelopeId: part.sourceEnvelopeId,
      ...(part.destinationEnvelopeId && part.destinationEnvelopeId !== part.sourceEnvelopeId
        ? { destinationEnvelopeId: part.destinationEnvelopeId }
        : {}),
      amount: normalizeDecimal(part.amount),
      ...(part.comment.trim() ? { comment: part.comment.trim() } : {}),
    })),
    ...(model.comment.trim() ? { comment: model.comment.trim() } : {}),
  };
}

export function transferFormFrom(transfer: TransferDto): TransferFormModel {
  return {
    total: minorToDecimal(transfer.totalMinor),
    occurredOn: transfer.occurredOn,
    sourceAccountId: transfer.parts[0]?.sourceAccountId ?? '',
    destinationAccountId: transfer.parts[0]?.destinationAccountId ?? '',
    comment: transfer.comment ?? '',
    parts: transfer.parts.map((part) => ({
      sourceEnvelopeId: part.sourceEnvelopeId,
      destinationEnvelopeId: part.destinationEnvelopeId,
      amount: minorToDecimal(part.amountMinor),
      comment: part.comment ?? '',
    })),
  };
}

function normalizeDecimal(value: string): string {
  return value.replaceAll(/(?:\s|\xA0)/g, '').replace(',', '.');
}

function minorToDecimal(value: string): string {
  const parsed = BigInt(value);
  const sign = parsed < 0n ? '-' : '';
  const digits = (parsed < 0n ? -parsed : parsed).toString().padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
