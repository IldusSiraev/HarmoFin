import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardMockup from './DashboardMockup.vue';

const normalize = (value: string): string => value.replace(/[\u00A0 ]/g, ' ');

describe('DashboardMockup', () => {
  it('shows the available amount, the period frame and every envelope', () => {
    const wrapper = mount(DashboardMockup);
    const text = normalize(wrapper.text());

    expect(text).toContain('Можно потратить');
    expect(text).toContain('21 800 ₽');
    expect(text).toContain('Период 25.09 – 09.10');
    expect(text).toContain('Осталось 7 дней');
    expect(text).toContain('63 000 ₽');
    expect(text).toContain('41 200 ₽');
    expect(text).toContain('3 114 ₽');
    expect(text).toContain('Обязательные');
    expect(text).toContain('Свободные');
  });

  it('is hidden from assistive technology as a decorative product preview', () => {
    const wrapper = mount(DashboardMockup);

    expect(wrapper.attributes('aria-hidden')).toBe('true');
  });
});
