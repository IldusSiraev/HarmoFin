import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanVsActualReport from './PlanVsActualReport.vue';

describe('PlanVsActualReport', () => {
  it('renders exact server values and confirmed journal link', () => {
    const wrapper = mount(PlanVsActualReport, {
      props: {
        rows: [
          {
            planId: 'plan-id',
            planName: 'Ипотека',
            planType: 'EXPENSE',
            plannedMinor: '300000',
            actualMinor: '170000',
            varianceMinor: '-130000',
            plannedOccurrenceCount: 2,
            confirmedOccurrenceCount: 1,
            journalFilters: { planId: 'plan-id', status: 'CONFIRMED' },
          },
        ],
      },
      global: {
        stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
      },
    });

    expect(wrapper.get('[role="region"]').attributes()).toMatchObject({
      'aria-labelledby': 'plan-vs-actual-title',
      tabindex: '0',
    });
    expect(wrapper.get('table').text()).toContain('Ипотека');
    expect(wrapper.text()).toContain('3 000,00');
    expect(wrapper.text()).toContain('1 700,00');
    expect(wrapper.text()).toContain('-1 300,00');
    expect(wrapper.get('[data-journal-link]').attributes('href')).toBe(
      '/app/operations?planId=plan-id&status=CONFIRMED',
    );
  });

  it('renders Russian empty state', () => {
    const wrapper = mount(PlanVsActualReport, { props: { rows: [] } });

    expect(wrapper.text()).toContain('Нет плановых операций');
  });
});
