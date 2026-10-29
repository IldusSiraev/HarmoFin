import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const state = vi.hoisted(() => ({ role: 'OWNER' as 'OWNER' | 'EDITOR' | 'VIEWER' | null }));
vi.mock('../../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ role: computed(() => state.role) }),
}));
// usePermissions now reads the user from useAuth; the nav only cares about the role.
vi.mock('../../composables/useAuth.js', () => ({
  useAuth: () => ({ currentUser: computed(() => null) }),
}));

import AppBottomNav from './AppBottomNav.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

const mountNav = () => mount(AppBottomNav, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

beforeEach(() => {
  useOperationDialogs().close();
  state.role = 'OWNER';
});

describe('AppBottomNav', () => {
  it('links to the two most used sections', () => {
    const hrefs = mountNav()
      .findAll('a')
      .map((link) => link.attributes('href'));

    expect(hrefs).toEqual(['/app', '/app/operations']);
  });

  it('opens the operation dialog from the central button', async () => {
    const wrapper = mountNav();

    await wrapper.get('[data-testid="bottom-nav-add"]').trigger('click');

    expect(useOperationDialogs().openDialog.value).toBe('entry');
  });

  it('asks the shell to open the rest of the navigation', async () => {
    const wrapper = mountNav();

    await wrapper.get('[data-testid="bottom-nav-more"]').trigger('click');

    expect(wrapper.emitted('more')).toHaveLength(1);
  });

  it('labels icon-only controls', () => {
    const wrapper = mountNav();

    expect(wrapper.get('[data-testid="bottom-nav-add"]').attributes('aria-label')).toBe(
      'Добавить операцию',
    );
  });

  it('shows the add button for an editor', () => {
    state.role = 'EDITOR';
    const wrapper = mountNav();

    expect(wrapper.find('[data-testid="bottom-nav-add"]').exists()).toBe(true);
  });

  it('hides the add button for a viewer, who cannot record operations', () => {
    state.role = 'VIEWER';
    const wrapper = mountNav();

    expect(wrapper.find('[data-testid="bottom-nav-add"]').exists()).toBe(false);
  });

  it('switches to a 3-column grid for a viewer, keeping "Ещё" at the edge', () => {
    state.role = 'VIEWER';
    const wrapper = mountNav();

    expect(wrapper.get('.app-bottom-nav').classes()).toContain('app-bottom-nav--no-add');
  });

  it('keeps the 4-column grid for an editor, who still has the add button', () => {
    state.role = 'EDITOR';
    const wrapper = mountNav();

    expect(wrapper.get('.app-bottom-nav').classes()).not.toContain('app-bottom-nav--no-add');
  });
});
