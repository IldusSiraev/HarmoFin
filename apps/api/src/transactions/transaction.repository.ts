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

export interface TransactionListQuery {
  limit: number;
  cursor?: string;
  transactionType?: TransactionType;
  status?: TransactionStatus;
  from?: Date;
  to?: Date;
  accountId?: string;
  categoryId?: string;
  envelopeId?: string;
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
        workspace: {
          select: {
            memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
    });
  }

  async list(
    userId: string,
    budgetId: string,
    query: TransactionListQuery,
  ): Promise<TransactionListResult> {
    return this.prisma.$transaction(async (tx) => {
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await tx.transaction.findMany({
        where: {
          budgetId,
          budget: activeBudgetWhere(userId, budgetId),
          ...(query.transactionType ? { transactionType: query.transactionType } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.accountId ? { accountId: query.accountId } : {}),
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.envelopeId ? { envelopeId: query.envelopeId } : {}),
          ...(query.from || query.to
            ? {
                occurredOn: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lte: query.to } : {}),
                },
              }
            : {}),
          ...(cursor
            ? {
                OR: [
                  { occurredOn: { lt: cursor.occurredOn } },
                  { occurredOn: cursor.occurredOn, createdAt: { lt: cursor.createdAt } },
                  {
                    occurredOn: cursor.occurredOn,
                    createdAt: cursor.createdAt,
                    id: { lt: cursor.id },
                  },
                ],
              }
            : {}),
        },
        select: transactionSelect,
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const hasNext = rows.length > query.limit;
      const page = hasNext ? rows.slice(0, query.limit) : rows;
      const items = await this.withBalances(tx, page);
      const last = page.at(-1);
      return {
        items,
        nextCursor: hasNext && last ? encodeCursor(last) : null,
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
        ...(status === 'DELETED' ? { deletedAt: now } : {}),
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
  };
}

function encodeCursor(row: { occurredOn: Date; createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({
      occurredOn: row.occurredOn.toISOString(),
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }),
  ).toString('base64url');
}

function decodeCursor(value: string): { occurredOn: Date; createdAt: Date; id: string } {
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
    occurredOn: string;
    createdAt: string;
    id: string;
  };
  return {
    occurredOn: new Date(parsed.occurredOn),
    createdAt: new Date(parsed.createdAt),
    id: parsed.id,
  };
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
  createdAt: true,
} as const;
