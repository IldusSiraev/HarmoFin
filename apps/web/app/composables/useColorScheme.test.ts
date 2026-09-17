import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

import { useColorScheme } from './useColorScheme.js';

function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: prefersDark && query.includes('prefers-color-scheme: dark'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const HostComponent = defineComponent({
  setup() {
    return useColorScheme();
  },
  template: '<div />',
});

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  mockMatchMedia(false);
});

describe('useColorScheme', () => {
  it('picks up a stored preference once mounted', async () => {
    window.localStorage.setItem('harmofin-theme', 'dark');
    const wrapper = mount(HostComponent);
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.preference).toBe('dark');
  });

  it('defaults to system and follows the OS preference', () => {
    mockMatchMedia(true);
    const wrapper = mount(HostComponent);

    expect(wrapper.vm.preference).toBe('system');
    expect(wrapper.vm.resolved()).toBe('dark');
  });

  it('setPreference applies the theme attribute and persists it', () => {
    const wrapper = mount(HostComponent);

    wrapper.vm.setPreference('dark');

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('harmofin-theme')).toBe('dark');
  });

  it('toggle flips between light and dark from the resolved theme', () => {
    const wrapper = mount(HostComponent);

    wrapper.vm.toggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    wrapper.vm.toggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
