import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AvailableToSpendSection from './AvailableToSpendSection.vue';

describe('AvailableToSpendSection', () => {
  it('explains that the limit comes from actual operations', () => {
    const wrapper = mount(AvailableToSpendSection, { attachTo: document.body });

    expect(wrapper.get('section').attributes('id')).toBe('available');
    expect(wrapper.get('h2').text()).toBe('Главный вопрос — сколько можно потратить сегодня?');
    expect(wrapper.text()).toContain(
      'HarmoFin рассчитывает доступный остаток на основе фактических доходов и операций, а не предполагаемой суммы будущей выплаты.',
    );
  });
});
