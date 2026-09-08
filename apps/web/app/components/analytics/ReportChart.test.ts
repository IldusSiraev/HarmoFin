import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReportChart from './ReportChart.vue';

describe('ReportChart', () => {
  it('renders table equivalent for category chart data', () => {
    const wrapper = mount(ReportChart, {
      props: {
        report: {
          key: 'expenses-by-category',
          rows: [
            {
              categoryName: 'Продукты',
              expenseMinor: '2500',
              journalFilters: { categoryId: 'category-id', type: 'EXPENSE' },
            },
          ],
        },
      },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });

    expect(wrapper.get('table').text()).toContain('Продукты');
  });
});
