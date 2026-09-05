import { Prisma, type TransferStatus } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export interface TransferPartRecord {
  id: string;
  transferId: string;
  budgetId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: bigint;
  comment: string | null;
  sourceAccountCurrentBalanceMinor: bigint;
  destinationAccountCurrentBalanceMinor: bigint;
  sourceEnvelopeCurrentBalanceMinor: bigint;
  destinationEnvelopeCurrentBalanceMinor: bigint;
}

export interface TransferRecord {
  id: string;
  budgetId: string;
  status: TransferStatus;
  totalMinor: bigint;
  currency: string;
  scale: number;
  occurredOn: Date;
  comment: string | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  parts: TransferPartRecord[];
}

export interface TransferPartCreateData {
  sourceAccountId: string;
  destinationAccountId: string;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: bigint;
  comment: string | null;
}

export interface TransferCreateData {
  budgetId: string;
  status: 'DRAFT' | 'CONFIRMED';
  totalMinor: bigint;
  occurredOn: Date;
  comment: string | null;
  confirmedAt: Date | null;
  createdByUserId: string;
  updatedByUserId: string;
  parts: TransferPartCreateData[];
}

export interface TransferListQuery {
  limit: number;
  cursor?: string;
  status?: TransferStatus;
  from?: Date;
  to?: Date;
  accountId?: string;
  envelopeId?: string;
}

export interface TransferListResult {
  items: TransferRecord[];
  nextCursor: string | null;
}

export class TransferRepository {
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
    query: TransferListQuery,
  ): Promise<TransferListResult> {
    return this.prisma.$transaction(async (tx) => {
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await tx.transfer.findMany({
        where: {
          budgetId,
          budget: activeBudgetWhere(userId, budgetId),
          ...(query.status ? { status: query.status } : {}),
          ...(query.from || query.to
            ? {
                occurredOn: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lte: query.to } : {}),
                },
              }
            : {}),
          ...(query.accountId || query.envelopeId
            ? {
                parts: {
                  some: {
                    budgetId,
                    ...(query.accountId
                      ? {
                          OR: [
                            { sourceAccountId: query.accountId },
                            { destinationAccountId: query.accountId },
                          ],
                        }
                      : {}),
                    ...(query.envelopeId
                      ? {
                          AND: [
                            {
                              OR: [
                                { sourceEnvelopeId: query.envelopeId },
                                { destinationEnvelopeId: query.envelopeId },
                              ],
                            },
                          ],
                        }
                      : {}),
                  },
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
        select: transferSelect,
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const hasNext = rows.length > query.limit;
      const page = hasNext ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);
      return {
        items: await Promise.all(page.map((row) => this.withConsequences(tx, row))),
        nextCursor: hasNext && last ? encodeCursor(last) : null,
      };
    });
  }

  async find(userId: string, budgetId: string, transferId: string): Promise<TransferRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.transfer.findFirst({
        where: { id: transferId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
        select: transferSelect,
      });
      return row ? this.withConsequences(tx, row) : null;
    });
  }

  async findForMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    transferId: string,
  ): Promise<TransferRecord | null> {
    const accessible = await tx.transfer.findFirst({
      where: { id: transferId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: { id: true },
    });
    if (!accessible) return null;
    await tx.$queryRaw`
      SELECT "id" FROM "transfers"
      WHERE "id" = ${transferId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    const row = await tx.transfer.findFirst({
      where: { id: transferId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: transferSelect,
    });
    return row ? this.withConsequences(tx, row) : null;
  }

  async findActiveReferences(
    tx: Prisma.TransactionClient,
    budgetId: string,
    sourceAccountId: string,
    destinationAccountId: string,
    envelopeIds: string[],
  ) {
    const accountIds = [sourceAccountId, destinationAccountId];
    const uniqueEnvelopeIds = [...new Set(envelopeIds)];
    await tx.$queryRaw`
      SELECT "id" FROM "accounts"
      WHERE "budget_id" = ${budgetId}::uuid
        AND "id" IN (${Prisma.join(accountIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id"
      FOR UPDATE
    `;
    if (uniqueEnvelopeIds.length > 0) {
      await tx.$queryRaw`
        SELECT "id" FROM "envelopes"
        WHERE "budget_id" = ${budgetId}::uuid
          AND "id" IN (${Prisma.join(uniqueEnvelopeIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY "id"
        FOR UPDATE
      `;
    }
    const [accounts, envelopes] = await Promise.all([
      tx.account.findMany({
        where: { budgetId, id: { in: accountIds }, archivedAt: null },
        select: { id: true, budgetId: true, archivedAt: true, currency: true, scale: true },
      }),
      tx.envelope.findMany({
        where: { budgetId, id: { in: uniqueEnvelopeIds }, archivedAt: null },
        select: { id: true, budgetId: true, archivedAt: true, currency: true, scale: true },
      }),
    ]);
    return {
      sourceAccount: accounts.find((account) => account.id === sourceAccountId) ?? null,
      destinationAccount: accounts.find((account) => account.id === destinationAccountId) ?? null,
      envelopes,
    };
  }

  async assertConfirmedTransferCapacity(
    tx: Prisma.TransactionClient,
    budgetId: string,
    sourceAccountId: string,
    parts: TransferPartCreateData[],
  ): Promise<boolean> {
    const accountOutgoingMinor = parts.reduce((total, part) => total + part.amountMinor, 0n);
    const envelopeOutgoing = new Map<string, bigint>();
    for (const part of parts) {
      envelopeOutgoing.set(
        part.sourceEnvelopeId,
        (envelopeOutgoing.get(part.sourceEnvelopeId) ?? 0n) + part.amountMinor,
      );
    }
    const [accountBalance, ...envelopeBalances] = await Promise.all([
      this.balances.accountBalance(tx, budgetId, sourceAccountId),
      ...[...envelopeOutgoing.entries()].map(async ([envelopeId, amountMinor]) => ({
        amountMinor,
        balanceMinor: await this.balances.envelopeBalance(tx, budgetId, envelopeId),
      })),
    ]);
    return (
      accountBalance >= accountOutgoingMinor &&
      envelopeBalances.every(({ amountMinor, balanceMinor }) => balanceMinor >= amountMinor)
    );
  }

  async create(
    tx: Prisma.TransactionClient,
    data: TransferCreateData,
    userId: string,
    requestId?: string,
  ): Promise<TransferRecord> {
    const [budget, transfer] = await Promise.all([
      tx.budget.findUniqueOrThrow({ where: { id: data.budgetId }, select: { workspaceId: true } }),
      tx.transfer.create({
        data: {
          id: createUuidV7(),
          budgetId: data.budgetId,
          status: data.status,
          totalMinor: data.totalMinor,
          occurredOn: data.occurredOn,
          comment: data.comment,
          confirmedAt: data.confirmedAt,
          createdByUserId: data.createdByUserId,
          updatedByUserId: data.updatedByUserId,
          parts: {
            create: data.parts.map((part) => ({
              id: createUuidV7(),
              ...part,
            })),
          },
        },
        select: transferSelect,
      }),
    ]);
    await tx.auditEvent.create({
      data: auditCreate(budget.workspaceId, transfer, userId, requestId, 'CREATED'),
    });
    return this.withConsequences(tx, transfer);
  }

  async updateLifecycle(
    tx: Prisma.TransactionClient,
    current: TransferRecord,
    status: TransferStatus,
    userId: string,
    requestId?: string,
  ): Promise<TransferRecord> {
    const now = new Date();
    const transfer = await tx.transfer.update({
      where: { id: current.id },
      data: {
        status,
        updatedByUserId: userId,
        ...(status === 'CONFIRMED' ? { confirmedAt: now } : {}),
        ...(status === 'CANCELLED' ? { cancelledAt: now } : {}),
        ...(status === 'DELETED' ? { deletedAt: now } : {}),
      },
      select: transferSelect,
    });
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: current.budgetId },
      select: { workspaceId: true },
    });
    await tx.auditEvent.create({
      data: auditCreate(budget.workspaceId, transfer, userId, requestId, status, current),
    });
    return this.withConsequences(tx, transfer);
  }

  private async withConsequences(
    tx: Prisma.TransactionClient,
    row: Omit<TransferRecord, 'parts'> & {
      parts: Array<Omit<TransferPartRecord, keyof TransferPartConsequences>>;
    },
  ): Promise<TransferRecord> {
    return {
      ...row,
      parts: await Promise.all(
        row.parts.map(async (part) => {
          const [
            sourceAccountCurrentBalanceMinor,
            destinationAccountCurrentBalanceMinor,
            sourceEnvelopeCurrentBalanceMinor,
            destinationEnvelopeCurrentBalanceMinor,
          ] = await Promise.all([
            this.balances.accountBalance(tx, row.budgetId, part.sourceAccountId),
            this.balances.accountBalance(tx, row.budgetId, part.destinationAccountId),
            this.balances.envelopeBalance(tx, row.budgetId, part.sourceEnvelopeId),
            this.balances.envelopeBalance(tx, row.budgetId, part.destinationEnvelopeId),
          ]);
          return {
            ...part,
            sourceAccountCurrentBalanceMinor,
            destinationAccountCurrentBalanceMinor,
            sourceEnvelopeCurrentBalanceMinor,
            destinationEnvelopeCurrentBalanceMinor,
          };
        }),
      ),
    };
  }
}

type TransferPartConsequences = Pick<
  TransferPartRecord,
  | 'sourceAccountCurrentBalanceMinor'
  | 'destinationAccountCurrentBalanceMinor'
  | 'sourceEnvelopeCurrentBalanceMinor'
  | 'destinationEnvelopeCurrentBalanceMinor'
>;

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

type TransferAuditRecord = Pick<
  TransferRecord,
  'id' | 'budgetId' | 'status' | 'totalMinor' | 'occurredOn'
> & {
  parts: Array<
    Pick<
      TransferPartRecord,
      | 'sourceAccountId'
      | 'destinationAccountId'
      | 'sourceEnvelopeId'
      | 'destinationEnvelopeId'
      | 'amountMinor'
    >
  >;
};

function auditValues(transfer: TransferAuditRecord) {
  return {
    status: transfer.status,
    totalMinor: transfer.totalMinor.toString(),
    occurredOn: transfer.occurredOn.toISOString().slice(0, 10),
    parts: transfer.parts.map((part) => ({
      sourceAccountId: part.sourceAccountId,
      destinationAccountId: part.destinationAccountId,
      sourceEnvelopeId: part.sourceEnvelopeId,
      destinationEnvelopeId: part.destinationEnvelopeId,
      amountMinor: part.amountMinor.toString(),
    })),
  };
}

function auditCreate(
  workspaceId: string,
  transfer: TransferAuditRecord,
  userId: string,
  requestId: string | undefined,
  action: string,
  previous?: TransferRecord,
) {
  return {
    id: createUuidV7(),
    actorUserId: userId,
    workspaceId,
    budgetId: transfer.budgetId,
    entityType: 'transfer',
    entityId: transfer.id,
    action,
    source: 'API',
    requestId: requestId ?? null,
    ...(previous ? { oldValues: auditValues(previous) } : {}),
    newValues: auditValues(transfer),
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

const transferSelect = {
  id: true,
  budgetId: true,
  status: true,
  totalMinor: true,
  currency: true,
  scale: true,
  occurredOn: true,
  comment: true,
  confirmedAt: true,
  cancelledAt: true,
  deletedAt: true,
  createdAt: true,
  parts: {
    select: {
      id: true,
      transferId: true,
      budgetId: true,
      sourceAccountId: true,
      destinationAccountId: true,
      sourceEnvelopeId: true,
      destinationEnvelopeId: true,
      amountMinor: true,
      comment: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} as const;
