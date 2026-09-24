import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanKpiRow from './PlanKpiRow.vue';

describe('PlanKpiRow', () => {
  it('renders all four tiles', () => {
    const wrapper = mount(PlanKpiRow, {
      props: {
        plannedIncomeMinor: '1500000',
        plannedExpenseMinor: '6100000',
        balanceMinor: '-4600000',
        totalPlans: 5,
      },
    });

    expect(wrapper.text()).toContain('Плановые доходы');
    expect(wrapper.text()).toContain('Плановые расходы');
    expect(wrapper.text()).toContain('Баланс');
    expect(wrapper.text()).toContain('Всего планов');
    expect(wrapper.text()).toContain('5');
  });
});
