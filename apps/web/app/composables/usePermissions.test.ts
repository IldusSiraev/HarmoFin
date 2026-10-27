import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

const role = ref<'OWNER' | 'EDITOR' | 'VIEWER' | null>(null);
const currentUser = ref<{ id: string } | null>(null);
vi.mock('./useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ role: computed(() => role.value) }),
}));
vi.mock('./useAuth.js', () => ({
  useAuth: () => ({ currentUser: computed(() => currentUser.value) }),
}));

import { usePermissions } from './usePermissions.js';

describe('usePermissions', () => {
  it.each([
    ['OWNER', true, true],
    ['EDITOR', false, true],
    ['VIEWER', false, false],
    [null, false, false],
  ] as const)('%s → manage %s, write/create %s', (value, manage, write) => {
    role.value = value;
    const permissions = usePermissions();
    expect(permissions.canManage.value).toBe(manage);
    expect(permissions.canWrite.value).toBe(write);
    expect(permissions.canCreate.value).toBe(write);
  });

  it('exposes the current user and the ownership check', () => {
    role.value = 'EDITOR';
    currentUser.value = { id: 'u-me' };
    const permissions = usePermissions();
    expect(permissions.userId.value).toBe('u-me');
    expect(permissions.isMine('u-me')).toBe(true);
    expect(permissions.isMine('u-alia')).toBe(false);
  });
});
