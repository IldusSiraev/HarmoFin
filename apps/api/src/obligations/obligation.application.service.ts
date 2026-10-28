import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy, type AccessActor } from '../common/policies/budget-access.policy.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import {
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentBalanceRepository } from '../envelope-plans/assignment-balance.repository.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import { ObligationRepository, type OccurrenceRecord } from './obligation.repository.js';

const RUB_SCALE = 2;

export type ObligationPayInput = {
  accountId: string;
  categoryId: string;
  amount: string;
  occurredOn: string;
  willPayMore: boolean;
};

export type ObligationWarning = { code: string; detail: string };

export type ObligationOccurrenceView = {
  id: string;
  status: string;
  expectedMinor: string;
  paidMinor: string;
  unpaidMinor: string;
};

export type ObligationTransactionView = {
  id: string;
  amountMinor: string;
  occurredOn: string;
  accountId: string;
  categoryId: string;
  envelopeId: string;
  accountBalanceMinor: string;
};

export type ObligationResult = {
  occurrence: ObligationOccurrenceView;
  transaction: ObligationTransactionView | null;
  warnings: ObligationWarning[];
};

/** unpaid = max(0, expected - paid) for open occurrences; 0 once closed or skipped. */
export function computeUnpaidMinor(
  status: string,
  expectedMinor: bigint,
  paidMinor: bigint,
): bigint {
  if (status !== 'PENDING' && status !== 'DUE') {
    return 0n;
  }
  const diff = expectedMinor - paidMinor;
  return diff > 0n ? diff : 0n;
}

function validationFailed(detail: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', detail });
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw validationFailed('Дата оплаты должна быть в формате ГГГГ-ММ-ДД.');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (date.toISOString().slice(0, 10) !== value) {
    throw validationFailed('Дата оплаты должна быть корректной календарной датой.');
  }
  return date;
}

function notOpen(): ConflictException {
  return new ConflictException({
    code: 'OCCURRENCE_NOT_OPEN',
    detail: 'Платёж уже закрыт, пропущен или отменён.',
  });
}

function notPayable(): ConflictException {
  return new ConflictException({
    code: 'OCCURRENCE_NOT_PAYABLE',
    detail:
      'Платёж нельзя оплатить: нужен активный план расхода из конверта обязательных платежей.',
  });
}

function hasPayments(): ConflictException {
  return new ConflictException({
    code: 'OCCURRENCE_HAS_PAYMENTS',
    detail: 'У платежа есть подтверждённые оплаты; его нельзя пропустить.',
  });
}

function noPayments(): ConflictException {
  return new ConflictException({
    code: 'OCCURRENCE_HAS_NO_PAYMENTS',
    detail: 'Закрыть можно только платёж хотя бы с одной подтверждённой оплатой.',
  });
}

function insufficientBalance(): ConflictException {
  return new ConflictException({
    code: 'INSUFFICIENT_BALANCE',
    detail: 'На счёте недостаточно средств для расхода.',
  });
}

/**
 * v2 obligation flow: several confirmed payments per plan occurrence.
 * Lock order: budget row -> idempotency advisory lock -> occurrence -> account.
 */
@Injectable()
export class ObligationApplicationService {
  private readonly transactions: TransactionRepository;
  private readonly obligations = new ObligationRepository();
  private readonly assignmentBalances = new AssignmentBalanceRepository();
  private readonly access = new BudgetAccessPolicy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {
    this.transactions = new TransactionRepository(prisma);
  }

  async pay(
    userId: string,
    budgetId: string,
    occurrenceId: string,
    input: ObligationPayInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<ObligationResult> {
    const occurredOn = parseDate(input.occurredOn);
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = this.hash({
      budgetId,
      occurrenceId,
      accountId: input.accountId,
      categoryId: input.categoryId,
      amount: input.amount.trim(),
      occurredOn: input.occurredOn,
      willPayMore: input.willPayMore,
    });

    return this.run(
      budgetId,
      userId,
      idempotencyKey,
      'obligation.pay',
      requestHash,
      model.workspaceId,
      (tx, access) =>
        this.payInTransaction(
          tx,
          access,
          userId,
          budgetId,
          model.workspaceId,
          occurrenceId,
          input,
          occurredOn,
          requestId,
        ),
      (access) => this.access.requireWriter(access),
    );
  }

  /**
   * Pay body without lock/idempotency/role handling: the caller owns the transaction, the budget
   * lock and the idempotency scope (used by pay and by the atomic one-time obligation action).
   */
  async payInTransaction(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    access: AccessActor,
    userId: string,
    budgetId: string,
    workspaceId: string,
    occurrenceId: string,
    input: ObligationPayInput,
    occurredOn: Date,
    requestId?: string,
  ): Promise<ObligationResult> {
    const amount = parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    if (amount <= 0n) {
      throw validationFailed('Сумма оплаты должна быть больше нуля.');
    }
    const budget = await this.transactions.findBudgetSettings(tx, budgetId);
    if (!budget) {
      throw resourceNotFound();
    }
    const occurrence = await this.requireOccurrence(tx, budgetId, occurrenceId);
    const [envelopeLoaded, account, category] = await Promise.all([
      occurrence.envelopeId === null
        ? Promise.resolve(null)
        : this.obligations.findEnvelope(tx, budgetId, occurrence.envelopeId),
      this.obligations.findAccount(tx, budgetId, input.accountId),
      this.obligations.findExpenseCategory(tx, budgetId, input.categoryId),
    ]);
    if (!account || !category) {
      throw resourceNotFound();
    }
    this.access.requireObjectOwner(access, { ownerUserId: occurrence.plan.ownerUserId });
    this.access.requireAccountOwner(access, { ownerUserId: account.ownerUserId });
    this.assertOpen(occurrence);
    if (
      occurrence.planType !== 'EXPENSE' ||
      !occurrence.plan.isActive ||
      occurrence.plan.deletedAt !== null ||
      occurrence.envelopeId === null
    ) {
      throw notPayable();
    }
    const envelope = envelopeLoaded;
    if (!envelope || envelope.envelopeType !== 'MANDATORY_EXPENSES') {
      throw notPayable();
    }
    if (
      account.currency !== 'RUB' ||
      account.scale !== RUB_SCALE ||
      envelope.currency !== 'RUB' ||
      envelope.scale !== RUB_SCALE ||
      category.categoryType !== 'EXPENSE'
    ) {
      throw invalidReference();
    }

    const today = todayInTimezone(new Date(), budget.timezone);
    if (input.occurredOn > today) {
      throw validationFailed('Нельзя подтвердить оплату с будущей датой.');
    }

    await this.transactions.lockAccount(tx, budgetId, account.id);
    if (!budget.allowNegativeBalance) {
      const cash = await this.transactions.accountCashBalance(tx, budgetId, account.id);
      if (cash < amount) {
        throw insufficientBalance();
      }
    }

    // Mandatory-envelope expense is legitimately created here (bypasses generic v2 POST guard).
    const transaction = await this.transactions.create(
      tx,
      {
        budgetId,
        transactionType: 'EXPENSE',
        status: 'CONFIRMED',
        amountMinor: amount,
        occurredOn,
        accountId: account.id,
        categoryId: category.id,
        envelopeId: envelope.id,
        sourceDescription: null,
        merchantName: null,
        isPlanned: true,
        comment: null,
        confirmedAt: new Date(),
        createdByUserId: userId,
        updatedByUserId: userId,
        accountingModelVersion: 2,
      },
      userId,
      requestId,
    );
    await this.obligations.createPayment(tx, {
      budgetId,
      workspaceId,
      occurrenceId: occurrence.id,
      transactionId: transaction.id,
      actorUserId: userId,
      requestId,
    });

    const paid = await this.obligations.confirmedPaidMinor(tx, budgetId, occurrence.id);
    const completes = !input.willPayMore || paid.total >= occurrence.amountMinor;
    let status: string = occurrence.status;
    if (completes) {
      await this.obligations.transitionOccurrence(tx, {
        budgetId,
        workspaceId,
        occurrence,
        to: 'COMPLETED',
        actorUserId: userId,
        requestId,
      });
      status = 'COMPLETED';
    }

    const warnings: ObligationWarning[] = [];
    const assignment = await this.assignmentBalances.balance(
      tx,
      budgetId,
      envelope.id,
      null,
      new Date(),
    );
    if (assignment.balance < 0n) {
      warnings.push({
        code: 'ENVELOPE_BALANCE_INSUFFICIENT',
        detail: 'В конверте отложено меньше, чем расход; оплата проведена.',
      });
    }

    return {
      occurrence: this.view(occurrence, status, paid.total),
      transaction: {
        id: transaction.id,
        amountMinor: formatMinorUnits(transaction.amountMinor),
        occurredOn: input.occurredOn,
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        envelopeId: envelope.id,
        accountBalanceMinor: formatMinorUnits(transaction.accountCurrentBalanceMinor),
      },
      warnings,
    };
  }

  /**
   * Locks (after the budget lock, before accounts) the occurrences already linked to a transaction
   * by PlanPayment. Used by the v2 expense lifecycle; never creates a payment.
   */
  async lockLinkedOccurrences(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    budgetId: string,
    transactionId: string,
  ): Promise<OccurrenceRecord[]> {
    const ids = await this.obligations.findLinkedOccurrenceIds(tx, budgetId, transactionId);
    const occurrences: OccurrenceRecord[] = [];
    for (const id of ids) {
      occurrences.push(await this.requireOccurrence(tx, budgetId, id));
    }
    return occurrences;
  }

  /** A deleted payment can come back only while its occurrence is still open or completed. */
  assertPaymentRestorable(occurrences: OccurrenceRecord[]): void {
    if (occurrences.some((o) => o.status === 'SKIPPED' || o.status === 'CANCELLED')) {
      throw notOpen();
    }
  }

  /**
   * Re-derives occurrence status from the currently valid CONFIRMED payments, after the linked
   * expense was deleted, restored or edited. Rules:
   * - delete: COMPLETED with zero confirmed payments left is reopened (DUE if the date has come,
   *   otherwise PENDING). With payments remaining the status is kept (the owner closed it).
   * - restore: an open occurrence whose confirmed total reaches the expected amount is completed
   *   again; otherwise it stays open (the owner can close it explicitly).
   * - edit: status is kept; the facts remain.
   */
  async reconcileAfterPaymentChange(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    params: {
      userId: string;
      budgetId: string;
      workspaceId: string;
      occurrences: OccurrenceRecord[];
      action: 'delete' | 'restore' | 'edit';
      today: string;
      requestId?: string | undefined;
    },
  ): Promise<ObligationOccurrenceView[]> {
    const views: ObligationOccurrenceView[] = [];
    for (const occurrence of params.occurrences) {
      const paid = await this.obligations.confirmedPaidMinor(tx, params.budgetId, occurrence.id);
      let status: string = occurrence.status;
      const common = {
        budgetId: params.budgetId,
        workspaceId: params.workspaceId,
        occurrence,
        actorUserId: params.userId,
        requestId: params.requestId,
      };
      if (params.action === 'delete' && occurrence.status === 'COMPLETED' && paid.count === 0) {
        const to =
          occurrence.scheduledOn.toISOString().slice(0, 10) <= params.today ? 'DUE' : 'PENDING';
        await this.obligations.reopenOccurrence(tx, { ...common, to });
        status = to;
      } else if (
        params.action === 'restore' &&
        (occurrence.status === 'PENDING' || occurrence.status === 'DUE') &&
        paid.total >= occurrence.amountMinor
      ) {
        await this.obligations.transitionOccurrence(tx, { ...common, to: 'COMPLETED' });
        status = 'COMPLETED';
      }
      views.push(this.view(occurrence, status, paid.total));
    }
    return views;
  }

  async skip(
    userId: string,
    budgetId: string,
    occurrenceId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<ObligationResult> {
    return this.finish('skip', userId, budgetId, occurrenceId, idempotencyKey, requestId);
  }

  async close(
    userId: string,
    budgetId: string,
    occurrenceId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<ObligationResult> {
    return this.finish('close', userId, budgetId, occurrenceId, idempotencyKey, requestId);
  }

  private async finish(
    action: 'skip' | 'close',
    userId: string,
    budgetId: string,
    occurrenceId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<ObligationResult> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.run(
      budgetId,
      userId,
      idempotencyKey,
      `obligation.${action}`,
      this.hash({ budgetId, occurrenceId, action }),
      model.workspaceId,
      async (tx, access) => {
        const occurrence = await this.requireOccurrence(tx, budgetId, occurrenceId);
        this.access.requireObjectOwner(access, { ownerUserId: occurrence.plan.ownerUserId });
        this.assertOpen(occurrence);
        const paid = await this.obligations.confirmedPaidMinor(tx, budgetId, occurrence.id);
        if (action === 'skip' && paid.count > 0) {
          throw hasPayments();
        }
        if (action === 'close' && paid.count === 0) {
          throw noPayments();
        }
        const to = action === 'skip' ? 'SKIPPED' : 'COMPLETED';
        await this.obligations.transitionOccurrence(tx, {
          budgetId,
          workspaceId: model.workspaceId,
          occurrence,
          to,
          actorUserId: userId,
          requestId,
        });
        return {
          occurrence: this.view(occurrence, to, paid.total),
          transaction: null,
          warnings: [],
        };
      },
      (access) => this.access.requireWriter(access),
    );
  }

  private async run(
    budgetId: string,
    userId: string,
    key: string,
    operation: string,
    requestHash: string,
    workspaceId: string,
    body: (
      tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
      access: AccessActor,
    ) => Promise<ObligationResult>,
    authorize: (access: AccessActor) => void,
  ): Promise<ObligationResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.transactions.lockBudget(tx, budgetId);
      return this.idempotency.execute<ObligationResult>(
        tx,
        { budgetId, actorUserId: userId, key, operation, requestHash },
        async () => {
          const access = await requireAccessActor(tx, workspaceId, userId);
          authorize(access);
          return { status: 200, body: await body(tx, access) };
        },
      );
    });
    return result.body;
  }

  private async requireOccurrence(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    budgetId: string,
    occurrenceId: string,
  ): Promise<OccurrenceRecord> {
    await this.obligations.lockOccurrence(tx, budgetId, occurrenceId);
    const occurrence = await this.obligations.findOccurrence(tx, budgetId, occurrenceId);
    if (!occurrence) {
      throw resourceNotFound();
    }
    return occurrence;
  }

  private assertOpen(occurrence: OccurrenceRecord): void {
    if (occurrence.status !== 'PENDING' && occurrence.status !== 'DUE') {
      throw notOpen();
    }
  }

  private view(
    occurrence: OccurrenceRecord,
    status: string,
    paidMinor: bigint,
  ): ObligationOccurrenceView {
    return {
      id: occurrence.id,
      status,
      expectedMinor: formatMinorUnits(occurrence.amountMinor),
      paidMinor: formatMinorUnits(paidMinor),
      unpaidMinor: formatMinorUnits(computeUnpaidMinor(status, occurrence.amountMinor, paidMinor)),
    };
  }

  private hash(value: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
