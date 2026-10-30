import { mount } from '@vue/test-utils';
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

  it('closes after a navigation link is followed', async () => {
    const wrapper = mountMenu();
    await wrapper.get('a.mobile-menu__link[href="/app/calendar"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
