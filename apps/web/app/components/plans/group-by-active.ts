import type { RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

export interface PlanGroup {
  active: boolean;
  label: string;
  items: RegularPlanDto[];
}

export function groupByActive(plans: ReadonlyArray<RegularPlanDto>): PlanGroup[] {
  return [true, false].flatMap((active) => {
    const items = plans
      .filter((plan) => plan.isActive === active)
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    if (items.length === 0) return [];
    return [{ active, label: active ? 'Активные' : 'Отключённые', items }];
  });
}
