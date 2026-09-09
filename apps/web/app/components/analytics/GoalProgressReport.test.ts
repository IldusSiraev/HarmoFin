import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import GoalProgressReport from './GoalProgressReport.vue';

describe('GoalProgressReport', () => {
  it('renders exact remaining amount and server deadline progress', () => {
    const wrapper = mount(GoalProgressReport, {
      props: {
        rows: [
          {
            envelopeId: 'envelope-id',
            name: 'Ремонт',
            envelopeType: 'SAVINGS_GOAL',
            currentMinor: '25000',
            targetMinor: '50000',
            targetDate: '2026-09-07',
            remainingMinor: '25000',
            progressPermille: 500,
            isReached: false,
            daysRemaining: -2,
            journalFilters: { envelopeId: 'envelope-id' },
          },
        ],
      },
      global: {
        stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
      },
    });

    expect(wrapper.get('[role="region"]').attributes()).toMatchObject({
      'aria-labelledby': 'goal-progress-title',
      tabindex: '0',
    });
    expect(wrapper.get('progress').attributes()).toMatchObject({ max: '1000', value: '500' });
    expect(wrapper.get('progress').attributes('aria-valuetext')).toContain('500');
    expect(wrapper.text()).toContain('250,00');
    expect(wrapper.text()).toContain('Просрочено');
    expect(wrapper.text()).toContain('2');
  });
});
