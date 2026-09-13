import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import IncomeComparison from './IncomeComparison.vue';

const normalize = (value: string): string => value.replace(/[\u00A0\u202F ]/g, ' ');

describe('IncomeComparison', () => {
  it('compares planned and actual income for both cases', () => {
    const wrapper = mount(IncomeComparison);
    const cards = wrapper.findAll('[data-testid="income-case"]');
    const text = normalize(wrapper.text());

    expect(cards).toHaveLength(2);
    expect(text).toContain('Планировалось');
    expect(text).toContain('100 000 ₽');
    expect(text).toContain('Получено');
    expect(text).toContain('106 000 ₽');
    expect(text).toContain('99 000 ₽');
  });

  it('states the difference in words, not only with colour', () => {
    const wrapper = mount(IncomeComparison);
    const cards = wrapper.findAll('[data-testid="income-case"]');

    expect(normalize(cards[0]?.text() ?? '')).toContain('Больше плана на +6 000 ₽');
    expect(normalize(cards[1]?.text() ?? '')).toContain('Меньше плана на −1 000 ₽');
  });
});
