import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

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
});
