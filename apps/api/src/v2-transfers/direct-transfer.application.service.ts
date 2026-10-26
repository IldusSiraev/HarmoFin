import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { findPersonRefs, personRefOf, type PersonRef } from '../common/people/person-ref.repository.js';
import { requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy, type AccessActor } from '../common/policies/budget-access.policy.js';
import {
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { balanceDecreases, type TransferEffect } from './direct-transfer.domain.js';
import { DirectTransferRepository, type TransferRow } from './direct-transfer.repository.js';
import type {
  DirectTransferListQuery,
  UpdateDirectTransferInput,
} from './direct-transfer.schemas.js';

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

function notEditable(): ConflictException {
  return new ConflictException({
    code: 'TRANSFER_NOT_EDITABLE',
    detail: 'Удалённый перевод изменить нельзя.',
  });
}

function alreadyDeleted(): ConflictException {
  return new ConflictException({ code: 'TRANSFER_ALREADY_DELETED', detail: 'Перевод уже удалён.' });
}

function notDeleted(): ConflictException {
  return new ConflictException({
    code: 'TRANSFER_NOT_DELETED',
    detail: 'Восстановить можно только удалённый перевод.',
  });
}

function insufficientForChange(): ConflictException {
  return new ConflictException({
    code: 'INSUFFICIENT_BALANCE',
    detail: 'На счёте недостаточно средств для этого изменения.',
  });
}

function archivedReference(): ConflictException {
  return new ConflictException({
    code: 'REFERENCE_INVALID',
    detail: 'Счёт перевода в архиве. Верните счёт из архива, чтобы восстановить перевод.',
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

export type DirectTransferViewListItem = {
  id: string;
  budgetId: string;
  status: string;
  mode: 'ACCOUNT_ONLY';
  totalMinor: string;
  comment: string | null;
  occurredOn: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  createdBy?: PersonRef;
};

export type DirectTransferListView = {
  items: DirectTransferViewListItem[];
  nextCursor: string | null;
};

export type TransferJournalItem = {
  kind: 'TRANSFER';
  id: string;
  budgetId: string;
  status: 'CONFIRMED' | 'DELETED';
  amountMinor: string;
  currency: string;
  occurredOn: string;
  sourceAccountId: string;
  destinationAccountId: string;
  comment: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export function toTransferJournalItem(row: TransferRow): TransferJournalItem {
  return {
    kind: 'TRANSFER',
    id: row.id,
    budgetId: row.budgetId,
    status: row.status === 'DELETED' ? 'DELETED' : 'CONFIRMED',
    amountMinor: formatMinorUnits(row.totalMinor),
    currency: row.currency,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    // ACCOUNT_ONLY rows always carry both accounts (create writes them).
    sourceAccountId: row.sourceAccountId ?? '',
    destinationAccountId: row.destinationAccountId ?? '',
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function effectOf(row: TransferRow): TransferEffect {
  return {
    confirmed: row.status === 'CONFIRMED',
    sourceAccountId: row.sourceAccountId ?? '',
    destinationAccountId: row.destinationAccountId ?? '',
    amountMinor: row.totalMinor,
  };
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
  private readonly access = new BudgetAccessPolicy();

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
          const actor = await requireAccessActor(tx, model.workspaceId, userId);
          this.access.requireWriter(actor);

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
          this.access.requireAccountOwner(actor, source);
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
      where: { budgetId, deletedAt: null, mode: 'ACCOUNT_ONLY' },
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
        createdAt: true,
      },
    });

    const hasMore = transfers.length > limit;
    const offset = query.cursor ? 1 : 0;
    const items = transfers.slice(offset, offset + limit).map((t) => ({
      id: t.id,
      budgetId: t.budgetId,
      status: t.status,
      mode: 'ACCOUNT_ONLY' as const,
      totalMinor: formatMinorUnits(t.totalMinor),
      comment: t.comment,
      occurredOn: t.occurredOn.toISOString().slice(0, 10),
      sourceAccountId: t.sourceAccountId,
      destinationAccountId: t.destinationAccountId,
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
      where: { id: transferId, budgetId, deletedAt: null, mode: 'ACCOUNT_ONLY' },
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
        createdByUserId: true,
        budget: { select: { workspaceId: true } },
      },
    });

    if (!transfer) {
      throw resourceNotFound();
    }

    const people = await findPersonRefs(this.prisma, transfer.budget.workspaceId, [
      transfer.createdByUserId,
    ]);

    return {
      id: transfer.id,
      budgetId: transfer.budgetId,
      status: transfer.status,
      mode: 'ACCOUNT_ONLY' as const,
      totalMinor: formatMinorUnits(transfer.totalMinor),
      comment: transfer.comment,
      occurredOn: transfer.occurredOn.toISOString().slice(0, 10),
      sourceAccountId: transfer.sourceAccountId,
      destinationAccountId: transfer.destinationAccountId,
      createdBy: personRefOf(people, transfer.createdByUserId),
    };
  }

  async update(
    userId: string,
    budgetId: string,
    transferId: string,
    input: UpdateDirectTransferInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransferJournalItem> {
    const amount =
      input.amount === undefined
        ? undefined
        : parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    if (amount !== undefined && amount <= 0n) {
      throw validationFailed('Сумма перевода должна быть больше нуля.');
    }
    const occurredOn =
      input.occurredOn === undefined ? undefined : parseOccurredOn(input.occurredOn);
    return this.mutate(
      'update',
      userId,
      budgetId,
      transferId,
      input,
      idempotencyKey,
      async (tx, current, ctx) => {
        if (current.status !== 'CONFIRMED') throw notEditable();
        const next = {
          sourceAccountId: input.sourceAccountId ?? current.sourceAccountId ?? '',
          destinationAccountId: input.destinationAccountId ?? current.destinationAccountId ?? '',
          totalMinor: amount ?? current.totalMinor,
          occurredOn: occurredOn ?? current.occurredOn,
          comment: input.comment === undefined ? current.comment : input.comment,
        };
        if (next.sourceAccountId === next.destinationAccountId) throw accountsMustDiffer();
        if (occurredOnKey(next.occurredOn) > ctx.today) {
          throw validationFailed('Нельзя подтвердить факт с будущей датой.');
        }
        const moneyChanged =
          next.sourceAccountId !== current.sourceAccountId ||
          next.destinationAccountId !== current.destinationAccountId ||
          next.totalMinor !== current.totalMinor ||
          next.occurredOn.getTime() !== current.occurredOn.getTime();
        const commentChanged = next.comment !== current.comment;
        if (!moneyChanged && !commentChanged) {
          // Nothing actually changes: skip the write so no UPDATED audit row is created and
          // updatedByUserId/updatedAt are not bumped for a no-op PATCH.
          return current;
        }
        if (moneyChanged) {
          await this.requireActiveAccounts(tx, budgetId, [
            next.sourceAccountId,
            next.destinationAccountId,
          ]);
        }
        if (next.sourceAccountId !== current.sourceAccountId) {
          const newSource = await this.repository.findAccount(tx, budgetId, next.sourceAccountId);
          if (!newSource) throw resourceNotFound();
          this.access.requireAccountOwner(ctx.actor, newSource);
        }
        await this.lockAndCheck(tx, budgetId, ctx.allowNegativeBalance, current, {
          confirmed: true,
          sourceAccountId: next.sourceAccountId,
          destinationAccountId: next.destinationAccountId,
          amountMinor: next.totalMinor,
        });
        return this.repository.updateTransfer(tx, current, next, {
          workspaceId: ctx.workspaceId,
          actorUserId: userId,
          requestId,
        });
      },
    );
  }

  async remove(
    userId: string,
    budgetId: string,
    transferId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransferJournalItem> {
    return this.mutate(
      'delete',
      userId,
      budgetId,
      transferId,
      {},
      idempotencyKey,
      async (tx, current, ctx) => {
        if (current.status === 'DELETED') throw alreadyDeleted();
        await this.lockAndCheck(tx, budgetId, ctx.allowNegativeBalance, current, {
          ...effectOf(current),
          confirmed: false,
        });
        return this.repository.setLifecycle(tx, current, 'DELETED', {
          workspaceId: ctx.workspaceId,
          actorUserId: userId,
          requestId,
        });
      },
    );
  }

  async restore(
    userId: string,
    budgetId: string,
    transferId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<TransferJournalItem> {
    return this.mutate(
      'restore',
      userId,
      budgetId,
      transferId,
      {},
      idempotencyKey,
      async (tx, current, ctx) => {
        if (current.status !== 'DELETED') throw notDeleted();
        const accounts = await Promise.all([
          this.repository.findAccount(tx, budgetId, current.sourceAccountId ?? ''),
          this.repository.findAccount(tx, budgetId, current.destinationAccountId ?? ''),
        ]);
        if (accounts.some((account) => !account || account.archivedAt)) throw archivedReference();
        await this.lockAndCheck(tx, budgetId, ctx.allowNegativeBalance, current, {
          ...effectOf(current),
          confirmed: true,
        });
        return this.repository.setLifecycle(tx, current, 'CONFIRMED', {
          workspaceId: ctx.workspaceId,
          actorUserId: userId,
          requestId,
        });
      },
    );
  }

  private async mutate(
    kind: 'update' | 'delete' | 'restore',
    userId: string,
    budgetId: string,
    transferId: string,
    hashInput: Record<string, unknown>,
    idempotencyKey: string,
    body: (
      tx: Prisma.TransactionClient,
      current: TransferRow,
      ctx: { actor: AccessActor; workspaceId: string; allowNegativeBalance: boolean; today: string },
    ) => Promise<TransferRow>,
  ): Promise<TransferJournalItem> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ budgetId, transferId, kind, ...hashInput }))
      .digest('hex');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);
      return this.idempotency.execute<TransferJournalItem>(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: `directTransfer.${kind}`,
          requestHash,
        },
        async () => {
          const actor = await requireAccessActor(tx, model.workspaceId, userId);
          this.access.requireWriter(actor);
          const budget = await this.repository.requireBudget(tx, budgetId);
          const current = await this.repository.findForMutation(tx, budgetId, transferId);
          if (!current) throw resourceNotFound();
          this.access.requireOperationAuthor(actor, current);
          const row = await body(tx, current, {
            actor,
            workspaceId: model.workspaceId,
            allowNegativeBalance: budget.allowNegativeBalance,
            today: todayInTimezone(new Date(), budget.timezone),
          });
          return { status: 200, body: toTransferJournalItem(row) };
        },
      );
    });
    return result.body;
  }

  private async requireActiveAccounts(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountIds: string[],
  ): Promise<void> {
    for (const accountId of accountIds) {
      const account = await this.repository.findAccount(tx, budgetId, accountId);
      if (!account) throw resourceNotFound();
      if (account.archivedAt || account.currency !== 'RUB' || account.scale !== RUB_SCALE) {
        throw invalidReference();
      }
    }
  }

  /** Locks every touched account in id order, then rejects a change that drives one below zero. */
  private async lockAndCheck(
    tx: Prisma.TransactionClient,
    budgetId: string,
    allowNegativeBalance: boolean,
    current: TransferRow,
    after: TransferEffect,
  ): Promise<void> {
    const before = effectOf(current);
    await this.repository.lockAccounts(tx, budgetId, [
      before.sourceAccountId,
      before.destinationAccountId,
      after.sourceAccountId,
      after.destinationAccountId,
    ]);
    if (allowNegativeBalance) return;
    for (const [accountId, decrease] of balanceDecreases(before, after)) {
      const balance = await this.balances.accountBalance(tx, budgetId, accountId);
      if (balance - decrease < 0n) throw insufficientForChange();
    }
  }
}
