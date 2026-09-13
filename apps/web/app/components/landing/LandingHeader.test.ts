import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LandingHeader from './LandingHeader.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

const mountHeader = () => mount(LandingHeader, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

describe('LandingHeader', () => {
  it('renders anchor navigation and both call-to-action links', () => {
    const wrapper = mountHeader();

    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '#features',
        '#how-it-works',
        '#security',
        '#faq',
        '/login',
        '/register',
      ]),
    );
  });

  it('toggles the mobile menu and reports its state', async () => {
    const wrapper = mountHeader();
    const toggle = wrapper.get('[data-testid="landing-menu-toggle"]');

    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-controls')).toBe('landing-mobile-menu');
    expect(wrapper.find('#landing-mobile-menu').exists()).toBe(false);

    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('#landing-mobile-menu').isVisible()).toBe(true);

    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('false');
  });

  it('closes the mobile menu when a navigation link is used', async () => {
    const wrapper = mountHeader();
    await wrapper.get('[data-testid="landing-menu-toggle"]').trigger('click');

    await wrapper.get('#landing-mobile-menu a').trigger('click');

    expect(wrapper.get('[data-testid="landing-menu-toggle"]').attributes('aria-expanded')).toBe(
      'false',
    );
  });
});
