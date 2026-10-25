import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const state = vi.hoisted(() => ({ role: 'OWNER' as 'OWNER' | 'EDITOR' | 'VIEWER' | null }));
vi.mock('../../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ role: computed(() => state.role) }),
}));

import AppAddMenu from './AppAddMenu.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

beforeEach(() => {
  useOperationDialogs().close();
  state.role = 'OWNER';
});

describe('AppAddMenu', () => {
  it('opens the type picker when the trigger is clicked', async () => {
    const wrapper = mount(AppAddMenu);

    expect(useOperationDialogs().openDialog.value).toBe('none');
    await wrapper.get('[data-testid="add-menu-trigger"]').trigger('click');

    expect(useOperationDialogs().openDialog.value).toBe('choose');
  });

  it('shows the trigger for an editor', () => {
    state.role = 'EDITOR';
    const wrapper = mount(AppAddMenu);

    expect(wrapper.find('[data-testid="add-menu-trigger"]').exists()).toBe(true);
  });

  it('hides the trigger for a viewer, who cannot record operations', () => {
    state.role = 'VIEWER';
    const wrapper = mount(AppAddMenu);

    expect(wrapper.find('[data-testid="add-menu-trigger"]').exists()).toBe(false);
  });
});
