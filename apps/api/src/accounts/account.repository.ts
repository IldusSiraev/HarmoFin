import { Prisma, type AccountType } from '@prisma/client';

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
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.account.findMany({
      where: {
        budgetId,
        ...archiveWhere(status),
        budget: activeBudgetWhere(userId, budgetId),
      },
      select: accountSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async find(userId: string, budgetId: string, accountId: string): Promise<AccountRecord | null> {
    return this.prisma.account.findFirst({
      where: { id: accountId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: accountSelect,
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
        return account;
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
        return account;
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
      if (current.archivedAt) return current;
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
      return account;
    });
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

function auditValues(account: AccountRecord) {
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
