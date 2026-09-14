import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import GoalsGrid from './GoalsGrid.vue';

const normalize = (value: string): string => value.replace(/[\u00A0\u202F ]/g, ' ');

describe('GoalsGrid', () => {
  it('shows each goal with its progress exposed to assistive technology', () => {
    const wrapper = mount(GoalsGrid);
    const bars = wrapper.findAll('[role="progressbar"]');

    expect(bars).toHaveLength(3);
    expect(normalize(bars[0]?.attributes('aria-label') ?? '')).toBe(
      'Ремонт: 70 000 ₽ из 120 000 ₽',
    );
    expect(bars[0]?.attributes('aria-valuenow')).toBe('58');
    expect(bars[1]?.attributes('aria-valuenow')).toBe('60');
    expect(bars[2]?.attributes('aria-valuenow')).toBe('42');
    expect(normalize(wrapper.text())).toContain('Отпуск');
  });
});
