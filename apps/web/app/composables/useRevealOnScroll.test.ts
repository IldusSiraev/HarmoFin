import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { useRevealOnScroll } from './useRevealOnScroll.js';

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

function mockObserver(): { callbacks: ObserverCallback[]; disconnect: ReturnType<typeof vi.fn> } {
  const callbacks: ObserverCallback[] = [];
  const disconnect = vi.fn();

  class TestObserver {
    constructor(callback: ObserverCallback) {
      callbacks.push(callback);
    }
    observe(): void {}
    disconnect(): void {
      disconnect();
    }
  }

  window.IntersectionObserver = TestObserver as unknown as typeof window.IntersectionObserver;

  return { callbacks, disconnect };
}

function mountHost() {
  const Host = defineComponent({
    name: 'RevealHost',
    setup() {
      const { target, revealed } = useRevealOnScroll();
      return () => h('div', { ref: target, class: revealed.value ? 'is-revealed' : '' });
    },
  });

  return mount(Host, { attachTo: document.body });
}

describe('useRevealOnScroll', () => {
  it('reveals the element once it intersects and stops observing', async () => {
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
    const { callbacks, disconnect } = mockObserver();
    const wrapper = mountHost();

    expect(wrapper.classes()).not.toContain('is-revealed');

    callbacks[0]?.([{ isIntersecting: true }]);
    await wrapper.vm.$nextTick();

    expect(wrapper.classes()).toContain('is-revealed');
    expect(disconnect).toHaveBeenCalled();
  });

  it('reveals immediately when IntersectionObserver is unavailable', async () => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
    const wrapper = mountHost();
    await wrapper.vm.$nextTick();

    expect(wrapper.classes()).toContain('is-revealed');
  });
});
