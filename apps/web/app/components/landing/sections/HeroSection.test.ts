import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import HeroSection from './HeroSection.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

describe('HeroSection', () => {
  it('states the product promise in the single page heading', () => {
    const wrapper = mount(HeroSection, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

    const headings = wrapper.findAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.text()).toBe('Понимайте свои деньги, а не просто записывайте расходы.');
    expect(wrapper.text()).toContain('Управляйте личными и семейными финансами');
    expect(wrapper.text()).toContain(
      'HarmoFin показывает, сколько денег у вас есть, на что они уже предназначены и сколько можно потратить прямо сейчас.',
    );
  });

  it('sends the primary call to action to registration and the secondary one to the demo section', () => {
    const wrapper = mount(HeroSection, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(hrefs).toContain('/register');
    expect(hrefs).toContain('#how-it-works');
  });

  it('lists the trust points from the brief', () => {
    const wrapper = mount(HeroSection, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

    expect(wrapper.text()).toContain('Без сложных таблиц');
    expect(wrapper.text()).toContain('Адаптивный интерфейс');
    expect(wrapper.text()).toContain('Без банковской привязки на старте');
  });
});
