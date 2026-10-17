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
    });

    expect(wrapper.get('h2').text()).toBe('Накопления');
    const goals = wrapper.findAll('[data-goal]');
    expect(goals).toHaveLength(1);
    expect(wrapper.text()).toContain('250,00');
    expect(wrapper.text()).toContain('Просрочено');
    expect(wrapper.text()).toContain('2');
    expect(wrapper.text()).toContain('Отложено');
  });

  it('пустой список целей показывает подсказку', () => {
    const wrapper = mount(GoalProgressReport, { props: { rows: [] } });
    expect(wrapper.text()).toContain('Нет конвертов «Накопления».');
    expect(wrapper.find('[data-goal]').exists()).toBe(false);
  });
});
