import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppHeader from './AppHeader.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

describe('AppHeader', () => {
  // The header only shows below 1024px, where the bottom navigation already
  // carries the single add button.
  it('leaves the add button to the bottom navigation', () => {
    const wrapper = mount(AppHeader, {
      global: { stubs: { NuxtLink: NuxtLinkStub, AppUserMenu: true } },
    });

    expect(wrapper.find('[data-testid="add-menu-trigger"]').exists()).toBe(false);
    expect(wrapper.get('a').attributes('href')).toBe('/app');
  });
});
