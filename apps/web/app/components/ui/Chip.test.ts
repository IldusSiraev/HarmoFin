import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiChip from './Chip.vue';

describe('UiChip', () => {
  it('shows only its label while nothing is chosen', () => {
    const wrapper = mount(UiChip, { props: { label: 'Счёт' } });

    expect(wrapper.text()).toBe('Счёт');
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('false');
  });

  it('shows the chosen value and marks itself pressed', () => {
    const wrapper = mount(UiChip, {
      props: { label: 'Счёт', value: 'Основная карта', active: true },
    });

    expect(wrapper.text()).toContain('Счёт');
    expect(wrapper.text()).toContain('Основная карта');
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('true');
  });

  it('emits a click', async () => {
    const wrapper = mount(UiChip, { props: { label: 'Тип' } });

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('click')).toHaveLength(1);
  });
});
