import { BadRequestException } from '@nestjs/common';
import { Prisma, type TransactionStatus, type TransactionType } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export interface TransactionRecord {
  id: string;
  budgetId: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  amountMinor: bigint;
  currency: string;
  scale: number;
  occurredOn: Date;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  sourceDescription: string | null;
  merchantName: string | null;
  isPlanned: boolean;
  comment: string | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  deletedAt: Date | null;
  preDeleteStatus: TransactionStatus | null;
  createdAt: Date;
  accountCurrentBalanceMinor: bigint;
  envelopeCurrentBalanceMinor: bigint | null;
}

export interface TransactionCreateData {
  budgetId: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  amountMinor: bigint;
  occurredOn: Date;
  accountId: string;
  categoryId: string;
  envelopeId: string | null;
  sourceDescription: string | null;
  merchantName: string | null;
  isPlanned: boolean;
  comment: string | null;
  confirmedAt: Date | null;
  createdByUserId: string;
  updatedByUserId: string;
}

export interface TransactionUpdateData {
  amountMinor?: bigint;
  occurredOn?: Date;
  accountId?: string;
  categoryId?: string;
  envelopeId?: string | null;
  sourceDescription?: string | null;
  merchantName?: string | null;
  isPlanned?: boolean;
  comment?: string | null;
  updatedByUserId: string;
}

export type JournalSortBy = 'occurredOn' | 'amount';
export type JournalSortDirection = 'asc' | 'desc';

export interface TransactionListQuery {
  limit: number;
  cursor?: string;
  search?: string;
  transactionType?: TransactionType;
  status?: TransactionStatus | 'all';
  from?: Date;
  to?: Date;
  cycle?: { start: Date; end: Date };
  period?: { start: Date; end: Date };
  accountId?: string;
  categoryId?: string;
  envelopeId?: string;
  planId?: string;
  sortBy: JournalSortBy;
  sortDirection: JournalSortDirection;
}

export interface TransactionListResult {
  items: TransactionRecord[];
  nextCursor: string | null;
}

export class TransactionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances = new FinancialBalanceRepository(),
  ) {}

  runTransaction<T>(write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(write);
  }

  async findAccessibleWithRole(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: {
        id: true,
        workspaceId: true,
        allowNegativeBalance: true,
        cycleStartDay: true,
        periodBoundaryOffset: true,
        timezone: true,
        workspace: {
          select: {
            memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
    });
  }

  async validateJournalReferences(
    budgetId: string,
    references: {
      accountId?: string | undefined;
      categoryId?: string | undefined;
      envelopeId?: string | undefined;
      planId?: string | undefined;
    },
  ): Promise<boolean> {
    const [account, category, envelope, plan] = await Promise.all([
      references.accountId
        ? this.prisma.account.findFirst({
            where: { id: references.accountId, budgetId },
            select: { id: true },
          })
        : Promise.resolve(true),
      references.categoryId
        ? this.prisma.category.findFirst({
            where: { id: references.categoryId, budgetId },
            select: { id: true },
          })
        : Promise.resolve(true),
      references.envelopeId
        ? this.prisma.envelope.findFirst({
            where: { id: references.envelopeId, budgetId },
            select: { id: true },
          })
        : Promise.resolve(true),
      references.planId
        ? this.prisma.regularPlan.findFirst({
            where: { id: references.planId, budgetId },
            select: { id: true },
          })
        : Promise.resolve(true),
    ]);
    return Boolean(account && category && envelope && plan);
  }
  async list(
    userId: string,
    budgetId: string,
    query: TransactionListQuery,
  ): Promise<TransactionListResult> {
    return this.prisma.$transaction(async (tx) => {
      const cursor = query.cursor
        ? decodeJournalCursor(query.cursor, query.sortBy, query.sortDirection)
        : null;
      const dateConditions = [
        ...(query.from || query.to
          ? [
              {
                occurredOn: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lte: query.to } : {}),
                },
              },
            ]
          : []),
        ...(query.cycle ? [{ occurredOn: { gte: query.cycle.start, lte: query.cycle.end } }] : []),
        ...(query.period
          ? [{ occurredOn: { gte: query.period.start, lte: query.period.end } }]
          : []),
      ];
      const rows = await tx.transaction.findMany({
        where: {
          budgetId,
          budget: activeBudgetWhere(userId, budgetId),
          ...(query.transactionType ? { transactionType: query.transactionType } : {}),
          ...(query.accountId ? { accountId: query.accountId } : {}),
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.envelopeId ? { envelopeId: query.envelopeId } : {}),
          ...(query.planId
            ? { planOccurrence: { planId: query.planId, budgetId } }
            : {}),
          AND: [
            statusCondition(query.status),
            ...(query.search ? [searchCondition(query.search)] : []),
            ...dateConditions,
            ...(cursor ? [journalCursorCondition(cursor)] : []),
          ],
        },
        select: transactionSelect,
        orderBy: journalOrderBy(query.sortBy, query.sortDirection),
        take: query.limit + 1,
      });
      const hasNext = rows.length > query.limit;
      const page = hasNext ? rows.slice(0, query.limit) : rows;
      const items = await this.withBalances(tx, page);
      const last = page.at(-1);
      return {
        items,
        nextCursor: hasNext && last ? encodeJournalCursor(cursorFor(last, query)) : null,
      };
    });
  }

  async find(
    userId: string,
    budgetId: string,
    transactionId: string,
  ): Promise<TransactionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.transaction.findFirst({
        where: { id: transactionId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
        select: transactionSelect,
      });
      return row ? this.withBalance(tx, row) : null;
    });
  }

  async findForMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    transactionId: string,
  ): Promise<TransactionRecord | null> {
    await tx.$queryRaw`
      SELECT "id" FROM "transactions"
      WHERE "id" = ${transactionId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    const row = await tx.transaction.findFirst({
      where: { id: transactionId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: transactionSelect,
    });
    return row ? this.withBalance(tx, row) : null;
  }

  async findActiveReferences(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
    categoryId: string,
    envelopeId: string | null,
  ) {
    const [account, category, envelope] = await Promise.all([
      tx.account.findFirst({
        where: { id: accountId, budgetId, archivedAt: null },
        select: { id: true, budgetId: true, archivedAt: true, currency: true, scale: true },
      }),
      tx.category.findFirst({
        where: { id: categoryId, budgetId, archivedAt: null },
        select: { id: true, budgetId: true, archivedAt: true, categoryType: true },
      }),
      envelopeId
        ? tx.envelope.findFirst({
            where: { id: envelopeId, budgetId, archivedAt: null },
            select: { id: true, budgetId: true, archivedAt: true, currency: true, scale: true },
          })
        : Promise.resolve(null),
    ]);
    return { account, category, envelope };
  }

  async assertConfirmedExpenseCapacity(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
    envelopeId: string,
    amountMinor: bigint,
    replacing?: TransactionRecord,
  ): Promise<boolean> {
    await tx.$queryRaw`
      SELECT "id" FROM "accounts"
      WHERE "id" = ${accountId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    await tx.$queryRaw`
      SELECT "id" FROM "envelopes"
      WHERE "id" = ${envelopeId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    const [accountBalance, envelopeBalance] = await Promise.all([
      this.balances.accountBalance(tx, budgetId, accountId),
      this.balances.envelopeBalance(tx, budgetId, envelopeId),
    ]);
    const restoresAccount =
      replacing?.status === 'CONFIRMED' &&
      replacing.transactionType === 'EXPENSE' &&
      replacing.accountId === accountId
        ? replacing.amountMinor
        : 0n;
    const restoresEnvelope =
      replacing?.status === 'CONFIRMED' &&
      replacing.transactionType === 'EXPENSE' &&
      replacing.envelopeId === envelopeId
        ? replacing.amountMinor
        : 0n;
    return (
      accountBalance + restoresAccount >= amountMinor &&
      envelopeBalance + restoresEnvelope >= amountMinor
    );
  }

  async create(
    tx: Prisma.TransactionClient,
    data: TransactionCreateData,
    userId: string,
    requestId?: string,
  ): Promise<TransactionRecord> {
    const [budget, transaction] = await Promise.all([
      tx.budget.findUniqueOrThrow({ where: { id: data.budgetId }, select: { workspaceId: true } }),
      tx.transaction.create({ data: { id: createUuidV7(), ...data }, select: transactionSelect }),
    ]);
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: budget.workspaceId,
        budgetId: data.budgetId,
        entityType: 'transaction',
        entityId: transaction.id,
        action: 'CREATED',
        source: 'API',
        requestId: requestId ?? null,
        newValues: auditValues(transaction),
      },
    });
    return this.withBalance(tx, transaction);
  }

  async update(
    tx: Prisma.TransactionClient,
    current: TransactionRecord,
    data: TransactionUpdateData,
    userId: string,
    requestId?: string,
  ): Promise<TransactionRecord> {
    const transaction = await tx.transaction.update({
      where: { id: current.id },
      data,
      select: transactionSelect,
    });
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: current.budgetId },
      select: { workspaceId: true },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: budget.workspaceId,
        budgetId: current.budgetId,
        entityType: 'transaction',
        entityId: current.id,
        action: 'UPDATED',
        source: 'API',
        requestId: requestId ?? null,
        oldValues: auditValues(current),
        newValues: auditValues(transaction),
      },
    });
    return this.withBalance(tx, transaction);
  }

  async updateLifecycle(
    tx: Prisma.TransactionClient,
    current: TransactionRecord,
    status: TransactionStatus,
    userId: string,
    requestId?: string,
  ): Promise<TransactionRecord> {
    const now = new Date();
    const transaction = await tx.transaction.update({
      where: { id: current.id },
      data: {
        status,
        updatedByUserId: userId,
        ...(status === 'CONFIRMED' ? { confirmedAt: now } : {}),
        ...(status === 'CANCELLED' ? { cancelledAt: now } : {}),
        ...(status === 'DELETED' ? { deletedAt: now, preDeleteStatus: current.status } : {}),
      },
      select: transactionSelect,
    });
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: current.budgetId },
      select: { workspaceId: true },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: budget.workspaceId,
        budgetId: current.budgetId,
        entityType: 'transaction',
        entityId: current.id,
        action: status,
        source: 'API',
        requestId: requestId ?? null,
        oldValues: auditValues(current),
        newValues: auditValues(transaction),
      },
    });
    return this.withBalance(tx, transaction);
  }

  async restoreLifecycle(
    tx: Prisma.TransactionClient,
    current: TransactionRecord,
    status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED',
    userId: string,
    requestId?: string,
  ): Promise<TransactionRecord> {
    const transaction = await tx.transaction.update({
      where: { id: current.id },
      data: {
        status,
        deletedAt: null,
        preDeleteStatus: null,
        updatedByUserId: userId,
      },
      select: transactionSelect,
    });
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: current.budgetId },
      select: { workspaceId: true },
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: userId,
        workspaceId: budget.workspaceId,
        budgetId: current.budgetId,
        entityType: 'transaction',
        entityId: current.id,
        action: 'RESTORED',
        source: 'API',
        requestId: requestId ?? null,
        oldValues: auditValues(current),
        newValues: auditValues(transaction),
      },
    });
    return this.withBalance(tx, transaction);
  }

  async findConfirmedAllocationsForIncome(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeTransactionId: string,
  ): Promise<Array<{ id: string; amountMinor: bigint }>> {
    return tx.$queryRaw<Array<{ id: string; amountMinor: bigint }>>`
      SELECT "id", "amount_minor" AS "amountMinor"
      FROM "income_allocations"
      WHERE "budget_id" = ${budgetId}::uuid
        AND "income_transaction_id" = ${incomeTransactionId}::uuid
        AND "status" = 'CONFIRMED'
      ORDER BY "id"
      FOR UPDATE
    `;
  }

  private async withBalances(
    tx: Prisma.TransactionClient,
    rows: Array<
      Omit<TransactionRecord, 'accountCurrentBalanceMinor' | 'envelopeCurrentBalanceMinor'>
    >,
  ): Promise<TransactionRecord[]> {
    return Promise.all(rows.map((row) => this.withBalance(tx, row)));
  }

  private async withBalance(
    tx: Prisma.TransactionClient,
    row: Omit<TransactionRecord, 'accountCurrentBalanceMinor' | 'envelopeCurrentBalanceMinor'>,
  ): Promise<TransactionRecord> {
    const [accountCurrentBalanceMinor, envelopeCurrentBalanceMinor] = await Promise.all([
      this.balances.accountBalance(tx, row.budgetId, row.accountId),
      row.envelopeId ? this.balances.envelopeBalance(tx, row.budgetId, row.envelopeId) : null,
    ]);
    return { ...row, accountCurrentBalanceMinor, envelopeCurrentBalanceMinor };
  }
}

function activeBudgetWhere(userId: string, budgetId: string) {
  return {
    id: budgetId,
    status: 'ACTIVE' as const,
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true } },
    },
  };
}

function auditValues(
  transaction: Omit<
    TransactionRecord,
    'accountCurrentBalanceMinor' | 'envelopeCurrentBalanceMinor'
  >,
) {
  return {
    transactionType: transaction.transactionType,
    status: transaction.status,
    amountMinor: transaction.amountMinor.toString(),
    occurredOn: transaction.occurredOn.toISOString().slice(0, 10),
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    envelopeId: transaction.envelopeId,
    isPlanned: transaction.isPlanned,
    confirmedAt: transaction.confirmedAt?.toISOString() ?? null,
    cancelledAt: transaction.cancelledAt?.toISOString() ?? null,
    deletedAt: transaction.deletedAt?.toISOString() ?? null,
    preDeleteStatus: transaction.preDeleteStatus,
  };
}

export type JournalCursor = {
  v: 1;
  sortBy: JournalSortBy;
  sortDirection: JournalSortDirection;
  value: string;
  createdAt: string;
  id: string;
};

export function encodeJournalCursor(cursor: JournalCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeJournalCursor(
  value: string,
  sortBy: JournalSortBy,
  sortDirection: JournalSortDirection,
): JournalCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<JournalCursor>;
    if (
      parsed.v !== 1 ||
      parsed.sortBy !== sortBy ||
      parsed.sortDirection !== sortDirection ||
      typeof parsed.value !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      !isValidCursorValue(parsed.value, sortBy) ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      !isUuid(parsed.id)
    ) {
      throw new Error();
    }
    return parsed as JournalCursor;
  } catch {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Некорректный курсор журнала.',
    });
  }
}

function statusCondition(status: TransactionListQuery['status']): Prisma.TransactionWhereInput {
  if (status === 'all') return {};
  if (status) return { status };
  return { status: { not: 'DELETED' } };
}

function searchCondition(search: string): Prisma.TransactionWhereInput {
  return {
    OR: [
      { sourceDescription: { contains: search, mode: 'insensitive' } },
      { merchantName: { contains: search, mode: 'insensitive' } },
    ],
  };
}

function journalOrderBy(
  sortBy: JournalSortBy,
  sortDirection: JournalSortDirection,
): Prisma.TransactionOrderByWithRelationInput[] {
  const field = sortBy === 'amount' ? 'amountMinor' : 'occurredOn';
  return [
    { [field]: sortDirection },
    { createdAt: sortDirection },
    { id: sortDirection },
  ] as Prisma.TransactionOrderByWithRelationInput[];
}

function journalCursorCondition(cursor: JournalCursor): Prisma.TransactionWhereInput {
  const field = cursor.sortBy === 'amount' ? 'amountMinor' : 'occurredOn';
  const value = cursor.sortBy === 'amount' ? BigInt(cursor.value) : new Date(cursor.value);
  const createdAt = new Date(cursor.createdAt);
  const comparison = cursor.sortDirection === 'asc' ? 'gt' : 'lt';
  return {
    OR: [
      { [field]: { [comparison]: value } },
      { [field]: value, createdAt: { [comparison]: createdAt } },
      { [field]: value, createdAt, id: { [comparison]: cursor.id } },
    ],
  } as Prisma.TransactionWhereInput;
}

function cursorFor(
  row: { occurredOn: Date; amountMinor: bigint; createdAt: Date; id: string },
  query: TransactionListQuery,
): JournalCursor {
  return {
    v: 1,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    value: query.sortBy === 'amount' ? row.amountMinor.toString() : row.occurredOn.toISOString(),
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  };
}

function isValidCursorValue(value: string, sortBy: JournalSortBy): boolean {
  if (sortBy === 'amount') return /^-?\d+$/.test(value);
  return !Number.isNaN(new Date(value).getTime());
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const transactionSelect = {
  id: true,
  budgetId: true,
  transactionType: true,
  status: true,
  amountMinor: true,
  currency: true,
  scale: true,
  occurredOn: true,
  accountId: true,
  categoryId: true,
  envelopeId: true,
  sourceDescription: true,
  merchantName: true,
  isPlanned: true,
  comment: true,
  confirmedAt: true,
  cancelledAt: true,
  deletedAt: true,
  preDeleteStatus: true,
  createdAt: true,
} as const;
