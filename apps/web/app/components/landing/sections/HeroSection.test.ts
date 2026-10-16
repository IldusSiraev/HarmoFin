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
    expect(headings[0]?.text()).toBe(
      'Знайте, сколько можно потратить, не задевая платежи и накопления.',
    );
    expect(wrapper.text()).toContain('Бюджет для семьи, пары или одного человека');
    expect(wrapper.text()).toContain(
      'Деньги лежат на счетах, а конверты показывают, на что они отложены. HarmoFin считает, сколько из них свободно для трат прямо сейчас.',
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
    expect(wrapper.text()).toContain('Удобно с телефона');
    expect(wrapper.text()).toContain('Без привязки к банку');
  });
});
