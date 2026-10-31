import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    currentData: {
      value: { user: { email: 'owner@example.test' }, workspaces: [] } as {
        user: { email: string };
        workspaces: unknown[];
      } | null,
    },
    logout: vi.fn(),
    selectWorkspace: vi.fn(),
    createPersonalWorkspace: vi.fn(),
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

import AppMobileMenu from './AppMobileMenu.vue';

function mountMenu() {
  return mount(AppMobileMenu, {
    props: { open: true },
    global: {
      stubs: {
        teleport: true,
        NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] },
      },
    },
  });
}

describe('AppMobileMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.path = '/app';
    activity.unseenCount.value = null;
  });

  it('links to the calendar right after plans', () => {
    const wrapper = mountMenu();
    const hrefs = wrapper.findAll('a.mobile-menu__link').map((link) => link.attributes('href'));
    expect(hrefs.indexOf('/app/calendar')).toBe(hrefs.indexOf('/app/plans') + 1);
    expect(wrapper.get('a.mobile-menu__link[href="/app/calendar"]').text()).toBe('Календарь');
  });

  it('marks the calendar as the current page on its route', () => {
    mocks.route.path = '/app/calendar';
    const wrapper = mountMenu();
    expect(
      wrapper.get('a.mobile-menu__link[href="/app/calendar"]').attributes('aria-current'),
    ).toBe('page');
    expect(
      wrapper.get('a.mobile-menu__link[href="/app/plans"]').attributes('aria-current'),
    ).toBeUndefined();
  });

  it('links to the feed with an accessible new-events count', async () => {
    activity.unseenCount.value = 3;
    const wrapper = mountMenu();
    await flushPromises();
    const link = wrapper.get('a.mobile-menu__link[href="/app/activity"]');
    expect(link.text()).toContain('Лента');
    expect(link.text()).toContain('3 новых события');
    expect(activity.list).not.toHaveBeenCalled();
  });

  it('hides the feed badge for a zero or unknown count', async () => {
    for (const count of [0, null]) {
      activity.unseenCount.value = count;
      const wrapper = mountMenu();
      await flushPromises();
      const link = wrapper.get('a.mobile-menu__link[href="/app/activity"]');
      expect(link.find('.mobile-menu__badge').exists()).toBe(false);
      expect(link.text()).toBe('Лента');
    }
  });

  it('closes after a navigation link is followed', async () => {
    const wrapper = mountMenu();
    await wrapper.get('a.mobile-menu__link[href="/app/calendar"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
