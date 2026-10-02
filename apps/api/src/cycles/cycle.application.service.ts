import { Injectable } from '@nestjs/common';

import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import {
  cycleAndPeriodFor,
  todayInTimezone,
  type CycleAndPeriod,
  type CycleSettings,
} from './cycle-period.domain.js';
import { clipAtNextRevision } from './cycle-settings-at.js';
import { CycleRepository } from './cycle.repository.js';

@Injectable()
export class CycleApplicationService {
  constructor(private readonly repository: CycleRepository) {}

  async current(userId: string, budgetId: string): Promise<CycleAndPeriod> {
    const budget = await this.requireAccessibleBudget(userId, budgetId);
    return this.at(budgetId, budget, todayInTimezone(new Date(), budget.timezone));
  }

  async selected(userId: string, budgetId: string, date: string): Promise<CycleAndPeriod> {
    const budget = await this.requireAccessibleBudget(userId, budgetId);
    return this.at(budgetId, budget, date);
  }

  private async at(budgetId: string, budget: CycleSettings, date: string): Promise<CycleAndPeriod> {
    const settings = (await this.repository.settingsAt(budgetId, date)) ?? budget;
    const next = await this.repository.nextEffectiveAfter(budgetId, date);
    return clipAtNextRevision(cycleAndPeriodFor(settings, date), date, next);
  }

  private async requireAccessibleBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleBudget(userId, budgetId);
    if (!budget) throw resourceNotFound();
    return budget;
  }
}
