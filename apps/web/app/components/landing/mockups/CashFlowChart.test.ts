import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CashFlowChart from './CashFlowChart.vue';

const normalize = (value: string): string => value.replace(/[\u00A0\u202F]/g, ' ');

describe('CashFlowChart', () => {
  it('draws one polyline per series across every month', () => {
    const wrapper = mount(CashFlowChart);
    const income = wrapper.get('[data-testid="cash-flow-income"]');
    const expense = wrapper.get('[data-testid="cash-flow-expense"]');

    expect(income.attributes('points')?.split(' ')).toHaveLength(6);
    expect(expense.attributes('points')?.split(' ')).toHaveLength(6);
    expect(income.attributes('points')?.startsWith('20,')).toBe(true);
  });

  it('labels the chart and both series in text', () => {
    const wrapper = mount(CashFlowChart);

    expect(normalize(wrapper.get('svg').attributes('aria-label') ?? '')).toBe(
      'Денежный поток за шесть месяцев: доходы от 98 000 ₽ до 112 000 ₽, расходы от 82 000 ₽ до 96 000 ₽',
    );
    expect(wrapper.text()).toContain('Доходы');
    expect(wrapper.text()).toContain('Расходы');
    expect(wrapper.text()).toContain('Сен');
  });
});
