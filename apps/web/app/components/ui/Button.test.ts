import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiButton from './Button.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

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

  it('renders a button element by default', () => {
    const wrapper = mount(UiButton, { slots: { default: 'Сохранить' } });

    expect(wrapper.get('button').element.tagName).toBe('BUTTON');
    expect(wrapper.get('button').classes()).toContain('ui-button--primary');
  });

  it('renders a link when "to" is provided', () => {
    const wrapper = mount(UiButton, {
      props: { to: '/register', variant: 'brand', size: 'lg' },
      slots: { default: 'Начать бесплатно' },
      global: { stubs: { NuxtLink: NuxtLinkStub } },
    });

    const link = wrapper.get('a');
    expect(link.attributes('href')).toBe('/register');
    expect(link.classes()).toContain('ui-button--brand');
    expect(link.classes()).toContain('ui-button--lg');
    expect(link.attributes('type')).toBeUndefined();
    expect(link.text()).toBe('Начать бесплатно');
  });

  it('resolves the link component itself, without a test-supplied stub', () => {
    // Guards the regression where `:is="'NuxtLink'"` rendered an unresolved
    // <nuxtlink> element in the browser: nothing navigated, yet every test that
    // supplied its own stub still passed.
    const wrapper = mount(UiButton, {
      props: { to: '/register' },
      slots: { default: 'Начать бесплатно' },
    });

    const link = wrapper.get('a');
    expect(link.attributes('href')).toBe('/register');
    expect(wrapper.html()).not.toContain('<nuxtlink');
  });

  it('does not emit click when disabled', async () => {
    const wrapper = mount(UiButton, { props: { disabled: true }, slots: { default: 'Ок' } });

    await wrapper.trigger('click');

    expect(wrapper.emitted('click')).toBeUndefined();
  });

  it('keeps a caller aria-describedby when there is no tooltip', () => {
    const wrapper = mount(UiButton, {
      attrs: { 'aria-describedby': 'hint-id' },
      slots: { default: 'Далее' },
    });
    expect(wrapper.get('button').attributes('aria-describedby')).toBe('hint-id');
  });

  it('merges the tooltip id with a caller aria-describedby', async () => {
    const wrapper = mount(UiButton, {
      props: { tooltip: 'Подсказка' },
      attrs: { 'aria-describedby': 'hint-id' },
      slots: { default: 'Далее' },
    });
    await wrapper.get('.ui-tooltip').trigger('focusin');
    const tooltipId = wrapper.get('[role="tooltip"]').attributes('id');
    expect(wrapper.get('button').attributes('aria-describedby')).toBe(`${tooltipId} hint-id`);
  });

  it('uses only the tooltip id when no caller aria-describedby is set', async () => {
    const wrapper = mount(UiButton, {
      props: { tooltip: 'Подсказка' },
      slots: { default: 'Далее' },
    });
    await wrapper.get('.ui-tooltip').trigger('focusin');
    expect(wrapper.get('button').attributes('aria-describedby')).toBe(
      wrapper.get('[role="tooltip"]').attributes('id'),
    );
  });
});
