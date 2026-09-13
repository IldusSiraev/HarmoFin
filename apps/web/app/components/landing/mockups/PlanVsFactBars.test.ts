import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanVsFactBars from './PlanVsFactBars.vue';

const normalize = (value: string): string => value.replace(/[\u00A0\u202F ]/g, ' ');

describe('PlanVsFactBars', () => {
  it('shows a plan bar and a fact bar for every group', () => {
    const wrapper = mount(PlanVsFactBars);

    expect(wrapper.findAll('[data-testid="plan-bar"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-testid="fact-bar"]')).toHaveLength(3);
  });

  it('repeats plan and fact amounts as text', () => {
    const wrapper = mount(PlanVsFactBars);
    const text = normalize(wrapper.text());

    expect(text).toContain('Обязательные');
    expect(text).toContain('План 50 000 ₽');
    expect(text).toContain('Факт 52 000 ₽');
  });
});
