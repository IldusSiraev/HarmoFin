import { Prisma, type EnvelopeReallocationStatus } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export interface EnvelopeReallocationRecord {
  id: string;
  budgetId: string;
  status: EnvelopeReallocationStatus;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: bigint;
  currency: string;
  scale: number;
  occurredOn: Date;
  comment: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  sourceEnvelopeCurrentBalanceMinor: bigint;
  destinationEnvelopeCurrentBalanceMinor: bigint;
}

export interface EnvelopeReallocationCreateData {
  budgetId: string;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: bigint;
  occurredOn: Date;
  comment: string | null;
  createdByUserId: string;
  updatedByUserId: string;
}

export interface EnvelopeReallocationListQuery {
  limit: number;
  cursor?: string;
  envelopeId?: string;
  from?: Date;
  to?: Date;
}

export interface EnvelopeReallocationListResult {
  items: EnvelopeReallocationRecord[];
  nextCursor: string | null;
}

export class EnvelopeReallocationRepository {
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
    query: EnvelopeReallocationListQuery,
  ): Promise<EnvelopeReallocationListResult> {
    return this.prisma.$transaction(async (tx) => {
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await tx.envelopeReallocation.findMany({
        where: {
          budgetId,
          budget: activeBudgetWhere(userId, budgetId),
          ...(query.from || query.to
            ? {
                occurredOn: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lte: query.to } : {}),
                },
              }
            : {}),
          AND: [
            ...(query.envelopeId
              ? [
                  {
                    OR: [
                      { sourceEnvelopeId: query.envelopeId },
                      { destinationEnvelopeId: query.envelopeId },
                    ],
                  },
                ]
              : []),
            ...(cursor
              ? [
                  {
                    OR: [
                      { occurredOn: { lt: cursor.occurredOn } },
                      { occurredOn: cursor.occurredOn, createdAt: { lt: cursor.createdAt } },
                      {
                        occurredOn: cursor.occurredOn,
                        createdAt: cursor.createdAt,
                        id: { lt: cursor.id },
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
        select: envelopeReallocationSelect,
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

  async find(
    userId: string,
    budgetId: string,
    id: string,
  ): Promise<EnvelopeReallocationRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.envelopeReallocation.findFirst({
        where: { id, budgetId, budget: activeBudgetWhere(userId, budgetId) },
        select: envelopeReallocationSelect,
      });
      return row ? this.withConsequences(tx, row) : null;
    });
  }

  async findForMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    id: string,
  ): Promise<EnvelopeReallocationRecord | null> {
    const accessible = await tx.envelopeReallocation.findFirst({
      where: { id, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: { id: true },
    });
    if (!accessible) return null;
    await tx.$queryRaw`
      SELECT "id" FROM "envelope_reallocations"
      WHERE "id" = ${id}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    const row = await tx.envelopeReallocation.findFirst({
      where: { id, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: envelopeReallocationSelect,
    });
    return row ? this.withConsequences(tx, row) : null;
  }

  async findActiveReferences(
    tx: Prisma.TransactionClient,
    budgetId: string,
    sourceEnvelopeId: string,
    destinationEnvelopeId: string,
  ) {
    const envelopeIds = [sourceEnvelopeId, destinationEnvelopeId];
    await tx.$queryRaw`
      SELECT "id" FROM "envelopes"
      WHERE "budget_id" = ${budgetId}::uuid
        AND "id" IN (${Prisma.join(envelopeIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id"
      FOR UPDATE
    `;
    const envelopes = await tx.envelope.findMany({
      where: { budgetId, id: { in: envelopeIds }, archivedAt: null },
      select: { id: true, budgetId: true, archivedAt: true, currency: true, scale: true },
    });
    return {
      sourceEnvelope: envelopes.find((envelope) => envelope.id === sourceEnvelopeId) ?? null,
      destinationEnvelope:
        envelopes.find((envelope) => envelope.id === destinationEnvelopeId) ?? null,
    };
  }

  async assertReallocationCapacity(
    tx: Prisma.TransactionClient,
    budgetId: string,
    sourceEnvelopeId: string,
    amountMinor: bigint,
  ): Promise<boolean> {
    const balance = await this.balances.envelopeBalance(tx, budgetId, sourceEnvelopeId);
    return balance >= amountMinor;
  }

  async create(
    tx: Prisma.TransactionClient,
    data: EnvelopeReallocationCreateData,
    userId: string,
    requestId?: string,
  ): Promise<EnvelopeReallocationRecord> {
    const [budget, record] = await Promise.all([
      tx.budget.findUniqueOrThrow({ where: { id: data.budgetId }, select: { workspaceId: true } }),
      tx.envelopeReallocation.create({
        data: {
          id: createUuidV7(),
          budgetId: data.budgetId,
          sourceEnvelopeId: data.sourceEnvelopeId,
          destinationEnvelopeId: data.destinationEnvelopeId,
          amountMinor: data.amountMinor,
          occurredOn: data.occurredOn,
          comment: data.comment,
          createdByUserId: data.createdByUserId,
          updatedByUserId: data.updatedByUserId,
        },
        select: envelopeReallocationSelect,
      }),
    ]);
    await tx.auditEvent.create({
      data: auditCreate(budget.workspaceId, record, userId, requestId, 'CREATED'),
    });
    return this.withConsequences(tx, record);
  }

  async markDeleted(
    tx: Prisma.TransactionClient,
    current: EnvelopeReallocationRecord,
    userId: string,
    requestId?: string,
  ): Promise<EnvelopeReallocationRecord> {
    const record = await tx.envelopeReallocation.update({
      where: { id: current.id },
      data: { status: 'DELETED', deletedAt: new Date(), updatedByUserId: userId },
      select: envelopeReallocationSelect,
    });
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: current.budgetId },
      select: { workspaceId: true },
    });
    await tx.auditEvent.create({
      data: auditCreate(budget.workspaceId, record, userId, requestId, 'DELETED', current),
    });
    return this.withConsequences(tx, record);
  }

  private async withConsequences(
    tx: Prisma.TransactionClient,
    row: Omit<
      EnvelopeReallocationRecord,
      'sourceEnvelopeCurrentBalanceMinor' | 'destinationEnvelopeCurrentBalanceMinor'
    >,
  ): Promise<EnvelopeReallocationRecord> {
    const [sourceEnvelopeCurrentBalanceMinor, destinationEnvelopeCurrentBalanceMinor] =
      await Promise.all([
        this.balances.envelopeBalance(tx, row.budgetId, row.sourceEnvelopeId),
        this.balances.envelopeBalance(tx, row.budgetId, row.destinationEnvelopeId),
      ]);
    return { ...row, sourceEnvelopeCurrentBalanceMinor, destinationEnvelopeCurrentBalanceMinor };
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

type EnvelopeReallocationAuditRecord = Pick<
  EnvelopeReallocationRecord,
  | 'id'
  | 'budgetId'
  | 'status'
  | 'sourceEnvelopeId'
  | 'destinationEnvelopeId'
  | 'amountMinor'
  | 'occurredOn'
>;

function auditValues(record: EnvelopeReallocationAuditRecord) {
  return {
    status: record.status,
    sourceEnvelopeId: record.sourceEnvelopeId,
    destinationEnvelopeId: record.destinationEnvelopeId,
    amountMinor: record.amountMinor.toString(),
    occurredOn: record.occurredOn.toISOString().slice(0, 10),
  };
}

function auditCreate(
  workspaceId: string,
  record: EnvelopeReallocationAuditRecord,
  userId: string,
  requestId: string | undefined,
  action: string,
  previous?: EnvelopeReallocationRecord,
) {
  return {
    id: createUuidV7(),
    actorUserId: userId,
    workspaceId,
    budgetId: record.budgetId,
    entityType: 'envelope_reallocation',
    entityId: record.id,
    action,
    source: 'API',
    requestId: requestId ?? null,
    ...(previous ? { oldValues: auditValues(previous) } : {}),
    newValues: auditValues(record),
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

const envelopeReallocationSelect = {
  id: true,
  budgetId: true,
  status: true,
  sourceEnvelopeId: true,
  destinationEnvelopeId: true,
  amountMinor: true,
  currency: true,
  scale: true,
  occurredOn: true,
  comment: true,
  deletedAt: true,
  createdAt: true,
} as const;
