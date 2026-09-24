import { describe, expect, it } from 'vitest';

import { groupByActive } from './group-by-active.js';
import type { RegularPlanDto } from '../../composables/useBudgetReferenceData.js';

function plan(overrides: Partial<RegularPlanDto>): RegularPlanDto {
  return {
    id: 'plan-id',
    budgetId: 'budget-id',
    name: 'План',
    planType: 'EXPENSE',
    amountMinor: '100000',
    currency: 'RUB',
    scale: 2,
    anchorOn: '2026-09-01',
    startOn: '2026-09-01',
    endOn: null,
    recurrence: 'MONTHLY',
    intervalMonths: null,
    accountId: null,
    categoryId: 'category-id',
    envelopeId: 'envelope-id',
    comment: null,
    isActive: true,
    disabledAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('groupByActive', () => {
  it('splits plans into an active group and an inactive group, each sorted by name', () => {
    const plans = [
      plan({ id: 'b', name: 'Б план', isActive: true }),
      plan({ id: 'a', name: 'А план', isActive: true }),
      plan({ id: 'c', name: 'В план', isActive: false }),
    ];

    const groups = groupByActive(plans);

    expect(groups).toEqual([
      { active: true, label: 'Активные', items: [plans[1], plans[0]] },
      { active: false, label: 'Отключённые', items: [plans[2]] },
    ]);
  });

  it('omits a group with no plans', () => {
    const groups = groupByActive([plan({ id: 'a', isActive: true })]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.active).toBe(true);
  });
});
