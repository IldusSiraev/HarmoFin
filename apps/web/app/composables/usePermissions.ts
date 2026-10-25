import { computed, type ComputedRef } from 'vue';

import { useActiveWorkspace } from './useActiveWorkspace.js';

/** UI hint only: the server checks every action again. */
export function usePermissions(): {
  canManage: ComputedRef<boolean>;
  canWrite: ComputedRef<boolean>;
} {
  const { role } = useActiveWorkspace();
  return {
    canManage: computed(() => role.value === 'OWNER'),
    canWrite: computed(() => role.value === 'OWNER' || role.value === 'EDITOR'),
  };
}
