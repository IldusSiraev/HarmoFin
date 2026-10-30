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
  route: { path: '/app', query: {} as Record<string, string> },
}));

vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));
const activity = vi.hoisted(() => ({
  unseenCount: { value: null as number | null },
  list: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../composables/useActivityFeed.js', () => ({ useActivityFeed: () => activity }));
vi.mock('#imports', () => ({
  navigateTo: vi.fn(),
  useRoute: () => mocks.route,
}));

import AppSidebar from './AppSidebar.vue';

function mountSidebar() {
  return mount(AppSidebar, {
    global: { stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } } },
  });
}

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

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentData.value = { user: { email: 'owner@example.test' } };
    mocks.route.path = '/app';
    activity.unseenCount.value = null;
    activity.list.mockResolvedValue({});
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockMatchMedia(false);
  });

  it('links to every app section', () => {
    const wrapper = mountSidebar();
    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));

    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/app',
        '/app/operations',
        '/app/plans',
        '/app/calendar',
        '/app/accounts',
        '/app/envelopes',
        '/app/categories',
        '/app/analytics',
        '/app/notifications',
        '/app/settings',
      ]),
    );
    expect(hrefs).not.toContain('/app/transfers');
  });

  it('marks the active section for assistive technology, not only with colour', () => {
    const wrapper = mountSidebar();

    expect(wrapper.get('a.app-sidebar__link[href="/app"]').attributes('aria-current')).toBe('page');
    expect(
      wrapper.get('a.app-sidebar__link[href="/app/accounts"]').attributes('aria-current'),
    ).toBeUndefined();
  });

  it('links to the calendar right after plans and marks it current on its route', () => {
    mocks.route.path = '/app/calendar';
    const wrapper = mountSidebar();
    const links = wrapper.findAll('a.app-sidebar__link');
    const hrefs = links.map((link) => link.attributes('href'));
    expect(hrefs.indexOf('/app/calendar')).toBe(hrefs.indexOf('/app/plans') + 1);

    const calendar = wrapper.get('a.app-sidebar__link[href="/app/calendar"]');
    expect(calendar.text()).toBe('Календарь');
    expect(calendar.attributes('aria-current')).toBe('page');
    expect(calendar.find('svg').attributes('aria-hidden')).toBe('true');
    expect(
      wrapper.get('a.app-sidebar__link[href="/app/plans"]').attributes('aria-current'),
    ).toBeUndefined();
  });

  it('links to the feed with an accessible new-events count', async () => {
    activity.unseenCount.value = 3;
    const wrapper = mountSidebar();
    await flushPromises();
    const link = wrapper.get('a[href="/app/activity"]');
    expect(link.text()).toContain('Лента');
    expect(link.text()).toContain('3 новых события');
    expect(activity.list).not.toHaveBeenCalled();
  });

  it('reads the count once when nothing loaded it yet', async () => {
    mocks.auth.currentData.value = {
      user: { email: 'owner@example.test' },
      workspaces: [{ id: 'ws', isCreator: true, role: 'OWNER', budgets: [{ id: 'budget-id' }] }],
    } as never;
    mountSidebar();
    await flushPromises();
    expect(activity.list).toHaveBeenCalledWith('budget-id', { limit: 1 });
  });

  it('shows the signed-in email and logs out on click', async () => {
    const wrapper = mountSidebar();
    await flushPromises();
    expect(wrapper.text()).toContain('owner@example.test');

    await wrapper.get('.app-sidebar__logout').trigger('click');
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
  });

  it('toggles the colour theme from a single icon button', async () => {
    const wrapper = mountSidebar();
    await flushPromises();

    const toggle = wrapper.get('.app-sidebar__theme-toggle');
    expect(toggle.attributes('aria-label')).toBe('Включить тёмную тему');

    await toggle.trigger('click');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(toggle.attributes('aria-label')).toBe('Включить светлую тему');

    await toggle.trigger('click');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
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
