import { PrismaService } from '../database/prisma.service.js';
import {
  TransactionRepository,
  type TransactionListQuery,
} from '../transactions/transaction.repository.js';

export class CsvExportRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRepository,
  ) {}

  async findAccessibleWithRole(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: {
        id: true,
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

  validateJournalReferences(budgetId: string, query: TransactionListQuery): Promise<boolean> {
    return this.transactions.validateJournalReferences(budgetId, query);
  }

  listTransactions(userId: string, budgetId: string, query: TransactionListQuery, take: number) {
    return this.transactions.listForExport(userId, budgetId, query, take);
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
