import { Prisma, type IncomeAllocationStatus } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export interface IncomeRecord {
  id: string;
  budgetId: string;
  transactionType: 'INCOME' | 'EXPENSE';
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'DELETED';
  amountMinor: bigint;
  categoryId: string;
  currency: string;
  scale: number;
}

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
  remainingUnallocatedMinor: bigint;
  envelopeCurrentBalanceMinor: bigint;
}

export interface IncomeAllocationCreateData {
  budgetId: string;
  incomeTransactionId: string;
  amountMinor: bigint;
  occurredOn: Date;
  accountId: string;
  envelopeId: string;
  comment: string | null;
  createdByUserId: string;
  updatedByUserId: string;
}

export interface IncomeAllocationUpdateData {
  amountMinor?: bigint;
  occurredOn?: Date;
  accountId?: string;
  envelopeId?: string;
  comment?: string | null;
  updatedByUserId: string;
}

export class IncomeAllocationRepository {
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
        workspace: {
          select: {
            memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
    });
  }

  async findConfirmedIncome(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeTransactionId: string,
  ): Promise<IncomeRecord | null> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "transactions"
      WHERE "id" = ${incomeTransactionId}::uuid
        AND "budget_id" = ${budgetId}::uuid
        AND "transaction_type" = 'INCOME'
        AND "status" = 'CONFIRMED'
      FOR UPDATE
    `;
    if (locked.length === 0) return null;
    return tx.transaction.findFirst({
      where: { id: incomeTransactionId, budgetId, transactionType: 'INCOME', status: 'CONFIRMED' },
      select: {
        id: true,
        budgetId: true,
        transactionType: true,
        status: true,
        amountMinor: true,
        categoryId: true,
        currency: true,
        scale: true,
      },
    });
  }

  async sumConfirmedForIncome(
    tx: Prisma.TransactionClient,
    budgetId: string,
    incomeTransactionId: string,
  ): Promise<bigint> {
    const result = await tx.incomeAllocation.aggregate({
      where: { budgetId, incomeTransactionId, status: 'CONFIRMED' },
      _sum: { amountMinor: true },
    });
    return result._sum.amountMinor ?? 0n;
  }

  async findActiveTargets(
    tx: Prisma.TransactionClient,
    budgetId: string,
    accountId: string,
    envelopeId: string,
  ) {
    const [account, envelope] = await Promise.all([
      tx.account.findFirst({
        where: { id: accountId, budgetId, archivedAt: null },
        select: { id: true, budgetId: true, archivedAt: true, currency: true, scale: true },
      }),
      tx.envelope.findFirst({
        where: { id: envelopeId, budgetId, archivedAt: null },
        select: { id: true, budgetId: true, archivedAt: true, currency: true, scale: true },
      }),
    ]);
    return { account, envelope };
  }

  async create(
    tx: Prisma.TransactionClient,
    data: IncomeAllocationCreateData,
    userId: string,
    requestId?: string,
  ): Promise<IncomeAllocationRecord> {
    const [budget, allocation] = await Promise.all([
      tx.budget.findUniqueOrThrow({ where: { id: data.budgetId }, select: { workspaceId: true } }),
      tx.incomeAllocation.create({
        data: { id: createUuidV7(), ...data },
        select: allocationSelect,
      }),
    ]);
    await tx.auditEvent.create({
      data: auditCreate(
        budget.workspaceId,
        data.budgetId,
        allocation,
        userId,
        requestId,
        'CREATED',
      ),
    });
    return this.withConsequences(tx, allocation);
  }

  async update(
    tx: Prisma.TransactionClient,
    current: IncomeAllocationRecord,
    data: IncomeAllocationUpdateData,
    userId: string,
    requestId?: string,
  ): Promise<IncomeAllocationRecord> {
    const allocation = await tx.incomeAllocation.update({
      where: { id: current.id },
      data,
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
        'UPDATED',
        current,
      ),
    });
    return this.withConsequences(tx, allocation);
  }

  async delete(
    tx: Prisma.TransactionClient,
    current: IncomeAllocationRecord,
    userId: string,
    requestId?: string,
  ): Promise<IncomeAllocationRecord> {
    const allocation = await tx.incomeAllocation.update({
      where: { id: current.id },
      data: { status: 'DELETED', deletedAt: new Date(), updatedByUserId: userId },
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
    return this.withConsequences(tx, allocation);
  }

  async findForMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    allocationId: string,
  ): Promise<IncomeAllocationRecord | null> {
    const allocation = await tx.incomeAllocation.findFirst({
      where: { id: allocationId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: allocationSelect,
    });
    return allocation ? this.withConsequences(tx, allocation) : null;
  }

  async listForIncome(
    userId: string,
    budgetId: string,
    incomeTransactionId: string,
  ): Promise<IncomeAllocationRecord[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.incomeAllocation.findMany({
        where: { budgetId, incomeTransactionId, budget: activeBudgetWhere(userId, budgetId) },
        select: allocationSelect,
        orderBy: { createdAt: 'asc' },
      });
      return Promise.all(rows.map((row) => this.withConsequences(tx, row)));
    });
  }

  async findBudgetAllocationRule(budgetId: string) {
    const budget = await this.prisma.budget.findFirst({
      where: { id: budgetId, status: 'ACTIVE' },
      select: {
        incomeAllocationRuleEnabled: true,
        incomeAllocationSourceCategoryId: true,
        incomeAllocationTargetEnvelopeId: true,
      },
    });
    return budget
      ? {
          enabled: budget.incomeAllocationRuleEnabled,
          sourceCategoryId: budget.incomeAllocationSourceCategoryId,
          targetEnvelopeId: budget.incomeAllocationTargetEnvelopeId,
        }
      : null;
  }

  async findActiveProposalEnvelope(budgetId: string, envelopeId: string) {
    return this.prisma.envelope.findFirst({
      where: { id: envelopeId, budgetId, archivedAt: null },
      select: { id: true, archivedAt: true },
    });
  }

  private async withConsequences(
    tx: Prisma.TransactionClient,
    allocation: Omit<
      IncomeAllocationRecord,
      'remainingUnallocatedMinor' | 'envelopeCurrentBalanceMinor'
    >,
  ): Promise<IncomeAllocationRecord> {
    const [income, total, envelopeCurrentBalanceMinor] = await Promise.all([
      tx.transaction.findUniqueOrThrow({
        where: { id: allocation.incomeTransactionId },
        select: { amountMinor: true },
      }),
      this.sumConfirmedForIncome(tx, allocation.budgetId, allocation.incomeTransactionId),
      this.balances.envelopeBalance(tx, allocation.budgetId, allocation.envelopeId),
    ]);
    return {
      ...allocation,
      remainingUnallocatedMinor: income.amountMinor - total,
      envelopeCurrentBalanceMinor,
    };
  }
}

function activeBudgetWhere(userId: string, budgetId: string) {
  return {
    id: budgetId,
    status: 'ACTIVE' as const,
    workspace: { status: 'ACTIVE' as const, memberships: { some: { userId, isActive: true } } },
  };
}

function auditValues(
  allocation: Omit<
    IncomeAllocationRecord,
    'remainingUnallocatedMinor' | 'envelopeCurrentBalanceMinor'
  >,
) {
  return {
    amountMinor: allocation.amountMinor.toString(),
    occurredOn: allocation.occurredOn.toISOString().slice(0, 10),
    incomeTransactionId: allocation.incomeTransactionId,
    accountId: allocation.accountId,
    envelopeId: allocation.envelopeId,
    status: allocation.status,
  };
}

function auditCreate(
  workspaceId: string,
  budgetId: string,
  allocation: Omit<
    IncomeAllocationRecord,
    'remainingUnallocatedMinor' | 'envelopeCurrentBalanceMinor'
  >,
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
} as const;
