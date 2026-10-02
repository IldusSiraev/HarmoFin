import { todayInTimezone } from '../../cycles/cycle-period.domain.js';

/** Budget created by the API starts in plan model 2 (timezone is the budget's own, default included). */
export const NEW_BUDGET_TIMEZONE = 'Europe/Moscow';

export function newBudgetModelData(now: Date = new Date(), timezone: string = NEW_BUDGET_TIMEZONE) {
  return {
    planModelVersion: 2,
    planModelActivatedOn: new Date(`${todayInTimezone(now, timezone)}T00:00:00.000Z`),
  };
}
