import { createHash } from 'node:crypto';

import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { IncomeAllocationRepository } from '../allocations/income-allocation.repository.js';
import { cycleAndPeriodFor } from '../cycles/cycle-period.domain.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import {
  forbidden,
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import {
  TransactionRepository,
  type TransactionCreateData,
  type TransactionListQuery,
  type TransactionRecord,
  type TransactionUpdateData,
} from './transaction.repository.js';
import type {
  CreateTransactionInput,
  ListTransactionsInput,
  ResolveIncomeDeletionInput,
  UpdateTransactionInput,
} from './transaction.schemas.js';

export interface TransactionView {
  [key: string]: unknown;
  id: string;
  budgetId: string;
  transactionType: 'INCOME' | 'EXPENSE';
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  sourceDescription: string | null;
  merchantName: string | null;
  isPlanned: boolean;
  comment: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  deletedAt: string | null;
  accountCurrentBalanceMinor: string;
  envelopeCurrentBalanceMinor: string | null;
  unallocatedMinor: string;
  allocationProposal: {
    targetEnvelopeId: string;
    amountMinor: string;
    currency: 'RUB';
    scale: 2;
  } | null;
}

export interface TransactionListView {
  items: TransactionView[];
  nextCursor: string | null;
}

@Injectable()
export class TransactionApplicationService {
  constructor(
    private readonly repository: TransactionRepository,
    private readonly idempotency: IdempotencyService,
    private readonly allocations?: IncomeAllocationRepository,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    input: ListTransactionsInput,
  ): Promise<TransactionListView> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if ((input.status === 'DELETED' || input.status === 'all') && role !== 'OWNER') {
      throw forbidden();
    }
    const referencesExist = await this.repository.validateJournalReferences(budgetId, input);
    if (!referencesExist) throw resourceNotFound();
    const result = await this.repository.list(userId, budgetId, listQuery(input, budget));
    return {
      items: await Promise.all(
        result.items.map((transaction) => this.toViewWithAllocationProposal(transaction)),
      ),
      nextCursor: result.nextCursor,
    };
  }

  async get(userId: string, budgetId: string, transactionId: string): Promise<TransactionView> {
    const transaction = await this.repository.find(userId, budgetId, transactionId);
    if (!transaction) throw resourceNotFound();
    return this.toViewWithAllocationProposal(transaction);
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateTransactionInput,
    key: string,
    requestId?: string,
  ): Promise<TransactionView> {
    const budget = await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransactionView>(
        tx,
        idempotencyInput(budgetId, userId, key, 'transaction.create', input),
        async () => {
          const data = await this.createData(
            tx,
            budgetId,
            userId,
            input,
            budget.allowNegativeBalance,
          );
          const transaction = await this.repository.create(tx, data, userId, requestId);
          return { status: 201, body: await this.toViewWithAllocationProposal(transaction) };
        },
      );
      return result.body;
    });
  }

  async update(
    userId: string,
    budgetId: string,
    transactionId: string,
    input: UpdateTransactionInput,
    key: string,
    requestId?: string,
  ): Promise<TransactionView> {
    const budget = await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransactionView>(
        tx,
        idempotencyInput(budgetId, userId, key, `transaction.update:${transactionId}`, input),
        async () => {
          const current = await this.requireMutableTransaction(tx, userId, budgetId, transactionId);
          if (current.status === 'DELETED') throw invalidTransactionState();
          if (current.status === 'CONFIRMED' && input.confirm !== true)
            throw invalidTransactionState();

          const data = await this.updateData(
            tx,
            budgetId,
            userId,
            current,
            input,
            budget.allowNegativeBalance,
          );
          if (
            current.transactionType === 'INCOME' &&
            current.status === 'CONFIRMED' &&
            data.amountMinor !== undefined
          ) {
            const allocations = await this.repository.findConfirmedAllocationsForIncome(
              tx,
              budgetId,
              current.id,
            );
            const allocatedMinor = allocations.reduce(
              (total, allocation) => total + allocation.amountMinor,
              0n,
            );
            if (allocatedMinor > data.amountMinor) throw allocationsExceedIncome();
          }
          const transaction = await this.repository.update(tx, current, data, userId, requestId);
          return { status: 200, body: await this.toViewWithAllocationProposal(transaction) };
        },
      );
      return result.body;
    });
  }

  async confirm(
    userId: string,
    budgetId: string,
    transactionId: string,
    key: string,
    requestId?: string,
  ): Promise<TransactionView> {
    const budget = await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransactionView>(
        tx,
        idempotencyInput(budgetId, userId, key, `transaction.confirm:${transactionId}`, {}),
        async () => {
          const current = await this.requireMutableTransaction(tx, userId, budgetId, transactionId);
          if (current.status !== 'DRAFT') throw invalidTransactionState();
          if (current.transactionType === 'EXPENSE') {
            if (!current.envelopeId) throw invalidReference();
            const capacity = await this.repository.assertConfirmedExpenseCapacity(
              tx,
              budgetId,
              current.accountId,
              current.envelopeId,
              current.amountMinor,
            );
            if (!budget.allowNegativeBalance && !capacity) throw insufficientBalance();
          }
          const transaction = await this.repository.updateLifecycle(
            tx,
            current,
            'CONFIRMED',
            userId,
            requestId,
          );
          return { status: 200, body: await this.toViewWithAllocationProposal(transaction) };
        },
      );
      return result.body;
    });
  }

  async cancel(
    userId: string,
    budgetId: string,
    transactionId: string,
    key: string,
    requestId?: string,
  ): Promise<TransactionView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransactionView>(
        tx,
        idempotencyInput(budgetId, userId, key, `transaction.cancel:${transactionId}`, {}),
        async () => {
          const current = await this.requireMutableTransaction(tx, userId, budgetId, transactionId);
          if (current.status !== 'DRAFT') throw invalidTransactionState();
          const transaction = await this.repository.updateLifecycle(
            tx,
            current,
            'CANCELLED',
            userId,
            requestId,
          );
          return { status: 200, body: await this.toViewWithAllocationProposal(transaction) };
        },
      );
      return result.body;
    });
  }

  async delete(
    userId: string,
    budgetId: string,
    transactionId: string,
    key: string,
    requestId?: string,
  ): Promise<TransactionView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransactionView>(
        tx,
        idempotencyInput(budgetId, userId, key, `transaction.delete:${transactionId}`, {}),
        async () => {
          const current = await this.requireMutableTransaction(tx, userId, budgetId, transactionId);
          if (current.status === 'DELETED') throw invalidTransactionState();
          const allocations =
            current.transactionType === 'INCOME' && current.status === 'CONFIRMED'
              ? await this.repository.findConfirmedAllocationsForIncome(tx, budgetId, current.id)
              : [];
          if (allocations.length > 0) throw incomeHasConfirmedAllocations(allocations);
          const transaction = await this.repository.updateLifecycle(
            tx,
            current,
            'DELETED',
            userId,
            requestId,
          );
          return { status: 200, body: await this.toViewWithAllocationProposal(transaction) };
        },
      );
      return result.body;
    });
  }

  async deleteWithAllocations(
    userId: string,
    budgetId: string,
    transactionId: string,
    input: ResolveIncomeDeletionInput,
    key: string,
    requestId?: string,
  ): Promise<TransactionView> {
    await this.requireMutationBudget(userId, budgetId);
    const allocations = this.allocations;
    if (!allocations) throw new Error('Income allocation repository is required.');
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransactionView>(
        tx,
        idempotencyInput(
          budgetId,
          userId,
          key,
          `transaction.resolve-delete:${transactionId}`,
          input,
        ),
        async () => {
          const current = await this.requireMutableTransaction(tx, userId, budgetId, transactionId);
          if (current.transactionType !== 'INCOME' || current.status !== 'CONFIRMED') {
            throw invalidTransactionState();
          }
          const linked = await this.repository.findConfirmedAllocationsForIncome(
            tx,
            budgetId,
            current.id,
          );
          if (linked.length === 0) throw invalidTransactionState();
          for (const linkedAllocation of linked) {
            const allocation = await allocations.findForMutation(
              tx,
              userId,
              budgetId,
              linkedAllocation.id,
            );
            if (!allocation || allocation.status !== 'CONFIRMED') throw invalidTransactionState();
            if (input.allocationResolution === 'CANCEL') {
              await allocations.cancel(tx, allocation, userId, requestId);
            } else {
              await allocations.delete(tx, allocation, userId, requestId);
            }
          }
          const transaction = await this.repository.updateLifecycle(
            tx,
            current,
            'DELETED',
            userId,
            requestId,
          );
          return { status: 200, body: await this.toViewWithAllocationProposal(transaction) };
        },
      );
      return result.body;
    });
  }

  async restore(
    userId: string,
    budgetId: string,
    transactionId: string,
    key: string,
    requestId?: string,
  ): Promise<TransactionView> {
    const budget = await this.requireOwnerBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransactionView>(
        tx,
        idempotencyInput(budgetId, userId, key, `transaction.restore:${transactionId}`, {}),
        async () => {
          const current = await this.requireMutableTransaction(tx, userId, budgetId, transactionId);
          if (current.status !== 'DELETED') throw invalidTransactionState();
          const status = restoredTransactionStatus(current.preDeleteStatus);
          if (status === 'CONFIRMED') {
            await this.validateReferences(
              tx,
              budgetId,
              current.transactionType,
              current.accountId,
              current.categoryId,
              current.envelopeId,
            );
            if (current.transactionType === 'EXPENSE') {
              if (!current.envelopeId) throw invalidReference();
              const capacity = await this.repository.assertConfirmedExpenseCapacity(
                tx,
                budgetId,
                current.accountId,
                current.envelopeId,
                current.amountMinor,
              );
              if (!budget.allowNegativeBalance && !capacity) throw insufficientBalance();
            }
          }
          const transaction = await this.repository.restoreLifecycle(
            tx,
            current,
            status,
            userId,
            requestId,
          );
          return { status: 200, body: await this.toViewWithAllocationProposal(transaction) };
        },
      );
      return result.body;
    });
  }

  toView(transaction: TransactionRecord): TransactionView {
    return {
      id: transaction.id,
      budgetId: transaction.budgetId,
      transactionType: transaction.transactionType,
      status: transaction.status,
      amountMinor: formatMinorUnits(transaction.amountMinor),
      currency: 'RUB',
      scale: 2,
      occurredOn: dateValue(transaction.occurredOn),
      accountId: transaction.accountId,
      categoryId: transaction.categoryId,
      envelopeId: transaction.envelopeId,
      sourceDescription: transaction.sourceDescription,
      merchantName: transaction.merchantName,
      isPlanned: transaction.isPlanned,
      comment: transaction.comment,
      confirmedAt: transaction.confirmedAt?.toISOString() ?? null,
      cancelledAt: transaction.cancelledAt?.toISOString() ?? null,
      deletedAt: transaction.deletedAt?.toISOString() ?? null,
      accountCurrentBalanceMinor: formatMinorUnits(transaction.accountCurrentBalanceMinor),
      envelopeCurrentBalanceMinor:
        transaction.envelopeCurrentBalanceMinor === null
          ? null
          : formatMinorUnits(transaction.envelopeCurrentBalanceMinor),
      unallocatedMinor:
        transaction.transactionType === 'INCOME' ? formatMinorUnits(transaction.amountMinor) : '0',
      allocationProposal: null,
    };
  }

  private async toViewWithAllocationProposal(
    transaction: TransactionRecord,
  ): Promise<TransactionView> {
    const view = this.toView(transaction);
    if (
      !this.allocations ||
      transaction.transactionType !== 'INCOME' ||
      transaction.status !== 'CONFIRMED'
    ) {
      return view;
    }

    return this.allocations.runTransaction(async (tx) => {
      const [rule, confirmedTotal] = await Promise.all([
        this.allocations?.findBudgetAllocationRule(transaction.budgetId),
        this.allocations?.sumConfirmedForIncome(tx, transaction.budgetId, transaction.id),
      ]);
      const unallocatedMinor = transaction.amountMinor - (confirmedTotal ?? 0n);
      if (
        !rule?.enabled ||
        rule.sourceCategoryId !== transaction.categoryId ||
        !rule.targetEnvelopeId ||
        unallocatedMinor <= 0n
      ) {
        return { ...view, unallocatedMinor: formatMinorUnits(unallocatedMinor) };
      }
      const target = await this.allocations?.findActiveProposalEnvelope(
        transaction.budgetId,
        rule.targetEnvelopeId,
      );
      return {
        ...view,
        unallocatedMinor: formatMinorUnits(unallocatedMinor),
        allocationProposal: target
          ? {
              targetEnvelopeId: target.id,
              amountMinor: formatMinorUnits(unallocatedMinor),
              currency: 'RUB',
              scale: 2,
            }
          : null,
      };
    });
  }

  private async requireOwnerBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (budget.workspace.memberships[0]?.role !== 'OWNER') throw forbidden();
    return budget;
  }

  private async requireMutationBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if (role !== 'OWNER' && role !== 'EDITOR') throw forbidden();
    return budget;
  }

  private async requireMutableTransaction(
    tx: Parameters<TransactionRepository['findForMutation']>[0],
    userId: string,
    budgetId: string,
    transactionId: string,
  ): Promise<TransactionRecord> {
    const transaction = await this.repository.findForMutation(tx, userId, budgetId, transactionId);
    if (!transaction) throw resourceNotFound();
    return transaction;
  }

  private async createData(
    tx: Parameters<TransactionRepository['findActiveReferences']>[0],
    budgetId: string,
    userId: string,
    input: CreateTransactionInput,
    allowNegativeBalance: boolean,
  ): Promise<TransactionCreateData> {
    const amountMinor = parseDecimalToMinorUnits(input.amount, 2, false);
    const envelopeId = input.envelopeId ?? null;
    validateFieldCompatibility(
      input.transactionType,
      envelopeId,
      input.sourceDescription ?? null,
      input.merchantName ?? null,
    );
    await this.validateReferences(
      tx,
      budgetId,
      input.transactionType,
      input.accountId,
      input.categoryId,
      envelopeId,
    );
    if (input.transactionType === 'EXPENSE' && input.status === 'CONFIRMED') {
      if (!envelopeId) throw invalidReference();
      const capacity = await this.repository.assertConfirmedExpenseCapacity(
        tx,
        budgetId,
        input.accountId,
        envelopeId,
        amountMinor,
      );
      if (!allowNegativeBalance && !capacity) throw insufficientBalance();
    }

    return {
      budgetId,
      transactionType: input.transactionType,
      status: input.status,
      amountMinor,
      occurredOn: parseDate(input.occurredOn),
      accountId: input.accountId,
      categoryId: input.categoryId,
      envelopeId,
      sourceDescription: input.sourceDescription ?? null,
      merchantName: input.merchantName ?? null,
      isPlanned: input.isPlanned,
      comment: input.comment ?? null,
      confirmedAt: input.status === 'CONFIRMED' ? new Date() : null,
      createdByUserId: userId,
      updatedByUserId: userId,
    };
  }

  private async updateData(
    tx: Parameters<TransactionRepository['findActiveReferences']>[0],
    budgetId: string,
    userId: string,
    current: TransactionRecord,
    input: UpdateTransactionInput,
    allowNegativeBalance: boolean,
  ): Promise<TransactionUpdateData> {
    const amountMinor =
      input.amount === undefined
        ? current.amountMinor
        : parseDecimalToMinorUnits(input.amount, 2, false);
    const accountId = input.accountId ?? current.accountId;
    const categoryId = input.categoryId ?? current.categoryId;
    const envelopeId = input.envelopeId === undefined ? current.envelopeId : input.envelopeId;
    const sourceDescription =
      input.sourceDescription === undefined ? current.sourceDescription : input.sourceDescription;
    const merchantName =
      input.merchantName === undefined ? current.merchantName : input.merchantName;
    validateFieldCompatibility(
      current.transactionType,
      envelopeId,
      sourceDescription,
      merchantName,
    );
    await this.validateReferences(
      tx,
      budgetId,
      current.transactionType,
      accountId,
      categoryId,
      envelopeId,
    );
    if (current.transactionType === 'EXPENSE' && current.status === 'CONFIRMED') {
      if (!envelopeId) throw invalidReference();
      const capacity = await this.repository.assertConfirmedExpenseCapacity(
        tx,
        budgetId,
        accountId,
        envelopeId,
        amountMinor,
        current,
      );
      if (!allowNegativeBalance && !capacity) throw insufficientBalance();
    }

    return {
      ...(input.amount !== undefined ? { amountMinor } : {}),
      ...(input.occurredOn !== undefined ? { occurredOn: parseDate(input.occurredOn) } : {}),
      ...(input.accountId !== undefined ? { accountId } : {}),
      ...(input.categoryId !== undefined ? { categoryId } : {}),
      ...(input.envelopeId !== undefined ? { envelopeId } : {}),
      ...(input.sourceDescription !== undefined
        ? { sourceDescription: input.sourceDescription }
        : {}),
      ...(input.merchantName !== undefined ? { merchantName: input.merchantName } : {}),
      ...(input.isPlanned !== undefined ? { isPlanned: input.isPlanned } : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      updatedByUserId: userId,
    };
  }

  private async validateReferences(
    tx: Parameters<TransactionRepository['findActiveReferences']>[0],
    budgetId: string,
    transactionType: 'INCOME' | 'EXPENSE',
    accountId: string,
    categoryId: string,
    envelopeId: string | null,
  ): Promise<void> {
    const references = await this.repository.findActiveReferences(
      tx,
      budgetId,
      accountId,
      categoryId,
      envelopeId,
    );
    if (
      !references.account ||
      !references.category ||
      references.account.currency !== 'RUB' ||
      references.account.scale !== 2 ||
      references.category.categoryType !== transactionType ||
      (transactionType === 'EXPENSE' && !references.envelope) ||
      (references.envelope &&
        (references.envelope.currency !== 'RUB' || references.envelope.scale !== 2))
    ) {
      throw invalidReference();
    }
  }
}

function listQuery(
  input: ListTransactionsInput,
  budget: {
    cycleStartDay: number;
    periodBoundaryOffset: number;
    timezone: string;
  },
): TransactionListQuery {
  const cycle = input.cycleStart ? cycleAndPeriodFor(budget, input.cycleStart).cycle : null;
  const period = input.periodStart ? cycleAndPeriodFor(budget, input.periodStart).period : null;
  return {
    limit: input.limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.search ? { search: input.search } : {}),
    ...(input.type ? { transactionType: input.type } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.from ? { from: parseDate(input.from) } : {}),
    ...(input.to ? { to: parseDate(input.to) } : {}),
    ...(cycle ? { cycle: { start: parseDate(cycle.start), end: parseDate(cycle.end) } } : {}),
    ...(period ? { period: { start: parseDate(period.start), end: parseDate(period.end) } } : {}),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
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

function validateFieldCompatibility(
  transactionType: 'INCOME' | 'EXPENSE',
  envelopeId: string | null,
  sourceDescription: string | null,
  merchantName: string | null,
): void {
  if (
    (transactionType === 'INCOME' && (envelopeId !== null || merchantName !== null)) ||
    (transactionType === 'EXPENSE' && (envelopeId === null || sourceDescription !== null))
  ) {
    throw invalidReference();
  }
}

function restoredTransactionStatus(
  status: TransactionRecord['preDeleteStatus'],
): 'DRAFT' | 'CONFIRMED' | 'CANCELLED' {
  if (status === 'DRAFT' || status === 'CONFIRMED' || status === 'CANCELLED') return status;
  throw invalidTransactionState();
}

function incomeHasConfirmedAllocations(allocations: Array<{ id: string }>): ConflictException {
  return new ConflictException({
    code: 'INCOME_HAS_CONFIRMED_ALLOCATIONS',
    detail: 'Подтверждённый доход имеет связанные распределения.',
    allocationIds: allocations.map((allocation) => allocation.id),
    allocationCount: allocations.length,
  });
}

function allocationsExceedIncome(): ConflictException {
  return new ConflictException({
    code: 'ALLOCATION_EXCEEDS_INCOME',
    detail: 'Сумма распределений превышает доход.',
  });
}

function invalidTransactionState(): ConflictException {
  return new ConflictException({
    code: 'TRANSACTION_STATE_INVALID',
    detail: 'Операция недоступна в текущем состоянии.',
  });
}

function insufficientBalance(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INSUFFICIENT_BALANCE',
    detail: 'Недостаточно средств на счёте или в конверте.',
  });
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}
