import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import {
  forbidden,
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { DirectTransferRepository } from './direct-transfer.repository.js';

const RUB_SCALE = 2;
const DIRECT_TRANSFER_CREATE_OPERATION = 'directTransfer.create';

export type DirectTransferInput = {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: string;
  occurredOn: string;
};

export type DirectTransferView = {
  id: string;
  budgetId: string;
  status: 'CONFIRMED';
  mode: 'ACCOUNT_ONLY';
  totalMinor: string;
  sourceAccountId: string;
  destinationAccountId: string;
  occurredOn: string;
};

function validationFailed(detail: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail,
  });
}

function accountsMustDiffer(): BadRequestException {
  return new BadRequestException({
    code: 'TRANSFER_ACCOUNTS_MUST_DIFFER',
    detail: 'Счета отправки и прихода должны быть разными.',
  });
}

function insufficientBalance(): ConflictException {
  return new ConflictException({
    code: 'INSUFFICIENT_BALANCE',
    detail: 'На счёте отправки недостаточно средств для прямого перевода.',
  });
}

function parseOccurredOn(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw validationFailed('Дата перевода должна быть в формате ГГГГ-ММ-ДД.');
  }
  return new Date(`${value}T00:00:00Z`);
}

function occurredOnKey(occurredOn: Date): string {
  return occurredOn.toISOString().slice(0, 10);
}

/**
 * Confirms clean bank transfers between accounts without envelopes
 * (Transfer.mode = ACCOUNT_ONLY). Financial rules live here; repositories
 * only touch data, controllers only translate HTTP (O01b).
 */
@Injectable()
export class DirectTransferApplicationService {
  private readonly repository = new DirectTransferRepository();
  private readonly balances = new FinancialBalanceRepository();

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async create(
    userId: string,
    budgetId: string,
    input: DirectTransferInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<DirectTransferView> {
    const occurredOn = parseOccurredOn(input.occurredOn);
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          budgetId,
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
          amount: input.amount.trim(),
          occurredOn: occurredOnKey(occurredOn),
        }),
      )
      .digest('hex');

    const result = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);

      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: DIRECT_TRANSFER_CREATE_OPERATION,
          requestHash,
        },
        async () => {
          const membership = await tx.workspaceMembership.findFirst({
            where: {
              workspaceId: model.workspaceId,
              userId,
              isActive: true,
            },
            select: { role: true },
          });
          if (!membership || (membership.role !== 'OWNER' && membership.role !== 'EDITOR')) {
            throw forbidden();
          }

          if (input.sourceAccountId === input.destinationAccountId) {
            throw accountsMustDiffer();
          }

          const amount = parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
          if (amount <= 0n) {
            throw validationFailed('Сумма перевода должна быть больше нуля.');
          }

          const budget = await this.repository.requireBudget(tx, budgetId);
          const source = await this.repository.findAccount(tx, budgetId, input.sourceAccountId);
          const destination = await this.repository.findAccount(
            tx,
            budgetId,
            input.destinationAccountId,
          );
          if (!source || !destination) {
            throw resourceNotFound();
          }
          await this.repository.lockAccounts(tx, budgetId, [source.id, destination.id]);

          if (
            source.archivedAt ||
            source.currency !== 'RUB' ||
            source.scale !== RUB_SCALE ||
            destination.archivedAt ||
            destination.currency !== 'RUB' ||
            destination.scale !== RUB_SCALE
          ) {
            throw invalidReference();
          }

          const today = todayInTimezone(new Date(), budget.timezone);
          if (occurredOnKey(occurredOn) > today) {
            throw validationFailed('Нельзя подтвердить факт с будущей датой.');
          }

          if (!budget.allowNegativeBalance) {
            const balance = await this.balances.accountBalance(tx, budgetId, source.id);
            if (balance < amount) {
              throw insufficientBalance();
            }
          }

          const transfer = await this.repository.createDirectTransfer(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            sourceAccountId: source.id,
            destinationAccountId: destination.id,
            amountMinor: amount,
            occurredOn,
            requestId,
          });

          const body: DirectTransferView = {
            id: transfer.id,
            budgetId,
            status: 'CONFIRMED',
            mode: 'ACCOUNT_ONLY',
            totalMinor: formatMinorUnits(amount),
            sourceAccountId: source.id,
            destinationAccountId: destination.id,
            occurredOn: occurredOnKey(occurredOn),
          };
          return { status: 201, body };
        },
      );
    });

    return result.body;
  }
}
