import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

const role = ref<'OWNER' | 'EDITOR' | 'VIEWER' | null>(null);
vi.mock('./useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ role: computed(() => role.value) }),
}));

import { usePermissions } from './usePermissions.js';

describe('usePermissions', () => {
  it.each([
    ['OWNER', true, true],
    ['EDITOR', false, true],
    ['VIEWER', false, false],
    [null, false, false],
  ] as const)('%s → manage %s, write %s', (value, manage, write) => {
    role.value = value;
    const permissions = usePermissions();
    expect(permissions.canManage.value).toBe(manage);
    expect(permissions.canWrite.value).toBe(write);
  });
});
