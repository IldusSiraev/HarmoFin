import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LandingProgress from './LandingProgress.vue';

const normalize = (value: string): string => value.replace(/[\u00A0 ]/g, ' ');

describe('LandingProgress', () => {
  it('exposes progress to assistive technology and shows both amounts as text', () => {
    const wrapper = mount(LandingProgress, {
      props: { label: 'Ремонт', valueMinor: '7000000', targetMinor: '12000000' },
    });

    const bar = wrapper.get('[role="progressbar"]');
    expect(bar.attributes('aria-valuenow')).toBe('58');
    expect(bar.attributes('aria-valuemin')).toBe('0');
    expect(bar.attributes('aria-valuemax')).toBe('100');
    expect(normalize(bar.attributes('aria-label') ?? '')).toBe('Ремонт: 70 000 ₽ из 120 000 ₽');
    expect(normalize(wrapper.text())).toContain('70 000 ₽ из 120 000 ₽');
  });

  it('never reports more than one hundred percent', () => {
    const wrapper = mount(LandingProgress, {
      props: { label: 'Отпуск', valueMinor: '12000000', targetMinor: '10000000' },
    });

    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100');
  });
});
