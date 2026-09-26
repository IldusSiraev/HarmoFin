import { describe, expect, it } from 'vitest';

import { computePlanKpi } from './plan-kpi.js';

describe('computePlanKpi', () => {
  it('sums income and expense/savings occurrences separately and nets the balance', () => {
    const kpi = computePlanKpi(
      [
        { planType: 'INCOME', amountMinor: '1500000', status: 'PENDING' },
        { planType: 'EXPENSE', amountMinor: '3600000', status: 'DUE' },
        { planType: 'SAVINGS', amountMinor: '2500000', status: 'PENDING' },
      ],
      5,
    );

    expect(kpi).toEqual({
      plannedIncomeMinor: '1500000',
      plannedExpenseMinor: '6100000',
      balanceMinor: '-4600000',
      totalPlans: 5,
    });
  });

  it('excludes cancelled occurrences', () => {
    const kpi = computePlanKpi(
      [{ planType: 'EXPENSE', amountMinor: '100000', status: 'CANCELLED' }],
      0,
    );

    expect(kpi.plannedExpenseMinor).toBe('0');
  });
});
