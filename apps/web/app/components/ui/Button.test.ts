import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiButton from './Button.vue';

describe('UiButton', () => {
  it('uses native button defaults and blocks clicks while loading', async () => {
    const wrapper = mount(UiButton, { slots: { default: 'Сохранить' } });

    expect(wrapper.get('button').attributes('type')).toBe('button');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);

    await wrapper.setProps({ loading: true });
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('keeps explicit type and disabled state', () => {
    const wrapper = mount(UiButton, {
      props: { type: 'submit', disabled: true },
      slots: { default: 'Отправить' },
    });

    expect(wrapper.get('button').attributes('type')).toBe('submit');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });
});
