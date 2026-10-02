import { PrismaService } from '../database/prisma.service.js';
import type { CycleSettings } from './cycle-period.domain.js';
import { CycleRevisionRepository } from './cycle-revision.repository.js';

export class CycleRepository {
  private readonly revisions = new CycleRevisionRepository();

  constructor(private readonly prisma: PrismaService) {}

  /** Settings in force on `date`; budgets without revisions resolve to their own fields. */
  settingsAt(budgetId: string, date: string): Promise<CycleSettings | null> {
    return this.revisions.settingsAt(this.prisma, budgetId, date);
  }

  nextEffectiveAfter(budgetId: string, date: string): Promise<string | null> {
    return this.revisions.nextEffectiveAfter(this.prisma, budgetId, date);
  }

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
