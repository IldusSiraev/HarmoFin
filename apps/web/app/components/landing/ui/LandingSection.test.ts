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

  it('reveals itself immediately when IntersectionObserver is unavailable', async () => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
    const wrapper = mount(LandingSection, {
      props: { sectionId: 'goals', title: 'Цели' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('.landing-section__inner').classes()).toContain('is-revealed');
  });

  it('stays hidden until the observer reports an intersection', async () => {
    const callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    class TestObserver {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        callbacks.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    }
    window.IntersectionObserver = TestObserver as unknown as typeof window.IntersectionObserver;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;

    const wrapper = mount(LandingSection, {
      props: { sectionId: 'plans', title: 'Планы' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('.landing-section__inner').classes()).not.toContain('is-revealed');

    callbacks[0]?.([{ isIntersecting: true }]);
    await wrapper.vm.$nextTick();

    expect(wrapper.get('.landing-section__inner').classes()).toContain('is-revealed');
  });

  it('never marks the inner container as reveal-ready when no observer is created', async () => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
    const wrapper = mount(LandingSection, {
      props: { sectionId: 'goals', title: 'Цели' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    const classes = wrapper.get('.landing-section__inner').classes();
    expect(classes).not.toContain('is-reveal-ready');
    expect(classes).toContain('is-revealed');
  });
});
