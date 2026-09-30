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
import type { DirectTransferListQuery } from './direct-transfer.schemas.js';

const RUB_SCALE = 2;
const DIRECT_TRANSFER_CREATE_OPERATION = 'directTransfer.create';

export type DirectTransferInput = {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: string;
  occurredOn: string;
  comment?: string;
};

export type DirectTransferView = {
  id: string;
  budgetId: string;
  status: 'CONFIRMED';
  mode: 'ACCOUNT_ONLY';
  totalMinor: string;
  sourceAccountId: string;
  destinationAccountId: string;
  comment: string | null;
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
 * Views returned by list/get endpoints (both ACCOUNT_ONLY and LEGACY_PARTS).
 */
export type DirectTransferPartView = {
  id: string;
  amountMinor: string;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string | null;
};

export type DirectTransferViewListItem = {
  id: string;
  budgetId: string;
  status: string;
  mode: 'LEGACY_PARTS' | 'ACCOUNT_ONLY';
  totalMinor: string;
  comment: string | null;
  occurredOn: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  parts: DirectTransferPartView[] | undefined;
};

export type DirectTransferListView = {
  items: DirectTransferViewListItem[];
  nextCursor: string | null;
};

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

    const view = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);

      return this.idempotency.execute<DirectTransferView>(
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
            comment: input.comment ?? null,
            requestId,
          });

          return {
            status: 201,
            body: {
              id: transfer.id,
              budgetId,
              status: 'CONFIRMED',
              mode: 'ACCOUNT_ONLY',
              totalMinor: formatMinorUnits(amount),
              sourceAccountId: source.id,
              destinationAccountId: destination.id,
              comment: input.comment ?? null,
              occurredOn: occurredOnKey(occurredOn),
            },
          };
        },
      );
    });

    return view.body;
  }

  async list(
    userId: string,
    budgetId: string,
    query: DirectTransferListQuery,
  ): Promise<DirectTransferListView> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const limit = query.limit;

    // Prisma cursor is inclusive: the cursor row is included in the result,
    // so slice(1) ≡ skip: 1 — the page is exclusive of the cursor row (keyset).
    const transfers = await this.prisma.transfer.findMany({
      where: { budgetId, deletedAt: null },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor } } : {}),
      take: limit + 1,
      select: {
        id: true,
        budgetId: true,
        status: true,
        mode: true,
        totalMinor: true,
        comment: true,
        occurredOn: true,
        sourceAccountId: true,
        destinationAccountId: true,
        parts: {
          select: {
            id: true,
            amountMinor: true,
            sourceEnvelopeId: true,
            destinationEnvelopeId: true,
          },
        },
        createdAt: true,
      },
    });

    const hasMore = transfers.length > limit;
    const offset = query.cursor ? 1 : 0;
    const items = transfers.slice(offset, offset + limit).map((t) => ({
      id: t.id,
      budgetId: t.budgetId,
      status: t.status,
      mode: t.mode,
      totalMinor: formatMinorUnits(t.totalMinor),
      comment: t.comment,
      occurredOn: t.occurredOn.toISOString().slice(0, 10),
      sourceAccountId: t.sourceAccountId,
      destinationAccountId: t.destinationAccountId,
      parts:
        t.mode === 'LEGACY_PARTS'
          ? t.parts.map((p) => ({
              id: p.id,
              amountMinor: formatMinorUnits(p.amountMinor),
              sourceEnvelopeId: p.sourceEnvelopeId,
              destinationEnvelopeId: p.destinationEnvelopeId,
            }))
          : undefined,
    }));

    const last = items[items.length - 1];
    return { items, nextCursor: hasMore ? (last ? last.id : null) : null };
  }

  async get(
    userId: string,
    budgetId: string,
    transferId: string,
  ): Promise<DirectTransferViewListItem> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const transfer = await this.prisma.transfer.findFirst({
      where: { id: transferId, budgetId, deletedAt: null },
      select: {
        id: true,
        budgetId: true,
        status: true,
        mode: true,
        totalMinor: true,
        comment: true,
        occurredOn: true,
        sourceAccountId: true,
        destinationAccountId: true,
        parts: {
          select: {
            id: true,
            amountMinor: true,
            sourceEnvelopeId: true,
            destinationEnvelopeId: true,
          },
        },
      },
    });

    if (!transfer) {
      throw resourceNotFound();
    }

    return {
      id: transfer.id,
      budgetId: transfer.budgetId,
      status: transfer.status,
      mode: transfer.mode,
      totalMinor: formatMinorUnits(transfer.totalMinor),
      comment: transfer.comment,
      occurredOn: transfer.occurredOn.toISOString().slice(0, 10),
      sourceAccountId: transfer.sourceAccountId,
      destinationAccountId: transfer.destinationAccountId,
      parts:
        transfer.mode === 'LEGACY_PARTS'
          ? transfer.parts.map((p) => ({
              id: p.id,
              amountMinor: formatMinorUnits(p.amountMinor),
              sourceEnvelopeId: p.sourceEnvelopeId,
              destinationEnvelopeId: p.destinationEnvelopeId,
            }))
          : undefined,
    };
  }
}
