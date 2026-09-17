import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';

const mocks = vi.hoisted(() => ({
  auth: {
    currentData: {
      value: { user: { email: 'owner@example.test' } } as { user: { email: string } } | null,
    },
    logout: vi.fn(),
  },
}));

vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));

import AppSidebar from './AppSidebar.vue';

function mountSidebar() {
  return mount(AppSidebar, {
    global: { stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } } },
  });
}

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentData.value = { user: { email: 'owner@example.test' } };
  });

  it('links to every app section including Переводы', () => {
    const wrapper = mountSidebar();
    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));

    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/app',
        '/app/operations',
        '/app/transfers',
        '/app/plans',
        '/app/accounts',
        '/app/envelopes',
        '/app/categories',
        '/app/analytics',
        '/app/notifications',
        '/app/settings',
      ]),
    );
  });

  it('marks the active section for assistive technology, not only with colour', () => {
    const wrapper = mountSidebar();

    expect(wrapper.get('a.app-sidebar__link[href="/app"]').attributes('aria-current')).toBe('page');
    expect(
      wrapper.get('a.app-sidebar__link[href="/app/accounts"]').attributes('aria-current'),
    ).toBeUndefined();
  });

  it('shows the signed-in email and logs out on click', async () => {
    const wrapper = mountSidebar();
    await flushPromises();
    expect(wrapper.text()).toContain('owner@example.test');

    await wrapper.get('.app-sidebar__logout').trigger('click');
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
  });

  it('hydrates without a mismatch when the session resolves before mount', async () => {
    // The real `auth` middleware skips SSR (no session to forward) and awaits
    // `loadMe()` on the client before Nuxt mounts the app, so `currentData`
    // is already populated by the time hydration compares against the
    // server's markup. Reproduce that ordering: render server HTML with no
    // session, then hydrate a client app that already has one.
    mocks.auth.currentData.value = null;
    const serverHtml = await renderToString(createSSRApp(AppSidebar));

    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.append(container);

    const messages: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
      messages.push(String(message));
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
      messages.push(String(message));
    });

    try {
      mocks.auth.currentData.value = { user: { email: 'owner@example.test' } };
      const clientApp = createSSRApp(AppSidebar);
      clientApp.mount(container);
      await Promise.resolve();

      expect(messages.some((message) => message.includes('Hydration'))).toBe(false);
      expect(container.textContent).toContain('owner@example.test');
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      container.remove();
    }
  });
});
