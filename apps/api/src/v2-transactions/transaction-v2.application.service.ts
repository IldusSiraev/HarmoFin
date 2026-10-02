import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import {
  forbidden,
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { cycleAndPeriodAt } from '../cycles/cycle-settings-at.js';
import { PrismaService } from '../database/prisma.service.js';
import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { AssignmentBalanceRepository } from '../envelope-plans/assignment-balance.repository.js';
import { AssignmentRepository } from '../envelope-plans/assignment.repository.js';
import {
  ObligationApplicationService,
  type ObligationOccurrenceView,
} from '../obligations/obligation.application.service.js';
import {
  TransactionRepository,
  type TransactionRecord,
} from '../transactions/transaction.repository.js';
import type {
  ListTransactionsV2Input,
  UpdateTransactionV2Input,
} from './transaction-v2.schemas.js';

const RUB_SCALE = 2;
const TRANSACTION_V2_CREATE_OPERATION = 'transactionV2.create';
type Tx = Prisma.TransactionClient;

export type TransactionV2Input = {
  transactionType: 'INCOME' | 'EXPENSE';
  status: 'DRAFT' | 'CONFIRMED';
  amount: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  comment: string | null;
};

export type TransactionJournalV2Item = {
  id: string;
  budgetId: string;
  accountingModelVersion: 1 | 2;
  transactionType: 'INCOME' | 'EXPENSE';
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  amountMinor: string;
  currency: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  sourceDescription: string | null;
  merchantName: string | null;
  comment: string | null;
  planOccurrenceIds: string[];
  confirmedAt: string | null;
  cancelledAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export type TransactionJournalV2Page = {
  items: TransactionJournalV2Item[];
  nextCursor: string | null;
};

export type TransactionV2Warning = { code: string; detail: string };

export type TransactionV2LifecycleView = Omit<TransactionV2View, 'status'> & {
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  occurrences: ObligationOccurrenceView[];
};

export type TransactionV2View = {
  id: string;
  budgetId: string;
  transactionType: 'INCOME' | 'EXPENSE';
  status: 'DRAFT' | 'CONFIRMED';
  amountMinor: string;
  currency: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  comment: string | null;
  accountBalanceMinor: string;
  warnings: TransactionV2Warning[];
};

function validationFailed(detail: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', detail });
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw validationFailed('Дата операции должна быть в формате ГГГГ-ММ-ДД.');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (date.toISOString().slice(0, 10) !== value) {
    throw validationFailed('Дата операции должна быть корректной календарной датой.');
  }
  return date;
}

function mandatoryPaymentRequired(): ConflictException {
  return new ConflictException({
    code: 'MANDATORY_PAYMENT_REQUIRED',
    detail: 'Расход из обязательного конверта проводится только как оплата обязательства.',
  });
}

function insufficientBalance(): ConflictException {
  return new ConflictException({
    code: 'INSUFFICIENT_BALANCE',
    detail: 'На счёте недостаточно средств для расхода.',
  });
}

function ambiguousPeriod(): ConflictException {
  return new ConflictException({
    code: 'PERIOD_AMBIGUOUS',
    detail: 'Для даты операции найдено несколько периодов конверта.',
  });
}

function legacyCorrectionRequired(): ConflictException {
  return new ConflictException({
    code: 'LEGACY_CORRECTION_REQUIRED',
    detail: 'Факт старой модели исправляется только через коррекцию, а не этим запросом.',
  });
}

function sourceExhausted(assignmentIds: string[]): ConflictException {
  return new ConflictException({
    code: 'SOURCE_EXHAUSTED',
    detail:
      'На этот доход назначены средства: сначала уменьшите или отмените перечисленные назначения.',
    assignmentIds,
  });
}

function assignmentUnbacked(): ConflictException {
  return new ConflictException({
    code: 'ASSIGNMENT_UNBACKED',
    detail: 'Изменение нарушает покрытие назначений: непокрытая часть вырастет.',
  });
}

function notEditable(): ConflictException {
  return new ConflictException({
    code: 'TRANSACTION_NOT_EDITABLE',
    detail: 'Удалённую или отменённую операцию изменить нельзя.',
  });
}

function alreadyDeleted(): ConflictException {
  return new ConflictException({
    code: 'TRANSACTION_ALREADY_DELETED',
    detail: 'Операция уже удалена.',
  });
}

function notDeleted(): ConflictException {
  return new ConflictException({
    code: 'TRANSACTION_NOT_DELETED',
    detail: 'Восстановить можно только удалённую операцию.',
  });
}

/**
 * Creates v2 facts: income and ordinary expense (with or without envelope).
 * Mandatory-envelope payments belong to the obligation flow (O04).
 */
@Injectable()
export class TransactionV2ApplicationService {
  private readonly repository: TransactionRepository;
  private readonly assignmentBalances = new AssignmentBalanceRepository();
  private readonly assignmentRows = new AssignmentRepository();
  private readonly financialBalances = new FinancialBalanceRepository();
  private readonly obligations: ObligationApplicationService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {
    this.repository = new TransactionRepository(prisma);
    this.obligations = new ObligationApplicationService(prisma, idempotency, planModelPolicy);
  }

  /**
   * Read-only journal of both accounting models. Any active member may read; DELETED rows are
   * OWNER-only (403 when explicitly requested, never listed by default).
   */
  async list(
    userId: string,
    budgetId: string,
    input: ListTransactionsV2Input,
  ): Promise<TransactionJournalV2Page> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    if (input.status === 'DELETED' && budget.workspace.memberships[0]?.role !== 'OWNER') {
      throw forbidden();
    }
    const referencesExist = await this.repository.validateJournalReferences(budgetId, input);
    if (!referencesExist) throw resourceNotFound();

    const result = await this.repository.list(userId, budgetId, {
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.type ? { transactionType: input.type } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.from ? { from: parseDate(input.from) } : {}),
      ...(input.to ? { to: parseDate(input.to) } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
      sortBy: 'occurredOn',
      sortDirection: 'desc',
    });
    const links = await this.repository.findPlanOccurrenceLinks(
      budgetId,
      result.items.map((row) => row.id),
    );
    return {
      items: result.items.map((row) => toJournalItem(row, links.get(row.id) ?? [])),
      nextCursor: result.nextCursor,
    };
  }

  async get(
    userId: string,
    budgetId: string,
    transactionId: string,
  ): Promise<TransactionJournalV2Item> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const row = await this.repository.find(userId, budgetId, transactionId);
    if (!row) throw resourceNotFound();
    if (row.status === 'DELETED' && budget.workspace.memberships[0]?.role !== 'OWNER') {
      throw forbidden();
    }
    const links = await this.repository.findPlanOccurrenceLinks(budgetId, [row.id]);
    return toJournalItem(row, links.get(row.id) ?? []);
  }

  async create(
    userId: string,
    budgetId: string,
    input: TransactionV2Input,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransactionV2View> {
    parseDate(input.occurredOn);
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          budgetId,
          transactionType: input.transactionType,
          status: input.status,
          amount: input.amount.trim(),
          occurredOn: input.occurredOn,
          accountId: input.accountId,
          categoryId: input.categoryId,
          envelopeId: input.envelopeId,
          comment: input.comment,
        }),
      )
      .digest('hex');

    const result = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);

      return this.idempotency.execute<TransactionV2View>(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: TRANSACTION_V2_CREATE_OPERATION,
          requestHash,
        },
        async () => ({
          status: 201,
          body: await this.createInTransaction(
            tx,
            userId,
            budgetId,
            model.workspaceId,
            input,
            requestId,
          ),
        }),
      );
    });

    return result.body;
  }

  /**
   * Creates one v2 fact inside the caller's transaction. The caller must already hold the budget
   * lock (and, if needed, the idempotency scope); this performs role, reference and balance checks.
   */
  async createInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    workspaceId: string,
    input: TransactionV2Input,
    requestId?: string,
  ): Promise<TransactionV2View> {
    const occurredOn = parseDate(input.occurredOn);
    const role = await this.repository.findActiveMemberRole(tx, workspaceId, userId);
    if (role !== 'OWNER' && role !== 'EDITOR') {
      throw forbidden();
    }

    const amount = parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    if (amount <= 0n) {
      throw validationFailed('Сумма операции должна быть больше нуля.');
    }
    if (input.transactionType === 'INCOME' && input.envelopeId !== null) {
      throw invalidReference();
    }

    const budget = await this.repository.findBudgetSettings(tx, budgetId);
    if (!budget) {
      throw resourceNotFound();
    }

    const refs = await this.repository.findActiveV2References(
      tx,
      budgetId,
      input.accountId,
      input.categoryId,
      input.envelopeId,
    );
    if (!refs.account || !refs.category || (input.envelopeId !== null && !refs.envelope)) {
      throw resourceNotFound();
    }
    if (
      refs.account.currency !== 'RUB' ||
      refs.account.scale !== RUB_SCALE ||
      refs.category.categoryType !== input.transactionType ||
      (refs.envelope && (refs.envelope.currency !== 'RUB' || refs.envelope.scale !== RUB_SCALE))
    ) {
      throw invalidReference();
    }

    const confirmed = input.status === 'CONFIRMED';
    const today = todayInTimezone(new Date(), budget.timezone);
    if (confirmed && input.occurredOn > today) {
      throw validationFailed('Нельзя подтвердить факт с будущей датой.');
    }
    if (
      confirmed &&
      input.transactionType === 'EXPENSE' &&
      refs.envelope?.envelopeType === 'MANDATORY_EXPENSES'
    ) {
      throw mandatoryPaymentRequired();
    }

    await this.repository.lockAccount(tx, budgetId, refs.account.id);

    if (confirmed && input.transactionType === 'EXPENSE' && !budget.allowNegativeBalance) {
      const cash = await this.repository.accountCashBalance(tx, budgetId, refs.account.id);
      if (cash < amount) {
        throw insufficientBalance();
      }
    }

    // Period envelope: spending is scoped to the concrete period covering occurredOn.
    const periodId =
      confirmed && input.transactionType === 'EXPENSE'
        ? await this.ensurePeriod(
            tx,
            budget,
            budgetId,
            workspaceId,
            refs.envelope,
            input.occurredOn,
            userId,
            requestId,
          )
        : null;

    const transaction = await this.repository.create(
      tx,
      {
        budgetId,
        transactionType: input.transactionType,
        status: input.status,
        amountMinor: amount,
        occurredOn,
        accountId: refs.account.id,
        categoryId: refs.category.id,
        envelopeId: refs.envelope?.id ?? null,
        sourceDescription: null,
        merchantName: null,
        isPlanned: false,
        comment: input.comment,
        confirmedAt: confirmed ? new Date() : null,
        createdByUserId: userId,
        updatedByUserId: userId,
        accountingModelVersion: 2,
      },
      userId,
      requestId,
    );

    const warnings: TransactionV2Warning[] = [];
    if (confirmed && input.transactionType === 'EXPENSE' && refs.envelope) {
      const assignment = await this.assignmentBalances.balance(
        tx,
        budgetId,
        refs.envelope.id,
        periodId,
        new Date(),
      );
      if (assignment.balance < 0n) {
        warnings.push({
          code: 'ENVELOPE_BALANCE_INSUFFICIENT',
          detail: 'Назначение конверта меньше расхода; операция проведена.',
        });
      }
    }

    return {
      id: transaction.id,
      budgetId,
      transactionType: transaction.transactionType,
      status: input.status,
      amountMinor: formatMinorUnits(transaction.amountMinor),
      currency: transaction.currency,
      occurredOn: input.occurredOn,
      accountId: transaction.accountId,
      categoryId: transaction.categoryId,
      envelopeId: transaction.envelopeId,
      comment: transaction.comment,
      accountBalanceMinor: formatMinorUnits(transaction.accountCurrentBalanceMinor),
      warnings,
    };
  }

  /** PATCH: validation as in create; mandatory-envelope payments keep their envelope. */
  async update(
    userId: string,
    budgetId: string,
    transactionId: string,
    input: UpdateTransactionV2Input,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransactionV2LifecycleView> {
    if (input.occurredOn !== undefined) parseDate(input.occurredOn);
    if (
      input.amount !== undefined &&
      parseDecimalToMinorUnits(input.amount, RUB_SCALE, false) <= 0n
    ) {
      throw validationFailed('Сумма операции должна быть больше нуля.');
    }
    return this.runLifecycle(
      'update',
      userId,
      budgetId,
      transactionId,
      { ...input, amount: input.amount?.trim() },
      idempotencyKey,
      (tx, current, ctx) =>
        this.updateInTransaction(tx, userId, budgetId, current, input, ctx, requestId),
    );
  }

  /** DELETE: logical delete; returns the amount to cash and the assignment balance. */
  async remove(
    userId: string,
    budgetId: string,
    transactionId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransactionV2LifecycleView> {
    return this.runLifecycle(
      'delete',
      userId,
      budgetId,
      transactionId,
      {},
      idempotencyKey,
      async (tx, current, ctx) => {
        if (current.status === 'DELETED') throw alreadyDeleted();
        if (current.transactionType === 'INCOME') {
          return this.removeIncomeInTransaction(tx, userId, budgetId, current, ctx, requestId);
        }
        const occurrences = await this.obligations.lockLinkedOccurrences(tx, budgetId, current.id);
        await this.repository.lockAccount(tx, budgetId, current.accountId);
        const deleted = await this.repository.updateLifecycle(
          tx,
          current,
          'DELETED',
          userId,
          requestId,
        );
        const views = await this.obligations.reconcileAfterPaymentChange(tx, {
          userId,
          budgetId,
          workspaceId: ctx.workspaceId,
          occurrences,
          action: 'delete',
          today: ctx.today,
          requestId,
        });
        return toLifecycleView(deleted, views, []);
      },
    );
  }

  /** Restore: re-checks references, date, period and account capacity; never creates a PlanPayment. */
  async restore(
    userId: string,
    budgetId: string,
    transactionId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransactionV2LifecycleView> {
    return this.runLifecycle(
      'restore',
      userId,
      budgetId,
      transactionId,
      {},
      idempotencyKey,
      async (tx, current, ctx) => {
        if (current.status !== 'DELETED') throw notDeleted();
        if (current.transactionType === 'INCOME') {
          return this.restoreIncomeInTransaction(tx, userId, budgetId, current, ctx, requestId);
        }
        const target =
          current.preDeleteStatus === 'CONFIRMED'
            ? 'CONFIRMED'
            : current.preDeleteStatus === 'CANCELLED'
              ? 'CANCELLED'
              : 'DRAFT';
        const occurrences = await this.obligations.lockLinkedOccurrences(tx, budgetId, current.id);
        if (target === 'CONFIRMED') {
          this.obligations.assertPaymentRestorable(occurrences);
          const refs = await this.repository.findActiveV2References(
            tx,
            budgetId,
            current.accountId,
            current.categoryId,
            current.envelopeId,
          );
          this.assertReferences(refs, current.transactionType, current.envelopeId);
          const occurredOn = isoDate(current.occurredOn);
          if (occurredOn > ctx.today) {
            throw validationFailed('Нельзя подтвердить факт с будущей датой.');
          }
          await this.repository.lockAccount(tx, budgetId, current.accountId);
          if (!ctx.allowNegativeBalance) {
            const cash = await this.repository.accountCashBalance(tx, budgetId, current.accountId);
            if (cash < current.amountMinor) throw insufficientBalance();
          }
          await this.ensurePeriod(
            tx,
            ctx.budget,
            budgetId,
            ctx.workspaceId,
            refs.envelope,
            occurredOn,
            userId,
            requestId,
          );
        } else {
          await this.repository.lockAccount(tx, budgetId, current.accountId);
        }
        const restored = await this.repository.restoreLifecycle(
          tx,
          current,
          target,
          userId,
          requestId,
        );
        const views = await this.obligations.reconcileAfterPaymentChange(tx, {
          userId,
          budgetId,
          workspaceId: ctx.workspaceId,
          occurrences,
          action: 'restore',
          today: ctx.today,
          requestId,
        });
        return toLifecycleView(restored, views, await this.warningsFor(tx, restored));
      },
    );
  }

  private async updateInTransaction(
    tx: Tx,
    userId: string,
    budgetId: string,
    current: TransactionRecord,
    input: UpdateTransactionV2Input,
    ctx: LifecycleContext,
    requestId?: string,
  ): Promise<TransactionV2LifecycleView> {
    if (current.status !== 'CONFIRMED' && current.status !== 'DRAFT') throw notEditable();
    if (current.transactionType === 'INCOME') {
      return this.updateIncomeInTransaction(tx, userId, budgetId, current, input, ctx, requestId);
    }
    const amountMinor =
      input.amount === undefined
        ? current.amountMinor
        : parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    const accountId = input.accountId ?? current.accountId;
    const categoryId = input.categoryId ?? current.categoryId;
    const envelopeId = input.envelopeId === undefined ? current.envelopeId : input.envelopeId;
    const occurredOn = input.occurredOn ?? isoDate(current.occurredOn);
    const confirmed = current.status === 'CONFIRMED';

    const occurrences = await this.obligations.lockLinkedOccurrences(tx, budgetId, current.id);
    const currentEnvelope = current.envelopeId
      ? await tx.envelope.findFirst({
          where: { id: current.envelopeId, budgetId },
          select: { envelopeType: true },
        })
      : null;
    const refs = await this.repository.findActiveV2References(
      tx,
      budgetId,
      accountId,
      categoryId,
      envelopeId,
    );
    this.assertReferences(refs, 'EXPENSE', envelopeId);

    const wasMandatory =
      occurrences.length > 0 || currentEnvelope?.envelopeType === 'MANDATORY_EXPENSES';
    const violatesMandatory = wasMandatory
      ? envelopeId !== current.envelopeId
      : refs.envelope?.envelopeType === 'MANDATORY_EXPENSES';
    if (violatesMandatory) throw mandatoryPaymentRequired();
    if (confirmed && occurredOn > ctx.today) {
      throw validationFailed('Нельзя подтвердить факт с будущей датой.');
    }

    // Lock order: occurrences (above), then accounts by id.
    for (const id of [...new Set([current.accountId, accountId])].sort()) {
      await this.repository.lockAccount(tx, budgetId, id);
    }
    if (confirmed && !ctx.allowNegativeBalance) {
      const sameAccount = accountId === current.accountId;
      if (!(sameAccount && amountMinor <= current.amountMinor)) {
        const cash = await this.repository.accountCashBalance(tx, budgetId, accountId);
        if (cash + (sameAccount ? current.amountMinor : 0n) < amountMinor) {
          throw insufficientBalance();
        }
      }
    }
    if (confirmed) {
      await this.ensurePeriod(
        tx,
        ctx.budget,
        budgetId,
        ctx.workspaceId,
        refs.envelope,
        occurredOn,
        userId,
        requestId,
      );
    }

    const updated = await this.repository.update(
      tx,
      current,
      {
        ...(input.amount !== undefined ? { amountMinor } : {}),
        ...(input.occurredOn !== undefined ? { occurredOn: parseDate(occurredOn) } : {}),
        ...(input.accountId !== undefined ? { accountId } : {}),
        ...(input.categoryId !== undefined ? { categoryId } : {}),
        ...(input.envelopeId !== undefined ? { envelopeId } : {}),
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
        updatedByUserId: userId,
      },
      userId,
      requestId,
    );
    const views = await this.obligations.reconcileAfterPaymentChange(tx, {
      userId,
      budgetId,
      workspaceId: ctx.workspaceId,
      occurrences,
      action: 'edit',
      today: ctx.today,
      requestId,
    });
    return toLifecycleView(updated, views, confirmed ? await this.warningsFor(tx, updated) : []);
  }

  /**
   * Income PATCH. Lock order is already budget -> idempotency -> income row; accounts follow.
   * Existing assignments are never touched: the source sum may not exceed the new amount.
   */
  private async updateIncomeInTransaction(
    tx: Tx,
    userId: string,
    budgetId: string,
    current: TransactionRecord,
    input: UpdateTransactionV2Input,
    ctx: LifecycleContext,
    requestId?: string,
  ): Promise<TransactionV2LifecycleView> {
    if (input.envelopeId !== undefined && input.envelopeId !== null) throw invalidReference();
    const amountMinor =
      input.amount === undefined
        ? current.amountMinor
        : parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    const accountId = input.accountId ?? current.accountId;
    const categoryId = input.categoryId ?? current.categoryId;
    const occurredOn = input.occurredOn ?? isoDate(current.occurredOn);
    const confirmed = current.status === 'CONFIRMED';

    const refs = await this.repository.findActiveV2References(
      tx,
      budgetId,
      accountId,
      categoryId,
      null,
    );
    this.assertReferences(refs, 'INCOME', null);
    if (confirmed && occurredOn > ctx.today) {
      throw validationFailed('Нельзя подтвердить факт с будущей датой.');
    }

    for (const id of [...new Set([current.accountId, accountId])].sort()) {
      await this.repository.lockAccount(tx, budgetId, id);
    }
    const persist = () =>
      this.repository.update(
        tx,
        current,
        {
          ...(input.amount !== undefined ? { amountMinor } : {}),
          ...(input.occurredOn !== undefined ? { occurredOn: parseDate(occurredOn) } : {}),
          ...(input.accountId !== undefined ? { accountId } : {}),
          ...(input.categoryId !== undefined ? { categoryId } : {}),
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
          updatedByUserId: userId,
        },
        userId,
        requestId,
      );
    if (!confirmed) return toLifecycleView(await persist(), [], []);

    await this.assertIncomeSourcesCover(tx, budgetId, current.id, amountMinor);
    if (!ctx.allowNegativeBalance) {
      if (accountId === current.accountId) {
        if (amountMinor < current.amountMinor) {
          const cash = await this.repository.accountCashBalance(tx, budgetId, accountId);
          if (cash - (current.amountMinor - amountMinor) < 0n) throw insufficientBalance();
        }
      } else {
        const cash = await this.repository.accountCashBalance(tx, budgetId, current.accountId);
        if (cash - current.amountMinor < 0n) throw insufficientBalance();
      }
    }
    const updated = await this.withUnbackedGuard(tx, budgetId, persist);
    return toLifecycleView(updated, [], []);
  }

  private async removeIncomeInTransaction(
    tx: Tx,
    userId: string,
    budgetId: string,
    current: TransactionRecord,
    ctx: LifecycleContext,
    requestId?: string,
  ): Promise<TransactionV2LifecycleView> {
    await this.repository.lockAccount(tx, budgetId, current.accountId);
    const persist = () =>
      this.repository.updateLifecycle(tx, current, 'DELETED', userId, requestId);
    if (current.status !== 'CONFIRMED') return toLifecycleView(await persist(), [], []);

    await this.assertIncomeSourcesCover(tx, budgetId, current.id, 0n);
    if (!ctx.allowNegativeBalance) {
      const cash = await this.repository.accountCashBalance(tx, budgetId, current.accountId);
      if (cash - current.amountMinor < 0n) throw insufficientBalance();
    }
    return toLifecycleView(await this.withUnbackedGuard(tx, budgetId, persist), [], []);
  }

  /** Restore re-checks references and date; assignments are never restored. */
  private async restoreIncomeInTransaction(
    tx: Tx,
    userId: string,
    budgetId: string,
    current: TransactionRecord,
    ctx: LifecycleContext,
    requestId?: string,
  ): Promise<TransactionV2LifecycleView> {
    const target =
      current.preDeleteStatus === 'CONFIRMED'
        ? 'CONFIRMED'
        : current.preDeleteStatus === 'CANCELLED'
          ? 'CANCELLED'
          : 'DRAFT';
    if (target === 'CONFIRMED') {
      const refs = await this.repository.findActiveV2References(
        tx,
        budgetId,
        current.accountId,
        current.categoryId,
        null,
      );
      this.assertReferences(refs, 'INCOME', null);
      if (isoDate(current.occurredOn) > ctx.today) {
        throw validationFailed('Нельзя подтвердить факт с будущей датой.');
      }
    }
    await this.repository.lockAccount(tx, budgetId, current.accountId);
    const restored = await this.repository.restoreLifecycle(tx, current, target, userId, requestId);
    return toLifecycleView(restored, [], []);
  }

  /** Rejects with SOURCE_EXHAUSTED while confirmed INCOME assignments exceed the income amount. */
  private async assertIncomeSourcesCover(
    tx: Tx,
    budgetId: string,
    incomeId: string,
    newAmountMinor: bigint,
  ): Promise<void> {
    const dependents = await this.assignmentRows.listConfirmedIncomeAssignments(
      tx,
      budgetId,
      incomeId,
    );
    const total = dependents.reduce((sum, row) => sum + row.amountMinor, 0n);
    if (total > newAmountMinor) throw sourceExhausted(dependents.map((row) => row.id));
  }

  /** Cash may fall only while the unbacked part of positive assignment balances does not grow. */
  private async withUnbackedGuard<T>(
    tx: Tx,
    budgetId: string,
    mutate: () => Promise<T>,
  ): Promise<T> {
    const now = new Date();
    let supported = 0n;
    for (const row of await this.assignmentBalances.allBalances(tx, budgetId, now)) {
      supported += row.balance > 0n ? row.balance : 0n;
    }
    const cashBefore = await this.financialBalances.totalCashAsOf(tx, budgetId, now);
    const result = await mutate();
    const cashAfter = await this.financialBalances.totalCashAsOf(tx, budgetId, now);
    const before = supported - cashBefore > 0n ? supported - cashBefore : 0n;
    const after = supported - cashAfter > 0n ? supported - cashAfter : 0n;
    if (after > before) throw assignmentUnbacked();
    return result;
  }

  /** Budget lock -> idempotency -> role -> transaction row -> (occurrences, accounts in the body). */
  private async runLifecycle(
    kind: 'update' | 'delete' | 'restore',
    userId: string,
    budgetId: string,
    transactionId: string,
    hashInput: Record<string, unknown>,
    idempotencyKey: string,
    body: (
      tx: Tx,
      current: TransactionRecord,
      ctx: LifecycleContext,
    ) => Promise<TransactionV2LifecycleView>,
  ): Promise<TransactionV2LifecycleView> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ budgetId, transactionId, kind, ...hashInput }))
      .digest('hex');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);
      return this.idempotency.execute<TransactionV2LifecycleView>(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: `transactionV2.${kind}`,
          requestHash,
        },
        async () => {
          const role = await this.repository.findActiveMemberRole(tx, model.workspaceId, userId);
          if (role !== 'OWNER' && role !== 'EDITOR') throw forbidden();
          const budget = await this.repository.findBudgetSettings(tx, budgetId);
          if (!budget) throw resourceNotFound();
          const current = await this.repository.findForMutation(
            tx,
            userId,
            budgetId,
            transactionId,
          );
          if (!current) throw resourceNotFound();
          if (current.accountingModelVersion !== 2) throw legacyCorrectionRequired();
          return {
            status: 200,
            body: await body(tx, current, {
              budget,
              workspaceId: model.workspaceId,
              allowNegativeBalance: budget.allowNegativeBalance,
              today: todayInTimezone(new Date(), budget.timezone),
            }),
          };
        },
      );
    });
    return result.body;
  }

  private assertReferences(
    refs: Awaited<ReturnType<TransactionRepository['findActiveV2References']>>,
    transactionType: 'INCOME' | 'EXPENSE',
    envelopeId: string | null,
  ): void {
    if (!refs.account || !refs.category || (envelopeId !== null && !refs.envelope)) {
      throw resourceNotFound();
    }
    if (
      refs.account.currency !== 'RUB' ||
      refs.account.scale !== RUB_SCALE ||
      refs.category.categoryType !== transactionType ||
      (refs.envelope && (refs.envelope.currency !== 'RUB' || refs.envelope.scale !== RUB_SCALE))
    ) {
      throw invalidReference();
    }
  }

  /** Period envelope: spending is scoped to the concrete period covering occurredOn. */
  private async ensurePeriod(
    tx: Tx,
    budget: LifecycleContext['budget'],
    budgetId: string,
    workspaceId: string,
    envelope: { id: string; periodSlot: unknown } | null,
    occurredOn: string,
    userId: string,
    requestId: string | undefined,
  ): Promise<string | null> {
    if (!envelope?.periodSlot) return null;
    const periods = await this.repository.findPeriodsCovering(
      tx,
      budgetId,
      envelope.id,
      parseDate(occurredOn),
    );
    if (periods.length > 1) throw ambiguousPeriod();
    if (periods[0]) return periods[0].id;
    const range = (await cycleAndPeriodAt(tx, budgetId, occurredOn, budget)).period;
    const created = await this.repository.createUnsetPeriod(tx, {
      budgetId,
      workspaceId,
      envelopeId: envelope.id,
      startsOn: parseDate(range.start),
      endsOn: parseDate(range.end),
      userId,
      requestId,
    });
    return created.id;
  }

  private async warningsFor(tx: Tx, row: TransactionRecord): Promise<TransactionV2Warning[]> {
    if (row.status !== 'CONFIRMED' || !row.envelopeId) return [];
    const assignment = await this.assignmentBalances.balance(
      tx,
      row.budgetId,
      row.envelopeId,
      null,
      new Date(),
    );
    return assignment.balance < 0n
      ? [
          {
            code: 'ENVELOPE_BALANCE_INSUFFICIENT',
            detail: 'Назначение конверта меньше расхода; операция проведена.',
          },
        ]
      : [];
  }
}

type LifecycleContext = {
  budget: NonNullable<Awaited<ReturnType<TransactionRepository['findBudgetSettings']>>>;
  workspaceId: string;
  allowNegativeBalance: boolean;
  today: string;
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toLifecycleView(
  row: TransactionRecord,
  occurrences: ObligationOccurrenceView[],
  warnings: TransactionV2Warning[],
): TransactionV2LifecycleView {
  return {
    id: row.id,
    budgetId: row.budgetId,
    transactionType: row.transactionType,
    status: row.status,
    amountMinor: formatMinorUnits(row.amountMinor),
    currency: row.currency,
    occurredOn: isoDate(row.occurredOn),
    accountId: row.accountId,
    categoryId: row.categoryId,
    envelopeId: row.envelopeId,
    comment: row.comment,
    accountBalanceMinor: formatMinorUnits(row.accountCurrentBalanceMinor),
    warnings,
    occurrences,
  };
}

function toJournalItem(
  row: TransactionRecord,
  planOccurrenceIds: string[],
): TransactionJournalV2Item {
  return {
    id: row.id,
    budgetId: row.budgetId,
    accountingModelVersion: row.accountingModelVersion === 2 ? 2 : 1,
    transactionType: row.transactionType,
    status: row.status,
    amountMinor: formatMinorUnits(row.amountMinor),
    currency: row.currency,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    accountId: row.accountId,
    categoryId: row.categoryId,
    envelopeId: row.envelopeId,
    sourceDescription: row.sourceDescription,
    merchantName: row.merchantName,
    comment: row.comment,
    planOccurrenceIds,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
