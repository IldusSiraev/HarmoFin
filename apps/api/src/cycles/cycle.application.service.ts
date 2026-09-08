import { Injectable } from '@nestjs/common';

import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { cycleAndPeriodFor, todayInTimezone, type CycleAndPeriod } from './cycle-period.domain.js';
import { CycleRepository } from './cycle.repository.js';

@Injectable()
export class CycleApplicationService {
  constructor(private readonly repository: CycleRepository) {}

  async current(userId: string, budgetId: string): Promise<CycleAndPeriod> {
    const budget = await this.requireAccessibleBudget(userId, budgetId);
    return cycleAndPeriodFor(budget, todayInTimezone(new Date(), budget.timezone));
  }

  async selected(userId: string, budgetId: string, date: string): Promise<CycleAndPeriod> {
    const budget = await this.requireAccessibleBudget(userId, budgetId);
    return cycleAndPeriodFor(budget, date);
  }

  private async requireAccessibleBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleBudget(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return budget;
  }
}
