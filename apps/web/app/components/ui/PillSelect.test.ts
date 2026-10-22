import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { Landmark } from '@lucide/vue';

import UiPillSelect from './PillSelect.vue';

const options = [
  { value: 'a', label: 'Карта', icon: Landmark, iconColor: 'var(--hf-color-account-card)' },
  { value: 'b', label: 'Наличные', icon: Landmark, iconColor: 'var(--hf-color-account-cash)' },
];

describe('UiPillSelect', () => {
  it('красит иконку невыбранной опции, у выбранной цвет акцента', () => {
    const wrapper = mount(UiPillSelect, {
      props: { name: 'account', label: 'Счёт', options, modelValue: 'a' },
    });
    const icons = wrapper.findAll('.pill-select__icon');
    expect(icons[0]!.attributes('style') ?? '').not.toContain('--hf-color-account-card');
    expect(icons[1]!.attributes('style')).toContain('--hf-color-account-cash');
  });
});
