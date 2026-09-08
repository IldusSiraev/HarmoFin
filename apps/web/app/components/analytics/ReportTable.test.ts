import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReportTable from './ReportTable.vue';

describe('ReportTable', () => {
  it('uses server journal filters for report-row navigation', () => {
    const wrapper = mount(ReportTable, {
      props: {
        rows: [
          {
            categoryName: 'Продукты',
            expenseMinor: '2500',
            journalFilters: { categoryId: 'category-id', type: 'EXPENSE' },
          },
        ],
      },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });

    expect(wrapper.get('[data-journal-link]').attributes('href')).toContain(
      'categoryId=category-id',
    );
    expect(wrapper.text()).toContain('Продукты');
  });
});
