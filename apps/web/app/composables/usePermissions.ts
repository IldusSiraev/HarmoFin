import { computed, type ComputedRef } from 'vue';

import { useActiveWorkspace } from './useActiveWorkspace.js';
import { useAuth } from './useAuth.js';

/** UI hint only: the server checks every action again. */
export function usePermissions(): {
  canManage: ComputedRef<boolean>;
  canWrite: ComputedRef<boolean>;
  canCreate: ComputedRef<boolean>;
  userId: ComputedRef<string | null>;
  isMine: (ownerUserId: string) => boolean;
} {
  const { role } = useActiveWorkspace();
  const { currentUser } = useAuth();
  const userId = computed(() => currentUser.value?.id ?? null);
  const canWrite = computed(() => role.value === 'OWNER' || role.value === 'EDITOR');
  return {
    canManage: computed(() => role.value === 'OWNER'),
    canWrite,
    canCreate: canWrite,
    userId,
    isMine: (ownerUserId: string) => ownerUserId === userId.value,
  };
}
