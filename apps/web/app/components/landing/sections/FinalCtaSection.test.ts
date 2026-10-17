import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FinalCtaSection from './FinalCtaSection.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

describe('FinalCtaSection', () => {
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
