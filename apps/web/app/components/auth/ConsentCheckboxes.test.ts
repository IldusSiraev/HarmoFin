import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ConsentCheckboxes from './ConsentCheckboxes.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('ConsentCheckboxes', () => {
  it('renders two separate unchecked checkboxes with links to the documents', () => {
    const wrapper = mount(ConsentCheckboxes, {
      props: { terms: false, pd: false },
      global: { stubs },
    });
    const boxes = wrapper.findAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => !(box.element as HTMLInputElement).checked)).toBe(true);
    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(hrefs).toEqual(['/terms', '/privacy', '/consent']);
    expect(wrapper.findAll('a').every((link) => link.attributes('target') === '_blank')).toBe(true);
    expect(
      wrapper.findAll('a').every((link) => link.attributes('rel') === 'noopener noreferrer'),
    ).toBe(true);
  });

  it('emits each checkbox separately', async () => {
    const wrapper = mount(ConsentCheckboxes, {
      props: { terms: false, pd: false },
      global: { stubs },
    });
    await wrapper.get('[name="consent-terms"]').setValue(true);
    await wrapper.get('[name="consent-pd"]').setValue(true);
    expect(wrapper.emitted('update:terms')?.[0]).toEqual([true]);
    expect(wrapper.emitted('update:pd')?.[0]).toEqual([true]);
  });
});
