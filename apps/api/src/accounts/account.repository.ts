import { Prisma, type AccountType } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { duplicateName } from '../common/reference-data/reference-data.errors.js';
import type { ReferenceDataStatus } from '../common/reference-data/reference-data.types.js';
import { PrismaService } from '../database/prisma.service.js';

export interface AccountRecord {
  id: string;
  budgetId: string;
  name: string;
  accountType: AccountType;
  bankName: string | null;
  lastFourDigits: string | null;
  currency: string;
  scale: number;
  startingBalanceMinor: bigint;
  accountingStartDate: Date;
  comment: string | null;
  archivedAt: Date | null;
  currentBalanceMinor: bigint;
}

export interface AccountCreateData {
  budgetId: string;
  name: string;
  accountType: AccountType;
  bankName: string | null;
  lastFourDigits: string | null;
  currency: 'RUB';
  startingBalanceMinor: bigint;
  accountingStartDate: Date;
  comment: string | null;
}

export interface AccountUpdateData {
  name?: string;
  accountType?: AccountType;
  bankName?: string | null;
  lastFourDigits?: string | null;
  startingBalanceMinor?: bigint;
  accountingStartDate?: Date;
  comment?: string | null;
}

export class AccountRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances = new FinancialBalanceRepository(),
  ) {}

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
    status: ReferenceDataStatus,
  ): Promise<AccountRecord[]> {
    return this.prisma.$transaction(async (tx) => {
      const accounts = await tx.account.findMany({
        where: {
          budgetId,
          ...archiveWhere(status),
          budget: activeBudgetWhere(userId, budgetId),
        },
        select: accountSelect,
        orderBy: { createdAt: 'asc' },
      });
      return this.withCurrentBalances(tx, accounts);
    });
  }

  async find(userId: string, budgetId: string, accountId: string): Promise<AccountRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.account.findFirst({
        where: { id: accountId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
        select: accountSelect,
      });
      return account ? this.withCurrentBalance(tx, account) : null;
    });
  }

  async create(
    userId: string,
    input: AccountCreateData,
    requestId?: string,
  ): Promise<AccountRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const budget = await tx.budget.findFirst({
          where: activeOwnerBudgetWhere(userId, input.budgetId),
          select: { workspaceId: true },
        });
        if (!budget) return null;
        const account = await tx.account.create({
          data: { id: createUuidV7(), ...input },
          select: accountSelect,
        });
        await tx.auditEvent.create({
          data: {
            id: createUuidV7(),
            actorUserId: userId,
            workspaceId: budget.workspaceId,
            budgetId: input.budgetId,
            entityType: 'account',
            entityId: account.id,
            action: 'CREATED',
            source: 'API',
            requestId: requestId ?? null,
            newValues: auditValues(account),
          },
        });
        return this.withCurrentBalance(tx, account);
      });
    } catch (error) {
      throwDuplicateName(error);
    }
  }

  async update(
    userId: string,
    budgetId: string,
    accountId: string,
    input: AccountUpdateData,
    requestId?: string,
  ): Promise<AccountRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.account.findFirst({
          where: {
            id: accountId,
            budgetId,
            archivedAt: null,
            budget: activeOwnerBudgetWhere(userId, budgetId),
          },
          select: accountSelect,
        });
        if (!current) return null;
        const budget = await tx.budget.findUniqueOrThrow({
          where: { id: budgetId },
          select: { workspaceId: true },
        });
        const account = await tx.account.update({
          where: { id: accountId },
          data: input,
          select: accountSelect,
        });
        await tx.auditEvent.create({
          data: {
            id: createUuidV7(),
            actorUserId: userId,
            workspaceId: budget.workspaceId,
            budgetId,
            entityType: 'account',
            entityId: account.id,
            action: 'UPDATED',
            source: 'API',
            requestId: requestId ?? null,
            oldValues: auditValues(current),
            newValues: auditValues(account),
          },
        });
        return this.withCurrentBalance(tx, account);
      });
    } catch (error) {
      throwDuplicateName(error);
    }
  }

  async archive(
    userId: string,
    budgetId: string,
    accountId: string,
    requestId?: string,
  ): Promise<AccountRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.account.findFirst({
        where: { id: accountId, budgetId, budget: activeOwnerBudgetWhere(userId, budgetId) },
        select: accountSelect,
      });
      if (!current) return null;
      if (current.archivedAt) return this.withCurrentBalance(tx, current);
      const account = await tx.account.update({
        where: { id: accountId },
        data: { archivedAt: new Date() },
        select: accountSelect,
      });
      const budget = await tx.budget.findUniqueOrThrow({
        where: { id: budgetId },
        select: { workspaceId: true },
      });
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: userId,
          workspaceId: budget.workspaceId,
          budgetId,
          entityType: 'account',
          entityId: account.id,
          action: 'ARCHIVED',
          source: 'API',
          requestId: requestId ?? null,
          oldValues: auditValues(current),
          newValues: auditValues(account),
        },
      });
      return this.withCurrentBalance(tx, account);
    });
  }

  private async withCurrentBalances(
    tx: Prisma.TransactionClient,
    accounts: Array<Omit<AccountRecord, 'currentBalanceMinor'>>,
  ): Promise<AccountRecord[]> {
    return Promise.all(accounts.map((account) => this.withCurrentBalance(tx, account)));
  }

  private async withCurrentBalance(
    tx: Prisma.TransactionClient,
    account: Omit<AccountRecord, 'currentBalanceMinor'>,
  ): Promise<AccountRecord> {
    return {
      ...account,
      currentBalanceMinor: await this.balances.accountBalance(tx, account.budgetId, account.id),
    };
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

function activeOwnerBudgetWhere(userId: string, budgetId: string) {
  return {
    ...activeBudgetWhere(userId, budgetId),
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true, role: 'OWNER' as const } },
    },
  };
}

function archiveWhere(status: ReferenceDataStatus) {
  if (status === 'active') return { archivedAt: null };
  if (status === 'archived') return { archivedAt: { not: null } };
  return {};
}

function auditValues(account: Omit<AccountRecord, 'currentBalanceMinor'>) {
  return {
    name: account.name,
    accountType: account.accountType,
    bankName: account.bankName,
    currency: account.currency,
    scale: account.scale,
    startingBalanceMinor: account.startingBalanceMinor.toString(),
    accountingStartDate: account.accountingStartDate.toISOString().slice(0, 10),
    archivedAt: account.archivedAt?.toISOString() ?? null,
  };
}

function throwDuplicateName(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw duplicateName();
  }
  throw error;
}

const accountSelect = {
  id: true,
  budgetId: true,
  name: true,
  accountType: true,
  bankName: true,
  lastFourDigits: true,
  currency: true,
  scale: true,
  startingBalanceMinor: true,
  accountingStartDate: true,
  comment: true,
  archivedAt: true,
} as const;
