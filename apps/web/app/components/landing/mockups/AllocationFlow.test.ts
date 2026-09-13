import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AllocationFlow from './AllocationFlow.vue';

const normalize = (value: string): string => value.replace(/[\u00A0\u202F ]/g, ' ');

describe('AllocationFlow', () => {
  it('shows the income and every allocation it feeds', () => {
    const wrapper = mount(AllocationFlow);
    const text = normalize(wrapper.text());

    expect(text).toContain('Зарплата');
    expect(text).toContain('106 000 ₽');
    expect(text).toContain('Обязательные');
    expect(text).toContain('50 000 ₽');
    expect(text).toContain('Текущие 25–9');
    expect(text).toContain('36 000 ₽');
    expect(text).toContain('Ремонт');
    expect(text).toContain('20 000 ₽');
  });

  it('states that allocations never exceed the income', () => {
    const wrapper = mount(AllocationFlow);

    expect(normalize(wrapper.text())).toContain('Распределено 106 000 ₽ из 106 000 ₽');
  });
});
