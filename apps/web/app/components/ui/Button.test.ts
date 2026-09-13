import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiButton from './Button.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

describe('UiButton', () => {
  it('renders a button element by default', () => {
    const wrapper = mount(UiButton, { slots: { default: 'Сохранить' } });

    expect(wrapper.element.tagName).toBe('BUTTON');
    expect(wrapper.classes()).toContain('ui-button--primary');
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

  it('does not emit click when disabled', async () => {
    const wrapper = mount(UiButton, { props: { disabled: true }, slots: { default: 'Ок' } });

    await wrapper.trigger('click');

    expect(wrapper.emitted('click')).toBeUndefined();
  });
});
