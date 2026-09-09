import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ReportFilters } from './report.schemas.js';

export class ReportRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances = new FinancialBalanceRepository(),
  ) {}

  async findAccessible(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: {
        id: true,
        cycleStartDay: true,
        periodBoundaryOffset: true,
        timezone: true,
      },
    });
  }

  async validateReferences(budgetId: string, filters: ReportFilters): Promise<boolean> {
    const [account, category, envelope] = await Promise.all([
      filters.accountId
        ? this.prisma.account.findFirst({
            where: { id: filters.accountId, budgetId },
            select: { id: true },
          })
        : Promise.resolve(true),
      filters.categoryId
        ? this.prisma.category.findFirst({
            where: { id: filters.categoryId, budgetId },
            select: { id: true },
          })
        : Promise.resolve(true),
      filters.envelopeId
        ? this.prisma.envelope.findFirst({
            where: { id: filters.envelopeId, budgetId },
            select: { id: true },
          })
        : Promise.resolve(true),
    ]);
    return Boolean(account && category && envelope);
  }

  async transactions(budgetId: string, filters: ReportFilters) {
    return this.prisma.transaction.findMany({
      where: {
        budgetId,
        status: 'CONFIRMED',
        ...(filters.type ? { transactionType: filters.type } : {}),
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.envelopeId ? { envelopeId: filters.envelopeId } : {}),
        ...(filters.from || filters.to
          ? {
              occurredOn: {
                ...(filters.from ? { gte: dateValue(filters.from) } : {}),
                ...(filters.to ? { lte: dateValue(filters.to) } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        transactionType: true,
        amountMinor: true,
        occurredOn: true,
        accountId: true,
        categoryId: true,
        envelopeId: true,
        category: { select: { name: true } },
      },
      orderBy: [{ occurredOn: 'asc' }, { id: 'asc' }],
    });
  }

  async transferParts(budgetId: string, filters: ReportFilters) {
    return this.prisma.transferPart.findMany({
      where: {
        budgetId,
        transfer: {
          budgetId,
          status: 'CONFIRMED',
          ...(filters.from || filters.to
            ? {
                occurredOn: {
                  ...(filters.from ? { gte: dateValue(filters.from) } : {}),
                  ...(filters.to ? { lte: dateValue(filters.to) } : {}),
                },
              }
            : {}),
        },
        AND: [
          ...(filters.accountId
            ? [
                {
                  OR: [
                    { sourceAccountId: filters.accountId },
                    { destinationAccountId: filters.accountId },
                  ],
                },
              ]
            : []),
          ...(filters.envelopeId
            ? [
                {
                  OR: [
                    { sourceEnvelopeId: filters.envelopeId },
                    { destinationEnvelopeId: filters.envelopeId },
                  ],
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        amountMinor: true,
        sourceEnvelopeId: true,
        destinationEnvelopeId: true,
        transfer: { select: { occurredOn: true } },
      },
    });
  }

  async accountBalances(budgetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const accounts = await tx.account.findMany({
        where: { budgetId, archivedAt: null },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      });
      return Promise.all(
        accounts.map(async (account) => ({
          ...account,
          balanceMinor: await this.balances.accountBalance(tx, budgetId, account.id),
        })),
      );
    });
  }

  async envelopeBalances(budgetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const envelopes = await tx.envelope.findMany({
        where: { budgetId, archivedAt: null },
        select: {
          id: true,
          name: true,
          envelopeType: true,
          targetAmountMinor: true,
          targetDate: true,
        },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      });
      return Promise.all(
        envelopes.map(async (envelope) => ({
          ...envelope,
          balanceMinor: await this.balances.envelopeBalance(tx, budgetId, envelope.id),
        })),
      );
    });
  }

  async savingsGoals(budgetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const envelopes = await tx.envelope.findMany({
        where: { budgetId, archivedAt: null, targetAmountMinor: { not: null } },
        select: {
          id: true,
          name: true,
          envelopeType: true,
          targetAmountMinor: true,
          targetDate: true,
        },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      });
      return Promise.all(
        envelopes.map(async (envelope) => ({
          ...envelope,
          targetAmountMinor: envelope.targetAmountMinor as bigint,
          balanceMinor: await this.balances.envelopeBalance(tx, budgetId, envelope.id),
        })),
      );
    });
  }

  async planOccurrences(budgetId: string, filters: ReportFilters) {
    return this.prisma.planOccurrence.findMany({
      where: {
        budgetId,
        planType: { in: ['INCOME', 'EXPENSE'] },
        status: { not: 'CANCELLED' },
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.envelopeId ? { envelopeId: filters.envelopeId } : {}),
        ...(filters.from || filters.to
          ? {
              scheduledOn: {
                ...(filters.from ? { gte: dateValue(filters.from) } : {}),
                ...(filters.to ? { lte: dateValue(filters.to) } : {}),
              },
            }
          : {}),
      },
      select: {
        planId: true,
        planName: true,
        planType: true,
        amountMinor: true,
        status: true,
        accountId: true,
        categoryId: true,
        envelopeId: true,
        transaction: { select: { status: true, amountMinor: true } },
      },
    });
  }
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
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
