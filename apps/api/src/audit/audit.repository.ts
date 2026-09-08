import { PrismaService } from '../database/prisma.service.js';

export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccessibleWithRole(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: {
        id: budgetId,
        status: 'ACTIVE',
        workspace: {
          status: 'ACTIVE',
          memberships: { some: { userId, isActive: true } },
        },
      },
      select: {
        workspace: {
          select: {
            memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
    });
  }

  findAccessibleTransaction(userId: string, budgetId: string, transactionId: string) {
    return this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        budgetId,
        budget: {
          id: budgetId,
          status: 'ACTIVE',
          workspace: {
            status: 'ACTIVE',
            memberships: { some: { userId, isActive: true } },
          },
        },
      },
      select: { id: true },
    });
  }

  listForTransaction(budgetId: string, transactionId: string) {
    return this.prisma.auditEvent.findMany({
      where: { budgetId, entityType: 'transaction', entityId: transactionId },
      select: {
        id: true,
        createdAt: true,
        entityType: true,
        entityId: true,
        action: true,
        source: true,
        oldValues: true,
        newValues: true,
        actor: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });
  }
}
