import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PlanOccurrenceCancellationReason } from '@prisma/client';

import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import {
  TransactionRepository,
  type TransactionCreateData,
  type TransactionRecord,
} from '../transactions/transaction.repository.js';
import {
  RegularPlanRepository,
  type PlanOccurrenceRecord,
  type RegularPlanCreateData,
  type RegularPlanRecord,
  type RegularPlanUpdateData,
} from './regular-plan.repository.js';
import type {
  CreateRegularPlanInput,
  ListPlanOccurrencesInput,
  ListRegularPlansInput,
  UpdateRegularPlanInput,
} from './plans.schemas.js';

export type RegularPlanView = {
  id: string;
  budgetId: string;
  name: string;
  planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  anchorOn: string;
  startOn: string;
  endOn: string | null;
  recurrence: 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';
  intervalMonths: number | null;
  accountId: string | null;
  categoryId: string | null;
  envelopeId: string | null;
  comment: string | null;
  isActive: boolean;
  disabledAt: string | null;
  deletedAt: string | null;
};

export type TransactionDraftView = {
  id: string;
  budgetId: string;
  transactionType: 'INCOME' | 'EXPENSE';
  status: 'DRAFT';
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  sourceDescription: string | null;
  merchantName: string | null;
  isPlanned: true;
  comment: string | null;
  confirmedAt: null;
  cancelledAt: null;
  deletedAt: null;
  accountCurrentBalanceMinor: string;
  envelopeCurrentBalanceMinor: string | null;
  unallocatedMinor: string;
  allocationProposal: null;
};

export type PlanOccurrenceView = {
  id: string;
  planId: string;
  planName: string;
  planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
  scheduledOn: string;
  status: 'PENDING' | 'DUE' | 'SKIPPED' | 'COMPLETED' | 'CANCELLED';
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  accountId: string | null;
  categoryId: string | null;
  envelopeId: string | null;
  comment: string | null;
  transactionId: string | null;
  cancellationReason: 'PLAN_CHANGED' | 'PLAN_DISABLED' | 'PLAN_DELETED' | null;
};

@Injectable()
export class RegularPlanApplicationService {
  constructor(
    private readonly repository: RegularPlanRepository,
    private readonly transactions: TransactionRepository,
    private readonly idempotency: IdempotencyService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(
    userId: string,
    budgetId: string,
    input: ListRegularPlansInput,
  ): Promise<{ items: RegularPlanView[] }> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const plans = await this.repository.list(userId, budgetId, input.status);
    return { items: plans.map((plan) => this.toPlanView(plan)) };
  }

  async get(userId: string, budgetId: string, planId: string): Promise<RegularPlanView> {
    const plan = await this.repository.find(userId, budgetId, planId);
    if (!plan) throw resourceNotFound();
    return this.toPlanView(plan);
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateRegularPlanInput,
    key: string,
    requestId?: string,
  ): Promise<RegularPlanView> {
    const budget = await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<RegularPlanView>(
        tx,
        idempotencyInput(budgetId, userId, key, 'regular-plan.create', input),
        async () => {
          const data = await this.createData(tx, budget, userId, input);
          const plan = await this.repository.createPlan(tx, data, userId, requestId);
          return { status: 201, body: this.toPlanView(plan) };
        },
      );
      return result.body;
    });
  }

  async update(
    userId: string,
    budgetId: string,
    planId: string,
    input: UpdateRegularPlanInput,
    key: string,
    requestId?: string,
  ): Promise<RegularPlanView> {
    const budget = await this.requireMutationBudget(userId, budgetId);
    const after = parseDate(todayInTimezone(this.now(), budget.timezone));
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<RegularPlanView>(
        tx,
        idempotencyInput(budgetId, userId, key, `regular-plan.update:${planId}`, input),
        async () => {
          const current = await this.requirePlanForMutation(tx, userId, budgetId, planId);
          const data = await this.updateData(tx, current, userId, input);
          const plan = await this.repository.updatePlan(tx, current, data, userId, requestId);
          const reason = cancellationReason(current, plan);
          if (reason) {
            await this.repository.cancelFuturePendingOccurrences(
              tx,
              userId,
              budgetId,
              planId,
              after,
              reason,
              requestId,
            );
          }
          return { status: 200, body: this.toPlanView(plan) };
        },
      );
      return result.body;
    });
  }

  async remove(
    userId: string,
    budgetId: string,
    planId: string,
    key: string,
    requestId?: string,
  ): Promise<RegularPlanView> {
    const budget = await this.requireOwnerBudget(userId, budgetId);
    const after = parseDate(todayInTimezone(this.now(), budget.timezone));
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<RegularPlanView>(
        tx,
        idempotencyInput(budgetId, userId, key, `regular-plan.delete:${planId}`, {}),
        async () => {
          const current = await this.requirePlanForMutation(tx, userId, budgetId, planId);
          const plan = await this.repository.removePlan(tx, current, userId, requestId);
          await this.repository.cancelFuturePendingOccurrences(
            tx,
            userId,
            budgetId,
            planId,
            after,
            'PLAN_DELETED',
            requestId,
          );
          return { status: 200, body: this.toPlanView(plan) };
        },
      );
      return result.body;
    });
  }

  async listOccurrences(
    userId: string,
    budgetId: string,
    input: ListPlanOccurrencesInput,
  ): Promise<{ items: PlanOccurrenceView[] }> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (input.planId && !(await this.repository.find(userId, budgetId, input.planId))) {
      throw resourceNotFound();
    }
    const occurrences = await this.repository.listOccurrences(userId, budgetId, {
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.from ? { from: parseDate(input.from) } : {}),
      ...(input.to ? { to: parseDate(input.to) } : {}),
    });
    return { items: occurrences.map((occurrence) => this.toOccurrenceView(occurrence)) };
  }

  async skipOccurrence(
    userId: string,
    budgetId: string,
    occurrenceId: string,
    key: string,
    requestId?: string,
  ): Promise<PlanOccurrenceView> {
    return this.transitionOccurrence(userId, budgetId, occurrenceId, key, 'SKIPPED', requestId);
  }

  async completeOccurrence(
    userId: string,
    budgetId: string,
    occurrenceId: string,
    key: string,
    requestId?: string,
  ): Promise<PlanOccurrenceView> {
    return this.transitionOccurrence(userId, budgetId, occurrenceId, key, 'COMPLETED', requestId);
  }

  async createDraftFromOccurrence(
    userId: string,
    budgetId: string,
    occurrenceId: string,
    key: string,
    requestId?: string,
  ): Promise<TransactionDraftView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<TransactionDraftView>(
        tx,
        idempotencyInput(budgetId, userId, key, `plan-occurrence.create-draft:${occurrenceId}`, {}),
        async () => {
          const occurrence = await this.requireOccurrenceForMutation(
            tx,
            userId,
            budgetId,
            occurrenceId,
          );
          if (occurrence.planType === 'SAVINGS') throw planTypeNotTransactional();
          if (
            (occurrence.status !== 'PENDING' && occurrence.status !== 'DUE') ||
            occurrence.transactionId !== null
          ) {
            throw occurrenceStateInvalid();
          }
          const transaction = await this.transactions.create(
            tx,
            await this.createDraftData(tx, occurrence, userId),
            userId,
            requestId,
          );
          await this.repository.linkDraftTransaction(
            tx,
            occurrence,
            transaction.id,
            userId,
            requestId,
          );
          return { status: 201, body: this.toTransactionDraftView(transaction) };
        },
      );
      return result.body;
    });
  }

  private async transitionOccurrence(
    userId: string,
    budgetId: string,
    occurrenceId: string,
    key: string,
    status: 'SKIPPED' | 'COMPLETED',
    requestId?: string,
  ): Promise<PlanOccurrenceView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<PlanOccurrenceView>(
        tx,
        idempotencyInput(
          budgetId,
          userId,
          key,
          `plan-occurrence.${status.toLowerCase()}:${occurrenceId}`,
          {},
        ),
        async () => {
          const occurrence = await this.requireOccurrenceForMutation(
            tx,
            userId,
            budgetId,
            occurrenceId,
          );
          if (
            (occurrence.status !== 'PENDING' && occurrence.status !== 'DUE') ||
            occurrence.transactionId !== null
          ) {
            throw occurrenceStateInvalid();
          }
          const updated = await this.repository.transitionOccurrence(
            tx,
            occurrence,
            status,
            userId,
            requestId,
          );
          return { status: 200, body: this.toOccurrenceView(updated) };
        },
      );
      return result.body;
    });
  }

  private async createData(
    tx: Parameters<RegularPlanRepository['findActiveReferences']>[0],
    budget: { id: string; workspaceId: string },
    userId: string,
    input: CreateRegularPlanInput,
  ): Promise<RegularPlanCreateData> {
    const planType = input.planType;
    const accountId = input.accountId ?? null;
    const categoryId = input.categoryId ?? null;
    const envelopeId = input.envelopeId ?? null;
    const amountMinor = parseAmount(input.amount);
    await this.validateReferences(tx, budget.id, planType, accountId, categoryId, envelopeId);
    const isActive = input.isActive ?? true;
    return {
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      name: input.name,
      planType,
      amountMinor,
      anchorOn: parseDate(input.anchorOn),
      startOn: parseDate(input.startOn),
      endOn: input.endOn ? parseDate(input.endOn) : null,
      recurrence: input.recurrence,
      intervalMonths: input.intervalMonths ?? null,
      accountId,
      categoryId,
      envelopeId,
      comment: input.comment ?? null,
      isActive,
      disabledAt: isActive ? null : this.now(),
      createdByUserId: userId,
      updatedByUserId: userId,
    };
  }

  private async createDraftData(
    tx: Parameters<TransactionRepository['findActiveReferences']>[0],
    occurrence: PlanOccurrenceRecord,
    userId: string,
  ): Promise<TransactionCreateData> {
    if (!occurrence.accountId || !occurrence.categoryId) throw invalidPlanReference();
    const references = await this.transactions.findActiveReferences(
      tx,
      occurrence.budgetId,
      occurrence.accountId,
      occurrence.categoryId,
      occurrence.envelopeId,
    );
    if (
      !references.account ||
      references.account.currency !== 'RUB' ||
      references.account.scale !== 2 ||
      !references.category ||
      references.category.categoryType !==
        (occurrence.planType === 'INCOME' ? 'INCOME' : 'EXPENSE') ||
      (occurrence.planType === 'EXPENSE' &&
        (!references.envelope ||
          references.envelope.currency !== 'RUB' ||
          references.envelope.scale !== 2))
    ) {
      throw invalidPlanReference();
    }
    return {
      budgetId: occurrence.budgetId,
      transactionType: occurrence.planType === 'INCOME' ? 'INCOME' : 'EXPENSE',
      status: 'DRAFT',
      amountMinor: occurrence.amountMinor,
      occurredOn: occurrence.scheduledOn,
      accountId: occurrence.accountId,
      categoryId: occurrence.categoryId,
      envelopeId: occurrence.planType === 'INCOME' ? null : occurrence.envelopeId,
      sourceDescription: occurrence.planType === 'INCOME' ? occurrence.planName : null,
      merchantName: occurrence.planType === 'EXPENSE' ? occurrence.planName : null,
      isPlanned: true,
      comment: occurrence.comment,
      confirmedAt: null,
      createdByUserId: userId,
      updatedByUserId: userId,
    };
  }

  private toTransactionDraftView(transaction: TransactionRecord): TransactionDraftView {
    if (transaction.status !== 'DRAFT') throw new Error('Expected draft transaction.');
    return {
      id: transaction.id,
      budgetId: transaction.budgetId,
      transactionType: transaction.transactionType,
      status: 'DRAFT',
      amountMinor: formatMinorUnits(transaction.amountMinor),
      currency: 'RUB',
      scale: 2,
      occurredOn: dateValue(transaction.occurredOn),
      accountId: transaction.accountId,
      categoryId: transaction.categoryId,
      envelopeId: transaction.envelopeId,
      sourceDescription: transaction.sourceDescription,
      merchantName: transaction.merchantName,
      isPlanned: true,
      comment: transaction.comment,
      confirmedAt: null,
      cancelledAt: null,
      deletedAt: null,
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

  private async updateData(
    tx: Parameters<RegularPlanRepository['findActiveReferences']>[0],
    current: RegularPlanRecord,
    userId: string,
    input: UpdateRegularPlanInput,
  ): Promise<RegularPlanUpdateData> {
    const planType = input.planType ?? current.planType;
    const accountId = input.accountId === undefined ? current.accountId : input.accountId;
    const categoryId = input.categoryId === undefined ? current.categoryId : input.categoryId;
    const envelopeId = input.envelopeId === undefined ? current.envelopeId : input.envelopeId;
    const recurrence = input.recurrence ?? current.recurrence;
    const intervalMonths =
      input.intervalMonths === undefined ? current.intervalMonths : input.intervalMonths;
    const anchorOn = input.anchorOn ? parseDate(input.anchorOn) : current.anchorOn;
    const startOn = input.startOn ? parseDate(input.startOn) : current.startOn;
    const endOn =
      input.endOn === undefined ? current.endOn : input.endOn ? parseDate(input.endOn) : null;
    if (endOn && endOn < startOn)
      throw invalidPlan('endOn', 'Дата окончания не может быть раньше даты начала.');
    if (recurrence === 'ONE_TIME' && anchorOn.getTime() !== startOn.getTime()) {
      throw invalidPlan(
        'anchorOn',
        'Для разового плана опорная дата должна совпадать с датой начала.',
      );
    }
    if (
      (recurrence === 'EVERY_N_MONTHS' && !intervalMonths) ||
      (recurrence !== 'EVERY_N_MONTHS' && intervalMonths !== null)
    ) {
      throw invalidPlan('intervalMonths', 'Укажите корректный интервал в месяцах.');
    }
    await this.validateReferences(
      tx,
      current.budgetId,
      planType,
      accountId,
      categoryId,
      envelopeId,
    );
    const isActive = input.isActive ?? current.isActive;
    return {
      name: input.name ?? current.name,
      planType,
      amountMinor: input.amount ? parseAmount(input.amount) : current.amountMinor,
      anchorOn,
      startOn,
      endOn,
      recurrence,
      intervalMonths,
      accountId,
      categoryId,
      envelopeId,
      comment: input.comment === undefined ? current.comment : input.comment,
      isActive,
      disabledAt: isActive ? null : (current.disabledAt ?? this.now()),
      updatedByUserId: userId,
    };
  }

  private async validateReferences(
    tx: Parameters<RegularPlanRepository['findActiveReferences']>[0],
    budgetId: string,
    planType: 'INCOME' | 'EXPENSE' | 'SAVINGS',
    accountId: string | null,
    categoryId: string | null,
    envelopeId: string | null,
  ): Promise<void> {
    const references = await this.repository.findActiveReferences(tx, budgetId, {
      accountId,
      categoryId,
      envelopeId,
    });
    if (
      (accountId &&
        (!references.account ||
          references.account.currency !== 'RUB' ||
          references.account.scale !== 2)) ||
      !references.category ||
      references.category.categoryType !== (planType === 'INCOME' ? 'INCOME' : 'EXPENSE') ||
      (planType === 'INCOME' && envelopeId !== null) ||
      (planType !== 'INCOME' &&
        (!references.envelope ||
          references.envelope.currency !== 'RUB' ||
          references.envelope.scale !== 2)) ||
      (planType === 'SAVINGS' && references.envelope?.envelopeType !== 'SAVINGS_GOAL')
    ) {
      throw invalidPlanReference();
    }
  }

  private async requireMutationBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if (role !== 'OWNER' && role !== 'EDITOR') throw forbidden();
    return budget;
  }

  private async requireOwnerBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (budget.workspace.memberships[0]?.role !== 'OWNER') throw forbidden();
    return budget;
  }

  private async requirePlanForMutation(
    tx: Parameters<RegularPlanRepository['findPlanForMutation']>[0],
    userId: string,
    budgetId: string,
    planId: string,
  ): Promise<RegularPlanRecord> {
    const plan = await this.repository.findPlanForMutation(tx, userId, budgetId, planId);
    if (!plan) throw resourceNotFound();
    return plan;
  }

  private async requireOccurrenceForMutation(
    tx: Parameters<RegularPlanRepository['findOccurrenceForMutation']>[0],
    userId: string,
    budgetId: string,
    occurrenceId: string,
  ): Promise<PlanOccurrenceRecord> {
    const occurrence = await this.repository.findOccurrenceForMutation(
      tx,
      userId,
      budgetId,
      occurrenceId,
    );
    if (!occurrence) throw resourceNotFound();
    return occurrence;
  }

  private toPlanView(plan: RegularPlanRecord): RegularPlanView {
    return {
      id: plan.id,
      budgetId: plan.budgetId,
      name: plan.name,
      planType: plan.planType,
      amountMinor: formatMinorUnits(plan.amountMinor),
      currency: 'RUB',
      scale: 2,
      anchorOn: dateValue(plan.anchorOn),
      startOn: dateValue(plan.startOn),
      endOn: plan.endOn ? dateValue(plan.endOn) : null,
      recurrence: plan.recurrence,
      intervalMonths: plan.intervalMonths,
      accountId: plan.accountId,
      categoryId: plan.categoryId,
      envelopeId: plan.envelopeId,
      comment: plan.comment,
      isActive: plan.isActive,
      disabledAt: plan.disabledAt?.toISOString() ?? null,
      deletedAt: plan.deletedAt?.toISOString() ?? null,
    };
  }

  private toOccurrenceView(occurrence: PlanOccurrenceRecord): PlanOccurrenceView {
    return {
      id: occurrence.id,
      planId: occurrence.planId,
      planName: occurrence.planName,
      planType: occurrence.planType,
      scheduledOn: dateValue(occurrence.scheduledOn),
      status: occurrence.status,
      amountMinor: formatMinorUnits(occurrence.amountMinor),
      currency: 'RUB',
      scale: 2,
      accountId: occurrence.accountId,
      categoryId: occurrence.categoryId,
      envelopeId: occurrence.envelopeId,
      comment: occurrence.comment,
      transactionId: occurrence.transactionId,
      cancellationReason: occurrence.cancellationReason,
    };
  }
}

function cancellationReason(
  current: RegularPlanRecord,
  updated: RegularPlanRecord,
): PlanOccurrenceCancellationReason | null {
  if (!updated.isActive) return 'PLAN_DISABLED';
  if (!current.isActive) return null;
  return 'PLAN_CHANGED';
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

function parseAmount(value: string): bigint {
  const amount = parseDecimalToMinorUnits(value, 2, false);
  if (amount <= 0n) throw invalidPlan('amount', 'Сумма должна быть больше нуля.');
  return amount;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function invalidPlan(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail: 'Некорректные данные плана.',
    fieldErrors: [{ field, message, code: 'invalid' }],
  });
}

function invalidPlanReference(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'REFERENCE_INVALID',
    detail: 'Недопустимая ссылка на справочник плана.',
  });
}

function occurrenceStateInvalid(): ConflictException {
  return new ConflictException({
    code: 'OCCURRENCE_STATE_INVALID',
    detail: 'Возникновение плана недоступно в текущем состоянии.',
  });
}

function planTypeNotTransactional(): ConflictException {
  return new ConflictException({
    code: 'PLAN_TYPE_NOT_TRANSACTIONAL',
    detail: 'Для накопления нельзя создать операцию без источника средств.',
  });
}
