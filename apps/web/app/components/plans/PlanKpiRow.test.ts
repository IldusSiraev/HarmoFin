import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanKpiRow from './PlanKpiRow.vue';

const totals = {
  plannedIncomeMinor: '10000000',
  plannedExpenseMinor: '4300000',
  balanceMinor: '5700000',
  activePlanCount: 3,
};
const norm = (value: string) => value.replace(/\s/g, ' ');

describe('PlanKpiRow', () => {
  it('shows four tiles with server values and the plan-month wording', () => {
    const wrapper = mount(PlanKpiRow, { props: { totals } });
    expect(norm(wrapper.get('[data-testid="kpi-planned-income"]').text())).toContain('100 000,00');
    expect(norm(wrapper.get('[data-testid="kpi-planned-expense"]').text())).toContain('43 000,00');
    expect(norm(wrapper.get('[data-testid="kpi-balance"]').text())).toContain('57 000,00');
    expect(wrapper.get('[data-testid="kpi-total-plans"]').text()).toContain('3');
    expect(wrapper.text()).toContain('Плановые доходы');
    expect(wrapper.text()).toContain('Плановые расходы');
    expect(wrapper.text()).toContain('Баланс');
    expect(wrapper.text()).toContain('Всего планов');
    expect(wrapper.text()).toContain('План месяца');
  });

  it('keeps a negative balance readable', () => {
    const wrapper = mount(PlanKpiRow, { props: { totals: { ...totals, balanceMinor: '-500' } } });
    expect(norm(wrapper.get('[data-testid="kpi-balance"]').text())).toContain('5,00');
  });
});
