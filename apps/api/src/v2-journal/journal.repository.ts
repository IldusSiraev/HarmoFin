import type { Prisma, PrismaClient } from '@prisma/client';

import { transferRowSelect, type TransferRow } from '../v2-transfers/direct-transfer.repository.js';
import type { FeedPosition } from './journal.merge.js';

export type FeedFilter = {
  limit: number;
  cursor: FeedPosition | null;
  type?: 'INCOME' | 'EXPENSE' | 'TRANSFER' | undefined;
  status?: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED' | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  envelopeId?: string | undefined;
  createdByUserId?: string | undefined;
};

export type AuthorRef = { userId: string; displayName: string | null; isActiveMember: boolean };

// Same fields the transaction journal maps (transactionSelect in transaction.repository.ts).
const transactionFeedSelect = {
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
  accountingModelVersion: true,
  createdByUserId: true,
} as const;

export type TransactionFeedRow = Prisma.TransactionGetPayload<{
  select: typeof transactionFeedSelect;
}>;

function dateRange(filter: FeedFilter) {
  return filter.from || filter.to
    ? {
        occurredOn: {
          ...(filter.from ? { gte: filter.from } : {}),
          ...(filter.to ? { lte: filter.to } : {}),
        },
      }
    : {};
}

/** Strictly after the cursor in feed order (all three keys descending). */
function after(cursor: FeedPosition | null) {
  if (!cursor) return {};
  const occurredOn = new Date(`${cursor.occurredOn}T00:00:00.000Z`);
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { occurredOn: { lt: occurredOn } },
      { occurredOn, createdAt: { lt: createdAt } },
      { occurredOn, createdAt, id: { lt: cursor.id } },
    ],
  };
}

const order = [{ occurredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] as const;

export class JournalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  includesTransactions(filter: FeedFilter): boolean {
    return filter.type !== 'TRANSFER';
  }

  /** Transfers have no category or envelope and are only CONFIRMED or DELETED. */
  includesTransfers(filter: FeedFilter): boolean {
    if (filter.type === 'INCOME' || filter.type === 'EXPENSE') return false;
    if (filter.categoryId || filter.envelopeId) return false;
    return (
      filter.status === undefined || filter.status === 'CONFIRMED' || filter.status === 'DELETED'
    );
  }

  async transactions(budgetId: string, filter: FeedFilter): Promise<TransactionFeedRow[]> {
    if (!this.includesTransactions(filter)) return [];
    return this.prisma.transaction.findMany({
      where: {
        budgetId,
        ...(filter.type ? { transactionType: filter.type as 'INCOME' | 'EXPENSE' } : {}),
        ...(filter.accountId ? { accountId: filter.accountId } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.envelopeId ? { envelopeId: filter.envelopeId } : {}),
        ...(filter.createdByUserId ? { createdByUserId: filter.createdByUserId } : {}),
        AND: [
          filter.status ? { status: filter.status } : { status: { not: 'DELETED' } },
          dateRange(filter),
          after(filter.cursor),
        ],
      },
      select: transactionFeedSelect,
      orderBy: [...order],
      take: filter.limit + 1,
    });
  }

  async transfers(budgetId: string, filter: FeedFilter): Promise<TransferRow[]> {
    if (!this.includesTransfers(filter)) return [];
    return this.prisma.transfer.findMany({
      where: {
        budgetId,
        mode: 'ACCOUNT_ONLY',
        ...(filter.createdByUserId ? { createdByUserId: filter.createdByUserId } : {}),
        AND: [
          filter.status
            ? { status: filter.status as 'CONFIRMED' | 'DELETED' }
            : { status: { in: ['CONFIRMED'] } },
          filter.accountId
            ? {
                OR: [
                  { sourceAccountId: filter.accountId },
                  { destinationAccountId: filter.accountId },
                ],
              }
            : {},
          dateRange(filter),
          after(filter.cursor),
        ],
      },
      select: transferRowSelect,
      orderBy: [...order],
      take: filter.limit + 1,
    });
  }

  /** Authors of journal items, scoped by the budget's workspace. Missing membership (historical data) is omitted. */
  async findAuthors(budgetId: string, userIds: string[]): Promise<Map<string, AuthorRef>> {
    if (userIds.length === 0) return new Map<string, AuthorRef>();
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { userId: { in: userIds }, workspace: { budgets: { some: { id: budgetId } } } },
      select: { userId: true, isActive: true, user: { select: { displayName: true } } },
    });
    return new Map(
      rows.map((row) => [
        row.userId,
        { userId: row.userId, displayName: row.user.displayName, isActiveMember: row.isActive },
      ]),
    );
  }
}
