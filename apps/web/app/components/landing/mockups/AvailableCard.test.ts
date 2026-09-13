import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import AvailableCard from './AvailableCard.vue';

const normalize = (value: string): string => value.replace(/[\u00A0 ]/g, ' ');

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Reflect.deleteProperty(window, 'IntersectionObserver');
});

describe('AvailableCard', () => {
  it('renders the final amount immediately when motion is reduced', async () => {
    const wrapper = mount(AvailableCard, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const text = normalize(wrapper.text());
    expect(text).toContain('21 800 ₽');
    expect(text).toContain('Период 25–9');
    expect(text).toContain('Осталось 7 дней');
    expect(text).toContain('41 200 ₽');
    expect(text).toContain('63 000 ₽');
    expect(text).toContain('3 114 ₽');
  });

  it('exposes the spending progress to assistive technology', async () => {
    const wrapper = mount(AvailableCard, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    const bar = wrapper.get('[role="progressbar"]');
    expect(bar.attributes('aria-valuenow')).toBe('65');
    expect(normalize(bar.attributes('aria-label') ?? '')).toBe(
      'Потрачено 41 200 ₽ из лимита 63 000 ₽',
    );
  });
});
