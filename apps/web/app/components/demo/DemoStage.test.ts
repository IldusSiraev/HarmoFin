import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { demoPeriodDates } from '../../data/demo-period-dates.js';
import { demoSnapshot } from '../../data/demo-scenario.js';
import DemoStage from './DemoStage.vue';

const dates = demoPeriodDates(10, 15);
const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };
const choices = { split: 'suggested' as const, leftover: 'save' as const };

function mountStage(step: number) {
  return mount(DemoStage, {
    props: {
      step,
      snapshot: demoSnapshot(step, choices)!,
      dates,
      asOf: dates.shoppingTo,
      caption: 'Подпись шага',
      cycle: { start: 10, offset: 15 },
    },
    global: { stubs },
  });
}

describe('demo stage', () => {
  it('wraps the app components in an inert showcase with the step caption', () => {
    const wrapper = mountStage(3);
    expect(wrapper.find('[inert]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Подпись шага');
  });

  it('shows the cycle preview on step 0 and app components afterwards', () => {
    expect(mountStage(0).findComponent({ name: 'SettingsCyclePreview' }).exists()).toBe(true);
    const step2 = mountStage(2);
    expect(step2.findAllComponents({ name: 'EnvelopePlanRow' })).toHaveLength(4);
    expect(step2.findComponent({ name: 'AvailableBudgetCard' }).exists()).toBe(true);
  });

  it('shows upcoming payments on step 3 and the goal progress on step 6', () => {
    expect(mountStage(3).text()).toContain('Детский сад');
    expect(mountStage(6).findComponent({ name: 'GoalProgressReport' }).exists()).toBe(true);
  });

  it('never shows a per-day spending figure', () => {
    for (const step of [1, 2, 3, 4, 5, 6]) expect(mountStage(step).text()).not.toMatch(/в день/);
  });
});
