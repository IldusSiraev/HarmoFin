import { createHash } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import {
  forbidden,
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import {
  IncomeAllocationRepository,
  type IncomeAllocationCreateData,
  type IncomeAllocationRecord,
  type IncomeAllocationUpdateData,
  type IncomeRecord,
} from './income-allocation.repository.js';
import type {
  CreateIncomeAllocationInput,
  UpdateIncomeAllocationInput,
} from './income-allocation.schemas.js';

export interface AllocationProposal {
  targetEnvelopeId: string;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
}

export interface IncomeAllocationView {
  [key: string]: unknown;
  id: string;
  budgetId: string;
  incomeTransactionId: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  accountId: string;
  envelopeId: string;
  comment: string | null;
  deletedAt: string | null;
  remainingUnallocatedMinor: string;
  envelopeCurrentBalanceMinor: string;
}

@Injectable()
export class IncomeAllocationApplicationService {
  constructor(
    private readonly repository: IncomeAllocationRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(
    userId: string,
    budgetId: string,
    incomeTransactionId: string,
    input: CreateIncomeAllocationInput,
    key: string,
    requestId?: string,
  ): Promise<IncomeAllocationView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<IncomeAllocationView>(
        tx,
        idempotencyInput(
          budgetId,
          userId,
          key,
          `income-allocation.create:${incomeTransactionId}`,
          input,
        ),
        async () => {
          const income = await this.requireConfirmedIncome(tx, budgetId, incomeTransactionId);
          const data = await this.createData(tx, budgetId, income, userId, input);
          const allocation = await this.repository.create(tx, data, userId, requestId);
          return { status: 201, body: this.toView(allocation) };
        },
      );
      return result.body;
    });
  }

  async update(
    userId: string,
    budgetId: string,
    allocationId: string,
    input: UpdateIncomeAllocationInput,
    key: string,
    requestId?: string,
  ): Promise<IncomeAllocationView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<IncomeAllocationView>(
        tx,
        idempotencyInput(budgetId, userId, key, `income-allocation.update:${allocationId}`, input),
        async () => {
          const current = await this.requireMutableAllocation(tx, userId, budgetId, allocationId);
          const income = await this.requireConfirmedIncome(
            tx,
            budgetId,
            current.incomeTransactionId,
          );
          const data = await this.updateData(tx, budgetId, income, current, userId, input);
          const allocation = await this.repository.update(tx, current, data, userId, requestId);
          return { status: 200, body: this.toView(allocation) };
        },
      );
      return result.body;
    });
  }

  async delete(
    userId: string,
    budgetId: string,
    allocationId: string,
    key: string,
    requestId?: string,
  ): Promise<IncomeAllocationView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<IncomeAllocationView>(
        tx,
        idempotencyInput(budgetId, userId, key, `income-allocation.delete:${allocationId}`, {}),
        async () => {
          const current = await this.requireMutableAllocation(tx, userId, budgetId, allocationId);
          await this.requireConfirmedIncome(tx, budgetId, current.incomeTransactionId);
          const allocation = await this.repository.delete(tx, current, userId, requestId);
          return { status: 200, body: this.toView(allocation) };
        },
      );
      return result.body;
    });
  }

  async restore(
    userId: string,
    budgetId: string,
    allocationId: string,
    key: string,
    requestId?: string,
  ): Promise<IncomeAllocationView> {
    await this.requireOwnerBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<IncomeAllocationView>(
        tx,
        idempotencyInput(budgetId, userId, key, `income-allocation.restore:${allocationId}`, {}),
        async () => {
          const current = await this.requireDeletedAllocation(tx, userId, budgetId, allocationId);
          const status = restoredAllocationStatus(current.preDeleteStatus);
          if (status === 'CONFIRMED') {
            const income = await this.requireConfirmedIncome(
              tx,
              budgetId,
              current.incomeTransactionId,
            );
            await this.validateTargets(tx, budgetId, current.accountId, current.envelopeId);
            await this.assertAllocationTotal(tx, budgetId, income, current.amountMinor);
          }
          const allocation = await this.repository.restore(tx, current, userId, requestId);
          return { status: 200, body: this.toView(allocation) };
        },
      );
      return result.body;
    });
  }

  async listForIncome(
    userId: string,
    budgetId: string,
    incomeTransactionId: string,
  ): Promise<IncomeAllocationView[]> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return (await this.repository.listForIncome(userId, budgetId, incomeTransactionId)).map(
      (item) => this.toView(item),
    );
  }

  async proposalFor(income: IncomeRecord): Promise<AllocationProposal | null> {
    if (income.transactionType !== 'INCOME' || income.status !== 'CONFIRMED') return null;
    return this.repository.runTransaction(async (tx) => {
      const [rule, confirmedTotal] = await Promise.all([
        this.repository.findBudgetAllocationRule(income.budgetId),
        this.repository.sumConfirmedForIncome(tx, income.budgetId, income.id),
      ]);
      if (!rule?.enabled || rule.sourceCategoryId !== income.categoryId || !rule.targetEnvelopeId)
        return null;
      const target = await this.repository.findActiveProposalEnvelope(
        income.budgetId,
        rule.targetEnvelopeId,
      );
      const unallocatedMinor = income.amountMinor - confirmedTotal;
      if (!target || unallocatedMinor <= 0n) return null;
      return {
        targetEnvelopeId: target.id,
        amountMinor: formatMinorUnits(unallocatedMinor),
        currency: 'RUB',
        scale: 2,
      };
    });
  }

  toView(allocation: IncomeAllocationRecord): IncomeAllocationView {
    return {
      id: allocation.id,
      budgetId: allocation.budgetId,
      incomeTransactionId: allocation.incomeTransactionId,
      status: allocation.status,
      amountMinor: formatMinorUnits(allocation.amountMinor),
      currency: 'RUB',
      scale: 2,
      occurredOn: allocation.occurredOn.toISOString().slice(0, 10),
      accountId: allocation.accountId,
      envelopeId: allocation.envelopeId,
      comment: allocation.comment,
      deletedAt: allocation.deletedAt?.toISOString() ?? null,
      remainingUnallocatedMinor: formatMinorUnits(allocation.remainingUnallocatedMinor),
      envelopeCurrentBalanceMinor: formatMinorUnits(allocation.envelopeCurrentBalanceMinor),
    };
  }

  private async createData(
    tx: Parameters<IncomeAllocationRepository['findConfirmedIncome']>[0],
    budgetId: string,
    income: IncomeRecord,
    userId: string,
    input: CreateIncomeAllocationInput,
  ): Promise<IncomeAllocationCreateData> {
    const amountMinor = parsePositiveAmount(input.amount);
    await this.validateTargets(tx, budgetId, input.accountId, input.envelopeId);
    await this.assertAllocationTotal(tx, budgetId, income, amountMinor);
    return {
      budgetId,
      incomeTransactionId: income.id,
      amountMinor,
      occurredOn: parseDate(input.occurredOn),
      accountId: input.accountId,
      envelopeId: input.envelopeId,
      comment: input.comment ?? null,
      createdByUserId: userId,
      updatedByUserId: userId,
    };
  }

  private async updateData(
    tx: Parameters<IncomeAllocationRepository['findConfirmedIncome']>[0],
    budgetId: string,
    income: IncomeRecord,
    current: IncomeAllocationRecord,
    userId: string,
    input: UpdateIncomeAllocationInput,
  ): Promise<IncomeAllocationUpdateData> {
    const amountMinor =
      input.amount === undefined ? current.amountMinor : parsePositiveAmount(input.amount);
    const accountId = input.accountId ?? current.accountId;
    const envelopeId = input.envelopeId ?? current.envelopeId;
    await this.validateTargets(tx, budgetId, accountId, envelopeId);
    await this.assertAllocationTotal(tx, budgetId, income, amountMinor, current.amountMinor);
    return {
      ...(input.amount !== undefined ? { amountMinor } : {}),
      ...(input.occurredOn !== undefined ? { occurredOn: parseDate(input.occurredOn) } : {}),
      ...(input.accountId !== undefined ? { accountId } : {}),
      ...(input.envelopeId !== undefined ? { envelopeId } : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      updatedByUserId: userId,
    };
  }

  private async assertAllocationTotal(
    tx: Parameters<IncomeAllocationRepository['sumConfirmedForIncome']>[0],
    budgetId: string,
    income: IncomeRecord,
    nextAmountMinor: bigint,
    replacedAmountMinor = 0n,
  ): Promise<void> {
    const confirmedTotal = await this.repository.sumConfirmedForIncome(tx, budgetId, income.id);
    if (confirmedTotal - replacedAmountMinor + nextAmountMinor > income.amountMinor)
      throw allocationExceedsIncome();
  }

  private async validateTargets(
    tx: Parameters<IncomeAllocationRepository['findActiveTargets']>[0],
    budgetId: string,
    accountId: string,
    envelopeId: string,
  ): Promise<void> {
    const targets = await this.repository.findActiveTargets(tx, budgetId, accountId, envelopeId);
    if (
      !targets.account ||
      !targets.envelope ||
      targets.account.currency !== 'RUB' ||
      targets.account.scale !== 2 ||
      targets.envelope.currency !== 'RUB' ||
      targets.envelope.scale !== 2
    )
      throw invalidReference();
  }

  private async requireConfirmedIncome(
    tx: Parameters<IncomeAllocationRepository['findConfirmedIncome']>[0],
    budgetId: string,
    incomeTransactionId: string,
  ): Promise<IncomeRecord> {
    const income = await this.repository.findConfirmedIncome(tx, budgetId, incomeTransactionId);
    if (!income || income.currency !== 'RUB' || income.scale !== 2) throw invalidReference();
    return income;
  }

  private async requireMutableAllocation(
    tx: Parameters<IncomeAllocationRepository['findForMutation']>[0],
    userId: string,
    budgetId: string,
    allocationId: string,
  ): Promise<IncomeAllocationRecord> {
    const allocation = await this.repository.findForMutation(tx, userId, budgetId, allocationId);
    if (!allocation) throw resourceNotFound();
    if (allocation.status === 'DELETED') throw allocationStateInvalid();
    return allocation;
  }

  private async requireDeletedAllocation(
    tx: Parameters<IncomeAllocationRepository['findForMutation']>[0],
    userId: string,
    budgetId: string,
    allocationId: string,
  ): Promise<IncomeAllocationRecord> {
    const allocation = await this.repository.findForMutation(tx, userId, budgetId, allocationId);
    if (!allocation) throw resourceNotFound();
    if (allocation.status !== 'DELETED') throw allocationStateInvalid();
    return allocation;
  }

  private async requireOwnerBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (budget.workspace.memberships[0]?.role !== 'OWNER') throw forbidden();
  }

  private async requireMutationBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if (role !== 'OWNER' && role !== 'EDITOR') throw forbidden();
  }
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

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function restoredAllocationStatus(
  status: IncomeAllocationRecord['preDeleteStatus'],
): 'CONFIRMED' | 'CANCELLED' {
  if (status === 'CONFIRMED' || status === 'CANCELLED') return status;
  throw allocationStateInvalid();
}

function allocationExceedsIncome(): ConflictException {
  return new ConflictException({
    code: 'ALLOCATION_EXCEEDS_INCOME',
    detail: 'Сумма распределений превышает доход.',
  });
}

function allocationStateInvalid(): ConflictException {
  return new ConflictException({
    code: 'ALLOCATION_STATE_INVALID',
    detail: 'Распределение недоступно в текущем состоянии.',
  });
}
