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
import { cycleAndPeriodFor, todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentBalanceRepository } from '../envelope-plans/assignment-balance.repository.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';

const RUB_SCALE = 2;
const TRANSACTION_V2_CREATE_OPERATION = 'transactionV2.create';

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

export type TransactionV2Warning = { code: string; detail: string };

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

/**
 * Creates v2 facts: income and ordinary expense (with or without envelope).
 * Mandatory-envelope payments belong to the obligation flow (O04).
 */
@Injectable()
export class TransactionV2ApplicationService {
  private readonly repository: TransactionRepository;
  private readonly assignmentBalances = new AssignmentBalanceRepository();

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {
    this.repository = new TransactionRepository(prisma);
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
    let periodId: string | null = null;
    if (confirmed && input.transactionType === 'EXPENSE' && refs.envelope?.periodSlot) {
      const periods = await this.repository.findPeriodsCovering(
        tx,
        budgetId,
        refs.envelope.id,
        occurredOn,
      );
      if (periods.length > 1) {
        throw ambiguousPeriod();
      }
      if (periods[0]) {
        periodId = periods[0].id;
      } else {
        const range = cycleAndPeriodFor(budget, input.occurredOn).period;
        const created = await this.repository.createUnsetPeriod(tx, {
          budgetId,
          workspaceId,
          envelopeId: refs.envelope.id,
          startsOn: parseDate(range.start),
          endsOn: parseDate(range.end),
          userId,
          requestId,
        });
        periodId = created.id;
      }
    }

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
}
