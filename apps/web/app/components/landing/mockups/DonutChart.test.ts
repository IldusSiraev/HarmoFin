import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DonutChart from './DonutChart.vue';

describe('DonutChart', () => {
  it('draws one arc per category with cumulative offsets', () => {
    const wrapper = mount(DonutChart);
    const arcs = wrapper.findAll('[data-testid="donut-arc"]');

    expect(arcs).toHaveLength(6);
    expect(arcs[0]?.attributes('stroke-dasharray')).toBe('90.48 376.99');
    expect(arcs[0]?.attributes('stroke-dashoffset')).toBe('0');
    expect(arcs[1]?.attributes('stroke-dashoffset')).toBe('-90.48');
  });

  it('summarises the chart for screen readers and repeats values in the legend', () => {
    const wrapper = mount(DonutChart);
    const svg = wrapper.get('svg');

    expect(svg.attributes('role')).toBe('img');
    expect(svg.attributes('aria-label')).toBe(
      'Расходы по категориям: Продукты 24 %, Жильё 21 %, Дети 14 %, Автомобиль 10 %, Досуг 8 %, Прочее 23 %',
    );
    expect(wrapper.findAll('[data-testid="donut-legend-item"]')).toHaveLength(6);
    expect(wrapper.text()).toContain('Продукты');
    expect(wrapper.text()).toContain('24 %');
  });
});
