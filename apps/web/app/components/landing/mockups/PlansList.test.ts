import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlansList from './PlansList.vue';

const normalize = (value: string): string => value.replace(/[\u00A0\u202F ]/g, ' ');

describe('PlansList', () => {
  it('lists upcoming obligations with dates and amounts', () => {
    const wrapper = mount(PlansList);
    const rows = wrapper.findAll('[data-testid="plan-row"]');
    const text = normalize(wrapper.text());

    expect(rows).toHaveLength(5);
    expect(text).toContain('20 сентября');
    expect(text).toContain('Подписки');
    expect(text).toContain('3 000 ₽');
    expect(text).toContain('Ипотека');
    expect(text).toContain('36 000 ₽');
  });

  it('shows how much money the plans reserve', () => {
    const wrapper = mount(PlansList);

    expect(normalize(wrapper.text())).toContain('На обязательства');
    expect(normalize(wrapper.text())).toContain('52 000 ₽');
  });
});
