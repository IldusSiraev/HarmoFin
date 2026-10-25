import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  type EnvelopeType,
  type PeriodSlot,
  type TransactionStatus,
  type TransactionType,
} from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';
import { FundingRuleRepository } from '../envelope-plans/funding-rule.repository.js';

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
  accountingModelVersion?: number;
  accountCurrentBalanceMinor: bigint;
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
  /** The column default 1 marks history of the old model; every v2 writer passes 2 explicitly. */
  accountingModelVersion?: 1 | 2;
}

export interface V2ReferenceRecords {
  account: { id: string; currency: string; scale: number } | null;
  category: { id: string; categoryType: TransactionType } | null;
  envelope: {
    id: string;
    currency: string;
    scale: number;
    envelopeType: EnvelopeType;
    periodSlot: PeriodSlot | null;
  } | null;
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
      createdByUserId?: string | undefined;
    },
  ): Promise<boolean> {
    const [account, category, envelope, plan, author] = await Promise.all([
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
      references.createdByUserId
        ? this.prisma.workspaceMembership.findFirst({
            where: {
              userId: references.createdByUserId,
              workspace: { budgets: { some: { id: budgetId } } },
            },
            select: { id: true },
          })
        : Promise.resolve(true),
    ]);
    return Boolean(account && category && envelope && plan && author);
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
      const rows = await tx.transaction.findMany({
        where: journalWhere(userId, budgetId, query, cursor),
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

  /** Read-only link lookup: PlanPayment (v2) and legacy PlanOccurrence.transactionId, both budget-scoped. */
  async findPlanOccurrenceLinks(
    budgetId: string,
    transactionIds: string[],
  ): Promise<Map<string, string[]>> {
    const links = new Map<string, Set<string>>();
    if (transactionIds.length === 0) return new Map();
    const [payments, legacy] = await Promise.all([
      this.prisma.planPayment.findMany({
        where: { budgetId, transactionId: { in: transactionIds } },
        select: { transactionId: true, occurrenceId: true },
      }),
      this.prisma.planOccurrence.findMany({
        where: { budgetId, transactionId: { in: transactionIds } },
        select: { transactionId: true, id: true },
      }),
    ]);
    const add = (transactionId: string | null, occurrenceId: string) => {
      if (!transactionId) return;
      const set = links.get(transactionId) ?? new Set<string>();
      set.add(occurrenceId);
      links.set(transactionId, set);
    };
    for (const row of payments) add(row.transactionId, row.occurrenceId);
    for (const row of legacy) add(row.transactionId, row.id);
    return new Map([...links].map(([id, set]) => [id, [...set].sort()]));
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

  // --- v2 helpers (locks follow roadmap order: budget -> idempotency -> accounts) ---

  async lockBudget(tx: Prisma.TransactionClient, budgetId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "budgets"
      WHERE "id" = ${budgetId}::uuid
      FOR UPDATE
    `;
  }

  async lockAccount(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "accounts"
      WHERE "id" = ${accountId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
  }

  async findActiveMemberRole(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<string | null> {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  async findBudgetSettings(tx: Prisma.TransactionClient, budgetId: string) {
    return tx.budget.findUnique({
      where: { id: budgetId },
      select: {
        id: true,
        workspaceId: true,
        allowNegativeBalance: true,
        cycleStartDay: true,
        periodBoundaryOffset: true,
        timezone: true,
      },
    });
  }

  async findActiveV2References(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
    categoryId: string,
    envelopeId: string | null,
  ): Promise<V2ReferenceRecords> {
    const [account, category, envelope] = await Promise.all([
      tx.account.findFirst({
        where: { id: accountId, budgetId, archivedAt: null },
        select: { id: true, currency: true, scale: true },
      }),
      tx.category.findFirst({
        where: { id: categoryId, budgetId, archivedAt: null },
        select: { id: true, categoryType: true },
      }),
      envelopeId
        ? tx.envelope.findFirst({
            where: { id: envelopeId, budgetId, archivedAt: null },
            select: {
              id: true,
              currency: true,
              scale: true,
              envelopeType: true,
              periodSlot: true,
            },
          })
        : Promise.resolve(null),
    ]);
    return { account, category, envelope };
  }

  async findPeriodsCovering(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    occurredOn: Date,
  ): Promise<Array<{ id: string }>> {
    return tx.envelopePeriod.findMany({
      where: {
        budgetId,
        envelopeId,
        startsOn: { lte: occurredOn },
        endsOn: { gte: occurredOn },
      },
      select: { id: true },
      take: 2,
    });
  }

  async createUnsetPeriod(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      envelopeId: string;
      startsOn: Date;
      endsOn: Date;
      userId: string;
      requestId?: string | undefined;
    },
  ): Promise<{ id: string }> {
    // Single shared creation point: a saved FIXED_PER_PERIOD rule yields a DRAFT suggestion
    // (never a confirmed limit); otherwise the period stays UNSET with a null target.
    const period = await new FundingRuleRepository().getOrCreatePeriod(
      tx,
      params.budgetId,
      params.envelopeId,
      params.startsOn.toISOString().slice(0, 10),
      params.endsOn.toISOString().slice(0, 10),
      { workspaceId: params.workspaceId, userId: params.userId, requestId: params.requestId },
    );
    return { id: period.id };
  }

  async accountCashBalance(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
  ): Promise<bigint> {
    return this.balances.accountBalance(tx, budgetId, accountId);
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
    rows: Array<Omit<TransactionRecord, 'accountCurrentBalanceMinor'>>,
  ): Promise<TransactionRecord[]> {
    return Promise.all(rows.map((row) => this.withBalance(tx, row)));
  }

  private async withBalance(
    tx: Prisma.TransactionClient,
    row: Omit<TransactionRecord, 'accountCurrentBalanceMinor'>,
  ): Promise<TransactionRecord> {
    const accountCurrentBalanceMinor = await this.balances.accountBalance(
      tx,
      row.budgetId,
      row.accountId,
    );
    return { ...row, accountCurrentBalanceMinor };
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

function auditValues(transaction: Omit<TransactionRecord, 'accountCurrentBalanceMinor'>) {
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

function journalWhere(
  userId: string,
  budgetId: string,
  query: TransactionListQuery,
  cursor: JournalCursor | null,
): Prisma.TransactionWhereInput {
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
    ...(query.period ? [{ occurredOn: { gte: query.period.start, lte: query.period.end } }] : []),
  ];
  return {
    budgetId,
    budget: activeBudgetWhere(userId, budgetId),
    ...(query.transactionType ? { transactionType: query.transactionType } : {}),
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.envelopeId ? { envelopeId: query.envelopeId } : {}),
    ...(query.planId ? { planOccurrence: { planId: query.planId, budgetId } } : {}),
    AND: [
      statusCondition(query.status),
      ...(query.search ? [searchCondition(query.search)] : []),
      ...dateConditions,
      ...(cursor ? [journalCursorCondition(cursor)] : []),
    ],
  };
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
  accountingModelVersion: true,
} as const;
