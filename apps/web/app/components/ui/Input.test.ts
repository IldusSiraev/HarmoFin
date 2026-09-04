import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiInput from './Input.vue';

describe('UiInput', () => {
  it('connects label, hint and field error without replacing visible label', () => {
    const wrapper = mount(UiInput, {
      props: {
        modelValue: '',
        name: 'name',
        label: 'Название',
        hint: 'До 120 символов',
        error: 'Заполните поле',
      },
    });
    const input = wrapper.get('input');

    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
    expect(wrapper.get('label').text()).toBe('Название');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toContain(`${input.attributes('id')}-hint`);
    expect(input.attributes('aria-describedby')).toContain(`${input.attributes('id')}-error`);
  });

  it('emits model updates and blur from native input', async () => {
    const wrapper = mount(UiInput, {
      props: { modelValue: '', name: 'email', label: 'Email', type: 'email' },
    });

    await wrapper.get('input').setValue('user@example.test');
    await wrapper.get('input').trigger('blur');

    expect(wrapper.emitted('update:modelValue')).toEqual([['user@example.test']]);
    expect(wrapper.emitted('blur')).toHaveLength(1);
  });
});
