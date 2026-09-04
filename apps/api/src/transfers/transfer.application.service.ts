import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import {
  forbidden,
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import {
  TransferRepository,
  type TransferCreateData,
  type TransferListQuery,
  type TransferPartRecord,
  type TransferRecord,
} from './transfer.repository.js';
import type { CreateTransferInput, ListTransfersInput } from './transfer.schemas.js';

export interface TransferPartView {
  id: string;
  transferId: string;
  budgetId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: string;
  comment: string | null;
  sourceAccountCurrentBalanceMinor: string;
  destinationAccountCurrentBalanceMinor: string;
  sourceEnvelopeCurrentBalanceMinor: string;
  destinationEnvelopeCurrentBalanceMinor: string;
}

export interface TransferView {
  [key: string]: unknown;
  id: string;
  budgetId: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  totalMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  comment: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  deletedAt: string | null;
  parts: TransferPartView[];
}

export interface TransferListView {
  items: TransferView[];
  nextCursor: string | null;
}

@Injectable()
export class TransferApplicationService {
  constructor(
    private readonly repository: TransferRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    input: ListTransfersInput,
  ): Promise<TransferListView> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const result = await this.repository.list(userId, budgetId, listQuery(input));
    return {
      items: result.items.map((transfer) => this.toView(transfer)),
      nextCursor: result.nextCursor,
    };
  }

  async get(userId: string, budgetId: string, transferId: string): Promise<TransferView> {
    const transfer = await this.repository.find(userId, budgetId, transferId);
    if (!transfer) throw resourceNotFound();
    return this.toView(transfer);
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateTransferInput,
    key: string,
    requestId?: string,
  ): Promise<TransferView> {
    const budget = await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransferView>(
        tx,
        idempotencyInput(budgetId, userId, key, 'transfer.create', input),
        async () => {
          const data = await this.createData(
            tx,
            budgetId,
            userId,
            input,
            budget.allowNegativeBalance,
          );
          const transfer = await this.repository.create(tx, data, userId, requestId);
          return { status: 201, body: this.toView(transfer) };
        },
      );
      return result.body;
    });
  }

  async confirm(
    userId: string,
    budgetId: string,
    transferId: string,
    key: string,
    requestId?: string,
  ): Promise<TransferView> {
    const budget = await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransferView>(
        tx,
        idempotencyInput(budgetId, userId, key, `transfer.confirm:${transferId}`, {}),
        async () => {
          const current = await this.requireMutableTransfer(tx, userId, budgetId, transferId);
          const [firstPart] = current.parts;
          if (current.status !== 'DRAFT' || !firstPart) throw invalidTransferState();
          if (!budget.allowNegativeBalance) {
            const capacity = await this.repository.assertConfirmedTransferCapacity(
              tx,
              budgetId,
              firstPart.sourceAccountId,
              current.parts,
            );
            if (!capacity) throw insufficientBalance();
          }
          const transfer = await this.repository.updateLifecycle(
            tx,
            current,
            'CONFIRMED',
            userId,
            requestId,
          );
          return { status: 200, body: this.toView(transfer) };
        },
      );
      return result.body;
    });
  }

  async cancel(
    userId: string,
    budgetId: string,
    transferId: string,
    key: string,
    requestId?: string,
  ): Promise<TransferView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransferView>(
        tx,
        idempotencyInput(budgetId, userId, key, `transfer.cancel:${transferId}`, {}),
        async () => {
          const current = await this.requireMutableTransfer(tx, userId, budgetId, transferId);
          if (current.status !== 'DRAFT') throw invalidTransferState();
          const transfer = await this.repository.updateLifecycle(
            tx,
            current,
            'CANCELLED',
            userId,
            requestId,
          );
          return { status: 200, body: this.toView(transfer) };
        },
      );
      return result.body;
    });
  }

  async delete(
    userId: string,
    budgetId: string,
    transferId: string,
    key: string,
    requestId?: string,
  ): Promise<TransferView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransferView>(
        tx,
        idempotencyInput(budgetId, userId, key, `transfer.delete:${transferId}`, {}),
        async () => {
          const current = await this.requireMutableTransfer(tx, userId, budgetId, transferId);
          if (current.status === 'DELETED') throw invalidTransferState();
          const transfer = await this.repository.updateLifecycle(
            tx,
            current,
            'DELETED',
            userId,
            requestId,
          );
          return { status: 200, body: this.toView(transfer) };
        },
      );
      return result.body;
    });
  }

  toView(transfer: TransferRecord): TransferView {
    return {
      id: transfer.id,
      budgetId: transfer.budgetId,
      status: transfer.status,
      totalMinor: formatMinorUnits(transfer.totalMinor),
      currency: 'RUB',
      scale: 2,
      occurredOn: transfer.occurredOn.toISOString().slice(0, 10),
      comment: transfer.comment,
      confirmedAt: transfer.confirmedAt?.toISOString() ?? null,
      cancelledAt: transfer.cancelledAt?.toISOString() ?? null,
      deletedAt: transfer.deletedAt?.toISOString() ?? null,
      parts: transfer.parts.map((part) => this.toPartView(part)),
    };
  }

  private toPartView(part: TransferPartRecord): TransferPartView {
    return {
      id: part.id,
      transferId: part.transferId,
      budgetId: part.budgetId,
      sourceAccountId: part.sourceAccountId,
      destinationAccountId: part.destinationAccountId,
      sourceEnvelopeId: part.sourceEnvelopeId,
      destinationEnvelopeId: part.destinationEnvelopeId,
      amountMinor: formatMinorUnits(part.amountMinor),
      comment: part.comment,
      sourceAccountCurrentBalanceMinor: formatMinorUnits(part.sourceAccountCurrentBalanceMinor),
      destinationAccountCurrentBalanceMinor: formatMinorUnits(
        part.destinationAccountCurrentBalanceMinor,
      ),
      sourceEnvelopeCurrentBalanceMinor: formatMinorUnits(part.sourceEnvelopeCurrentBalanceMinor),
      destinationEnvelopeCurrentBalanceMinor: formatMinorUnits(
        part.destinationEnvelopeCurrentBalanceMinor,
      ),
    };
  }

  private async createData(
    tx: Parameters<TransferRepository['findActiveReferences']>[0],
    budgetId: string,
    userId: string,
    input: CreateTransferInput,
    allowNegativeBalance: boolean,
  ): Promise<TransferCreateData> {
    if (input.sourceAccountId === input.destinationAccountId) throw accountsMustDiffer();
    const totalMinor = parsePositiveAmount(input.total);
    const parts = input.parts.map((part) => ({
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      sourceEnvelopeId: part.sourceEnvelopeId,
      destinationEnvelopeId: part.destinationEnvelopeId ?? part.sourceEnvelopeId,
      amountMinor: parsePositiveAmount(part.amount),
      comment: part.comment ?? null,
    }));
    const partsTotal = parts.reduce((total, part) => total + part.amountMinor, 0n);
    if (partsTotal !== totalMinor) throw partsTotalMismatch();

    const references = await this.repository.findActiveReferences(
      tx,
      budgetId,
      input.sourceAccountId,
      input.destinationAccountId,
      parts.flatMap((part) => [part.sourceEnvelopeId, part.destinationEnvelopeId]),
    );
    const envelopes = new Map(references.envelopes.map((envelope) => [envelope.id, envelope]));
    if (
      !isActiveRubReference(references.sourceAccount) ||
      !isActiveRubReference(references.destinationAccount) ||
      parts.some(
        (part) =>
          !isActiveRubReference(envelopes.get(part.sourceEnvelopeId) ?? null) ||
          !isActiveRubReference(envelopes.get(part.destinationEnvelopeId) ?? null),
      )
    ) {
      throw invalidReference();
    }
    if (input.status === 'CONFIRMED' && !allowNegativeBalance) {
      const capacity = await this.repository.assertConfirmedTransferCapacity(
        tx,
        budgetId,
        input.sourceAccountId,
        parts,
      );
      if (!capacity) throw insufficientBalance();
    }

    return {
      budgetId,
      status: input.status,
      totalMinor,
      occurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`),
      comment: input.comment ?? null,
      confirmedAt: input.status === 'CONFIRMED' ? new Date() : null,
      createdByUserId: userId,
      updatedByUserId: userId,
      parts,
    };
  }

  private async requireMutationBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if (role !== 'OWNER' && role !== 'EDITOR') throw forbidden();
    return budget;
  }

  private async requireMutableTransfer(
    tx: Parameters<TransferRepository['findForMutation']>[0],
    userId: string,
    budgetId: string,
    transferId: string,
  ): Promise<TransferRecord> {
    const transfer = await this.repository.findForMutation(tx, userId, budgetId, transferId);
    if (!transfer) throw resourceNotFound();
    return transfer;
  }
}

function listQuery(input: ListTransfersInput): TransferListQuery {
  return {
    limit: input.limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.from ? { from: new Date(`${input.from}T00:00:00.000Z`) } : {}),
    ...(input.to ? { to: new Date(`${input.to}T00:00:00.000Z`) } : {}),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
  };
}

function idempotencyInput(
  budgetId: string,
  actorUserId: string,
  key: string,
  operation: string,
  body: unknown,
) {
  return {
    budgetId,
    actorUserId,
    key,
    operation,
    requestHash: createHash('sha256').update(JSON.stringify({ operation, body })).digest('hex'),
  };
}

function parsePositiveAmount(value: string): bigint {
  const amount = parseDecimalToMinorUnits(value, 2, false);
  if (amount <= 0n) throw invalidReference();
  return amount;
}

function isActiveRubReference(
  reference: { archivedAt: Date | null; currency: string; scale: number } | null,
): boolean {
  return reference?.archivedAt === null && reference.currency === 'RUB' && reference.scale === 2;
}

function partsTotalMismatch(): ConflictException {
  return new ConflictException({
    code: 'TRANSFER_PARTS_TOTAL_MISMATCH',
    detail: 'Сумма частей перевода не совпадает с общей суммой.',
    fieldErrors: [
      {
        field: 'parts',
        message: 'Сумма частей должна совпадать с общей суммой.',
        code: 'mismatch',
      },
    ],
  });
}

function accountsMustDiffer(): BadRequestException {
  return new BadRequestException({
    code: 'TRANSFER_ACCOUNTS_MUST_DIFFER',
    detail: 'Счёт списания и счёт зачисления должны различаться.',
    fieldErrors: [
      {
        field: 'destinationAccountId',
        message: 'Выберите другой счёт зачисления.',
        code: 'invalid',
      },
    ],
  });
}

function insufficientBalance(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INSUFFICIENT_BALANCE',
    detail: 'Недостаточно средств на счёте или в конверте.',
  });
}

function invalidTransferState(): ConflictException {
  return new ConflictException({
    code: 'TRANSFER_STATE_INVALID',
    detail: 'Перевод недоступен в текущем состоянии.',
  });
}
