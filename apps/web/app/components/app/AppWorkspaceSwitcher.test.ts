import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

type Workspace = { id: string; name: string; role: string; isCreator: boolean; budgets: unknown[] };

const workspaces = ref<Workspace[]>([]);
const activeId = ref<string | null>(null);
const selectWorkspace = vi.fn();
const createPersonalWorkspace = vi.fn();

vi.mock('../../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({
    workspaces: computed(() => workspaces.value),
    workspace: computed(
      () =>
        workspaces.value.find((item) => item.id === activeId.value) ?? workspaces.value[0] ?? null,
    ),
  }),
}));

vi.mock('../../composables/useAuth.js', () => ({
  useAuth: () => ({ selectWorkspace, createPersonalWorkspace }),
}));

import AppWorkspaceSwitcher from './AppWorkspaceSwitcher.vue';

const own = (id: string, name: string): Workspace => ({
  id,
  name,
  role: 'OWNER',
  isCreator: true,
  budgets: [],
});
const member = (id: string, name: string): Workspace => ({
  id,
  name,
  role: 'EDITOR',
  isCreator: false,
  budgets: [],
});

describe('AppWorkspaceSwitcher', () => {
  it('shows only the name when there is one own workspace', () => {
    workspaces.value = [own('w1', 'Мой бюджет')];
    activeId.value = 'w1';

    const wrapper = mount(AppWorkspaceSwitcher);

    expect(wrapper.text()).toContain('Мой бюджет');
    expect(wrapper.find('[data-testid="workspace-switcher"]').exists()).toBe(false);
  });

  it('shows a menu with the current workspace marked when there are several', async () => {
    workspaces.value = [own('w1', 'Мой бюджет'), member('w2', 'Сираевы')];
    activeId.value = 'w2';

    const wrapper = mount(AppWorkspaceSwitcher, { attachTo: document.body });
    await wrapper.get('[data-testid="workspace-switcher"]').trigger('click');

    expect(wrapper.get('[data-testid="workspace-option-w2"]').attributes('aria-current')).toBe(
      'true',
    );
    expect(wrapper.get('[data-testid="workspace-option-w1"]').attributes('aria-current')).toBe(
      undefined,
    );
    wrapper.unmount();
  });

  it('selects a workspace on click', async () => {
    workspaces.value = [own('w1', 'Мой бюджет'), member('w2', 'Сираевы')];
    activeId.value = 'w1';

    const wrapper = mount(AppWorkspaceSwitcher, { attachTo: document.body });
    await wrapper.get('[data-testid="workspace-switcher"]').trigger('click');
    await wrapper.get('[data-testid="workspace-option-w2"]').trigger('click');

    expect(selectWorkspace).toHaveBeenCalledWith('w2');
    wrapper.unmount();
  });

  it('offers to create a personal workspace for a member without one', async () => {
    workspaces.value = [member('w2', 'Сираевы')];
    activeId.value = 'w2';

    const wrapper = mount(AppWorkspaceSwitcher, { attachTo: document.body });
    await wrapper.get('[data-testid="workspace-switcher"]').trigger('click');
    await wrapper.get('[data-testid="workspace-create-personal"]').trigger('click');

    expect(createPersonalWorkspace).toHaveBeenCalled();
    wrapper.unmount();
  });
});
