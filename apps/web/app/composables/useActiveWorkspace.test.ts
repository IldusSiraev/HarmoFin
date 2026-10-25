import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const currentData = ref<unknown>(null);
vi.mock('./useAuth.js', () => ({ useAuth: () => ({ currentData }) }));

import { useActiveWorkspace } from './useActiveWorkspace.js';

const budget = (id: string) => ({ id, name: id, primaryCurrency: 'RUB', planModelVersion: 2 as const });

describe('useActiveWorkspace', () => {
  it('picks the workspace named by activeWorkspaceId, not the first one', () => {
    currentData.value = {
      activeWorkspaceId: 'family',
      workspaces: [
        { id: 'personal', name: 'Мой бюджет', role: 'OWNER', isCreator: true, budgets: [budget('b1')] },
        { id: 'family', name: 'Сираевы', role: 'EDITOR', isCreator: false, budgets: [budget('b2')] },
      ],
    };
    const active = useActiveWorkspace();
    expect(active.workspace.value?.id).toBe('family');
    expect(active.budgetId.value).toBe('b2');
    expect(active.role.value).toBe('EDITOR');
    expect(active.isCreator.value).toBe(false);
  });

  it('falls back to the first workspace when the active id is unknown', () => {
    currentData.value = {
      activeWorkspaceId: null,
      workspaces: [{ id: 'personal', name: 'Мой бюджет', role: 'OWNER', isCreator: true, budgets: [budget('b1')] }],
    };
    expect(useActiveWorkspace().budgetId.value).toBe('b1');
  });

  it('is empty before me is loaded', () => {
    currentData.value = null;
    const active = useActiveWorkspace();
    expect(active.workspace.value).toBeNull();
    expect(active.role.value).toBeNull();
  });
});
