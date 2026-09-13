import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LandingSection from './LandingSection.vue';

describe('LandingSection', () => {
  it('links the section to its heading for assistive technology', () => {
    const wrapper = mount(LandingSection, {
      props: { sectionId: 'concept', title: 'Где деньги?', eyebrow: 'Счета и конверты' },
      slots: { default: '<p>Контент</p>' },
    });

    const section = wrapper.get('section');
    expect(section.attributes('id')).toBe('concept');
    expect(section.attributes('aria-labelledby')).toBe('concept-title');

    const heading = wrapper.get('h2');
    expect(heading.attributes('id')).toBe('concept-title');
    expect(heading.text()).toBe('Где деньги?');
    expect(wrapper.text()).toContain('Счета и конверты');
    expect(wrapper.html()).toContain('<p>Контент</p>');
  });

  it('omits the description block when no description is given', () => {
    const wrapper = mount(LandingSection, { props: { sectionId: 'plans', title: 'Планы' } });

    expect(wrapper.find('.landing-section__description').exists()).toBe(false);
  });
});
