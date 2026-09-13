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

  it('wraps the button in a tooltip only when the tooltip prop is set', async () => {
    const wrapper = mount(UiButton, {
      props: { tooltip: 'Переместить счёт в архив' },
      slots: { default: 'Архивировать' },
    });

    await wrapper.get('.ui-tooltip').trigger('focusin');
    expect(wrapper.get('[role="tooltip"]').text()).toBe('Переместить счёт в архив');
    expect(wrapper.get('button').attributes('aria-describedby')).toBe(
      wrapper.get('[role="tooltip"]').attributes('id'),
    );
  });

  it('renders button as the true DOM root when tooltip prop is not set', () => {
    const wrapper = mount(UiButton, {
      slots: { default: 'Кнопка' },
    });

    expect(wrapper.find('.ui-tooltip').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(true);
  });

  it('applies ui-tooltip--full-width class when fullWidth and tooltip are both set', () => {
    const wrapper = mount(UiButton, {
      props: { fullWidth: true, tooltip: 'Подсказка' },
      slots: { default: 'Кнопка' },
    });

    expect(wrapper.find('.ui-tooltip--full-width').exists()).toBe(true);
  });

  it('does not apply ui-tooltip--full-width class when tooltip is set but fullWidth is false', () => {
    const wrapper = mount(UiButton, {
      props: { tooltip: 'Подсказка' },
      slots: { default: 'Кнопка' },
    });

    expect(wrapper.find('.ui-tooltip--full-width').exists()).toBe(false);
  });

  it('forwards non-prop attributes like data-action to the rendered button', () => {
    const wrapper = mount(UiButton, {
      attrs: { 'data-action': 'create-account' },
      slots: { default: 'Создать счёт' },
    });

    expect(wrapper.get('button').attributes('data-action')).toBe('create-account');
  });
});
