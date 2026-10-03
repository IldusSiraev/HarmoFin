import { Prisma, type IncomeAllocationStatus } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export interface IncomeAllocationRecord {
  id: string;
  budgetId: string;
  incomeTransactionId: string;
  status: IncomeAllocationStatus;
  amountMinor: bigint;
  currency: string;
  scale: number;
  occurredOn: Date;
  accountId: string;
  envelopeId: string;
  comment: string | null;
  deletedAt: Date | null;
  preDeleteStatus: IncomeAllocationStatus | null;
}

export class IncomeAllocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async delete(
    tx: Prisma.TransactionClient,
    current: IncomeAllocationRecord,
    userId: string,
    requestId?: string,
  ): Promise<IncomeAllocationRecord> {
    const allocation = await tx.incomeAllocation.update({
      where: { id: current.id },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
        preDeleteStatus: current.status,
        updatedByUserId: userId,
      },
      select: allocationSelect,
    });
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: current.budgetId },
      select: { workspaceId: true },
    });
    await tx.auditEvent.create({
      data: auditCreate(
        budget.workspaceId,
        current.budgetId,
        allocation,
        userId,
        requestId,
        'DELETED',
        current,
      ),
    });
    return allocation;
  }

  async cancel(
    tx: Prisma.TransactionClient,
    current: IncomeAllocationRecord,
    userId: string,
    requestId?: string,
  ): Promise<IncomeAllocationRecord> {
    const allocation = await tx.incomeAllocation.update({
      where: { id: current.id },
      data: { status: 'CANCELLED', updatedByUserId: userId },
      select: allocationSelect,
    });
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: current.budgetId },
      select: { workspaceId: true },
    });
    await tx.auditEvent.create({
      data: auditCreate(
        budget.workspaceId,
        current.budgetId,
        allocation,
        userId,
        requestId,
        'CANCELLED',
        current,
      ),
    });
    return allocation;
  }

  async findForMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    allocationId: string,
  ): Promise<IncomeAllocationRecord | null> {
    await tx.$queryRaw`
      SELECT "id" FROM "income_allocations"
      WHERE "id" = ${allocationId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    const allocation = await tx.incomeAllocation.findFirst({
      where: { id: allocationId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: allocationSelect,
    });
    return allocation;
  }
}

function activeBudgetWhere(userId: string, budgetId: string) {
  return {
    id: budgetId,
    status: 'ACTIVE' as const,
    workspace: { status: 'ACTIVE' as const, memberships: { some: { userId, isActive: true } } },
  };
}

function auditValues(allocation: IncomeAllocationRecord) {
  return {
    amountMinor: allocation.amountMinor.toString(),
    occurredOn: allocation.occurredOn.toISOString().slice(0, 10),
    incomeTransactionId: allocation.incomeTransactionId,
    accountId: allocation.accountId,
    envelopeId: allocation.envelopeId,
    status: allocation.status,
    preDeleteStatus: allocation.preDeleteStatus,
  };
}

function auditCreate(
  workspaceId: string,
  budgetId: string,
  allocation: IncomeAllocationRecord,
  userId: string,
  requestId: string | undefined,
  action: string,
  previous?: IncomeAllocationRecord,
) {
  return {
    id: createUuidV7(),
    actorUserId: userId,
    workspaceId,
    budgetId,
    entityType: 'income_allocation',
    entityId: allocation.id,
    action,
    source: 'API',
    requestId: requestId ?? null,
    ...(previous ? { oldValues: auditValues(previous) } : {}),
    newValues: auditValues(allocation),
  };
}

const allocationSelect = {
  id: true,
  budgetId: true,
  incomeTransactionId: true,
  status: true,
  amountMinor: true,
  currency: true,
  scale: true,
  occurredOn: true,
  accountId: true,
  envelopeId: true,
  comment: true,
  deletedAt: true,
  preDeleteStatus: true,
} as const;
