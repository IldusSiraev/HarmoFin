import { PrismaService } from '../database/prisma.service.js';

export class CycleRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccessibleBudget(userId: string, budgetId: string) {
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
        cycleStartDay: true,
        periodBoundaryOffset: true,
        timezone: true,
      },
    });
  }
}
