import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    currentData: { value: { user: { email: 'owner@example.test' } } },
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

  it('shows the signed-in email and logs out on click', async () => {
    const wrapper = mountSidebar();
    expect(wrapper.text()).toContain('owner@example.test');

    await wrapper.get('.app-sidebar__logout').trigger('click');
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
  });
});
