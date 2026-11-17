import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FinalCtaSection from './FinalCtaSection.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

describe('FinalCtaSection', () => {
  it('keeps the named section and actions before the decorative illustration', () => {
    const wrapper = mount(FinalCtaSection, { global: { stubs: { NuxtLink: NuxtLinkStub } } });
    expect(wrapper.get('section').attributes('id')).toBe('get-started');
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe('final-cta-title');
    expect(wrapper.get('h2').attributes('id')).toBe('final-cta-title');
    const inner = wrapper.get('.final-cta__inner');
    expect(inner.element.children[0]?.className).toBe('final-cta__content');
    const image = inner.get('img');
    expect(image.attributes()).toMatchObject({
      src: '/illustrations/shared-goals-v2-640.webp',
      alt: '',
      'aria-hidden': 'true',
      width: '1755',
      height: '896',
      loading: 'lazy',
      decoding: 'async',
    });
    expect(wrapper.findAll('img')).toHaveLength(1);
  });
  it('closes the page with the brief copy and both actions', () => {
    const wrapper = mount(FinalCtaSection, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

    expect(wrapper.get('h2').text()).toBe('Хватит гадать, сколько можно потратить.');
    expect(wrapper.text()).toContain(
      'Создайте бюджет, разложите деньги по конвертам и всегда знайте, сколько можно потратить.',
    );

    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(hrefs).toContain('/register');
    expect(hrefs).toContain('#features');
    expect(wrapper.text()).toContain('Без банковской привязки. Без сложной настройки.');
  });
});
